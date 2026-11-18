// The single place that turns a message list carrying raw image bytes into one safe to
// write to the Audit Log (#30): every `image` part gets persisted to disk (imageStore.ts
// -- content-addressed, so re-persisting the same bytes across e.g. the chat-turn Audit
// Log write and a capped-history rehydration is a no-op) and replaced with an
// `image-ref`, which carries only the resulting id + mimeType. Raw base64 `data` must
// never reach writeAuditLog's `detail` blob -- this is the one function routes/ai.ts
// calls to guarantee that, mirroring #29's own "images never land in the Audit Log"
// contract but satisfying it by reference instead of by blanket redaction.
import { saveImage } from "../imageStore.js";
import type { ChatMessage, ChatMessagePart } from "./types.js";

function toAuditPart(part: ChatMessagePart): ChatMessagePart {
  if (part.type !== "image") return part; // already a "text" or "image-ref" part -- nothing to persist
  const { id, mimeType } = saveImage(part.data, part.mimeType);
  return { type: "image-ref", id, mimeType };
}

export function toAuditMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    return { ...m, content: m.content.map(toAuditPart) };
  });
}
