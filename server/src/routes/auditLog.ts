// Read-only surface for Audit Log Entries (see CONTEXT.md): an append-only
// record of one unit of AI activity. There is deliberately no POST/PUT/PATCH/
// DELETE route here, not even for admin/debugging convenience -- per the
// issue's acceptance criteria ("no update or delete path exists for audit
// entries, including for the user"), the audit_log table also enforces this
// at the DB layer via the audit_log_no_update/audit_log_no_delete triggers
// in db.ts, so this router's read-only shape isn't the only backstop.
import { Router } from "express";
import { db } from "../db.js";
import type { AuditEventType } from "../audit.js";

export const auditLogRouter = Router();

const EVENT_TYPES: AuditEventType[] = ["chat", "tool_call", "pending_action", "memory_write", "error"];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

auditLogRouter.get("/", (req, res) => {
  const eventTypeParam = req.query.event_type;
  if (eventTypeParam !== undefined) {
    if (typeof eventTypeParam !== "string" || !EVENT_TYPES.includes(eventTypeParam as AuditEventType)) {
      return res.status(400).json({ error: `event_type must be one of ${EVENT_TYPES.join(", ")}` });
    }
  }

  let limit = DEFAULT_LIMIT;
  if (req.query.limit !== undefined) {
    const parsed = Number(req.query.limit);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
      return res.status(400).json({ error: "limit must be a positive integer" });
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  const rows = eventTypeParam
    ? db
        .prepare("SELECT * FROM audit_log WHERE event_type = ? ORDER BY created_at DESC, id DESC LIMIT ?")
        .all(eventTypeParam, limit)
    : db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT ?").all(limit);

  res.json(rows);
});
