import { afterEach, describe, expect, it, vi } from "vitest";
import { history, orderBook, quote } from "./binance.js";

function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("binance provider URL encoding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes query-string-breaking characters in orderBook's symbol", async () => {
    const fetchMock = mockFetchOnce({ bids: [], asks: [] });
    await orderBook("AAA&limit=5000");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).not.toContain("&limit=5000USDT");
    expect(url).toContain("symbol=" + encodeURIComponent("AAA&limit=5000".toUpperCase() + "USDT"));
    // exactly one `&` (the intended separator before &limit=20) survives unescaped
    expect(url.split("&").length).toBe(2);
  });

  it("encodes the symbol in quote()", async () => {
    const fetchMock = mockFetchOnce({
      lastPrice: "1", priceChange: "0", priceChangePercent: "0", openPrice: "1",
      highPrice: "1", lowPrice: "1", prevClosePrice: "1", bidPrice: "1", askPrice: "1", volume: "1",
    });
    await quote("AAA#bogus");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(encodeURIComponent("AAA#bogus".toUpperCase() + "USDT"));
    expect(url).not.toContain("#bogus");
  });

  it("encodes the symbol in history()", async () => {
    const fetchMock = mockFetchOnce([]);
    await history("AAA&x=1", "6M");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(encodeURIComponent("AAA&x=1".toUpperCase() + "USDT"));
    expect(url.split("&").length).toBe(3); // symbol, interval, limit only
  });

  it("fails fast when a request hangs past PROVIDER_FETCH_TIMEOUT_MS instead of hanging forever", async () => {
    const ORIGINAL_TIMEOUT = process.env.PROVIDER_FETCH_TIMEOUT_MS;
    process.env.PROVIDER_FETCH_TIMEOUT_MS = "50";
    vi.resetModules();
    try {
      const fetchMock = vi.fn((_url: string, opts?: { signal?: AbortSignal }) => {
        // Never resolves on its own — only rejects once the timeout's AbortSignal fires.
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      const { quote: quoteFresh } = await import("./binance.js");
      await expect(quoteFresh("BTC")).rejects.toThrow();
    } finally {
      if (ORIGINAL_TIMEOUT === undefined) delete process.env.PROVIDER_FETCH_TIMEOUT_MS;
      else process.env.PROVIDER_FETCH_TIMEOUT_MS = ORIGINAL_TIMEOUT;
      vi.resetModules();
    }
  });
});
