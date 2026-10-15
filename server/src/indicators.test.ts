import { describe, expect, it } from "vitest";
import { rsi } from "../../web/lib/indicators";

const candles = (closes: number[]) => closes.map((close, time) => ({
  time, open: close, high: close, low: close, close, volume: 1,
}));

describe("RSI edge cases", () => {
  it("is 100 for uninterrupted gains, including after the initial window", () => {
    const result = rsi(candles(Array.from({ length: 20 }, (_, i) => i + 1)));
    expect(result).toHaveLength(6);
    expect(result.every((point) => point.value === 100)).toBe(true);
  });

  it("is 0 for uninterrupted losses and 50 for a completely flat window", () => {
    expect(rsi(candles(Array.from({ length: 20 }, (_, i) => 20 - i))).every((p) => p.value === 0)).toBe(true);
    expect(rsi(candles(Array(20).fill(100))).every((p) => p.value === 50)).toBe(true);
  });

  it("preserves Wilder smoothing when both gains and losses are present", () => {
    const result = rsi(candles([1, 2, 1, 2, 1]), 2);
    expect(result.map((p) => p.value)).toEqual([50, 75, 37.5]);
    expect(rsi(candles([1, 2, 3]), 14)).toEqual([]);
  });
});
