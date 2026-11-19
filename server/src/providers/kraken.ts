import type { CryptoRow } from "./coingecko.js";

const FETCH_TIMEOUT_MS = Number(process.env.PROVIDER_FETCH_TIMEOUT_MS) || 9000;

/**
 * Our plain tickers (BTC, ETH, ...) mapped to the pair symbol used to request
 * Kraken's public Ticker endpoint. Mirrors binance.ts's NAMES coverage, minus
 * MATIC — Kraken has no `MATICUSD` pair (Polygon's token was renamed to POL,
 * traded there as `POLUSD`, a different symbol than this app tracks), and
 * requesting even one truly-unknown pair name makes Kraken return a
 * non-empty `error` array for the *entire* batch response (verified against
 * the live API), which would fail this whole tier. BNB, by contrast, is
 * confirmed live on Kraken as `BNBUSD` and is kept.
 */
const PAIR_REQUESTS: Record<string, string> = {
  BTC: "XBTUSD",
  ETH: "ETHUSD",
  SOL: "SOLUSD",
  BNB: "BNBUSD",
  XRP: "XRPUSD",
  ADA: "ADAUSD",
  DOGE: "XDGUSD",
  AVAX: "AVAXUSD",
  DOT: "DOTUSD",
  LINK: "LINKUSD",
  LTC: "LTCUSD",
};

const NAMES: Record<string, string> = {
  BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", BNB: "BNB", XRP: "XRP", ADA: "Cardano",
  DOGE: "Dogecoin", AVAX: "Avalanche", DOT: "Polkadot", LINK: "Chainlink", LTC: "Litecoin",
};

/**
 * Kraken renames some legacy pairs in its Ticker response (e.g. a request for
 * `XBTUSD` comes back keyed as `XXBTZUSD`). Map those known renamed keys back
 * to our ticker so result entries can be matched up without re-indexing by
 * the original request pair string.
 */
const RESULT_KEY_ALIASES: Record<string, string> = {
  XXBTZUSD: "BTC",
  XETHZUSD: "ETH",
  XXRPZUSD: "XRP",
  XXDGZUSD: "DOGE",
  XLTCZUSD: "LTC",
};

function resolveSymbol(resultKey: string): string | undefined {
  if (RESULT_KEY_ALIASES[resultKey]) return RESULT_KEY_ALIASES[resultKey];
  for (const [symbol, pair] of Object.entries(PAIR_REQUESTS)) {
    if (pair === resultKey) return symbol;
  }
  return undefined;
}

/** Fallback crypto board built from Kraken's public Ticker endpoint (no key required). */
export async function markets(): Promise<CryptoRow[]> {
  const pairs = Object.values(PAIR_REQUESTS).join(",");
  const url = `https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(pairs)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`kraken ${res.status}`);

  const body: any = await res.json();
  if (Array.isArray(body?.error) && body.error.length > 0) {
    throw new Error(`kraken error: ${body.error.join(", ")}`);
  }

  const result = body?.result ?? {};
  const rows: CryptoRow[] = [];
  for (const [key, ticker] of Object.entries<any>(result)) {
    const symbol = resolveSymbol(key);
    if (!symbol) continue; // a pair we didn't request, or Kraken simply skipped it — not an error
    try {
      const close = +ticker.c[0];
      const open = +ticker.o;
      rows.push({
        id: key,
        symbol,
        name: NAMES[symbol] ?? symbol,
        price: close,
        changePercent24h: open ? ((close - open) / open) * 100 : null,
        marketCap: null,
        volume24h: +ticker.v[1],
        rank: null,
        sparkline: [],
      });
    } catch {
      // A single malformed/incomplete ticker entry (e.g. missing c/o/v) shouldn't
      // discard every other row already parsed from the same response.
    }
  }
  return rows;
}
