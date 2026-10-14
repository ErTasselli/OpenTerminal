// Daily FX history from fawazahmed0's open currency-api, served as static
// JSON from the jsDelivr CDN (one ~6 KB file per day, all currencies against
// USD, published since 2024-03). No key, no rate limit beyond the CDN's.
// It covers the LatAm crosses (CLP, COP, PEN, ARS) that FRED and the ECB
// don't, and stays reachable when Yahoo's "=X" charts are rate-limited (429).
//
// Each day is a single snapshot, not an OHLC bar: candles are synthesized as
// open = previous day's close, so the candle view still shows direction.

import { mapWithConcurrency } from "../concurrency.js";

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

const FIRST_DAY = "2024-03-02";
const MIRRORS = [
  (d: string) => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${d}/v1/currencies/usd.min.json`,
  (d: string) => `https://${d}.currency-api.pages.dev/v1/currencies/usd.min.json`,
];

// Published days never change, so they're kept for the process lifetime
// (~340 rates x a few hundred days is a few MB at most).
const dayCache = new Map<string, Record<string, number> | null>();

async function fetchDay(date: string): Promise<Record<string, number> | null> {
  if (dayCache.has(date)) return dayCache.get(date)!;
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url(date), { signal: AbortSignal.timeout(6_000) });
      // 404 = that day's file isn't published (yet). Not cached, so today's
      // file is picked up once it appears.
      if (res.status === 404) return null;
      if (!res.ok) continue;
      const json = await res.json();
      const usd = json?.usd ?? {};
      const rates: Record<string, number> = { usd: 1 };
      for (const [k, v] of Object.entries(usd)) if (typeof v === "number" && v > 0) rates[k] = v;
      dayCache.set(date, rates);
      return rates;
    } catch {
      // try the next mirror
    }
  }
  return null;
}

/** Calendar days (UTC, YYYY-MM-DD) to sample for a chart range. */
export function datesFor(rangeKey: string, today = new Date()): string[] {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const daysBack: Record<string, number> = { "1D": 7, "5D": 10, "1M": 31, "6M": 183, "1Y": 366, "5Y": 1830, MAX: 1830 };
  let start: Date;
  if (rangeKey === "YTD") start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
  else start = new Date(end.getTime() - (daysBack[rangeKey] ?? 183) * 86_400_000);
  const first = new Date(`${FIRST_DAY}T00:00:00Z`);
  if (start < first) start = first;
  // Long ranges are sampled weekly: ~130 files instead of ~950.
  const step = rangeKey === "5Y" || rangeKey === "MAX" ? 7 : 1;
  const out: string[] = [];
  for (let t = end.getTime(); t >= start.getTime(); t -= step * 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out.reverse();
}

/** Daily history for base/quote (e.g. "USD", "CLP"), synthesized into candles. */
export async function history(base: string, quote: string, rangeKey: string): Promise<Candle[]> {
  const b = base.toLowerCase();
  const q = quote.toLowerCase();
  const dates = datesFor(rangeKey);
  const days = await mapWithConcurrency(dates, 12, (d) => fetchDay(d).catch(() => null));
  const points: Array<{ time: number; value: number }> = [];
  dates.forEach((d, i) => {
    const r = days[i];
    if (!r || !r[b] || !r[q]) return;
    points.push({ time: Date.parse(`${d}T00:00:00Z`) / 1000, value: r[q] / r[b] });
  });
  if (points.length < 2) throw new Error(`No daily history for ${base}/${quote} (not covered by currency-api)`);
  return points.map((p, i) => {
    const open = i > 0 ? points[i - 1].value : p.value;
    return {
      time: p.time,
      open,
      high: Math.max(open, p.value),
      low: Math.min(open, p.value),
      close: p.value,
      volume: 0,
    };
  });
}
