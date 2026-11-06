import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const aiRouter = Router();

// Uses ANTHROPIC_API_KEY (or an `ant auth login` profile) from the environment.
// If no credentials are configured, the endpoint reports the assistant as unavailable.
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const SYSTEM = `You are the AI assistant inside OpenTerminal, a Bloomberg-style financial terminal.
You help the user interpret market data, charts, news, options chains and macro indicators.
Answer concisely and professionally, in the language the user writes in.
When market data is provided in the conversation as JSON context, ground your answer in it.
You are not a licensed financial advisor: never give personalized investment advice or tell the user what to buy or sell.`;

// Spend guards, all overridable via env (read per request so they can be tuned
// without a code change). AI_DAILY_TOKEN_LIMIT is opt-in: unset or 0 = no cap.
function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= 0 && process.env[name] !== "" ? n : fallback;
}

const chatSchema = () =>
  z.object({
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().min(1).max(envInt("AI_MAX_MESSAGE_CHARS", 8000)),
        })
      )
      .min(1)
      .max(envInt("AI_MAX_MESSAGES", 40)),
    context: z.unknown().optional(),
  });

// Tokens billed today (UTC), kept in memory: a restart resets the count.
let usage = { day: "", tokens: 0 };
export function tokensUsedToday(): number {
  const today = new Date().toISOString().slice(0, 10);
  if (usage.day !== today) usage = { day: today, tokens: 0 };
  return usage.tokens;
}
export function resetAiUsage(): void {
  usage = { day: "", tokens: 0 };
}

aiRouter.post("/chat", async (req, res) => {
  const parsed = chatSchema().safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid request" });
  }
  const { messages, context } = parsed.data;
  const contextJson = context == null ? "" : JSON.stringify(context);
  if (contextJson.length > envInt("AI_MAX_CONTEXT_CHARS", 20000)) {
    return res.status(413).json({ error: "context too large" });
  }
  const dailyLimit = envInt("AI_DAILY_TOKEN_LIMIT", 0);
  if (dailyLimit > 0 && tokensUsedToday() >= dailyLimit) {
    return res.status(429).json({ error: "Daily AI token limit reached; it resets at 00:00 UTC." });
  }
  try {
    const contextBlock = contextJson
      ? [{ role: "user" as const, content: `Current terminal context (JSON):\n${contextJson}` }]
      : [];
    const response = await getClient().messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8",
      max_tokens: envInt("AI_MAX_TOKENS", 16000) || 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [...contextBlock, ...messages],
    });
    const u = response.usage;
    tokensUsedToday();
    usage.tokens +=
      u.input_tokens + u.output_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    if (response.stop_reason === "refusal") {
      return res.json({ text: "The assistant declined to answer this request." });
    }
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("");
    res.json({ text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("api_key") || msg.includes("authentication")) {
      return res.status(503).json({ error: "AI assistant unavailable: set ANTHROPIC_API_KEY on the server." });
    }
    res.status(502).json({ error: msg });
  }
});
