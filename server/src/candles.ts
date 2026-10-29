import type { Candle } from "./providers/yahoo.js";

export const INTERVALS = ["1h", "4h", "1d", "1w", "1M"] as const;
export type Interval = (typeof INTERVALS)[number];

export function parseInterval(v: unknown): Interval | null {
  return INTERVALS.includes(v as Interval) ? (v as Interval) : null;
}

function bucketStart(time: number, interval: Interval): number {
  if (interval === "4h") return Math.floor(time / 14_400) * 14_400;
  if (interval === "1h") return Math.floor(time / 3_600) * 3_600;
  const d = new Date(time * 1000);
  if (interval === "1w") {
    const day = (d.getUTCDay() + 6) % 7; // Monday = 0
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day) / 1000);
  }
  if (interval === "1M") return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
}

/** Roll finer candles (sorted by time) up into `interval` candles. */
export function aggregate(candles: Candle[], interval: Interval): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const t = bucketStart(c.time, interval);
    const last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else {
      out.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    }
  }
  return out;
}
