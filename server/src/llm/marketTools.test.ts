import { describe, expect, it, vi } from "vitest";

// marketTools.ts is a thin wrapper around routes/market.ts's getQuotes/getOptionChain --
// the exact provider-fallback functions GET /api/quotes and GET /api/options/:symbol
// already call (see those functions' own exports for the fallback waterfall, which is
// already covered by routes/market.test.ts). These tests mock that one reused seam so
// they exercise only the tool's own argument validation and ok/error result shaping,
// without re-testing the provider fallback itself or hitting the network.
const getQuotes = vi.fn();
const getOptionChain = vi.fn();
vi.mock("../routes/market.js", () => ({ getQuotes, getOptionChain }));

describe("runGetQuoteTool", () => {
  it("returns ok:true with the quote for a successful lookup", async () => {
    const { runGetQuoteTool } = await import("./marketTools.js");
    getQuotes.mockResolvedValueOnce([{ symbol: "AAPL", price: 150, source: "nasdaq" }]);

    const result = await runGetQuoteTool({ symbol: "aapl" });

    expect(getQuotes).toHaveBeenCalledWith(["AAPL"]);
    expect(result).toEqual({ ok: true, quote: { symbol: "AAPL", price: 150, source: "nasdaq" } });
  });

  it("returns ok:false when no provider has data for the symbol", async () => {
    const { runGetQuoteTool } = await import("./marketTools.js");
    getQuotes.mockResolvedValueOnce([]);

    const result = await runGetQuoteTool({ symbol: "ZZZZZZ" });

    expect(result).toMatchObject({ ok: false });
  });

  it("returns ok:false without calling getQuotes when symbol is missing", async () => {
    const { runGetQuoteTool } = await import("./marketTools.js");
    getQuotes.mockClear();

    const result = await runGetQuoteTool({});

    expect(result).toMatchObject({ ok: false });
    expect(getQuotes).not.toHaveBeenCalled();
  });
});

describe("runGetOptionChainTool", () => {
  it("returns ok:true with the chain for a successful lookup, uppercasing the symbol", async () => {
    const { runGetOptionChainTool } = await import("./marketTools.js");
    const chain = { symbol: "AAPL", underlyingPrice: 150, expirationDates: ["2026-12-18"], selectedDate: "2026-12-18", calls: [], puts: [] };
    getOptionChain.mockResolvedValueOnce(chain);

    const result = await runGetOptionChainTool({ symbol: "aapl" });

    expect(getOptionChain).toHaveBeenCalledWith("AAPL", undefined);
    expect(result).toEqual({ ok: true, chain });
  });

  it("passes an explicit expiry through to getOptionChain", async () => {
    const { runGetOptionChainTool } = await import("./marketTools.js");
    getOptionChain.mockResolvedValueOnce({ symbol: "AAPL", underlyingPrice: 150, expirationDates: [], selectedDate: "2026-12-18", calls: [], puts: [] });

    await runGetOptionChainTool({ symbol: "aapl", expiry: "2026-12-18" });

    expect(getOptionChain).toHaveBeenCalledWith("AAPL", "2026-12-18");
  });

  it("returns ok:false with an error message when the underlying lookup fails (bad/unknown symbol)", async () => {
    const { runGetOptionChainTool } = await import("./marketTools.js");
    getOptionChain.mockRejectedValueOnce(new Error("nasdaq: no data in response"));

    const result = await runGetOptionChainTool({ symbol: "ZZZZZZ" });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("no data");
  });

  it("returns ok:false without calling getOptionChain when symbol is missing", async () => {
    const { runGetOptionChainTool } = await import("./marketTools.js");
    getOptionChain.mockClear();

    const result = await runGetOptionChainTool({});

    expect(result).toMatchObject({ ok: false });
    expect(getOptionChain).not.toHaveBeenCalled();
  });
});
