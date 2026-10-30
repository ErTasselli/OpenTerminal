import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo, Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let dir: string;
let server: Server;
let base: string;
let mod: typeof import("./alerts.js");
let db: (typeof import("./db.js"))["db"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ot-alerts-test-"));
  process.env.DATA_DIR = dir;
  const express = (await import("express")).default;
  mod = await import("./alerts.js");
  ({ db } = await import("./db.js"));
  const app = express();
  app.use(express.json());
  app.use("/alerts", mod.alertsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/alerts`;
});
afterAll(() => {
  server.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});
beforeEach(() => db.exec("DELETE FROM alerts; DELETE FROM alert_events;"));

const create = (body: object) =>
  fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const quotes = (rows: Record<string, { price?: number | null; changePercent?: number | null }>) => async (syms: string[]) =>
  syms.filter((s) => rows[s]).map((s) => ({ symbol: s, price: null, changePercent: null, ...rows[s] }) as any);
const events = async (after?: number) =>
  (await fetch(`${base}/events${after === undefined ? "" : `?after=${after}`}`)).json();

describe("isTriggered", () => {
  it.each([
    ["above", 100, { price: 100 }, true],
    ["above", 100, { price: 99.99 }, false],
    ["below", 100, { price: 100 }, true],
    ["below", 100, { price: 100.01 }, false],
    ["pct_up", 5, { changePercent: 5.2 }, true],
    ["pct_up", 5, { changePercent: -6 }, false],
    ["pct_down", 5, { changePercent: -5 }, true],
    ["pct_down", 5, { changePercent: 4 }, false],
    ["above", 100, { price: null }, false],
    ["below", 100, { price: NaN }, false],
  ] as const)("%s %s with %j -> %s", (kind, threshold, q, want) => {
    expect(mod.isTriggered({ kind, threshold }, { price: null, changePercent: null, ...q })).toBe(want);
  });
});

describe("alert lifecycle", () => {
  it("fires once, disarms, and is delivered through the event log", async () => {
    const { id } = await (await create({ symbol: "aapl", kind: "above", threshold: 100, note: "breakout" })).json();
    const { cursor } = await events();
    expect(await mod.evaluateAlerts(quotes({ AAPL: { price: 99 } }))).toEqual([]);
    expect(await mod.evaluateAlerts(quotes({ AAPL: { price: 101 } }))).toEqual([id]);
    expect(await mod.evaluateAlerts(quotes({ AAPL: { price: 102 } }))).toEqual([]); // one-shot

    const got = await events(cursor);
    expect(got.events).toHaveLength(1);
    expect(got.events[0]).toMatchObject({ alert_id: id, symbol: "AAPL", kind: "above", price: 101, note: "breakout" });
    expect((await events(got.cursor)).events).toEqual([]);
  });

  it("keeps the cursor monotonic across re-arm and delete (no lost or repeated events)", async () => {
    const { id } = await (await create({ symbol: "MSFT", kind: "below", threshold: 50 })).json();
    await mod.evaluateAlerts(quotes({ MSFT: { price: 40 } }));
    const first = await events(0);
    const seq1 = first.events[0].seq;

    expect((await fetch(`${base}/${id}/rearm`, { method: "POST" })).status).toBe(200);
    await mod.evaluateAlerts(quotes({ MSFT: { price: 45 } }));
    const second = await events(first.cursor);
    expect(second.events).toHaveLength(1);
    expect(second.events[0].seq).toBeGreaterThan(seq1);

    expect((await fetch(`${base}/${id}`, { method: "DELETE" })).status).toBe(204);
    const { id: id2 } = await (await create({ symbol: "MSFT", kind: "below", threshold: 50 })).json();
    await mod.evaluateAlerts(quotes({ MSFT: { price: 45 } }));
    const third = await events(second.cursor);
    expect(third.events.map((e: any) => e.alert_id)).toEqual([id2]);
    expect(third.events[0].seq).toBeGreaterThan(second.events[0].seq);
  });

  it("first poll without a cursor returns no backlog", async () => {
    await create({ symbol: "TSLA", kind: "pct_down", threshold: 3 });
    await mod.evaluateAlerts(quotes({ TSLA: { changePercent: -4 } }));
    const fresh = await events();
    expect(fresh.events).toEqual([]);
    expect(fresh.cursor).toBeGreaterThan(0);
  });

  it("fires a percent alert even when the quote has no price, recording the % move", async () => {
    const { id } = await (await create({ symbol: "AMD", kind: "pct_up", threshold: 2 })).json();
    const { cursor } = await events();
    expect(await mod.evaluateAlerts(quotes({ AMD: { price: null, changePercent: 2.5 } }))).toEqual([id]);
    expect((await events(cursor)).events[0]).toMatchObject({ price: null, change_percent: 2.5 });
  });

  it("one failing alert does not block the others in the same pass", async () => {
    const { id: a } = await (await create({ symbol: "AAPL", kind: "above", threshold: 1 })).json();
    const { id: b } = await (await create({ symbol: "MSFT", kind: "above", threshold: 1 })).json();
    db.exec("CREATE TRIGGER boom BEFORE INSERT ON alert_events WHEN NEW.symbol = 'AAPL' BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    try {
      const fired = await mod.evaluateAlerts(quotes({ AAPL: { price: 5 }, MSFT: { price: 5 } }));
      expect(fired).toEqual([b]);
      // the failed one was rolled back as a unit: still armed, so it retries next pass
      expect(db.prepare("SELECT active FROM alerts WHERE id = ?").get(a)).toEqual({ active: 1 });
    } finally {
      db.exec("DROP TRIGGER boom");
    }
  });

  it("ignores symbols the quote source didn't return", async () => {
    await create({ symbol: "NVDA", kind: "above", threshold: 1 });
    expect(await mod.evaluateAlerts(quotes({}))).toEqual([]);
  });
});

describe("validation and caps", () => {
  it.each([
    ["bad symbol", { symbol: "<x>", kind: "above", threshold: 1 }],
    ["unknown kind", { symbol: "AAPL", kind: "sideways", threshold: 1 }],
    ["Infinity-ish threshold", { symbol: "AAPL", kind: "above", threshold: 1e300 }],
    ["percent over 100", { symbol: "AAPL", kind: "pct_up", threshold: 150 }],
    ["note too long", { symbol: "AAPL", kind: "above", threshold: 1, note: "x".repeat(121) }],
    ["extra field", { symbol: "AAPL", kind: "above", threshold: 1, active: 0 }],
  ])("rejects %s", async (_n, body) => {
    expect((await create(body)).status).toBe(400);
  });

  it("caps active alerts", async () => {
    const ins = db.prepare("INSERT INTO alerts (symbol, kind, threshold) VALUES ('AAPL', 'above', ?)");
    db.transaction(() => { for (let i = 0; i < mod.ALERT_LIMITS.maxActive; i++) ins.run(i + 1); })();
    expect((await create({ symbol: "AAPL", kind: "above", threshold: 1 })).status).toBe(409);
  });

  it("caps distinct watched symbols", async () => {
    const ins = db.prepare("INSERT INTO alerts (symbol, kind, threshold) VALUES (?, 'above', 1)");
    db.transaction(() => { for (let i = 0; i < mod.ALERT_LIMITS.maxSymbols; i++) ins.run(`S${i}`); })();
    expect((await create({ symbol: "NEWSYM", kind: "above", threshold: 1 })).status).toBe(409);
    expect((await create({ symbol: "S1", kind: "below", threshold: 1 })).status).toBe(201); // existing symbol ok
  });

  it("validates ids and the event cursor", async () => {
    expect((await fetch(`${base}/abc`, { method: "DELETE" })).status).toBe(400);
    expect((await fetch(`${base}/999999`, { method: "DELETE" })).status).toBe(404);
    expect((await fetch(`${base}/events?after=-1`)).status).toBe(400);
  });
});
