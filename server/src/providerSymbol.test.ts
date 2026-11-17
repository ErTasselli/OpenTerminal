import { describe, expect, it } from "vitest";
import { toProviderSymbol } from "./providerSymbol.js";

describe("toProviderSymbol", () => {
  it("adds .SA to bare B3 tickers (stocks, units, FIIs, BDRs)", () => {
    for (const s of ["PETR4", "VALE3", "AUVP11", "BPAC11", "AAPL34"]) {
      expect(toProviderSymbol(s)).toBe(`${s}.SA`);
    }
  });

  it("leaves US, suffixed, crypto and index symbols untouched", () => {
    for (const s of ["AAPL", "BRK.B", "PETR4.SA", "ISP.MI", "BTC", "^VIX", "PETR4F", "A1", "GOOGL"]) {
      expect(toProviderSymbol(s)).toBe(s);
    }
  });
});
