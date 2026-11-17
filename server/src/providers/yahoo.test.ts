import { afterEach, describe, expect, it, vi } from "vitest";
import { history, quoteFromChart } from "./yahoo.js";

afterEach(() => vi.unstubAllGlobals());

function stubChart(result: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ chart: { result: [result] } }) }));
}

// Shape Yahoo returns for B3 listings after the close: the latest session has
// open/high/low = 0 and volume 0, with only the close (last price) filled in.
const afterHoursB3 = {
  meta: { symbol: "PETR4.SA", regularMarketPrice: 44.02, chartPreviousClose: 45.3, regularMarketDayHigh: 0, regularMarketDayLow: 0, regularMarketVolume: 0, currency: "BRL" },
  timestamp: [1794574800, 1794661200, 1794747600, 1794882730],
  indicators: {
    quote: [
      {
        open: [44.89, 45.0, 0, 0],
        high: [45.44, 45.6, 0, 0],
        low: [44.62, 44.9, 0, 0],
        close: [45.3, 45.3, null, 44.02],
        volume: [23439200, 21000000, 0, 0],
      },
    ],
  },
};

describe("yahoo zero day ranges (B3 after hours)", () => {
  it("drops close-less bars and rebuilds a zero-range bar from the previous close", async () => {
    stubChart(afterHoursB3);
    const candles = await history("PETR4.SA", "5d", "1d");
    expect(candles).toHaveLength(3);
    expect(candles.every((c) => c.low > 0)).toBe(true);
    expect(candles[2]).toEqual({ time: 1794882730, open: 45.3, high: 45.3, low: 44.02, close: 44.02, volume: 0 });
  });

  it("reports a zero session range and volume as missing in the quote", async () => {
    stubChart(afterHoursB3);
    const q = await quoteFromChart("PETR4.SA");
    expect(q).toMatchObject({ price: 44.02, high: null, low: null, volume: null, previousClose: 45.3 });
  });

  it("keeps real session data untouched", async () => {
    stubChart({
      ...afterHoursB3,
      meta: { ...afterHoursB3.meta, regularMarketDayHigh: 45.39, regularMarketDayLow: 43.65, regularMarketVolume: 30506500 },
    });
    const q = await quoteFromChart("PETR4.SA");
    expect(q).toMatchObject({ high: 45.39, low: 43.65, volume: 30506500 });
  });
});
