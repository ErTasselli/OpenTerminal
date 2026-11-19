import { describe, expect, it } from "vitest";
import { validateCreditSpreadLegs } from "./creditSpread.js";

// Base pair: a genuine 2-leg credit spread per ADR-0004 — opposite sides, same
// symbol/option_type/expiration, different strikes, net credit (short price >
// long price). Each test below mutates exactly one field off this baseline so
// each failure is attributable to the invariant under test.
function shortLeg(overrides: Partial<Parameters<typeof validateCreditSpreadLegs>[0]> = {}) {
  return {
    symbol: "AAPL",
    side: "SELL" as const,
    option_type: "CALL" as const,
    expiration: "2026-06-19",
    strike: 150,
    price: 5,
    ...overrides,
  };
}
function longLeg(overrides: Partial<Parameters<typeof validateCreditSpreadLegs>[0]> = {}) {
  return {
    symbol: "AAPL",
    side: "BUY" as const,
    option_type: "CALL" as const,
    expiration: "2026-06-19",
    strike: 160,
    price: 2,
    ...overrides,
  };
}

describe("validateCreditSpreadLegs", () => {
  it("returns no errors for a genuine credit spread", () => {
    expect(validateCreditSpreadLegs(shortLeg(), longLeg())).toEqual([]);
  });

  it("rejects two legs on the same side", () => {
    const errors = validateCreditSpreadLegs(shortLeg(), longLeg({ side: "SELL" }));
    expect(errors.some((e) => /opposite sides/i.test(e))).toBe(true);
  });

  it("rejects legs with mismatched underlying symbol", () => {
    const errors = validateCreditSpreadLegs(shortLeg(), longLeg({ symbol: "MSFT" }));
    expect(errors.some((e) => /same underlying symbol/i.test(e))).toBe(true);
  });

  it("rejects legs with mismatched option_type", () => {
    const errors = validateCreditSpreadLegs(shortLeg(), longLeg({ option_type: "PUT" }));
    expect(errors.some((e) => /option_type/i.test(e))).toBe(true);
  });

  it("rejects legs with mismatched expiration", () => {
    const errors = validateCreditSpreadLegs(shortLeg(), longLeg({ expiration: "2026-07-17" }));
    expect(errors.some((e) => /expiration/i.test(e))).toBe(true);
  });

  it("rejects legs with the same strike", () => {
    const errors = validateCreditSpreadLegs(shortLeg(), longLeg({ strike: 150 }));
    expect(errors.some((e) => /different strikes/i.test(e))).toBe(true);
  });

  it("rejects a net debit (short price <= long price)", () => {
    const errors = validateCreditSpreadLegs(shortLeg({ price: 2 }), longLeg({ price: 5 }));
    expect(errors.some((e) => /net credit/i.test(e))).toBe(true);
  });

  it("rejects an exact net-zero spread (short price == long price)", () => {
    const errors = validateCreditSpreadLegs(shortLeg({ price: 3 }), longLeg({ price: 3 }));
    expect(errors.some((e) => /net credit/i.test(e))).toBe(true);
  });

  it("skips the net-credit check when sides can't be used to tell short from long", () => {
    // Both SELL: side error fires, but we shouldn't also emit a confusing
    // net-credit error since "short"/"long" isn't determinable.
    const errors = validateCreditSpreadLegs(shortLeg(), longLeg({ side: "SELL" }));
    expect(errors.some((e) => /net credit/i.test(e))).toBe(false);
  });

  it("reports multiple simultaneous violations", () => {
    const errors = validateCreditSpreadLegs(shortLeg(), longLeg({ symbol: "MSFT", strike: 150 }));
    expect(errors.some((e) => /same underlying symbol/i.test(e))).toBe(true);
    expect(errors.some((e) => /different strikes/i.test(e))).toBe(true);
  });
});
