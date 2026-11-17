import { b3Ticker, isB3Symbol, toProviderSymbol } from "../providerSymbol.js";
import { XMLParser } from "fast-xml-parser";

export type NewsItem = {
  title: string;
  link: string;
  publisher: string;
  publishedAt: string | null;
  symbol: string | null;
};

const parser = new XMLParser({ ignoreAttributes: false });
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

async function fetchRss(url: string, publisher: string, symbol: string | null): Promise<NewsItem[]> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`rss ${res.status} ${url}`);
  const xml = await res.text();
  const doc = parser.parse(xml);
  const items = doc?.rss?.channel?.item ?? [];
  const list = Array.isArray(items) ? items : [items];
  return list
    .filter((i: any) => i?.title && i?.link)
    .map((i: any) => ({
      title: String(i.title),
      link: String(i.link),
      publisher: i.source?.["#text"] ?? publisher,
      publishedAt: i.pubDate ? new Date(i.pubDate).toISOString() : null,
      symbol,
    }));
}

export async function symbolNews(symbol: string): Promise<NewsItem[]> {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(toProviderSymbol(symbol))}&region=US&lang=en-US`;
  if (!isB3Symbol(symbol)) return fetchRss(url, "Yahoo Finance", symbol);
  // B3 listings also get Google News' Brazilian edition, searched by the ticker
  // as local outlets write it ("PETR4"): ~100 results where the en-US
  // "PETR4.SA stock" search finds about a dozen. Either source may fail alone.
  const lists = await Promise.allSettled([
    fetchRss(url, "Yahoo Finance", symbol),
    topNews(b3Ticker(symbol), "br"),
  ]);
  const ok = lists.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<NewsItem[]>).value);
  if (ok.length === 0) throw (lists[0] as PromiseRejectedResult).reason;
  return ok.flat();
}

/** Google News editions: language/country of the results. */
const GOOGLE_NEWS_EDITIONS = {
  us: "hl=en-US&gl=US&ceid=US:en",
  br: "hl=pt-BR&gl=BR&ceid=BR:pt-419",
} as const;

export async function topNews(
  query = "stock market",
  edition: keyof typeof GOOGLE_NEWS_EDITIONS = "us"
): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${GOOGLE_NEWS_EDITIONS[edition]}`;
  return fetchRss(url, "Google News", null);
}

/** Merge, de-duplicate by normalized title, newest first. */
export function dedupe(lists: NewsItem[][]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of lists.flat()) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}
