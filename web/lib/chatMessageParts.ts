// Mirrors server/src/llm/types.ts's ChatMessagePart (#29) -- duplicated rather than shared
// across the server/web workspace split, same as other server-shape types in this
// workspace (Quote, ToolCallTrace, etc).
export type ChatMessagePart = { type: "text"; text: string } | { type: "image"; mimeType: string; data: string };

// An image attached to one chat turn -- `data` is the base64 payload only (no `data:`
// URI prefix), the shape the API request (and ChatMessagePart's "image" variant) expects.
export type ImageAttachment = { mimeType: string; data: string };

// The AI Assistant's local chat history, in whatever shape the UI tracks it (plain string
// content plus an optional image for display). `role`/`content` match the API's
// ChatMessage; `image`, if present, is only ever on a user turn.
export type OutgoingMessage = { role: "user" | "assistant"; content: string; image?: ImageAttachment };

// The shape POST /api/ai/chat expects for one message (server ChatMessage).
export type ApiChatMessage = { role: "user" | "assistant"; content: string | ChatMessagePart[] };

/**
 * Builds the POST /api/ai/chat payload's `messages` array from the UI's local history.
 *
 * Only the newest message (the turn currently being sent) ever carries its image part --
 * an older turn's image is dropped here even though the UI still shows its thumbnail (see
 * AiWidget.tsx). Without this, every image ever pasted into a conversation would get
 * resent in full on every later turn (chat.mutate always POSTs the whole history), which
 * both wastes bandwidth/provider image-tokens and can eventually exceed the server's
 * /api/ai body-size cap (server/src/index.ts, sized for roughly one image) on some
 * unrelated later turn -- turning a stale earlier attachment into a recurring, confusing
 * failure for the rest of the conversation. This matches the feature's own "images travel
 * in the request only" design: an image is live for the one turn it's attached to, and is
 * never resent after.
 */
export function toApiMessages(history: OutgoingMessage[]): ApiChatMessage[] {
  const lastIndex = history.length - 1;
  return history.map((m, i) => toApiMessage(m, i === lastIndex));
}

function toApiMessage(m: OutgoingMessage, includeImage: boolean): ApiChatMessage {
  if (!m.image || !includeImage) return { role: m.role, content: m.content };
  const parts: ChatMessagePart[] = [];
  if (m.content) parts.push({ type: "text", text: m.content });
  parts.push({ type: "image", mimeType: m.image.mimeType, data: m.image.data });
  return { role: m.role, content: parts };
}
