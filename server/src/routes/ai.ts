import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { tfetch } from "../http.js";
import { DEFAULT_MODEL, PROVIDERS, isConfigured, loadAiConfig, saveAiConfig, type AiConfig, type AiProvider } from "../aiConfig.js";

export const aiRouter = Router();

// Connection settings come from the Settings dialog (data/ai.json) or, for
// Anthropic, from ANTHROPIC_API_KEY / ANTHROPIC_MODEL; see aiConfig.ts.
const SYSTEM = `You are the AI assistant inside OpenTerminal, a Bloomberg-style financial terminal.
You help the user interpret market data, charts, news, options chains and macro indicators.
Answer concisely and professionally, in the language the user writes in.
When market data is provided in the conversation as JSON context, ground your answer in it.
You are not a licensed financial advisor: never give personalized investment advice or tell the user what to buy or sell.`;

type Msg = { role: "user" | "assistant"; content: string };

async function complete(cfg: AiConfig, messages: Msg[], context: unknown): Promise<string> {
  const contextBlock: Msg[] = context
    ? [{ role: "user", content: `Current terminal context (JSON):\n${JSON.stringify(context)}` }]
    : [];
  if (cfg.provider !== "anthropic") {
    const res = await tfetch(
      `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: "system", content: SYSTEM }, ...contextBlock, ...messages] }),
      },
      120_000
    );
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message ?? `AI provider http ${res.status}`);
    return String(json?.choices?.[0]?.message?.content ?? "");
  }
  const client = new Anthropic(cfg.apiKey ? { apiKey: cfg.apiKey } : undefined);
  const response = await client.messages.create({
    model: cfg.model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    messages: [...contextBlock, ...messages],
  });
  if (response.stop_reason === "refusal") return "The assistant declined to answer this request.";
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => ("text" in b ? b.text : ""))
    .join("");
}

function describe(cfg: AiConfig) {
  return { provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl, hasKey: Boolean(cfg.apiKey), configured: isConfigured(cfg) };
}

aiRouter.get("/config", (_req, res) => {
  res.json(describe(loadAiConfig()));
});

// Body: { provider?, apiKey?, model?, baseUrl? }. An empty apiKey keeps the saved one.
aiRouter.post("/config", (req, res) => {
  const b = req.body ?? {};
  const patch: Partial<AiConfig> = {};
  if (PROVIDERS.includes(b.provider)) patch.provider = b.provider as AiProvider;
  if (typeof b.apiKey === "string" && b.apiKey.trim()) patch.apiKey = b.apiKey.trim();
  if (typeof b.model === "string") patch.model = b.model.trim() || (DEFAULT_MODEL[patch.provider ?? loadAiConfig().provider]);
  if (typeof b.baseUrl === "string" && b.baseUrl.trim()) {
    try {
      const u = new URL(b.baseUrl.trim());
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
      patch.baseUrl = b.baseUrl.trim();
    } catch {
      return res.status(400).json({ error: "base URL must be a valid http(s) URL" });
    }
  }
  res.json(describe(saveAiConfig(patch)));
});

aiRouter.post("/test", async (_req, res) => {
  const cfg = loadAiConfig();
  if (!isConfigured(cfg)) return res.status(503).json({ error: "AI is not configured yet" });
  try {
    await complete({ ...cfg }, [{ role: "user", content: "Reply with the single word: ok" }], null);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

aiRouter.post("/chat", async (req, res) => {
  const { messages, context } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array required" });
  }
  const cfg = loadAiConfig();
  if (!isConfigured(cfg)) {
    return res.status(503).json({ error: "AI assistant unavailable: add a provider and API key in Settings." });
  }
  try {
    res.json({ text: await complete(cfg, messages, context) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("api_key") || msg.includes("authentication")) {
      return res.status(503).json({ error: "AI assistant unavailable: check the API key in Settings." });
    }
    res.status(502).json({ error: msg });
  }
});
