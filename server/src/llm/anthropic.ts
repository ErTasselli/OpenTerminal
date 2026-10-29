import Anthropic from "@anthropic-ai/sdk";
import type { LlmChatRequest, LlmChatResponse, LlmProvider, ToolDef } from "./types.js";
import { withContext } from "./types.js";

const DEFAULT_MODEL = "claude-opus-4-8";

/** Neutral tool def -> Anthropic's `tools` wire format (JSON schema under `input_schema`). */
function toAnthropicTool(tool: ToolDef) {
  return { name: tool.name, description: tool.description, input_schema: tool.parameters };
}

export const anthropicProvider: LlmProvider = {
  name: "anthropic",

  hasCredentials(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },

  missingCredentialHint(): string {
    return "set ANTHROPIC_API_KEY on the server.";
  },

  async chat({ system, messages, context, tools }: LlmChatRequest): Promise<LlmChatResponse> {
    // A fresh client per call (rather than a module-level singleton) so it always
    // picks up the current ANTHROPIC_API_KEY / global fetch — important for tests.
    const client = new Anthropic();
    const response = await client.messages.create({
      model: process.env.LLM_MODEL || DEFAULT_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system,
      messages: withContext(messages, context),
      ...(tools && tools.length > 0 ? { tools: tools.map(toAnthropicTool) } : {}),
    });
    // Present on both a normal response and a refusal -- used for the Audit Log Entry's
    // call-metadata token usage (#23). Guarded the same defensive way as
    // ollama.ts's parseToolCallArguments: omit `usage` entirely rather than throw
    // if the shape isn't what's expected.
    const usage =
      response.usage &&
      typeof response.usage.input_tokens === "number" &&
      typeof response.usage.output_tokens === "number"
        ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
        : undefined;

    if (response.stop_reason === "refusal") {
      return { text: "The assistant declined to answer this request.", refused: true, usage };
    }
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("");
    const toolCalls = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, arguments: (b.input ?? {}) as Record<string, unknown> }));
    return { text, refused: false, toolCalls: toolCalls.length > 0 ? toolCalls : undefined, usage };
  },

  isAuthError(err: unknown): boolean {
    return err instanceof Anthropic.APIError && (err.status === 401 || err.status === 403);
  },
};
