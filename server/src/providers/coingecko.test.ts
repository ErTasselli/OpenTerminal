import { afterEach, describe, expect, it, vi } from "vitest";
import { globalStats, markets } from "./coingecko.js";

function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("coingecko provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps the markets response into CryptoRow shape", async () => {
    mockFetchOnce([
      {
        id: "bitcoin",
        symbol: "btc",
        name: "Bitcoin",
        current_price: 50000,
        price_change_percentage_24h: 1.5,
        market_cap: 1_000_000_000,
        total_volume: 500_000,
        market_cap_rank: 1,
        sparkline_in_7d: { price: [1, 2, 3] },
      },
    ]);

    const rows = await markets();
    expect(rows).toEqual([
      {
        id: "bitcoin",
        symbol: "BTC",
        name: "Bitcoin",
        price: 50000,
        changePercent24h: 1.5,
        marketCap: 1_000_000_000,
        volume24h: 500_000,
        rank: 1,
        sparkline: [1, 2, 3],
      },
    ]);
  });

  it("throws with the status on a non-OK markets response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(markets()).rejects.toThrow("coingecko 503");
  });

  it("maps the global response into dominance stats", async () => {
    mockFetchOnce({
      data: {
        total_market_cap: { usd: 2_000_000_000 },
        market_cap_percentage: { btc: 50, eth: 20 },
      },
    });

    expect(await globalStats()).toEqual({ totalMarketCap: 2_000_000_000, btcDominance: 50, ethDominance: 20 });
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
      const { markets: marketsFresh } = await import("./coingecko.js");
      await expect(marketsFresh()).rejects.toThrow();
    } finally {
      if (ORIGINAL_TIMEOUT === undefined) delete process.env.PROVIDER_FETCH_TIMEOUT_MS;
      else process.env.PROVIDER_FETCH_TIMEOUT_MS = ORIGINAL_TIMEOUT;
      vi.resetModules();
    }
  });
});
