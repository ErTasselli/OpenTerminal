/** A single turn in a chat conversation, in the shape both LLM Providers accept. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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
