import { anthropicProvider } from "./anthropic.js";
import { ollamaProvider } from "./ollama.js";
import type { AiProvider, AiProviderId, ProviderInfo } from "./types.js";

const PROVIDERS: Record<AiProviderId, AiProvider> = {
  anthropic: anthropicProvider,
  ollama: ollamaProvider,
};

/** Claude stays the default backend; Ollama is opt-in from the UI. */
export const DEFAULT_PROVIDER_ID: AiProviderId = "anthropic";

export function isProviderId(value: unknown): value is AiProviderId {
  return value === "anthropic" || value === "ollama";
}

/**
 * The backend a request should use: the client's pick, or Claude when the
 * client didn't name one. null means "the client named something unknown".
 */
export function pickProvider(value: unknown): AiProviderId | null {
  if (value === undefined || value === null || value === "") return DEFAULT_PROVIDER_ID;
  return isProviderId(value) ? value : null;
}

export function getProvider(id: AiProviderId): AiProvider {
  return PROVIDERS[id];
}

/** Backend catalogue for the picker: what exists, and what works right now. */
export async function describeProviders(): Promise<ProviderInfo[]> {
  return Promise.all(
    Object.values(PROVIDERS).map(async (provider) => {
      let detail: string | undefined;
      try {
        const reason = await provider.unavailableReason();
        if (reason) detail = reason;
      } catch (err) {
        detail = err instanceof Error ? err.message : String(err);
      }
      return {
        id: provider.id,
        label: provider.label,
        defaultModel: provider.defaultModel,
        available: detail === undefined,
        ...(detail ? { detail } : {}),
      };
    })
  );
}
