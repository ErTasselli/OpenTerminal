import { describe, it, expect } from "vitest";
import { aggregate, parseInterval } from "./candles.js";

const c = (time: number, o: number, h: number, l: number, cl: number, volume = 1) => ({ time, open: o, high: h, low: l, close: cl, volume });

describe("aggregate", () => {
  it("rolls 1h candles into 4h buckets", () => {
    const base = 14_400 * 100;
    const out = aggregate([c(base, 1, 5, 1, 2), c(base + 3600, 2, 9, 2, 3), c(base + 14_400, 3, 4, 3, 4)], "4h");
    expect(out).toEqual([c(base, 1, 9, 1, 3, 2), c(base + 14_400, 3, 4, 3, 4)]);
  });
  it("groups daily candles by ISO week and month", () => {
    const day = (d: string) => Date.parse(d + "T00:00:00Z") / 1000;
    const days = [c(day("2026-10-12"), 1, 2, 1, 2), c(day("2026-10-16"), 2, 3, 2, 3), c(day("2026-10-19"), 3, 4, 3, 4)];
    expect(aggregate(days, "1w").map((x) => x.time)).toEqual([day("2026-10-12"), day("2026-10-19")]);
    expect(aggregate(days, "1M")).toHaveLength(1);
  });
  it("rejects unknown intervals", () => {
    expect(parseInterval("4h")).toBe("4h");
    expect(parseInterval("2h")).toBeNull();
  });
});
