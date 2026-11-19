import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { secEdgarFilings } from "./news.js";

// The CIK map is cached by a fixed key in `cache.ts`, so whichever test runs first
// locks it in for the rest of this file — every symbol used below must be listed here.
const ALL_TEST_TICKERS: Record<string, number> = {
  SECT1: 320193,
  SECT2: 111111,
  SECT3: 222222,
  SECT4: 333333,
};

function tickerMapResponse() {
  return {
    ok: true,
    json: async () =>
      Object.fromEntries(
        Object.entries(ALL_TEST_TICKERS).map(([ticker, cik], i) => [
          String(i),
          { cik_str: cik, ticker, title: ticker },
        ])
      ),
  };
}

function atomFeed(entries: Array<{ title: string; link: string; updated: string }>): string {
  const entriesXml = entries
    .map(
      (e) =>
        `<entry><title>${e.title}</title><link href="${e.link}" rel="alternate" type="text/html" /><updated>${e.updated}</updated></entry>`
    )
    .join("");
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entriesXml}</feed>`;
}

describe("secEdgarFilings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a known symbol's CIK and maps atom entries to NewsItem", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("company_tickers.json")) {
        return tickerMapResponse();
      }
      if (String(url).includes("browse-edgar")) {
        expect(String(url)).toContain("CIK=0000320193");
        return {
          ok: true,
          text: async () =>
            atomFeed([
              {
                title: "10-Q - Quarterly report",
                link: "https://www.sec.gov/Archives/edgar/data/320193/example-index.htm",
                updated: "2026-10-16T16:29:07-04:00",
              },
            ]),
        };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const items = await secEdgarFilings("SECT1");

    expect(items).toEqual([
      {
        title: "10-Q - Quarterly report",
        link: "https://www.sec.gov/Archives/edgar/data/320193/example-index.htm",
        publisher: "SEC EDGAR",
        publishedAt: new Date("2026-10-16T16:29:07-04:00").toISOString(),
        symbol: "SECT1",
      },
    ]);
  });

  it("returns an empty array for an unresolvable ticker without fetching the filing feed", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("company_tickers.json")) {
        return tickerMapResponse();
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const items = await secEdgarFilings("NOPE_NO_MATCH");

    expect(items).toEqual([]);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("browse-edgar"))).toBe(false);
  });

  it("throws when the filing feed fetch is not ok, so the caller can drop this source", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("company_tickers.json")) {
        return tickerMapResponse();
      }
      return { ok: false, status: 503 };
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(secEdgarFilings("SECT2")).rejects.toThrow();
  });

  it("fetches the ticker map once and reuses it across symbols", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("company_tickers.json")) {
        return tickerMapResponse();
      }
      return { ok: true, text: async () => atomFeed([]) };
    });
    vi.stubGlobal("fetch", fetchMock);

    await secEdgarFilings("SECT3");
    const tickerCallsAfterFirst = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("company_tickers.json")
    ).length;
    await secEdgarFilings("SECT4");
    const tickerCallsAfterSecond = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("company_tickers.json")
    ).length;

    expect(tickerCallsAfterFirst).toBe(tickerCallsAfterSecond);
  });
});

// FETCH_TIMEOUT_MS is read from PROVIDER_FETCH_TIMEOUT_MS once, at module load, so the
// env var has to be set before this module is (re-)imported -- same pattern used by
// llm/imageHistoryCap.test.ts for a module-load-time env override.
describe("fetch timeout", () => {
  let topNewsFast: (typeof import("./news.js"))["topNews"];
  let secEdgarFilingsFast: (typeof import("./news.js"))["secEdgarFilings"];

  beforeAll(async () => {
    process.env.PROVIDER_FETCH_TIMEOUT_MS = "50";
    vi.resetModules();
    ({ topNews: topNewsFast, secEdgarFilings: secEdgarFilingsFast } = await import("./news.js"));
  });

  afterAll(() => {
    delete process.env.PROVIDER_FETCH_TIMEOUT_MS;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A fetch that never settles on its own -- only rejects once its abort signal fires. */
  function hangingFetch(_url: string, opts?: { signal?: AbortSignal }) {
    return new Promise((_resolve, reject) => {
      opts?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  }

  const GOOD_RSS =
    `<?xml version="1.0"?><rss><channel><item>` +
    `<title>Market rallies</title><link>https://example.com/a</link>` +
    `</item></channel></rss>`;

  it("times out a hung RSS source without delaying a source that responds (generic fetch call site)", async () => {
    const fetchMock = vi.fn((url: string, opts?: { signal?: AbortSignal }) => {
      if (String(url).includes("hangs-forever")) return hangingFetch(url, opts);
      return Promise.resolve({ ok: true, text: async () => GOOD_RSS });
    });
    vi.stubGlobal("fetch", fetchMock);

    const start = Date.now();
    const [hung, good] = await Promise.allSettled([
      topNewsFast("hangs-forever query"),
      topNewsFast("good query"),
    ]);
    const elapsed = Date.now() - start;

    // Generous upper bound vs. the 50ms timeout -- just needs to prove this returned
    // in roughly the timeout window, not after Node's effectively-unbounded default.
    expect(elapsed).toBeLessThan(2000);
    expect(hung.status).toBe("rejected");
    expect(good.status).toBe("fulfilled");
    expect(good.status === "fulfilled" && good.value).toEqual([
      {
        title: "Market rallies",
        link: "https://example.com/a",
        publisher: "Google News",
        publishedAt: null,
        symbol: null,
      },
    ]);
  });

  it("times out a hung SEC filing feed fetch (SEC-flavored fetch call site)", async () => {
    const cikMap = { "0": { cik_str: 888888, ticker: "SECHANG", title: "SECHANG" } };
    const fetchMock = vi.fn((url: string, opts?: { signal?: AbortSignal }) => {
      if (String(url).includes("company_tickers.json")) {
        return Promise.resolve({ ok: true, json: async () => cikMap });
      }
      if (String(url).includes("browse-edgar")) return hangingFetch(url, opts);
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const start = Date.now();
    await expect(secEdgarFilingsFast("SECHANG")).rejects.toThrow();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(2000);
  });
});
