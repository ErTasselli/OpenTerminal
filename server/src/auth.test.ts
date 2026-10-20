import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextFunction, Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// auth.ts resolves the key at import time from API_KEY / DATA_DIR, so each
// case gets a fresh module graph and a throwaway data directory.
let dir: string;
const savedKey = process.env.API_KEY;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ot-auth-test-"));
  process.env.DATA_DIR = dir;
  delete process.env.API_KEY;
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  // db.ts opens a sqlite handle in `dir`; close it so the dir can be removed on Windows too.
  try {
    (await import("./db.js")).db.close();
  } catch {
    /* module may not have loaded */
  }
  rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  if (savedKey === undefined) delete process.env.API_KEY;
  else process.env.API_KEY = savedKey;
  vi.restoreAllMocks();
});

function call(mw: (req: Request, res: Response, next: NextFunction) => void, header?: string) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  const next = vi.fn();
  mw({ header: () => header } as unknown as Request, res, next);
  return { res, next };
}

describe("auth key resolution", () => {
  it("refuses to start when the key file exists but is empty (was fail-open)", async () => {
    writeFileSync(join(dir, ".api-key"), "");
    await expect(import("./auth.js")).rejects.toThrow(/at least 32/);
  });

  it("refuses a short API_KEY from the environment", async () => {
    process.env.API_KEY = "short-secret";
    await expect(import("./auth.js")).rejects.toThrow(/at least 32/);
  });

  it("generates a strong key on first run and reuses it afterwards", async () => {
    const first = (await import("./auth.js")).apiKey;
    expect(first).toMatch(/^[0-9a-f]{48}$/);
    expect(readFileSync(join(dir, ".api-key"), "utf8")).toBe(first);
    (await import("./db.js")).db.close();
    vi.resetModules();
    expect((await import("./auth.js")).apiKey).toBe(first);
  });
});

describe("requireApiKey", () => {
  it("rejects a missing or wrong header and accepts the right key", async () => {
    process.env.API_KEY = "k".repeat(40);
    const { requireApiKey } = await import("./auth.js");

    const missing = call(requireApiKey);
    expect(missing.res.status).toHaveBeenCalledWith(401);
    expect(missing.next).not.toHaveBeenCalled();

    const wrong = call(requireApiKey, "x".repeat(40));
    expect(wrong.res.status).toHaveBeenCalledWith(401);

    const ok = call(requireApiKey, "k".repeat(40));
    expect(ok.next).toHaveBeenCalledOnce();
  });
});
