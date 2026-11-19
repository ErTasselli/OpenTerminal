import type { NewsItem } from "./news.js";

// Per-request timeout for every outbound fetch in this module -- same pattern (and same
// env override) as news.ts's FETCH_TIMEOUT_MS: one hanging Finnhub call must not block
// the whole /api/news response, which waits on every source via Promise.allSettled with
// no bound on a single source's latency.
const FETCH_TIMEOUT_MS = Number(process.env.PROVIDER_FETCH_TIMEOUT_MS) || 9000;

/**
 * Throws a clear, specific error when FINNHUB_API_KEY isn't set, instead of attempting
 * any fetch. Mirrors the hasCredentials()/missingCredentialHint() convention used by
 * llm/anthropic.ts and llm/ollama.ts (see llm/types.ts's LlmProvider), adapted to this
 * module's plain-function shape: companyNews/marketNews call this first so a missing
 * key fails loudly and immediately. The /news route's Promise.allSettled fanout then
 * turns that thrown error into "this source is dropped," not a broken response.
 */
function requireApiKey(): string {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("finnhub-news: FINNHUB_API_KEY not set");
  return key;
}

type FinnhubArticle = {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
};

function toNewsItem(article: FinnhubArticle, symbol: string | null): NewsItem | null {
  if (!article?.headline || !article?.url) return null;
  return {
    title: article.headline,
    link: article.url,
    publisher: article.source ?? "Finnhub",
    publishedAt: typeof article.datetime === "number" ? new Date(article.datetime * 1000).toISOString() : null,
    symbol,
  };
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function companyNews(symbol: string): Promise<NewsItem[]> {
  const key = requireApiKey();
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  const url =
    `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}` +
    `&from=${toDateString(from)}&to=${toDateString(to)}&token=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`finnhub-news: company-news ${res.status} for ${symbol}`);
  const articles = (await res.json()) as FinnhubArticle[];
  return (Array.isArray(articles) ? articles : [])
    .map((a) => toNewsItem(a, symbol))
    .filter((i): i is NewsItem => i !== null);
}

export async function marketNews(): Promise<NewsItem[]> {
  const key = requireApiKey();
  const url = `https://finnhub.io/api/v1/news?category=general&token=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`finnhub-news: market-news ${res.status}`);
  const articles = (await res.json()) as FinnhubArticle[];
  return (Array.isArray(articles) ? articles : [])
    .map((a) => toNewsItem(a, null))
    .filter((i): i is NewsItem => i !== null);
}
