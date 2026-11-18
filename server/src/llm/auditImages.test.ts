import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChatMessage } from "./types.js";

// imageStore.ts (transitively, via db.ts) reads DATA_DIR at import time -- point it at a
// throwaway directory before dynamically importing auditImages.js, same pattern as
// imageStore.test.ts.
let tmpDir: string;
let toAuditMessages: (typeof import("./auditImages.js"))["toAuditMessages"];
let readImage: (typeof import("../imageStore.js"))["readImage"];

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "opterm-audit-images-test-"));
  process.env.DATA_DIR = tmpDir;
  ({ toAuditMessages } = await import("./auditImages.js"));
  ({ readImage } = await import("../imageStore.js"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

const IMAGE_B64 = Buffer.from("totally a screenshot").toString("base64");

describe("toAuditMessages", () => {
  it("leaves plain string messages untouched", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "hi" }];
    expect(toAuditMessages(messages)).toEqual(messages);
  });

  it("leaves text-only array content untouched", () => {
    const messages: ChatMessage[] = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
    expect(toAuditMessages(messages)).toEqual(messages);
  });

  it("replaces a raw image part with an image-ref, never carrying the raw bytes", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image", mimeType: "image/png", data: IMAGE_B64 },
        ],
      },
    ];

    const audited = toAuditMessages(messages);

    expect(audited[0].content).toEqual([
      { type: "text", text: "what is this?" },
      { type: "image-ref", id: expect.stringMatching(/^[a-f0-9]{64}\.png$/), mimeType: "image/png" },
    ]);
    expect(JSON.stringify(audited)).not.toContain(IMAGE_B64);
  });

  it("actually persists the image to disk, readable back by the id it returns", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "image", mimeType: "image/png", data: IMAGE_B64 }] },
    ];

    const audited = toAuditMessages(messages);
    const ref = (audited[0].content as any[])[0];
    const read = readImage(ref.id);

    expect(read).not.toBeNull();
    expect(read?.bytes).toEqual(Buffer.from(IMAGE_B64, "base64"));
  });

  it("passes an already-persisted image-ref part through unchanged", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [{ type: "image-ref", id: `${"a".repeat(64)}.png`, mimeType: "image/png" }],
      },
    ];

    expect(toAuditMessages(messages)).toEqual(messages);
  });
});
