import type { Quote, Candle } from "./yahoo.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const HEADERS = { "User-Agent": UA, Accept: "application/json", Origin: "https://www.nasdaq.com" };

// Polite concurrency limiter — Nasdaq's public API has no documented limit,
// but we stay gentle to avoid tripping bot-detection under bursty load.
const MAX_CONCURRENT = 6;
let active = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
}
function release(): void {
  active--;
  waiters.shift()?.();
}

async function nfetch(url: string): Promise<any> {
  await acquire();
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`nasdaq ${res.status} for ${url}`);
    const json = await res.json();
    if (!json?.data) throw new Error(`nasdaq: no data in response for ${url}`);
    return json.data;
  } finally {
    release();
  }
}

const money = (s: unknown): number | null => {
  if (typeof s !== "string") return null;
  const n = Number(s.replace(/[$,]/g, ""));
  return isFinite(n) ? n : null;
};

function assetClassOf(symbol: string): "stocks" | "etf" {
  // Heuristic: most well-known ETF tickers used across the app; falls back to "stocks".
  const etfs = new Set(["SPY", "DIA", "QQQ", "GLD", "USO", "UUP", "IWM", "VTI", "TLT"]);
  return etfs.has(symbol) ? "etf" : "stocks";
}

export async function quote(symbol: string): Promise<Quote> {
  const assetclass = assetClassOf(symbol);
  const [info, summary] = await Promise.all([
    nfetch(`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=${assetclass}`),
    nfetch(`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary?assetclass=${assetclass}`).catch(() => null),
  ]);

  const price = money(info.primaryData?.lastSalePrice);
  const prevClose = money(info.primaryData?.previousClose) ?? money(summary?.summaryData?.PreviousClose?.value);
  const change = money(info.primaryData?.netChange);
  const pctChange = typeof info.primaryData?.percentageChange === "string"
    ? Number(info.primaryData.percentageChange.replace(/[%+]/g, ""))
    : null;

  const [dayLow, dayHigh] = (info.keyStats?.dayrange?.value ?? "").split(" - ").map((s: string) => money(s));
  const [wLow, wHigh] = (info.keyStats?.fiftyTwoWeekHighLow?.value ?? "").split(" - ").map((s: string) => money(s));

  const marketCap = money(summary?.summaryData?.MarketCap?.value?.replace(/,/g, ""));
  const avgVolume = money(summary?.summaryData?.AverageVolume?.value?.replace(/,/g, ""));
  const yieldPct = summary?.summaryData?.Yield?.value ? Number(String(summary.summaryData.Yield.value).replace("%", "")) : null;

  return {
    symbol,
    name: info.companyName ?? null,
    price,
    change,
    changePercent: isFinite(pctChange as number) ? pctChange : null,
    open: null,
    high: dayHigh ?? null,
    low: dayLow ?? null,
    previousClose: prevClose,
    bid: money(info.primaryData?.bidPrice),
    ask: money(info.primaryData?.askPrice),
    volume: money(String(info.primaryData?.volume ?? "").split(".")[0]),
    avgVolume,
    marketCap,
    pe: null,
    eps: null,
    dividendYield: yieldPct !== null ? yieldPct / 100 : null,
    week52High: wHigh ?? null,
    week52Low: wLow ?? null,
    beta: null,
    sharesOutstanding: null,
    currency: "USD",
    exchange: info.exchange ?? null,
    marketState: info.marketStatus ?? null,
    time: null,
    source: "nasdaq",
  };
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const RANGE_DAYS: Record<string, number> = {
  "1D": 5, "5D": 10, "1M": 35, "6M": 190, YTD: 400, "1Y": 400, "5Y": 1900, MAX: 7300,
};

export async function history(symbol: string, rangeKey: string): Promise<Candle[]> {
  const days = RANGE_DAYS[rangeKey] ?? 190;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const assetclass = assetClassOf(symbol);
  const data = await nfetch(
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/chart?assetclass=${assetclass}&fromdate=${fmtDate(from)}&todate=${fmtDate(to)}`
  );
  const points: any[] = data.chart ?? [];
  const candles: Candle[] = [];
  for (const p of points) {
    const z = p.z ?? {};
    const o = money(z.open);
    const h = money(z.high);
    const l = money(z.low);
    const c = money(z.close);
    if (o === null || h === null || l === null || c === null) continue;
    candles.push({ time: Math.round(p.x / 1000), open: o, high: h, low: l, close: c, volume: money(z.volume) ?? 0 });
  }
  return candles;
}

export type NasdaqOptionRow = {
  strike: number | null;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  inTheMoney: boolean;
};

export type NasdaqChain = {
  symbol: string;
  underlyingPrice: number | null;
  expirationDates: string[];
  selectedDate: string | null;
  calls: NasdaqOptionRow[];
  puts: NasdaqOptionRow[];
};

const num = (s: unknown): number | null => {
  if (typeof s !== "string" || s === "--") return null;
  const n = Number(s.replace(/,/g, ""));
  return isFinite(n) ? n : null;
};

export async function optionChain(symbol: string, expiry?: string): Promise<NasdaqChain> {
  const to = new Date(Date.now() + 60 * 86_400_000);
  const data = await nfetch(
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/option-chain?assetclass=stocks&limit=2000&fromdate=${fmtDate(new Date())}&todate=${fmtDate(to)}`
  );
  const rows: any[] = (data.table?.rows ?? []).filter((r: any) => r.strike);
  const dates = [...new Set<string>(rows.map((r) => r.expiryDate))];
  const selected = expiry && dates.includes(expiry) ? expiry : dates[0] ?? null;
  const selectedRows = rows.filter((r) => r.expiryDate === selected);

  const calls: NasdaqOptionRow[] = [];
  const puts: NasdaqOptionRow[] = [];
  for (const r of selectedRows) {
    const strike = num(r.strike);
    calls.push({
      strike, lastPrice: num(r.c_Last), bid: num(r.c_Bid), ask: num(r.c_Ask),
      volume: num(r.c_Volume), openInterest: num(r.c_Openinterest), inTheMoney: !!r.c_colour,
    });
    puts.push({
      strike, lastPrice: num(r.p_Last), bid: num(r.p_Bid), ask: num(r.p_Ask),
      volume: num(r.p_Volume), openInterest: num(r.p_Openinterest), inTheMoney: !!r.p_colour,
    });
  }

  const priceMatch = String(data.lastTrade ?? "").match(/\$([\d.,]+)/);
  return {
    symbol,
    underlyingPrice: priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null,
    expirationDates: dates,
    selectedDate: selected,
    calls,
    puts,
  };
}

export type StockTrade = { time: string; price: number | null; volume: number | null };

/**
 * Nasdaq's own "NLS" (Nasdaq Last Sale) real-time trade tape — the same feed
 * that powers the "Latest Real-Time Trades" widget on a Nasdaq stock page.
 * Genuinely tick-by-tick and free, but only populated during active trading
 * hours (pre/post-market and closed-market windows return an empty list).
 */
export async function realtimeTrades(symbol: string): Promise<StockTrade[]> {
  const data = await nfetch(
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/realtime-trades?assetclass=stocks&recordfilter=all&limit=50&offset=0`
  );
  const rows: any[] = data.rows ?? [];
  return rows
    .map((r) => ({
      time: r.nlsTime ?? r.time ?? "",
      price: money(r.nlsPrice ?? r.price),
      volume: money(r.nlsShareVolume ?? r.shareVolume ?? r.volume),
    }))
    .filter((t) => t.price !== null);
}

