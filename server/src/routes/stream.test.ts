import express from "express";
import type { AddressInfo, Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStreamRouter, type Producers, type StreamOptions } from "./stream.js";

let server: Server | undefined;
afterEach(() => server?.close());

async function start(producers: Partial<Producers>, opts: Partial<StreamOptions> = {}) {
  const p: Producers = {
    quotes: async () => [],
    macro: async () => ({}),
    crypto: async () => [],
    ...producers,
  };
  const router = createStreamRouter(p, { tickMs: 20, heartbeatMs: 50, ...opts });
  const app = express();
  app.use("/stream", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server!.once("listening", r));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/stream`;
  return { base, stats: (router as any)._stats as () => { total: number } };
}

/** Reads SSE text until `until` matches or the time budget runs out, then disconnects. */
async function read(url: string, until: (text: string) => boolean, ms = 1_000) {
  const ctl = new AbortController();
  const res = await fetch(url, { signal: ctl.signal });
  if (!res.body) return { res, text: await res.text() };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = "";
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !until(text)) {
    const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), 50))]);
    if (chunk && !chunk.done) text += dec.decode(chunk.value);
    if (chunk?.done) break;
  }
  ctl.abort();
  return { res, text };
}

const events = (text: string, name: string) =>
  [...text.matchAll(new RegExp(`event: ${name}\\ndata: (.*)\\n`, "g"))].map((m) => JSON.parse(m[1]));

describe("GET /stream", () => {
  it("streams all requested topics over one connection", async () => {
    const quotes = vi.fn(async (s: string[]) => s.map((symbol) => ({ symbol, price: 1 })));
    const { base } = await start({ quotes, macro: async (r) => ({ region: r }), crypto: async () => [{ id: "btc" }] });
    const { res, text } = await read(`${base}?symbols=aapl,MSFT&macro=eu&crypto=1`, (t) => t.includes("event: crypto") && t.includes("event: macro") && t.includes("event: quotes"));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(events(text, "quotes")[0]).toEqual([{ symbol: "AAPL", price: 1 }, { symbol: "MSFT", price: 1 }]);
    expect(events(text, "macro")[0]).toEqual({ region: "eu" });
    expect(quotes).toHaveBeenCalledWith(["AAPL", "MSFT"]);
  });

  it("only pushes a topic when its value changed", async () => {
    let n = 0;
    const { base } = await start({ quotes: async () => [{ price: n++ < 3 ? 1 : 2 }] });
    const { text } = await read(`${base}?symbols=AAPL`, (t) => events(t, "quotes").length >= 2, 1_500);
    expect(events(text, "quotes").map((q) => q[0].price)).toEqual([1, 2]);
  });

  it("keeps streaming through a provider error", async () => {
    let n = 0;
    const { base } = await start({
      quotes: async () => {
        if (++n === 1) throw new Error("provider down");
        return [{ price: n }];
      },
    });
    const { text } = await read(`${base}?symbols=AAPL`, (t) => events(t, "quotes").length >= 1);
    expect(events(text, "quotes").length).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ["bad symbol", "?symbols=AAPL,%3Cscript%3E"],
    ["bad macro region", "?macro=xx"],
    ["nothing requested", ""],
  ])("rejects %s with 400", async (_n, q) => {
    const { base } = await start({});
    expect((await fetch(`${base}${q}`)).status).toBe(400);
  });

  it("rejects too many symbols", async () => {
    const { base } = await start({}, { maxSymbols: 2 });
    expect((await fetch(`${base}?symbols=A,B,C`)).status).toBe(400);
  });

  it("caps concurrent streams per client and frees the slot on disconnect", async () => {
    const { base, stats } = await start({}, { maxPerClient: 1 });
    const ctl = new AbortController();
    const first = await fetch(`${base}?symbols=AAPL`, { signal: ctl.signal });
    expect(first.status).toBe(200);
    expect((await fetch(`${base}?symbols=AAPL`)).status).toBe(429);
    ctl.abort();
    await new Promise((r) => setTimeout(r, 100));
    expect(stats().total).toBe(0);
    const again = new AbortController();
    expect((await fetch(`${base}?symbols=AAPL`, { signal: again.signal })).status).toBe(200);
    again.abort();
  });

  it("recycles streams after their max lifetime", async () => {
    const { base } = await start({}, { maxLifetimeMs: 100 });
    const res = await fetch(`${base}?symbols=AAPL`);
    const text = await res.text(); // resolves only because the server ended the stream
    expect(text).toContain("retry: 3000");
  });
});
