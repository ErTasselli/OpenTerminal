import { describe, expect, it } from "vitest";
import {
  mapSchwabCandles,
  mapSchwabOptionChain,
  mapSchwabQuote,
  mapSchwabSearch,
} from "./schwab.js";
import { parseLevelOne } from "./schwabStreamer.js";

describe("Schwab market data mapping", () => {
  it("normalizes a quote and converts yield percentages to fractions", () => {
    const quote = mapSchwabQuote("AAPL", {
      symbol: "AAPL",
      quote: {
        lastPrice: 230.5,
        closePrice: 228,
        netChange: 2.5,
        netPercentChange: 1.096,
        openPrice: 229,
        highPrice: 231,
        lowPrice: 227.5,
        bidPrice: 230.4,
        askPrice: 230.6,
        totalVolume: 12_345_678,
        "52WeekHigh": 260,
        "52WeekLow": 164,
        quoteTime: 1_760_000_000_000,
      },
      fundamental: {
        peRatio: 35.2,
        eps: 6.55,
        divYield: 0.44,
        sharesOutstanding: 15_000_000_000,
        avg10DaysVolume: 50_000_000,
        marketCap: 3_400_000_000_000,
      },
      reference: {
        symbol: "AAPL",
        description: "Apple Inc",
        exchange: "Q",
        exchangeName: "NASDAQ",
      },
    });

    expect(quote.price).toBe(230.5);
    expect(quote.previousClose).toBe(228);
    expect(quote.change).toBe(2.5);
    expect(quote.changePercent).toBe(1.096);
    expect(quote.dividendYield).toBeCloseTo(0.0044);
    expect(quote.sharesOutstanding).toBe(15_000_000_000);
    expect(quote.exchange).toBe("NASDAQ");
    expect(quote.time).toBe(1_760_000_000);
    expect(quote.source).toBe("schwab");
  });

  it("computes change when Schwab omits it", () => {
    const quote = mapSchwabQuote("MSFT", {
      quote: { lastPrice: 110, closePrice: 100 },
      reference: { description: "Microsoft" },
    });
    expect(quote.change).toBe(10);
    expect(quote.changePercent).toBe(10);
  });

  it("maps price history in seconds", () => {
    const candles = mapSchwabCandles([
      { datetime: 1_760_000_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
      { datetime: 1_760_000_060_000, open: 1.5, high: 2, low: 1, close: 1.8 },
      { datetime: 1_760_000_120_000, open: 1, high: 2, low: 1, close: undefined },
    ]);
    expect(candles).toEqual([
      { time: 1_760_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
      { time: 1_760_000_060, open: 1.5, high: 2, low: 1, close: 1.8, volume: 0 },
    ]);
  });

  it("maps option chains by expiration date and normalizes volatility", () => {
    const chain = mapSchwabOptionChain(
      "AAPL",
      {
        symbol: "AAPL",
        underlyingPrice: 230,
        callExpDateMap: {
          "2026-11-06:2": {
            "230.0": [
              { strikePrice: 230, last: 4.2, bid: 4.1, ask: 4.3, totalVolume: 900, openInterest: 1200, volatility: 28.5, inTheMoney: true },
            ],
          },
          "2026-11-13:9": {
            "230.0": [{ strikePrice: 230, last: 5, bid: 4.9, ask: 5.1, totalVolume: 10, openInterest: 20, volatility: 30 }],
          },
        },
        putExpDateMap: {
          "2026-11-06:2": {
            "230.0": [{ strikePrice: 230, last: 3.1, bid: 3, ask: 3.2, totalVolume: 300, openInterest: 800, volatility: 27 }],
          },
        },
      },
      "2026-11-06"
    );

    expect(chain.expirationDates).toEqual(["2026-11-06", "2026-11-13"]);
    expect(chain.selectedDate).toBe("2026-11-06");
    expect(chain.calls).toHaveLength(1);
    expect(chain.calls[0].impliedVolatility).toBeCloseTo(0.285);
    expect(chain.calls[0].inTheMoney).toBe(true);
    expect(chain.puts[0].strike).toBe(230);
  });

  it("maps instrument search results", () => {
    const results = mapSchwabSearch({
      AAPL: { symbol: "AAPL", description: "Apple Inc", exchange: "Q", assetType: "EQUITY" },
      SPY: { symbol: "SPY", description: "SPDR S&P 500 ETF", exchange: "P", assetType: "ETF" },
      "AAPL 261120C00230000": { symbol: "AAPL 261120C00230000", description: "Option", exchange: "Q", assetType: "OPTION" },
    });
    expect(results).toEqual([
      { symbol: "AAPL", name: "Apple Inc", exchange: "NASDAQ", type: "EQUITY" },
      { symbol: "SPY", name: "SPDR S&P 500 ETF", exchange: "NYSE Arca", type: "ETF" },
    ]);
  });
});

describe("Schwab streamer frame parsing", () => {
  it("accepts numeric field ids and merges partial frames", () => {
    const first = parseLevelOne({ key: "AAPL", "3": 230.5, "12": 228, "8": 1000, "35": 1_760_000_000_000 });
    expect(first).toMatchObject({ symbol: "AAPL", price: 230.5, previousClose: 228, volume: 1000, time: 1_760_000_000 });
    expect(first?.changePercent).toBeCloseTo(((230.5 - 228) / 228) * 100);

    const second = parseLevelOne({ key: "AAPL", "1": 230.4, "2": 230.6 });
    expect(second).toEqual({ symbol: "AAPL", bid: 230.4, ask: 230.6 });
  });

  it("accepts named fields", () => {
    const parsed = parseLevelOne({
      key: "MSFT",
      LAST_PRICE: 500,
      CLOSE_PRICE: 490,
      NET_CHANGE_PERCENT: 2.04,
      TRADE_TIME_MILLIS: 1_760_000_000_000,
    });
    expect(parsed).toMatchObject({
      symbol: "MSFT",
      price: 500,
      previousClose: 490,
      changePercent: 2.04,
      time: 1_760_000_000,
    });
  });

  it("ignores frames without a symbol", () => {
    expect(parseLevelOne({ "3": 10 })).toBeNull();
  });
});
