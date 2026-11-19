// The AI assistant's quote-lookup and options-chain-lookup Tool Calls: thin wrappers
// around the exact fetch logic GET /api/quotes and GET /api/options/:symbol already
// use (routes/market.ts's getQuotes/getOptionChain, each its own nasdaq/yahoo/stooq
// provider-fallback waterfall), mirroring tools.ts's search_news (which reuses
// providers/news.ts the same way) rather than inventing a second way to fetch market
// data. Unlike Positions/Watchlist -- auto-injected as context every turn, per
// CONTEXT.md's Tool Call glossary entry -- these tools let the model look up any
// *arbitrary* symbol on demand while researching, not just the user's own holdings.
import { getQuotes, getOptionChain } from "../routes/market.js";
import type { NasdaqChain } from "../providers/nasdaq.js";
import type { Quote } from "../providers/yahoo.js";
import type { ToolDef } from "./types.js";

export const GET_QUOTE_TOOL: ToolDef = {
  name: "get_quote",
  description:
    "Look up a live quote (price, change, volume, and fundamentals where available) for a single stock, ETF, or " +
    "crypto ticker symbol. Use this to ground research in current market data for any symbol -- the user's own " +
    "positions and watchlist are already shared as context, so this is for looking up other symbols on demand.",
  parameters: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Ticker symbol to look up, e.g. AAPL." },
    },
    required: ["symbol"],
  },
};

export type GetQuoteResult = { ok: true; quote: Quote } | { ok: false; error: string };

/** Executes the get_quote tool call: resolve one symbol through the shared getQuotes waterfall. */
export async function runGetQuoteTool(args: Record<string, unknown>): Promise<GetQuoteResult> {
  const symbol = typeof args.symbol === "string" && args.symbol.trim() ? args.symbol.trim().toUpperCase() : "";
  if (!symbol) return { ok: false, error: "symbol is required" };

  const [quote] = await getQuotes([symbol]);
  if (!quote) return { ok: false, error: `no quote data found for "${symbol}"` };
  return { ok: true, quote };
}

export const GET_OPTION_CHAIN_TOOL: ToolDef = {
  name: "get_option_chain",
  description:
    "Look up the options chain (calls/puts with strike, bid/ask, last price, volume, and open interest) for a " +
    "single underlying ticker symbol, for one expiration date. Omit expiry to get the nearest available " +
    "expiration; the result's expirationDates lists the other dates available for a follow-up call.",
  parameters: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Underlying ticker symbol, e.g. AAPL." },
      expiry: {
        type: "string",
        description: "Optional expiration date (YYYY-MM-DD), from a previous call's expirationDates. Omit for the nearest expiration.",
      },
    },
    required: ["symbol"],
  },
};

export type GetOptionChainResult = { ok: true; chain: NasdaqChain } | { ok: false; error: string };

/** Executes the get_option_chain tool call: resolve one symbol's chain through the shared getOptionChain waterfall. */
export async function runGetOptionChainTool(args: Record<string, unknown>): Promise<GetOptionChainResult> {
  const symbol = typeof args.symbol === "string" && args.symbol.trim() ? args.symbol.trim().toUpperCase() : "";
  if (!symbol) return { ok: false, error: "symbol is required" };
  const expiry = typeof args.expiry === "string" && args.expiry.trim() ? args.expiry.trim() : undefined;

  try {
    const chain = await getOptionChain(symbol, expiry);
    return { ok: true, chain };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
