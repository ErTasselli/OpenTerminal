import { afterEach, describe, expect, it, vi } from "vitest";
import { CRYPTO_FEEDS, cryptoNews, dedupe, mentionsCoin } from "./news.js";

function rss(items: { title: string; link?: string; pubDate?: string }[]): string {
  const body = items
    .map(
      (i) =>
        `<item><title><![CDATA[${i.title}]]></title><link>${i.link ?? "https://example.com/" + encodeURIComponent(i.title)}</link>` +
        (i.pubDate ? `<pubDate>${i.pubDate}</pubDate>` : "") +
        `</item>`
    )
    .join("");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>feed</title>${body}</channel></rss>`;
}

/** Route fetch by URL; any URL not in the map fails with 503. */
function stubFeeds(byUrl: Record<string, string>) {
  const fetchMock = vi.fn(async (url: string) =>
    url in byUrl ? { ok: true, text: async () => byUrl[url] } : { ok: false, status: 503 }
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const [coindesk, cointelegraph, decrypt] = CRYPTO_FEEDS.map((f) => f.url);

describe("mentionsCoin", () => {
  it("matches the ticker as a whole, case-sensitive word", () => {
    expect(mentionsCoin("BTC slides below $60K", "BTC")).toBe(true);
    expect(mentionsCoin("WBTC supply grows", "BTC")).toBe(false);
    expect(mentionsCoin("Click the link in bio", "LINK")).toBe(false);
    expect(mentionsCoin("LINK rallies 10%", "LINK")).toBe(true);
  });

  it("matches the coin name case-insensitively as a word prefix", () => {
    expect(mentionsCoin("Bitcoin's liquidation weekend", "BTC", "Bitcoin")).toBe(true);
    expect(mentionsCoin("bitcoiners cheer", "BTC", "Bitcoin")).toBe(true);
    expect(mentionsCoin("Ethereum fees drop", "BTC", "Bitcoin")).toBe(false);
  });
});

describe("cryptoNews", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("merges every crypto feed, tags the publisher, dedupes and sorts newest first", async () => {
    stubFeeds({
      [coindesk]: rss([{ title: "Old story", pubDate: "Mon, 16 Nov 2026 10:00:00 +0000" }]),
      [cointelegraph]: rss([{ title: "New story", pubDate: "Mon, 16 Nov 2026 12:00:00 +0000" }]),
      [decrypt]: rss([{ title: "new story!", pubDate: "Mon, 16 Nov 2026 11:00:00 +0000" }]),
    });

    const items = await cryptoNews();

    expect(items.map((i) => [i.title, i.publisher])).toEqual([
      ["New story", "Cointelegraph"],
      ["Old story", "CoinDesk"],
    ]);
    expect(items.every((i) => i.symbol === null)).toBe(true);
  });

  it("filters to the requested coin and tags items with the symbol", async () => {
    stubFeeds({
      [coindesk]: rss([{ title: "Bitcoin ETF inflows jump" }, { title: "Solana upgrade ships" }]),
      [cointelegraph]: rss([{ title: "BTC miners sell" }]),
      [decrypt]: rss([{ title: "Fed holds rates" }]),
    });

    const items = await cryptoNews("BTC", "Bitcoin");

    expect(items.map((i) => i.title).sort()).toEqual(["BTC miners sell", "Bitcoin ETF inflows jump"]);
    expect(items.every((i) => i.symbol === "BTC")).toBe(true);
  });

  it("still returns headlines when some feeds fail", async () => {
    stubFeeds({ [decrypt]: rss([{ title: "Only survivor" }]) });
    const items = await cryptoNews();
    expect(items.map((i) => i.title)).toEqual(["Only survivor"]);
  });

  it("throws when every feed fails", async () => {
    stubFeeds({});
    await expect(cryptoNews()).rejects.toThrow("all crypto news feeds failed");
  });
});

describe("dedupe", () => {
  const item = (title: string, publisher: string, publishedAt: string) =>
    ({ title, link: "https://example.com", publisher, publishedAt, symbol: null });

  it("treats a Google News ' - Publisher' copy as the same story and keeps the first occurrence", () => {
    const out = dedupe([
      [item("Bitcoin slides below $60K", "Decrypt", "2026-11-16T10:00:00.000Z")],
      [
        item("Bitcoin slides below $60K - Decrypt", "Decrypt", "2026-11-16T10:05:00.000Z"),
        item("Fed holds rates - Yahoo Finance", "Yahoo Finance", "2026-11-16T09:00:00.000Z"),
        item("Fed holds rates - The Motley Fool", "The Motley Fool", "2026-11-16T09:30:00.000Z"),
      ],
    ]);
    expect(out.map((i) => i.title)).toEqual(["Bitcoin slides below $60K", "Fed holds rates - Yahoo Finance"]);
  });

  it("drops lightly edited syndicated copies of the same story", () => {
    const out = dedupe([
      [item("Warsh grapples with AI’s potential economic impact, steers clear of its inflation risk - Los Angeles Times", "Los Angeles Times", "2026-11-16T10:00:00.000Z")],
      [
        item("U.S. Fed chairman Warsh grapples with AI’s potential economic impact, steers clear of its inflation risk - BNN Bloomberg", "BNN Bloomberg", "2026-11-16T11:00:00.000Z"),
        item("Fed Chairman Warsh grapples with AI’s potential economic impact, steers clear of its inflation risk - The Killeen Daily Herald", "The Killeen Daily Herald", "2026-11-16T12:00:00.000Z"),
      ],
    ]);
    expect(out.map((i) => i.publisher)).toEqual(["Los Angeles Times"]);
  });

  it("keeps different articles on the same topic and headlines that differ in a key word", () => {
    const out = dedupe([
      [
        item("Warsh Says Fed Is Gaming Out How AI Could Reshape Economy - WSJ", "WSJ", "2026-11-16T10:00:00.000Z"),
        item("How will AI shake up the economy? Warsh says the Fed is starting to figure that out. - MarketWatch", "MarketWatch", "2026-11-16T10:01:00.000Z"),
        item("Stocks rise as Fed holds rates steady", "Reuters", "2026-11-16T10:02:00.000Z"),
        item("Stocks fall as Fed holds rates steady", "Reuters", "2026-11-16T10:03:00.000Z"),
      ],
    ]);
    expect(out).toHaveLength(4);
  });

  it("keeps a short headline that only appears inside a longer, different one", () => {
    const out = dedupe([
      [item("Fed holds rates steady", "Reuters", "2026-11-16T10:00:00.000Z")],
      [item("Stocks rise after Fed holds rates steady, Powell signals cuts", "CNBC", "2026-11-16T10:01:00.000Z")],
    ]);
    expect(out).toHaveLength(2);
  });

  it("does not fuzzy-match very short titles", () => {
    const out = dedupe([
      [item("Bitcoin rallies", "CoinDesk", "2026-11-16T10:00:00.000Z")],
      [item("Bitcoin rallies again", "Decrypt", "2026-11-16T10:01:00.000Z")],
    ]);
    expect(out).toHaveLength(2);
  });

  it("does not strip a trailing segment that isn't the item's publisher", () => {
    const out = dedupe([
      [item("Ethereum upgrade - what changes", "CoinDesk", "2026-11-16T10:00:00.000Z")],
      [item("Ethereum upgrade", "CoinDesk", "2026-11-16T09:00:00.000Z")],
    ]);
    expect(out).toHaveLength(2);
  });
});
