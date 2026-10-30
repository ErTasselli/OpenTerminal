import type { Candle, Quote } from "./providers/yahoo.js";

const DAY = 86_400;
/** Gap above which candles are weekly/monthly bars, which a live day can't be merged into. */
const MAX_DAILY_STEP = 4 * DAY;

/** The current US trading date (America/New_York) as 00:00Z epoch seconds, the
 * convention Nasdaq's daily chart uses for its candle timestamps. */
export function etSessionDay(now = new Date()): { time: number; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    }).formatToParts(now).map((p) => [p.type, p.value])
  );
  const time = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 1000;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { time, weekday };
}

const positive = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** True when the quote reflects a session that traded today (not a weekend/holiday carry-over). */
function tradedToday(q: Pick<Quote, "marketState">, weekday: number): boolean {
  if (weekday === 0 || weekday === 6) return false;
  const state = (q.marketState ?? "").toLowerCase();
  return state === "open" || state === "regular" || state.includes("after") || state === "post";
}

/**
 * Daily history ends at the last *completed* session, so a 6M/1Y chart showed
 * nothing for the day in progress. This appends today's candle built from the
 * live quote, or refreshes it if the provider already returned a partial one.
 *
 * Quote fields are untrusted: some providers report `high: null, low: 0` for
 * ETFs, so high/low are clamped to include the open and the last price.
 * Returns the input unchanged whenever the result would be unreliable.
 */
export function mergeLiveCandle(
  candles: Candle[],
  q: Pick<Quote, "price" | "open" | "high" | "low" | "volume" | "marketState">,
  session = etSessionDay()
): Candle[] {
  if (candles.length < 2 || !positive(q.price) || !positive(q.open)) return candles;
  if (!tradedToday(q, session.weekday)) return candles;

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (last.time - prev.time > MAX_DAILY_STEP) return candles; // weekly/monthly bars
  if (last.time > session.time) return candles; // provider is ahead of us: leave it alone

  const high = Math.max(q.open, q.price, positive(q.high) ? q.high : 0);
  const low = Math.min(q.open, q.price, positive(q.low) ? q.low : Infinity);
  const today: Candle = {
    time: session.time,
    open: q.open,
    high,
    low,
    close: q.price,
    volume: positive(q.volume) ? q.volume : 0,
  };
  return last.time === session.time ? [...candles.slice(0, -1), today] : [...candles, today];
}
