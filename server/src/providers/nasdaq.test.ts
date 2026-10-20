import { describe, expect, it } from "vitest";
import { minutePointsToCandles } from "./nasdaq.js";

// Nasdaq encodes ET wall-clock time as if it were UTC (see nasdaq.ts).
const at = (hhmm: string, y: number, w = 100) => ({ x: Date.parse(`2026-10-14T${hhmm}:00Z`), y, w });

describe("minutePointsToCandles", () => {
  it("folds minute prices into 5-minute OHLC candles with summed volume", () => {
    const candles = minutePointsToCandles([
      at("09:30", 10), at("09:31", 12), at("09:32", 9), at("09:34", 11),
      at("09:35", 11.5, 50),
    ]);
    expect(candles).toEqual([
      { time: Date.parse("2026-10-14T09:30:00Z") / 1000, open: 10, high: 12, low: 9, close: 11, volume: 400 },
      { time: Date.parse("2026-10-14T09:35:00Z") / 1000, open: 11.5, high: 11.5, low: 11.5, close: 11.5, volume: 50 },
    ]);
  });

  it("drops pre-market and after-hours points (regular session only)", () => {
    const candles = minutePointsToCandles([at("04:00", 1), at("09:29", 2), at("09:30", 3), at("15:59", 4), at("16:00", 5)]);
    expect(candles.map((c) => c.close)).toEqual([3, 4]);
  });

  it("skips malformed points instead of emitting NaN candles", () => {
    const candles = minutePointsToCandles([
      { x: NaN, y: 1 }, { x: Date.parse("2026-10-14T10:00:00Z"), y: Number("$9") }, at("10:01", 7),
    ]);
    expect(candles).toHaveLength(1);
    expect(candles[0].close).toBe(7);
  });
});
