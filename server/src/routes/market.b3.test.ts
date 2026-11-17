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

describe("bare B3 tickers", () => {
  /** Only Yahoo's chart endpoint answers, and only for the listed symbols. */
  function stubYahooChart(known: string[]) {
    const fetchMock = vi.fn(async (url: string) => {
      const m = /\/v8\/finance\/chart\/([^?]+)/.exec(url);
      const sym = m ? decodeURIComponent(m[1]) : null;
      if (!sym || !known.includes(sym)) return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
      const body = {
        chart: {
          result: [
            {
              meta: { symbol: sym, regularMarketPrice: 44, chartPreviousClose: 45, currency: "BRL" },
              timestamp: [1794837000],
              indicators: { quote: [{ open: [45], high: [45.1], low: [43.9], close: [44], volume: [100] }] },
            },
          ],
        },
      };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("charts a bare B3 ticker through its .SA listing", async () => {
    const fetchMock = stubYahooChart(["VALE3.SA"]);
    try {
      const res = fakeRes();
      await getHandler("/history/:symbol")(
        { params: { symbol: "vale3" }, query: { range: "6M" }, path: "/history/vale3" } as unknown as Request,
        res,
        () => {}
      );
      expect(res.status).not.toHaveBeenCalled();
      expect((res.json as any).mock.calls[0][0]).toHaveLength(1);
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/chart/VALE3.SA?"))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("quotes a bare B3 ticker via .SA but answers under the requested symbol", async () => {
    stubYahooChart(["ITUB4.SA", "BBDC4.SA"]);
    try {
      const res = fakeRes();
      await getHandler("/quotes")(
        { query: { symbols: "ITUB4,BBDC4.SA" }, path: "/quotes" } as unknown as Request,
        res,
        () => {}
      );
      expect(res.status).not.toHaveBeenCalled();
      const symbols = (res.json as any).mock.calls[0][0].map((q: any) => q.symbol).sort();
      expect(symbols).toEqual(["BBDC4.SA", "ITUB4"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
