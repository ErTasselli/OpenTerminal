import { describe, expect, it } from "vitest";
import { minutePointsToCandles, splitSessions } from "./nasdaq.js";
import { yahooExtended } from "./yahoo.js";

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

// Nasdaq encodes ET wall-clock time as if it were UTC.
const etAt = (hhmm: string) => Date.parse(`2026-10-29T${hhmm}:00Z`);

describe("minutePointsToCandles extended hours", () => {
  const pts = [
    { x: etAt("04:00"), y: 770, w: 10 },
    { x: etAt("09:29"), y: 771, w: 10 },
    { x: etAt("09:30"), y: 772, w: 10 },
    { x: etAt("15:59"), y: 769.49, w: 10 },
    { x: etAt("16:00"), y: 769.3, w: 10 },
    { x: etAt("19:59"), y: 764.74, w: 10 },
    { x: etAt("20:00"), y: 1, w: 10 },
    { x: etAt("03:59"), y: 1, w: 10 },
  ];

  it("regular mode keeps 9:30-16:00 only, with no session tags", () => {
    const c = minutePointsToCandles(pts);
    expect(c.map((x) => x.close)).toEqual([772, 769.49]);
    expect(c.every((x) => x.session === undefined)).toBe(true);
  });

  it("extended mode keeps 4:00-20:00 and tags pre/post candles", () => {
    const c = minutePointsToCandles(pts, 5, true);
    expect(c.map((x) => [x.close, x.session ?? "regular"])).toEqual([
      [770, "pre"], [771, "pre"], [772, "regular"], [769.49, "regular"], [769.3, "post"], [764.74, "post"],
    ]);
  });
});

describe("splitSessions", () => {
  // Shape captured from Nasdaq /info for SPY at 19:56 ET on Oct 29, 2026.
  const afterHours = {
    marketStatus: "After-Hours",
    primaryData: { lastSalePrice: "$764.744", netChange: "-4.746", percentageChange: "-0.62%", lastTradeTimestamp: "Oct 29, 2026 7:56 PM ET" },
    secondaryData: { lastSalePrice: "$769.49", netChange: "-2.82", percentageChange: "-0.37%", lastTradeTimestamp: "Closed at Oct 29, 2026 4:00 PM ET" },
  };

  it("after hours: the regular close is the price, the after-hours trade is separate", () => {
    const { regular, extended } = splitSessions(afterHours);
    expect(regular).toEqual({ price: 769.49, change: -2.82, changePercent: -0.37 });
    expect(extended).toEqual({ session: "post", price: 764.744, change: -4.746, changePercent: -0.62, time: "7:56 PM ET" });
  });

  it("pre-market is labelled pre", () => {
    const pre = { ...afterHours, marketStatus: "Pre-Market", primaryData: { ...afterHours.primaryData, lastTradeTimestamp: "Oct 30, 2026 8:05 AM ET" } };
    expect(splitSessions(pre).extended).toMatchObject({ session: "pre", time: "8:05 AM ET" });
  });

  it("regular hours (no closed secondary): primary is the price, no extended", () => {
    const open = { marketStatus: "Market Open", primaryData: afterHours.primaryData, secondaryData: null };
    expect(splitSessions(open)).toEqual({ regular: { price: 764.744, change: -4.746, changePercent: -0.62 }, extended: null });
  });

  it("an empty secondary price is not mistaken for a $0 close", () => {
    const blank = { ...afterHours, secondaryData: { ...afterHours.secondaryData, lastSalePrice: "" } };
    expect(splitSessions(blank).extended).toBeNull();
    expect(splitSessions(blank).regular.price).toBe(764.744);
  });

  it("ignores junk input", () => {
    expect(splitSessions(null)).toEqual({ regular: { price: null, change: null, changePercent: null }, extended: null });
    expect(splitSessions({ primaryData: { percentageChange: "abc%" } }).regular.changePercent).toBeNull();
  });
});

describe("yahooExtended", () => {
  const base = { regularMarketPrice: 769.49, postMarketPrice: 764.74, postMarketChange: -4.75, postMarketChangePercent: -0.617, postMarketTime: 1793318160 };
  it("post / closed states use postMarket fields", () => {
    expect(yahooExtended({ ...base, marketState: "POST" })).toMatchObject({ session: "post", price: 764.74, change: -4.75 });
    expect(yahooExtended({ ...base, marketState: "CLOSED" })?.session).toBe("post");
    expect(yahooExtended({ ...base, marketState: "POST" })?.time).toMatch(/^\d{1,2}:\d{2} [AP]M ET$/);
  });
  it("regular hours or missing price gives nothing", () => {
    expect(yahooExtended({ ...base, marketState: "REGULAR" })).toBeNull();
    expect(yahooExtended({ marketState: "PRE", preMarketPrice: 0 })).toBeNull();
    expect(yahooExtended({ marketState: "PRE", preMarketPrice: 771.2 })).toMatchObject({ session: "pre", price: 771.2, time: null });
  });
});
