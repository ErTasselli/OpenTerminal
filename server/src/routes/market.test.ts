import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { marketRouter } from "./market.js";

function fakeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function getHandler(path: string) {
  const layer = (marketRouter as any).stack.find((l: any) => l.route?.path === path);
  if (!layer) throw new Error(`no route registered for ${path}`);
  return layer.route.stack[0].handle as (req: Request, res: Response, next: () => void) => unknown;
}

describe("GET /crypto/orderbook/:symbol", () => {
  it("rejects a symbol outside the supported crypto whitelist with 400, before touching the network", async () => {
    const handler = getHandler("/crypto/orderbook/:symbol");
    const req = { params: { symbol: "AAA&limit=5000" } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "unsupported crypto symbol" });
  });

  it("accepts a whitelisted symbol (case-insensitive) and proceeds past validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bids: [], asks: [] }) })
    );
    try {
      const handler = getHandler("/crypto/orderbook/:symbol");
      const req = { params: { symbol: "btc" } } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      expect(res.status).not.toHaveBeenCalledWith(400);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("GET /news", () => {
  const rss = (title: string) =>
    `<?xml version="1.0"?><rss version="2.0"><channel><item><title>${title}</title>` +
    `<link>https://example.com/${encodeURIComponent(title)}</link></item></channel></rss>`;

  async function newsFor(query: Record<string, string>) {
    const fetchMock = vi.fn(async (url: string) => {
      const host = new URL(url).hostname;
      const title =
        host === "feeds.finance.yahoo.com" ? "Yahoo Bitcoin AAPL headline"
        : host === "news.google.com" ? "Google Bitcoin AAPL headline"
        : `${host} Bitcoin headline`;
      return { ok: true, text: async () => rss(title) };
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const res = fakeRes();
      await getHandler("/news")({ query } as unknown as Request, res, () => {});
      const hosts = new Set(fetchMock.mock.calls.map(([u]) => new URL(u as string).hostname));
      const googleQueries = fetchMock.mock.calls
        .map(([u]) => new URL(u as string))
        .filter((u) => u.hostname === "news.google.com")
        .map((u) => u.searchParams.get("q"));
      return { hosts, googleQueries, body: (res.json as any).mock.calls[0][0] };
    } finally {
      vi.unstubAllGlobals();
    }
  }

  const CRYPTO_HOSTS = ["www.coindesk.com", "cointelegraph.com", "decrypt.co"];

  it("adds the crypto publishers for a crypto ticker and searches Google by coin name", async () => {
    const { hosts, googleQueries, body } = await newsFor({ symbol: "btc" });
    for (const h of CRYPTO_HOSTS) expect(hosts.has(h)).toBe(true);
    expect(hosts.has("feeds.finance.yahoo.com")).toBe(true);
    expect(googleQueries).toEqual(["Bitcoin crypto"]);
    expect(body.map((i: any) => i.publisher)).toEqual(
      expect.arrayContaining(["CoinDesk", "Cointelegraph", "Decrypt", "Yahoo Finance", "Google News"])
    );
  });

  it("leaves stock tickers on Yahoo + Google only", async () => {
    const { hosts, googleQueries } = await newsFor({ symbol: "AAPL" });
    for (const h of CRYPTO_HOSTS) expect(hosts.has(h)).toBe(false);
    expect(googleQueries).toEqual(["AAPL stock"]);
  });

  it("includes crypto publishers in the global feed", async () => {
    const { hosts, body } = await newsFor({});
    for (const h of CRYPTO_HOSTS) expect(hosts.has(h)).toBe(true);
    expect(body.some((i: any) => i.publisher === "CoinDesk")).toBe(true);
  });
});
