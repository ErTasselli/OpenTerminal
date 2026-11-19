import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

// db.ts reads DATA_DIR at import time and opens a real sqlite file there, so
// point it at a throwaway directory instead of the app's real data/ folder,
// before dynamically importing db.js (and portfolio.js, which imports it).
let tmpDir: string;
let db: (typeof import("../db.js"))["db"];
let portfolioRouter: (typeof import("./portfolio.js"))["portfolioRouter"];
let portfolioId: number;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "bloomber-portfolio-test-"));
  process.env.DATA_DIR = tmpDir;
  ({ db } = await import("../db.js"));
  ({ portfolioRouter } = await import("./portfolio.js"));
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
  } as unknown as Response;
}

function getHandler(path: string, method: "get" | "post" | "delete" = "get") {
  const layer = (portfolioRouter as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method]
  );
  if (!layer) throw new Error(`no route registered for ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle as (req: Request, res: Response, next: () => void) => unknown;
}

describe("POST /:id/transactions", () => {
  it("accepts a valid OPTION transaction and reflects the option fields in the response", async () => {
    const handler = getHandler("/:id/transactions", "post");
    const req = {
      params: { id: String(portfolioId) },
      body: {
        symbol: "aapl",
        side: "BUY",
        quantity: 2,
        price: 3.5,
        executed_at: "2026-01-01T00:00:00Z",
        instrument_type: "OPTION",
        option_type: "CALL",
        strike: 150,
        expiration: "2026-06-19",
      },
    } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(201);
    const body = (res.json as any).mock.calls[0][0];
    expect(body).toMatchObject({
      symbol: "AAPL",
      instrument_type: "OPTION",
      option_type: "CALL",
      strike: 150,
      expiration: "2026-06-19",
    });
  });

  it("rejects an OPTION transaction missing option_type/strike/expiration with 400", async () => {
    const handler = getHandler("/:id/transactions", "post");
    const req = {
      params: { id: String(portfolioId) },
      body: {
        symbol: "aapl",
        side: "BUY",
        quantity: 1,
        price: 3.5,
        executed_at: "2026-01-01T00:00:00Z",
        instrument_type: "OPTION",
      },
    } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("accepts an EQUITY transaction with stray option fields and nulls them out", async () => {
    const handler = getHandler("/:id/transactions", "post");
    const req = {
      params: { id: String(portfolioId) },
      body: {
        symbol: "msft",
        side: "BUY",
        quantity: 5,
        price: 300,
        executed_at: "2026-01-02T00:00:00Z",
        option_type: "CALL",
        strike: 150,
        expiration: "2026-06-19",
      },
    } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(201);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.instrument_type).toBe("EQUITY");
    expect(body.option_type).toBeNull();
    expect(body.strike).toBeNull();
    expect(body.expiration).toBeNull();

    const row = db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get(body.id) as Record<string, unknown>;
    expect(row.option_type).toBeNull();
    expect(row.strike).toBeNull();
    expect(row.expiration).toBeNull();
  });

  it("accepts an EQUITY transaction with a stray non-positive strike instead of 400ing", async () => {
    const handler = getHandler("/:id/transactions", "post");
    const req = {
      params: { id: String(portfolioId) },
      body: {
        symbol: "zerostrike",
        side: "BUY",
        quantity: 1,
        price: 10,
        executed_at: "2026-01-03T00:00:00Z",
        instrument_type: "EQUITY",
        strike: 0,
      },
    } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(201);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.strike).toBeNull();
  });
});

describe("GET /:id/positions", () => {
  it("keeps an EQUITY position and an OPTION position on the same underlying separate", async () => {
    const postHandler = getHandler("/:id/transactions", "post");
    const getHandlerFn = getHandler("/:id/positions", "get");

    await postHandler(
      {
        params: { id: String(portfolioId) },
        body: {
          symbol: "sepeq",
          side: "BUY",
          quantity: 10,
          price: 50,
          executed_at: "2026-02-01T00:00:00Z",
        },
      } as unknown as Request,
      fakeRes(),
      () => {}
    );
    await postHandler(
      {
        params: { id: String(portfolioId) },
        body: {
          symbol: "sepeq",
          side: "BUY",
          quantity: 1,
          price: 4,
          executed_at: "2026-02-02T00:00:00Z",
          instrument_type: "OPTION",
          option_type: "CALL",
          strike: 55,
          expiration: "2026-12-18",
        },
      } as unknown as Request,
      fakeRes(),
      () => {}
    );

    const res = fakeRes();
    await getHandlerFn({ params: { id: String(portfolioId) } } as unknown as Request, res, () => {});

    const positions = (res.json as any).mock.calls[0][0] as Array<Record<string, unknown>>;
    const sepeqPositions = positions.filter((p) => p.symbol === "SEPEQ");
    expect(sepeqPositions).toHaveLength(2);
    expect(sepeqPositions.some((p) => p.instrumentType === "EQUITY")).toBe(true);
    expect(sepeqPositions.some((p) => p.instrumentType === "OPTION")).toBe(true);
  });

  it("keeps two OPTION positions with different strikes (same symbol/type/expiration) separate", async () => {
    const postHandler = getHandler("/:id/transactions", "post");
    const getHandlerFn = getHandler("/:id/positions", "get");

    await postHandler(
      {
        params: { id: String(portfolioId) },
        body: {
          symbol: "strk",
          side: "BUY",
          quantity: 1,
          price: 2,
          executed_at: "2026-03-01T00:00:00Z",
          instrument_type: "OPTION",
          option_type: "PUT",
          strike: 100,
          expiration: "2026-09-18",
        },
      } as unknown as Request,
      fakeRes(),
      () => {}
    );
    await postHandler(
      {
        params: { id: String(portfolioId) },
        body: {
          symbol: "strk",
          side: "BUY",
          quantity: 1,
          price: 2,
          executed_at: "2026-03-02T00:00:00Z",
          instrument_type: "OPTION",
          option_type: "PUT",
          strike: 110,
          expiration: "2026-09-18",
        },
      } as unknown as Request,
      fakeRes(),
      () => {}
    );

    const res = fakeRes();
    await getHandlerFn({ params: { id: String(portfolioId) } } as unknown as Request, res, () => {});

    const positions = (res.json as any).mock.calls[0][0] as Array<Record<string, unknown>>;
    const strkPositions = positions.filter((p) => p.symbol === "STRK");
    expect(strkPositions).toHaveLength(2);
    expect(strkPositions.map((p) => p.strike).sort()).toEqual([100, 110]);
  });

  it("applies the 100x multiplier to realizedPnl for an OPTION partial sell, and exposes multiplier per row", async () => {
    const postHandler = getHandler("/:id/transactions", "post");
    const getHandlerFn = getHandler("/:id/positions", "get");

    // Buy 2 contracts @ $3.00 premium, then sell 1 contract @ $4.00 premium.
    // realizedPnl = (4.00 - 3.00) * 1 * 100 = $100
    await postHandler(
      {
        params: { id: String(portfolioId) },
        body: {
          symbol: "pnlopt",
          side: "BUY",
          quantity: 2,
          price: 3.0,
          executed_at: "2026-04-01T00:00:00Z",
          instrument_type: "OPTION",
          option_type: "CALL",
          strike: 200,
          expiration: "2026-11-20",
        },
      } as unknown as Request,
      fakeRes(),
      () => {}
    );
    await postHandler(
      {
        params: { id: String(portfolioId) },
        body: {
          symbol: "pnlopt",
          side: "SELL",
          quantity: 1,
          price: 4.0,
          executed_at: "2026-04-02T00:00:00Z",
          instrument_type: "OPTION",
          option_type: "CALL",
          strike: 200,
          expiration: "2026-11-20",
        },
      } as unknown as Request,
      fakeRes(),
      () => {}
    );
    // Equity row to check multiplier: 1 for EQUITY.
    await postHandler(
      {
        params: { id: String(portfolioId) },
        body: {
          symbol: "pnleq",
          side: "BUY",
          quantity: 1,
          price: 10,
          executed_at: "2026-04-01T00:00:00Z",
        },
      } as unknown as Request,
      fakeRes(),
      () => {}
    );

    const res = fakeRes();
    await getHandlerFn({ params: { id: String(portfolioId) } } as unknown as Request, res, () => {});

    const positions = (res.json as any).mock.calls[0][0] as Array<Record<string, unknown>>;
    const optPosition = positions.find((p) => p.symbol === "PNLOPT");
    const eqPosition = positions.find((p) => p.symbol === "PNLEQ");

    expect(optPosition).toBeDefined();
    expect(optPosition?.multiplier).toBe(100);
    expect(optPosition?.realizedPnl).toBeCloseTo(100, 5);
    expect(optPosition?.quantity).toBe(1);

    expect(eqPosition).toBeDefined();
    expect(eqPosition?.multiplier).toBe(1);
  });

  it("does not merge a crafted EQUITY symbol with a real OPTION position's composite key", async () => {
    const postHandler = getHandler("/:id/transactions", "post");
    const getHandlerFn = getHandler("/:id/positions", "get");

    // A real OPTION position: symbol "A", PUT, strike 1, expiration "X".
    // A naive `${symbol}|${option_type}|${strike}|${expiration}` join would
    // produce the same string "A|PUT|1|X" for an EQUITY symbol literally
    // equal to that joined string, so post one of those too and confirm
    // they land as two distinct positions, not merged into one.
    await postHandler(
      {
        params: { id: String(portfolioId) },
        body: {
          symbol: "a",
          side: "BUY",
          quantity: 1,
          price: 2,
          executed_at: "2026-05-01T00:00:00Z",
          instrument_type: "OPTION",
          option_type: "PUT",
          strike: 1,
          expiration: "X",
        },
      } as unknown as Request,
      fakeRes(),
      () => {}
    );
    await postHandler(
      {
        params: { id: String(portfolioId) },
        body: {
          symbol: "a|put|1|x",
          side: "BUY",
          quantity: 1,
          price: 10,
          executed_at: "2026-05-02T00:00:00Z",
        },
      } as unknown as Request,
      fakeRes(),
      () => {}
    );

    const res = fakeRes();
    await getHandlerFn({ params: { id: String(portfolioId) } } as unknown as Request, res, () => {});

    const positions = (res.json as any).mock.calls[0][0] as Array<Record<string, unknown>>;
    const optPosition = positions.find((p) => p.symbol === "A" && p.instrumentType === "OPTION");
    const eqPosition = positions.find((p) => p.symbol === "A|PUT|1|X");

    expect(optPosition).toBeDefined();
    expect(optPosition?.avgCost).toBe(2);
    expect(eqPosition).toBeDefined();
    expect(eqPosition?.avgCost).toBe(10);
  });
});

describe("POST /:id/credit-spreads", () => {
  function validSpreadBody() {
    return {
      symbol: "spy",
      option_type: "CALL",
      expiration: "2026-12-18",
      quantity: 1,
      executed_at: "2026-06-01T00:00:00Z",
      short_strike: 450,
      short_price: 5,
      long_strike: 460,
      long_price: 2,
    };
  }

  it("writes two linked transaction rows (SELL short leg, BUY long leg) sharing one spread_id", async () => {
    const handler = getHandler("/:id/credit-spreads", "post");
    const req = { params: { id: String(portfolioId) }, body: validSpreadBody() } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(201);
    const body = (res.json as any).mock.calls[0][0];
    expect(typeof body.spread_id).toBe("string");
    expect(body.spread_id.length).toBeGreaterThan(0);
    expect(body.legs).toHaveLength(2);

    const shortLeg = body.legs.find((l: any) => l.side === "SELL");
    const longLeg = body.legs.find((l: any) => l.side === "BUY");
    expect(shortLeg).toMatchObject({
      symbol: "SPY",
      side: "SELL",
      instrument_type: "OPTION",
      option_type: "CALL",
      strike: 450,
      price: 5,
      expiration: "2026-12-18",
      spread_id: body.spread_id,
    });
    expect(longLeg).toMatchObject({
      symbol: "SPY",
      side: "BUY",
      instrument_type: "OPTION",
      option_type: "CALL",
      strike: 460,
      price: 2,
      expiration: "2026-12-18",
      spread_id: body.spread_id,
    });

    // Persisted rows actually share the spread_id in the DB, not just the response.
    const rows = db
      .prepare("SELECT * FROM transactions WHERE spread_id = ? ORDER BY side")
      .all(body.spread_id) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
  });

  it("rejects a request where the two strikes match with 400 and writes nothing", async () => {
    const handler = getHandler("/:id/credit-spreads", "post");
    const body = { ...validSpreadBody(), long_strike: 450 };
    const req = { params: { id: String(portfolioId) }, body } as unknown as Request;
    const res = fakeRes();

    const before = db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };
    await handler(req, res, () => {});
    const after = db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };

    expect(res.status).toHaveBeenCalledWith(400);
    expect(after.n).toBe(before.n);
  });

  it("rejects a net-debit request (short price <= long price) with 400 and writes nothing", async () => {
    const handler = getHandler("/:id/credit-spreads", "post");
    const body = { ...validSpreadBody(), short_price: 2, long_price: 5 };
    const req = { params: { id: String(portfolioId) }, body } as unknown as Request;
    const res = fakeRes();

    const before = db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };
    await handler(req, res, () => {});
    const after = db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };

    expect(res.status).toHaveBeenCalledWith(400);
    expect(after.n).toBe(before.n);
  });

  it("rejects a request missing required fields with 400", async () => {
    const handler = getHandler("/:id/credit-spreads", "post");
    const req = {
      params: { id: String(portfolioId) },
      body: { symbol: "spy", option_type: "CALL" },
    } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("does not change GET /:id/positions aggregation: a spread's two legs fold exactly like the same two transactions posted independently", async () => {
    // Guards the ticket's scope boundary: issue #52 (folding linked Legs into
    // one Position) is explicitly out of scope here, so posting via
    // /credit-spreads must resolve to the same positions as posting the same
    // SELL leg and BUY leg independently via /transactions (spread_id is not
    // yet consulted by the position-folding logic in GET /:id/positions).
    const postHandler = getHandler("/:id/transactions", "post");
    const spreadHandler = getHandler("/:id/credit-spreads", "post");
    const getHandlerFn = getHandler("/:id/positions", "get");

    await postHandler(
      {
        params: { id: String(portfolioId) },
        body: {
          symbol: "controlchk",
          side: "SELL",
          quantity: 1,
          price: 5,
          executed_at: "2026-06-01T00:00:00Z",
          instrument_type: "OPTION",
          option_type: "CALL",
          strike: 450,
          expiration: "2026-12-18",
        },
      } as unknown as Request,
      fakeRes(),
      () => {}
    );
    await postHandler(
      {
        params: { id: String(portfolioId) },
        body: {
          symbol: "controlchk",
          side: "BUY",
          quantity: 1,
          price: 2,
          executed_at: "2026-06-01T00:00:00Z",
          instrument_type: "OPTION",
          option_type: "CALL",
          strike: 460,
          expiration: "2026-12-18",
        },
      } as unknown as Request,
      fakeRes(),
      () => {}
    );
    await spreadHandler(
      {
        params: { id: String(portfolioId) },
        body: { ...validSpreadBody(), symbol: "spreadchk" },
      } as unknown as Request,
      fakeRes(),
      () => {}
    );

    const res = fakeRes();
    await getHandlerFn({ params: { id: String(portfolioId) } } as unknown as Request, res, () => {});
    const positions = (res.json as any).mock.calls[0][0] as Array<Record<string, unknown>>;

    const strip = (p: Record<string, unknown>) => {
      const { symbol, ...rest } = p;
      return rest;
    };
    const controlPositions = positions.filter((p) => p.symbol === "CONTROLCHK").map(strip);
    const spreadPositions = positions.filter((p) => p.symbol === "SPREADCHK").map(strip);
    expect(spreadPositions).toEqual(controlPositions);
  });
});
