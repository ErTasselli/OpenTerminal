import { afterEach, describe, expect, it, vi } from "vitest";
import { europeMarketScan } from "./tradingview.js";

function rowsFor(url: string): unknown[] {
  if (url.includes("/uk/scan")) {
    return [{ s: "LSE:HSBA", d: ["HSBC Holdings Plc", 850, 1.2, 300_000_000_000, "Finance", 1000, "GBP"] }];
  }
  if (url.includes("/germany/scan")) {
    return [{ s: "XETR:SAP", d: ["SAP SE", 183, -2.5, 213_000_000_000, "Technology Services", 700, "EUR"] }];
  }
  if (url.includes("/switzerland/scan")) {
    // Switzerland's response is broken this run — the merge must still return the other markets' rows.
    return null as unknown as unknown[];
  }
  return [];
}

function mockFetch() {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const rows = rowsFor(url);
    if (rows === null) return Promise.resolve({ ok: false, status: 502 });
    return Promise.resolve({ ok: true, json: async () => ({ data: rows }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("europeMarketScan", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queries every configured European market and merges the results", async () => {
    const fetchMock = mockFetch();
    const rows = await europeMarketScan();

    // One POST per market in EUROPE_MARKETS (uk, germany, france, netherlands,
    // switzerland, italy, spain, sweden, belgium) — no combined region exists.
    expect(fetchMock.mock.calls.length).toBe(9);
    expect(rows.map((r) => r.symbol).sort()).toEqual(["HSBA", "SAP"]);
  });

  it("sorts merged rows by market cap descending, largest first regardless of source market", async () => {
    mockFetch();
    const rows = await europeMarketScan();
    expect(rows[0].symbol).toBe("HSBA"); // 300B > SAP's 213B
    expect(rows[1].symbol).toBe("SAP");
  });

  it("tags each row with its country and fundamental currency for later FX normalization", async () => {
    mockFetch();
    const rows = await europeMarketScan();
    const sap = rows.find((r) => r.symbol === "SAP");
    expect(sap).toMatchObject({ country: "Germany", currency: "EUR", exchange: "XETR" });
  });

  it("keeps the rows from healthy markets when one market's request fails", async () => {
    mockFetch();
    const rows = await europeMarketScan();
    // Switzerland's fetch resolves ok:false above — europeMarketScan must not
    // reject the whole scan because of it (Promise.allSettled).
    expect(rows.length).toBe(2);
  });

  it("fails fast when a scan request hangs past PROVIDER_FETCH_TIMEOUT_MS instead of hanging forever", async () => {
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
      const { scanFundamentals } = await import("./tradingview.js");
      await expect(scanFundamentals([{ symbol: "AAPL", exchange: "NASDAQ" }])).rejects.toThrow();
    } finally {
      if (ORIGINAL_TIMEOUT === undefined) delete process.env.PROVIDER_FETCH_TIMEOUT_MS;
      else process.env.PROVIDER_FETCH_TIMEOUT_MS = ORIGINAL_TIMEOUT;
      vi.resetModules();
    }
  });
});
