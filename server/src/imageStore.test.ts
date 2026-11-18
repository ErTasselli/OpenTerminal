import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// db.ts (imported transitively by imageStore.ts for dataDir) reads DATA_DIR at import
// time, so point it at a throwaway directory before dynamically importing imageStore.js
// -- same pattern as db.test.ts / audit.test.ts.
let tmpDir: string;
let saveImage: (typeof import("./imageStore.js"))["saveImage"];
let readImage: (typeof import("./imageStore.js"))["readImage"];
let isValidImageId: (typeof import("./imageStore.js"))["isValidImageId"];
let imagesDir: (typeof import("./imageStore.js"))["imagesDir"];

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "opterm-image-store-test-"));
  process.env.DATA_DIR = tmpDir;
  ({ saveImage, readImage, isValidImageId, imagesDir } = await import("./imageStore.js"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

const PNG_BYTES_B64 = Buffer.from("not a real png but good enough for a byte round-trip").toString("base64");

describe("saveImage", () => {
  it("writes the image to disk under DATA_DIR/images, once", () => {
    const stored = saveImage(PNG_BYTES_B64, "image/png");

    expect(stored.mimeType).toBe("image/png");
    expect(existsSync(join(imagesDir, stored.id))).toBe(true);
    expect(readFileSync(join(imagesDir, stored.id))).toEqual(Buffer.from(PNG_BYTES_B64, "base64"));
  });

  it("is content-addressed: saving the same bytes twice reuses the same id and does not duplicate the file", () => {
    const first = saveImage(PNG_BYTES_B64, "image/png");
    const second = saveImage(PNG_BYTES_B64, "image/png");

    expect(second.id).toBe(first.id);
  });

  it("gives different bytes different ids", () => {
    const a = saveImage(PNG_BYTES_B64, "image/png");
    const b = saveImage(Buffer.from("different bytes entirely").toString("base64"), "image/png");

    expect(a.id).not.toBe(b.id);
  });

  it("encodes the mimeType into the id's extension so distinct mime types never collide on disk", () => {
    const asPng = saveImage(PNG_BYTES_B64, "image/png");
    const asJpeg = saveImage(PNG_BYTES_B64, "image/jpeg");

    expect(asPng.id).not.toBe(asJpeg.id);
    expect(asPng.id.endsWith(".png")).toBe(true);
    expect(asJpeg.id.endsWith(".jpg")).toBe(true);
  });

  it("throws for a mime type outside the supported set, rather than writing a file", () => {
    expect(() => saveImage(PNG_BYTES_B64, "image/bmp")).toThrow(/image\/bmp/);
  });
});

describe("readImage", () => {
  it("round-trips a saved image's bytes and mimeType", () => {
    const stored = saveImage(PNG_BYTES_B64, "image/webp");

    const read = readImage(stored.id);

    expect(read).not.toBeNull();
    expect(read?.mimeType).toBe("image/webp");
    expect(read?.bytes).toEqual(Buffer.from(PNG_BYTES_B64, "base64"));
  });

  it("returns null for an id that looks valid but was never saved", () => {
    expect(readImage(`${"a".repeat(64)}.png`)).toBeNull();
  });

  it("returns null for a malformed id, rather than throwing", () => {
    expect(() => readImage("not-a-valid-id")).not.toThrow();
    expect(readImage("not-a-valid-id")).toBeNull();
  });

  it("returns null for a path-traversal attempt instead of ever touching the filesystem outside imagesDir", () => {
    expect(readImage("../../etc/passwd")).toBeNull();
    expect(readImage("..%2f..%2fetc%2fpasswd.png")).toBeNull();
    expect(readImage(`${"a".repeat(64)}/../../../etc/passwd.png`)).toBeNull();
  });
});

describe("isValidImageId", () => {
  it("accepts a well-formed sha256-hex + known-extension id", () => {
    expect(isValidImageId(`${"a".repeat(64)}.png`)).toBe(true);
    expect(isValidImageId(`${"b".repeat(64)}.jpg`)).toBe(true);
  });

  it("rejects anything with a path separator", () => {
    expect(isValidImageId("../../etc/passwd")).toBe(false);
    expect(isValidImageId(`${"a".repeat(64)}.png/../../etc/passwd`)).toBe(false);
  });

  it("rejects an unknown extension", () => {
    expect(isValidImageId(`${"a".repeat(64)}.bmp`)).toBe(false);
  });

  it("rejects a hash of the wrong length", () => {
    expect(isValidImageId(`${"a".repeat(10)}.png`)).toBe(false);
  });
});
