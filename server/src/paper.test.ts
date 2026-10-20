import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo, Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let dir: string;
let server: Server;
let base: string;
let mod: typeof import("./paper.js");
let db: (typeof import("./db.js"))["db"];

/** Quotes the test controls: symbol -> { price, bid, ask }. */
const book = new Map<string, { price: number | null; bid: number | null; ask: number | null }>();
const getQuotes = async (syms: string[]) =>
  syms.filter((s) => book.has(s)).map((s) => ({ symbol: s, ...book.get(s)! }) as any);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ot-paper-test-"));
  process.env.DATA_DIR = dir;
  const express = (await import("express")).default;
  mod = await import("./paper.js");
  ({ db } = await import("./db.js"));
  const app = express();
  app.use(express.json());
  app.use("/paper", mod.createPaperRouter(getQuotes));
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/paper`;
});
afterAll(() => {
  server.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});
beforeEach(async () => {
  book.clear();
  book.set("AAPL", { price: 100, bid: 99.9, ask: 100.1 });
  await fetch(`${base}/reset`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
});

const order = (o: object) =>
  fetch(`${base}/orders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o) });
const acct = async () => (await fetch(base)).json();
const mkt = (side: string, quantity: number, symbol = "AAPL") => order({ symbol, side, type: "market", quantity });

describe("market orders", () => {
  it("buys at the ask and sells at the bid, so the spread costs money", async () => {
    const buy = await (await mkt("BUY", 10)).json();
    expect(buy).toMatchObject({ status: "filled", fill_price: 100.1 });
    expect((await acct()).cash).toBe(100_000 - 1001);

    const sell = await (await mkt("SELL", 10)).json();
    expect(sell).toMatchObject({ status: "filled", fill_price: 99.9 });
    const a = await acct();
    expect(a.cash).toBe(100_000 - 2); // round trip lost the 0.20 spread x 10 shares
    expect(a.positions[0]).toMatchObject({ symbol: "AAPL", quantity: 0 });
    expect(a.positions[0].realizedPnl).toBeCloseTo(-2, 9);
  });

  it("falls back to the last price when bid/ask look broken", async () => {
    book.set("AAPL", { price: 100, bid: 0, ask: 900 });
    expect((await (await mkt("BUY", 1)).json()).fill_price).toBe(100);
  });

  it("returns 503 when there's no live price", async () => {
    expect((await mkt("BUY", 1, "MSFT")).status).toBe(503);
  });
});

describe("beginner guard rails", () => {
  it("never allows short selling", async () => {
    expect((await mkt("SELL", 1)).status).toBe(409);
    await mkt("BUY", 5);
    expect((await mkt("SELL", 6)).status).toBe(409);
  });

  it("never allows spending more cash than the account has (no margin)", async () => {
    const res = await mkt("BUY", 1_000); // 1000 x 100.1 > 100k
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/buying power/);
  });

  it("counts cash promised to open buy orders against buying power", async () => {
    expect((await order({ symbol: "AAPL", side: "BUY", type: "limit", quantity: 900, limitPrice: 90 })).status).toBe(201);
    expect((await acct()).reserved.cash).toBe(81_000);
    expect((await mkt("BUY", 200)).status).toBe(409); // 20k > 100k - 81k
    expect((await mkt("BUY", 100)).status).toBe(201);
  });

  it("counts shares promised to open sell orders against what can be sold", async () => {
    await mkt("BUY", 10);
    expect((await order({ symbol: "AAPL", side: "SELL", type: "limit", quantity: 8, limitPrice: 120 })).status).toBe(201);
    expect((await mkt("SELL", 3)).status).toBe(409);
    expect((await mkt("SELL", 2)).status).toBe(201);
  });
});

describe("limit and stop orders", () => {
  it("a buy limit waits, then fills at the limit or better", async () => {
    const o = await (await order({ symbol: "AAPL", side: "BUY", type: "limit", quantity: 10, limitPrice: 95 })).json();
    expect(o.status).toBe("open");
    expect(await mod.evaluatePaperOrders(getQuotes)).toEqual([]);
    book.set("AAPL", { price: 94, bid: 93.9, ask: 94.1 });
    expect(await mod.evaluatePaperOrders(getQuotes)).toEqual([o.id]);
    const filled = (await (await fetch(`${base}/orders`)).json()).find((x: any) => x.id === o.id);
    expect(filled).toMatchObject({ status: "filled", fill_price: 94.1 });
  });

  it("a stop-loss sells once the price falls to the stop", async () => {
    await mkt("BUY", 10);
    const stop = await (await order({ symbol: "AAPL", side: "SELL", type: "stop", quantity: 10, stopPrice: 90 })).json();
    book.set("AAPL", { price: 91, bid: 90.9, ask: 91.1 });
    expect(await mod.evaluatePaperOrders(getQuotes)).toEqual([]);
    book.set("AAPL", { price: 89, bid: 88.9, ask: 89.1 });
    expect(await mod.evaluatePaperOrders(getQuotes)).toEqual([stop.id]);
    expect((await acct()).positions[0].quantity).toBe(0);
  });

  it("re-checks cash at fill time and rejects (with a reason) if it's gone", async () => {
    const o = await (await order({ symbol: "AAPL", side: "BUY", type: "limit", quantity: 10, limitPrice: 95 })).json();
    db.prepare("UPDATE paper_account SET cash = 10").run(); // simulate the money disappearing
    book.set("AAPL", { price: 94, bid: 93.9, ask: 94.1 });
    await mod.evaluatePaperOrders(getQuotes);
    const row = (await (await fetch(`${base}/orders`)).json()).find((x: any) => x.id === o.id);
    expect(row.status).toBe("rejected");
    expect(row.reason).toMatch(/not enough cash/);
  });

  it("cancels open orders only", async () => {
    const o = await (await order({ symbol: "AAPL", side: "BUY", type: "limit", quantity: 1, limitPrice: 50 })).json();
    expect((await fetch(`${base}/orders/${o.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await fetch(`${base}/orders/${o.id}`, { method: "DELETE" })).status).toBe(409);
    expect((await fetch(`${base}/orders/999999`, { method: "DELETE" })).status).toBe(404);
    expect((await acct()).reserved.cash).toBe(0);
  });
});

describe("validation and reset", () => {
  it.each([
    ["limit without a price", { symbol: "AAPL", side: "BUY", type: "limit", quantity: 1 }],
    ["stop without a price", { symbol: "AAPL", side: "SELL", type: "stop", quantity: 1 }],
    ["bad symbol", { symbol: "=CMD", side: "BUY", type: "market", quantity: 1 }],
    ["zero quantity", { symbol: "AAPL", side: "BUY", type: "market", quantity: 0 }],
    ["unknown field", { symbol: "AAPL", side: "BUY", type: "market", quantity: 1, price: 0.01 }],
  ])("rejects %s", async (_n, body) => {
    expect((await order(body)).status).toBe(400);
  });

  it("rejects an Infinity quantity sent as 1e400", async () => {
    const res = await fetch(`${base}/orders`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: '{"symbol":"AAPL","side":"BUY","type":"market","quantity":1e400}',
    });
    expect(res.status).toBe(400);
  });

  it("reset wipes orders and restores cash, with a custom starting balance", async () => {
    await mkt("BUY", 10);
    const r = await fetch(`${base}/reset`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"startingCash":25000}' });
    expect(await r.json()).toEqual({ startingCash: 25000, cash: 25000 });
    const a = await acct();
    expect(a.positions).toEqual([]);
    expect((await (await fetch(`${base}/orders`)).json())).toEqual([]);
    expect((await fetch(`${base}/reset`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"startingCash":5}' })).status).toBe(400);
  });
});
