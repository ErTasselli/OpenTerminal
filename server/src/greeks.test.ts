import { describe, expect, it } from "vitest";
import { bsPrice, cdf, greeks, impliedVol, parseExpiry, withGreeks } from "./greeks.js";

// Reference: S=100, K=100, T=1, r=5%, sigma=20%, no dividends (Hull, standard textbook values).
const S = 100, K = 100, T = 1, r = 0.05, v = 0.2;

describe("Black-Scholes", () => {
  it("normal CDF matches known points", () => {
    expect(cdf(0)).toBeCloseTo(0.5, 7);
    expect(cdf(1.96)).toBeCloseTo(0.975, 4);
    expect(cdf(-1)).toBeCloseTo(0.158655, 5);
  });

  it("prices calls and puts to textbook values and satisfies put-call parity", () => {
    const c = bsPrice("call", S, K, T, r, v);
    const p = bsPrice("put", S, K, T, r, v);
    expect(c).toBeCloseTo(10.4506, 3);
    expect(p).toBeCloseTo(5.5735, 3);
    expect(c - p).toBeCloseTo(S - K * Math.exp(-r * T), 6);
  });

  it("computes Greeks in UI units", () => {
    const g = greeks("call", S, K, T, r, v);
    expect(g.delta).toBeCloseTo(0.6368, 3);
    expect(g.gamma).toBeCloseTo(0.01876, 4);
    expect(g.vega).toBeCloseTo(0.3752, 3); // per vol point
    expect(g.theta).toBeCloseTo(-6.414 / 365, 4); // per calendar day
    expect(greeks("put", S, K, T, r, v).delta).toBeCloseTo(0.6368 - 1, 3);
  });

  it("recovers the volatility that produced a price", () => {
    for (const [right, k, sigma] of [["call", 90, 0.35], ["put", 110, 0.15], ["call", 130, 0.6]] as const) {
      const price = bsPrice(right, S, k, 0.25, r, sigma);
      expect(impliedVol(right, price, S, k, 0.25, r)).toBeCloseTo(sigma, 4);
    }
  });

  it("returns null for prices outside no-arbitrage bounds", () => {
    expect(impliedVol("call", 0.5, S, 50, 1, r)).toBeNull(); // below intrinsic
    expect(impliedVol("call", 120, S, 100, 1, r)).toBeNull(); // above the stock price
    expect(impliedVol("put", 0, S, 100, 1, r)).toBeNull();
  });
});

describe("parseExpiry", () => {
  const now = new Date("2026-10-14T15:00:00Z");
  it("reads ISO dates as 16:00 New York", () => {
    expect(parseExpiry("2026-10-16", now)?.toISOString()).toBe("2026-10-16T20:00:00.000Z");
    expect(parseExpiry("2026-12-18", now)?.toISOString()).toBe("2026-12-18T21:00:00.000Z"); // EST
  });
  it("reads Nasdaq's year-less labels as the next occurrence", () => {
    expect(parseExpiry("Oct 14", now)?.toISOString()).toBe("2026-10-14T20:00:00.000Z"); // today
    expect(parseExpiry("Jan 15", now)?.getUTCFullYear()).toBe(2027);
    expect(parseExpiry("Jan 15, 2027", now)?.getUTCFullYear()).toBe(2027);
  });
  it("rejects nonsense", () => {
    for (const bad of ["", "Foo 12", "2026-02-30", "Feb 30", "next friday"]) expect(parseExpiry(bad, now)).toBeNull();
  });
});

describe("withGreeks", () => {
  const now = new Date("2026-10-14T15:00:00Z");
  const expiry = new Date("2027-01-15T21:00:00Z");
  it("solves IV from the mid price and attaches Greeks", () => {
    const price = bsPrice("call", S, 105, (expiry.getTime() - now.getTime()) / (365 * 86_400_000), 0.04, 0.3);
    const [row] = withGreeks([{ strike: 105, bid: price - 0.05, ask: price + 0.05, lastPrice: 1 }], "call", S, expiry, 0.04, now);
    expect(row.greeks?.iv).toBeCloseTo(0.3, 3);
    expect(row.greeks?.delta).toBeGreaterThan(0);
    expect(row.greeks?.delta).toBeLessThan(1);
  });
  it("prefers a provider-supplied IV", () => {
    const [row] = withGreeks([{ strike: 100, bid: 1, ask: 2, lastPrice: 1, impliedVolatility: 0.42 }], "put", S, expiry, 0.04, now);
    expect(row.greeks?.iv).toBe(0.42);
  });
  it("yields null Greeks instead of throwing on unusable rows", () => {
    const rows = withGreeks(
      [{ strike: null, bid: 1, ask: 2, lastPrice: 1 }, { strike: 100, bid: null, ask: null, lastPrice: null }],
      "call", S, expiry, 0.04, now
    );
    expect(rows.map((x) => x.greeks)).toEqual([null, null]);
    expect(withGreeks([{ strike: 100, bid: 1, ask: 2, lastPrice: 1 }], "call", null, expiry, 0.04, now)[0].greeks).toBeNull();
    expect(withGreeks([{ strike: 100, bid: 1, ask: 2, lastPrice: 1 }], "call", S, null, 0.04, now)[0].greeks).toBeNull();
  });
  it("stays finite on expiry day", () => {
    const [row] = withGreeks([{ strike: 100, bid: 0.4, ask: 0.6, lastPrice: 0.5 }], "call", S, new Date("2026-10-14T20:00:00Z"), 0.04, new Date("2026-10-14T19:59:00Z"));
    if (row.greeks) for (const n of Object.values(row.greeks)) expect(Number.isFinite(n)).toBe(true);
  });
});
