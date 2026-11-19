import { z } from "zod";

// The request body for POST /:id/credit-spreads (issue #51): a single underlying
// symbol/option_type/expiration shared by both legs, plus each leg's own strike
// and price and one shared quantity/executed_at. Because both legs are built from
// these shared fields (see buildCreditSpreadLegs in routes/portfolio.ts), the
// "same underlying/option_type/expiration" and "opposite sides" invariants from
// ADR-0004 can't actually be violated through this endpoint — they're enforced by
// construction. validateCreditSpreadLegs below still checks all four invariants
// generically (not just the two reachable from this schema) since ADR-0004 scopes
// them to any two Transactions sharing a spread_id, not just ones submitted via
// this specific request shape.
export const creditSpreadRequestSchema = z.object({
  symbol: z.string().min(1).max(12).transform((s) => s.toUpperCase()),
  option_type: z.enum(["CALL", "PUT"]),
  expiration: z.string().min(1),
  quantity: z.number().positive(),
  executed_at: z.string().min(1),
  short_strike: z.number().positive(),
  short_price: z.number().nonnegative(),
  long_strike: z.number().positive(),
  long_price: z.number().nonnegative(),
});

export type CreditSpreadRequest = z.infer<typeof creditSpreadRequestSchema>;

/**
 * The subset of a Transaction's fields the credit-spread invariants (ADR-0004)
 * are checked against. option_type/strike/expiration admit `undefined` only to
 * match Tx's inferred type (see schemas/transaction.ts); txSchema's own
 * validation already guarantees they're non-undefined (in fact non-null) for
 * an OPTION row by the time a Tx reaches this function.
 */
export type SpreadLegInput = {
  symbol: string;
  side: "BUY" | "SELL";
  option_type?: "CALL" | "PUT" | null;
  expiration?: string | null;
  strike?: number | null;
  price: number;
};

/**
 * Checks the four ADR-0004 invariants for two Transactions meant to share a
 * spread_id: opposite sides, same symbol/option_type/expiration, different
 * strikes, and a net credit (the SELL leg's price exceeds the BUY leg's).
 * Returns one human-readable message per violated invariant (empty if valid).
 * The net-credit check is skipped when both legs have the same side, since
 * "short"/"long" isn't determinable in that case and a net-credit message
 * would just be confusing on top of the same-side error.
 */
export function validateCreditSpreadLegs(legA: SpreadLegInput, legB: SpreadLegInput): string[] {
  const errors: string[] = [];

  const oppositeSides = legA.side !== legB.side;
  if (!oppositeSides) {
    errors.push("both legs must have opposite sides (one SELL, one BUY)");
  }

  if (legA.symbol !== legB.symbol) {
    errors.push("both legs must share the same underlying symbol");
  }
  if (legA.option_type !== legB.option_type) {
    errors.push("both legs must share the same option_type");
  }
  if (legA.expiration !== legB.expiration) {
    errors.push("both legs must share the same expiration");
  }

  if (legA.strike === legB.strike) {
    errors.push("legs must have different strikes");
  }

  if (oppositeSides) {
    const shortLeg = legA.side === "SELL" ? legA : legB;
    const longLeg = legA.side === "SELL" ? legB : legA;
    if (!(shortLeg.price > longLeg.price)) {
      errors.push("net credit required: the SELL leg's price must exceed the BUY leg's price");
    }
  }

  return errors;
}
