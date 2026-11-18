import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ollamaProvider } from "./ollama.js";

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ollamaProvider", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.OLLAMA_API_KEY = "test-ollama-key";
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.LLM_MODEL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it("reports credentials based on OLLAMA_API_KEY", () => {
    expect(ollamaProvider.hasCredentials()).toBe(true);
    delete process.env.OLLAMA_API_KEY;
    expect(ollamaProvider.hasCredentials()).toBe(false);
  });

  it("hits the native /api/chat endpoint with the bearer token, default model, and system+message shape", async () => {
    const fetchMock = mockFetchOnce(200, { message: { role: "assistant", content: "hello" } });

    const result = await ollamaProvider.chat({
      system: "be terse",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result).toEqual({ text: "hello", refused: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ollama.com/api/chat");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-ollama-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("gpt-oss:120b");
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([
      { role: "system", content: "be terse" },
      { role: "user", content: "hi" },
    ]);
    // No thinking/reasoning param is ever sent to Ollama Cloud.
    expect(body.thinking).toBeUndefined();
  });

  it("prepends the JSON context block ahead of the caller's messages", async () => {
    const fetchMock = mockFetchOnce(200, { message: { content: "ok" } });

    await ollamaProvider.chat({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      context: { symbol: "AAPL" },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1]).toEqual({
      role: "user",
      content: `Current terminal context (JSON):\n${JSON.stringify({ symbol: "AAPL" })}`,
    });
    expect(body.messages[2]).toEqual({ role: "user", content: "hi" });
  });

  it("respects OLLAMA_BASE_URL and LLM_MODEL overrides", async () => {
    process.env.OLLAMA_BASE_URL = "https://custom.example.com/";
    process.env.LLM_MODEL = "some-other-model";
    const fetchMock = mockFetchOnce(200, { message: { content: "ok" } });

    await ollamaProvider.chat({ system: "sys", messages: [{ role: "user", content: "hi" }] });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://custom.example.com/api/chat");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("some-other-model");
  });

  it("throws with the upstream status on a non-ok response", async () => {
    mockFetchOnce(429, "rate limited");

    await expect(
      ollamaProvider.chat({ system: "sys", messages: [{ role: "user", content: "hi" }] })
    ).rejects.toThrow(/429/);
  });

  it("omits `tools` from the request when no tools are passed", async () => {
    const fetchMock = mockFetchOnce(200, { message: { content: "ok" } });

    await ollamaProvider.chat({ system: "sys", messages: [{ role: "user", content: "hi" }] });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
  });

  it("translates a neutral tool def into Ollama's OpenAI-function-style wire format", async () => {
    const fetchMock = mockFetchOnce(200, { message: { content: "ok" } });
    const tool = {
      name: "search_news",
      description: "search financial news",
      parameters: {
        type: "object" as const,
        properties: { symbol: { type: "string", description: "ticker" } },
        required: [],
      },
    };

    await ollamaProvider.chat({ system: "sys", messages: [{ role: "user", content: "hi" }], tools: [tool] });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toEqual([
      { type: "function", function: { name: "search_news", description: "search financial news", parameters: tool.parameters } },
    ]);
  });

  it("parses message.tool_calls (object arguments) into neutral toolCalls", async () => {
    mockFetchOnce(200, {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call_1", function: { name: "search_news", arguments: { symbol: "AAPL" } } }],
      },
    });

    const result = await ollamaProvider.chat({
      system: "sys",
      messages: [{ role: "user", content: "AAPL news?" }],
      tools: [
        { name: "search_news", description: "d", parameters: { type: "object", properties: {}, required: [] } },
      ],
    });

    expect(result.toolCalls).toEqual([{ id: "call_1", name: "search_news", arguments: { symbol: "AAPL" } }]);
  });

  it("parses message.tool_calls with stringified JSON arguments into neutral toolCalls", async () => {
    mockFetchOnce(200, {
      message: {
        content: "",
        tool_calls: [{ function: { name: "search_news", arguments: '{"symbol":"AAPL"}' } }],
      },
    });

    const result = await ollamaProvider.chat({
      system: "sys",
      messages: [{ role: "user", content: "AAPL news?" }],
    });

    expect(result.toolCalls).toEqual([{ id: "search_news-0", name: "search_news", arguments: { symbol: "AAPL" } }]);
  });

  it("leaves toolCalls undefined when the response has no tool_calls", async () => {
    mockFetchOnce(200, { message: { content: "ok" } });
    const result = await ollamaProvider.chat({ system: "sys", messages: [{ role: "user", content: "hi" }] });
    expect(result.toolCalls).toBeUndefined();
  });

  it("maps top-level prompt_eval_count/eval_count into neutral usage", async () => {
    mockFetchOnce(200, { message: { content: "ok" }, prompt_eval_count: 123, eval_count: 45 });

    const result = await ollamaProvider.chat({ system: "sys", messages: [{ role: "user", content: "hi" }] });

    expect(result.usage).toEqual({ inputTokens: 123, outputTokens: 45 });
  });

  it("omits usage when prompt_eval_count/eval_count are missing or non-numeric", async () => {
    mockFetchOnce(200, { message: { content: "ok" } });
    const result = await ollamaProvider.chat({ system: "sys", messages: [{ role: "user", content: "hi" }] });
    expect(result.usage).toBeUndefined();

    mockFetchOnce(200, { message: { content: "ok" }, prompt_eval_count: "oops", eval_count: 45 });
    const result2 = await ollamaProvider.chat({ system: "sys", messages: [{ role: "user", content: "hi" }] });
    expect(result2.usage).toBeUndefined();
  });

  it("translates an image-part message into Ollama's native {content, images} shape", async () => {
    const fetchMock = mockFetchOnce(200, { message: { content: "ok" } });

    await ollamaProvider.chat({
      system: "sys",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this?" },
            { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
          ],
        },
      ],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1]).toEqual({ role: "user", content: "what is this?", images: ["aGVsbG8="] });
  });

  it("respects a per-call `model` override over LLM_MODEL", async () => {
    process.env.LLM_MODEL = "should-be-ignored";
    const fetchMock = mockFetchOnce(200, { message: { content: "ok" } });

    await ollamaProvider.chat({ system: "sys", messages: [{ role: "user", content: "hi" }], model: "vision-model" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("vision-model");
  });
});
