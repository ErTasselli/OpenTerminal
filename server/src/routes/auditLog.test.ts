import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

// Same tmp-DB-and-dynamic-import pattern as memory.test.ts/portfolio.test.ts: db.ts
// reads DATA_DIR at import time and opens a real sqlite file there, so point it at
// a throwaway directory before dynamically importing db.js (and auditLog.js, which
// imports it).
let tmpDir: string;
let db: (typeof import("../db.js"))["db"];
let auditLogRouter: (typeof import("./auditLog.js"))["auditLogRouter"];
let writeAuditLog: (typeof import("../audit.js"))["writeAuditLog"];
let runWriteMemoryTool: (typeof import("../llm/memoryTools.js"))["runWriteMemoryTool"];
let runProposeTransactionTool: (typeof import("../llm/transactionTools.js"))["runProposeTransactionTool"];
let pendingActionsRouter: (typeof import("./pendingActions.js"))["pendingActionsRouter"];

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "openterminal-auditlog-test-"));
  process.env.DATA_DIR = tmpDir;
  ({ db } = await import("../db.js"));
  ({ auditLogRouter } = await import("./auditLog.js"));
  ({ writeAuditLog } = await import("../audit.js"));
  ({ runWriteMemoryTool } = await import("../llm/memoryTools.js"));
  ({ runProposeTransactionTool } = await import("../llm/transactionTools.js"));
  ({ pendingActionsRouter } = await import("./pendingActions.js"));
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
  } as unknown as Response;
}

function getHandler(router: any, path: string, method: "get" | "post" = "get") {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
  if (!layer) throw new Error(`no route registered for ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle as (req: Request, res: Response, next: () => void) => unknown;
}

describe("GET /api/audit-log", () => {
  it("lists entries newest first", async () => {
    writeAuditLog({ eventType: "error", summary: "older", detail: { error: "older" } });
    writeAuditLog({ eventType: "error", summary: "newer", detail: { error: "newer" } });

    const handler = getHandler(auditLogRouter, "/", "get");
    const req = { query: {} } as unknown as Request;
    const res = fakeRes();
    await handler(req, res, () => {});

    const rows = (res.json as any).mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].summary).toBe("newer");
  });

  it("filters by ?event_type=", async () => {
    writeAuditLog({ eventType: "memory_write", summary: "a memory note", detail: { content: "a memory note" } });

    const handler = getHandler(auditLogRouter, "/", "get");
    const req = { query: { event_type: "memory_write" } } as unknown as Request;
    const res = fakeRes();
    await handler(req, res, () => {});

    const rows = (res.json as any).mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.event_type === "memory_write")).toBe(true);
  });

  it("400s on an unrecognized event_type", async () => {
    const handler = getHandler(auditLogRouter, "/", "get");
    const req = { query: { event_type: "not-a-real-type" } } as unknown as Request;
    const res = fakeRes();
    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("respects ?limit= and caps it at 200", async () => {
    for (let i = 0; i < 5; i++) {
      writeAuditLog({ eventType: "error", summary: `bulk ${i}`, detail: { error: `bulk ${i}` } });
    }

    const handler = getHandler(auditLogRouter, "/", "get");
    const req = { query: { limit: "3" } } as unknown as Request;
    const res = fakeRes();
    await handler(req, res, () => {});

    const rows = (res.json as any).mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows.length).toBe(3);

    const req2 = { query: { limit: "99999" } } as unknown as Request;
    const res2 = fakeRes();
    await handler(req2, res2, () => {});
    // Capped at MAX_LIMIT (200), never serving every row unbounded.
    const rows2 = (res2.json as any).mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows2.length).toBeLessThanOrEqual(200);
  });

  it("400s on a non-positive-integer limit", async () => {
    const handler = getHandler(auditLogRouter, "/", "get");
    const req = { query: { limit: "not-a-number" } } as unknown as Request;
    const res = fakeRes();
    await handler(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("has no POST/PUT/PATCH/DELETE route registered", () => {
    const hasMutatingRoute = (auditLogRouter as any).stack.some(
      (l: any) => l.route && (l.route.methods.post || l.route.methods.put || l.route.methods.patch || l.route.methods.delete)
    );
    expect(hasMutatingRoute).toBe(false);
  });
});

describe("Audit Log integration with other AI write paths", () => {
  it("runWriteMemoryTool produces a memory_write audit row", async () => {
    await runWriteMemoryTool({ content: "integration-test memory note" });

    const row = db
      .prepare("SELECT * FROM audit_log WHERE event_type = 'memory_write' ORDER BY id DESC LIMIT 1")
      .get() as Record<string, unknown>;
    const detail = JSON.parse(row.detail as string);
    expect(detail.content).toBe("integration-test memory note");
  });

  it("runProposeTransactionTool produces a pending_action row with action: 'proposed'", async () => {
    const result = await runProposeTransactionTool({
      operation: "ADD",
      symbol: "AAPL",
      side: "BUY",
      quantity: 10,
      price: 150,
      executed_at: "2026-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(true);

    const row = db
      .prepare("SELECT * FROM audit_log WHERE event_type = 'pending_action' ORDER BY id DESC LIMIT 1")
      .get() as Record<string, unknown>;
    const detail = JSON.parse(row.detail as string);
    expect(detail.action).toBe("proposed");
    expect(detail.operation).toBe("ADD");
  });

  it("confirming an ADD Pending Action produces a confirmed audit row with after.source === 'ai'", async () => {
    const portfolio = db.prepare("SELECT id FROM portfolios LIMIT 1").get() as { id: number };
    const payload = {
      symbol: "MSFT",
      side: "BUY",
      quantity: 5,
      price: 300,
      executed_at: "2026-01-02T00:00:00Z",
      instrument_type: "EQUITY",
    };
    const info = db
      .prepare("INSERT INTO pending_actions (portfolio_id, operation, transaction_id, payload) VALUES (?, 'ADD', NULL, ?)")
      .run(portfolio.id, JSON.stringify(payload));
    const paId = Number(info.lastInsertRowid);

    const handler = getHandler(pendingActionsRouter, "/:id/pending-actions/:paId/confirm", "post");
    const req = { params: { id: String(portfolio.id), paId: String(paId) }, body: payload } as unknown as Request;
    const res = fakeRes();
    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(201);
    const row = db
      .prepare("SELECT * FROM audit_log WHERE event_type = 'pending_action' ORDER BY id DESC LIMIT 1")
      .get() as Record<string, unknown>;
    const detail = JSON.parse(row.detail as string);
    expect(detail.action).toBe("confirmed");
    expect(detail.operation).toBe("ADD");
    expect(detail.after.source).toBe("ai");
    expect(typeof detail.after.transactionId).toBe("number");
  });

  it("rejecting a Pending Action produces a rejected audit row with after: null", async () => {
    const portfolio = db.prepare("SELECT id FROM portfolios LIMIT 1").get() as { id: number };
    const payload = {
      symbol: "TSLA",
      side: "BUY",
      quantity: 1,
      price: 200,
      executed_at: "2026-01-03T00:00:00Z",
      instrument_type: "EQUITY",
    };
    const info = db
      .prepare("INSERT INTO pending_actions (portfolio_id, operation, transaction_id, payload) VALUES (?, 'ADD', NULL, ?)")
      .run(portfolio.id, JSON.stringify(payload));
    const paId = Number(info.lastInsertRowid);

    const handler = getHandler(pendingActionsRouter, "/:id/pending-actions/:paId/reject", "post");
    const req = { params: { id: String(portfolio.id), paId: String(paId) }, body: {} } as unknown as Request;
    const res = fakeRes();
    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(200);
    const row = db
      .prepare("SELECT * FROM audit_log WHERE event_type = 'pending_action' ORDER BY id DESC LIMIT 1")
      .get() as Record<string, unknown>;
    const detail = JSON.parse(row.detail as string);
    expect(detail.action).toBe("rejected");
    expect(detail.after).toBeNull();
  });
});
