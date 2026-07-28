const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export type Quote = {
  symbol: string;
  name: string | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  avgVolume: number | null;
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  dividendYield: number | null;
  week52High: number | null;
  week52Low: number | null;
  beta: number | null;
  sharesOutstanding: number | null;
  currency: string | null;
  exchange: string | null;
  marketState: string | null;
  time: number | null;
  source: string;
};

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

// ---- crumb/cookie session (needed for the v7 quote and options endpoints) ----

let session: { cookie: string; crumb: string; fetched: number } | null = null;
let sessionFailedUntil = 0;

async function getSession(): Promise<{ cookie: string; crumb: string }> {
  if (session && Date.now() - session.fetched < 30 * 60 * 1000) return session;
  if (Date.now() < sessionFailedUntil) throw new Error("yahoo: crumb fetch failed (cached failure)");
  try {
    const res = await fetch("https://fc.yahoo.com/", { headers: { "User-Agent": UA }, redirect: "manual" });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
    if (!cookie) throw new Error("yahoo: no session cookie");
    const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie },
    });
    const crumb = (await crumbRes.text()).trim();
    if (!crumbRes.ok || !crumb || crumb.includes("<")) throw new Error("yahoo: crumb fetch failed");
    session = { cookie, crumb, fetched: Date.now() };
    return session;
  } catch (err) {
    sessionFailedUntil = Date.now() + 60_000;
    throw err;
  }
}

// Global politeness limiter: max 2 concurrent Yahoo requests with a minimum
// spacing between request starts, plus a cooldown window after a 429 (with
// backoff on repeat offenses) so we fail fast and let the cache serve stale data.
const MAX_CONCURRENT = 2;
const MIN_SPACING_MS = 150;
let active = 0;
let nextSlotAt = 0;
const waiters: Array<() => void> = [];
let cooldownUntil = 0;
let consecutive429s = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquire(): Promise<void> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active++;
  const wait = nextSlotAt - Date.now();
  nextSlotAt = Math.max(Date.now(), nextSlotAt) + MIN_SPACING_MS;
  if (wait > 0) await sleep(wait);
}

function release(): void {
  active--;
  waiters.shift()?.();
}

async function yfetch(url: string, withCrumb = false): Promise<any> {
  if (Date.now() < cooldownUntil) {
    throw new Error("yahoo rate-limited (cooling down)");
  }
  const headers: Record<string, string> = { "User-Agent": UA, Accept: "application/json" };
  let full = url;
  await acquire();
  try {
    if (withCrumb) {
      const s = await getSession();
      headers.Cookie = s.cookie;
      full += (url.includes("?") ? "&" : "?") + "crumb=" + encodeURIComponent(s.crumb);
    }
    const res = await fetch(full, { headers });
    if (!res.ok) {
      if (res.status === 429) {
        consecutive429s++;
        cooldownUntil = Date.now() + Math.min(30_000 * consecutive429s, 5 * 60_000);
      }
      if (withCrumb && (res.status === 401 || res.status === 403)) session = null;
      throw new Error(`yahoo ${res.status} for ${url}`);
    }
    consecutive429s = 0;
    return res.json();
  } finally {
    release();
  }
}

const n = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

// ---- quotes ----

export async function quotes(symbols: string[]): Promise<Quote[]> {
  const url =
    "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + encodeURIComponent(symbols.join(","));
  const json = await yfetch(url, true);
  const rows: any[] = json?.quoteResponse?.result ?? [];
  return rows.map((r) => ({
    symbol: r.symbol,
    name: r.longName ?? r.shortName ?? null,
    price: n(r.regularMarketPrice),
    change: n(r.regularMarketChange),
    changePercent: n(r.regularMarketChangePercent),
    open: n(r.regularMarketOpen),
    high: n(r.regularMarketDayHigh),
    low: n(r.regularMarketDayLow),
    previousClose: n(r.regularMarketPreviousClose),
    bid: n(r.bid),
    ask: n(r.ask),
    volume: n(r.regularMarketVolume),
    avgVolume: n(r.averageDailyVolume3Month),
    marketCap: n(r.marketCap),
    pe: n(r.trailingPE),
    eps: n(r.epsTrailingTwelveMonths),
    dividendYield: n(r.trailingAnnualDividendYield),
    week52High: n(r.fiftyTwoWeekHigh),
    week52Low: n(r.fiftyTwoWeekLow),
    beta: n(r.beta),
    sharesOutstanding: n(r.sharesOutstanding),
    currency: r.currency ?? null,
    exchange: r.fullExchangeName ?? r.exchange ?? null,
    marketState: r.marketState ?? null,
    time: n(r.regularMarketTime),
    source: "yahoo",
  }));
}

/** Quote fallback that works without crumb, using the chart endpoint's metadata. */
export async function quoteFromChart(symbol: string): Promise<Quote> {
  const json = await yfetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`
  );
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error("yahoo chart: no meta for " + symbol);
  const price = n(meta.regularMarketPrice);
  const prev = n(meta.chartPreviousClose ?? meta.previousClose);
  return {
    symbol: meta.symbol ?? symbol,
    name: meta.longName ?? meta.shortName ?? null,
    price,
    change: price !== null && prev !== null ? price - prev : null,
    changePercent: price !== null && prev !== null && prev !== 0 ? ((price - prev) / prev) * 100 : null,
    open: null,
    high: n(meta.regularMarketDayHigh),
    low: n(meta.regularMarketDayLow),
    previousClose: prev,
    bid: null,
    ask: null,
    volume: n(meta.regularMarketVolume),
    avgVolume: null,
    marketCap: null,
    pe: null,
    eps: null,
    dividendYield: null,
    week52High: n(meta.fiftyTwoWeekHigh),
    week52Low: n(meta.fiftyTwoWeekLow),
    beta: null,
    sharesOutstanding: null,
    currency: meta.currency ?? null,
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? null,
    marketState: null,
    time: n(meta.regularMarketTime),
    source: "yahoo-chart",
  };
}

// ---- history ----

export async function history(symbol: string, range: string, interval: string): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${range}&interval=${interval}&includePrePost=false`;
  const json = await yfetch(url);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("yahoo: no chart data for " + symbol);
  const ts: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const [o, h, l, c] = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]];
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0 });
  }
  return candles;
}

// ---- search ----

export type SearchResult = { symbol: string; name: string; exchange: string; type: string };

export async function search(query: string): Promise<SearchResult[]> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
    query
  )}&quotesCount=12&newsCount=0`;
  const json = await yfetch(url);
  return (json?.quotes ?? [])
    .filter((r: any) => r.symbol)
    .map((r: any) => ({
      symbol: r.symbol,
      name: r.longname ?? r.shortname ?? r.symbol,
      exchange: r.exchDisp ?? r.exchange ?? "",
      type: r.quoteType ?? r.typeDisp ?? "",
    }));
}

// ---- options ----

export async function options(symbol: string, date?: number): Promise<any> {
  let url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`;
  if (date) url += `?date=${date}`;
  const json = await yfetch(url, true);
  const result = json?.optionChain?.result?.[0];
  if (!result) throw new Error("yahoo: no option chain for " + symbol);
  const chain = result.options?.[0] ?? { calls: [], puts: [] };
  const pick = (o: any) => ({
    strike: n(o.strike),
    lastPrice: n(o.lastPrice),
    bid: n(o.bid),
    ask: n(o.ask),
    change: n(o.change),
    percentChange: n(o.percentChange),
    volume: n(o.volume),
    openInterest: n(o.openInterest),
    impliedVolatility: n(o.impliedVolatility),
    inTheMoney: !!o.inTheMoney,
  });
  return {
    symbol,
    underlyingPrice: n(result.quote?.regularMarketPrice),
    expirationDates: result.expirationDates ?? [],
    selectedDate: chain.expirationDate ?? null,
    calls: (chain.calls ?? []).map(pick),
    puts: (chain.puts ?? []).map(pick),
  };
}

// ---- earnings / calendar (per-symbol, via quoteSummary) ----

export async function calendarEvents(symbol: string): Promise<any> {
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
    symbol
  )}?modules=calendarEvents,defaultKeyStatistics`;
  const json = await yfetch(url, true);
  const r = json?.quoteSummary?.result?.[0];
  const earnings = r?.calendarEvents?.earnings;
  return {
    symbol,
    earningsDates: (earnings?.earningsDate ?? []).map((d: any) => d?.raw ?? null).filter(Boolean),
    exDividendDate: r?.calendarEvents?.exDividendDate?.raw ?? null,
    dividendDate: r?.calendarEvents?.dividendDate?.raw ?? null,
  };
}
