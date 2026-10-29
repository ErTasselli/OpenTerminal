import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

// db.ts reads DATA_DIR at import time and opens a real sqlite file there, so
// point it at a throwaway directory instead of the app's real data/ folder,
// before dynamically importing db.js (and memory.js, which imports it).
let tmpDir: string;
let db: (typeof import("../db.js"))["db"];
let memoryRouter: (typeof import("./memory.js"))["memoryRouter"];

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "openterminal-memory-test-"));
  process.env.DATA_DIR = tmpDir;
  ({ db } = await import("../db.js"));
  ({ memoryRouter } = await import("./memory.js"));
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

function getHandler(path: string, method: "get" | "delete" = "get") {
  const layer = (memoryRouter as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method]
  );
  if (!layer) throw new Error(`no route registered for ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle as (req: Request, res: Response, next: () => void) => unknown;
}

describe("GET /", () => {
  it("lists Memory Entries newest first", async () => {
    db.prepare("INSERT INTO memory_entries (content, symbol, category) VALUES (?, ?, ?)").run(
      "older note",
      null,
      null
    );
    db.prepare("INSERT INTO memory_entries (content, symbol, category) VALUES (?, ?, ?)").run(
      "newer note",
      "AAPL",
      "preference"
    );

    const handler = getHandler("/", "get");
    const res = fakeRes();
    await handler({} as unknown as Request, res, () => {});

    const body = (res.json as any).mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThanOrEqual(2);
    expect(body[0].content).toBe("newer note");
    expect(body[0].symbol).toBe("AAPL");
    expect(body[0].category).toBe("preference");
  });
});

describe("DELETE /:id", () => {
  it("deletes a Memory Entry and returns 204", async () => {
    const info = db.prepare("INSERT INTO memory_entries (content) VALUES (?)").run("to delete");

    const handler = getHandler("/:id", "delete");
    const res = fakeRes();
    await handler({ params: { id: String(info.lastInsertRowid) } } as unknown as Request, res, () => {});

    expect(res.status).toHaveBeenCalledWith(204);
    const row = db.prepare("SELECT * FROM memory_entries WHERE id = ?").get(info.lastInsertRowid);
    expect(row).toBeUndefined();
  });

  it("no-ops (still 204) for an id that doesn't exist", async () => {
    const handler = getHandler("/:id", "delete");
    const res = fakeRes();
    await handler({ params: { id: "999999" } } as unknown as Request, res, () => {});
    expect(res.status).toHaveBeenCalledWith(204);
  });
});

describe("memory_entries CHECK constraint on category", () => {
  it("accepts each valid category", () => {
    for (const category of ["preference", "watchlist", "research-note"]) {
      expect(() =>
        db
          .prepare("INSERT INTO memory_entries (content, category) VALUES (?, ?)")
          .run(`note for ${category}`, category)
      ).not.toThrow();
    }
  });

  it("accepts a null category and null symbol", () => {
    expect(() => db.prepare("INSERT INTO memory_entries (content) VALUES (?)").run("uncategorized")).not.toThrow();
  });

  it("rejects an out-of-enum category", () => {
    expect(() =>
      db.prepare("INSERT INTO memory_entries (content, category) VALUES (?, ?)").run("bad note", "not-a-category")
    ).toThrow();
  });
});
