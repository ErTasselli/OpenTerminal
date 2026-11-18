import express from "express";
import cors from "cors";
import { marketRouter } from "./routes/market.js";
import { portfolioRouter } from "./routes/portfolio.js";
import { memoryRouter } from "./routes/memory.js";
import { pendingActionsRouter } from "./routes/pendingActions.js";
import { auditLogRouter } from "./routes/auditLog.js";
import { aiRouter } from "./routes/ai.js";
import { imagesRouter } from "./routes/images.js";
import { allStats } from "./providers/registry.js";
import { requireApiKey } from "./auth.js";
import { rateLimit } from "./rateLimit.js";
import { isAiAvailable } from "./llm/index.js";

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

// /api/ai is mounted ahead of the blanket express.json() below, and handles its own
// body-parsing with a larger limit -- see the comment on that limit further down. Since
// aiRouter's handler always sends a response itself (it never calls next()), a request
// under this path never falls through to the blanket parser after it; every other path
// just skips this whole app.use (path doesn't match) and reaches the blanket one as before.
app.use(
  "/api/ai",
  // requireApiKey and rateLimit both run off the request header/IP alone -- neither
  // touches the body -- so they're deliberately placed ahead of the larger json()
  // parser below. An unauthenticated or rate-limited caller is rejected before this
  // process ever spends CPU/memory parsing their body, same as every other protected
  // route below (whose body-parsing happens later, via the blanket express.json()).
  requireApiKey,
  rateLimit({ windowMs: 60_000, max: 10 }),
  // A screenshot pasted into the AI Assistant's chat input (#29) travels as an inline
  // base64 image part on ChatMessage.content. MAX_IMAGE_BYTES (llm/types.ts) bounds one
  // image at 15MB raw, which *base64-encodes to exactly 20MB* (15MB is a multiple of 3,
  // so there's no rounding to even help) -- before counting the rest of the JSON body
  // (field names, role/type tags, conversation history, `context`). A flat "20mb" limit
  // would give that exactly-20MB image zero room to fit inside its own request, so
  // /api/ai alone gets a substantially larger cap; every other route below keeps the
  // blanket express.json()'s small default, so this doesn't widen the body-size DoS
  // surface for endpoints that never take an image (in particular the unauthenticated,
  // keyless /api market routes).
  express.json({ limit: "40mb" }),
  aiRouter
);

app.use(express.json());

// No API key here by design (market.ts routes proxy free, keyless public data),
// but still bounded per-IP: unlike /api/ai and /api/portfolios, an unauthenticated
// caller could otherwise repeat the multi-provider fan-out in market.ts (up to
// hundreds of outbound calls per request — see getQuotes) fast enough to get
// this deployment's IP rate-limited or banned by Nasdaq/Yahoo/Stooq/SEC.
app.use("/api", rateLimit({ windowMs: 60_000, max: 240 }), marketRouter);
// Portfolio data and the paid AI endpoint require a shared secret; see auth.ts.
app.use("/api/portfolios", requireApiKey, portfolioRouter);
app.use("/api/portfolios", requireApiKey, pendingActionsRouter);
app.use("/api/memory", requireApiKey, memoryRouter);
app.use("/api/audit-log", requireApiKey, auditLogRouter);
// A chat-attached image persisted to disk under DATA_DIR/images (#30), served back by
// its content-addressed id. No dedicated rate limit (unlike /api/ai's stricter one) --
// a single conversation turn touches at most MAX_LIVE_IMAGE_TURNS (imageHistoryCap.ts)
// live images, so normal use never approaches the cost /api/ai's limit guards against.
app.use("/api/images", requireApiKey, imagesRouter);

app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    providers: allStats(),
    ai: isAiAvailable(),
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
