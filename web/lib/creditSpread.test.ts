import { describe, expect, it } from "vitest";
import { validateCreditSpreadForm, type CreditSpreadFormInput } from "./creditSpread";

const validInput: CreditSpreadFormInput = {
  symbol: "AAPL",
  optionType: "CALL",
  expiration: "2026-01-16",
  quantity: "1",
  shortStrike: "150",
  shortPrice: "2.50",
  longStrike: "155",
  longPrice: "1.00",
};

describe("validateCreditSpreadForm", () => {
  it("rejects a missing symbol", () => {
    expect(validateCreditSpreadForm({ ...validInput, symbol: "" })).toBe("symbol is required");
  });

  it("rejects a missing expiration", () => {
    expect(validateCreditSpreadForm({ ...validInput, expiration: "" })).toBe("expiration is required");
  });

  it("rejects a missing/non-numeric quantity", () => {
    expect(validateCreditSpreadForm({ ...validInput, quantity: "" })).toBe("quantity must be a positive number");
    expect(validateCreditSpreadForm({ ...validInput, quantity: "abc" })).toBe("quantity must be a positive number");
    expect(validateCreditSpreadForm({ ...validInput, quantity: "0" })).toBe("quantity must be a positive number");
    expect(validateCreditSpreadForm({ ...validInput, quantity: "-1" })).toBe("quantity must be a positive number");
  });

  it("rejects missing/non-numeric/non-positive strikes", () => {
    expect(validateCreditSpreadForm({ ...validInput, shortStrike: "" })).toBe("short strike must be a positive number");
    expect(validateCreditSpreadForm({ ...validInput, shortStrike: "abc" })).toBe("short strike must be a positive number");
    expect(validateCreditSpreadForm({ ...validInput, shortStrike: "0" })).toBe("short strike must be a positive number");
    expect(validateCreditSpreadForm({ ...validInput, longStrike: "" })).toBe("long strike must be a positive number");
    expect(validateCreditSpreadForm({ ...validInput, longStrike: "-5" })).toBe("long strike must be a positive number");
  });

  it("rejects missing/non-numeric/negative prices", () => {
    expect(validateCreditSpreadForm({ ...validInput, shortPrice: "" })).toBe("short price must be a non-negative number");
    expect(validateCreditSpreadForm({ ...validInput, shortPrice: "abc" })).toBe("short price must be a non-negative number");
    expect(validateCreditSpreadForm({ ...validInput, shortPrice: "-1" })).toBe("short price must be a non-negative number");
    expect(validateCreditSpreadForm({ ...validInput, longPrice: "" })).toBe("long price must be a non-negative number");
    expect(validateCreditSpreadForm({ ...validInput, longPrice: "-1" })).toBe("long price must be a non-negative number");
  });

  it("rejects equal strikes", () => {
    expect(validateCreditSpreadForm({ ...validInput, shortStrike: "150", longStrike: "150" })).toBe(
      "legs must have different strikes"
    );
  });

  it("rejects a net debit (short price less than long price)", () => {
    expect(validateCreditSpreadForm({ ...validInput, shortPrice: "1.00", longPrice: "2.50" })).toBe(
      "net credit required: the short leg's price must exceed the long leg's price"
    );
  });

  it("rejects a net-zero spread (short price equal to long price)", () => {
    expect(validateCreditSpreadForm({ ...validInput, shortPrice: "1.50", longPrice: "1.50" })).toBe(
      "net credit required: the short leg's price must exceed the long leg's price"
    );
  });

  it("accepts a valid credit spread", () => {
    expect(validateCreditSpreadForm(validInput)).toBeNull();
  });
});
