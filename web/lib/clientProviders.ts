// Direct-from-browser data fetching, used only by the static GitHub Pages
// build (see demoMode.ts) where there is no Express backend to proxy through.
// Only upstreams that send permissive CORS headers can be called this way —
// CoinGecko, Binance, and TradingView's public scanner/search all do; Nasdaq,
// Yahoo, and FRED don't, so stock history/options/macro throw a clear error
// here instead of silently failing.

import type { Quote, Candle } from "./api";

const TV_SCAN_URL = "https://scanner.tradingview.com/america/scan";
const TV_SEARCH_URL = "https://symbol-search.tradingview.com/symbol_search/v3/";

async function tvScan(body: object): Promise<Array<{ s: string; d: any[] }>> {
  // No explicit Content-Type: TradingView's CORS preflight only allows
  // `Referer, Accept`, not `Content-Type`, so setting it to application/json
  // would make this a "non-simple" request and the browser would block it
  // before it's even sent. Letting fetch default to text/plain (CORS-safelisted)
  // skips the preflight entirely; the server parses the JSON body regardless.
  const res = await fetch(TV_SCAN_URL, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TradingView scan failed (${res.status})`);
  const json = await res.json();
  return json?.data ?? [];
}

const QUOTE_COLUMNS = [
  "name", "close", "change", "change_abs", "open", "high", "low", "volume",
  "market_cap_basic", "price_earnings_ttm", "earnings_per_share_basic_ttm",
  "dividends_yield_current", "beta_1_year", "total_shares_outstanding",
  "exchange", "price_52_week_high", "price_52_week_low",
];

function rowToQuote(row: { s: string; d: any[] }): Quote {
  const [
    name, close, changePercent, change, open, high, low, volume,
    marketCap, pe, eps, divYield, beta, shares, exchange, week52High, week52Low,
  ] = row.d;
  const symbol = row.s.split(":")[1];
  return {
    symbol,
    name: name ?? symbol,
    price: close ?? null,
    change: change ?? null,
    changePercent: changePercent ?? null,
    open: open ?? null,
    high: high ?? null,
    low: low ?? null,
    previousClose: close !== null && change !== null ? close - change : null,
    bid: null,
    ask: null,
    volume: volume ?? null,
    avgVolume: null,
    marketCap: marketCap ?? null,
    pe: pe ?? null,
    eps: eps ?? null,
    dividendYield: divYield !== null && divYield !== undefined ? divYield / 100 : null,
    week52High: week52High ?? null,
    week52Low: week52Low ?? null,
    beta: beta ?? null,
    sharesOutstanding: shares ?? null,
    currency: "USD",
    exchange: exchange ?? null,
    marketState: null,
    source: "tradingview",
  };
}

export async function quotes(symbols: string[]): Promise<Quote[]> {
  const rows = await tvScan({
    columns: QUOTE_COLUMNS,
    filter: [
      { left: "type", operation: "equal", right: "stock" },
      { left: "typespecs", operation: "has", right: ["common"] },
      { left: "name", operation: "in_range", right: symbols },
    ],
    range: [0, symbols.length],
  });
  return rows.map(rowToQuote);
}

export type SearchResult = { symbol: string; name: string; exchange: string; type: string };

export async function search(query: string): Promise<SearchResult[]> {
  const url = `${TV_SEARCH_URL}?text=${encodeURIComponent(query)}&hl=1&lang=en&search_type=undefined&domain=production&sort_by_country=US`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TradingView search failed (${res.status})`);
  const json = await res.json();
  const rows: any[] = json?.symbols ?? [];
  const strip = (s: string) => s.replace(/<\/?em>/g, "");
  return rows
    .filter((r) => ["stock", "fund", "dr"].includes(r.type))
    .slice(0, 15)
    .map((r) => ({ symbol: strip(r.symbol), name: strip(r.description ?? r.symbol), exchange: r.exchange ?? "", type: r.type ?? "" }));
}

export type MarketRow = {
  symbol: string; name: string; price: number | null; changePercent: number | null;
  volume: number | null; marketCap: number | null; sector: string;
};

export async function marketScan(limit = 1500): Promise<MarketRow[]> {
  const rows = await tvScan({
    columns: ["description", "close", "change", "market_cap_basic", "sector", "volume", "exchange"],
    filter: [
      { left: "type", operation: "equal", right: "stock" },
      { left: "typespecs", operation: "has", right: ["common"] },
    ],
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
    range: [0, limit],
  });
  return rows
    .map((r) => {
      const [name, close, change, marketCap, sector, volume, exchange] = r.d;
      return {
        symbol: r.s.split(":")[1],
        name: name ?? r.s.split(":")[1],
        price: close ?? null,
        changePercent: change ?? null,
        marketCap: marketCap ?? null,
        sector: sector || "Other",
        volume: volume ?? null,
        exchange: exchange ?? "",
      };
    })
    .filter((r) => r.symbol && r.exchange !== "OTC");
}

// ---- crypto (CoinGecko primary, Binance fallback — both CORS-open) ----

export type CryptoRow = {
  id: string; symbol: string; name: string; price: number;
  changePercent24h: number | null; marketCap: number | null; volume24h: number | null;
  rank: number | null; sparkline: number[];
};

export async function cryptoMarkets(): Promise<CryptoRow[]> {
  const url =
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=true&price_change_percentage=24h";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko failed (${res.status})`);
  const rows: any[] = await res.json();
  return rows.map((r) => ({
    id: r.id,
    symbol: (r.symbol ?? "").toUpperCase(),
    name: r.name,
    price: r.current_price,
    changePercent24h: r.price_change_percentage_24h ?? null,
    marketCap: r.market_cap ?? null,
    volume24h: r.total_volume ?? null,
    rank: r.market_cap_rank ?? null,
    sparkline: r.sparkline_in_7d?.price ?? [],
  }));
}

export async function cryptoGlobal(): Promise<{ totalMarketCap: number; btcDominance: number; ethDominance: number }> {
  const res = await fetch("https://api.coingecko.com/api/v3/global");
  if (!res.ok) throw new Error(`CoinGecko failed (${res.status})`);
  const d = (await res.json())?.data;
  return {
    totalMarketCap: d?.total_market_cap?.usd ?? 0,
    btcDominance: d?.market_cap_percentage?.btc ?? 0,
    ethDominance: d?.market_cap_percentage?.eth ?? 0,
  };
}

const CRYPTO_SYMBOLS = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "DOT", "LINK", "LTC", "MATIC"]);

export function isCryptoSymbol(symbol: string): boolean {
  return CRYPTO_SYMBOLS.has(symbol.toUpperCase());
}

const RANGE_TO_KLINE: Record<string, { interval: string; limit: number }> = {
  "1D": { interval: "5m", limit: 288 },
  "5D": { interval: "15m", limit: 480 },
  "1M": { interval: "1h", limit: 720 },
  "6M": { interval: "4h", limit: 1080 },
  YTD: { interval: "1d", limit: 400 },
  "1Y": { interval: "1d", limit: 365 },
  "5Y": { interval: "1w", limit: 260 },
  MAX: { interval: "1M", limit: 200 },
};

export async function cryptoHistory(symbol: string, rangeKey: string): Promise<Candle[]> {
  const { interval, limit } = RANGE_TO_KLINE[rangeKey] ?? RANGE_TO_KLINE["6M"];
  const pair = symbol.toUpperCase() + "USDT";
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Binance failed (${res.status})`);
  const rows: any[] = await res.json();
  return rows.map((r) => ({ time: Math.round(r[0] / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] }));
}
