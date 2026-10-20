import { Router } from "express";
import { z } from "zod";
import { db } from "./db.js";
import { SYMBOL_RE } from "./symbol.js";
import { computePositions } from "./routes/portfolio.js";
import type { Quote } from "./providers/yahoo.js";

/**
 * Paper trading: a simulated cash account for learning. Deliberately simple
 * and beginner-safe: long-only (no short selling), no margin, no fees.
 *
 * Fills use the live quote the way a real broker would: market BUYs pay the
 * ask and SELLs receive the bid (so the spread is felt), limit orders fill at
 * the limit or better, stops trigger at the stop and fill at the market.
 * Kept in its own tables so simulated money can never mix with the real
 * portfolio.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS paper_account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  starting_cash REAL NOT NULL,
  cash REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS paper_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  type TEXT NOT NULL CHECK (type IN ('market','limit','stop')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  limit_price REAL,
  stop_price REAL,
  status TEXT NOT NULL CHECK (status IN ('open','filled','cancelled','rejected')),
  fill_price REAL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  filled_at TEXT
);
CREATE INDEX IF NOT EXISTS paper_orders_status ON paper_orders(status);
`);

export const DEFAULT_STARTING_CASH = 100_000;
export const PAPER_LIMITS = { maxOpenOrders: 100, maxQuantity: 1e7, maxPrice: 1e7 } as const;

export type OrderRow = {
  id: number;
  symbol: string;
  side: "BUY" | "SELL";
  type: "market" | "limit" | "stop";
  quantity: number;
  limit_price: number | null;
  stop_price: number | null;
  status: "open" | "filled" | "cancelled" | "rejected";
  fill_price: number | null;
  reason: string | null;
  created_at: string;
  filled_at: string | null;
};
type QuoteLike = Pick<Quote, "price" | "bid" | "ask">;

const cents = (n: number) => Math.round(n * 100) / 100;
const EPS = 1e-9;

function account(): { starting_cash: number; cash: number; created_at: string } {
  db.prepare("INSERT OR IGNORE INTO paper_account (id, starting_cash, cash) VALUES (1, ?, ?)").run(
    DEFAULT_STARTING_CASH,
    DEFAULT_STARTING_CASH
  );
  return db.prepare("SELECT starting_cash, cash, created_at FROM paper_account WHERE id = 1").get() as never;
}

function filledHistory() {
  return (
    db
      .prepare("SELECT symbol, side, quantity, fill_price AS price FROM paper_orders WHERE status = 'filled' ORDER BY filled_at, id")
      .all() as Array<{ symbol: string; side: string; quantity: number; price: number }>
  );
}

function heldShares(symbol: string): number {
  const p = computePositions(filledHistory().filter((t) => t.symbol === symbol)).positions[0];
  return p?.quantity ?? 0;
}

/** Cash and shares already promised to open orders ("buying power" a real broker shows). */
function reserved(excludeId?: number) {
  const open = db.prepare("SELECT * FROM paper_orders WHERE status = 'open'").all() as OrderRow[];
  let cash = 0;
  const shares: Record<string, number> = {};
  for (const o of open) {
    if (o.id === excludeId) continue;
    if (o.side === "BUY") cash += o.quantity * (o.limit_price ?? o.stop_price ?? 0);
    else shares[o.symbol] = (shares[o.symbol] ?? 0) + o.quantity;
  }
  return { cash: cents(cash), shares };
}

const usable = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** Price a market order executes at: the ask for buys, the bid for sells, if the quote is sane. */
export function marketFillPrice(side: "BUY" | "SELL", q: QuoteLike): number | null {
  if (!usable(q.price)) return null;
  const near = (x: number | null | undefined): x is number => usable(x) && Math.abs(x / q.price! - 1) < 0.05;
  if (side === "BUY") return near(q.ask) ? q.ask : q.price;
  return near(q.bid) ? q.bid : q.price;
}

/** Whether an open limit/stop order should execute now, and at what price. */
export function triggerPrice(o: Pick<OrderRow, "side" | "type" | "limit_price" | "stop_price">, q: QuoteLike): number | null {
  const mkt = marketFillPrice(o.side, q);
  if (mkt === null) return null;
  if (o.type === "limit" && o.limit_price !== null) {
    if (o.side === "BUY") return mkt <= o.limit_price ? mkt : null; // at the limit or better
    return mkt >= o.limit_price ? mkt : null;
  }
  if (o.type === "stop" && o.stop_price !== null) {
    if (o.side === "BUY") return q.price! >= o.stop_price ? mkt : null; // breakout entry
    return q.price! <= o.stop_price ? mkt : null; // stop-loss
  }
  return null;
}

/** Executes one order atomically; returns the stored row. Re-checks cash/shares at fill time. */
const execute = db.transaction((orderId: number, price: number): OrderRow => {
  const o = db.prepare("SELECT * FROM paper_orders WHERE id = ?").get(orderId) as OrderRow;
  if (o.status !== "open") return o;
  const value = cents(o.quantity * price);
  const acct = account();
  let reason: string | null = null;
  if (o.side === "BUY" && value > acct.cash + EPS) reason = `not enough cash: needs $${value.toFixed(2)}, have $${acct.cash.toFixed(2)}`;
  if (o.side === "SELL" && o.quantity > heldShares(o.symbol) + EPS) reason = `you hold fewer than ${o.quantity} ${o.symbol} (no short selling)`;
  if (reason) {
    db.prepare("UPDATE paper_orders SET status = 'rejected', reason = ? WHERE id = ?").run(reason, o.id);
  } else {
    db.prepare("UPDATE paper_account SET cash = ? WHERE id = 1").run(cents(acct.cash + (o.side === "BUY" ? -value : value)));
    db.prepare(
      "UPDATE paper_orders SET status = 'filled', fill_price = ?, filled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
    ).run(price, o.id);
  }
  return db.prepare("SELECT * FROM paper_orders WHERE id = ?").get(o.id) as OrderRow;
});

/** One pass of the limit/stop engine. Returns ids that filled or were rejected. */
export async function evaluatePaperOrders(getQuotes: (s: string[]) => Promise<Quote[]>): Promise<number[]> {
  const open = db.prepare("SELECT * FROM paper_orders WHERE status = 'open' ORDER BY id").all() as OrderRow[];
  if (!open.length) return [];
  const quotes = new Map((await getQuotes([...new Set(open.map((o) => o.symbol))])).map((q) => [q.symbol, q]));
  const done: number[] = [];
  for (const o of open) {
    const q = quotes.get(o.symbol);
    const px = q ? triggerPrice(o, q) : null;
    if (px === null) continue;
    try {
      if (execute(o.id, px).status !== "open") done.push(o.id);
    } catch (err) {
      console.error(`[paper] order ${o.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return done;
}

export function startPaperEngine(getQuotes: (s: string[]) => Promise<Quote[]>, intervalMs = 5_000) {
  let stopped = false;
  let timer: NodeJS.Timeout;
  const loop = async () => {
    try {
      await evaluatePaperOrders(getQuotes);
    } catch (err) {
      console.error("[paper] evaluation failed:", err instanceof Error ? err.message : err);
    }
    if (!stopped) timer = setTimeout(loop, intervalMs);
  };
  timer = setTimeout(loop, intervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

const money = z.number().finite().positive().max(PAPER_LIMITS.maxPrice);
const orderSchema = z
  .object({
    symbol: z.string().trim().transform((s) => s.toUpperCase()).pipe(z.string().regex(SYMBOL_RE, "invalid symbol")),
    side: z.enum(["BUY", "SELL"]),
    type: z.enum(["market", "limit", "stop"]),
    quantity: z.number().finite().positive().max(PAPER_LIMITS.maxQuantity),
    limitPrice: money.optional(),
    stopPrice: money.optional(),
  })
  .strict()
  .refine((o) => o.type !== "limit" || o.limitPrice !== undefined, { message: "a limit order needs limitPrice" })
  .refine((o) => o.type !== "stop" || o.stopPrice !== undefined, { message: "a stop order needs stopPrice" });

export function createPaperRouter(getQuotes: (s: string[]) => Promise<Quote[]>) {
  const router = Router();

  router.get("/", (_req, res) => {
    const acct = account();
    res.json({
      startingCash: acct.starting_cash,
      cash: acct.cash,
      createdAt: acct.created_at,
      positions: computePositions(filledHistory()).positions,
      reserved: reserved(),
    });
  });

  router.get("/orders", (_req, res) => {
    res.json(db.prepare("SELECT * FROM paper_orders ORDER BY id DESC LIMIT 200").all());
  });

  router.post("/orders", async (req, res) => {
    const parsed = orderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "order"}: ${i.message}`).join("; ") });
    }
    const o = parsed.data;
    const openCount = (db.prepare("SELECT COUNT(*) AS n FROM paper_orders WHERE status = 'open'").get() as { n: number }).n;
    if (o.type !== "market" && openCount >= PAPER_LIMITS.maxOpenOrders) {
      return res.status(409).json({ error: `at most ${PAPER_LIMITS.maxOpenOrders} open orders` });
    }

    let marketPx: number | null = null;
    if (o.type === "market") {
      const [q] = await getQuotes([o.symbol]).catch(() => []);
      marketPx = q ? marketFillPrice(o.side, q) : null;
      if (marketPx === null) return res.status(503).json({ error: `no live price for ${o.symbol} right now; try again shortly` });
    }

    // Buying power / sellable shares, net of what open orders already promised.
    const r = reserved();
    if (o.side === "BUY") {
      const est = cents(o.quantity * (marketPx ?? o.limitPrice ?? o.stopPrice!));
      const available = cents(account().cash - r.cash);
      if (est > available + EPS) {
        return res.status(409).json({ error: `not enough buying power: order ≈ $${est.toFixed(2)}, available $${available.toFixed(2)}` });
      }
    } else {
      const sellable = heldShares(o.symbol) - (r.shares[o.symbol] ?? 0);
      if (o.quantity > sellable + EPS) {
        return res.status(409).json({ error: `you can sell at most ${+sellable.toFixed(4)} ${o.symbol} (no short selling)` });
      }
    }

    const info = db
      .prepare(
        "INSERT INTO paper_orders (symbol, side, type, quantity, limit_price, stop_price, status) VALUES (?, ?, ?, ?, ?, ?, 'open')"
      )
      .run(o.symbol, o.side, o.type, o.quantity, o.limitPrice ?? null, o.stopPrice ?? null);
    const id = Number(info.lastInsertRowid);
    const row = marketPx !== null ? execute(id, marketPx) : (db.prepare("SELECT * FROM paper_orders WHERE id = ?").get(id) as OrderRow);
    res.status(201).json(row);
  });

  router.delete("/orders/:id", (req, res) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "id must be a positive integer" });
    const info = db.prepare("UPDATE paper_orders SET status = 'cancelled' WHERE id = ? AND status = 'open'").run(id.data);
    if (info.changes === 0) {
      const exists = db.prepare("SELECT status FROM paper_orders WHERE id = ?").get(id.data) as { status: string } | undefined;
      return exists ? res.status(409).json({ error: `order is already ${exists.status}` }) : res.status(404).json({ error: "order not found" });
    }
    res.json(db.prepare("SELECT * FROM paper_orders WHERE id = ?").get(id.data));
  });

  router.post("/reset", (req, res) => {
    const body = z
      .object({ startingCash: z.number().finite().min(1_000).max(10_000_000).optional() })
      .strict()
      .safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: "startingCash must be between 1,000 and 10,000,000" });
    const start = cents(body.data.startingCash ?? DEFAULT_STARTING_CASH);
    db.transaction(() => {
      db.prepare("DELETE FROM paper_orders").run();
      db.prepare("DELETE FROM paper_account").run();
      db.prepare("INSERT INTO paper_account (id, starting_cash, cash) VALUES (1, ?, ?)").run(start, start);
    })();
    res.json({ startingCash: start, cash: start });
  });

  return router;
}
