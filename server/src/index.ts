import express from "express";
import cors from "cors";
import { marketRouter } from "./routes/market.js";
import { portfolioRouter } from "./routes/portfolio.js";
import { aiRouter } from "./routes/ai.js";
import { telegramRouter } from "./routes/telegram.js";
import { allStats } from "./providers/registry.js";
import { requireApiKey } from "./auth.js";
import { rateLimit } from "./rateLimit.js";
import { isConfigured, loadAiConfig } from "./aiConfig.js";

const app = express();

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
app.use(express.json());

// No API key here by design (market.ts routes proxy free, keyless public data),
// but still bounded per-IP: unlike /api/ai and /api/portfolios, an unauthenticated
// caller could otherwise repeat the multi-provider fan-out in market.ts (up to
// hundreds of outbound calls per request — see getQuotes) fast enough to get
// this deployment's IP rate-limited or banned by Nasdaq/Yahoo/Stooq/SEC.
// The dashboard polls many widgets once per second (quotes, watchlist, macro,
// crypto), which alone is ~240+ req/min, so the ceiling must sit well above that;
// responses are served from the server-side cache, so upstream load stays bounded.
const marketRateMax = Number(process.env.MARKET_RATE_LIMIT) || 1800;
app.use("/api", rateLimit({ windowMs: 60_000, max: marketRateMax }), marketRouter);
// Portfolio data and the paid AI endpoint require a shared secret; see auth.ts.
app.use("/api/portfolios", requireApiKey, portfolioRouter);
app.use("/api/telegram", requireApiKey, rateLimit({ windowMs: 60_000, max: 30 }), telegramRouter);
app.use(
  "/api/ai",
  requireApiKey,
  rateLimit({ windowMs: 60_000, max: 10 }),
  aiRouter
);

app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    providers: allStats(),
    ai: isConfigured(loadAiConfig()),
  });
});

const PORT = Number(process.env.API_PORT ?? 4000);
// Bind to localhost by default so cloning and running this never exposes an
// unauthenticated-by-default API to the network. Set API_HOST=0.0.0.0 (and
// API_KEY + WEB_ORIGIN) to intentionally expose it beyond this machine.
const HOST = process.env.API_HOST ?? "127.0.0.1";
app.listen(PORT, HOST, () => {
  console.log(`OpenTerminal API listening on http://${HOST}:${PORT}`);
});
