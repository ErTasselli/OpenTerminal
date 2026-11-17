import { describe, expect, it } from "vitest";
import { b3Ticker, isB3Symbol, isForeignListing, isUsListing, toProviderSymbol } from "./providerSymbol.js";

describe("toProviderSymbol", () => {
  it("adds .SA to bare B3 tickers (stocks, units, FIIs, BDRs)", () => {
    for (const s of ["PETR4", "VALE3", "AUVP11", "BPAC11", "AAPL34"]) {
      expect(toProviderSymbol(s)).toBe(`${s}.SA`);
    }
  });

  it("leaves US, suffixed, crypto and index symbols untouched", () => {
    for (const s of ["AAPL", "BRK.B", "PETR4.SA", "VALE3.BA", "ISP.MI", "BTC", "^VIX", "PETR4F", "A1", "GOOGL"]) {
      expect(toProviderSymbol(s)).toBe(s);
    }
  });
});

describe("isB3Symbol / b3Ticker", () => {
  it("recognizes B3 listings bare or suffixed, and nothing else", () => {
    expect(isB3Symbol("PETR4")).toBe(true);
    expect(isB3Symbol("PETR4.SA")).toBe(true);
    expect(isB3Symbol("IFIX.SA")).toBe(true);
    expect(isB3Symbol("VALE3.BA")).toBe(false);
    expect(isB3Symbol("AAPL")).toBe(false);
  });

  it("strips the Yahoo suffix", () => {
    expect(b3Ticker("PETR4.SA")).toBe("PETR4");
    expect(b3Ticker("PETR4")).toBe("PETR4");
  });
});

describe("isUsListing", () => {
  it("is true for US tickers, including dotted share classes", () => {
    for (const s of ["AAPL", "BRK.B", "BF.B", "SPY"]) expect(isUsListing(s)).toBe(true);
  });

  it("is false for foreign listings (bare B3 included), FX pairs, futures and indexes", () => {
    for (const s of ["PETR4", "PETR4.SA", "VALE3.BA", "VOD.L", "7203.T", "SAP.DE", "BRLUSD=X", "GC=F", "^BVSP", "^GSPC"]) {
      expect(isUsListing(s)).toBe(false);
    }
  });
});

describe("isForeignListing", () => {
  it("is true only for listings on non-US exchanges (bare B3 included)", () => {
    for (const s of ["PETR4", "PETR4.SA", "VALE3.BA", "VOD.L", "7203.T", "SAP.DE"]) expect(isForeignListing(s)).toBe(true);
    for (const s of ["AAPL", "BRK.B", "^SPX", "^VIX", "BRLUSD=X", "GC=F"]) expect(isForeignListing(s)).toBe(false);
  });
});
