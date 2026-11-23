import type { Candle, Quote } from "./yahoo.js";

// A hung upstream must fail fast into the fallback/stale-cache path rather
// than blocking the fallback chain for minutes (Node's fetch has no default
// timeout). Overridable so tests can assert fast failure without real waits.
const FETCH_TIMEOUT_MS = Number(process.env.PROVIDER_FETCH_TIMEOUT_MS) || 9000;

/** Map a Yahoo-style symbol to Stooq's convention (US equities get a .us suffix). */
function stooqSymbol(symbol: string): string {
  const s = symbol.toLowerCase();
  if (s.startsWith("^")) return s; // indexes share the caret convention
  if (s.includes(".") || s.includes("=") || s.includes("-")) return s;
  return s + ".us";
}

// stooq.com has been observed fully network-unreachable at the TCP layer
// (connection attempts to both of its IPs time out) for extended stretches.
// Unlike Yahoo's 429 cooldown, the trigger here is the fetch itself failing
// to connect at all — not a successful response with a bad status — so once
// that happens repeatedly we fail fast instead of paying the full
// FETCH_TIMEOUT_MS tax on every request while it's down. Shared across every
// call site below since a network-level failure to reach stooq.com affects
// the whole host, not one endpoint.
let cooldownUntil = 0;
let consecutiveFailures = 0;

async function sfetch(url: string): Promise<Response> {
  if (Date.now() < cooldownUntil) {
    throw new Error("stooq: skipping request (cooling down after repeated failures)");
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    consecutiveFailures = 0;
    cooldownUntil = 0;
    return res;
  } catch (err) {
    consecutiveFailures++;
    cooldownUntil = Date.now() + Math.min(30_000 * consecutiveFailures, 5 * 60_000);
    throw err;
  }
}

export async function history(symbol: string): Promise<Candle[]> {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol(symbol))}&i=d`;
  const res = await sfetch(url);
  if (!res.ok) throw new Error(`stooq ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split("\n");
  if (lines.length < 2 || !lines[0].startsWith("Date")) throw new Error("stooq: no data for " + symbol);
  const candles: Candle[] = [];
  for (const line of lines.slice(1)) {
    const [date, open, high, low, close, volume] = line.split(",");
    const t = Date.parse(date + "T00:00:00Z") / 1000;
    const [o, h, l, c] = [+open, +high, +low, +close];
    if (!isFinite(t) || !isFinite(c)) continue;
    candles.push({ time: t, open: o, high: h, low: l, close: c, volume: +volume || 0 });
  }
  return candles;
}

export async function quote(symbol: string): Promise<Quote> {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol(symbol))}&f=sd2t2ohlcv&h&e=csv`;
  const res = await sfetch(url);
  if (!res.ok) throw new Error(`stooq ${res.status}`);
  const lines = (await res.text()).trim().split("\n");
  if (lines.length < 2) throw new Error("stooq: empty quote");
  const [sym, , , open, high, low, close, volume] = lines[1].split(",");
  const price = +close;
  if (!isFinite(price)) throw new Error("stooq: no quote for " + symbol);
  return {
    symbol: symbol.toUpperCase(),
    name: sym,
    price,
    change: null,
    changePercent: null,
    open: +open || null,
    high: +high || null,
    low: +low || null,
    previousClose: null,
    bid: null,
    ask: null,
    volume: +volume || null,
    avgVolume: null,
    marketCap: null,
    pe: null,
    eps: null,
    dividendYield: null,
    week52High: null,
    week52Low: null,
    beta: null,
    sharesOutstanding: null,
    currency: null,
    exchange: "Stooq",
    marketState: null,
    time: null,
    source: "stooq",
  };
}
