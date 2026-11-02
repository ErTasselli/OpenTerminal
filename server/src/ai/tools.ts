import { z } from "zod";
import { apiKey } from "../auth.js";
import type { Quote, Candle } from "../providers/yahoo.js";
import type { NewsItem } from "../providers/news.js";
import type { InsiderTransaction } from "../providers/secedgar.js";

// AI tools call the app's own market routes over loopback. That keeps one
// source of truth for provider fallbacks, caching, and the Schwab/public
// setting instead of duplicating the fallback chains behind the AI endpoint.

const INTERNAL_BASE =
  process.env.AI_INTERNAL_API_URL?.trim() ||
  (() => {
    const host = process.env.API_HOST ?? "127.0.0.1";
    const connectHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
    return `http://${connectHost}:${process.env.API_PORT ?? 4000}`;
  })();

const MAX_TOOL_RESULT_CHARS = 16_000;
const TOOL_TIMEOUT_MS = 8_000;

type OptionRow = {
  strike: number | null;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility?: number | null;
  inTheMoney: boolean;
};

type OptionChain = {
  symbol: string;
  underlyingPrice: number | null;
  expirationDates: string[];
  selectedDate: string | null;
  calls: OptionRow[];
  puts: OptionRow[];
};

type MacroSnapshot = {
  yields: Array<{ tenor: string; value: number | null }>;
  vix: number | null;
  indexes: Array<{ symbol: string; label: string; price: number | null; changePercent: number | null }>;
  policyRate: number | null;
  inflation: number | null;
};

export type ToolExecution = {
  name: string;
  input: unknown;
  ok: boolean;
  durationMs: number;
};

export type ToolResult = {
  content: string;
  isError: boolean;
  execution: ToolExecution;
};

const symbolSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9.^=-]+$/, "symbol may contain letters, digits, ., ^, = and -")
  .transform((s) => s.toUpperCase());

const rangeSchema = z.enum(["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"]);
const expirySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expiry must be YYYY-MM-DD");

async function marketGet<T>(path: string): Promise<T> {
  const res = await fetch(`${INTERNAL_BASE}/api${path}`, {
    headers: { "x-api-key": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const body = JSON.parse(text) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // keep the text preview
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return JSON.parse(text) as T;
}

function resultText(value: unknown): string {
  const text = JSON.stringify(value);
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}… [truncated]`;
}

function round(value: number | null | undefined, digits = 2): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function historySummary(symbol: string, range: string, candles: Candle[]) {
  const first = candles[0];
  const last = candles[candles.length - 1];
  const high = Math.max(...candles.map((c) => c.high));
  const low = Math.min(...candles.map((c) => c.low));
  return {
    symbol,
    range,
    from: first ? new Date(first.time * 1000).toISOString() : null,
    to: last ? new Date(last.time * 1000).toISOString() : null,
    firstClose: first?.close ?? null,
    lastClose: last?.close ?? null,
    changePercent:
      first && last && first.close !== 0 ? ((last.close - first.close) / first.close) * 100 : null,
    high: candles.length ? high : null,
    low: candles.length ? low : null,
    bars: candles.length,
  };
}

function nearTheMoney(rows: OptionRow[], underlying: number | null, limit = 10): OptionRow[] {
  const valid = rows.filter((r) => r.strike !== null);
  if (underlying === null) return valid.slice(0, limit);
  return [...valid]
    .sort((a, b) => Math.abs((a.strike as number) - underlying) - Math.abs((b.strike as number) - underlying))
    .slice(0, limit)
    .sort((a, b) => (a.strike as number) - (b.strike as number));
}

function formatOptionRows(rows: OptionRow[]) {
  return rows.map((r) => ({
    strike: r.strike,
    last: round(r.lastPrice),
    bid: round(r.bid),
    ask: round(r.ask),
    volume: r.volume,
    openInterest: r.openInterest,
    ivPercent: r.impliedVolatility === null || r.impliedVolatility === undefined ? null : round(r.impliedVolatility * 100, 1),
    inTheMoney: r.inTheMoney,
  }));
}

const tools = [
  {
    name: "get_quote",
    description:
      "Get the current quote, price, change, volume, bid/ask, and basic fundamentals for one stock, ETF, index, or crypto symbol.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "Ticker symbol, e.g. AAPL, SPY, ^VIX, BTC" },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
  },
  {
    name: "get_price_history",
    description:
      "Get recent OHLCV price history for a symbol, plus a compact summary. Use this for chart questions, trends, highs/lows, and performance over a range.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "Ticker symbol" },
        range: {
          type: "string",
          enum: ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"],
          description: "Time range; defaults to 6M",
        },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
  },
  {
    name: "get_option_chain",
    description:
      "Get an option chain summary for a symbol: underlying price, available expirations, and the strikes nearest the money with bid/ask, volume, open interest, IV, and ITM status.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "Underlying ticker symbol" },
        expiry: { type: "string", description: "Optional expiration date in YYYY-MM-DD form" },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
  },
  {
    name: "get_news",
    description:
      "Get recent news headlines for a symbol or for the broad market. Returns title, publisher, published time, and link.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "Optional ticker; omit for market-wide news" },
        limit: { type: "integer", minimum: 1, maximum: 15, description: "Max headlines; defaults to 10" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_insider_transactions",
    description:
      "Get recent SEC Form 4 insider transactions for a symbol: filing date, owner, title, transaction code, shares, price, and value.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "Ticker symbol" },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "Max transactions; defaults to 10" },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
  },
  {
    name: "get_macro_snapshot",
    description:
      "Get the macro dashboard: Treasury yield curve, VIX, major index/commodity proxies, and (for Europe) ECB policy rate and inflation.",
    input_schema: {
      type: "object" as const,
      properties: {
        region: { type: "string", enum: ["us", "eu"], description: "Macro region; defaults to us" },
      },
      additionalProperties: false,
    },
  },
];

export const AI_TOOLS = tools;

export async function executeTool(name: string, input: unknown): Promise<ToolResult> {
  const started = Date.now();
  const finish = (value: unknown, isError = false): ToolResult => ({
    content: isError
      ? JSON.stringify({ error: value instanceof Error ? value.message : String(value) })
      : resultText(value),
    isError,
    execution: { name, input, ok: !isError, durationMs: Date.now() - started },
  });

  try {
    switch (name) {
      case "get_quote": {
        const { symbol } = z.object({ symbol: symbolSchema }).parse(input);
        const quotes = await marketGet<Quote[]>(`/quotes?symbols=${encodeURIComponent(symbol)}`);
        const quote = quotes[0];
        if (!quote) throw new Error(`no quote available for ${symbol}`);
        return finish(quote);
      }

      case "get_price_history": {
        const { symbol, range } = z
          .object({ symbol: symbolSchema, range: rangeSchema.optional() })
          .parse(input);
        const bars = await marketGet<Candle[]>(
          `/history/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range ?? "6M")}`
        );
        if (bars.length === 0) throw new Error(`no price history available for ${symbol}`);
        const candles = bars.slice(-120).map((c) => ({
          time: new Date(c.time * 1000).toISOString(),
          open: round(c.open),
          high: round(c.high),
          low: round(c.low),
          close: round(c.close),
          volume: c.volume,
        }));
        return finish({
          ...historySummary(symbol, range ?? "6M", bars),
          candles,
        });
      }

      case "get_option_chain": {
        const { symbol, expiry } = z
          .object({ symbol: symbolSchema, expiry: expirySchema.optional() })
          .parse(input);
        const chain = await marketGet<OptionChain>(
          `/options/${encodeURIComponent(symbol)}${expiry ? `?expiry=${encodeURIComponent(expiry)}` : ""}`
        );
        return finish({
          symbol: chain.symbol,
          underlyingPrice: round(chain.underlyingPrice),
          selectedDate: chain.selectedDate,
          expirationDates: chain.expirationDates.slice(0, 12),
          calls: formatOptionRows(nearTheMoney(chain.calls, chain.underlyingPrice)),
          puts: formatOptionRows(nearTheMoney(chain.puts, chain.underlyingPrice)),
        });
      }

      case "get_news": {
        const { symbol, limit } = z
          .object({ symbol: symbolSchema.optional(), limit: z.number().int().min(1).max(15).optional() })
          .parse(input);
        const params = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
        const news = await marketGet<NewsItem[]>(`/news${params}`);
        return finish({
          symbol: symbol ?? "market",
          items: news.slice(0, limit ?? 10).map((n) => ({
            title: n.title,
            publisher: n.publisher,
            publishedAt: n.publishedAt,
            link: n.link,
          })),
        });
      }

      case "get_insider_transactions": {
        const { symbol, limit } = z
          .object({ symbol: symbolSchema, limit: z.number().int().min(1).max(20).optional() })
          .parse(input);
        const rows = await marketGet<InsiderTransaction[]>(`/insider/${encodeURIComponent(symbol)}`);
        return finish({
          symbol,
          transactions: rows.slice(0, limit ?? 10).map((r) => ({
            filingDate: r.filingDate,
            transactionDate: r.transactionDate,
            ownerName: r.ownerName,
            ownerTitle: r.ownerTitle,
            transactionCode: r.transactionCode,
            acquiredDisposed: r.acquiredDisposed,
            shares: r.shares,
            pricePerShare: r.pricePerShare,
            value: r.value,
          })),
        });
      }

      case "get_macro_snapshot": {
        const { region } = z
          .object({ region: z.enum(["us", "eu"]).optional() })
          .parse(input);
        const macro = await marketGet<MacroSnapshot>(`/macro?region=${region ?? "us"}`);
        return finish(macro);
      }

      default:
        throw new Error(`unknown tool: ${name}`);
    }
  } catch (err) {
    return finish(err, true);
  }
}
