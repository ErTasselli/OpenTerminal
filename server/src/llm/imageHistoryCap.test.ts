import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChatMessage } from "./types.js";

// imageStore.ts (transitively, via db.ts) reads DATA_DIR at import time -- point it at a
// throwaway directory before dynamically importing, same pattern as imageStore.test.ts.
let tmpDir: string;
let capLiveImages: (typeof import("./imageHistoryCap.js"))["capLiveImages"];
let MAX_LIVE_IMAGE_TURNS: (typeof import("./imageHistoryCap.js"))["MAX_LIVE_IMAGE_TURNS"];
let saveImage: (typeof import("../imageStore.js"))["saveImage"];

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "opterm-image-history-cap-test-"));
  process.env.DATA_DIR = tmpDir;
  ({ capLiveImages, MAX_LIVE_IMAGE_TURNS } = await import("./imageHistoryCap.js"));
  ({ saveImage } = await import("../imageStore.js"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

const OLD_IMAGE_B64 = Buffer.from("an old chart from turn 3").toString("base64");
const NEW_IMAGE_B64 = Buffer.from("a fresh chart from the latest turn").toString("base64");

describe("capLiveImages", () => {
  it("leaves a conversation with no images untouched", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    expect(capLiveImages(messages)).toEqual(messages);
  });

  it("rehydrates an image-ref within the live window back to a raw image part", () => {
    const stored = saveImage(NEW_IMAGE_B64, "image/png");
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "image-ref", id: stored.id, mimeType: "image/png" }] },
    ];

    const capped = capLiveImages(messages);

    expect(capped[0].content).toEqual([{ type: "image", mimeType: "image/png", data: NEW_IMAGE_B64 }]);
  });

  it("passes a raw image part within the live window through unchanged", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "image", mimeType: "image/png", data: NEW_IMAGE_B64 }] },
    ];
    expect(capLiveImages(messages)).toEqual(messages);
  });

  it(`replaces an image-ref outside the live window (default cap ${MAX_LIVE_IMAGE_TURNS}) with a text placeholder naming its id, never rehydrating its bytes`, () => {
    const old = saveImage(OLD_IMAGE_B64, "image/png");
    const fresh = saveImage(NEW_IMAGE_B64, "image/png");
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "image-ref", id: old.id, mimeType: "image/png" }] },
      { role: "assistant", content: "that's a chart" },
      { role: "user", content: [{ type: "image-ref", id: fresh.id, mimeType: "image/png" }] },
    ];

    const capped = capLiveImages(messages, 1);

    const oldPart = (capped[0].content as any[])[0];
    expect(oldPart.type).toBe("text");
    expect(oldPart.text).toContain(old.id);
    expect(JSON.stringify(capped)).not.toContain(OLD_IMAGE_B64);

    const freshPart = (capped[2].content as any[])[0];
    expect(freshPart).toEqual({ type: "image", mimeType: "image/png", data: NEW_IMAGE_B64 });
  });

  it("honors a larger explicit cap, keeping more than one recent turn's image live", () => {
    const a = saveImage(Buffer.from("image a").toString("base64"), "image/png");
    const b = saveImage(Buffer.from("image b").toString("base64"), "image/png");
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "image-ref", id: a.id, mimeType: "image/png" }] },
      { role: "user", content: [{ type: "image-ref", id: b.id, mimeType: "image/png" }] },
    ];

    const capped = capLiveImages(messages, 2);

    expect((capped[0].content as any[])[0].type).toBe("image");
    expect((capped[1].content as any[])[0].type).toBe("image");
  });

  it("persists and demotes a not-yet-persisted raw image part that falls outside the window", () => {
    const fresh = saveImage(NEW_IMAGE_B64, "image/png");
    const messages: ChatMessage[] = [
      // A raw (never-persisted-yet) image part, simulating capLiveImages running before
      // auditImages.ts's toAuditMessages -- its bytes must still never be resent once it
      // falls outside the window, and it must still end up saved to disk so its
      // placeholder's id resolves.
      { role: "user", content: [{ type: "image", mimeType: "image/png", data: OLD_IMAGE_B64 }] },
      { role: "user", content: [{ type: "image-ref", id: fresh.id, mimeType: "image/png" }] },
    ];

    const capped = capLiveImages(messages, 1);

    const demoted = (capped[0].content as any[])[0];
    expect(demoted.type).toBe("text");
    expect(JSON.stringify(capped)).not.toContain(OLD_IMAGE_B64);
    const expectedId = `${createHash("sha256").update(Buffer.from(OLD_IMAGE_B64, "base64")).digest("hex")}.png`;
    expect(demoted.text).toContain(expectedId);
  });

  it("keeps the trailing message's image live even with plain-text turns in between it and an earlier image", () => {
    const only = saveImage(NEW_IMAGE_B64, "image/png");
    const messages: ChatMessage[] = [
      { role: "user", content: "just text, turn 1" },
      { role: "assistant", content: "ok" },
      { role: "user", content: [{ type: "image-ref", id: only.id, mimeType: "image/png" }] },
    ];

    const capped = capLiveImages(messages, 1);

    expect((capped[2].content as any[])[0]).toEqual({ type: "image", mimeType: "image/png", data: NEW_IMAGE_B64 });
  });

  // Regression test: the window must be counted by message *position*, not by how many
  // images exist in the conversation. A conversation that only ever had one image, far
  // back, must still demote it once enough later (image-free) turns have passed --
  // "is this the most recent image" is the wrong question; "is this message still
  // within the trailing cap-message window" is the right one. An earlier implementation
  // got this wrong: with only one image-bearing message in the whole history, it was
  // trivially always "the most recent image-bearing message" and so never demoted.
  it("demotes a lone early image once enough plain-text turns separate it from the end, even though it's the only image in the conversation", () => {
    const old = saveImage(OLD_IMAGE_B64, "image/png");
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "image-ref", id: old.id, mimeType: "image/png" }] }, // turn 3's image
      ...Array.from({ length: 90 }, (_, i): ChatMessage => ({ role: i % 2 === 0 ? "user" : "assistant", content: `turn ${i + 4}` })),
      { role: "user", content: "turn 50-ish, plain text, no image" },
    ];

    const capped = capLiveImages(messages, 1);

    const demoted = (capped[0].content as any[])[0];
    expect(demoted.type).toBe("text");
    expect(demoted.text).toContain(old.id);
    expect(JSON.stringify(capped)).not.toContain(OLD_IMAGE_B64);
  });
});
