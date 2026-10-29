import { z } from "zod";

// A single transform stage both validates the OPTION-only fields and nulls
// them out for EQUITY rows, so the "is this an OPTION?" branch exists in one
// place instead of being duplicated across a superRefine and a transform.
// strike's positivity is checked only in the OPTION branch (not in the base
// shape below) so a stray/zero strike on an EQUITY transaction is discarded
// like the other option fields rather than 400ing.
//
// Shared by manual entry (routes/portfolio.ts) and AI-proposed Pending Actions
// (routes/pendingActions.ts) — per CONTEXT.md/ADR-0002, confirming a Pending
// Action must validate with "the same schema used for manual entry", so this
// is the one schema object both import rather than two definitions that can
// drift apart.
export const txSchema = z
  .object({
    symbol: z.string().min(1).max(12).transform((s) => s.toUpperCase()),
    side: z.enum(["BUY", "SELL"]),
    quantity: z.number().positive(),
    price: z.number().nonnegative(),
    executed_at: z.string(),
    instrument_type: z.enum(["EQUITY", "OPTION"]).default("EQUITY"),
    option_type: z.enum(["CALL", "PUT"]).nullable().optional(),
    strike: z.number().nullable().optional(),
    expiration: z.string().nullable().optional(),
  })
  .transform((data, ctx) => {
    if (data.instrument_type !== "OPTION") {
      return { ...data, option_type: null, strike: null, expiration: null };
    }
    if (data.option_type !== "CALL" && data.option_type !== "PUT") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["option_type"], message: "option_type must be CALL or PUT for an OPTION transaction" });
    }
    if (typeof data.strike !== "number" || !(data.strike > 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["strike"], message: "strike must be a positive number for an OPTION transaction" });
    }
    if (typeof data.expiration !== "string" || data.expiration.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiration"], message: "expiration is required for an OPTION transaction" });
    }
    return data;
  });

export type Tx = z.infer<typeof txSchema>;
