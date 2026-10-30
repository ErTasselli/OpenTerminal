/**
 * "Trade the past": a pure, deterministic replay engine (no React, no I/O).
 *
 * Realism rules a beginner should learn:
 *  - You decide after seeing a candle close; the order fills at the NEXT
 *    candle's open (you can't trade a price that already printed).
 *  - All-in, long-only, whole shares, no fees: one decision at a time.
 *  - Scored against buy-and-hold over the exact same window.
 *
 * Mystery mode rebases prices to 100 at the start and hides symbol/dates
 * until the end, so the learner can't recognise the chart and use hindsight.
 */
export type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type Intent = "buy" | "sell" | null;
export type Fill = { index: number; side: "buy" | "sell"; price: number; shares: number };

export type Game = {
  candles: Bar[];
  start: number; // first playable index (decisions start after this candle)
  end: number; // last index of the game
  cursor: number; // index of the newest visible candle
  cash: number;
  shares: number;
  startingCash: number;
  fills: Fill[];
  equity: number[]; // equity at each step's close, from `start`
  done: boolean;
};

export const CONTEXT_BARS = 80; // history shown before the first decision
export const PLAY_BARS = 60; // decisions per game

/** Picks a random window. rng is injectable so games are reproducible in tests. */
export function newGame(candles: Bar[], rng: () => number = Math.random, startingCash = 10_000): Game {
  const clean = candles.filter((c) => [c.open, c.high, c.low, c.close].every((n) => Number.isFinite(n) && n > 0));
  if (clean.length < CONTEXT_BARS + PLAY_BARS + 1) throw new Error("not enough history for a replay");
  const span = clean.length - CONTEXT_BARS - PLAY_BARS;
  const start = CONTEXT_BARS + Math.floor(rng() * span);
  return {
    candles: clean, start, end: start + PLAY_BARS, cursor: start,
    cash: startingCash, shares: 0, startingCash, fills: [], equity: [startingCash], done: false,
  };
}

const equityAt = (g: Game, i: number) => g.cash + g.shares * g.candles[i].close;

/** Advances one candle, executing `intent` at that candle's open. */
export function step(g: Game, intent: Intent = null): Game {
  if (g.done) return g;
  const i = g.cursor + 1;
  const bar = g.candles[i];
  let { cash, shares } = g;
  const fills = [...g.fills];
  if (intent === "buy" && shares === 0) {
    const n = Math.floor(cash / bar.open);
    if (n > 0) {
      cash -= n * bar.open;
      shares = n;
      fills.push({ index: i, side: "buy", price: bar.open, shares: n });
    }
  } else if (intent === "sell" && shares > 0) {
    cash += shares * bar.open;
    fills.push({ index: i, side: "sell", price: bar.open, shares });
    shares = 0;
  }
  const next: Game = { ...g, cursor: i, cash, shares, fills };
  next.equity = [...g.equity, equityAt(next, i)];
  next.done = i >= g.end;
  return next.done ? finish(next) : next;
}

/** Ends the game, selling any open position at the final close. */
export function finish(g: Game): Game {
  if (g.shares === 0) return { ...g, done: true };
  const last = g.candles[g.cursor];
  return {
    ...g, done: true, cash: g.cash + g.shares * last.close, shares: 0,
    fills: [...g.fills, { index: g.cursor, side: "sell", price: last.close, shares: g.shares }],
  };
}

export type Score = {
  returnPct: number;
  buyHoldPct: number;
  edgePct: number; // your return minus buy-and-hold
  trades: number; // completed round trips
  winRate: number | null; // share of round trips that made money
  maxDrawdownPct: number; // worst peak-to-trough fall of your equity
  bars: number;
};

export function score(g: Game): Score {
  const startPx = g.candles[g.start].close;
  const endPx = g.candles[g.cursor].close;
  const finalEquity = g.cash + g.shares * endPx;
  const trips: number[] = [];
  let entry: Fill | null = null;
  for (const f of g.fills) {
    if (f.side === "buy") entry = f;
    else if (entry) {
      trips.push(f.price - entry.price);
      entry = null;
    }
  }
  let peak = -Infinity;
  let maxDd = 0;
  for (const e of g.equity) {
    peak = Math.max(peak, e);
    maxDd = Math.max(maxDd, (peak - e) / peak);
  }
  const returnPct = (finalEquity / g.startingCash - 1) * 100;
  const buyHoldPct = (endPx / startPx - 1) * 100;
  return {
    returnPct, buyHoldPct, edgePct: returnPct - buyHoldPct, trades: trips.length,
    winRate: trips.length ? trips.filter((p) => p > 0).length / trips.length : null,
    maxDrawdownPct: maxDd * 100, bars: g.cursor - g.start,
  };
}

/** Candles the learner may see: context + played bars. Rebased to 100 at the start in mystery mode. */
export function visibleBars(g: Game, mystery: boolean): Bar[] {
  const from = Math.max(0, g.start - CONTEXT_BARS);
  const k = mystery && !g.done ? 100 / g.candles[g.start].close : 1;
  return g.candles.slice(from, g.cursor + 1).map((c) => ({
    ...c, open: c.open * k, high: c.high * k, low: c.low * k, close: c.close * k,
  }));
}

/** Well-known, liquid names with long histories, for random mystery games. */
export const MYSTERY_SYMBOLS = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "XOM", "KO", "PEP", "WMT",
  "DIS", "NFLX", "AMD", "INTC", "BA", "NKE", "MCD", "COST", "SPY", "QQQ", "IWM", "GLD",
];
