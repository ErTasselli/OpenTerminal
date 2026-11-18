import { readImage, saveImage } from "../imageStore.js";
import type { ChatMessage, ChatMessagePart } from "./types.js";

// Bounds how many of a conversation's *most recent* messages are allowed to carry a
// live image to the LLM Provider on any one request (#30) -- i.e. a trailing window
// over message position, not a count of images. This distinction matters: a
// conversation can carry exactly one image for its entire length (attached on turn 3,
// never attached again), and that image must still stop being live once enough turns
// have passed, not stay "live" forever just because it's the only/most-recent image
// that exists. Mirrors the repo's other resend caps -- FALLBACK_PER_SYMBOL_CAP
// (routes/market.ts), MAX_RECENT_TRANSACTIONS (web/components/widgets/AiWidget.tsx) --
// in spirit: bound a per-request cost that would otherwise grow with conversation
// length.
//
// Why 1, not something larger now that images are persisted by id: neither LLM Provider
// has any memory of an image across separate requests -- each chat turn is a fresh,
// stateless call, so re-sending turn 3's image on turn 48 only helps if the model is
// being asked about that specific image *again*, which the UI has no way to signal
// (the web client already only ever attaches an image to the one turn the user just
// sent -- see toApiMessages' own doc comment in web/lib/chatMessageParts.ts). A window
// larger than 1 would just mean paying to re-decode+re-upload stale images on every
// later turn for no answering benefit. This constant is enforced here, server-side,
// as the authoritative cap -- not merely relying on the web client's own (separate,
// UI-level) choice to drop older attachments -- so the guarantee holds regardless of
// what a caller sends.
export const MAX_LIVE_IMAGE_TURNS = 1;

/** A turn whose image is outside the live window still names its stored id in plain
 * text, so the model (and a human reading the transcript) knows an image was there
 * without ever re-decoding/re-sending its bytes. */
function placeholderFor(id: string): ChatMessagePart {
  return {
    type: "text",
    text: `[Image attached earlier in this conversation (stored as ${id}) -- not resent; ask the user to re-attach it if you need to see it again.]`,
  };
}

function rehydrate(part: ChatMessagePart): ChatMessagePart {
  if (part.type !== "image-ref") return part;
  const stored = readImage(part.id);
  // A ref that no longer resolves on disk (manually deleted DATA_DIR/images, or a
  // corrupt/forged id) degrades to the same placeholder an out-of-window turn gets,
  // rather than silently dropping the part or throwing mid-request.
  if (!stored) return placeholderFor(part.id);
  return { type: "image", mimeType: stored.mimeType, data: stored.bytes.toString("base64") };
}

// A part outside the live window loses its bytes either way -- but a not-yet-persisted
// `image` part (this function is deliberately safe to call before or after
// auditImages.ts's toAuditMessages -- see its own doc comment) must still be written to
// disk *once* before being reduced to a placeholder, or the id this names would dangle.
// saveImage is content-addressed/idempotent, so this is a no-op if toAuditMessages (or
// an earlier round) already saved the same bytes.
function demote(part: ChatMessagePart): ChatMessagePart {
  if (part.type === "image-ref") return placeholderFor(part.id);
  if (part.type === "image") return placeholderFor(saveImage(part.data, part.mimeType).id);
  return part;
}

/**
 * Builds the message list actually sent to an LLM Provider from a conversation's full
 * history: a message within the trailing `cap`-message window (by position, counted
 * from the end -- see MAX_LIVE_IMAGE_TURNS above) keeps a live image part -- an
 * `image-ref` is rehydrated back to raw bytes (read fresh from disk, never re-encoded
 * from anywhere else), and a raw `image` part (the turn just submitted, before it's
 * ever been persisted) passes through unchanged. Every message *outside* that window
 * has its image part(s) reduced to a text placeholder (see demote/placeholderFor) --
 * their bytes are never read back, and a not-yet-persisted `image` part found outside
 * the window is written to disk once (so its placeholder still names a resolvable id)
 * and never re-encoded again after. Every `image`/`image-ref` part that comes out of
 * this function has necessarily been turned into either a live `image` or a `text`
 * placeholder, never left as an `image-ref`, so a provider's own message mapper
 * (anthropic.ts, ollama.ts) never has to handle that variant itself.
 */
export function capLiveImages(messages: ChatMessage[], cap: number = MAX_LIVE_IMAGE_TURNS): ChatMessage[] {
  const liveFromIndex = Math.max(0, messages.length - cap);

  return messages.map((m, i) => {
    if (!Array.isArray(m.content)) return m;
    const live = i >= liveFromIndex;
    return {
      ...m,
      content: m.content.map((p) => {
        if (p.type !== "image" && p.type !== "image-ref") return p;
        return live ? rehydrate(p) : demote(p);
      }),
    };
  });
}
