import { Router } from "express";
import * as schwab from "../providers/schwab.js";
import {
  clearSchwabTokens,
  exchangeSchwabCode,
  isSchwabConfigured,
  schwabAuthorizationUrl,
  schwabTokenStatus,
} from "../providers/schwabAuth.js";
import { schwabStreamer } from "../providers/schwabStreamer.js";

export const schwabRouter = Router();

function unavailable(res: any): void {
  res.status(503).json({
    error:
      "Schwab is not configured. Set SCHWAB_CLIENT_ID and SCHWAB_CLIENT_SECRET, then run `npm run schwab:auth -w server`.",
  });
}

schwabRouter.get("/status", (_req, res) => {
  res.json({
    ...schwabTokenStatus(),
    streaming: schwabStreamer.status(),
  });
});

schwabRouter.get("/auth-url", (_req, res) => {
  try {
    res.json({ url: schwabAuthorizationUrl() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// The Settings page posts the full callback URL (or just the code) here. The
// exchange writes the rotated refresh token to disk, so subsequent API calls
// and the streamer need no further user action.
schwabRouter.post("/auth", async (req, res) => {
  const input = String(req.body?.url ?? req.body?.code ?? "").trim();
  if (!input) return res.status(400).json({ error: "paste the full callback URL or authorization code" });
  try {
    const tokens = await exchangeSchwabCode(input);
    res.json({
      ok: true,
      expiresAt: tokens.expires_at,
      ...schwabTokenStatus(),
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

schwabRouter.delete("/auth", (_req, res) => {
  clearSchwabTokens();
  res.status(204).end();
});

schwabRouter.get("/quotes", async (req, res) => {
  if (!isSchwabConfigured()) return unavailable(res);
  const symbols = String(req.query.symbols ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 150);
  if (symbols.length === 0) return res.status(400).json({ error: "symbols required" });
  try {
    res.json(await schwab.quotes(symbols));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

schwabRouter.get("/history/:symbol", async (req, res) => {
  if (!isSchwabConfigured()) return unavailable(res);
  try {
    res.json(await schwab.history(req.params.symbol.toUpperCase(), String(req.query.range ?? "6M")));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

schwabRouter.get("/options/:symbol", async (req, res) => {
  if (!isSchwabConfigured()) return unavailable(res);
  try {
    res.json(
      await schwab.optionChain(
        req.params.symbol.toUpperCase(),
        req.query.expiry ? String(req.query.expiry) : undefined
      )
    );
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

schwabRouter.get("/search", async (req, res) => {
  if (!isSchwabConfigured()) return unavailable(res);
  try {
    res.json(await schwab.search(String(req.query.q ?? "")));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

schwabRouter.get("/movers", async (req, res) => {
  if (!isSchwabConfigured()) return unavailable(res);
  const index = String(req.query.index ?? "$SPX");
  const sort = String(req.query.sort ?? "PERCENT_CHANGE_UP") as
    | "VOLUME"
    | "TRADES"
    | "PERCENT_CHANGE_UP"
    | "PERCENT_CHANGE_DOWN";
  try {
    res.json(await schwab.movers(index, sort));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

schwabRouter.get("/market-hours", async (req, res) => {
  if (!isSchwabConfigured()) return unavailable(res);
  const markets = req.query.markets
    ? String(req.query.markets).split(",").map((m) => m.trim()).filter(Boolean)
    : undefined;
  try {
    res.json(await schwab.marketHours(markets, req.query.date ? String(req.query.date) : undefined));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
