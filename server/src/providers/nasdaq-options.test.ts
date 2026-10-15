import { afterEach, describe, expect, it, vi } from "vitest";
import { optionChain } from "./nasdaq.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mockChain() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-12-15T12:00:00Z"));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: {
      lastTrade: "LAST TRADE: $100",
      table: { rows: [
        { expiryDate: "Dec 18", strike: "100", c_Last: "5", p_Last: "4" },
        { expiryDate: "Jan 15", strike: "100", c_Last: "7", p_Last: "6" },
      ] },
    } }),
  }));
}

describe("Nasdaq option expirations", () => {
  it("returns ISO expirations with the correct year across New Year", async () => {
    mockChain();
    const chain = await optionChain("AAPL", "2027-01-15");
    expect(chain.expirationDates).toEqual(["2026-12-18", "2027-01-15"]);
    expect(chain.selectedDate).toBe("2027-01-15");
    expect(chain.calls[0].lastPrice).toBe(7);
  });

  it("rejects a missing requested expiration so another provider can try it", async () => {
    mockChain();
    await expect(optionChain("AAPL", "2027-02-19")).rejects.toThrow("requested expiry unavailable");
  });

  it("keeps the first available expiry when none was requested", async () => {
    mockChain();
    expect((await optionChain("AAPL")).selectedDate).toBe("2026-12-18");
  });
});
