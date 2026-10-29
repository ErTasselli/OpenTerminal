import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { vi } from "vitest";

// Same tmp-DB-and-dynamic-import pattern as portfolio.test.ts: db.ts reads DATA_DIR at
// import time and opens a real sqlite file there, so point it at a throwaway directory
// before dynamically importing db.js (and the routers, which import it).
let tmpDir: string;
let db: (typeof import("../db.js"))["db"];
let portfolioRouter: (typeof import("./portfolio.js"))["portfolioRouter"];
let pendingActionsRouter: (typeof import("./pendingActions.js"))["pendingActionsRouter"];
let portfolioId: number;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "bloomber-pending-actions-test-"));
  process.env.DATA_DIR = tmpDir;
  ({ db } = await import("../db.js"));
  ({ portfolioRouter } = await import("./portfolio.js"));
  ({ pendingActionsRouter } = await import("./pendingActions.js"));
  const portfolio = db.prepare("SELECT id FROM portfolios LIMIT 1").get() as { id: number };
  portfolioId = portfolio.id;
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

function fakeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function getHandler(router: any, path: string, method: "get" | "post" | "delete" = "get") {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`no route registered for ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle as (req: Request, res: Response, next: () => void) => unknown;
}

async function addTransaction(body: Record<string, unknown>): Promise<number> {
  const handler = getHandler(portfolioRouter, "/:id/transactions", "post");
  const req = { params: { id: String(portfolioId) }, body } as unknown as Request;
  const res = fakeRes();
  await handler(req, res, () => {});
  return (res.json as any).mock.calls[0][0].id as number;
}

function insertPendingAction(operation: "ADD" | "EDIT" | "DELETE", transactionId: number | null, payload: unknown): number {
  const info = db
    .prepare("INSERT INTO pending_actions (portfolio_id, operation, transaction_id, payload) VALUES (?, ?, ?, ?)")
    .run(portfolioId, operation, transactionId, JSON.stringify(payload));
  return Number(info.lastInsertRowid);
}

const ADD_PAYLOAD = {
  symbol: "AAPL",
  side: "BUY",
  quantity: 10,
  price: 150,
  executed_at: "2026-01-01T00:00:00Z",
  instrument_type: "EQUITY",
};

describe("GET /:id/pending-actions", () => {
  it("defaults to status='pending' and returns newest first", async () => {
    const olderId = insertPendingAction("ADD", null, ADD_PAYLOAD);
    db.prepare("UPDATE pending_actions SET created_at = '2020-01-01T00:00:00Z' WHERE id = ?").run(olderId);
    const newerId = insertPendingAction("ADD", null, ADD_PAYLOAD);
    db.prepare("UPDATE pending_actions SET created_at = '2024-01-01T00:00:00Z' WHERE id = ?").run(newerId);
    const rejectedId = insertPendingAction("ADD", null, ADD_PAYLOAD);
    db.prepare("UPDATE pending_actions SET status = 'rejected' WHERE id = ?").run(rejectedId);

    const handler = getHandler(pendingActionsRouter, "/:id/pending-actions", "get");
    const req = { params: { id: String(portfolioId) }, query: {} } as unknown as Request;
    const res = fakeRes();
    await handler(req, res, () => {});

    const rows = (res.json as any).mock.calls[0][0] as Array<{ id: number; status: string }>;
    expect(rows.every((r) => r.status === "pending")).toBe(true);
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf(newerId)).toBeLessThan(ids.indexOf(olderId));
    expect(ids).not.toContain(rejectedId);
  });

  it("returns every status when ?status=all is passed", async () => {
    const handler = getHandler(pendingActionsRouter, "/:id/pending-actions", "get");
    const req = { params: { id: String(portfolioId) }, query: { status: "all" } } as unknown as Request;
    const res = fakeRes();
    await handler(req, res, () => {});

    const rows = (res.json as any).mock.calls[0][0] as Array<{ status: string }>;
    expect(rows.some((r) => r.status === "rejected")).toBe(true);
  });
});

describe("POST /:id/pending-actions/:paId/confirm", () => {
  it("ADD: writes a transaction with source='ai' and the right pending_action_id", async () => {
    const paId = insertPendingAction("ADD", null, ADD_PAYLOAD);
    const handler = getHandler(pendingActionsRouter, "/:id/pending-actions/:paId/confirm", "post");
    const req = {
      params: { id: String(portfolioId), paId: String(paId) },
      body: ADD_PAYLOAD,
    } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(201);
    const body = (res.json as any).mock.calls[0][0];
    const row = db.prepare("SELECT * FROM transactions WHERE id = ?").get(body.id) as Record<string, unknown>;
    expect(row.source).toBe("ai");
    expect(row.pending_action_id).toBe(paId);

    const pa = db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(paId) as Record<string, unknown>;
    expect(pa.status).toBe("confirmed");
    expect(pa.resolved_at).not.toBeNull();
  });

  it("EDIT: updates the right row and re-tags it source='ai' with the pending_action_id", async () => {
    const txId = await addTransaction({
      symbol: "msft",
      side: "BUY",
      quantity: 5,
      price: 300,
      executed_at: "2026-01-02T00:00:00Z",
    });
    const editPayload = {
      symbol: "MSFT",
      side: "BUY",
      quantity: 7,
      price: 310,
      executed_at: "2026-01-03T00:00:00Z",
      instrument_type: "EQUITY",
    };
    const paId = insertPendingAction("EDIT", txId, editPayload);

    const handler = getHandler(pendingActionsRouter, "/:id/pending-actions/:paId/confirm", "post");
    const req = {
      params: { id: String(portfolioId), paId: String(paId) },
      body: editPayload,
    } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(200);
    const row = db.prepare("SELECT * FROM transactions WHERE id = ?").get(txId) as Record<string, unknown>;
    expect(row.quantity).toBe(7);
    expect(row.price).toBe(310);
    expect(row.source).toBe("ai");
    expect(row.pending_action_id).toBe(paId);

    const pa = db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(paId) as Record<string, unknown>;
    expect(pa.status).toBe("confirmed");
  });

  it("DELETE: removes the right row and needs no request body", async () => {
    const txId = await addTransaction({
      symbol: "tsla",
      side: "BUY",
      quantity: 1,
      price: 200,
      executed_at: "2026-01-04T00:00:00Z",
    });
    const snapshot = db.prepare("SELECT * FROM transactions WHERE id = ?").get(txId);
    const paId = insertPendingAction("DELETE", txId, snapshot);

    const handler = getHandler(pendingActionsRouter, "/:id/pending-actions/:paId/confirm", "post");
    const req = { params: { id: String(portfolioId), paId: String(paId) }, body: {} } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(200);
    const row = db.prepare("SELECT * FROM transactions WHERE id = ?").get(txId);
    expect(row).toBeUndefined();

    const pa = db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(paId) as Record<string, unknown>;
    expect(pa.status).toBe("confirmed");
  });

  it("400s on a validation failure (e.g. an OPTION ADD missing strike/option_type/expiration)", async () => {
    const paId = insertPendingAction("ADD", null, { ...ADD_PAYLOAD, instrument_type: "OPTION" });
    const handler = getHandler(pendingActionsRouter, "/:id/pending-actions/:paId/confirm", "post");
    const req = {
      params: { id: String(portfolioId), paId: String(paId) },
      body: { ...ADD_PAYLOAD, instrument_type: "OPTION" },
    } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    const pa = db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(paId) as Record<string, unknown>;
    expect(pa.status).toBe("pending");
  });

  it("404s confirming a nonexistent pending action", async () => {
    const handler = getHandler(pendingActionsRouter, "/:id/pending-actions/:paId/confirm", "post");
    const req = { params: { id: String(portfolioId), paId: "999999" }, body: ADD_PAYLOAD } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("404s confirming an already-resolved pending action", async () => {
    const paId = insertPendingAction("ADD", null, ADD_PAYLOAD);
    db.prepare("UPDATE pending_actions SET status = 'confirmed', resolved_at = datetime('now') WHERE id = ?").run(paId);

    const handler = getHandler(pendingActionsRouter, "/:id/pending-actions/:paId/confirm", "post");
    const req = { params: { id: String(portfolioId), paId: String(paId) }, body: ADD_PAYLOAD } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("POST /:id/pending-actions/:paId/confirm against a target that's already gone", () => {
  it("409s (and leaves the pending action pending) when two Pending Actions target the same transaction and the first DELETE confirm already removed it", async () => {
    const txId = await addTransaction({
      symbol: "nvda",
      side: "BUY",
      quantity: 2,
      price: 400,
      executed_at: "2026-01-05T00:00:00Z",
    });
    const snapshot = db.prepare("SELECT * FROM transactions WHERE id = ?").get(txId);
    const firstPaId = insertPendingAction("DELETE", txId, snapshot);
    const secondPaId = insertPendingAction("DELETE", txId, snapshot);

    const handler = getHandler(pendingActionsRouter, "/:id/pending-actions/:paId/confirm", "post");

    const firstReq = { params: { id: String(portfolioId), paId: String(firstPaId) }, body: {} } as unknown as Request;
    const firstRes = fakeRes();
    await handler(firstReq, firstRes, () => {});
    expect(firstRes.status).toHaveBeenCalledWith(200);

    // The transactions(id) ON DELETE SET NULL FK (db.ts) nulls out the second
    // Pending Action's transaction_id now that its target row is gone.
    const orphaned = db.prepare("SELECT transaction_id FROM pending_actions WHERE id = ?").get(secondPaId) as {
      transaction_id: number | null;
    };
    expect(orphaned.transaction_id).toBeNull();

    const secondReq = { params: { id: String(portfolioId), paId: String(secondPaId) }, body: {} } as unknown as Request;
    const secondRes = fakeRes();
    await handler(secondReq, secondRes, () => {});

    expect(secondRes.status).toHaveBeenCalledWith(409);
    const pa = db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(secondPaId) as Record<string, unknown>;
    expect(pa.status).toBe("pending");
    expect(pa.resolved_at).toBeNull();
  });

  it("409s an EDIT confirm whose target transaction was deleted manually in the meantime", async () => {
    const txId = await addTransaction({
      symbol: "amzn",
      side: "BUY",
      quantity: 3,
      price: 150,
      executed_at: "2026-01-06T00:00:00Z",
    });
    const editPayload = {
      symbol: "AMZN",
      side: "BUY",
      quantity: 4,
      price: 160,
      executed_at: "2026-01-07T00:00:00Z",
      instrument_type: "EQUITY",
    };
    const paId = insertPendingAction("EDIT", txId, editPayload);

    // Manual delete, same path PortfolioWidget.tsx's transaction-delete button uses.
    const deleteHandler = getHandler(portfolioRouter, "/:id/transactions/:txId", "delete");
    await deleteHandler(
      { params: { id: String(portfolioId), txId: String(txId) } } as unknown as Request,
      fakeRes(),
      () => {}
    );

    const confirmHandler = getHandler(pendingActionsRouter, "/:id/pending-actions/:paId/confirm", "post");
    const req = { params: { id: String(portfolioId), paId: String(paId) }, body: editPayload } as unknown as Request;
    const res = fakeRes();
    await confirmHandler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(409);
    const pa = db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(paId) as Record<string, unknown>;
    expect(pa.status).toBe("pending");
  });
});

describe("POST /:id/pending-actions/:paId/reject", () => {
  it("leaves transactions untouched and marks status='rejected'", async () => {
    const paId = insertPendingAction("ADD", null, ADD_PAYLOAD);
    const beforeCount = (db.prepare("SELECT COUNT(*) AS c FROM transactions").get() as { c: number }).c;

    const handler = getHandler(pendingActionsRouter, "/:id/pending-actions/:paId/reject", "post");
    const req = { params: { id: String(portfolioId), paId: String(paId) }, body: {} } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(200);
    const afterCount = (db.prepare("SELECT COUNT(*) AS c FROM transactions").get() as { c: number }).c;
    expect(afterCount).toBe(beforeCount);

    const pa = db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(paId) as Record<string, unknown>;
    expect(pa.status).toBe("rejected");
    expect(pa.resolved_at).not.toBeNull();
  });

  it("404s rejecting a nonexistent or already-resolved pending action", async () => {
    const handler = getHandler(pendingActionsRouter, "/:id/pending-actions/:paId/reject", "post");
    const req = { params: { id: String(portfolioId), paId: "999999" }, body: {} } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
