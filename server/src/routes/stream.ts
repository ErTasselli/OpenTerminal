import { Router, type Request, type Response } from "express";
import { normalizeSymbol } from "../symbol.js";

/**
 * One multiplexed Server-Sent Events stream per browser tab, replacing the
 * 1-second polling of the quote/watchlist/macro/crypto widgets:
 *
 *   GET /api/stream?symbols=AAPL,MSFT&macro=us&crypto=1
 *
 * Each topic is re-read every `tickMs` from the same cached producers the
 * REST routes use, and pushed only when it changed. One connection per tab
 * (not per widget) matters: browsers allow just 6 HTTP/1.1 connections per
 * origin, and long-lived streams count against that.
 */
export type Producers = {
  quotes: (symbols: string[]) => Promise<unknown>;
  macro: (region: "us" | "eu") => Promise<unknown>;
  crypto: () => Promise<unknown>;
};

export type StreamOptions = {
  tickMs: number;
  heartbeatMs: number;
  /** Streams are recycled so a forgotten tab can't hold a connection forever; EventSource reconnects. */
  maxLifetimeMs: number;
  maxPerClient: number;
  maxTotal: number;
  maxSymbols: number;
};

const DEFAULTS: StreamOptions = {
  tickMs: 1_000,
  heartbeatMs: 15_000,
  maxLifetimeMs: 15 * 60_000,
  maxPerClient: 6,
  maxTotal: 200,
  maxSymbols: 60,
};

export function createStreamRouter(producers: Producers, opts: Partial<StreamOptions> = {}) {
  const o = { ...DEFAULTS, ...opts };
  const router = Router();
  const perClient = new Map<string, number>();
  let total = 0;

  router.get("/", (req: Request, res: Response) => {
    const raw = String(req.query.symbols ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const symbols = [...new Set(raw.map(normalizeSymbol))].filter((s): s is string => s !== null);
    if (symbols.length !== new Set(raw.map((s) => s.toUpperCase())).size) {
      return res.status(400).json({ error: "invalid symbol in list" });
    }
    if (symbols.length > o.maxSymbols) return res.status(400).json({ error: `at most ${o.maxSymbols} symbols` });
    const macro = req.query.macro === undefined ? null : req.query.macro === "eu" ? "eu" : req.query.macro === "us" ? "us" : "bad";
    if (macro === "bad") return res.status(400).json({ error: "macro must be us or eu" });
    const crypto = req.query.crypto === "1";
    if (symbols.length === 0 && !macro && !crypto) return res.status(400).json({ error: "nothing to stream" });

    const client = req.ip ?? "unknown";
    if (total >= o.maxTotal) return res.status(503).json({ error: "stream capacity reached, falling back to polling" });
    if ((perClient.get(client) ?? 0) >= o.maxPerClient) {
      return res.status(429).json({ error: "too many open streams from this client" });
    }
    total++;
    perClient.set(client, (perClient.get(client) ?? 0) + 1);

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");

    const topics: Array<[string, () => Promise<unknown>]> = [];
    if (symbols.length) topics.push(["quotes", () => producers.quotes(symbols)]);
    if (macro) topics.push(["macro", () => producers.macro(macro)]);
    if (crypto) topics.push(["crypto", () => producers.crypto()]);
    const last = new Map<string, string>();

    let closed = false;
    let tickTimer: NodeJS.Timeout | undefined;
    const heartbeat = setInterval(() => res.write(": ping\n\n"), o.heartbeatMs);
    const lifetime = setTimeout(() => res.end(), o.maxLifetimeMs);

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearTimeout(tickTimer);
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      total--;
      const n = (perClient.get(client) ?? 1) - 1;
      if (n <= 0) perClient.delete(client);
      else perClient.set(client, n);
    };
    req.on("close", cleanup);
    res.on("close", cleanup);

    // Chained setTimeout (not setInterval) so a slow provider can't stack ticks.
    const tick = async () => {
      await Promise.all(
        topics.map(async ([event, produce]) => {
          try {
            const json = JSON.stringify(await produce());
            if (closed || json === last.get(event)) return;
            last.set(event, json);
            res.write(`event: ${event}\ndata: ${json}\n\n`);
          } catch {
            // Provider hiccup: keep the last value on screen, try again next tick.
          }
        })
      );
      if (!closed) tickTimer = setTimeout(tick, o.tickMs);
    };
    void tick();
  });

  Object.defineProperty(router, "_stats", { value: () => ({ total, perClient: new Map(perClient) }) });
  return router;
}
