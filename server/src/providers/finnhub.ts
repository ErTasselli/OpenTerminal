import type { Candle, Quote } from "./yahoo.js";

// Same pattern as every other provider module: a hung upstream must fail fast
// into the fallback chain rather than blocking it for minutes.
const FETCH_TIMEOUT_MS = Number(process.env.PROVIDER_FETCH_TIMEOUT_MS) || 9000;

/**
 * Finnhub requires a token on every request (query param or header). Unlike the
 * keyless providers in this directory, a missing key here can't be a silent
 * no-op — withFallback()/tracked() (see registry.ts) already treat a thrown
 * error as "this provider failed, try the next one" and record it as
 * lastError, so throwing a descriptive, env-var-naming error *is* the correct
 * signal, surfaced in tracked()'s stats and in logs.
 */
function requireApiKey(): string {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("finnhub: FINNHUB_API_KEY not set");
  return key;
}

const n = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

export async function quote(symbol: string): Promise<Quote> {
  const key = requireApiKey();
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`finnhub ${res.status} for ${symbol}`);
  const d: any = await res.json();
  // Finnhub's documented "no data" shape for an unknown symbol: every field 0.
  if (!d || (d.c === 0 && d.d === 0 && d.dp === 0 && d.h === 0 && d.l === 0 && d.o === 0 && d.pc === 0)) {
    throw new Error("finnhub: no quote data for " + symbol);
  }
  return {
    symbol,
    name: null,
    price: n(d.c),
    change: n(d.d),
    changePercent: n(d.dp),
    open: n(d.o),
    high: n(d.h),
    low: n(d.l),
    previousClose: n(d.pc),
    bid: null,
    ask: null,
    volume: null,
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
    exchange: null,
    marketState: null,
    time: n(d.t),
    source: "finnhub",
  };
}

// Analogous to yahooRange() in routes/market.ts: maps this app's range keys to
// a Finnhub candle resolution plus a from/to unix-seconds window.
const DAY = 24 * 60 * 60;
function finnhubRange(rangeKey: string): { resolution: string; fromSeconds: number } {
  const map: Record<string, { resolution: string; fromSeconds: number }> = {
    "1D": { resolution: "5", fromSeconds: DAY },
    "5D": { resolution: "15", fromSeconds: 5 * DAY },
    "1M": { resolution: "60", fromSeconds: 31 * DAY },
    "6M": { resolution: "D", fromSeconds: 183 * DAY },
    YTD: { resolution: "D", fromSeconds: 366 * DAY },
    "1Y": { resolution: "D", fromSeconds: 366 * DAY },
    "5Y": { resolution: "W", fromSeconds: 5 * 366 * DAY },
    MAX: { resolution: "M", fromSeconds: 20 * 366 * DAY },
  };
  return map[rangeKey] ?? map["6M"];
}

export async function history(symbol: string, rangeKey: string): Promise<Candle[]> {
  const key = requireApiKey();
  const { resolution, fromSeconds } = finnhubRange(rangeKey);
  const to = Math.floor(Date.now() / 1000);
  const from = to - fromSeconds;
  const url =
    `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}` +
    `&resolution=${encodeURIComponent(resolution)}&from=${from}&to=${to}&token=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`finnhub ${res.status} for ${symbol}`);
  const d: any = await res.json();
  if (!d || d.s !== "ok" || !d.t?.length || !d.o?.length || !d.h?.length || !d.l?.length || !d.c?.length) {
    throw new Error(`finnhub: no candle data for ${symbol} (${d?.s ?? "unknown"})`);
  }
  const candles: Candle[] = [];
  for (let i = 0; i < d.t.length; i++) {
    candles.push({
      time: d.t[i],
      open: d.o[i],
      high: d.h[i],
      low: d.l[i],
      close: d.c[i],
      volume: d.v?.[i] ?? 0,
    });
  }
  return candles;
}
