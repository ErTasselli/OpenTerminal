"use client";

import { useEffect, useId, useSyncExternalStore } from "react";
import type { Quote } from "./api";

/**
 * Browser side of /api/stream: ONE EventSource per tab, shared by every
 * widget. Widgets register what they need; the hub merges those needs into a
 * single subscription and reconnects (debounced) when the set changes.
 *
 * Widgets keep their REST query as the source of the first paint and as the
 * fallback: they poll only while `connected` is false (stream down, proxy
 * buffering, capacity 503/429...), so a broken stream degrades to the old
 * behaviour instead of a frozen screen.
 */
type Need = { symbols?: string[]; macro?: "us" | "eu"; crypto?: boolean };
type Snapshot = { connected: boolean; quotes: Map<string, Quote>; macro: Record<string, unknown>; crypto: unknown };

const needs = new Map<string, Need>();
const listeners = new Set<() => void>();
let snapshot: Snapshot = { connected: false, quotes: new Map(), macro: {}, crypto: null };
let source: EventSource | null = null;
let currentQuery = "";
let macroRegion: "us" | "eu" | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

function publish(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

function desiredQuery(): string {
  const symbols = new Set<string>();
  let macro: "us" | "eu" | null = null;
  let crypto = false;
  for (const n of needs.values()) {
    n.symbols?.forEach((s) => symbols.add(s));
    if (n.macro) macro = n.macro;
    if (n.crypto) crypto = true;
  }
  macroRegion = macro;
  const q = new URLSearchParams();
  if (symbols.size) q.set("symbols", [...symbols].sort().slice(0, 60).join(","));
  if (macro) q.set("macro", macro);
  if (crypto) q.set("crypto", "1");
  return q.toString();
}

function reconcile() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    const query = desiredQuery();
    if (query === currentQuery && source) return;
    source?.close();
    source = null;
    currentQuery = query;
    if (!query || typeof EventSource === "undefined") return publish({ connected: false });

    const es = new EventSource(`/api/stream?${query}`);
    source = es;
    es.onopen = () => publish({ connected: true });
    // EventSource retries on its own; until it reopens, widgets poll.
    es.onerror = () => publish({ connected: false });
    es.addEventListener("quotes", (e) => {
      const next = new Map(snapshot.quotes);
      for (const q of JSON.parse((e as MessageEvent).data) as Quote[]) next.set(q.symbol, q);
      publish({ quotes: next, connected: true });
    });
    es.addEventListener("macro", (e) => {
      if (macroRegion) publish({ macro: { ...snapshot.macro, [macroRegion]: JSON.parse((e as MessageEvent).data) }, connected: true });
    });
    es.addEventListener("crypto", (e) => publish({ crypto: JSON.parse((e as MessageEvent).data), connected: true }));
  }, 150);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const getSnapshot = () => snapshot;
const serverSnapshot: Snapshot = { connected: false, quotes: new Map(), macro: {}, crypto: null };

/** Registers this component's needs with the hub for as long as it's mounted. */
function useNeed(need: Need | null) {
  const id = useId();
  const key = JSON.stringify(need);
  useEffect(() => {
    if (!need) return;
    needs.set(id, need);
    reconcile();
    return () => {
      needs.delete(id);
      reconcile();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures `need`
  }, [id, key]);
}

export function useLiveQuotes(symbols: string[]) {
  useNeed(symbols.length ? { symbols } : null);
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
  return { connected: snap.connected, quotes: snap.quotes };
}

export function useLiveMacro<T>(region: "us" | "eu") {
  useNeed({ macro: region });
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
  return { connected: snap.connected, data: snap.macro[region] as T | undefined };
}

export function useLiveCrypto<T>() {
  useNeed({ crypto: true });
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
  return { connected: snap.connected, data: snap.crypto as T | null };
}

/** Polling interval to use alongside a live hook: off while streaming. */
export const pollUnlessLive = (connected: boolean, ms = 1_000) => (connected ? false : ms);
