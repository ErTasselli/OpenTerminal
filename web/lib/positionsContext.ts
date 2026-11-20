// The full position shapes returned by GET /api/portfolios/:id/positions (see
// server/src/routes/portfolio.ts and PortfolioWidget.tsx's SingleLegPosition/
// CreditSpreadPosition split, mirrored here). Issue #65: AiWidget.tsx used to map every
// position down to a hand-picked `{ symbol, instrumentType, quantity, avgCost }` subset
// before sending it to the model as context, which silently dropped every
// CREDIT_SPREAD-specific field -- and avgCost doesn't even exist on that shape, so a
// credit-spread position arrived to the model essentially empty, which is why the
// assistant used to claim it couldn't see credit-spread positions at all. Per
// CONTEXT.md's Tool Call glossary entry, positions are auto-injected plain context (not
// a Tool Call), so the fix is to forward the full object the server already computed,
// not to fetch anything new (e.g. no live quotes/unrealized P&L -- that's get_quote's job).
export type SingleLegPositionSnapshot = {
  symbol: string;
  instrumentType: "EQUITY" | "OPTION";
  optionType: "CALL" | "PUT" | null;
  strike: number | null;
  expiration: string | null;
  quantity: number;
  avgCost: number;
  realizedPnl: number;
  multiplier: number;
};
export type CreditSpreadPositionSnapshot = {
  symbol: string;
  instrumentType: "CREDIT_SPREAD";
  optionType: "CALL" | "PUT" | null;
  expiration: string | null;
  shortStrike: number;
  longStrike: number;
  quantity: number;
  shortQuantity: number;
  longQuantity: number;
  netCredit: number;
  maxRisk: number;
  realizedPnl: number;
  multiplier: number;
};
export type PositionSnapshot = SingleLegPositionSnapshot | CreditSpreadPositionSnapshot;

/**
 * Builds the `context.positions` value AiWidget.tsx sends to the model from a raw
 * GET /:id/positions response -- or undefined if there's nothing to report, so an
 * empty portfolio doesn't add a stray empty array to the context payload. Forwards
 * every field on every position untouched (issue #65) instead of picking a subset,
 * since different instrument types (EQUITY/OPTION vs. CREDIT_SPREAD) have different
 * fields and a hand-picked subset silently drops whichever ones it didn't list.
 */
export function buildPositionsContext(positions: PositionSnapshot[]): PositionSnapshot[] | undefined {
  return positions.length > 0 ? positions : undefined;
}
