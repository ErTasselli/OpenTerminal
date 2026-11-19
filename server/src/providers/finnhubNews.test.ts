import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { companyNews, marketNews } from "./finnhubNews.js";

const SAMPLE_ARTICLES = [
  {
    category: "company",
    datetime: 1795000000,
    headline: "Apple unveils new product",
    id: 1,
    image: "https://example.com/img.png",
    related: "AAPL",
    source: "Reuters",
    summary: "Apple announced something.",
    url: "https://example.com/apple-news",
  },
  {
    category: "company",
    datetime: 1795000100,
    headline: "Apple earnings beat estimates",
    id: 2,
    image: "",
    related: "AAPL",
    source: "Bloomberg",
    summary: "Apple beat estimates.",
    url: "https://example.com/apple-earnings",
  },
];

// One item missing `headline`, one missing `url` -- both must be filtered out.
const PARTIAL_ARTICLES = [
  { datetime: 1795000000, headline: "", source: "Reuters", url: "https://example.com/a" },
  { datetime: 1795000000, headline: "No URL here", source: "Reuters", url: "" },
  {
    datetime: 1795000000,
    headline: "Valid article",
    source: "Reuters",
    url: "https://example.com/valid",
  },
];

function jsonResponse(ok: boolean, status: number, body: unknown) {
  return { ok, status, json: async () => body };
}

describe("finnhubNews", () => {
  const ORIGINAL_KEY = process.env.FINNHUB_API_KEY;

  beforeEach(() => {
    process.env.FINNHUB_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_KEY === undefined) delete process.env.FINNHUB_API_KEY;
    else process.env.FINNHUB_API_KEY = ORIGINAL_KEY;
  });

  describe("companyNews", () => {
    it("throws before fetching when FINNHUB_API_KEY is not set", async () => {
      delete process.env.FINNHUB_API_KEY;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(companyNews("AAPL")).rejects.toThrow(/FINNHUB_API_KEY/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("maps a happy-path response to NewsItem[], scoped to the requested symbol", async () => {
      const fetchMock = vi.fn(async (url: string) => {
        expect(String(url)).toContain("company-news");
        expect(String(url)).toContain("symbol=AAPL");
        expect(String(url)).toContain("token=test-key");
        return jsonResponse(true, 200, SAMPLE_ARTICLES);
      });
      vi.stubGlobal("fetch", fetchMock);

      const items = await companyNews("AAPL");

      expect(items).toEqual([
        {
          title: "Apple unveils new product",
          link: "https://example.com/apple-news",
          publisher: "Reuters",
          publishedAt: new Date(1795000000 * 1000).toISOString(),
          symbol: "AAPL",
        },
        {
          title: "Apple earnings beat estimates",
          link: "https://example.com/apple-earnings",
          publisher: "Bloomberg",
          publishedAt: new Date(1795000100 * 1000).toISOString(),
          symbol: "AAPL",
        },
      ]);
    });

    it("filters out articles missing headline or url", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(true, 200, PARTIAL_ARTICLES)));

      const items = await companyNews("AAPL");

      expect(items).toEqual([
        {
          title: "Valid article",
          link: "https://example.com/valid",
          publisher: "Reuters",
          publishedAt: new Date(1795000000 * 1000).toISOString(),
          symbol: "AAPL",
        },
      ]);
    });

    it("maps an empty array response to an empty NewsItem[], not an error", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(true, 200, [])));

      await expect(companyNews("AAPL")).resolves.toEqual([]);
    });

    it("throws on a non-2xx response", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(false, 503, {})));

      await expect(companyNews("AAPL")).rejects.toThrow(/503/);
    });
  });

  describe("marketNews", () => {
    it("throws before fetching when FINNHUB_API_KEY is not set", async () => {
      delete process.env.FINNHUB_API_KEY;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(marketNews()).rejects.toThrow(/FINNHUB_API_KEY/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("maps a happy-path response to NewsItem[] with a null symbol", async () => {
      const fetchMock = vi.fn(async (url: string) => {
        expect(String(url)).toContain("/news?category=general");
        expect(String(url)).toContain("token=test-key");
        return jsonResponse(true, 200, SAMPLE_ARTICLES);
      });
      vi.stubGlobal("fetch", fetchMock);

      const items = await marketNews();

      expect(items).toEqual([
        {
          title: "Apple unveils new product",
          link: "https://example.com/apple-news",
          publisher: "Reuters",
          publishedAt: new Date(1795000000 * 1000).toISOString(),
          symbol: null,
        },
        {
          title: "Apple earnings beat estimates",
          link: "https://example.com/apple-earnings",
          publisher: "Bloomberg",
          publishedAt: new Date(1795000100 * 1000).toISOString(),
          symbol: null,
        },
      ]);
    });

    it("maps an empty array response to an empty NewsItem[], not an error", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(true, 200, [])));

      await expect(marketNews()).resolves.toEqual([]);
    });

    it("throws on a non-2xx response", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(false, 500, {})));

      await expect(marketNews()).rejects.toThrow(/500/);
    });
  });
});

// FETCH_TIMEOUT_MS is read from PROVIDER_FETCH_TIMEOUT_MS once, at module load, so the
// env var has to be set before this module is (re-)imported -- same pattern used by
// news.test.ts and ecb.test.ts.
describe("fetch timeout", () => {
  let companyNewsFast: (typeof import("./finnhubNews.js"))["companyNews"];
  let marketNewsFast: (typeof import("./finnhubNews.js"))["marketNews"];
  const ORIGINAL_TIMEOUT = process.env.PROVIDER_FETCH_TIMEOUT_MS;
  const ORIGINAL_KEY = process.env.FINNHUB_API_KEY;

  beforeEach(async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    process.env.PROVIDER_FETCH_TIMEOUT_MS = "50";
    vi.resetModules();
    ({ companyNews: companyNewsFast, marketNews: marketNewsFast } = await import("./finnhubNews.js"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_TIMEOUT === undefined) delete process.env.PROVIDER_FETCH_TIMEOUT_MS;
    else process.env.PROVIDER_FETCH_TIMEOUT_MS = ORIGINAL_TIMEOUT;
    if (ORIGINAL_KEY === undefined) delete process.env.FINNHUB_API_KEY;
    else process.env.FINNHUB_API_KEY = ORIGINAL_KEY;
    vi.resetModules();
  });

  /** A fetch that never settles on its own -- only rejects once its abort signal fires. */
  function hangingFetch(_url: string, opts?: { signal?: AbortSignal }) {
    return new Promise((_resolve, reject) => {
      opts?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  }

  it("fails fast on a hung companyNews fetch instead of hanging forever", async () => {
    vi.stubGlobal("fetch", vi.fn(hangingFetch));

    const start = Date.now();
    await expect(companyNewsFast("AAPL")).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("fails fast on a hung marketNews fetch instead of hanging forever", async () => {
    vi.stubGlobal("fetch", vi.fn(hangingFetch));

    const start = Date.now();
    await expect(marketNewsFast()).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
