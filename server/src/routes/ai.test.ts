import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { aiRouter } from "./ai.js";

function fakeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function getHandler(path: string) {
  const layer = (aiRouter as any).stack.find((l: any) => l.route?.path === path);
  if (!layer) throw new Error(`no route registered for ${path}`);
  return layer.route.stack[0].handle as (req: Request, res: Response, next: () => void) => unknown;
}

function fakeFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

function rssXml(items: Array<{ title: string; link: string }>): string {
  const itemsXml = items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link></item>`).join("");
  return `<?xml version="1.0"?><rss><channel>${itemsXml}</channel></rss>`;
}

// Routes every outbound fetch: calls to the active LLM Provider's own endpoint are served
// in order from `providerResponses` (one JSON body per round-trip); every other URL (the
// news tool's RSS/JSON sources) gets a generic successful empty-ish response, so the tool
// executes for real against the news-search plumbing without depending on live network.
function mockAgenticFetch(providerResponses: unknown[]) {
  let call = 0;
  return vi.fn().mockImplementation((url: string) => {
    const isProviderCall = String(url).includes("api.anthropic.com") || String(url).includes("/api/chat");
    if (isProviderCall) {
      const body = providerResponses[Math.min(call, providerResponses.length - 1)];
      call++;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => body,
        text: async () => JSON.stringify(body),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/xml" }),
      json: async () => ({}),
      text: async () => rssXml([{ title: "Example headline", link: "https://example.com/a" }]),
    });
  });
}

describe("POST /api/ai/chat", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OLLAMA_API_KEY;
    delete process.env.LLM_MODEL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it("rejects a missing messages array with 400, before touching any provider", async () => {
    const handler = getHandler("/chat");
    const req = { body: {} } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "messages array required" });
  });

  it("rejects an empty messages array with 400", async () => {
    const handler = getHandler("/chat");
    const req = { body: { messages: [] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("defaults to anthropic when LLM_PROVIDER is unset, and 503s naming ANTHROPIC_API_KEY when it's missing", async () => {
    const handler = getHandler("/chat");
    const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(503);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("503s naming OLLAMA_API_KEY when LLM_PROVIDER=ollama-cloud and the key is missing", async () => {
    process.env.LLM_PROVIDER = "ollama-cloud";
    const handler = getHandler("/chat");
    const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(503);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/OLLAMA_API_KEY/);
  });

  it("503s on an unrecognized LLM_PROVIDER value rather than silently falling back", async () => {
    process.env.LLM_PROVIDER = "bogus-provider";
    const handler = getHandler("/chat");
    const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(503);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/bogus-provider/);
  });

  it("returns 200 with { text } for the anthropic provider on success", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      fakeFetch(200, { stop_reason: "end_turn", content: [{ type: "text", text: "hi there" }] })
    );
    const handler = getHandler("/chat");
    const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.json).toHaveBeenCalledWith({ text: "hi there" });
  });

  it("returns 200 with { text } for the ollama-cloud provider on success", async () => {
    process.env.LLM_PROVIDER = "ollama-cloud";
    process.env.OLLAMA_API_KEY = "test-key";
    vi.stubGlobal("fetch", fakeFetch(200, { message: { content: "hi there" } }));
    const handler = getHandler("/chat");
    const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.json).toHaveBeenCalledWith({ text: "hi there" });
  });

  it("returns 503 naming the credential when a present-but-invalid key is rejected upstream", async () => {
    process.env.ANTHROPIC_API_KEY = "invalid-key";
    vi.stubGlobal(
      "fetch",
      fakeFetch(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } })
    );
    const handler = getHandler("/chat");
    const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(503);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("returns 502 with the upstream message when the active provider's request fails", async () => {
    process.env.LLM_PROVIDER = "ollama-cloud";
    process.env.OLLAMA_API_KEY = "test-key";
    vi.stubGlobal("fetch", fakeFetch(500, "boom"));
    const handler = getHandler("/chat");
    const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(502);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/500/);
  });

  it("returns 502, not a false-positive 503, when an upstream error's text mentions 'unauthorized' but the status isn't 401/403", async () => {
    process.env.LLM_PROVIDER = "ollama-cloud";
    process.env.OLLAMA_API_KEY = "test-key";
    vi.stubGlobal("fetch", fakeFetch(400, "model access unauthorized for this region"));
    const handler = getHandler("/chat");
    const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(502);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/unauthorized for this region/);
  });

  describe("agentic tool-calling loop", () => {
    it("executes the news tool and folds results back into a second provider call, returning a trace", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      const fetchMock = mockAgenticFetch([
        {
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "Let me check." },
            { type: "tool_use", id: "call_1", name: "search_news", input: { symbol: "AAPL" } },
          ],
        },
        { stop_reason: "end_turn", content: [{ type: "text", text: "AAPL news looks stable." }] },
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const handler = getHandler("/chat");
      const req = { body: { messages: [{ role: "user", content: "What's the latest on AAPL?" }] } } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      expect(res.json).toHaveBeenCalledWith({
        text: "AAPL news looks stable.",
        toolCalls: [{ name: "search_news", arguments: { symbol: "AAPL" } }],
      });

      // Exactly two calls hit the provider endpoint (the tool round + the follow-up); the
      // second call's body carries the folded-back tool results ahead of the original question.
      const providerCalls = fetchMock.mock.calls.filter((c: any) => String(c[0]).includes("api.anthropic.com"));
      expect(providerCalls).toHaveLength(2);
      const secondBody = JSON.parse(providerCalls[1][1].body);
      expect(secondBody.messages.at(-1).content).toContain("Tool results");
      expect(secondBody.messages.at(-1).content).toContain("Example headline");
    });

    it("stops after N tool-call rounds, forcing a final tools-less call at the cap", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      const toolUseResponse = {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "call_1", name: "search_news", input: {} }],
      };
      const fetchMock = mockAgenticFetch([toolUseResponse]); // always returns the same tool_use body
      vi.stubGlobal("fetch", fetchMock);
      const handler = getHandler("/chat");
      const req = { body: { messages: [{ role: "user", content: "keep digging" }] } } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      const providerCalls = fetchMock.mock.calls.filter((c: any) => String(c[0]).includes("api.anthropic.com"));
      // 1 initial call + 5 capped rounds = 6 total provider calls.
      expect(providerCalls).toHaveLength(6);
      const lastBody = JSON.parse(providerCalls.at(-1)[1].body);
      expect(lastBody.tools).toBeUndefined(); // the round at the cap forces an answer without offering tools

      const jsonArg = (res.json as any).mock.calls[0][0];
      expect(jsonArg.toolCalls).toHaveLength(5);
    });

    it("omits toolCalls from the response when the model never calls a tool", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      vi.stubGlobal(
        "fetch",
        mockAgenticFetch([{ stop_reason: "end_turn", content: [{ type: "text", text: "hi there" }] }])
      );
      const handler = getHandler("/chat");
      const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      expect(res.json).toHaveBeenCalledWith({ text: "hi there" });
    });

    it("round-trips tool-calling through the ollama-cloud provider too, not just anthropic", async () => {
      process.env.LLM_PROVIDER = "ollama-cloud";
      process.env.OLLAMA_API_KEY = "test-key";
      const fetchMock = mockAgenticFetch([
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "call_1", function: { name: "search_news", arguments: { symbol: "TSLA" } } }],
          },
        },
        { message: { role: "assistant", content: "TSLA news looks stable." } },
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const handler = getHandler("/chat");
      const req = { body: { messages: [{ role: "user", content: "What's the latest on TSLA?" }] } } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      expect(res.json).toHaveBeenCalledWith({
        text: "TSLA news looks stable.",
        toolCalls: [{ name: "search_news", arguments: { symbol: "TSLA" } }],
      });
    });
  });

  describe("image input (#29)", () => {
    const IMAGE_PART = { type: "image", mimeType: "image/png", data: "aGVsbG8=" };

    it("400s a request with an unsupported image mime type, before touching any provider", async () => {
      const handler = getHandler("/chat");
      const req = {
        body: { messages: [{ role: "user", content: [{ type: "image", mimeType: "image/bmp", data: "aGVsbG8=" }] }] },
      } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(400);
      expect((res.json as any).mock.calls[0][0].error).toMatch(/image\/bmp/);
    });

    it("routes an image-bearing turn under ollama-cloud to OLLAMA_VISION_MODEL, not LLM_MODEL", async () => {
      process.env.LLM_PROVIDER = "ollama-cloud";
      process.env.OLLAMA_API_KEY = "test-key";
      process.env.LLM_MODEL = "gpt-oss:120b";
      process.env.OLLAMA_VISION_MODEL = "llama3.2-vision";
      const fetchMock = fakeFetch(200, { message: { content: "that's a chart of AAPL" } });
      vi.stubGlobal("fetch", fetchMock);
      const handler = getHandler("/chat");
      const req = {
        body: { messages: [{ role: "user", content: [{ type: "text", text: "what is this?" }, IMAGE_PART] }] },
      } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      expect(res.status).not.toHaveBeenCalledWith(503);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.model).toBe("llama3.2-vision");
      delete process.env.OLLAMA_VISION_MODEL;
    });

    it("503s with an actionable message when an image is attached under ollama-cloud but OLLAMA_VISION_MODEL is unset", async () => {
      process.env.LLM_PROVIDER = "ollama-cloud";
      process.env.OLLAMA_API_KEY = "test-key";
      const fetchMock = fakeFetch(200, { message: { content: "should never be reached" } });
      vi.stubGlobal("fetch", fetchMock);
      const handler = getHandler("/chat");
      const req = {
        body: { messages: [{ role: "user", content: [IMAGE_PART] }] },
      } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      expect(res.status).toHaveBeenCalledWith(503);
      expect((res.json as any).mock.calls[0][0].error).toMatch(/OLLAMA_VISION_MODEL/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not require OLLAMA_VISION_MODEL for an image-bearing turn under anthropic", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      const fetchMock = fakeFetch(200, { stop_reason: "end_turn", content: [{ type: "text", text: "that's a chart" }] });
      vi.stubGlobal("fetch", fetchMock);
      const handler = getHandler("/chat");
      const req = {
        body: { messages: [{ role: "user", content: [IMAGE_PART] }] },
      } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      expect(res.status).not.toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ text: "that's a chart" });
    });

    it("never writes raw image bytes into the Audit Log's chat detail", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      vi.stubGlobal(
        "fetch",
        fakeFetch(200, { stop_reason: "end_turn", content: [{ type: "text", text: "that's a chart" }] })
      );
      const { db } = await import("../db.js");
      const handler = getHandler("/chat");
      const req = {
        body: { messages: [{ role: "user", content: [{ type: "text", text: "what is this?" }, IMAGE_PART] }] },
      } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      const row = db.prepare("SELECT detail FROM audit_log WHERE event_type = 'chat' ORDER BY id DESC LIMIT 1").get() as {
        detail: string;
      };
      expect(row.detail).not.toContain("aGVsbG8=");
    });
  });
});
