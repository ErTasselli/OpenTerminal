import express from "express";
import cors from "cors";
import { marketRouter } from "./routes/market.js";
import { portfolioRouter } from "./routes/portfolio.js";
import { aiRouter } from "./routes/ai.js";
import { allStats } from "./providers/registry.js";
import { requireApiKey } from "./auth.js";
import { rateLimit } from "./rateLimit.js";

const app = express();

// Only the configured web origin may call this API from a browser. Without
// this, any website open in the same browser as the terminal could reach a
// server bound beyond localhost — cors() with no options reflects every
// origin.
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
app.use(cors({ origin: webOrigin }));
app.use(express.json());

app.use("/api", marketRouter);
// Portfolio data and the paid AI endpoint require a shared secret; see auth.ts.
app.use("/api/portfolios", requireApiKey, portfolioRouter);
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
    ai: Boolean(process.env.ANTHROPIC_API_KEY),
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
