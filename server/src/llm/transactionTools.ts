// The AI assistant's propose-transaction Tool Call: per CONTEXT.md/ADR-0002, the
// model never writes to `transactions` directly — it can only create a Pending
// Action, which a human must confirm or reject. Clones the NEWS_SEARCH_TOOL shape
// in tools.ts (one exported ToolDef + one exported run...Tool function).
import { db } from "../db.js";
import { writeAuditLog } from "../audit.js";
import { txSchema } from "../schemas/transaction.js";
import type { ToolDef } from "./types.js";

export const PROPOSE_TRANSACTION_TOOL: ToolDef = {
  name: "propose_transaction",
  description:
    "Propose adding, editing, or deleting a ledger Transaction (equity or option). This does NOT write to the " +
    "ledger directly — it creates a Pending Action that the user must review and confirm (or reject) in the " +
    "Pending Actions panel before anything changes. Use transaction_id (visible in the recent-transactions " +
    "context) to target an existing row for EDIT or DELETE.",
  parameters: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["ADD", "EDIT", "DELETE"],
        description: "ADD proposes a new transaction; EDIT proposes new field values for an existing one; DELETE proposes removing one.",
      },
      transaction_id: {
        type: "number",
        description: "Id of the existing transaction to target. Required for EDIT and DELETE; ignored for ADD.",
      },
      symbol: { type: "string", description: "Ticker symbol. Required for ADD/EDIT." },
      side: { type: "string", enum: ["BUY", "SELL"], description: "Required for ADD/EDIT." },
      quantity: { type: "number", description: "Required for ADD/EDIT." },
      price: { type: "number", description: "Required for ADD/EDIT." },
      executed_at: { type: "string", description: "ISO 8601 timestamp. Required for ADD/EDIT." },
      instrument_type: { type: "string", enum: ["EQUITY", "OPTION"], description: "Defaults to EQUITY." },
      option_type: { type: "string", enum: ["CALL", "PUT"], description: "Required for ADD/EDIT when instrument_type is OPTION." },
      strike: { type: "number", description: "Required for ADD/EDIT when instrument_type is OPTION." },
      expiration: { type: "string", description: "Required for ADD/EDIT when instrument_type is OPTION." },
    },
    required: ["operation"],
  },
};

export type ProposeTransactionResult =
  | { ok: true; pendingActionId: number; operation: "ADD" | "EDIT" | "DELETE" }
  | { ok: false; error: string };

type TransactionRow = Record<string, unknown>;

/** Inserts the pending_actions row — the single DB-mutating "propose" step every operation funnels through. */
function insertPendingAction(portfolioId: number, operation: "ADD" | "EDIT" | "DELETE", transactionId: number | null, payload: unknown): number {
  const info = db
    .prepare("INSERT INTO pending_actions (portfolio_id, operation, transaction_id, payload) VALUES (?, ?, ?, ?)")
    .run(portfolioId, operation, transactionId, JSON.stringify(payload));
  const pendingActionId = Number(info.lastInsertRowid);
  writeAuditLog({
    eventType: "pending_action",
    summary: `proposed ${operation} (pending action #${pendingActionId})`,
    detail: { action: "proposed", operation, pendingActionId, transactionId, payload },
  });
  return pendingActionId;
}

/**
 * Executes the propose_transaction tool call. Mirrors AiWidget.tsx's own
 * single-portfolio assumption (positions-context lookup always reads
 * portfolios[0]) rather than building multi-portfolio selection into the tool.
 */
export async function runProposeTransactionTool(args: Record<string, unknown>): Promise<ProposeTransactionResult> {
  const operation = args.operation;
  if (operation !== "ADD" && operation !== "EDIT" && operation !== "DELETE") {
    return { ok: false, error: `operation must be one of ADD, EDIT, DELETE (got ${JSON.stringify(args.operation)})` };
  }

  const portfolio = db.prepare("SELECT id FROM portfolios LIMIT 1").get() as { id: number } | undefined;
  if (!portfolio) return { ok: false, error: "no portfolio exists to propose a transaction against" };

  if (operation === "DELETE" || operation === "EDIT") {
    const transactionId = args.transaction_id;
    if (typeof transactionId !== "number") {
      return { ok: false, error: `transaction_id (number) is required for ${operation}` };
    }
    const existing = db
      .prepare("SELECT * FROM transactions WHERE id = ? AND portfolio_id = ?")
      .get(transactionId, portfolio.id) as TransactionRow | undefined;
    if (!existing) {
      return { ok: false, error: `transaction ${transactionId} not found in this portfolio` };
    }

    if (operation === "DELETE") {
      // Snapshot the *current* row so the Pending Action (and later, #23's audit
      // trail) stays self-contained even after the transaction is actually
      // deleted on confirm.
      const pendingActionId = insertPendingAction(portfolio.id, "DELETE", transactionId, existing);
      return { ok: true, pendingActionId, operation };
    }

    const parsed = txSchema.safeParse(args);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const pendingActionId = insertPendingAction(portfolio.id, "EDIT", transactionId, parsed.data);
    return { ok: true, pendingActionId, operation };
  }

  // ADD
  const parsed = txSchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  const pendingActionId = insertPendingAction(portfolio.id, "ADD", null, parsed.data);
  return { ok: true, pendingActionId, operation };
}
