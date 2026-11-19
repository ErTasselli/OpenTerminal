import { XMLParser } from "fast-xml-parser";
import { resolveCik, SEC_UA } from "./secedgar.js";

export type NewsItem = {
  title: string;
  link: string;
  publisher: string;
  publishedAt: string | null;
  symbol: string | null;
};

const parser = new XMLParser({ ignoreAttributes: false });
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// Per-request timeout for every outbound fetch in this module. One hanging RSS/news
// source must not block the whole /api/news response, which otherwise waits on all
// sources via Promise.allSettled with no bound on a single source's latency.
// Overridable via env so tests can force a near-instant timeout instead of waiting
// out a multi-second (or unbounded) hang.
const FETCH_TIMEOUT_MS = Number(process.env.PROVIDER_FETCH_TIMEOUT_MS) || 9000;

async function fetchRss(url: string, publisher: string, symbol: string | null): Promise<NewsItem[]> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  return fetchRss(url, "Yahoo Finance", symbol);
}

export async function topNews(query = "stock market"): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  return fetchRss(url, "Google News", null);
}

export async function nasdaqNews(symbol: string): Promise<NewsItem[]> {
  const url = `https://www.nasdaq.com/feed/rssoutbound?symbol=${encodeURIComponent(symbol)}`;
  return fetchRss(url, "Nasdaq", symbol);
}

export async function fedReserveNews(): Promise<NewsItem[]> {
  return fetchRss("https://www.federalreserve.gov/feeds/press_all.xml", "Federal Reserve", null);
}

export async function marketWatchNews(): Promise<NewsItem[]> {
  const url = "https://feeds.content.dowjones.io/public/rss/mw_topstories";
  return fetchRss(url, "MarketWatch", null);
}

export async function cnbcNews(): Promise<NewsItem[]> {
  const url = "https://www.cnbc.com/id/100003114/device/rss/rss.html";
  return fetchRss(url, "CNBC", null);
}

// SEC's "browse-edgar" company filing feed is Atom (doc.feed.entry), not RSS
// (doc.rss.channel.item), so it needs its own shape here instead of fetchRss.
export async function secEdgarFilings(symbol: string): Promise<NewsItem[]> {
  const cik = await resolveCik(symbol);
  if (!cik) return [];

  const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=10&output=atom`;
  const res = await fetch(url, { headers: { "User-Agent": SEC_UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`sec edgar ${res.status} for ${url}`);
  const xml = await res.text();
  const doc = parser.parse(xml);
  const entries = doc?.feed?.entry ?? [];
  const list = Array.isArray(entries) ? entries : [entries];
  return list
    .filter((e: any) => e?.title && e?.link?.["@_href"])
    .map((e: any) => ({
      title: String(e.title),
      link: String(e.link["@_href"]),
      publisher: "SEC EDGAR",
      publishedAt: e.updated ? new Date(e.updated).toISOString() : null,
      symbol,
    }));
}

export type NewsSource =
  | { name: string; scope: "symbol"; fetch: (symbol: string) => Promise<NewsItem[]> }
  | { name: string; scope: "global"; fetch: () => Promise<NewsItem[]> };

export const NEWS_SOURCES: NewsSource[] = [
  { name: "yahoo-symbol-rss", scope: "symbol", fetch: (symbol) => symbolNews(symbol) },
  { name: "google-symbol-rss", scope: "symbol", fetch: (symbol) => topNews(`${symbol} stock`) },
  { name: "nasdaq-press-releases", scope: "symbol", fetch: (symbol) => nasdaqNews(symbol) },
  { name: "sec-edgar-filings", scope: "symbol", fetch: (symbol) => secEdgarFilings(symbol) },
  { name: "google-market-rss", scope: "global", fetch: () => topNews("stock market") },
  { name: "google-fed-rss", scope: "global", fetch: () => topNews("federal reserve economy") },
  { name: "fed-reserve-press-releases", scope: "global", fetch: () => fedReserveNews() },
  { name: "marketwatch-top-stories", scope: "global", fetch: () => marketWatchNews() },
  { name: "cnbc-top-news", scope: "global", fetch: () => cnbcNews() },
];

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
