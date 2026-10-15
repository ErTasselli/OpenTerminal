import type { Candle } from "./providers/yahoo.js";

/** Close on the reported date to the next available session's close.
 * The source has no release time, so this is a daily-close approximation,
 * not an attribution of the move to a pre-market or after-hours announcement.
 */
export function dayAfterEarningsChange(candles: Candle[], dateReported: number): number | null {
  const day = (time: number) => Math.floor(time / 86_400);
  // Providers can timestamp daily bars at midnight or during the session.
  // Keep the final bar per date so intraday bars never become "the next day".
  const closes = new Map<number, number>();
  for (const candle of [...candles].sort((a, b) => a.time - b.time)) {
    closes.set(day(candle.time), candle.close);
  }
  const sessions = [...closes.keys()];
  const index = sessions.indexOf(day(dateReported));
  if (index < 0 || index + 1 >= sessions.length) return null;
  const close = closes.get(sessions[index])!;
  const nextClose = closes.get(sessions[index + 1])!;
  if (!Number.isFinite(close) || !Number.isFinite(nextClose) || close <= 0 || nextClose <= 0) return null;
  return ((nextClose - close) / close) * 100;
}
