import type { Candle } from "./providers/yahoo.js";

/** The 11 Select Sector SPDR ETFs, benchmarked against SPY. */
export const SECTOR_ETFS: Record<string, string> = {
  XLK: "Technology",
  XLC: "Communication Services",
  XLY: "Consumer Discretionary",
  XLP: "Consumer Staples",
  XLE: "Energy",
  XLF: "Financials",
  XLV: "Health Care",
  XLI: "Industrials",
  XLB: "Materials",
  XLRE: "Real Estate",
  XLU: "Utilities",
};
export const BENCHMARK = "SPY";

/** Lookbacks in trading sessions. */
export const PERIODS = { d1: 1, w1: 5, m1: 21, m3: 63 } as const;
export type Period = keyof typeof PERIODS;
export type Returns = Record<Period, number | null>;

/**
 * Percent return over each lookback, measured from the close `n` sessions ago
 * to `last` (the live price). `daily` must hold COMPLETED sessions only,
 * oldest first, so daily[len - 1] is the previous close.
 */
export function periodReturns(daily: Candle[], last: number | null): Returns {
  const out = {} as Returns;
  for (const [k, n] of Object.entries(PERIODS) as Array<[Period, number]>) {
    const base = daily[daily.length - n]?.close;
    out[k] = last && base && base > 0 ? (last / base - 1) * 100 : null;
  }
  return out;
}

/** Relative strength = sector return minus benchmark return, in percentage points. */
export function relativeStrength(sector: Returns, bench: Returns): Returns {
  const out = {} as Returns;
  for (const k of Object.keys(PERIODS) as Period[]) {
    const a = sector[k];
    const b = bench[k];
    out[k] = a === null || b === null ? null : a - b;
  }
  return out;
}

/** Drops a candle for today's session if the provider already included one. */
export function completedSessions(daily: Candle[], todayStartSec: number): Candle[] {
  return daily.length && daily[daily.length - 1].time >= todayStartSec ? daily.slice(0, -1) : daily;
}
