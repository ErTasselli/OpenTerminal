import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { getAiConfig } from "../settings.js";

export const aiRouter = Router();

// Rebuild the client when the key or base URL changes in Settings. Without
// settings overrides the SDK still falls back to env vars / `ant auth login`.
let client: Anthropic | null = null;
let clientSignature = "";

function getClient(): Anthropic {
  const config = getAiConfig();
  const signature = `${config.apiKey ?? ""}|${config.baseUrl ?? ""}`;
  if (!client || signature !== clientSignature) {
    const options: ConstructorParameters<typeof Anthropic>[0] = {};
    if (config.apiKey) options.apiKey = config.apiKey;
    if (config.baseUrl) options.baseURL = config.baseUrl;
    client = new Anthropic(options);
    clientSignature = signature;
  }
  return client;
}

const SYSTEM = `You are the AI assistant inside OpenTerminal, a Bloomberg-style financial terminal.
You help the user interpret market data, charts, news, options chains and macro indicators.
Answer concisely and professionally, in the language the user writes in.
When market data is provided in the conversation as JSON context, ground your answer in it.
You are not a licensed financial advisor: never give personalized investment advice or tell the user what to buy or sell.`;

aiRouter.post("/chat", async (req, res) => {
  const { messages, context } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array required" });
  }
  try {
    const contextBlock = context
      ? [{ role: "user" as const, content: `Current terminal context (JSON):\n${JSON.stringify(context)}` }]
      : [];
    const response = await getClient().messages.create({
      model: getAiConfig().model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [...contextBlock, ...messages],
    });
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
      return res.status(503).json({
        error: "AI assistant unavailable: add an Anthropic API key in Settings (or set ANTHROPIC_API_KEY).",
      });
    }
    res.status(502).json({ error: msg });
  }
});
