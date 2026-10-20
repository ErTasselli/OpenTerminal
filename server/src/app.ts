import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { cryptoBoard, getQuotes, macroData, marketRouter } from "./routes/market.js";
import { createStreamRouter } from "./routes/stream.js";
import { alertsRouter } from "./alerts.js";
import { createPaperRouter } from "./paper.js";
import { portfolioRouter } from "./routes/portfolio.js";
import { aiRouter } from "./routes/ai.js";
import { allStats } from "./providers/registry.js";
import { requireApiKey } from "./auth.js";
import { rateLimit } from "./rateLimit.js";

function perMinute(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  // Off by default: req.ip then falls back to the immediate socket address
  // (the bundled web proxy's own address when called through it), so every
  // caller behind that proxy shares one rate-limit bucket — safe, if coarser
  // than per-browser. Only set TRUST_PROXY=1 if you know exactly one trusted
  // reverse proxy sits in front of this process (the bundled web proxy alone,
  // or your own proxy in front of it that itself sets X-Forwarded-For from
  // the real client and doesn't let callers inject their own value) —
  // otherwise a caller can forge X-Forwarded-For to dodge the rate limit.
  if (process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
  }

  // Only the configured web origin may call this API from a browser. Without
  // this, any website open in the same browser as the terminal could reach a
  // server bound beyond localhost — cors() with no options reflects every
  // origin.
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  app.use(cors({ origin: webOrigin }));
  // Largest legitimate body is an AI chat (≈24k chars of conversation + 8k of
  // context, see routes/ai.ts); anything bigger is rejected before parsing.
  app.use(express.json({ limit: "64kb" }));

  app.get("/api/status", (_req, res) => {
    res.json({
      ok: true,
      time: new Date().toISOString(),
      providers: allStats(),
      ai: Boolean(process.env.ANTHROPIC_API_KEY),
    });
  });

  // Authenticated routes are mounted BEFORE the market limiter: previously
  // app.use("/api", limiter, marketRouter) ran first for every /api path, so
  // portfolio and AI traffic silently drained the market budget too.
  app.use("/api/portfolios", requireApiKey, portfolioRouter);
  // Alerts are private like portfolios: same shared-secret gate.
  app.use("/api/alerts", requireApiKey, alertsRouter);
  // Simulated trading account (learning). Private like portfolios.
  app.use("/api/paper", requireApiKey, createPaperRouter(getQuotes));
  app.use(
    "/api/ai",
    requireApiKey,
    rateLimit({ windowMs: 60_000, max: perMinute("AI_RATE_LIMIT_PER_MIN", 10) }),
    aiRouter
  );

  // No API key here by design (market.ts routes proxy free, keyless public data),
  // but still bounded per-IP so a caller can't repeat the multi-provider fan-out
  // in market.ts fast enough to get this deployment's IP banned upstream. The
  // default must sit above the UI's own steady-state polling: several widgets
  // refresh every second, and behind the bundled proxy one browser is one IP,
  // so 240/min was exhausted by a single tab with the crypto widget added.
  const marketLimit = rateLimit({ windowMs: 60_000, max: perMinute("MARKET_RATE_LIMIT_PER_MIN", 600) });
  // Live push for the 1-second widgets. Same budget as the REST routes, but a
  // stream costs one request per connection instead of one per second.
  app.use("/api/stream", marketLimit, createStreamRouter({ quotes: getQuotes, macro: macroData, crypto: cryptoBoard }));
  app.use("/api", marketLimit, marketRouter);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  // JSON errors without stack traces or internals (Express's default handler
  // answers in HTML and includes the stack outside NODE_ENV=production).
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number }).status;
    if (status === 413) return res.status(413).json({ error: "request body too large" });
    if (status === 400) return res.status(400).json({ error: "malformed request body" });
    console.error("[api] unhandled error on", req.method, req.path, err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
