import { describe, expect, it } from "vitest";
import { completedSessions, periodReturns, relativeStrength } from "./sectorStrength.js";

const series = (closes: number[]) => closes.map((close, i) => ({ time: i * 86_400, open: close, high: close, low: close, close, volume: 0 }));

describe("periodReturns", () => {
  it("measures from the close n sessions back to the live price", () => {
    // 70 sessions: close i = 100 + i, so the previous close is 169.
    const daily = series(Array.from({ length: 70 }, (_, i) => 100 + i));
    const r = periodReturns(daily, 172.38);
    expect(r.d1).toBeCloseTo((172.38 / 169 - 1) * 100, 6);
    expect(r.w1).toBeCloseTo((172.38 / 165 - 1) * 100, 6);
    expect(r.m1).toBeCloseTo((172.38 / 149 - 1) * 100, 6);
    expect(r.m3).toBeCloseTo((172.38 / 107 - 1) * 100, 6);
  });

  it("returns null for lookbacks longer than the history, or without a price", () => {
    const short = periodReturns(series([10, 11, 12]), 12);
    expect(short.d1).toBeCloseTo(0, 9);
    expect([short.w1, short.m1, short.m3]).toEqual([null, null, null]);
    expect(periodReturns(series([10, 11]), null).d1).toBeNull();
  });
});

describe("relativeStrength", () => {
  it("is the sector return minus the benchmark, in points", () => {
    const rs = relativeStrength({ d1: 2, w1: -1, m1: 5, m3: null }, { d1: 0.5, w1: 1, m1: 5, m3: 3 });
    expect(rs).toEqual({ d1: 1.5, w1: -2, m1: 0, m3: null });
  });
});

describe("completedSessions", () => {
  it("drops today's partial candle so lookbacks start from the previous close", () => {
    const daily = series([1, 2, 3]);
    expect(completedSessions(daily, 2 * 86_400)).toHaveLength(2);
    expect(completedSessions(daily, 3 * 86_400)).toHaveLength(3);
  });
});
