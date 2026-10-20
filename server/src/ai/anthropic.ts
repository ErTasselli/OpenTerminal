import Anthropic from "@anthropic-ai/sdk";
import { AiUnavailableError, type AiProvider, type ChatRequest } from "./types.js";

const DEFAULT_MODEL = "claude-opus-4-8";

// Uses ANTHROPIC_API_KEY (or an `ant auth login` profile) from the environment.
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

// The SDK's model listing is reached through a structural type on purpose:
// this module must keep working if the SDK reshapes its client surface.
type ModelsApi = {
  models?: { list?: () => Promise<{ data?: Array<{ id?: string }> }> };
};

function credentialsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let modelCache: { at: number; models: string[] } | null = null;
const MODEL_CACHE_MS = 5 * 60_000;

export const anthropicProvider: AiProvider = {
  id: "anthropic",
  label: "Claude (Anthropic)",
  get defaultModel(): string {
    return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  },

  async listModels(): Promise<string[]> {
    const fallback = [this.defaultModel];
    // Without credentials the SDK can't list anything — don't even try.
    if (!credentialsConfigured()) return fallback;
    const now = Date.now();
    if (modelCache && now - modelCache.at < MODEL_CACHE_MS) return modelCache.models;
    try {
      const api = (getClient() as unknown as ModelsApi).models;
      const page = await api?.list?.();
      const ids = (page?.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
      const models = ids.length ? ids : fallback;
      modelCache = { at: now, models };
      return models;
    } catch {
      // A gateway that doesn't implement /v1/models is fine: the default model
      // is still usable, so never let the listing break the picker.
      return modelCache?.models ?? fallback;
    }
  },

  async unavailableReason(): Promise<string | null> {
    if (credentialsConfigured()) return null;
    // No key in the environment. The SDK may still resolve credentials some
    // other way (an `ant auth login` profile, a keyless gateway), so this is
    // reported as "not configured" rather than "broken" — the chat request
    // itself is what ultimately decides.
    return "no ANTHROPIC_API_KEY on the server — set one to use Claude";
  },

  async chat(req: ChatRequest): Promise<string> {
    try {
      const response = await getClient().messages.create({
        model: req.model,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: req.system,
        messages: req.messages,
      });
      if (response.stop_reason === "refusal") {
        return "The assistant declined to answer this request.";
      }
      return response.content
        .filter((b) => b.type === "text")
        .map((b) => ("text" in b ? b.text : ""))
        .join("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/api[_ -]?key|authentication|unauthorized|401/i.test(msg)) {
        throw new AiUnavailableError("AI assistant unavailable: set ANTHROPIC_API_KEY on the server.");
      }
      throw err;
    }
  },
};

/** Exposed for tests only; not part of the provider contract. */
export function resetAnthropicCache(): void {
  modelCache = null;
}
