import { anthropicProvider } from "./anthropic.js";
import { ollamaProvider } from "./ollama.js";
import type { ChatMessage, LlmProvider } from "./types.js";
import { messageHasImage } from "./types.js";

export * from "./types.js";

const PROVIDERS: Record<string, LlmProvider> = {
  anthropic: anthropicProvider,
  "ollama-cloud": ollamaProvider,
};

/** An unrecognized LLM_PROVIDER value — same error class as missing credentials (503). */
export class LlmConfigError extends Error {}

/** Resolves LLM_PROVIDER (default "anthropic") to its provider, or throws LlmConfigError. */
export function activeProvider(): LlmProvider {
  const key = process.env.LLM_PROVIDER || "anthropic";
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new LlmConfigError(
      `Unrecognized LLM_PROVIDER "${key}". Expected "anthropic" or "ollama-cloud".`
    );
  }
  return provider;
}

/** Thrown when a turn carries an image under `ollama-cloud` but `OLLAMA_VISION_MODEL`
 * isn't set. Deliberately its own class, not LlmConfigError: both are config problems
 * caught the same way in routes/ai.ts (503, not a runtime upstream failure), but kept
 * distinct so the two missing-knob cases can't be confused with each other. */
export class MissingVisionModelError extends Error {}

/**
 * Picks the model override for one chat turn, if any (see LlmChatRequest.model).
 * `anthropic`'s Claude models are natively multimodal, so an image-bearing turn there
 * just uses the regular model (undefined -- no override). `ollama-cloud`'s regular
 * `LLM_MODEL` may be a text-only model, so an image-bearing turn there must instead
 * name a vision-capable model via `OLLAMA_VISION_MODEL` -- throwing with an actionable
 * message if that's unset, rather than silently falling back to the (likely
 * vision-incapable) default and getting a garbled or hallucinated answer back.
 */
export function resolveChatModel(provider: LlmProvider, messages: ChatMessage[]): string | undefined {
  if (provider.name !== "ollama-cloud") return undefined;
  if (!messages.some(messageHasImage)) return undefined;
  const visionModel = process.env.OLLAMA_VISION_MODEL;
  if (!visionModel) {
    throw new MissingVisionModelError(
      "This message includes an image, but OLLAMA_VISION_MODEL isn't set. Set it to a vision-capable Ollama Cloud model (e.g. a Llama vision model) to let the assistant see images."
    );
  }
  return visionModel;
}

/** Whether the active provider is configured and ready to serve requests — used by /api/status. */
export function isAiAvailable(): boolean {
  try {
    return activeProvider().hasCredentials();
  } catch {
    return false;
  }
}
