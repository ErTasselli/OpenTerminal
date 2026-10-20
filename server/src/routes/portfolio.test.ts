import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo, Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Real router + real sqlite in a throwaway DATA_DIR, served on an ephemeral
// loopback port (works under `docker run --network none`).
let dir: string;
let server: Server;
let base: string;
let closeDb: () => void;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ot-portfolio-test-"));
  process.env.DATA_DIR = dir;
  const express = (await import("express")).default;
  const { portfolioRouter } = await import("./portfolio.js");
  const { db } = await import("../db.js");
  closeDb = () => db.close();
  const app = express();
  app.use(express.json());
  app.use("/p", portfolioRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/p`;
});

afterAll(() => {
  server.close();
  closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

const post = (path: string, body: string | object) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const tx = (side: string, quantity: number, at: string, symbol = "AAPL") => ({
  symbol, side, quantity, price: 10, executed_at: at,
});

async function newPortfolio(name: string): Promise<number> {
  return (await (await post("", { name })).json()).id;
}

describe("transaction validation", () => {
  it("rejects a quantity that JSON-parses to Infinity (1e400)", async () => {
    const id = await newPortfolio("inf");
    const res = await post(`/${id}/transactions`,
      '{"symbol":"AAPL","side":"BUY","quantity":1e400,"price":1,"executed_at":"2026-01-01T00:00:00Z"}');
    expect(res.status).toBe(400);
  });

  it("rejects a non-date executed_at and a non-ticker symbol", async () => {
    const id = await newPortfolio("junk");
    expect((await post(`/${id}/transactions`, tx("BUY", 1, "lol"))).status).toBe(400);
    expect((await post(`/${id}/transactions`, tx("BUY", 1, "2026-01-01T00:00:00Z", "<script>"))).status).toBe(400);
  });

  it("rejects non-integer ids and 404s unknown portfolios", async () => {
    expect((await fetch(`${base}/abc/positions`)).status).toBe(400);
    expect((await fetch(`${base}/999999/positions`)).status).toBe(404);
    expect((await post("/999999/transactions", tx("BUY", 1, "2026-01-01T00:00:00Z"))).status).toBe(404);
  });
});

describe("position accounting", () => {
  it("closes a position fully sold in float-awkward lots (0.1 + 0.2 - 0.3)", async () => {
    const id = await newPortfolio("float");
    for (const [side, q, d] of [["BUY", 0.1, "01"], ["BUY", 0.2, "02"], ["SELL", 0.3, "03"]] as const) {
      expect((await post(`/${id}/transactions`, tx(side, q, `2026-01-${d}T00:00:00Z`))).status).toBe(201);
    }
    const [pos] = await (await fetch(`${base}/${id}/positions`)).json();
    expect(pos.quantity).toBe(0);
    expect(pos.realizedPnl).toBeCloseTo(0);
  });

  it("refuses to sell more than is held, including a sell back-dated before the buy", async () => {
    const id = await newPortfolio("oversell");
    expect((await post(`/${id}/transactions`, tx("SELL", 5, "2026-01-01T00:00:00Z"))).status).toBe(409);
    expect((await post(`/${id}/transactions`, tx("BUY", 5, "2026-02-01T00:00:00Z"))).status).toBe(201);
    expect((await post(`/${id}/transactions`, tx("SELL", 5, "2026-01-15T00:00:00Z"))).status).toBe(409);
    expect((await post(`/${id}/transactions`, tx("SELL", 5, "2026-03-01T00:00:00Z"))).status).toBe(201);
  });

  it("won't delete a buy that a later sell depends on", async () => {
    const id = await newPortfolio("dependent");
    const buy = await (await post(`/${id}/transactions`, tx("BUY", 2, "2026-01-01T00:00:00Z"))).json();
    await post(`/${id}/transactions`, tx("SELL", 2, "2026-01-02T00:00:00Z"));
    expect((await fetch(`${base}/${id}/transactions/${buy.id}`, { method: "DELETE" })).status).toBe(409);
  });
});

describe("portfolio deletion", () => {
  it("never deletes the last remaining portfolio", async () => {
    const all: Array<{ id: number }> = await (await fetch(base)).json();
    for (const p of all.slice(1)) {
      expect((await fetch(`${base}/${p.id}`, { method: "DELETE" })).status).toBe(204);
    }
    expect((await fetch(`${base}/${all[0].id}`, { method: "DELETE" })).status).toBe(409);
  });
});

describe("CSV import / export", () => {
  const csvPost = (id: number, body: string) =>
    fetch(`${base}/${id}/import`, { method: "POST", headers: { "content-type": "text/csv" }, body });
  const HEADER = "symbol,side,quantity,price,executed_at\n";

  it("imports rows (any column order, lowercase side) and exports them back", async () => {
    const id = await newPortfolio("csv-roundtrip");
    const res = await csvPost(id,
      "price,executed_at,symbol,side,quantity\n" +
      "100,2026-01-01T00:00:00Z,msft,buy,2\n" +
      "110,2026-01-05T00:00:00Z,MSFT,sell,1\n");
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ imported: 2 });

    const out = await fetch(`${base}/${id}/export.csv`);
    expect(out.headers.get("content-type")).toContain("text/csv");
    expect(out.headers.get("content-disposition")).toContain(`portfolio-${id}.csv`);
    expect((await out.text()).split("\r\n").filter(Boolean)).toEqual([
      "symbol,side,quantity,price,executed_at",
      "MSFT,BUY,2,100,2026-01-01T00:00:00.000Z",
      "MSFT,SELL,1,110,2026-01-05T00:00:00.000Z",
    ]);
    const [pos] = await (await fetch(`${base}/${id}/positions`)).json();
    expect(pos).toMatchObject({ symbol: "MSFT", quantity: 1, realizedPnl: 10 });
  });

  it("is all-or-nothing: one bad row imports nothing and reports its line", async () => {
    const id = await newPortfolio("csv-bad-row");
    const res = await csvPost(id, HEADER + "AAPL,BUY,1,10,2026-01-01T00:00:00Z\nAAPL,BUY,1e400,10,2026-01-02T00:00:00Z\n");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors[0].line).toBe(3);
    expect(await (await fetch(`${base}/${id}/transactions`)).json()).toEqual([]);
  });

  it("rolls back an import whose history would oversell", async () => {
    const id = await newPortfolio("csv-oversell");
    const res = await csvPost(id, HEADER + "TSLA,BUY,1,10,2026-01-02T00:00:00Z\nTSLA,SELL,2,10,2026-01-03T00:00:00Z\n");
    expect(res.status).toBe(409);
    expect(await (await fetch(`${base}/${id}/transactions`)).json()).toEqual([]);
  });

  it.each([
    ["missing column", "symbol,side,quantity,price\nAAPL,BUY,1,1\n"],
    ["header only", HEADER],
    ["unterminated quote", HEADER + '"AAPL,BUY,1,1,2026-01-01T00:00:00Z\n'],
    ["formula in symbol", HEADER + "=cmd|calc,BUY,1,1,2026-01-01T00:00:00Z\n"],
  ])("rejects %s with 400", async (_n, body) => {
    const id = await newPortfolio(`csv-${_n}`);
    expect((await csvPost(id, body)).status).toBe(400);
  });

  it("rejects an empty or JSON body", async () => {
    const id = await newPortfolio("csv-wrong-type");
    expect((await post(`/${id}/import`, { csv: "x" })).status).toBe(400);
  });
});

