import { AiUnavailableError, type AiProvider, type ChatRequest } from "./types.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
/** The tag list is a local round-trip: a short timeout is enough. */
const PROBE_TIMEOUT_MS = 2_000;
/** Local models can take a while to load into memory — be generous. */
const CHAT_TIMEOUT_MS = 300_000;
const TAGS_CACHE_MS = 15_000;

/** Where the Ollama daemon lives. Never taken from the client: the browser
 *  must not be able to make the server fetch an arbitrary URL. */
export function ollamaBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

type TagsModel = { name?: string; model?: string; capabilities?: string[] };
type TagsResponse = { models?: TagsModel[] };

// Ollama reports "completion" for audio and embedding models too, so those
// would show up as chat candidates and answer with noise. Keep the ones that
// can actually hold a conversation.
const NON_CHAT_MODEL = /whisper|tts|embed|clip|bert|minilm|mms[-:]|parler|melspectro/i;

let tagsCache: { at: number; models: string[] } | null = null;

async function fetchWithTimeout(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Model ids of the chat-capable models the local daemon has installed. */
async function fetchTags(): Promise<string[]> {
  const now = Date.now();
  if (tagsCache && now - tagsCache.at < TAGS_CACHE_MS) return tagsCache.models;

  let res: Response;
  try {
    res = await fetchWithTimeout(`${ollamaBaseUrl()}/api/tags`, undefined, PROBE_TIMEOUT_MS);
  } catch {
    throw new AiUnavailableError(
      `Ollama is not reachable at ${ollamaBaseUrl()} — start it with \`ollama serve\`.`
    );
  }
  if (!res.ok) {
    throw new AiUnavailableError(`Ollama at ${ollamaBaseUrl()} answered ${res.status}.`);
  }

  const data = (await res.json()) as TagsResponse;
  const models = (data.models ?? [])
    // Older daemons don't report capabilities; only filter when they do.
    .filter((m) => !m.capabilities || m.capabilities.includes("completion"))
    .map((m) => m.name ?? m.model)
    .filter((name): name is string => Boolean(name))
    .filter((name) => !NON_CHAT_MODEL.test(name));
  const unique = [...new Set(models)].sort();
  tagsCache = { at: now, models: unique };
  return unique;
}

export const ollamaProvider: AiProvider = {
  id: "ollama",
  label: "Ollama (local)",
  get defaultModel(): string {
    return process.env.OLLAMA_MODEL || "";
  },

  async listModels(): Promise<string[]> {
    return fetchTags();
  },

  async unavailableReason(): Promise<string | null> {
    try {
      await fetchTags();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  },

  async chat(req: ChatRequest): Promise<string> {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${ollamaBaseUrl()}/api/chat`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: req.model,
            messages: [{ role: "system", content: req.system }, ...req.messages],
            stream: false,
          }),
        },
        CHAT_TIMEOUT_MS
      );
    } catch {
      throw new AiUnavailableError(
        `Ollama is not reachable at ${ollamaBaseUrl()} — is the daemon running?`
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 404) {
        throw new AiUnavailableError(
          `Ollama has no model "${req.model}" — pull it with \`ollama pull ${req.model}\`.`
        );
      }
      throw new Error(`Ollama error ${res.status}${body ? `: ${body}` : ""}`);
    }

    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? "";
  },
};

/** Exposed for tests only; not part of the provider contract. */
export function resetOllamaCache(): void {
  tagsCache = null;
}
