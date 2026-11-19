import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { history, quote } from "./finnhub.js";

const ORIGINAL_KEY = process.env.FINNHUB_API_KEY;

beforeEach(() => {
  process.env.FINNHUB_API_KEY = "test-key";
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.FINNHUB_API_KEY;
  else process.env.FINNHUB_API_KEY = ORIGINAL_KEY;
  vi.unstubAllGlobals();
});

function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("finnhub provider", () => {
  it("throws a clear error naming the missing env var before attempting any fetch", async () => {
    delete process.env.FINNHUB_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(quote("AAPL")).rejects.toThrow(/FINNHUB_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps Finnhub's /quote response into the full Quote shape", async () => {
    mockFetchOnce({ c: 150.5, d: 1.2, dp: 0.8, h: 151, l: 149, o: 149.5, pc: 149.3, t: 1700000000 });
    const q = await quote("AAPL");
    expect(q).toEqual({
      symbol: "AAPL",
      name: null,
      price: 150.5,
      change: 1.2,
      changePercent: 0.8,
      open: 149.5,
      high: 151,
      low: 149,
      previousClose: 149.3,
      bid: null,
      ask: null,
      volume: null,
      avgVolume: null,
      marketCap: null,
      pe: null,
      eps: null,
      dividendYield: null,
      week52High: null,
      week52Low: null,
      beta: null,
      sharesOutstanding: null,
      currency: null,
      exchange: null,
      marketState: null,
      time: 1700000000,
      source: "finnhub",
    });
  });

  it("throws rather than returning a zeroed-out fake quote for an unknown symbol", async () => {
    mockFetchOnce({ c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0, t: 0 });
    await expect(quote("BOGUS")).rejects.toThrow();
  });

  it("zips Finnhub's parallel candle arrays into Candle[]", async () => {
    mockFetchOnce({
      s: "ok",
      t: [1700000000, 1700086400],
      o: [100, 101],
      h: [102, 103],
      l: [99, 100],
      c: [101, 102],
      v: [1000, 1100],
    });
    const candles = await history("AAPL", "1M");
    expect(candles).toEqual([
      { time: 1700000000, open: 100, high: 102, low: 99, close: 101, volume: 1000 },
      { time: 1700086400, open: 101, high: 103, low: 100, close: 102, volume: 1100 },
    ]);
  });

  it("throws on Finnhub's own no_data signal", async () => {
    mockFetchOnce({ s: "no_data" });
    await expect(history("AAPL", "1M")).rejects.toThrow();
  });

  it("fails fast when a request hangs past PROVIDER_FETCH_TIMEOUT_MS instead of hanging forever", async () => {
    const ORIGINAL_TIMEOUT = process.env.PROVIDER_FETCH_TIMEOUT_MS;
    process.env.PROVIDER_FETCH_TIMEOUT_MS = "50";
    vi.resetModules();
    try {
      const fetchMock = vi.fn((_url: string, opts?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      const { quote: quoteFresh } = await import("./finnhub.js");
      const start = Date.now();
      await expect(quoteFresh("AAPL")).rejects.toThrow();
      expect(Date.now() - start).toBeLessThan(1000);
    } finally {
      if (ORIGINAL_TIMEOUT === undefined) delete process.env.PROVIDER_FETCH_TIMEOUT_MS;
      else process.env.PROVIDER_FETCH_TIMEOUT_MS = ORIGINAL_TIMEOUT;
      vi.resetModules();
    }
  });
});
