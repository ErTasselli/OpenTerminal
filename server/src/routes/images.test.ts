import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Request, Response } from "express";

// db.ts (transitively, via imageStore.ts) reads DATA_DIR at import time -- point it at a
// throwaway directory before dynamically importing imagesRouter/imageStore, same
// pattern as other routes/*.test.ts files in this repo.
let tmpDir: string;
let imagesRouter: (typeof import("./images.js"))["imagesRouter"];
let saveImage: (typeof import("../imageStore.js"))["saveImage"];

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "opterm-images-route-test-"));
  process.env.DATA_DIR = tmpDir;
  ({ imagesRouter } = await import("./images.js"));
  ({ saveImage } = await import("../imageStore.js"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

function fakeRes() {
  const res = {
    statusCode: 200,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      (res as any).jsonBody = body;
      return res;
    },
    type(mime: string) {
      (res as any).contentType = mime;
      return res;
    },
    send(body: unknown) {
      (res as any).sentBody = body;
      return res;
    },
    setHeader() {
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; jsonBody?: unknown; contentType?: string; sentBody?: unknown };
}

function getHandler(path: string) {
  const layer = (imagesRouter as any).stack.find((l: any) => l.route?.path === path);
  if (!layer) throw new Error(`no route registered for ${path}`);
  return layer.route.stack[0].handle as (req: Request, res: Response, next: () => void) => unknown;
}

describe("GET /:id (images router)", () => {
  it("returns the stored image's bytes with the right content-type", async () => {
    const bytes = Buffer.from("a stored screenshot");
    const stored = saveImage(bytes.toString("base64"), "image/png");
    const handler = getHandler("/:id");
    const req = { params: { id: stored.id } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.contentType).toBe("image/png");
    expect(res.sentBody).toEqual(bytes);
  });

  it("404s for an id that was never saved", async () => {
    const handler = getHandler("/:id");
    const req = { params: { id: `${"a".repeat(64)}.png` } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.statusCode).toBe(404);
  });

  it("404s (never touching the filesystem outside imagesDir) for a path-traversal id", async () => {
    const handler = getHandler("/:id");
    const req = { params: { id: "../../../../etc/passwd" } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.statusCode).toBe(404);
    expect(res.sentBody).toBeUndefined();
  });

  it("404s for a malformed id, rather than throwing", async () => {
    const handler = getHandler("/:id");
    const req = { params: { id: "not-a-valid-id" } } as unknown as Request;
    const res = fakeRes();

    expect(() => handler(req, res, () => {})).not.toThrow();
    expect(res.statusCode).toBe(404);
  });
});
