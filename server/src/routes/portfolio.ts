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
    const info = db
      .prepare(
        "INSERT INTO transactions (portfolio_id, symbol, side, quantity, price, executed_at, instrument_type, option_type, strike, expiration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
        t.expiration
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
};

/** Aggregated positions with average cost and realized PnL (FIFO-free, average-cost method). */
portfolioRouter.get("/:id/positions", (req, res) => {
  const txs = db
    .prepare("SELECT * FROM transactions WHERE portfolio_id = ? ORDER BY executed_at, id")
    .all(req.params.id) as TxRow[];

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
  for (const tx of txs) {
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
    const multiplier = multiplierFor(tx.instrument_type);
    if (tx.side === "BUY") {
      const totalCost = p.avgCost * p.qty + tx.price * tx.quantity;
      p.qty += tx.quantity;
      p.avgCost = p.qty > 0 ? totalCost / p.qty : 0;
    } else {
      const sold = Math.min(tx.quantity, p.qty);
      p.realizedPnl += (tx.price - p.avgCost) * sold * multiplier;
      p.qty -= sold;
      if (p.qty === 0) p.avgCost = 0;
    }
  }
  res.json(
    [...positions.values()]
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
      }))
  );
});
