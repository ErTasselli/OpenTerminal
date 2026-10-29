// Time <-> logical-index mapping for chart drawings. Drawings store real
// timestamps, so they survive a candle-size change and can sit past the last
// candle (where lightweight-charts has no time, only a logical index).

type T = { time: number };

export function timeToLogical(candles: T[], time: number): number {
  const n = candles.length;
  if (n === 0) return 0;
  if (n === 1) return 0;
  if (time <= candles[0].time) return (time - candles[0].time) / (candles[1].time - candles[0].time);
  if (time >= candles[n - 1].time) return n - 1 + (time - candles[n - 1].time) / (candles[n - 1].time - candles[n - 2].time);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time <= time) lo = mid;
    else hi = mid;
  }
  return lo + (time - candles[lo].time) / (candles[hi].time - candles[lo].time);
}

export function logicalToTime(candles: T[], logical: number): number {
  const n = candles.length;
  if (n < 2) return candles[0]?.time ?? 0;
  if (logical <= 0) return candles[0].time + logical * (candles[1].time - candles[0].time);
  if (logical >= n - 1) return candles[n - 1].time + (logical - (n - 1)) * (candles[n - 1].time - candles[n - 2].time);
  const lo = Math.floor(logical);
  return candles[lo].time + (logical - lo) * (candles[lo + 1].time - candles[lo].time);
}
