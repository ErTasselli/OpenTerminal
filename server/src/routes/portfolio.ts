import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../db.js";
import { txSchema } from "../schemas/transaction.js";
import { creditSpreadRequestSchema, validateCreditSpreadLegs } from "../schemas/creditSpread.js";

export const portfolioRouter = Router();

portfolioRouter.get("/", (_req, res) => {
  res.json(db.prepare("SELECT * FROM portfolios ORDER BY id").all());
});

portfolioRouter.post("/", (req, res) => {
  const parsed = z.object({ name: z.string().min(1).max(64) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const info = db.prepare("INSERT INTO portfolios (name) VALUES (?)").run(parsed.data.name);
    res.status(201).json({ id: info.lastInsertRowid, name: parsed.data.name });
  } catch {
    res.status(409).json({ error: "portfolio name already exists" });
  }
});

portfolioRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM transactions WHERE portfolio_id = ?").run(req.params.id);
  db.prepare("DELETE FROM portfolios WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

portfolioRouter.get("/:id/transactions", (req, res) => {
  res.json(
    db
      .prepare("SELECT * FROM transactions WHERE portfolio_id = ? ORDER BY executed_at DESC, id DESC")
      .all(req.params.id)
  );
});

portfolioRouter.post("/:id/transactions", (req, res) => {
  const parsed = txSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const t = parsed.data;
  try {
    // Includes spread_id (validated, but nullable/optional, by txSchema) so a
    // manually-entered closing transaction -- e.g. buying back part of a
    // Credit Spread's short Leg -- can be linked to the spread it's closing
    // out, for GET /:id/positions (issue #52) to fold it into that spread's
    // aggregated entry instead of surfacing it as an unrelated OPTION
    // position. Before #52 this column was silently dropped on insert even
    // though txSchema already validated it.
    const info = db
      .prepare(
        "INSERT INTO transactions (portfolio_id, symbol, side, quantity, price, executed_at, instrument_type, option_type, strike, expiration, spread_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        req.params.id,
        t.symbol,
        t.side,
        t.quantity,
        t.price,
        t.executed_at,
        t.instrument_type,
        t.option_type,
        t.strike,
        t.expiration,
        t.spread_id
      );
    res.status(201).json({ id: info.lastInsertRowid, ...t });
  } catch {
    res.status(404).json({ error: "portfolio not found" });
  }
});

const insertTransaction = db.prepare(
  "INSERT INTO transactions (portfolio_id, symbol, side, quantity, price, executed_at, instrument_type, option_type, strike, expiration, spread_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
);

/**
 * POST /:id/credit-spreads (issue #51, ADR-0004): submits both Legs of a Credit
 * Spread as one linked write instead of two independent manual entries with no
 * relationship to each other. The request shares one underlying symbol/
 * option_type/expiration/quantity/executed_at across both Legs and gives each
 * its own strike + price, so the short Leg (SELL) and long Leg (BUY) it builds
 * below always match on symbol/option_type/expiration and always land on
 * opposite sides by construction. validateCreditSpreadLegs still checks all
 * four ADR-0004 invariants generically (not just the two reachable from this
 * shape — different strikes and net credit) since it scopes to any two
 * Transactions sharing a spread_id, not just ones submitted this way; see its
 * unit tests in schemas/creditSpread.test.ts for the invariants this
 * particular request body can't violate.
 *
 * Reuses txSchema (ADR-0002: the same validation must apply everywhere a
 * Transaction is written) to validate each Leg, and writes both rows in one
 * db.transaction so a spread is never persisted half-written. Does not touch
 * position-aggregation (GET /:id/positions still folds each Leg into its own
 * Position) — that's issue #52.
 */
portfolioRouter.post("/:id/credit-spreads", (req, res) => {
  const parsedReq = creditSpreadRequestSchema.safeParse(req.body);
  if (!parsedReq.success) return res.status(400).json({ error: parsedReq.error.message });
  const r = parsedReq.data;

  const spreadId = randomUUID();
  const shortLegRaw = {
    symbol: r.symbol,
    side: "SELL" as const,
    quantity: r.quantity,
    price: r.short_price,
    executed_at: r.executed_at,
    instrument_type: "OPTION" as const,
    option_type: r.option_type,
    strike: r.short_strike,
    expiration: r.expiration,
    spread_id: spreadId,
  };
  const longLegRaw = { ...shortLegRaw, side: "BUY" as const, price: r.long_price, strike: r.long_strike };

  const parsedShort = txSchema.safeParse(shortLegRaw);
  const parsedLong = txSchema.safeParse(longLegRaw);
  if (!parsedShort.success) return res.status(400).json({ error: parsedShort.error.message });
  if (!parsedLong.success) return res.status(400).json({ error: parsedLong.error.message });

  const invariantErrors = validateCreditSpreadLegs(parsedShort.data, parsedLong.data);
  if (invariantErrors.length > 0) return res.status(400).json({ error: invariantErrors.join("; ") });

  const insertSpread = db.transaction((short: typeof parsedShort.data, long: typeof parsedLong.data) => {
    const insertLeg = (t: typeof short) =>
      insertTransaction.run(
        req.params.id,
        t.symbol,
        t.side,
        t.quantity,
        t.price,
        t.executed_at,
        t.instrument_type,
        t.option_type,
        t.strike,
        t.expiration,
        t.spread_id
      );
    const shortInfo = insertLeg(short);
    const longInfo = insertLeg(long);
    return { shortId: shortInfo.lastInsertRowid, longId: longInfo.lastInsertRowid };
  });

  try {
    const { shortId, longId } = insertSpread(parsedShort.data, parsedLong.data);
    res.status(201).json({
      spread_id: spreadId,
      legs: [
        { id: shortId, ...parsedShort.data },
        { id: longId, ...parsedLong.data },
      ],
    });
  } catch {
    res.status(404).json({ error: "portfolio not found" });
  }
});

portfolioRouter.delete("/:id/transactions/:txId", (req, res) => {
  db.prepare("DELETE FROM transactions WHERE id = ? AND portfolio_id = ?").run(req.params.txId, req.params.id);
  res.status(204).end();
});

const OPTION_CONTRACT_MULTIPLIER = 100;

function multiplierFor(instrumentType: string): number {
  return instrumentType === "OPTION" ? OPTION_CONTRACT_MULTIPLIER : 1;
}

type TxRow = {
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  instrument_type: string;
  option_type: string | null;
  strike: number | null;
  expiration: string | null;
  spread_id: string | null;
};

type LegFold = { qty: number; avgPrice: number; realizedPnl: number };

/**
 * Advances one Leg's own running qty/avgPrice/realizedPnl by one of that
 * Leg's chronological Transactions. `opens` is the side that *opens or adds
 * to* this Leg -- "BUY" for an ordinary long holding (equities, and the long
 * Leg of a Credit Spread) or "SELL" for a Credit Spread's short Leg, which is
 * sold to open with no prior BUY. This generalizes the average-cost fold
 * `GET /:id/positions` already used for every non-spread position (inlined
 * below in the main loop) to the short-Leg case: that original fold assumes
 * a position only ever opens via BUY, so a bare SELL against a flat position
 * is a silent no-op there (`sold = min(quantity, 0) = 0`) -- correct for a
 * long-only holding, wrong for a Leg sold to open. The two sides' realized
 * P&L math is mirrored: a long Leg profits on (exit price − entry avg cost);
 * a short Leg profits on (entry avg credit − exit/buyback price).
 */
function stepLeg(leg: LegFold, tx: TxRow, opens: "BUY" | "SELL"): LegFold {
  const multiplier = multiplierFor(tx.instrument_type);
  if (tx.side === opens) {
    const totalCost = leg.avgPrice * leg.qty + tx.price * tx.quantity;
    const qty = leg.qty + tx.quantity;
    return { qty, avgPrice: qty > 0 ? totalCost / qty : 0, realizedPnl: leg.realizedPnl };
  }
  const closed = Math.min(tx.quantity, leg.qty);
  const pnlDelta =
    opens === "BUY"
      ? (tx.price - leg.avgPrice) * closed * multiplier
      : (leg.avgPrice - tx.price) * closed * multiplier;
  const qty = leg.qty - closed;
  return { qty, avgPrice: qty === 0 ? 0 : leg.avgPrice, realizedPnl: leg.realizedPnl + pnlDelta };
}

/**
 * Determines, for one spread_id's group of Transactions, which strike is the
 * short Leg and which is the long Leg -- or returns null if the group
 * doesn't have the 2-distinct-strikes/opposite-opening-sides shape ADR-0004
 * guarantees for a spread written via POST /:id/credit-spreads. A group can
 * fail this shape in practice if, e.g., DELETE /:id/transactions/:txId
 * removed one Leg's only row, leaving an orphaned single-strike group, or a
 * Leg's spread_id was hand-edited directly in the DB. Rather than drop those
 * Transactions from the response, the caller below falls back to folding
 * them through the ordinary non-spread composite-key path -- degrading
 * gracefully to single-leg OPTION positions instead of losing data.
 */
function classifySpreadGroup(group: TxRow[]): { shortStrike: number; longStrike: number } | null {
  const byStrike = new Map<number, TxRow[]>();
  for (const tx of group) {
    const strike = tx.strike as number;
    const legTxs = byStrike.get(strike) ?? [];
    legTxs.push(tx);
    byStrike.set(strike, legTxs);
  }
  if (byStrike.size !== 2) return null;
  // group is already in chronological (executed_at, id) order (inherited
  // from the query below), so legTxs[0] is each Leg's opening Transaction.
  const legs = [...byStrike.entries()].map(([strike, legTxs]) => ({ strike, opens: legTxs[0].side }));
  const shortLeg = legs.find((l) => l.opens === "SELL");
  const longLeg = legs.find((l) => l.opens === "BUY");
  if (!shortLeg || !longLeg) return null;
  return { shortStrike: shortLeg.strike, longStrike: longLeg.strike };
}

/**
 * Aggregated positions with average cost and realized PnL (FIFO-free,
 * average-cost method). Transactions sharing a `spread_id` (ADR-0004, issue
 * #52) are folded Leg-by-Leg and combined into one `CREDIT_SPREAD` entry
 * instead of surfacing as two unrelated OPTION positions; a null `spread_id`
 * continues to use the original composite-key fold below, unchanged.
 */
portfolioRouter.get("/:id/positions", (req, res) => {
  const txs = db
    .prepare("SELECT * FROM transactions WHERE portfolio_id = ? ORDER BY executed_at, id")
    .all(req.params.id) as TxRow[];

  // First pass: group by spread_id and classify each group's shape, so the
  // main loop below can decide per-transaction, in one pass, whether to fold
  // it as a spread Leg or through the ordinary composite-key path.
  const spreadGroups = new Map<string, TxRow[]>();
  for (const tx of txs) {
    if (tx.spread_id == null) continue;
    const group = spreadGroups.get(tx.spread_id) ?? [];
    group.push(tx);
    spreadGroups.set(tx.spread_id, group);
  }
  const validSpreads = new Map<string, { shortStrike: number; longStrike: number }>();
  for (const [spreadId, group] of spreadGroups) {
    const classified = classifySpreadGroup(group);
    if (classified) validSpreads.set(spreadId, classified);
  }

  const positions = new Map<
    string,
    {
      symbol: string;
      instrumentType: string;
      optionType: string | null;
      strike: number | null;
      expiration: string | null;
      qty: number;
      avgCost: number;
      realizedPnl: number;
    }
  >();
  const spreadStates = new Map<
    string,
    {
      symbol: string;
      optionType: string | null;
      expiration: string | null;
      shortStrike: number;
      longStrike: number;
      shortLeg: LegFold;
      longLeg: LegFold;
    }
  >();

  for (const tx of txs) {
    const spreadInfo = tx.spread_id != null ? validSpreads.get(tx.spread_id) : undefined;
    if (spreadInfo) {
      let s = spreadStates.get(tx.spread_id as string);
      if (!s) {
        s = {
          symbol: tx.symbol,
          optionType: tx.option_type,
          expiration: tx.expiration,
          shortStrike: spreadInfo.shortStrike,
          longStrike: spreadInfo.longStrike,
          shortLeg: { qty: 0, avgPrice: 0, realizedPnl: 0 },
          longLeg: { qty: 0, avgPrice: 0, realizedPnl: 0 },
        };
        spreadStates.set(tx.spread_id as string, s);
      }
      if (tx.strike === spreadInfo.shortStrike) {
        s.shortLeg = stepLeg(s.shortLeg, tx, "SELL");
      } else {
        s.longLeg = stepLeg(s.longLeg, tx, "BUY");
      }
      continue;
    }

    // JSON-encode the composite key (rather than joining with a plain
    // separator) so a symbol can't be crafted to collide with another
    // position's key — e.g. a plain `${symbol}|${strike}` join would let an
    // EQUITY symbol like "AAPL|150|2026-01-01" collide with a real option's
    // key; JSON.stringify of an array with differing lengths/types can't.
    const key =
      tx.instrument_type === "OPTION"
        ? JSON.stringify(["OPTION", tx.symbol, tx.option_type, tx.strike, tx.expiration])
        : JSON.stringify(["EQUITY", tx.symbol]);
    let p = positions.get(key);
    if (!p) {
      p = {
        symbol: tx.symbol,
        instrumentType: tx.instrument_type,
        optionType: tx.option_type,
        strike: tx.strike,
        expiration: tx.expiration,
        qty: 0,
        avgCost: 0,
        realizedPnl: 0,
      };
      positions.set(key, p);
    }
    // Reuses stepLeg (opens="BUY": every non-spread position, like a spread's
    // long Leg, only ever opens via BUY) instead of re-inlining the same
    // average-cost math a second time.
    const stepped = stepLeg({ qty: p.qty, avgPrice: p.avgCost, realizedPnl: p.realizedPnl }, tx, "BUY");
    p.qty = stepped.qty;
    p.avgCost = stepped.avgPrice;
    p.realizedPnl = stepped.realizedPnl;
  }

  const singleLegPositions = [...positions.values()]
    .filter((p) => p.qty > 0 || p.realizedPnl !== 0)
    .map((p) => ({
      symbol: p.symbol,
      instrumentType: p.instrumentType,
      optionType: p.optionType,
      strike: p.strike,
      expiration: p.expiration,
      quantity: p.qty,
      avgCost: p.avgCost,
      realizedPnl: p.realizedPnl,
      multiplier: multiplierFor(p.instrumentType),
    }));

  const spreadPositions = [...spreadStates.values()]
    .map((s) => {
      // The remaining *paired* (hedged) quantity is the smaller of the two
      // Legs' own remaining open quantity. If a manually-entered closing
      // Transaction (see the spread_id fix on POST /:id/transactions above)
      // closed part of only one Leg, the Legs' remaining quantities diverge
      // and the excess on the other Leg is no longer hedged by this spread.
      // `quantity` below is this entry's primary, hedged-size figure (what
      // the acceptance criteria calls "quantity (contracts)"), but
      // shortQuantity/longQuantity are also exposed below so that divergence
      // is never silently hidden -- a caller can always recover each Leg's
      // own remaining size, even though this ticket doesn't attempt to
      // surface the unhedged excess as its own position (that would need a
      // "side" concept the plain OPTION/EQUITY position shape doesn't have
      // today, e.g. to tell a naked short Leg's credit-received basis apart
      // from a long Leg's cost basis -- left for a future ticket).
      const quantity = Math.min(s.shortLeg.qty, s.longLeg.qty);
      // Combined across BOTH Legs' full history, independent of `quantity`
      // above -- a closing Transaction's realized gain/loss doesn't depend
      // on how much of the other Leg is still open.
      const realizedPnl = s.shortLeg.realizedPnl + s.longLeg.realizedPnl;
      const multiplier = OPTION_CONTRACT_MULTIPLIER; // Credit Spreads are OPTION-only (ADR-0004).
      const strikeWidth = Math.abs(s.shortStrike - s.longStrike);
      // net_credit and max_risk are scaled to `quantity` -- the contracts
      // still open on BOTH Legs right now -- not to the spread's original
      // entry quantity. Once a partial close has realized P&L on part of a
      // Leg, that slice's risk is already resolved (and already counted in
      // realizedPnl above); max risk should describe what's still at stake
      // on the remaining paired contracts going forward, not the historical
      // trade size. Each Leg's avgPrice is already an average over that
      // Leg's own remaining open quantity (same average-cost convention as
      // the rest of this file), so scaling both by the shared `quantity`
      // keeps net credit and max risk on the same per-contract basis as the
      // position itself.
      const netCredit = (s.shortLeg.avgPrice - s.longLeg.avgPrice) * multiplier * quantity;
      const maxRisk = strikeWidth * multiplier * quantity - netCredit;
      return {
        symbol: s.symbol,
        instrumentType: "CREDIT_SPREAD" as const,
        optionType: s.optionType,
        expiration: s.expiration,
        shortStrike: s.shortStrike,
        longStrike: s.longStrike,
        quantity,
        shortQuantity: s.shortLeg.qty,
        longQuantity: s.longLeg.qty,
        netCredit,
        maxRisk,
        realizedPnl,
        multiplier,
      };
    })
    // Same drop convention as the single-leg positions above: a spread with
    // no remaining paired quantity and no net realized P&L contributes
    // nothing and is omitted; a fully-closed spread with nonzero realized
    // P&L still appears (quantity 0) so that gain/loss isn't hidden.
    .filter((p) => p.quantity > 0 || p.realizedPnl !== 0);

  res.json([...singleLegPositions, ...spreadPositions]);
});
