import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo, Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const KEY = "k".repeat(40);
let dir: string;
let server: Server;
let base: string;
let closeDb: () => void;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ot-app-test-"));
  Object.assign(process.env, { DATA_DIR: dir, API_KEY: KEY, MARKET_RATE_LIMIT_PER_MIN: "4" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { createApp } = await import("./app.js");
  closeDb = () => void import("./db.js").then((m) => m.db.close());
  server = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  server.close();
  closeDb();
  for (const k of ["DATA_DIR", "API_KEY", "MARKET_RATE_LIMIT_PER_MIN"]) delete process.env[k];
  await new Promise((r) => setTimeout(r, 50));
  rmSync(dir, { recursive: true, force: true });
});

const auth = { "x-api-key": KEY };

describe("market input validation", () => {
  it("rejects non-ticker path symbols before any provider call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await fetch(`${base}/history/${encodeURIComponent("<script>")}`);
    expect(res.status).toBe(400);
    expect(fetchSpy.mock.calls.every(([u]) => String(u).startsWith("http://127.0.0.1"))).toBe(true);
    fetchSpy.mockRestore();
  });
});

describe("app wiring", () => {
  it("portfolio and status traffic no longer drains the market rate-limit budget", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await fetch(`${base}/portfolios`, { headers: auth })).status).toBe(200);
      expect((await fetch(`${base}/status`)).status).toBe(200);
    }
    // Market budget is 4/min here and the symbol test above used 1. These
    // fail validation before any provider fetch (offline); the 4th must be 429.
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await fetch(`${base}/screener?sort=__proto__`)).status);
    expect(codes).toEqual([400, 400, 400, 429]);
  });

  it("requires the API key on portfolio routes", async () => {
    expect((await fetch(`${base}/portfolios`)).status).toBe(401);
  });

  it("rejects oversized and malformed bodies with JSON, no stack trace", async () => {
    const big = await fetch(`${base}/portfolios`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(70_000) }),
    });
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: "request body too large" });

    const bad = await fetch(`${base}/portfolios`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body: "{not json",
    });
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toMatch(/at .*\.js|SyntaxError/);
  });

  it("does not advertise Express", async () => {
    expect((await fetch(`${base}/status`)).headers.get("x-powered-by")).toBeNull();
  });
});
