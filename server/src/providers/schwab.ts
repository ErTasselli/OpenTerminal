import type { Quote, Candle } from "./yahoo.js";
import { schwabGet, isSchwabConfigured } from "./schwabAuth.js";

// Schwab Market Data API adapter. Every call is optional: if Schwab is not
// configured or the account lacks a market-data entitlement, callers fall
// back to the existing public providers.

export type SearchResult = { symbol: string; name: string; exchange: string; type: string };

type SchwabQuoteResponse = {
  symbol?: string;
  quote?: Record<string, unknown>;
  fundamental?: Record<string, unknown>;
  reference?: Record<string, unknown>;
  regular?: Record<string, unknown>;
};

type SchwabCandle = {
  datetime?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
};

type SchwabInstrument = {
  symbol?: string;
  description?: string;
  exchange?: string;
  assetType?: string;
};

type SchwabOptionContract = {
  strikePrice?: number;
  last?: number;
  bid?: number;
  ask?: number;
  totalVolume?: number;
  openInterest?: number;
  volatility?: number;
  inTheMoney?: boolean;
};

type SchwabOptionChain = {
  symbol?: string;
  underlyingPrice?: number;
  underlying?: { last?: number };
  callExpDateMap?: Record<string, Record<string, SchwabOptionContract[]>>;
  putExpDateMap?: Record<string, Record<string, SchwabOptionContract[]>>;
};

export type SchwabOptionRow = {
  strike: number | null;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  inTheMoney: boolean;
};

export type SchwabChain = {
  symbol: string;
  underlyingPrice: number | null;
  expirationDates: string[];
  selectedDate: string | null;
  calls: SchwabOptionRow[];
  puts: SchwabOptionRow[];
};

export type SchwabMover = {
  symbol: string;
  description: string;
  last: number | null;
  change: number | null;
  totalVolume: number | null;
  direction: string | null;
};

const EXCHANGE_NAMES: Record<string, string> = {
  A: "NYSE American",
  B: "Nasdaq BX",
  C: "Cboe",
  D: "FINRA ADF",
  I: "ISE",
  N: "NYSE",
  P: "NYSE Arca",
  Q: "NASDAQ",
  S: "Consolidated",
  T: "Nasdaq TRF",
  U: "Nasdaq TRF",
  V: "IEX",
  W: "Cboe C2",
  X: "Nasdaq PSX",
  Y: "BATS",
  Z: "Cboe BZX",
};

const SEARCHABLE_ASSETS = new Set(["EQUITY", "ETF", "INDEX", "MUTUAL_FUND", "COLLECTIVE_INVESTMENT"]);

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function textField(record: Record<string, unknown> | undefined, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function numberField(record: Record<string, unknown> | undefined, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = num(record?.[key]);
    if (value !== null) return value;
  }
  return null;
}

// A revoked token or missing entitlement would otherwise make every widget
// retry Schwab before falling back, adding latency to every request. Pause
// the provider briefly for auth/rate-limit errors, but not for symbol-level
// misses (404) which should fall through immediately.
let cooldownUntil = 0;

export function isSchwabEnabled(): boolean {
  return isSchwabConfigured() && Date.now() >= cooldownUntil;
}

async function get<T>(path: string): Promise<T> {
  try {
    return await schwabGet<T>(path);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/^schwab (401|403|429)\b/.test(message)) {
      cooldownUntil = Date.now() + 60_000;
    }
    throw err;
  }
}

export function mapSchwabQuote(symbol: string, raw: SchwabQuoteResponse): Quote {
  const quote = raw.quote;
  const regular = raw.regular;
  const fundamental = raw.fundamental;
  const reference = raw.reference;

  const price = numberField(quote, "lastPrice") ?? numberField(regular, "regularMarketLastPrice");
  const previousClose = numberField(quote, "closePrice");
  const netChange = numberField(quote, "netChange");
  const netPercent = numberField(quote, "netPercentChange");
  const change =
    netChange ?? (price !== null && previousClose !== null ? price - previousClose : null);
  const changePercent =
    netPercent ??
    (change !== null && previousClose ? (change / previousClose) * 100 : null);

  const divYield = numberField(fundamental, "divYield");
  const quoteTime = numberField(quote, "quoteTime");
  const exchangeCode = textField(reference, "exchange");
  const sharesOutstanding = numberField(fundamental, "sharesOutstanding");
  // Schwab's quote payload does not always include a market cap; derive it
  // from shares outstanding when possible.
  const marketCap =
    numberField(fundamental, "marketCap") ??
    (sharesOutstanding !== null && price !== null ? sharesOutstanding * price : null);

  return {
    symbol: textField(reference, "symbol") ?? raw.symbol ?? symbol,
    name: textField(reference, "description") ?? null,
    price,
    change,
    changePercent,
    open: numberField(quote, "openPrice"),
    high: numberField(quote, "highPrice"),
    low: numberField(quote, "lowPrice"),
    previousClose,
    bid: numberField(quote, "bidPrice"),
    ask: numberField(quote, "askPrice"),
    volume: numberField(quote, "totalVolume"),
    avgVolume: numberField(fundamental, "avg10DaysVolume"),
    marketCap,
    pe: numberField(fundamental, "peRatio"),
    eps: numberField(fundamental, "eps"),
    // Schwab reports dividend yield as a percentage (e.g. 0.44 for 0.44%);
    // the rest of the app stores it as a fraction for consistent formatting.
    dividendYield: divYield === null ? null : divYield / 100,
    week52High: numberField(quote, "52WeekHigh"),
    week52Low: numberField(quote, "52WeekLow"),
    beta: numberField(fundamental, "beta"),
    sharesOutstanding,
    currency: "USD",
    exchange: textField(reference, "exchangeName") ?? (exchangeCode ? EXCHANGE_NAMES[exchangeCode] ?? exchangeCode : null),
    marketState: null,
    time: quoteTime === null ? null : Math.round(quoteTime / 1000),
    source: "schwab",
  };
}

export async function quotes(symbols: string[]): Promise<Quote[]> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (unique.length === 0) return [];

  const params = new URLSearchParams({
    symbols: unique.join(","),
    fields: "quote,fundamental,reference,regular",
    indicative: "false",
  });
  const json = await get<Record<string, SchwabQuoteResponse>>(
    `/marketdata/v1/quotes?${params.toString()}`
  );

  const out: Quote[] = [];
  for (const [key, raw] of Object.entries(json ?? {})) {
    if (!raw || typeof raw !== "object" || (raw as { error?: string }).error) continue;
    out.push(mapSchwabQuote(key, raw));
  }
  return out;
}

export async function quote(symbol: string): Promise<Quote> {
  const [first] = await quotes([symbol]);
  if (!first) throw new Error(`schwab: no quote for ${symbol}`);
  return first;
}

type RangeSpec = {
  periodType: "day" | "month" | "year" | "ytd";
  period: number;
  frequencyType: "minute" | "daily" | "weekly" | "monthly";
  frequency: number;
  extended: boolean;
};

const RANGE_SPEC: Record<string, RangeSpec> = {
  "1D": { periodType: "day", period: 1, frequencyType: "minute", frequency: 5, extended: true },
  "5D": { periodType: "day", period: 5, frequencyType: "minute", frequency: 15, extended: true },
  "1M": { periodType: "month", period: 1, frequencyType: "daily", frequency: 1, extended: false },
  "6M": { periodType: "month", period: 6, frequencyType: "daily", frequency: 1, extended: false },
  YTD: { periodType: "ytd", period: 1, frequencyType: "daily", frequency: 1, extended: false },
  "1Y": { periodType: "year", period: 1, frequencyType: "daily", frequency: 1, extended: false },
  "5Y": { periodType: "year", period: 5, frequencyType: "weekly", frequency: 1, extended: false },
  MAX: { periodType: "year", period: 20, frequencyType: "monthly", frequency: 1, extended: false },
};

export function mapSchwabCandles(candles: SchwabCandle[] | undefined): Candle[] {
  const out: Candle[] = [];
  for (const c of candles ?? []) {
    const datetime = num(c.datetime);
    const open = num(c.open);
    const high = num(c.high);
    const low = num(c.low);
    const close = num(c.close);
    if (datetime === null || open === null || high === null || low === null || close === null) continue;
    out.push({
      time: Math.round(datetime / 1000),
      open,
      high,
      low,
      close,
      volume: num(c.volume) ?? 0,
    });
  }
  return out;
}

export async function history(symbol: string, rangeKey: string): Promise<Candle[]> {
  const spec = RANGE_SPEC[rangeKey] ?? RANGE_SPEC["6M"];
  const params = new URLSearchParams({
    symbol,
    periodType: spec.periodType,
    period: String(spec.period),
    frequencyType: spec.frequencyType,
    frequency: String(spec.frequency),
    needExtendedHoursData: String(spec.extended),
    needPreviousClose: "true",
  });
  const json = await get<{ candles?: SchwabCandle[]; empty?: boolean }>(
    `/marketdata/v1/pricehistory?${params.toString()}`
  );
  return mapSchwabCandles(json.candles);
}

function mapOptionContract(raw: SchwabOptionContract): SchwabOptionRow {
  const volatility = num(raw.volatility);
  return {
    strike: num(raw.strikePrice),
    lastPrice: num(raw.last),
    bid: num(raw.bid),
    ask: num(raw.ask),
    volume: num(raw.totalVolume),
    openInterest: num(raw.openInterest),
    // Schwab reports volatility as a percentage; the UI expects a fraction.
    impliedVolatility: volatility === null ? null : volatility / 100,
    inTheMoney: Boolean(raw.inTheMoney),
  };
}

function contractsForDate(
  map: Record<string, Record<string, SchwabOptionContract[]>> | undefined,
  date: string | null
): SchwabOptionRow[] {
  if (!map || !date) return [];
  const entry = Object.entries(map).find(([key]) => key.split(":")[0] === date);
  if (!entry) return [];
  return Object.values(entry[1])
    .flat()
    .map(mapOptionContract)
    .filter((row) => row.strike !== null);
}

export function mapSchwabOptionChain(
  symbol: string,
  raw: SchwabOptionChain,
  requestedExpiry?: string
): SchwabChain {
  const dates = [
    ...new Set([
      ...Object.keys(raw.callExpDateMap ?? {}).map((k) => k.split(":")[0]),
      ...Object.keys(raw.putExpDateMap ?? {}).map((k) => k.split(":")[0]),
    ]),
  ].sort();

  const selectedDate = requestedExpiry && dates.includes(requestedExpiry)
    ? requestedExpiry
    : dates[0] ?? null;

  return {
    symbol: raw.symbol ?? symbol,
    underlyingPrice: num(raw.underlyingPrice) ?? num(raw.underlying?.last),
    expirationDates: dates,
    selectedDate,
    calls: contractsForDate(raw.callExpDateMap, selectedDate),
    puts: contractsForDate(raw.putExpDateMap, selectedDate),
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function optionChain(symbol: string, expiry?: string): Promise<SchwabChain> {
  const today = new Date();
  const from = expiry ?? isoDate(today);
  const to = expiry ?? isoDate(new Date(today.getTime() + 90 * 86_400_000));
  const params = new URLSearchParams({
    symbol,
    contractType: "ALL",
    strikeCount: "50",
    includeUnderlyingQuote: "true",
    strategy: "SINGLE",
    fromDate: from,
    toDate: to,
  });
  const json = await get<SchwabOptionChain>(`/marketdata/v1/chains?${params.toString()}`);
  return mapSchwabOptionChain(symbol, json, expiry);
}

export function mapSchwabSearch(raw: Record<string, SchwabInstrument>): SearchResult[] {
  return Object.entries(raw ?? {})
    .filter(([, value]) => value && typeof value === "object")
    .map(([symbol, value]) => ({
      symbol: value.symbol ?? symbol,
      name: value.description ?? value.symbol ?? symbol,
      exchange: (value.exchange && EXCHANGE_NAMES[value.exchange]) || value.exchange || "",
      type: value.assetType ?? "",
    }))
    .filter((row) => row.symbol && (!row.type || SEARCHABLE_ASSETS.has(row.type.toUpperCase())))
    .slice(0, 15);
}

export async function search(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  // Short inputs are usually tickers, longer ones are usually names. Try the
  // likely projection first, then the other one before giving up to the public
  // search provider.
  const projections = q.length <= 5 ? ["symbol-search", "desc-search"] : ["desc-search", "symbol-search"];
  for (const projection of projections) {
    const params = new URLSearchParams({ symbol: q, projection });
    const json = await get<Record<string, SchwabInstrument>>(
      `/marketdata/v1/instruments?${params.toString()}`
    );
    const rows = mapSchwabSearch(json);
    if (rows.length > 0) return rows;
  }
  return [];
}

export async function movers(
  index = "$SPX",
  sort: "VOLUME" | "TRADES" | "PERCENT_CHANGE_UP" | "PERCENT_CHANGE_DOWN" = "PERCENT_CHANGE_UP"
): Promise<SchwabMover[]> {
  const params = new URLSearchParams({ sort, frequency: "0" });
  const json = await get<{ screeners?: Array<Record<string, unknown>> }>(
    `/marketdata/v1/movers/${encodeURIComponent(index)}?${params.toString()}`
  );
  return (json.screeners ?? []).map((row) => ({
    symbol: String(row.symbol ?? ""),
    description: String(row.description ?? ""),
    last: num(row.last),
    change: num(row.change),
    totalVolume: num(row.totalVolume),
    direction: typeof row.direction === "string" ? row.direction : null,
  }));
}

export async function marketHours(
  markets: string[] = ["equity", "option", "future", "bond", "forex"],
  date?: string
): Promise<unknown> {
  const params = new URLSearchParams({ markets: markets.join(",") });
  if (date) params.set("date", date);
  return schwabGet(`/marketdata/v1/markets?${params.toString()}`);
}
