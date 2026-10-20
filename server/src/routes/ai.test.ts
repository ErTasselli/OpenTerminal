import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { aiRouter } from "./ai.js";
import { pickProvider } from "../ai/index.js";
import { resetOllamaCache } from "../ai/ollama.js";

function fakeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function getHandler(method: string, path: string) {
  const layer = (aiRouter as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method]
  );
  if (!layer) throw new Error(`no route registered for ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle as (req: Request, res: Response, next: () => void) => unknown;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function payload(res: Response): any {
  return (res.json as any).mock.calls[0][0];
}

beforeEach(() => {
  resetOllamaCache();
  delete process.env.OLLAMA_MODEL;
});

describe("GET /ai/providers", () => {
  it("offers Claude and Ollama, with Claude as the default", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ models: [] })));
    try {
      const handler = getHandler("get", "/providers");
      const res = fakeRes();

      await handler({} as Request, res, () => {});

      const body = payload(res);
      expect(body.defaultProvider).toBe("anthropic");
      expect(body.providers.map((p: any) => p.id)).toEqual(["anthropic", "ollama"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("GET /ai/models", () => {
  it("lists the local models and skips the ones that can't chat", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          models: [
            { name: "llama3.2:latest", capabilities: ["completion"] },
            { name: "nomic-embed-text:latest", capabilities: ["embedding"] },
            { name: "whisper-tiny:latest", capabilities: ["completion"] },
          ],
        })
      )
    );
    try {
      const handler = getHandler("get", "/models");
      const res = fakeRes();

      await handler({ query: { provider: "ollama" } } as unknown as Request, res, () => {});

      const body = payload(res);
      expect(body.models).toEqual(["llama3.2:latest"]);
      expect(body.defaultModel).toBe("llama3.2:latest");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects an unknown provider", async () => {
    const handler = getHandler("get", "/models");
    const res = fakeRes();

    await handler({ query: { provider: "openai" } } as unknown as Request, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("POST /ai/chat", () => {
  it("answers through the selected local model", async () => {
    const fetchMock = vi.fn(async (url: any) => {
      if (String(url).endsWith("/api/chat")) {
        return jsonResponse({ message: { role: "assistant", content: "42" } });
      }
      return jsonResponse({ models: [{ name: "llama3.2:latest", capabilities: ["completion"] }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const handler = getHandler("post", "/chat");
      const res = fakeRes();

      await handler(
        {
          body: {
            messages: [{ role: "user", content: "hi" }],
            provider: "ollama",
            model: "llama3.2:latest",
          },
        } as unknown as Request,
        res,
        () => {}
      );

      expect(payload(res)).toEqual({
        text: "42",
        provider: "ollama",
        model: "llama3.2:latest",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects an unknown provider before calling any backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const handler = getHandler("post", "/chat");
      const res = fakeRes();

      await handler(
        { body: { messages: [{ role: "user", content: "hi" }], provider: "openai" } } as unknown as Request,
        res,
        () => {}
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("requires at least one message", async () => {
    const handler = getHandler("post", "/chat");
    const res = fakeRes();

    await handler({ body: { messages: [] } } as unknown as Request, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("reports an unreachable Ollama as unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );
    try {
      const handler = getHandler("post", "/chat");
      const res = fakeRes();

      await handler(
        {
          body: {
            messages: [{ role: "user", content: "hi" }],
            provider: "ollama",
            model: "llama3.2:latest",
          },
        } as unknown as Request,
        res,
        () => {}
      );

      expect(res.status).toHaveBeenCalledWith(503);
      expect(payload(res).error).toMatch(/not reachable/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("pickProvider", () => {
  it("falls back to Claude when the client doesn't name a backend", () => {
    expect(pickProvider(undefined)).toBe("anthropic");
    expect(pickProvider("")).toBe("anthropic");
  });

  it("keeps a known backend and rejects anything else", () => {
    expect(pickProvider("ollama")).toBe("ollama");
    expect(pickProvider("anthropic")).toBe("anthropic");
    expect(pickProvider("openai")).toBeNull();
  });
});
