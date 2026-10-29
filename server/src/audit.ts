// The single write entry point for every Audit Log Entry (see CONTEXT.md):
// an append-only record of one unit of AI activity -- a full chat transcript,
// a Tool Call, a Pending Action lifecycle event, or a Memory Entry write --
// plus call metadata and failures. Every hook point in this codebase (the
// agentic loop and chat handler in routes/ai.ts, insertPendingAction in
// llm/transactionTools.ts, the confirm/reject handlers in
// routes/pendingActions.ts, and createMemoryEntry in llm/memoryTools.ts)
// funnels through this one function rather than issuing its own raw INSERT,
// so there is exactly one place that writes audit_log. There is deliberately
// no update/delete counterpart here -- see the audit_log_no_update/
// audit_log_no_delete triggers in db.ts, which enforce append-only at the DB
// layer, including against the user.
import { db } from "./db.js";

export type AuditEventType = "chat" | "tool_call" | "pending_action" | "memory_write" | "error";

export type WriteAuditLogInput = {
  eventType: AuditEventType;
  /** Short human-readable label shown in the Audit Log widget's list view without expanding a row. */
  summary: string;
  /** JSON-serializable detail blob; shape varies per event_type (documented at each write site). */
  detail: unknown;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
};

const SUMMARY_TRUNCATE_LENGTH = 80;

/** Shared by every call site that builds a `summary` from arbitrary-length text (chat replies,
 * Memory Entry content, error messages) so the truncation length/ellipsis style can't drift. */
export function truncateSummary(s: string): string {
  return s.length > SUMMARY_TRUNCATE_LENGTH ? `${s.slice(0, SUMMARY_TRUNCATE_LENGTH)}…` : s;
}

export function writeAuditLog(input: WriteAuditLogInput): void {
  db.prepare(
    "INSERT INTO audit_log (event_type, summary, detail, model, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    input.eventType,
    input.summary,
    JSON.stringify(input.detail),
    input.model ?? null,
    input.inputTokens ?? null,
    input.outputTokens ?? null
  );
}
