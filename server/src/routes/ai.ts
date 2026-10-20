import { Router } from "express";
import {
  DEFAULT_PROVIDER_ID,
  describeProviders,
  getProvider,
  isProviderId,
  pickProvider,
} from "../ai/index.js";
import { AiUnavailableError, type AiProvider, type ChatMessage } from "../ai/types.js";

export const aiRouter = Router();

const SYSTEM = `You are the AI assistant inside OpenTerminal, a Bloomberg-style financial terminal.
You help the user interpret market data, charts, news, options chains and macro indicators.
Answer concisely and professionally, in the language the user writes in.
When market data is provided in the conversation as JSON context, ground your answer in it.
You are not a licensed financial advisor: never give personalized investment advice or tell the user what to buy or sell.`;

type ChatBody = {
  messages?: unknown;
  context?: unknown;
  provider?: unknown;
  model?: unknown;
};

/** Keep only well-formed turns — the backends reject anything else. */
function normalizeMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  const out: ChatMessage[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const { role, content } = raw as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string" || content.length === 0) continue;
    out.push({ role, content });
  }
  return out;
}

/** The requested model, or the backend's default, or its first available one. */
async function resolveModel(provider: AiProvider, requested: unknown): Promise<string> {
  const wanted = typeof requested === "string" ? requested.trim() : "";
  if (wanted) return wanted;
  if (provider.defaultModel) return provider.defaultModel;
  const models = await provider.listModels();
  return models[0] ?? "";
}

/** Catalogue for the widget's picker: which backends exist, and which work. */
aiRouter.get("/providers", async (_req, res) => {
  res.json({
    providers: await describeProviders(),
    defaultProvider: DEFAULT_PROVIDER_ID,
  });
});

/** Model ids the given backend can serve right now. */
aiRouter.get("/models", async (req, res) => {
  const requested = typeof req.query.provider === "string" ? req.query.provider : DEFAULT_PROVIDER_ID;
  if (!isProviderId(requested)) {
    return res.status(400).json({ error: `unknown provider "${requested}"` });
  }
  const provider = getProvider(requested);
  try {
    const models = await provider.listModels();
    res.json({
      provider: requested,
      models,
      defaultModel: provider.defaultModel || models[0] || "",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(err instanceof AiUnavailableError ? 503 : 502).json({ error: msg });
  }
});

aiRouter.post("/chat", async (req, res) => {
  const { messages, context, provider: providerId, model } = (req.body ?? {}) as ChatBody;
  const turns = normalizeMessages(messages);
  if (turns.length === 0) {
    return res.status(400).json({ error: "messages array required" });
  }

  // Claude stays the default; the client only has to name a provider to switch.
  const id = pickProvider(providerId);
  if (!id) {
    return res.status(400).json({ error: `unknown provider "${String(providerId)}"` });
  }
  const provider = getProvider(id);

  try {
    const resolvedModel = await resolveModel(provider, model);
    if (!resolvedModel) {
      return res.status(400).json({ error: `no model available for provider "${id}"` });
    }
    const contextBlock: ChatMessage[] = context
      ? [{ role: "user", content: `Current terminal context (JSON):\n${JSON.stringify(context)}` }]
      : [];
    const text = await provider.chat({
      model: resolvedModel,
      system: SYSTEM,
      messages: [...contextBlock, ...turns],
    });
    res.json({ text, provider: id, model: resolvedModel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof AiUnavailableError) {
      return res.status(503).json({ error: msg });
    }
    res.status(502).json({ error: msg });
  }
});
