import type { ImageAttachment } from "./chatMessageParts";

export type ToolCallTrace = { name: string; arguments: Record<string, unknown> };

// AiWidget's local chat transcript entry -- the UI's full in-memory shape, including the
// optional per-turn image thumbnail and the assistant's tool-call trace. Kept here (rather
// than only in AiWidget.tsx) so appendMessage below can be the single source of truth for
// "add a message to the transcript" and be unit tested on its own, per #69.
export type ChatTranscriptMessage = {
  role: "user" | "assistant";
  content: string;
  image?: ImageAttachment;
  toolCalls?: ToolCallTrace[];
};

/**
 * Appends one message to a chat transcript, returning a new array and never mutating
 * `messages`. This is the ONLY place a message is added to the transcript -- both the
 * optimistic user-message append in AiWidget's send() and the assistant-reply append in
 * its chat mutation's onSuccess call this (via a functional setMessages((m) =>
 * appendMessage(m, ...)) update), instead of each independently reconstructing its own
 * copy of "the next message list".
 *
 * Before #69, the chat mutation's mutationFn separately rebuilt `next = [...messages,
 * userMsg]` from its own closure over `messages` captured at mutate-call time, and
 * onSuccess then did a full `setMessages([...next, assistantMsg])` replace. That gave the
 * transcript two independent owners of "append the user's message" (send()'s optimistic
 * update and mutationFn's `next`), so depending on render/batching timing, mutationFn's
 * `next` could already include send()'s optimistic append and add a second, duplicate
 * copy of the same user message -- which the onSuccess replace then committed to state.
 * Routing every append through this one function, always via a functional state update
 * (which reads the actual current state rather than a stale closure), removes the second
 * owner entirely.
 */
export function appendMessage(messages: ChatTranscriptMessage[], message: ChatTranscriptMessage): ChatTranscriptMessage[] {
  return [...messages, message];
}
