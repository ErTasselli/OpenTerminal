import { Router } from "express";
import { cached, cacheGet, cacheStore, staleGet } from "../cache.js";
import { withFallback } from "../providers/registry.js";
import * as yahoo from "../providers/yahoo.js";
import * as stooq from "../providers/stooq.js";
import * as nasdaq from "../providers/nasdaq.js";
import * as fred from "../providers/fred.js";
import * as tradingview from "../providers/tradingview.js";
import * as coingecko from "../providers/coingecko.js";
import * as binance from "../providers/binance.js";
import * as news from "../providers/news.js";
import * as econcalendar from "../providers/econcalendar.js";

export const marketRouter = Router();

const QUOTE_TTL = 1_000;
const HISTORY_TTL = 20_000;
const NEWS_TTL = 60_000;

function fail(req: any, res: any, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  console.error("[market]", req.path, detail);
  res.status(502).json({ error: "All data providers are temporarily unavailable. Try again shortly.", detail });
}

// ---- VIX: served from FRED (daily close), since it's an index rather than a
// tradable stock/ETF — Nasdaq's stock API doesn't carry it, and routing it
// through Yahoo would make it depend on Yahoo's flaky rate limits for no reason.

function isVix(symbol: string): boolean {
  return symbol.toUpperCase() === "^VIX" || symbol.toUpperCase() === "VIX";
}

async function vixQuote(): Promise<yahoo.Quote> {
  const points = await fred.series("VIXCLS", 5);
  if (points.length === 0) throw new Error("fred: no VIX data");
  const last = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const price = last.value;
  const previousClose = prev?.value ?? null;
  const change = previousClose !== null ? price - previousClose : null;
  const changePercent = previousClose ? (change! / previousClose) * 100 : null;
  return {
    symbol: "^VIX",
    name: "CBOE Volatility Index",
    price,
    change,
    changePercent,
    open: null,
    high: null,
    low: null,
    previousClose,
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
    currency: "USD",
    exchange: "CBOE",
    marketState: null,
    time: null,
    source: "fred",
  };
}

const VIX_RANGE_N: Record<string, number> = {
  "1D": 5,
  "5D": 5,
  "1M": 22,
  "6M": 130,
  YTD: 200,
  "1Y": 252,
  "5Y": 1260,
  MAX: 20_000,
};

async function vixHistory(rangeKey: string): Promise<yahoo.Candle[]> {
  const n = VIX_RANGE_N[rangeKey] ?? 130;
  const points = await fred.series("VIXCLS", n);
  return points.map((p) => {
    const time = Math.floor(new Date(p.date + "T00:00:00Z").getTime() / 1000);
    return { time, open: p.value, high: p.value, low: p.value, close: p.value, volume: 0 };
  });
}

// ---- quotes (per-symbol cache, so overlapping widgets share one fetch) ----

/**
 * Resolve quotes for a symbol list, reusing a per-symbol cache across every
 * caller (single quote widget, watchlist, screener, heatmap all share hits).
 * Nasdaq's public quote API is primary (no key, generous limits); Yahoo and
 * Stooq are fallbacks. A symbol that fails everywhere still falls back to
 * its last-known value instead of failing the whole batch.
 */
async function getQuotes(symbols: string[]): Promise<yahoo.Quote[]> {
  const fresh = new Map<string, yahoo.Quote>();
  const missing: string[] = [];
  for (const sym of symbols) {
    const hit = cacheGet<yahoo.Quote>(`quote:${sym}`);
    if (hit) fresh.set(sym, hit);
    else missing.push(sym);
  }
  if (missing.length === 0) return symbols.map((s) => fresh.get(s)!).filter(Boolean);

  const fetched = new Map<string, yahoo.Quote>();
  let remaining = missing;

  const cryptoSymbols = remaining.filter((s) => binance.CRYPTO_SYMBOLS.has(s));
  if (cryptoSymbols.length > 0) {
    const results = await Promise.allSettled(cryptoSymbols.map((s) => binance.quote(s)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") fetched.set(cryptoSymbols[i], r.value);
    });
    remaining = remaining.filter((s) => !fetched.has(s));
  }

  const vixSymbols = remaining.filter((s) => isVix(s));
  if (vixSymbols.length > 0) {
    const results = await Promise.allSettled(vixSymbols.map(() => vixQuote()));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") fetched.set(vixSymbols[i], r.value);
    });
    remaining = remaining.filter((s) => !fetched.has(s));
  }

  const nasdaqResults = await Promise.allSettled(remaining.map((s) => nasdaq.quote(s)));
  nasdaqResults.forEach((r, i) => {
    if (r.status === "fulfilled") fetched.set(remaining[i], r.value);
  });
  remaining = remaining.filter((s) => !fetched.has(s));

  if (remaining.length > 0) {
    try {
      const rows = await yahoo.quotes(remaining);
      for (const q of rows) fetched.set(q.symbol, q);
      remaining = remaining.filter((s) => !fetched.has(s));
    } catch {
      // fall through to chart-based per-symbol fetch below
    }
  }

  if (remaining.length > 0) {
    const results = await Promise.allSettled(remaining.map((s) => yahoo.quoteFromChart(s)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") fetched.set(remaining[i], r.value);
    });
    remaining = remaining.filter((s) => !fetched.has(s));
  }

  if (remaining.length > 0) {
    const results = await Promise.allSettled(remaining.slice(0, 20).map((s) => stooq.quote(s)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") fetched.set(remaining[i], r.value);
    });
  }

  // Fill gaps Nasdaq's quote endpoints don't cover (open, P/E, EPS, dividend
  // yield, beta, shares outstanding) from TradingView's public scanner API,
  // in one batched request for every quote that resolved an exchange.
  const needsFundamentals = [...fetched.values()].filter((q) => q.exchange && q.pe === null);
  if (needsFundamentals.length > 0) {
    try {
      const fundamentals = await tradingview.scanFundamentals(
        needsFundamentals.map((q) => ({ symbol: q.symbol, exchange: q.exchange }))
      );
      for (const q of needsFundamentals) {
        const f = fundamentals.get(q.symbol);
        if (!f) continue;
        q.open = q.open ?? f.open;
        q.pe = q.pe ?? f.pe;
        q.eps = q.eps ?? f.eps;
        q.dividendYield = q.dividendYield ?? f.dividendYield;
        q.beta = q.beta ?? f.beta;
        q.sharesOutstanding = q.sharesOutstanding ?? f.sharesOutstanding;
      }
    } catch {
      // best-effort enrichment only — never fails the quote request
    }
  }

  for (const [sym, q] of fetched) cacheStore(`quote:${sym}`, q, QUOTE_TTL);

  const out: yahoo.Quote[] = [];
  for (const sym of symbols) {
    const q = fresh.get(sym) ?? fetched.get(sym) ?? staleGet<yahoo.Quote>(`quote:${sym}`);
    if (q) out.push(q);
  }
  return out;
}

marketRouter.get("/quotes", async (req, res) => {
  const symbols = String(req.query.symbols ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 150);
  if (symbols.length === 0) return res.status(400).json({ error: "symbols required" });
  try {
    const data = await getQuotes(symbols);
    if (data.length === 0) throw new Error("no quotes from any provider");
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- history / candles ----

marketRouter.get("/history/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const rangeKey = String(req.query.range ?? "6M");
  try {
    const data = await cached(`history:${symbol}:${rangeKey}`, HISTORY_TTL, () =>
      binance.CRYPTO_SYMBOLS.has(symbol)
        ? binance.history(symbol, rangeKey)
        : isVix(symbol)
        ? vixHistory(rangeKey)
        : withFallback([
            ["nasdaq", () => nasdaq.history(symbol, rangeKey)],
            ["yahoo", () => yahoo.history(symbol, yahooRange(rangeKey).range, yahooRange(rangeKey).interval)],
            ["stooq", () => stooq.history(symbol)],
          ])
    );
    if (!Array.isArray(data) || data.length === 0) throw new Error("empty history from all providers");
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

function yahooRange(rangeKey: string): { range: string; interval: string } {
  const map: Record<string, { range: string; interval: string }> = {
    "1D": { range: "1d", interval: "5m" },
    "5D": { range: "5d", interval: "15m" },
    "1M": { range: "1mo", interval: "1h" },
    "6M": { range: "6mo", interval: "1d" },
    YTD: { range: "ytd", interval: "1d" },
    "1Y": { range: "1y", interval: "1d" },
    "5Y": { range: "5y", interval: "1wk" },
    MAX: { range: "max", interval: "1mo" },
  };
  return map[rangeKey] ?? map["6M"];
}

// ---- search ----

marketRouter.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.json([]);
  try {
    const data = await cached(`search:${q.toLowerCase()}`, 300_000, () =>
      withFallback([
        ["tradingview", () => tradingview.search(q)],
        ["yahoo", () => yahoo.search(q)],
      ])
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- news ----

marketRouter.get("/news", async (req, res) => {
  const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : null;
  try {
    const data = await cached(`news:${symbol ?? "top"}`, NEWS_TTL, async () => {
      if (symbol) {
        const lists = await Promise.allSettled([news.symbolNews(symbol), news.topNews(symbol + " stock")]);
        const ok = lists.filter((r) => r.status === "fulfilled").map((r) => (r as any).value);
        if (ok.length === 0) throw new Error("all news sources failed");
        return news.dedupe(ok).slice(0, 40);
      }
      const lists = await Promise.allSettled([
        news.topNews("stock market"),
        news.topNews("federal reserve economy"),
      ]);
      const ok = lists.filter((r) => r.status === "fulfilled").map((r) => (r as any).value);
      if (ok.length === 0) throw new Error("all news sources failed");
      return news.dedupe(ok).slice(0, 40);
    });
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- economic calendar (Fed / ECB / CPI / NFP with forecast + actual) ----

marketRouter.get("/econ-calendar", async (req, res) => {
  try {
    const data = await cached("econ-calendar", 900_000, () => econcalendar.weeklyEvents());
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- options ----

marketRouter.get("/options/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const expiry = req.query.expiry ? String(req.query.expiry) : undefined;
  try {
    const data = await cached(`options:${symbol}:${expiry ?? "front"}`, 60_000, () =>
      withFallback([
        ["nasdaq", () => nasdaq.optionChain(symbol, expiry)],
        [
          "yahoo",
          async () => {
            const y = await yahoo.options(symbol);
            return {
              symbol: y.symbol,
              underlyingPrice: y.underlyingPrice,
              expirationDates: y.expirationDates.map((d: number) => new Date(d * 1000).toISOString().slice(0, 10)),
              selectedDate: y.selectedDate ? new Date(y.selectedDate * 1000).toISOString().slice(0, 10) : null,
              calls: y.calls,
              puts: y.puts,
            };
          },
        ],
      ])
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- crypto ----

marketRouter.get("/crypto", async (req, res) => {
  try {
    const data = await cached("crypto:markets", 5_000, () =>
      withFallback([
        ["coingecko", () => coingecko.markets(50)],
        ["binance", () => binance.markets()],
      ])
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

marketRouter.get("/crypto/global", async (req, res) => {
  try {
    const data = await cached("crypto:global", 120_000, () =>
      withFallback([["coingecko", () => coingecko.globalStats()]])
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

marketRouter.get("/crypto/orderbook/:symbol", async (req, res) => {
  try {
    const data = await cached(`orderbook:${req.params.symbol}`, 5_000, () =>
      withFallback([["binance", () => binance.orderBook(req.params.symbol)]])
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- macro: treasury yield curve (FRED) + key indexes via ETF proxies (Nasdaq) ----

const YIELD_SERIES: Array<{ id: string; tenor: string }> = [
  { id: "DGS3MO", tenor: "3M" },
  { id: "DGS5", tenor: "5Y" },
  { id: "DGS10", tenor: "10Y" },
  { id: "DGS30", tenor: "30Y" },
];

const INDEX_PROXIES: Record<string, string> = {
  SPY: "S&P 500 (SPY)",
  DIA: "Dow Jones (DIA)",
  QQQ: "Nasdaq 100 (QQQ)",
  IWM: "Russell 2000 (IWM)",
  GLD: "Gold (GLD)",
  USO: "WTI Crude (USO)",
  TLT: "20Y+ Treasury (TLT)",
  UUP: "Dollar Index (UUP)",
};

marketRouter.get("/macro", async (req, res) => {
  try {
    const [yieldResults, vix, quotes] = await Promise.all([
      Promise.allSettled(YIELD_SERIES.map((s) => cached(`fred:${s.id}`, 300_000, () => fred.latest(s.id)))),
      cached("fred:VIXCLS", 300_000, () => fred.latest("VIXCLS")).catch(() => null),
      getQuotes(Object.keys(INDEX_PROXIES)),
    ]);
    const yields = YIELD_SERIES.map((s, i) => {
      const r = yieldResults[i];
      return { tenor: s.tenor, value: r.status === "fulfilled" ? r.value?.value ?? null : null };
    }).filter((y) => y.value !== null);

    const indexes = quotes.map((q) => ({
      symbol: q.symbol,
      label: INDEX_PROXIES[q.symbol] ?? q.symbol,
      price: q.price,
      changePercent: q.changePercent,
    }));

    if (yields.length === 0 && indexes.length === 0) throw new Error("no macro data from any provider");
    res.json({ yields, vix: vix?.value ?? null, indexes });
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- heatmap + screener over the full market (TradingView scanner — live) ----

async function marketRows(): Promise<tradingview.MarketRow[]> {
  return cached("marketscan:full", 3_000, () => tradingview.marketScan(1500));
}

marketRouter.get("/heatmap", async (req, res) => {
  try {
    const rows = await marketRows();
    const top = rows.filter((r) => r.marketCap).slice(0, 150);
    res.json(top);
  } catch (err) {
    fail(req, res, err);
  }
});

marketRouter.get("/screener", async (req, res) => {
  try {
    let rows = await marketRows();
    const num = (v: unknown) => (v === undefined ? undefined : Number(v));
    const f = {
      sector: req.query.sector ? String(req.query.sector) : undefined,
      marketCapMin: num(req.query.marketCapMin),
      changeMin: num(req.query.changeMin),
      changeMax: num(req.query.changeMax),
      volumeMin: num(req.query.volumeMin),
    };
    rows = rows.filter((r) => {
      if (f.sector && r.sector !== f.sector) return false;
      if (f.marketCapMin !== undefined && (r.marketCap ?? 0) < f.marketCapMin) return false;
      if (f.changeMin !== undefined && (r.changePercent ?? -Infinity) < f.changeMin) return false;
      if (f.changeMax !== undefined && (r.changePercent ?? Infinity) > f.changeMax) return false;
      if (f.volumeMin !== undefined && (r.volume ?? 0) < f.volumeMin) return false;
      return true;
    });
    const sortKey = String(req.query.sort ?? "marketCap") as keyof tradingview.MarketRow;
    const dir = req.query.dir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = (a[sortKey] as number | null) ?? -Infinity;
      const bv = (b[sortKey] as number | null) ?? -Infinity;
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
    res.json(rows.slice(0, 500));
  } catch (err) {
    fail(req, res, err);
  }
});

marketRouter.get("/sectors", async (_req, res) => {
  try {
    const rows = await marketRows();
    res.json([...new Set(rows.map((r) => r.sector))].sort());
  } catch (err) {
    res.json([]);
  }
});

// ---- market recap: templated end-of-day-style narrative + supporting stats ----

const RECAP_TTL = 15_000;

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "flat";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function buildRecapSummary(d: {
  indexes: Array<{ symbol: string; label: string; changePercent: number | null }>;
  bestSector?: { sector: string; avgChangePercent: number };
  worstSector?: { sector: string; avgChangePercent: number };
  gainers: tradingview.MarketRow[];
  losers: tradingview.MarketRow[];
  vix: number | null;
}): string {
  const spy = d.indexes.find((i) => i.symbol === "SPY");
  const qqq = d.indexes.find((i) => i.symbol === "QQQ");
  const dia = d.indexes.find((i) => i.symbol === "DIA");
  const spyChange = spy?.changePercent ?? 0;
  const dir = spyChange > 0.15 ? "trading higher" : spyChange < -0.15 ? "trading lower" : "little changed";

  const parts: string[] = [];
  parts.push(
    `US stocks are ${dir}, with the S&P 500 ${pct(spy?.changePercent)}, the Nasdaq 100 ${pct(qqq?.changePercent)} and the Dow ${pct(dia?.changePercent)}.`
  );
  if (d.bestSector && d.worstSector && d.bestSector.sector !== d.worstSector.sector) {
    parts.push(
      `${d.bestSector.sector} is leading sector performance (${pct(d.bestSector.avgChangePercent)}), while ${d.worstSector.sector} lags (${pct(d.worstSector.avgChangePercent)}).`
    );
  }
  if (d.gainers[0] && d.losers[0]) {
    parts.push(
      `${d.gainers[0].name} paces advancers, up ${pct(d.gainers[0].changePercent)}, while ${d.losers[0].name} is the biggest decliner, down ${pct(
        d.losers[0].changePercent
      )}.`
    );
  }
  if (d.vix !== null) {
    parts.push(`The VIX volatility index is at ${d.vix.toFixed(2)}.`);
  }
  return parts.join(" ");
}

marketRouter.get("/recap", async (req, res) => {
  try {
    const data = await cached("recap:full", RECAP_TTL, async () => {
      const [quotes, vix, rows, headlines] = await Promise.all([
        getQuotes(Object.keys(INDEX_PROXIES)),
        cached("fred:VIXCLS", 300_000, () => fred.latest("VIXCLS")).catch(() => null),
        marketRows(),
        cached("news:recap", NEWS_TTL, async () => {
          const lists = await Promise.allSettled([
            news.topNews("stock market"),
            news.topNews("federal reserve economy"),
          ]);
          const ok = lists.filter((r) => r.status === "fulfilled").map((r) => (r as any).value);
          if (ok.length === 0) throw new Error("all news sources failed");
          return news.dedupe(ok);
        }),
      ]);

      const indexes = quotes.map((q) => ({
        symbol: q.symbol,
        label: INDEX_PROXIES[q.symbol] ?? q.symbol,
        price: q.price,
        changePercent: q.changePercent,
      }));

      const ranked = rows.filter((r) => (r.marketCap ?? 0) > 2_000_000_000 && r.changePercent !== null);
      const gainers = [...ranked].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0)).slice(0, 5);
      const losers = [...ranked].sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0)).slice(0, 5);

      const sectorMap = new Map<string, { sum: number; count: number }>();
      for (const r of rows) {
        if (r.changePercent === null || !r.sector) continue;
        const cur = sectorMap.get(r.sector) ?? { sum: 0, count: 0 };
        cur.sum += r.changePercent;
        cur.count += 1;
        sectorMap.set(r.sector, cur);
      }
      const sectors = [...sectorMap.entries()]
        .map(([sector, { sum, count }]) => ({ sector, avgChangePercent: sum / count }))
        .sort((a, b) => b.avgChangePercent - a.avgChangePercent);

      const bestSector = sectors[0];
      const worstSector = sectors[sectors.length - 1];

      const summary = buildRecapSummary({ indexes, bestSector, worstSector, gainers, losers, vix: vix?.value ?? null });

      return {
        summary,
        updatedAt: new Date().toISOString(),
        indexes,
        vix: vix?.value ?? null,
        gainers,
        losers,
        sectors: sectors.slice(0, 3).concat(sectors.length > 3 ? sectors.slice(-3) : []),
        news: headlines.slice(0, 6),
      };
    });
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- earnings calendar for a list of symbols ----

marketRouter.get("/calendar", async (req, res) => {
  const symbols = String(req.query.symbols ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 30);
  if (symbols.length === 0) return res.status(400).json({ error: "symbols required" });
  try {
    const data = await cached(`calendar:${symbols.join(",")}`, 3_600_000, () => tradingview.earningsCalendar(symbols));
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- earnings history: forecast vs actual per quarter, plus next-day price move ----

marketRouter.get("/earnings-history/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const data = await cached(`earnings-history:${symbol}`, 3_600_000, async () => {
      const [surprises, candles] = await Promise.all([
        nasdaq.earningsSurprise(symbol),
        withFallback([
          ["nasdaq", () => nasdaq.history(symbol, "1Y")],
          ["yahoo", () => yahoo.history(symbol, yahooRange("1Y").range, yahooRange("1Y").interval)],
          ["stooq", () => stooq.history(symbol)],
        ]),
      ]);
      const sorted = [...candles].sort((a, b) => a.time - b.time);
      // Nearest trading-day close on/after a given date, and the close of the
      // trading day right after that — the "day after earnings" move.
      const closeOnOrAfter = (unixSeconds: number) => {
        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i].time >= unixSeconds - 3 * 86_400) return i;
        }
        return -1;
      };
      return surprises.map((s) => {
        const idx = closeOnOrAfter(s.dateReported);
        const dayAfterChangePercent =
          idx >= 0 && idx + 1 < sorted.length
            ? ((sorted[idx + 1].close - sorted[idx].close) / sorted[idx].close) * 100
            : null;
        return { ...s, dayAfterChangePercent };
      });
    });
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});
