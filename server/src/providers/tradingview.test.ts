import { afterEach, describe, expect, it, vi } from "vitest";
import { europeMarketScan, search } from "./tradingview.js";

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
});

describe("search exchange suffixes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps B3 (BMFBOVESPA) listings to Yahoo's .SA suffix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          symbols: [
            { symbol: "<em>PETR4</em>", description: "Petroleo Brasileiro SA Pfd", exchange: "BMFBOVESPA", type: "stock" },
            { symbol: "AAPL", description: "Apple Inc.", exchange: "NASDAQ", type: "stock" },
          ],
        }),
      })
    );
    const results = await search("PETR4");
    expect(results.map((r) => r.symbol)).toEqual(["PETR4.SA", "AAPL"]);
  });
});
