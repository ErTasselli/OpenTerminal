import { describe, expect, it } from "vitest";
import { toApiMessages, type OutgoingMessage } from "./chatMessageParts";

describe("toApiMessages", () => {
  it("passes plain text-only history through as plain-string content, unchanged", () => {
    const history: OutgoingMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    expect(toApiMessages(history)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("includes the current (last) message's image as a parts array", () => {
    const history: OutgoingMessage[] = [
      { role: "user", content: "what is this?", image: { mimeType: "image/png", data: "aGVsbG8=" } },
    ];
    expect(toApiMessages(history)).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
        ],
      },
    ]);
  });

  it("omits the text part when an image-only message has no text", () => {
    const history: OutgoingMessage[] = [{ role: "user", content: "", image: { mimeType: "image/png", data: "aGVsbG8=" } }];
    expect(toApiMessages(history)).toEqual([
      { role: "user", content: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }] },
    ]);
  });

  it("drops an older turn's image, keeping only its text, so it is never resent", () => {
    const history: OutgoingMessage[] = [
      { role: "user", content: "what is this chart?", image: { mimeType: "image/png", data: "aGVsbG8=" } },
      { role: "assistant", content: "that's a candlestick chart of AAPL." },
      { role: "user", content: "what's the current price shown?" },
    ];

    const apiMessages = toApiMessages(history);

    expect(apiMessages[0]).toEqual({ role: "user", content: "what is this chart?" });
    expect(apiMessages[1]).toEqual({ role: "assistant", content: "that's a candlestick chart of AAPL." });
    expect(apiMessages[2]).toEqual({ role: "user", content: "what's the current price shown?" });
    expect(JSON.stringify(apiMessages)).not.toContain("aGVsbG8=");
  });

  it("never lets more than one image reach a single request body, however many were pasted over the conversation", () => {
    const history: OutgoingMessage[] = [
      { role: "user", content: "first chart", image: { mimeType: "image/png", data: "aGVsbG8=" } },
      { role: "assistant", content: "ok" },
      { role: "user", content: "second chart", image: { mimeType: "image/png", data: "d29ybGQ=" } },
    ];

    const apiMessages = toApiMessages(history);
    const imageParts = apiMessages.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((p) => p.type === "image") : []));
    expect(imageParts).toHaveLength(1);
    expect((imageParts[0] as { data: string }).data).toBe("d29ybGQ=");
  });
});
