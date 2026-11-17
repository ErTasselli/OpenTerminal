import { afterEach, describe, expect, it, vi } from "vitest";
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

type Reply = { status?: number; json?: unknown; text?: string };

/**
 * Route fetch by URL: Yahoo charts answer for `known` symbols, and `extra`
 * handlers (matched by URL substring) answer anything else; the rest 404s.
 * Every requested URL is recorded so tests can assert what was NOT called.
 */
function stubNetwork(known: string[], extra: Array<[string, Reply]> = []) {
  const fetchMock = vi.fn(async (url: string) => {
    const reply = (r: Reply) => ({
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.json ?? JSON.parse(r.text ?? "null"),
      text: async () => r.text ?? JSON.stringify(r.json ?? null),
    });
    const chart = /\/v8\/finance\/chart\/([^?]+)/.exec(url);
    const sym = chart ? decodeURIComponent(chart[1]) : null;
    if (sym && known.includes(sym)) {
      return reply({
        json: {
          chart: {
            result: [
              {
                meta: { symbol: sym, regularMarketPrice: 44, chartPreviousClose: 45, currency: "BRL" },
                timestamp: [1794837000],
                indicators: { quote: [{ open: [45], high: [45.1], low: [43.9], close: [44], volume: [100] }] },
              },
            ],
          },
        },
      });
    }
    const hit = extra.find(([needle]) => url.includes(needle));
    return reply(hit ? hit[1] : { status: 404, text: "" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    urls: () => fetchMock.mock.calls.map(([u]) => String(u)),
  };
}

async function call(path: string, req: Record<string, unknown>) {
  const res = fakeRes();
  await getHandler(path)({ params: {}, query: {}, path, ...req } as unknown as Request, res, () => {});
  return {
    status: (res.status as any).mock.calls[0]?.[0] ?? 200,
    body: (res.json as any).mock.calls[0]?.[0],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("B3 quotes and charts", () => {
  it("charts a bare B3 ticker through its .SA listing, without trying Nasdaq", async () => {
    const net = stubNetwork(["VALE3.SA"]);
    const { status, body } = await call("/history/:symbol", { params: { symbol: "vale3" }, query: { range: "6M" } });
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(net.urls().some((u) => u.includes("/chart/VALE3.SA?"))).toBe(true);
    expect(net.urls().some((u) => u.includes("nasdaq.com"))).toBe(false);
  });

  it("quotes a bare B3 ticker via .SA, answers under the requested symbol, and skips Nasdaq", async () => {
    const net = stubNetwork(["ITUB4.SA", "BBDC4.SA"]);
    const { status, body } = await call("/quotes", { query: { symbols: "ITUB4,BBDC4.SA" } });
    expect(status).toBe(200);
    expect(body.map((q: any) => q.symbol).sort()).toEqual(["BBDC4.SA", "ITUB4"]);
    expect(net.urls().some((u) => u.includes("nasdaq.com"))).toBe(false);
  });
});

describe("US-only data for B3 symbols", () => {
  it.each([
    ["/options/:symbol", "Options data"],
    ["/earnings-history/:symbol", "Earnings history"],
    ["/insider/:symbol", "Insider trading data (SEC Form 4)"],
  ])("%s answers 404 with a clear message and no provider calls", async (path, what) => {
    const net = stubNetwork([]);
    const { status, body } = await call(path, { params: { symbol: "PETR4.SA" } });
    expect(status).toBe(404);
    expect(body).toEqual({ error: `${what} is only available for US listings.` });
    expect(net.urls()).toEqual([]);
  });

  it("does not reject index options (Yahoo serves ^SPX and ^VIX chains)", async () => {
    const net = stubNetwork([]);
    const { status, body } = await call("/options/:symbol", { params: { symbol: "^SPX" } });
    // Providers are tried (and fail here, since the network is stubbed) instead
    // of the request being refused as a foreign listing.
    expect(status).not.toBe(404);
    expect(body?.error ?? "").not.toContain("only available for US listings");
    expect(net.urls().length).toBeGreaterThan(0);
  });

  it("/short-volume answers null without downloading the FINRA file", async () => {
    const net = stubNetwork([]);
    const { status, body } = await call("/short-volume/:symbol", { params: { symbol: "PETR4" } });
    expect(status).toBe(200);
    expect(body).toBeNull();
    expect(net.urls()).toEqual([]);
  });
});

describe("B3 news", () => {
  it("searches Google News' Brazilian edition by the bare ticker", async () => {
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Petrobras sobe</title><link>https://ex.com/1</link></item></channel></rss>`;
    const net = stubNetwork([], [["news.google.com", { text: rss }]]);
    const { body } = await call("/news", { query: { symbol: "MGLU3.SA" } });
    const brazilian = net
      .urls()
      .filter((u) => u.includes("news.google.com"))
      .map((u) => new URL(u))
      .filter((u) => u.searchParams.get("gl") === "BR");
    expect(brazilian).toHaveLength(1);
    expect(brazilian[0].searchParams.get("q")).toBe("MGLU3");
    expect(brazilian[0].searchParams.get("hl")).toBe("pt-BR");
    expect(body.map((i: any) => i.title)).toEqual(["Petrobras sobe"]);
    expect(net.urls().some((u) => u.includes("feeds.finance.yahoo.com") && u.includes("s=MGLU3.SA"))).toBe(true);
  });
});

describe("Brazil macro and market scans", () => {
  it("/macro?region=br returns Selic, IPCA 12m and the Brazilian indexes", async () => {
    stubNetwork(
      ["^BVSP", "IFIX.SA", "SMAL11.SA", "USDBRL=X", "EURBRL=X"],
      [
        ["bcdata.sgs.432/", { json: [{ data: "16/11/2026", valor: "13.75" }] }],
        ["bcdata.sgs.13522/", { json: [{ data: "01/10/2026", valor: "4.63" }] }],
      ]
    );
    const { status, body } = await call("/macro", { query: { region: "br" } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ yields: [], vix: null, policyRate: 13.75, inflation: 4.63 });
    expect(body.indexes.map((i: any) => i.label)).toEqual(
      expect.arrayContaining(["Ibovespa", "USD/BRL", "EUR/BRL", "IFIX (real estate funds)", "Small Caps (SMAL11)"])
    );
  });

  it("/screener?market=br serves the B3 scan with .SA symbols", async () => {
    const net = stubNetwork(
      [],
      [
        [
          "scanner.tradingview.com/brazil/scan",
          { json: { data: [{ s: "BMFBOVESPA:WEGE3", d: ["WEG SA", 50, 1, 215e9, "Producer Manufacturing", 5e6, "stock"] }] } },
        ],
      ]
    );
    const { status, body } = await call("/screener", { query: { market: "br" } });
    expect(status).toBe(200);
    expect(body.map((r: any) => r.symbol)).toEqual(["WEGE3.SA"]);
    expect(net.urls()).toEqual(["https://scanner.tradingview.com/brazil/scan"]);
  });
});
