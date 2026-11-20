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

// A minimal-but-valid nasdaq.quote() "info"/"summary" response pair -- just enough
// fields for nasdaq.ts's quote() to resolve a Quote without throwing, so the
// get_quote tool's test below exercises the real getQuotes waterfall rather than
// stubbing it out.
const NASDAQ_QUOTE_INFO = {
  data: {
    companyName: "Apple Inc.",
    exchange: "NASDAQ",
    marketStatus: "Market Open",
    primaryData: { lastSalePrice: "$150.00", netChange: "1.00", percentageChange: "0.67%", previousClose: "$149.00" },
    keyStats: { dayrange: { value: "148.00 - 151.00" }, fiftyTwoWeekHighLow: { value: "120.00 - 160.00" } },
  },
};
const NASDAQ_QUOTE_SUMMARY = { data: { summaryData: {} } };

// Routes every outbound fetch: calls to the active LLM Provider's own endpoint are served
// in order from `providerResponses` (one JSON body per round-trip); nasdaq's quote info/
// summary endpoints (hit by the get_quote tool's getQuotes waterfall) get a minimal valid
// quote response; every other URL (the news tool's RSS/JSON sources, nasdaq autocomplete,
// etc.) gets a generic successful empty-ish response, so each tool executes for real
// against its own plumbing without depending on live network.
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
    if (String(url).includes("api.nasdaq.com/api/quote/") && String(url).includes("/info?")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => NASDAQ_QUOTE_INFO,
        text: async () => JSON.stringify(NASDAQ_QUOTE_INFO),
      });
    }
    if (String(url).includes("api.nasdaq.com/api/quote/") && String(url).includes("/summary?")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => NASDAQ_QUOTE_SUMMARY,
        text: async () => JSON.stringify(NASDAQ_QUOTE_SUMMARY),
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

    it("tells the model on the forced final round that no more tools are available and it must answer now (#70)", async () => {
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
      expect(providerCalls).toHaveLength(6); // 1 initial call + 5 capped rounds

      // Every call before the forced final round uses the plain system prompt; only the
      // last call (the one with `tools` omitted) gets the added "no more tools" instruction.
      for (const call of providerCalls.slice(0, -1)) {
        const body = JSON.parse(call[1].body);
        expect(body.system).not.toMatch(/no further tool calls/i);
      }
      const lastBody = JSON.parse(providerCalls.at(-1)[1].body);
      expect(lastBody.tools).toBeUndefined();
      expect(lastBody.system).toMatch(/no further tool calls/i);
      expect(lastBody.system).toMatch(/final answer/i);
    });

    it("replaces a leaked 'Requested tool call(s):' bookkeeping string with an honest fallback, never passing it to the client (#70)", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      const toolUseResponse = {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "call_1", name: "search_news", input: { symbol: "AAPL" } }],
      };
      // The final forced round still echoes the internal bookkeeping shape as if it were
      // a real answer -- the exact failure mode #70 is about.
      const leakedBookkeepingResponse = {
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: 'Requested tool call(s): [{"name":"get_quote","arguments":{"symbol":"AAPL"}}]',
          },
        ],
      };
      const fetchMock = mockAgenticFetch([
        toolUseResponse,
        toolUseResponse,
        toolUseResponse,
        toolUseResponse,
        toolUseResponse,
        leakedBookkeepingResponse,
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const { db } = await import("../db.js");
      const handler = getHandler("/chat");
      const req = { body: { messages: [{ role: "user", content: "keep digging" }] } } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      // Confirms this reached the forced tools-omitted final round, matching the real
      // round-cap-plus-leaked-bookkeeping scenario from #70, not just any early exit.
      const providerCalls = fetchMock.mock.calls.filter((c: any) => String(c[0]).includes("api.anthropic.com"));
      expect(providerCalls).toHaveLength(6);
      const lastBody = JSON.parse(providerCalls.at(-1)[1].body);
      expect(lastBody.tools).toBeUndefined();

      // The client never sees the raw bookkeeping string.
      const jsonArg = (res.json as any).mock.calls[0][0];
      expect(jsonArg.text).not.toMatch(/Requested tool call\(s\)/i);
      expect(jsonArg.text).toBeTruthy();

      // The Audit Log still records what the model actually said, honestly.
      const row = db.prepare("SELECT detail FROM audit_log WHERE event_type = 'chat' ORDER BY id DESC LIMIT 1").get() as {
        detail: string;
      };
      const detail = JSON.parse(row.detail);
      expect(detail.response).toMatch(/Requested tool call\(s\)/i);
      expect(detail.userFacingFallback).toBe(jsonArg.text);
    });

    it("does not misdetect prose that merely mentions the bookkeeping phrase as a leak (#70)", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      // Legitimate prose that names the internal phrase without reproducing the actual
      // call-array JSON shape right after it -- must pass through untouched.
      const genuineAnswer = {
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: 'Internally, the assistant logs a line like "Requested tool call(s):" between rounds, but that is just bookkeeping.',
          },
        ],
      };
      vi.stubGlobal("fetch", mockAgenticFetch([genuineAnswer]));
      const handler = getHandler("/chat");
      const req = {
        body: { messages: [{ role: "user", content: "How does your tool-call bookkeeping work?" }] },
      } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      expect(res.json).toHaveBeenCalledWith({ text: genuineAnswer.content[0].text });
    });

    it("falls back to an honest message instead of returning silent empty text as the final answer (#70)", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      const fetchMock = mockAgenticFetch([
        { stop_reason: "end_turn", content: [] }, // no text, no tool_use: a silent non-answer
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const handler = getHandler("/chat");
      const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      const jsonArg = (res.json as any).mock.calls[0][0];
      expect(jsonArg.text).toBeTruthy();
      expect(jsonArg.text).not.toBe("");
      // No tool was ever attempted this turn, so the fallback must not blame a "lookup" or
      // rate limit -- that would be a misleading explanation for a plain empty answer (#70).
      expect(jsonArg.text).not.toMatch(/lookup|rate limit/i);
    });

    it("blames the lookup, not a generic non-answer, when empty text follows an attempted tool call (#70)", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      const fetchMock = mockAgenticFetch([
        {
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "call_1", name: "search_news", input: {} }],
        },
        { stop_reason: "end_turn", content: [] }, // follow-up comes back empty after a real tool call
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const handler = getHandler("/chat");
      const req = { body: { messages: [{ role: "user", content: "keep digging" }] } } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      const jsonArg = (res.json as any).mock.calls[0][0];
      expect(jsonArg.text).toMatch(/lookup/i);
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

    it("chains get_quote with search_news in the same round to answer one research question (#20)", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      const fetchMock = mockAgenticFetch([
        {
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "Let me pull the quote and the news." },
            { type: "tool_use", id: "call_1", name: "get_quote", input: { symbol: "AAPL" } },
            { type: "tool_use", id: "call_2", name: "search_news", input: { symbol: "AAPL" } },
          ],
        },
        { stop_reason: "end_turn", content: [{ type: "text", text: "AAPL is at $150, up 0.67%, with stable headlines." }] },
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const handler = getHandler("/chat");
      const req = { body: { messages: [{ role: "user", content: "How's AAPL doing right now?" }] } } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      expect(res.json).toHaveBeenCalledWith({
        text: "AAPL is at $150, up 0.67%, with stable headlines.",
        toolCalls: [
          { name: "get_quote", arguments: { symbol: "AAPL" } },
          { name: "search_news", arguments: { symbol: "AAPL" } },
        ],
      });

      // Both tool results -- the real quote (via the shared getQuotes waterfall) and the
      // real headline (via the shared news-search plumbing) -- are folded back in one round.
      const providerCalls = fetchMock.mock.calls.filter((c: any) => String(c[0]).includes("api.anthropic.com"));
      expect(providerCalls).toHaveLength(2);
      const secondBody = JSON.parse(providerCalls[1][1].body);
      const toolResultsMessage = secondBody.messages.at(-1).content;
      expect(toolResultsMessage).toContain("Tool results");
      expect(toolResultsMessage).toContain('"price":150');
      expect(toolResultsMessage).toContain("Example headline");
    });

    it("executes the option-chain tool, returning the chain shape for the model to summarize", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      const fetchMock = mockAgenticFetch([
        {
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "call_1", name: "get_option_chain", input: { symbol: "AAPL" } }],
        },
        { stop_reason: "end_turn", content: [{ type: "text", text: "Here's the AAPL chain." }] },
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const handler = getHandler("/chat");
      const req = { body: { messages: [{ role: "user", content: "Show me AAPL's options chain" }] } } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      expect(res.json).toHaveBeenCalledWith({
        text: "Here's the AAPL chain.",
        toolCalls: [{ name: "get_option_chain", arguments: { symbol: "AAPL" } }],
      });

      const providerCalls = fetchMock.mock.calls.filter((c: any) => String(c[0]).includes("api.anthropic.com"));
      const secondBody = JSON.parse(providerCalls[1][1].body);
      expect(secondBody.messages.at(-1).content).toContain("Tool results");
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
