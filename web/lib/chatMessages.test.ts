import { describe, expect, it } from "vitest";
import { appendMessage, type ChatTranscriptMessage } from "./chatMessages";

const userMsg: ChatTranscriptMessage = { role: "user", content: "hello" };
const assistantMsg: ChatTranscriptMessage = { role: "assistant", content: "hi there" };

describe("appendMessage", () => {
  it("appends the message to an empty transcript", () => {
    expect(appendMessage([], userMsg)).toEqual([userMsg]);
  });

  it("appends exactly once, preserving existing order", () => {
    const result = appendMessage([userMsg], assistantMsg);
    expect(result).toEqual([userMsg, assistantMsg]);
    expect(result).toHaveLength(2);
  });

  it("does not mutate the input array", () => {
    const original = [userMsg];
    const result = appendMessage(original, assistantMsg);
    expect(original).toEqual([userMsg]);
    expect(result).not.toBe(original);
  });

  // Regression for #69: a user message and the assistant's reply to it must each be
  // addable exactly once via independent appendMessage calls -- simulating send()'s
  // optimistic append followed by onSuccess's functional-update append -- with no
  // duplication and no drop, regardless of how many times either step runs.
  it("simulates send() + onSuccess without duplicating or dropping messages", () => {
    let transcript: ChatTranscriptMessage[] = [];

    // send(): optimistic user-message append.
    transcript = appendMessage(transcript, userMsg);
    expect(transcript).toEqual([userMsg]);

    // onSuccess: functional-update append of the assistant's reply -- NOT a full-list
    // replace, and not a second append of the user message.
    transcript = appendMessage(transcript, assistantMsg);
    expect(transcript).toEqual([userMsg, assistantMsg]);
  });

  it("keeps rapid/repeated sends in order with no duplicates and no drops", () => {
    let transcript: ChatTranscriptMessage[] = [];
    const turns: ChatTranscriptMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "first reply" },
      { role: "user", content: "second" },
      { role: "assistant", content: "second reply" },
      { role: "user", content: "third" },
      { role: "assistant", content: "third reply" },
    ];

    for (const turn of turns) {
      transcript = appendMessage(transcript, turn);
    }

    expect(transcript).toEqual(turns);
    expect(transcript).toHaveLength(turns.length);
  });

  it("preserves an attached image and tool-call trace on the appended message", () => {
    const withExtras: ChatTranscriptMessage = {
      role: "assistant",
      content: "here's what I found",
      toolCalls: [{ name: "get_quote", arguments: { symbol: "AAPL" } }],
    };
    expect(appendMessage([userMsg], withExtras)).toEqual([userMsg, withExtras]);
  });
});
