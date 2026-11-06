import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const { aiRouter, resetAiUsage, tokensUsedToday } = await import("./ai.js");

function fakeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

const handler = (aiRouter as any).stack.find((l: any) => l.route?.path === "/chat").route.stack[0]
  .handle as (req: Request, res: Response) => Promise<unknown>;

async function chat(body: unknown) {
  const res = fakeRes();
  await handler({ body } as Request, res);
  return res;
}

const ok = (input: number, output: number) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: "hi" }],
  usage: { input_tokens: input, output_tokens: output },
});

const user = (content: string) => ({ role: "user", content });

beforeEach(() => {
  resetAiUsage();
  create.mockReset().mockResolvedValue(ok(100, 50));
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /chat validation", () => {
  it("rejects an empty messages array", async () => {
    const res = await chat({ messages: [] });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects roles other than user/assistant (no system injection)", async () => {
    const res = await chat({ messages: [{ role: "system", content: "x" }] });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a message longer than AI_MAX_MESSAGE_CHARS", async () => {
    vi.stubEnv("AI_MAX_MESSAGE_CHARS", "10");
    const res = await chat({ messages: [user("x".repeat(11))] });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects more messages than AI_MAX_MESSAGES", async () => {
    vi.stubEnv("AI_MAX_MESSAGES", "2");
    const res = await chat({ messages: [user("a"), user("b"), user("c")] });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects a context larger than AI_MAX_CONTEXT_CHARS with 413", async () => {
    vi.stubEnv("AI_MAX_CONTEXT_CHARS", "20");
    const res = await chat({ messages: [user("hi")], context: { blob: "x".repeat(50) } });
    expect(res.status).toHaveBeenCalledWith(413);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("POST /chat spend limits", () => {
  it("sends AI_MAX_TOKENS as max_tokens (default 16000)", async () => {
    await chat({ messages: [user("hi")] });
    expect(create.mock.calls[0][0].max_tokens).toBe(16000);
    vi.stubEnv("AI_MAX_TOKENS", "2048");
    await chat({ messages: [user("hi")] });
    expect(create.mock.calls[1][0].max_tokens).toBe(2048);
  });

  it("counts billed tokens and blocks with 429 once AI_DAILY_TOKEN_LIMIT is reached", async () => {
    vi.stubEnv("AI_DAILY_TOKEN_LIMIT", "200");
    await chat({ messages: [user("1")] }); // 150 used
    expect(tokensUsedToday()).toBe(150);
    await chat({ messages: [user("2")] }); // 300 used, over the cap
    const res = await chat({ messages: [user("3")] });
    expect(res.status).toHaveBeenCalledWith(429);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("has no daily cap when AI_DAILY_TOKEN_LIMIT is unset", async () => {
    create.mockResolvedValue(ok(1_000_000, 1_000_000));
    await chat({ messages: [user("1")] });
    const res = await chat({ messages: [user("2")] });
    expect(res.status).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
  });
});
