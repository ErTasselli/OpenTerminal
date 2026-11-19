import { afterEach, describe, expect, it, vi } from "vitest";
import { markets } from "./kraken.js";

function mockFetchOnce(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 503,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("kraken provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a realistic Ticker response into CryptoRow shape, including Kraken's pair-renaming", async () => {
    mockFetchOnce({
      error: [],
      result: {
        // Kraken renames the legacy XBTUSD request pair to XXBTZUSD in its response.
        XXBTZUSD: { c: ["50000.5", "0.01"], o: "49000.0", v: ["1000.0", "2500.0"] },
        // Non-legacy pairs (newer assets) come back under the same symbol they were requested with.
        SOLUSD: { c: ["150.25", "10"], o: "148.0", v: ["5000.0", "9000.0"] },
      },
    });

    const rows = await markets();

    expect(rows).toEqual([
      {
        id: "XXBTZUSD",
        symbol: "BTC",
        name: "Bitcoin",
        price: 50000.5,
        changePercent24h: ((50000.5 - 49000.0) / 49000.0) * 100,
        marketCap: null,
        volume24h: 2500.0,
        rank: null,
        sparkline: [],
      },
      {
        id: "SOLUSD",
        symbol: "SOL",
        name: "Solana",
        price: 150.25,
        changePercent24h: ((150.25 - 148.0) / 148.0) * 100,
        marketCap: null,
        volume24h: 9000.0,
        rank: null,
        sparkline: [],
      },
    ]);
  });

  it("omits a ticker Kraken doesn't return instead of erroring", async () => {
    // MATICUSD is in our requested pairs, but Kraken simply doesn't include it in the response.
    mockFetchOnce({
      error: [],
      result: {
        SOLUSD: { c: ["150.25", "10"], o: "148.0", v: ["5000.0", "9000.0"] },
      },
    });

    const rows = await markets();

    expect(rows).toHaveLength(1);
    expect(rows.map((r) => r.symbol)).toEqual(["SOL"]);
  });

  it("skips a malformed ticker entry instead of discarding the rest of the already-parsed rows", async () => {
    mockFetchOnce({
      error: [],
      result: {
        // Missing c/o/v entirely — e.g. a newly-listed pair with no trade data yet.
        DOTUSD: {},
        SOLUSD: { c: ["150.25", "10"], o: "148.0", v: ["5000.0", "9000.0"] },
      },
    });

    const rows = await markets();

    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe("SOL");
  });

  it("throws when Kraken returns a non-empty error array on an HTTP 200", async () => {
    mockFetchOnce({ error: ["EQuery:Unknown asset pair"], result: {} });
    await expect(markets()).rejects.toThrow();
  });

  it("throws with the status on a non-OK response", async () => {
    mockFetchOnce({ error: [], result: {} }, false);
    await expect(markets()).rejects.toThrow("kraken 503");
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
      const { markets: marketsFresh } = await import("./kraken.js");
      await expect(marketsFresh()).rejects.toThrow();
    } finally {
      if (ORIGINAL_TIMEOUT === undefined) delete process.env.PROVIDER_FETCH_TIMEOUT_MS;
      else process.env.PROVIDER_FETCH_TIMEOUT_MS = ORIGINAL_TIMEOUT;
      vi.resetModules();
    }
  });
});
