// The AI assistant's propose-transaction Tool Call: per CONTEXT.md/ADR-0002, the
// model never writes to `transactions` directly — it can only create a Pending
// Action, which a human must confirm or reject. Clones the NEWS_SEARCH_TOOL shape
// in tools.ts (one exported ToolDef + one exported run...Tool function).
//
// Also home to get_transaction_history (#66): a read-only, on-demand lookup of
// full Transaction history, for the assistant to answer questions like "what did
// I pay for my NVDA puts" that fall outside the capped recent-20 snapshot
// AiWidget.tsx auto-injects as context every turn (that snapshot exists only to
// give propose_transaction above an existing row's id to target for EDIT/DELETE,
// and is deliberately left untouched by this tool).
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

// Caps how many Transaction rows are folded back into the model's context per call,
// the same way search_memory caps at MAX_RESULTS -- this tool's results get
// JSON.stringify'd into the chat history and resent to the provider on every
// remaining tool round (see routes/ai.ts), so an unbounded result set would scale
// prompt size with the portfolio's full trade count. Well above the recent-20
// snapshot AiWidget.tsx already injects, since giving real history depth is the
// point of this tool -- just not literally unbounded.
const MAX_RESULTS = 200;

export const GET_TRANSACTION_HISTORY_TOOL: ToolDef = {
  name: "get_transaction_history",
  description:
    "Look up the user's full ledger Transaction history, beyond the capped recent-20 snapshot already shared as " +
    "context. Returns every stored field per Transaction, including option fields (option_type, strike, " +
    "expiration) and spread_id for Credit Spread legs. Optionally filter to one ticker symbol, e.g. to answer " +
    "'what did I pay for my NVDA puts' or 'show me all my ADBE trades'. Omit symbol for the complete history " +
    `(most recent ${MAX_RESULTS} transactions).`,
  parameters: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Optional ticker symbol to filter to, e.g. AAPL. Omit for every symbol." },
    },
  },
};

export type GetTransactionHistoryResult =
  | { ok: true; transactions: TransactionRow[] }
  | { ok: false; error: string };

/**
 * Executes the get_transaction_history tool call. Queries `transactions` directly
 * (mirrors GET /:id/transactions in routes/portfolio.ts for shape/ordering: full
 * row, newest-first) rather than reusing the slim id/symbol/side/quantity/price/
 * executed_at shape AiWidget.tsx auto-injects -- this tool's whole point is giving
 * the model visibility into fields that snapshot omits (option_type/strike/
 * expiration/spread_id). Single-portfolio assumption mirrors
 * runProposeTransactionTool above. Capped at MAX_RESULTS, newest first, same
 * rationale as runSearchMemoryTool's cap.
 */
export async function runGetTransactionHistoryTool(args: Record<string, unknown>): Promise<GetTransactionHistoryResult> {
  const portfolio = db.prepare("SELECT id FROM portfolios LIMIT 1").get() as { id: number } | undefined;
  if (!portfolio) return { ok: false, error: "no portfolio exists to look up transactions for" };

  const symbol = typeof args.symbol === "string" && args.symbol.trim() ? args.symbol.trim().toUpperCase() : undefined;

  const transactions = symbol
    ? (db
        .prepare("SELECT * FROM transactions WHERE portfolio_id = ? AND symbol = ? ORDER BY executed_at DESC, id DESC LIMIT ?")
        .all(portfolio.id, symbol, MAX_RESULTS) as TransactionRow[])
    : (db
        .prepare("SELECT * FROM transactions WHERE portfolio_id = ? ORDER BY executed_at DESC, id DESC LIMIT ?")
        .all(portfolio.id, MAX_RESULTS) as TransactionRow[]);

  return { ok: true, transactions };
}
