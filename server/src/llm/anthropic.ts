import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatMessagePart, LlmChatRequest, LlmChatResponse, LlmProvider, ToolDef } from "./types.js";
import { withContext } from "./types.js";

const DEFAULT_MODEL = "claude-opus-4-8";

/** Neutral tool def -> Anthropic's `tools` wire format (JSON schema under `input_schema`). */
function toAnthropicTool(tool: ToolDef) {
  return { name: tool.name, description: tool.description, input_schema: tool.parameters };
}

/** Neutral content part -> Anthropic's content-block wire format. `mimeType` is validated
 * against Anthropic's own accepted `media_type` set upstream (see validateImagePart in
 * types.ts), so the cast here is safe. */
function toAnthropicContentBlock(part: ChatMessagePart): Anthropic.ContentBlockParam {
  if (part.type === "text") return { type: "text", text: part.text };
  if (part.type === "image") {
    return {
      type: "image",
      source: { type: "base64", media_type: part.mimeType as Anthropic.Base64ImageSource["media_type"], data: part.data },
    };
  }
  // llm/imageHistoryCap.ts's capLiveImages resolves every `image-ref` into either a
  // rehydrated `image` or a text placeholder before any message list reaches a
  // provider -- reaching here means that contract was violated upstream (routes/ai.ts
  // called provider.chat() without running the message list through capLiveImages
  // first), which must fail loudly rather than silently drop the image.
  throw new Error(`Unresolved image-ref part (id=${part.id}) reached the anthropic provider.`);
}

/** Neutral ChatMessage -> Anthropic's MessageParam wire format. Plain-string content (the
 * common case) passes through unchanged; array content maps to content blocks. */
function toAnthropicMessage(message: ChatMessage): Anthropic.MessageParam {
  if (typeof message.content === "string") return { role: message.role, content: message.content };
  return { role: message.role, content: message.content.map(toAnthropicContentBlock) };
}

export const anthropicProvider: LlmProvider = {
  name: "anthropic",

  hasCredentials(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },

  missingCredentialHint(): string {
    return "set ANTHROPIC_API_KEY on the server.";
  },

  async chat({ system, messages, context, tools, model }: LlmChatRequest): Promise<LlmChatResponse> {
    // A fresh client per call (rather than a module-level singleton) so it always
    // picks up the current ANTHROPIC_API_KEY / global fetch — important for tests.
    const client = new Anthropic();
    const response = await client.messages.create({
      model: model || process.env.LLM_MODEL || DEFAULT_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system,
      messages: withContext(messages, context).map(toAnthropicMessage),
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
