/** Shared contracts for the AI backends the assistant can talk to. */

/** Claude (Anthropic) stays the default backend; Ollama is the opt-in local one. */
export type AiProviderId = "anthropic" | "ollama";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ProviderInfo = {
  id: AiProviderId;
  label: string;
  /** Model id used when the client doesn't pick one. */
  defaultModel: string;
  /** True when the backend looks usable right now. */
  available: boolean;
  /** Why it isn't usable — shown next to the picker. */
  detail?: string;
};

export type ChatRequest = {
  model: string;
  system: string;
  messages: ChatMessage[];
};

/**
 * Thrown when a backend can't serve the request at all — not configured,
 * not running, no credentials. The route turns it into a 503 with a message
 * the UI can show verbatim.
 */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export interface AiProvider {
  readonly id: AiProviderId;
  readonly label: string;
  /** Model id used when the client doesn't pick one ("" when unknown). */
  readonly defaultModel: string;
  /** Model ids this backend can serve, best-effort. */
  listModels(): Promise<string[]>;
  /** null when the backend looks usable, otherwise the reason why not. */
  unavailableReason(): Promise<string | null>;
  chat(req: ChatRequest): Promise<string>;
}
