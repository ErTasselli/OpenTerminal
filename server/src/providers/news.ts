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
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  return fetchRss(url, "Yahoo Finance", symbol);
}

export async function topNews(query = "stock market"): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  return fetchRss(url, "Google News", null);
}

/** Crypto-native publishers with public, keyless RSS 2.0 feeds. */
export const CRYPTO_FEEDS = [
  { publisher: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { publisher: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { publisher: "Decrypt", url: "https://decrypt.co/feed" },
] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when a headline mentions the coin. The ticker is matched case-sensitively
 * as a whole word (so "DOT"/"LINK"/"SOL" don't match ordinary words); the name is
 * matched case-insensitively as a word prefix ("Bitcoin's", "Bitcoiners").
 */
export function mentionsCoin(title: string, symbol: string, name?: string): boolean {
  if (new RegExp(`\\b${escapeRegExp(symbol)}\\b`).test(title)) return true;
  return !!name && new RegExp(`\\b${escapeRegExp(name)}`, "i").test(title);
}

/**
 * Headlines from the crypto feeds, merged and newest first. With `symbol`, keeps
 * only items mentioning that coin (by ticker or `name`) and tags them with it.
 * Fails only when every feed fails.
 */
export async function cryptoNews(symbol: string | null = null, name?: string): Promise<NewsItem[]> {
  const lists = await Promise.allSettled(CRYPTO_FEEDS.map((f) => fetchRss(f.url, f.publisher, symbol)));
  const ok = lists.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<NewsItem[]>).value);
  if (ok.length === 0) throw new Error("all crypto news feeds failed");
  const items = dedupe(ok);
  return symbol ? items.filter((i) => mentionsCoin(i.title, symbol, name)) : items;
}

/**
 * Google News appends " - <Publisher>" to every title, so its copy of a story would
 * otherwise never collide with the same headline from the publisher's own feed.
 */
function withoutPublisherSuffix(item: NewsItem): string {
  const suffix = ` - ${item.publisher}`;
  return item.title.endsWith(suffix) ? item.title.slice(0, -suffix.length) : item.title;
}

const STOPWORDS = new Set(
  "a an and are as at be by for from in into is it its of on or over says than that the this to was with".split(" ")
);

function titleWords(title: string): Set<string> {
  return new Set(title.split(" ").filter((w) => w && !STOPWORDS.has(w)));
}

/** Below this many meaningful words, titles are too short to compare fuzzily. */
const MIN_WORDS_FOR_FUZZY = 4;

/**
 * Syndicated wire stories get republished with words added around the same headline
 * ("Warsh grapples with…" vs "U.S. Fed chairman Warsh grapples with…"). Treat two
 * titles as one story when the shorter one's words are (almost) all inside the longer
 * one AND the two overlap substantially overall. Requiring containment rather than
 * plain similarity keeps headlines that differ by a swapped word ("Stocks rise…" vs
 * "Stocks fall…"); the overlap check keeps a short headline that merely appears inside
 * a longer, different one. Different articles on the same topic score ~0.4 overlap.
 */
function isNearDuplicate(a: Set<string>, b: Set<string>): boolean {
  if (a.size < MIN_WORDS_FOR_FUZZY || b.size < MIN_WORDS_FOR_FUZZY) return false;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const containment = shared / Math.min(a.size, b.size);
  const overlap = shared / (a.size + b.size - shared);
  return containment >= 0.9 && overlap >= 0.6;
}

/**
 * Merge, de-duplicate (first occurrence wins), newest first. Two titles are the same
 * story if they match after normalization, or if their word sets are near-identical.
 */
export function dedupe(lists: NewsItem[][]): NewsItem[] {
  const seen = new Set<string>();
  const keptWords: Set<string>[] = [];
  const out: NewsItem[] = [];
  for (const item of lists.flat()) {
    const normalized = withoutPublisherSuffix(item).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const key = normalized.slice(0, 80);
    if (seen.has(key)) continue;
    const words = titleWords(normalized);
    if (keptWords.some((k) => isNearDuplicate(words, k))) continue;
    seen.add(key);
    keptWords.push(words);
    out.push(item);
  }
  return out.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}
