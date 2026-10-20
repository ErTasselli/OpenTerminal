import { Router } from "express";
import { z } from "zod";
import { db } from "./db.js";
import { SYMBOL_RE } from "./symbol.js";
import type { Quote } from "./providers/yahoo.js";

/**
 * Price alerts: stored in SQLite, evaluated server-side every few seconds
 * against the same cached quotes the UI uses, and delivered to browsers as an
 * ordered event log (alert_events.seq) that clients poll. A client that was
 * closed when an alert fired still gets it on its next poll.
 *
 * Alerts are one-shot: firing atomically disarms them (UPDATE ... WHERE
 * active = 1), so a price hovering around a level can't spam notifications.
 * Each firing appends to alert_events, the log clients read with a cursor.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('above','below','pct_up','pct_down')),
  threshold REAL NOT NULL,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  triggered_at TEXT,
  triggered_price REAL
);
CREATE INDEX IF NOT EXISTS alerts_active ON alerts(active);
-- Delivery log. AUTOINCREMENT guarantees seq is never reused (even after
-- rows are deleted), so a client's "after" cursor can't skip a firing.
CREATE TABLE IF NOT EXISTS alert_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  kind TEXT NOT NULL,
  threshold REAL NOT NULL,
  price REAL,
  change_percent REAL,
  note TEXT,
  fired_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`);

export const ALERT_LIMITS = { maxActive: 200, maxSymbols: 100 } as const;

export type AlertKind = "above" | "below" | "pct_up" | "pct_down";
export type AlertRow = {
  id: number;
  symbol: string;
  kind: AlertKind;
  threshold: number;
  note: string | null;
  active: number;
  created_at: string;
  triggered_at: string | null;
  triggered_price: number | null;
};
export type AlertEvent = {
  seq: number;
  alert_id: number;
  symbol: string;
  kind: AlertKind;
  threshold: number;
  price: number | null;
  change_percent: number | null;
  note: string | null;
  fired_at: string;
};

/** Whether `q` satisfies the alert. Missing/non-finite data never triggers. */
export function isTriggered(a: Pick<AlertRow, "kind" | "threshold">, q: Pick<Quote, "price" | "changePercent">): boolean {
  const ok = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
  switch (a.kind) {
    case "above": return ok(q.price) && q.price >= a.threshold;
    case "below": return ok(q.price) && q.price <= a.threshold;
    case "pct_up": return ok(q.changePercent) && q.changePercent >= a.threshold;
    case "pct_down": return ok(q.changePercent) && q.changePercent <= -a.threshold;
  }
}

const disarm = db.prepare(`
  UPDATE alerts
     SET active = 0, triggered_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), triggered_price = ?
   WHERE id = ? AND active = 1`);
const logEvent = db.prepare(
  "INSERT INTO alert_events (alert_id, symbol, kind, threshold, price, change_percent, note) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
const finiteOrNull = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : null);

/** Disarm + log as one unit: either both happen or neither does. */
const fireOne = db.transaction((a: AlertRow, q: Quote): boolean => {
  if (disarm.run(finiteOrNull(q.price), a.id).changes !== 1) return false;
  logEvent.run(a.id, a.symbol, a.kind, a.threshold, finiteOrNull(q.price), finiteOrNull(q.changePercent), a.note);
  return true;
});

/** One evaluation pass. Returns the ids that fired. */
export async function evaluateAlerts(getQuotes: (symbols: string[]) => Promise<Quote[]>): Promise<number[]> {
  const active = db.prepare("SELECT * FROM alerts WHERE active = 1").all() as AlertRow[];
  if (active.length === 0) return [];
  const symbols = [...new Set(active.map((a) => a.symbol))].slice(0, ALERT_LIMITS.maxSymbols);
  const quotes = new Map((await getQuotes(symbols)).map((q) => [q.symbol, q]));
  const fired: number[] = [];
  // Per-alert transactions: one bad row must not roll back (and so
  // permanently block) every other alert in the pass.
  for (const a of active) {
    const q = quotes.get(a.symbol);
    if (!q || !isTriggered(a, q)) continue;
    try {
      if (fireOne(a, q)) fired.push(a.id);
    } catch (err) {
      console.error(`[alerts] could not fire alert ${a.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return fired;
}

/** Background loop; returns a stop function. Never overlaps itself. */
export function startAlertEngine(getQuotes: (symbols: string[]) => Promise<Quote[]>, intervalMs = 5_000) {
  let stopped = false;
  let timer: NodeJS.Timeout;
  const loop = async () => {
    try {
      const fired = await evaluateAlerts(getQuotes);
      if (fired.length) console.log(`[alerts] fired ${fired.length}: ${fired.join(",")}`);
    } catch (err) {
      console.error("[alerts] evaluation failed:", err instanceof Error ? err.message : err);
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

const createSchema = z
  .object({
    symbol: z.string().trim().transform((s) => s.toUpperCase()).pipe(z.string().regex(SYMBOL_RE, "invalid symbol")),
    kind: z.enum(["above", "below", "pct_up", "pct_down"]),
    threshold: z.number().finite().positive().max(1e9),
    note: z.string().trim().max(120).optional(),
  })
  .strict()
  .refine((a) => !a.kind.startsWith("pct") || a.threshold <= 100, { message: "percent threshold must be at most 100" });

const idParam = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const alertsRouter = Router();

alertsRouter.get("/", (_req, res) => {
  res.json(db.prepare("SELECT * FROM alerts ORDER BY active DESC, COALESCE(triggered_at, created_at) DESC, id DESC").all());
});

alertsRouter.post("/", (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
  }
  const a = parsed.data;
  const { n, s } = db
    .prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT symbol) AS s FROM alerts WHERE active = 1")
    .get() as { n: number; s: number };
  if (n >= ALERT_LIMITS.maxActive) return res.status(409).json({ error: `at most ${ALERT_LIMITS.maxActive} active alerts` });
  const known = db.prepare("SELECT 1 FROM alerts WHERE active = 1 AND symbol = ?").get(a.symbol);
  if (!known && s >= ALERT_LIMITS.maxSymbols) {
    return res.status(409).json({ error: `alerts can watch at most ${ALERT_LIMITS.maxSymbols} symbols` });
  }
  const info = db
    .prepare("INSERT INTO alerts (symbol, kind, threshold, note) VALUES (?, ?, ?, ?)")
    .run(a.symbol, a.kind, a.threshold, a.note || null);
  res.status(201).json(db.prepare("SELECT * FROM alerts WHERE id = ?").get(info.lastInsertRowid));
});

/** Ordered firings after `after` (exclusive). `after` omitted = just the current cursor, no backlog. */
alertsRouter.get("/events", (req, res) => {
  const cursor = (db.prepare("SELECT COALESCE(MAX(seq), 0) AS c FROM alert_events").get() as { c: number }).c;
  if (req.query.after === undefined) return res.json({ cursor, events: [] });
  const after = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).safeParse(req.query.after);
  if (!after.success) return res.status(400).json({ error: "after must be a non-negative integer" });
  const events = db
    .prepare("SELECT * FROM alert_events WHERE seq > ? ORDER BY seq LIMIT 50")
    .all(after.data) as AlertEvent[];
  res.json({ cursor: events.length ? events[events.length - 1].seq : Math.max(after.data, cursor), events });
});

alertsRouter.post("/:id/rearm", (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "id must be a positive integer" });
  const info = db
    .prepare("UPDATE alerts SET active = 1, triggered_at = NULL, triggered_price = NULL WHERE id = ?")
    .run(id.data);
  if (info.changes === 0) return res.status(404).json({ error: "alert not found" });
  res.json(db.prepare("SELECT * FROM alerts WHERE id = ?").get(id.data));
});

alertsRouter.delete("/:id", (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "id must be a positive integer" });
  const info = db.prepare("DELETE FROM alerts WHERE id = ?").run(id.data);
  if (info.changes === 0) return res.status(404).json({ error: "alert not found" });
  res.status(204).end();
});
