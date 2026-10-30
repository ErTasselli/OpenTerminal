import { afterEach, describe, expect, it, vi } from "vitest";
import { symbolNews, toIsoOrNull } from "./news.js";

afterEach(() => vi.unstubAllGlobals());

const rss = (items: string) =>
  `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`;

describe("news pubDate handling", () => {
  it("maps unparseable dates to null instead of throwing", () => {
    expect(toIsoOrNull("Mon, 99 Foo 2026")).toBeNull();
    expect(toIsoOrNull(undefined)).toBeNull();
    expect(toIsoOrNull("Tue, 13 Oct 2026 14:00:00 GMT")).toBe("2026-10-13T14:00:00.000Z");
  });

  it("keeps the rest of the feed when one item has a malformed pubDate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => rss(
        "<item><title>Good</title><link>https://a.example/1</link><pubDate>Tue, 13 Oct 2026 14:00:00 GMT</pubDate></item>" +
        "<item><title>Bad date</title><link>https://a.example/2</link><pubDate>not a date</pubDate></item>"
      ),
    }));
    const items = await symbolNews("AAPL");
    expect(items.map((i) => [i.title, i.publishedAt])).toEqual([
      ["Good", "2026-10-13T14:00:00.000Z"],
      ["Bad date", null],
    ]);
  });
});
