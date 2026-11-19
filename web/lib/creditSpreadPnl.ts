// Pure math for a CREDIT_SPREAD position's live mark-to-market, mirroring how
// web/lib/creditSpread.ts split the credit-spread form-validation math out of
// PortfolioWidget.tsx. Lets both the per-row display (issue #54 Part A) and
// the portfolio-totals reducer (issue #54 Part B) share one computation
// instead of duplicating it, which is the kind of duplication the #52
// server-side code review flagged.
export type CreditSpreadPnlInput = {
  /** Contracts still open on both legs (the server's `quantity`, already the
   * smaller of the two legs' remaining size — see `GET /:id/positions`). */
  quantity: number;
  /** Total dollar net credit received, already scaled by multiplier*quantity
   * server-side (server/src/routes/portfolio.ts `netCredit`) — not per-contract. */
  netCredit: number;
  multiplier: number;
  /** The short leg's current last price from the options chain, or null if
   * the chain hasn't loaded yet / this strike isn't in it. */
  shortLastPrice: number | null;
  /** The long leg's current last price from the same chain fetch. */
  longLastPrice: number | null;
};

export type CreditSpreadPnl = {
  /** What it would cost right now to close the spread: buy back the short
   * leg, sell the long leg. Null if either leg's live price is unknown. */
  currentCostToClose: number | null;
  /** netCredit minus the current cost to close — positive once the spread
   * has decayed in the seller's favor. Null if currentCostToClose is null. */
  unrealizedPnl: number | null;
  /** -currentCostToClose. Paired with `costBasis` so that, exactly like the
   * existing single-leg totals (`mv - avgCost*qty*multiplier`), plain
   * `marketValue - costBasis` recovers `unrealizedPnl` without a spread-
   * specific branch in the aggregate reducer. Null if currentCostToClose is
   * null. */
  marketValue: number | null;
  /** -netCredit. Always computable (doesn't depend on live chain prices), so
   * a spread's contribution to portfolio "cost" is never NaN even before the
   * chain loads. */
  costBasis: number;
};

export function computeCreditSpreadPnl(input: CreditSpreadPnlInput): CreditSpreadPnl {
  const { quantity, netCredit, multiplier, shortLastPrice, longLastPrice } = input;
  const costBasis = -netCredit;

  if (shortLastPrice === null || longLastPrice === null) {
    return { currentCostToClose: null, unrealizedPnl: null, marketValue: null, costBasis };
  }

  const currentCostToClose = (shortLastPrice - longLastPrice) * multiplier * quantity;
  const unrealizedPnl = netCredit - currentCostToClose;
  const marketValue = -currentCostToClose;
  return { currentCostToClose, unrealizedPnl, marketValue, costBasis };
}
