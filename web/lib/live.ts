"use client";

import { useEffect, useState } from "react";

export type LiveQuote = {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  time: number | null;
  source: "schwab-stream";
};

/**
 * Subscribe to Schwab level-one quotes through the Next SSE proxy. Returns
 * silently when Schwab is not configured; callers keep their regular polling
 * query as the fallback, so this hook is purely an enhancement.
 */
export function useLiveQuotes(symbols: string[]): {
  quotes: Record<string, LiveQuote>;
  connected: boolean;
} {
  const key = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean).join(",");
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setConnected(false);
    if (!key) {
      setQuotes({});
      return;
    }

    let source: EventSource | null = null;
    let active = true;

    const onQuote = (event: MessageEvent) => {
      try {
        const quote = JSON.parse(event.data) as LiveQuote;
        if (!active || !quote.symbol) return;
        setQuotes((previous) => ({ ...previous, [quote.symbol]: quote }));
      } catch {
        // Ignore malformed events; EventSource will keep the stream open.
      }
    };

    const onStatus = (event: MessageEvent) => {
      try {
        const status = JSON.parse(event.data) as { connected?: boolean };
        if (active) setConnected(Boolean(status.connected));
      } catch {
        // ignore
      }
    };

    source = new EventSource(`/api/stream/quotes?symbols=${encodeURIComponent(key)}`);
    source.addEventListener("quote", onQuote as EventListener);
    source.addEventListener("status", onStatus as EventListener);
    source.onerror = () => {
      if (active) setConnected(false);
    };

    return () => {
      active = false;
      source?.close();
    };
  }, [key]);

  return { quotes, connected };
}

/**
 * Overlay streamed fields on a REST quote without letting a null from a
 * partial stream frame erase a good value from the initial snapshot.
 */
export function mergeLiveQuote<T extends { symbol: string }>(base: T, live: LiveQuote | undefined): T {
  if (!live) return base;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(live)) {
    if (key === "symbol" || key === "source" || value !== null) patch[key] = value;
  }
  return { ...base, ...patch };
}
