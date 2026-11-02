import { afterEach, describe, expect, it, vi } from "vitest";
import { executeTool } from "./tools.js";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI tools", () => {
  it("fetches a quote through the internal market API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          symbol: "AAPL",
          name: "Apple Inc",
          price: 230.5,
          change: 2.5,
          changePercent: 1.1,
          volume: 1000,
          source: "schwab",
        },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeTool("get_quote", { symbol: "aapl" });

    expect(result.isError).toBe(false);
    expect(result.execution).toMatchObject({ name: "get_quote", ok: true });
    expect(JSON.parse(result.content)).toMatchObject({ symbol: "AAPL", price: 230.5 });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/quotes?symbols=AAPL");
  });

  it("summarizes the strikes nearest the money", async () => {
    const strikes = Array.from({ length: 31 }, (_, i) => 70 + i * 2);
    const contract = (strike: number) => ({
      strike,
      lastPrice: strike + 1,
      bid: strike,
      ask: strike + 2,
      volume: 10,
      openInterest: 20,
      impliedVolatility: 0.285,
      inTheMoney: strike < 100,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          symbol: "TEST",
          underlyingPrice: 100,
          expirationDates: ["2026-11-20"],
          selectedDate: "2026-11-20",
          calls: strikes.map(contract),
          puts: strikes.map(contract),
        })
      )
    );

    const result = await executeTool("get_option_chain", { symbol: "TEST" });
    const data = JSON.parse(result.content);

    expect(result.isError).toBe(false);
    expect(data.underlyingPrice).toBe(100);
    expect(data.calls).toHaveLength(10);
    expect(data.puts).toHaveLength(10);
    expect(data.calls.map((c: { strike: number }) => c.strike)).toEqual([
      90, 92, 94, 96, 98, 100, 102, 104, 106, 108,
    ]);
    expect(data.calls[0].ivPercent).toBe(28.5);
  });

  it("limits news results", async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      title: `Headline ${i}`,
      publisher: "Test",
      publishedAt: "2026-11-02T00:00:00Z",
      link: `https://example.test/${i}`,
      symbol: "AAPL",
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(items)));

    const result = await executeTool("get_news", { symbol: "AAPL", limit: 3 });
    const data = JSON.parse(result.content);

    expect(result.isError).toBe(false);
    expect(data.items).toHaveLength(3);
    expect(data.items[0]).toMatchObject({ title: "Headline 0", publisher: "Test" });
  });

  it("rejects malformed symbols before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeTool("get_quote", { symbol: "AAPL; rm -rf /" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("symbol may contain");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces upstream market errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "All data providers are unavailable" }, 502))
    );

    const result = await executeTool("get_insider_transactions", { symbol: "AAPL" });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("All data providers are unavailable");
    expect(result.execution.ok).toBe(false);
  });

  it("rejects unknown tools", async () => {
    const result = await executeTool("delete_portfolio", {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("unknown tool");
  });
});
