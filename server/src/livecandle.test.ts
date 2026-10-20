import { describe, expect, it } from "vitest";
import { etSessionDay, mergeLiveCandle } from "./livecandle.js";

const DAY = 86_400;
const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const bar = (iso: string, close: number) => ({ time: d(iso), open: close, high: close, low: close, close, volume: 1 });
const history = [bar("2026-10-12", 989.04), bar("2026-10-13", 953.19)];
const wednesday = { time: d("2026-10-14"), weekday: 3 };
const liveQuote = { price: 926.97, open: 934.56, high: 949.42, low: 926.3, volume: 11_509_998, marketState: "Open" };

describe("mergeLiveCandle", () => {
  it("appends today's candle from the live quote during the session", () => {
    const out = mergeLiveCandle(history, liveQuote, wednesday);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ time: d("2026-10-14"), open: 934.56, high: 949.42, low: 926.3, close: 926.97, volume: 11_509_998 });
    expect(history).toHaveLength(2); // input not mutated
  });

  it("refreshes a partial candle for today instead of duplicating it", () => {
    const out = mergeLiveCandle([...history, bar("2026-10-14", 900)], liveQuote, wednesday);
    expect(out).toHaveLength(3);
    expect(out[2].close).toBe(926.97);
  });

  it("clamps junk high/low (ETF quotes report high:null, low:0) to open and last", () => {
    const out = mergeLiveCandle(history, { ...liveQuote, open: 774.92, price: 770.7, high: null, low: 0 }, wednesday);
    expect(out[2]).toMatchObject({ high: 774.92, low: 770.7 });
  });

  it.each([
    ["the market is closed (holiday)", { ...liveQuote, marketState: "Closed" }, wednesday],
    ["it is pre-market", { ...liveQuote, marketState: "Pre-Market" }, wednesday],
    ["it is the weekend", liveQuote, { time: d("2026-10-17"), weekday: 6 }],
    ["the quote has no price", { ...liveQuote, price: null }, wednesday],
    ["the quote has no open", { ...liveQuote, open: 0 }, wednesday],
  ])("leaves history untouched when %s", (_why, q, session) => {
    expect(mergeLiveCandle(history, q as typeof liveQuote, session)).toBe(history);
  });

  it("does not merge a day into weekly bars", () => {
    const weekly = [bar("2026-09-28", 1), bar("2026-10-05", 2)];
    expect(mergeLiveCandle(weekly, liveQuote, wednesday)).toBe(weekly);
  });
});

describe("etSessionDay", () => {
  it("uses the New York date, not UTC (01:30Z Thu is still Wed in ET)", () => {
    const s = etSessionDay(new Date("2026-10-15T01:30:00Z"));
    expect(s).toEqual({ time: d("2026-10-14"), weekday: 3 });
  });

  it("rolls over at ET midnight", () => {
    expect(etSessionDay(new Date("2026-10-15T05:00:00Z")).time).toBe(d("2026-10-14") + DAY);
  });
});
