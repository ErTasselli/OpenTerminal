import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Same tmp-DB pattern as routes/portfolio.test.ts: db.ts opens a real sqlite file at
// DATA_DIR on import, so point it at a throwaway directory before dynamically
// importing db.js and the module under test.
let tmpDir: string;
let db: (typeof import("../db.js"))["db"];
let runProposeTransactionTool: (typeof import("./transactionTools.js"))["runProposeTransactionTool"];
let runGetTransactionHistoryTool: (typeof import("./transactionTools.js"))["runGetTransactionHistoryTool"];
let portfolioId: number;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "bloomber-transaction-tools-test-"));
  process.env.DATA_DIR = tmpDir;
  ({ db } = await import("../db.js"));
  ({ runProposeTransactionTool, runGetTransactionHistoryTool } = await import("./transactionTools.js"));
  const portfolio = db.prepare("SELECT id FROM portfolios LIMIT 1").get() as { id: number };
  portfolioId = portfolio.id;
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe("runProposeTransactionTool", () => {
  it("rejects an unrecognized operation with ok:false rather than throwing", async () => {
    const result = await runProposeTransactionTool({ operation: "FROB" });
    expect(result).toMatchObject({ ok: false });
  });

  it("ADD: creates a pending_actions row with operation='ADD', transaction_id=NULL, and the validated payload", async () => {
    const result = await runProposeTransactionTool({
      operation: "ADD",
      symbol: "aapl",
      side: "BUY",
      quantity: 10,
      price: 150,
      executed_at: "2026-01-01T00:00:00Z",
      instrument_type: "EQUITY",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.operation).toBe("ADD");

    const row = db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(result.pendingActionId) as Record<string, unknown>;
    expect(row.operation).toBe("ADD");
    expect(row.transaction_id).toBeNull();
    expect(row.status).toBe("pending");
    const payload = JSON.parse(row.payload as string);
    expect(payload.symbol).toBe("AAPL"); // uppercased by the shared schema's transform
  });

  it("ADD: returns ok:false with a validation message for an invalid payload", async () => {
    const result = await runProposeTransactionTool({
      operation: "ADD",
      symbol: "aapl",
      side: "BUY",
      quantity: 10,
      price: 150,
      executed_at: "2026-01-01T00:00:00Z",
      instrument_type: "OPTION",
      // missing option_type/strike/expiration
    });

    expect(result.ok).toBe(false);
  });

  it("EDIT: targets an existing transaction and snapshots the proposed new fields as payload", async () => {
    const info = db
      .prepare(
        "INSERT INTO transactions (portfolio_id, symbol, side, quantity, price, executed_at) VALUES (?, 'MSFT', 'BUY', 5, 300, '2026-01-02T00:00:00Z')"
      )
      .run(portfolioId);
    const txId = Number(info.lastInsertRowid);

    const result = await runProposeTransactionTool({
      operation: "EDIT",
      transaction_id: txId,
      symbol: "msft",
      side: "BUY",
      quantity: 7,
      price: 310,
      executed_at: "2026-01-03T00:00:00Z",
      instrument_type: "EQUITY",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const row = db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(result.pendingActionId) as Record<string, unknown>;
    expect(row.operation).toBe("EDIT");
    expect(row.transaction_id).toBe(txId);
    const payload = JSON.parse(row.payload as string);
    expect(payload.quantity).toBe(7);
    expect(payload.price).toBe(310);

    // The underlying transaction itself is untouched until a human confirms.
    const unchanged = db.prepare("SELECT * FROM transactions WHERE id = ?").get(txId) as Record<string, unknown>;
    expect(unchanged.quantity).toBe(5);
  });

  it("DELETE: snapshots the current row's fields as payload without deleting it", async () => {
    const info = db
      .prepare(
        "INSERT INTO transactions (portfolio_id, symbol, side, quantity, price, executed_at) VALUES (?, 'TSLA', 'BUY', 1, 200, '2026-01-04T00:00:00Z')"
      )
      .run(portfolioId);
    const txId = Number(info.lastInsertRowid);

    const result = await runProposeTransactionTool({ operation: "DELETE", transaction_id: txId });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const row = db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(result.pendingActionId) as Record<string, unknown>;
    expect(row.operation).toBe("DELETE");
    expect(row.transaction_id).toBe(txId);
    const payload = JSON.parse(row.payload as string);
    expect(payload.symbol).toBe("TSLA");

    const stillThere = db.prepare("SELECT * FROM transactions WHERE id = ?").get(txId);
    expect(stillThere).toBeDefined();
  });

  it("EDIT/DELETE: returns ok:false when transaction_id doesn't exist in this portfolio", async () => {
    const editResult = await runProposeTransactionTool({
      operation: "EDIT",
      transaction_id: 999999,
      symbol: "AAPL",
      side: "BUY",
      quantity: 1,
      price: 1,
      executed_at: "2026-01-01T00:00:00Z",
    });
    expect(editResult).toMatchObject({ ok: false });

    const deleteResult = await runProposeTransactionTool({ operation: "DELETE", transaction_id: 999999 });
    expect(deleteResult).toMatchObject({ ok: false });
  });

  it("EDIT/DELETE: returns ok:false when transaction_id is missing", async () => {
    const result = await runProposeTransactionTool({ operation: "DELETE" });
    expect(result).toMatchObject({ ok: false });
  });
});

describe("runGetTransactionHistoryTool", () => {
  it("returns every stored field, including option_type/strike/expiration/spread_id, for an option transaction", async () => {
    const info = db
      .prepare(
        "INSERT INTO transactions (portfolio_id, symbol, side, quantity, price, executed_at, instrument_type, option_type, strike, expiration, spread_id) " +
          "VALUES (?, 'NVDA', 'BUY', 2, 12.5, '2026-02-01T00:00:00Z', 'OPTION', 'PUT', 120, '2026-06-19', 'spread-abc')"
      )
      .run(portfolioId);
    const txId = Number(info.lastInsertRowid);

    const result = await runGetTransactionHistoryTool({});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const row = result.transactions.find((t) => t.id === txId);
    expect(row).toMatchObject({
      symbol: "NVDA",
      side: "BUY",
      quantity: 2,
      price: 12.5,
      instrument_type: "OPTION",
      option_type: "PUT",
      strike: 120,
      expiration: "2026-06-19",
      spread_id: "spread-abc",
    });
  });

  it("filters to the given symbol, case-insensitively", async () => {
    db.prepare(
      "INSERT INTO transactions (portfolio_id, symbol, side, quantity, price, executed_at) VALUES (?, 'ADBE', 'BUY', 3, 400, '2026-02-02T00:00:00Z')"
    ).run(portfolioId);
    db.prepare(
      "INSERT INTO transactions (portfolio_id, symbol, side, quantity, price, executed_at) VALUES (?, 'ADBE', 'SELL', 1, 410, '2026-02-03T00:00:00Z')"
    ).run(portfolioId);

    const result = await runGetTransactionHistoryTool({ symbol: "adbe" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.transactions.length).toBeGreaterThanOrEqual(2);
    expect(result.transactions.every((t) => t.symbol === "ADBE")).toBe(true);
  });

  it("returns an empty array (ok:true) when the symbol has no matching transactions", async () => {
    const result = await runGetTransactionHistoryTool({ symbol: "ZZZZZZ" });

    expect(result).toEqual({ ok: true, transactions: [] });
  });

  it("omitting symbol returns the full transaction history for the portfolio", async () => {
    const result = await runGetTransactionHistoryTool({});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const totalRows = db.prepare("SELECT COUNT(*) as n FROM transactions WHERE portfolio_id = ?").get(portfolioId) as { n: number };
    expect(result.transactions.length).toBe(totalRows.n);
  });
});
