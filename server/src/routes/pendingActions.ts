import { Router, type Response } from "express";
import { db } from "../db.js";
import { writeAuditLog } from "../audit.js";
import { txSchema } from "../schemas/transaction.js";

// Pending Actions per CONTEXT.md: an AI-proposed ledger write held for human
// review. This router is mounted on the same "/api/portfolios" prefix as
// portfolioRouter (see index.ts) but kept in its own file since it's a
// separate resource with its own lifecycle (pending/confirmed/rejected).
export const pendingActionsRouter = Router();

type PendingActionRow = {
  id: number;
  portfolio_id: number;
  operation: "ADD" | "EDIT" | "DELETE";
  status: "pending" | "confirmed" | "rejected";
  transaction_id: number | null;
  payload: string;
  created_at: string;
  resolved_at: string | null;
};

pendingActionsRouter.get("/:id/pending-actions", (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "pending";
  const rows =
    status === "all"
      ? db
          .prepare("SELECT * FROM pending_actions WHERE portfolio_id = ? ORDER BY created_at DESC, id DESC")
          .all(req.params.id)
      : db
          .prepare(
            "SELECT * FROM pending_actions WHERE portfolio_id = ? AND status = ? ORDER BY created_at DESC, id DESC"
          )
          .all(req.params.id, status);
  res.json(rows);
});

/** Looks up a `status='pending'` Pending Action scoped to this portfolio, or null if it doesn't qualify. */
function findPendingAction(portfolioId: string, paId: string): PendingActionRow | null {
  const row = db
    .prepare("SELECT * FROM pending_actions WHERE id = ? AND portfolio_id = ?")
    .get(paId, portfolioId) as PendingActionRow | undefined;
  if (!row || row.status !== "pending") return null;
  return row;
}

/** Marks a Pending Action resolved — the one state-transition point both confirm and reject funnel through. */
function resolvePendingAction(id: number, status: "confirmed" | "rejected"): void {
  db.prepare("UPDATE pending_actions SET status = ?, resolved_at = datetime('now') WHERE id = ?").run(status, id);
}

/**
 * Guards EDIT/DELETE confirm against a target transaction that's already gone — e.g. two
 * open Pending Actions reference the same transaction_id, or it was deleted manually via
 * DELETE /:id/transactions/:txId while a Pending Action on it was still pending. The
 * `transactions(id) ON DELETE SET NULL` FK (see db.ts) nulls `pending_actions.transaction_id`
 * in that case, so the confirm UPDATE/DELETE above would silently match zero rows — without
 * this check it would still mark the action "confirmed" and write a false-success Audit Log
 * Entry. Deliberately left pending (not auto-rejected) so a human still decides its fate.
 */
function respondTargetGone(res: Response, pa: PendingActionRow): void {
  writeAuditLog({
    eventType: "error",
    summary: `confirm ${pa.operation} failed: target transaction no longer exists (pending action #${pa.id})`,
    detail: { pendingActionId: pa.id, operation: pa.operation, reason: "target transaction no longer exists" },
  });
  res.status(409).json({ error: "target transaction no longer exists" });
}

pendingActionsRouter.post("/:id/pending-actions/:paId/confirm", (req, res) => {
  const pa = findPendingAction(req.params.id, req.params.paId);
  if (!pa) return res.status(404).json({ error: "pending action not found" });

  if (pa.operation === "DELETE") {
    const info = db.prepare("DELETE FROM transactions WHERE id = ? AND portfolio_id = ?").run(pa.transaction_id, req.params.id);
    if (info.changes === 0) return respondTargetGone(res, pa);
    resolvePendingAction(pa.id, "confirmed");
    writeAuditLog({
      eventType: "pending_action",
      summary: `confirmed DELETE (pending action #${pa.id})`,
      detail: {
        action: "confirmed",
        operation: pa.operation,
        pendingActionId: pa.id,
        before: JSON.parse(pa.payload),
        after: { transactionId: pa.transaction_id, deleted: true },
      },
    });
    return res.status(200).json({ ok: true });
  }

  const parsed = txSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const t = parsed.data;

  if (pa.operation === "ADD") {
    const info = db
      .prepare(
        "INSERT INTO transactions (portfolio_id, symbol, side, quantity, price, executed_at, instrument_type, option_type, strike, expiration, source, pending_action_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai', ?)"
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
        pa.id
      );
    resolvePendingAction(pa.id, "confirmed");
    writeAuditLog({
      eventType: "pending_action",
      summary: `confirmed ADD (pending action #${pa.id})`,
      detail: {
        action: "confirmed",
        operation: pa.operation,
        pendingActionId: pa.id,
        before: JSON.parse(pa.payload),
        after: { transactionId: info.lastInsertRowid, source: "ai" },
      },
    });
    return res.status(201).json({ id: info.lastInsertRowid, ...t });
  }

  // EDIT: also re-tags the edited row with source='ai' + pending_action_id so
  // the row documents that its current values came from an AI-confirmed edit,
  // same provenance contract as ADD above.
  const editInfo = db
    .prepare(
      "UPDATE transactions SET symbol = ?, side = ?, quantity = ?, price = ?, executed_at = ?, instrument_type = ?, option_type = ?, strike = ?, expiration = ?, source = 'ai', pending_action_id = ? WHERE id = ? AND portfolio_id = ?"
    )
    .run(
      t.symbol,
      t.side,
      t.quantity,
      t.price,
      t.executed_at,
      t.instrument_type,
      t.option_type,
      t.strike,
      t.expiration,
      pa.id,
      pa.transaction_id,
      req.params.id
    );
  if (editInfo.changes === 0) return respondTargetGone(res, pa);
  resolvePendingAction(pa.id, "confirmed");
  writeAuditLog({
    eventType: "pending_action",
    summary: `confirmed EDIT (pending action #${pa.id})`,
    detail: {
      action: "confirmed",
      operation: pa.operation,
      pendingActionId: pa.id,
      before: JSON.parse(pa.payload),
      after: { transactionId: pa.transaction_id, source: "ai", ...t },
    },
  });
  res.status(200).json({ id: pa.transaction_id, ...t });
});

pendingActionsRouter.post("/:id/pending-actions/:paId/reject", (req, res) => {
  const pa = findPendingAction(req.params.id, req.params.paId);
  if (!pa) return res.status(404).json({ error: "pending action not found" });
  resolvePendingAction(pa.id, "rejected");
  writeAuditLog({
    eventType: "pending_action",
    summary: `rejected ${pa.operation} (pending action #${pa.id})`,
    detail: {
      action: "rejected",
      operation: pa.operation,
      pendingActionId: pa.id,
      before: JSON.parse(pa.payload),
      after: null,
    },
  });
  res.status(200).json({ ok: true });
});
