/**
 * One piece of a ChatMessage's content. `text` is ordinary prose; `image` is an
 * inline screenshot pasted/dropped into the AI Assistant's chat input (#29).
 *
 * Request-only for now: `data` never gets written to disk or the Audit Log (see
 * redactImagesForAudit below) and there is no persisted-image-reference variant
 * yet -- that's #30, built on top of this shape, which is why this stays a
 * closed union keyed on `type` rather than, say, a bare string blob: adding a
 * third variant (e.g. `{ type: "image-ref"; id: string }`) later is additive.
 */
export type ChatMessagePart =
  | { type: "text"; text: string }
  | {
      type: "image";
      /** e.g. "image/png" -- forwarded to Anthropic's `media_type`; Ollama's native API ignores it. */
      mimeType: string;
      /** Base64-encoded image bytes, no `data:` URI prefix. */
      data: string;
    };

/**
 * A single turn in a chat conversation, in the shape both LLM Providers accept.
 * `content` is a plain string for ordinary text turns -- the overwhelmingly common
 * case, and the shape every existing call site already uses -- or an array of
 * parts when the turn carries something richer than text (currently: an image).
 */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string | ChatMessagePart[];
}

/** True when this message's content carries at least one image part. */
export function messageHasImage(message: ChatMessage): boolean {
  return Array.isArray(message.content) && message.content.some((p) => p.type === "image");
}

/**
 * Plain-text rendering of a message's content, for places that only care about the
 * words (the chat-turn Audit Log summary line, etc). An image part renders as a
 * short placeholder -- never its data.
 */
export function textOf(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  return content.map((p) => (p.type === "text" ? p.text : "[image]")).join("\n");
}

/**
 * Audit-Log-safe copy of a message list: image parts keep their mimeType but have
 * their base64 `data` replaced with a redaction note. Images are request-only in
 * this ticket (#29) and must never land in the Audit Log's `detail` blob -- #30
 * (persisted image references) is a distinct, separately-scoped content-part
 * variant, not a reason to relax this.
 */
export function redactImagesForAudit(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    return {
      ...m,
      content: m.content.map((p) =>
        p.type === "image"
          ? { type: "image" as const, mimeType: p.mimeType, data: "[redacted: image bytes are not persisted, see #30]" }
          : p
      ),
    };
  });
}

/** Image mime types accepted from the chat input -- the same set Anthropic's `media_type` accepts. */
export const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

// 15MB raw bytes (~20MB once base64-encoded) -- comfortably inside the raised Express
// JSON body limit (see index.ts) while still bounding a single turn's payload well
// below it, so an oversized image gets this server's clear 400 rather than Express's
// opaque "entity too large" or an upstream provider rejection.
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * Validates one content part's shape before it ever reaches a provider -- the request
 * body is untrusted JSON that only *claims* to be a ChatMessagePart at the TypeScript
 * level, so this guards against a non-object entry, an unrecognized `type`, and a
 * `text` part whose `text` isn't a string, as well as (via validateImagePart below) a
 * malformed `image` part. Returns an error message (safe to send straight back to the
 * caller as the 400 body), or null when the part is fine. Called from
 * validateChatMessages below, never directly from a provider's request-building --
 * there, an unrecognized shape should fail loudly in this function's own "unsupported"
 * branch rather than reach toAnthropicContentBlock/toOllamaMessage and produce a
 * half-formed upstream request.
 */
function validatePart(part: unknown): string | null {
  if (!part || typeof part !== "object") {
    return 'Malformed message content: expected an object with a "type" field.';
  }
  const type = (part as { type?: unknown }).type;
  if (type === "text") {
    return typeof (part as { text?: unknown }).text === "string"
      ? null
      : 'Malformed text content part: "text" must be a string.';
  }
  if (type === "image") return validateImagePart(part as ChatMessagePart);
  return `Unsupported content part type "${String(type)}".`;
}

/**
 * Validates one image part before it ever reaches a provider. Returns an error
 * message (safe to send straight back to the caller as the 400 body), or null when
 * the part is fine. Exported separately from validatePart above (which calls this)
 * because it's also the natural seam for an image-specific test.
 */
export function validateImagePart(part: ChatMessagePart): string | null {
  if (part.type !== "image") return null;
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(part.mimeType)) {
    return `Unsupported image type "${part.mimeType}". Supported: ${[...SUPPORTED_IMAGE_MIME_TYPES].join(", ")}.`;
  }
  // The request body is untrusted JSON (its shape only *claims* to be ChatMessagePart at
  // the type level) -- guard against a missing/non-string `data` explicitly so a malformed
  // request gets this function's clean error string, not a TypeError that Express turns
  // into an opaque 500 (there's no try/catch between here and the route handler's body).
  if (typeof part.data !== "string" || part.data.length === 0) {
    return "Image part is missing its data.";
  }
  // Base64 encodes 3 raw bytes as 4 chars; this over-counts slightly (no padding
  // correction), which only makes the limit check stricter, never looser.
  const approxBytes = (part.data.length * 3) / 4;
  if (approxBytes > MAX_IMAGE_BYTES) {
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
    return `Image too large (~${mb(approxBytes)}MB, max ${mb(MAX_IMAGE_BYTES)}MB).`;
  }
  return null;
}

/** Validates every image part across a message list; returns the first error found, or null. */
export function validateChatMessages(messages: ChatMessage[]): string | null {
  for (const m of messages) {
    if (!m || !Array.isArray(m.content)) continue;
    for (const part of m.content) {
      const err = validatePart(part);
      if (err) return err;
    }
  }
  return null;
}

/**
 * A JSON-schema-shaped parameter list for a tool, loose enough to translate
 * into either Anthropic's `input_schema` or Ollama's OpenAI-function-style
 * `parameters` without losing information.
 */
export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, { type: string; description?: string; enum?: string[] }>;
  required?: string[];
  // Index signature so this satisfies Anthropic SDK's `input_schema` type (itself a loose
  // JSON-schema object type) without a lossy cast at the call site.
  [key: string]: unknown;
}

/** A neutral tool definition, translated per-provider into its own wire format. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

/** A model-requested invocation of one tool, translated back from the provider's own shape. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Neutral chat request shared by every LLM Provider. */
export interface LlmChatRequest {
  system: string;
  messages: ChatMessage[];
  context?: unknown;
  /** Tools the model may call this turn. Omitted/empty means no tool-calling is offered. */
  tools?: ToolDef[];
  /**
   * Overrides the provider's normal model resolution (its own `LLM_MODEL` env lookup)
   * for this call only. Used by routes/ai.ts to route an image-bearing turn to
   * `OLLAMA_VISION_MODEL` instead of the regular model under `ollama-cloud` (#29) --
   * most calls omit this and get the provider's own default.
   */
  model?: string;
}

/** Neutral chat response shared by every LLM Provider. */
export interface LlmChatResponse {
  text: string;
  refused: boolean;
  /** Present (and non-empty) when the model asked to invoke one or more tools instead of answering directly. */
  toolCalls?: ToolCall[];
  /** Call metadata for the Audit Log Entry (#23). Omitted when the provider's response didn't carry usable token counts. */
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * A named backend for AI chat completion (see CONTEXT.md's "LLM Provider").
 * Deliberately distinct from `server/src/providers/` (market-data providers) —
 * an unrelated concept in an unrelated domain.
 */
export interface LlmProvider {
  readonly name: string;
  hasCredentials(): boolean;
  /** Human-readable hint naming the missing env var, for the 503 error body. */
  missingCredentialHint(): string;
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;
  /**
   * Whether an error thrown by chat() means the upstream rejected our credentials
   * (invalid/revoked key) rather than any other failure — decides 503 vs 502.
   * Checked against the provider's own typed error shape (e.g. HTTP status), not
   * by guessing from error message text.
   */
  isAuthError(err: unknown): boolean;
}

/** Folds optional terminal context into the message list, ahead of the user's own messages. */
export function withContext(messages: ChatMessage[], context: unknown): ChatMessage[] {
  if (!context) return messages;
  return [
    { role: "user", content: `Current terminal context (JSON):\n${JSON.stringify(context)}` },
    ...messages,
  ];
}
