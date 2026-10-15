import { describe, expect, it } from "vitest";
import { dayAfterEarningsChange } from "./earnings.js";
import type { Candle } from "./providers/yahoo.js";

const timestamp = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;
const candle = (date: string, close: number, hour = 0): Candle => ({
  time: timestamp(date) + hour * 3600, open: close, high: close, low: close, close, volume: 1,
});

describe("day-after earnings price change", () => {
  const candles = [
    candle("2026-10-12", 80), candle("2026-10-13", 90),
    candle("2026-10-14", 95), candle("2026-10-15", 100),
    candle("2026-10-16", 110), candle("2026-10-19", 121),
  ];

  it("uses the reported session and the following session, not three days earlier", () => {
    expect(dayAfterEarningsChange(candles, timestamp("2026-10-15"))).toBeCloseTo(10);
  });

  it("compares calendar dates when daily candles have intraday timestamps", () => {
    expect(dayAfterEarningsChange([
      candle("2026-10-15", 100, 13), candle("2026-10-16", 110, 13),
    ], timestamp("2026-10-15"))).toBeCloseTo(10);
  });

  it("uses the next trading session across a weekend", () => {
    expect(dayAfterEarningsChange(candles, timestamp("2026-10-16"))).toBeCloseTo(10);
  });

  it("returns null for a non-trading report date instead of guessing the release session", () => {
    expect(dayAfterEarningsChange(candles, timestamp("2026-10-17"))).toBeNull();
  });

  it("returns null when the report or following session is outside price coverage", () => {
    expect(dayAfterEarningsChange(candles, timestamp("2026-07-15"))).toBeNull();
    expect(dayAfterEarningsChange(candles, timestamp("2026-10-19"))).toBeNull();
    expect(dayAfterEarningsChange([], timestamp("2026-10-15"))).toBeNull();
  });

  it("sorts daily closes and does not mistake two bars on one date for two sessions", () => {
    expect(dayAfterEarningsChange([
      candle("2026-10-16", 110, 20), candle("2026-10-15", 98, 13),
      candle("2026-10-15", 100, 20),
    ], timestamp("2026-10-15"))).toBeCloseTo(10);
  });

  it("does not produce a percentage from a zero or non-finite close", () => {
    expect(dayAfterEarningsChange([
      candle("2026-10-15", 0), candle("2026-10-16", 10),
    ], timestamp("2026-10-15"))).toBeNull();
    expect(dayAfterEarningsChange([
      candle("2026-10-15", 100), candle("2026-10-16", NaN),
    ], timestamp("2026-10-15"))).toBeNull();
  });
});
