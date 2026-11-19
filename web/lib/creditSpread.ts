// Client-side mirror of two of the four ADR-0004 invariants validated server-side
// by validateCreditSpreadLegs (server/src/schemas/creditSpread.ts): different
// strikes and net credit (short price > long price). The other two invariants
// (same underlying/option_type/expiration, opposite sides) can't be violated
// through this form's shape — it submits one shared symbol/option_type/expiration
// and always builds short=SELL/long=BUY — so they aren't re-checked here.
export type CreditSpreadFormInput = {
  symbol: string;
  optionType: "CALL" | "PUT";
  expiration: string;
  quantity: string;
  shortStrike: string;
  shortPrice: string;
  longStrike: string;
  longPrice: string;
};

function isPositiveNumber(value: string): boolean {
  const n = Number(value);
  return value.trim() !== "" && isFinite(n) && n > 0;
}

function isNonNegativeNumber(value: string): boolean {
  const n = Number(value);
  return value.trim() !== "" && isFinite(n) && n >= 0;
}

export function validateCreditSpreadForm(input: CreditSpreadFormInput): string | null {
  if (!input.symbol.trim()) return "symbol is required";
  if (!input.expiration.trim()) return "expiration is required";
  if (!isPositiveNumber(input.quantity)) return "quantity must be a positive number";
  if (!isPositiveNumber(input.shortStrike)) return "short strike must be a positive number";
  if (!isPositiveNumber(input.longStrike)) return "long strike must be a positive number";
  if (!isNonNegativeNumber(input.shortPrice)) return "short price must be a non-negative number";
  if (!isNonNegativeNumber(input.longPrice)) return "long price must be a non-negative number";

  if (Number(input.shortStrike) === Number(input.longStrike)) {
    return "legs must have different strikes";
  }

  if (!(Number(input.shortPrice) > Number(input.longPrice))) {
    return "net credit required: the short leg's price must exceed the long leg's price";
  }

  return null;
}
