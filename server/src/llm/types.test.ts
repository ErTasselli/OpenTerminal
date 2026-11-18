import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_BYTES,
  messageHasImage,
  redactImagesForAudit,
  textOf,
  validateChatMessages,
  type ChatMessage,
} from "./types.js";

describe("messageHasImage", () => {
  it("is false for a plain string content message", () => {
    expect(messageHasImage({ role: "user", content: "hi" })).toBe(false);
  });

  it("is true when any part of an array content is an image", () => {
    const message: ChatMessage = {
      role: "user",
      content: [
        { type: "text", text: "what is this?" },
        { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
      ],
    };
    expect(messageHasImage(message)).toBe(true);
  });

  it("is false for array content with only text parts", () => {
    const message: ChatMessage = { role: "user", content: [{ type: "text", text: "hi" }] };
    expect(messageHasImage(message)).toBe(false);
  });
});

describe("textOf", () => {
  it("returns a plain string unchanged", () => {
    expect(textOf("hello")).toBe("hello");
  });

  it("joins text parts and renders an image part as a placeholder, never its data", () => {
    const text = textOf([
      { type: "text", text: "look at this" },
      { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
    ]);
    expect(text).toBe("look at this\n[image]");
    expect(text).not.toContain("aGVsbG8=");
  });
});

describe("redactImagesForAudit", () => {
  it("leaves plain string messages untouched", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "hi" }];
    expect(redactImagesForAudit(messages)).toEqual(messages);
  });

  it("strips image bytes from array content while keeping the mimeType and any text parts", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
        ],
      },
    ];

    const redacted = redactImagesForAudit(messages);

    expect(redacted[0].content).toEqual([
      { type: "text", text: "what is this?" },
      { type: "image", mimeType: "image/png", data: expect.any(String) },
    ]);
    const imagePart = (redacted[0].content as any[])[1];
    expect(imagePart.data).not.toBe("aGVsbG8=");
    expect(JSON.stringify(redacted)).not.toContain("aGVsbG8=");
  });
});

describe("validateChatMessages", () => {
  it("returns null for a well-formed text-only conversation", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "hi" }];
    expect(validateChatMessages(messages)).toBeNull();
  });

  it("returns null for a well-formed image part", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }] },
    ];
    expect(validateChatMessages(messages)).toBeNull();
  });

  it("rejects an unsupported image mime type with an actionable message", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "image", mimeType: "image/bmp", data: "aGVsbG8=" }] },
    ];
    const err = validateChatMessages(messages);
    expect(err).toMatch(/image\/bmp/);
  });

  it("rejects an image part with a missing/non-string `data` field, rather than throwing", () => {
    const messages = [
      { role: "user", content: [{ type: "image", mimeType: "image/png" }] },
    ] as unknown as ChatMessage[];
    expect(() => validateChatMessages(messages)).not.toThrow();
    expect(validateChatMessages(messages)).toMatch(/data/i);
  });

  it("rejects an image over MAX_IMAGE_BYTES", () => {
    // Base64 is ~4/3 the raw byte size; pad well past the limit.
    const oversized = "A".repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1000);
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "image", mimeType: "image/png", data: oversized }] },
    ];
    const err = validateChatMessages(messages);
    expect(err).toMatch(/too large/i);
  });

  it("rejects a null content-array element, rather than throwing", () => {
    const messages = [{ role: "user", content: [null] }] as unknown as ChatMessage[];
    expect(() => validateChatMessages(messages)).not.toThrow();
    expect(validateChatMessages(messages)).not.toBeNull();
  });

  it("rejects a content-array element with an unrecognized `type`, rather than silently accepting it", () => {
    const messages = [{ role: "user", content: [{ type: "video", data: "x" }] }] as unknown as ChatMessage[];
    const err = validateChatMessages(messages);
    expect(err).toMatch(/video/);
  });

  it("rejects a text part whose `text` isn't a string, rather than silently accepting it", () => {
    const messages = [{ role: "user", content: [{ type: "text", text: 123 }] }] as unknown as ChatMessage[];
    const err = validateChatMessages(messages);
    expect(err).not.toBeNull();
  });
});
