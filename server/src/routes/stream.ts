import { Router } from "express";
import { isSchwabConfigured } from "../providers/schwabAuth.js";
import { schwabStreamer, type LiveQuote } from "../providers/schwabStreamer.js";
import { getSettings } from "../settings.js";

export const streamRouter = Router();

// Server-Sent Events rather than a browser WebSocket: the shared API key must
// stay server-side, so EventSource talks to the Next proxy, which forwards the
// request to this endpoint with the key attached. The Next route handler
// streams text/event-stream responses through without buffering.
streamRouter.get("/quotes", (req, res) => {
  const symbols = String(req.query.symbols ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 100);

  if (symbols.length === 0) {
    res.status(400).json({ error: "symbols required" });
    return;
  }
  if (getSettings().dataSource === "public") {
    res.status(503).json({ error: "Public data mode is selected in Settings" });
    return;
  }
  if (!isSchwabConfigured()) {
    res.status(503).json({ error: "Schwab streaming is not configured" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  res.write("retry: 10000\n\n");
  const initialStatus = schwabStreamer.status();
  let lastStatus = `${initialStatus.state}:${initialStatus.connected}`;
  send("status", initialStatus);

  const listener = (quote: LiveQuote) => send("quote", quote);
  schwabStreamer.subscribe(listener, symbols);

  // The upstream socket can connect a moment after this SSE response starts;
  // push status changes so the browser can switch from REST polling to live.
  const statusTimer = setInterval(() => {
    const status = schwabStreamer.status();
    const key = `${status.state}:${status.connected}`;
    if (key === lastStatus) return;
    lastStatus = key;
    send("status", status);
  }, 1_000);
  statusTimer.unref();

  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(": ping\n\n");
  }, 15_000);
  heartbeat.unref();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(statusTimer);
    clearInterval(heartbeat);
    schwabStreamer.unsubscribe(listener);
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
});
