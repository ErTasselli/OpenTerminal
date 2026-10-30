"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiGet, fmt } from "../lib/api";
import { KIND_LABEL, type AlertKind } from "./widgets/AlertsWidget";

type AlertEvent = {
  seq: number;
  symbol: string;
  kind: AlertKind;
  threshold: number;
  price: number | null;
  change_percent: number | null;
  note: string | null;
};
type Toast = { seq: number; title: string; body: string };

// Shared by every tab so a firing is shown once per browser, not once per tab.
const CURSOR_KEY = "openterminal-alert-cursor";
const POLL_MS = 5_000;

function describe(e: AlertEvent): Toast {
  const now = e.price !== null ? `now ${fmt(e.price)}` : e.change_percent !== null ? `now ${fmt(e.change_percent)}%` : "";
  return {
    seq: e.seq,
    title: `${e.symbol} alert: ${KIND_LABEL[e.kind]} ${fmt(e.threshold)}`,
    body: [now, e.note].filter(Boolean).join(" · "),
  };
}

/**
 * Mounted once per tab (Terminal.tsx). Polls the alert event log and shows
 * each firing as a desktop notification (if permitted) and an in-app toast.
 * Notification text is plain text by API, and toasts render through React,
 * so user-entered notes can't inject markup.
 */
export default function AlertNotifier() {
  const qc = useQueryClient();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const busy = useRef(false);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const stored = localStorage.getItem(CURSOR_KEY);
        const res = await apiGet<{ cursor: number; events: AlertEvent[] }>(
          stored === null ? "/api/alerts/events" : `/api/alerts/events?after=${encodeURIComponent(stored)}`
        );
        if (stopped) return;
        // Another tab may have advanced the cursor meanwhile; never move it backwards.
        const latest = Number(localStorage.getItem(CURSOR_KEY) ?? 0);
        if (res.cursor >= latest) localStorage.setItem(CURSOR_KEY, String(res.cursor));
        if (res.events.length === 0) return;

        const fresh = res.events.map(describe);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          // `tag` collapses duplicates if two tabs race on the same event.
          for (const t of fresh) new Notification(t.title, { body: t.body, tag: `openterminal-alert-${t.seq}` });
        }
        setToasts((cur) => [...cur, ...fresh].slice(-5));
        for (const t of fresh) setTimeout(() => setToasts((cur) => cur.filter((x) => x.seq !== t.seq)), 12_000);
        qc.invalidateQueries({ queryKey: ["alerts"] });
      } catch {
        // API down or not signed in: try again on the next tick.
      } finally {
        busy.current = false;
      }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [qc]);

  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-3 right-3 z-50 flex flex-col gap-2 w-80" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.seq} className="bg-[var(--panel)] border border-[var(--amber)] p-2 shadow-lg">
          <div className="flex justify-between gap-2">
            <span className="amber font-bold">{t.title}</span>
            <button className="dim" onClick={() => setToasts((cur) => cur.filter((x) => x.seq !== t.seq))} aria-label="dismiss">
              ×
            </button>
          </div>
          {t.body && <div className="text-[11px]">{t.body}</div>}
        </div>
      ))}
    </div>
  );
}
