"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, fmt } from "../../lib/api";
import { normalizeSymbol } from "../../lib/symbol";
import { useTerminal } from "../../store/terminal";

export type AlertKind = "above" | "below" | "pct_up" | "pct_down";
type AlertRow = {
  id: number;
  symbol: string;
  kind: AlertKind;
  threshold: number;
  note: string | null;
  active: number;
  triggered_at: string | null;
  triggered_price: number | null;
};

export const KIND_LABEL: Record<AlertKind, string> = {
  above: "price ≥",
  below: "price ≤",
  pct_up: "day up ≥ %",
  pct_down: "day down ≥ %",
};

function NotificationToggle() {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => {
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);
  if (perm === "granted") return <span className="up text-[10px]">desktop notifications on</span>;
  if (perm === "unsupported") return <span className="dim text-[10px]">in-app alerts only (needs https or localhost)</span>;
  if (perm === "denied") return <span className="down text-[10px]">notifications blocked in browser settings</span>;
  return (
    <button className="term-btn" onClick={async () => setPerm(await Notification.requestPermission())}>
      ENABLE DESKTOP NOTIFICATIONS
    </button>
  );
}

export default function AlertsWidget() {
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const qc = useQueryClient();
  const [form, setForm] = useState({ symbol: "", kind: "above" as AlertKind, threshold: "", note: "" });

  const { data: alerts = [], error } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => apiGet<AlertRow[]>("/api/alerts"),
    refetchInterval: 15_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["alerts"] });

  const create = useMutation({
    mutationFn: () => {
      const symbol = normalizeSymbol(form.symbol || activeSymbol);
      if (!symbol) throw new Error("invalid symbol");
      const threshold = Number(form.threshold);
      if (!Number.isFinite(threshold) || threshold <= 0) throw new Error("threshold must be a positive number");
      return apiPost("/api/alerts", { symbol, kind: form.kind, threshold, ...(form.note.trim() ? { note: form.note.trim() } : {}) });
    },
    onSuccess: () => {
      setForm((f) => ({ ...f, threshold: "", note: "" }));
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: number) => apiDelete(`/api/alerts/${id}`), onSuccess: refresh });
  const rearm = useMutation({ mutationFn: (id: number) => apiPost(`/api/alerts/${id}/rearm`, {}), onSuccess: refresh });

  return (
    <div className="flex flex-col h-full">
      <form
        className="flex flex-wrap gap-1 p-1 border-b border-[var(--border)] shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <input
          className="w-20"
          placeholder={activeSymbol}
          value={form.symbol}
          onChange={(e) => setForm({ ...form, symbol: e.target.value })}
          aria-label="symbol"
        />
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as AlertKind })} aria-label="condition">
          {(Object.keys(KIND_LABEL) as AlertKind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
        <input
          className="w-20"
          inputMode="decimal"
          placeholder="value"
          value={form.threshold}
          onChange={(e) => setForm({ ...form, threshold: e.target.value })}
          aria-label="threshold"
        />
        <input
          className="flex-1 min-w-16"
          maxLength={120}
          placeholder="note (optional)"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
          aria-label="note"
        />
        <button className="term-btn" disabled={create.isPending}>ADD</button>
      </form>
      <div className="px-2 py-1 shrink-0 flex items-center gap-2">
        <NotificationToggle />
        {create.error && <span className="down text-[10px]">{(create.error as Error).message}</span>}
      </div>
      <div className="flex-1 overflow-auto min-h-0">
        {error && <div className="p-2 down">{(error as Error).message}</div>}
        {alerts.length === 0 && !error && <div className="p-2 dim">No alerts yet. Alerts fire once, then wait to be re-armed.</div>}
        <table className="w-full">
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id} className={a.active ? "" : "dim"}>
                <td className="!text-left amber">{a.symbol}</td>
                <td className="!text-left">{KIND_LABEL[a.kind]} {fmt(a.threshold)}</td>
                <td className="!text-left truncate max-w-[10rem]" title={a.note ?? ""}>{a.note}</td>
                <td>
                  {a.active ? (
                    <span className="up">armed</span>
                  ) : (
                    <span title={a.triggered_at ?? ""}>fired @ {fmt(a.triggered_price)}</span>
                  )}
                </td>
                <td className="whitespace-nowrap">
                  {!a.active && (
                    <button className="term-btn" onClick={() => rearm.mutate(a.id)}>RE-ARM</button>
                  )}{" "}
                  <button className="term-btn" onClick={() => remove.mutate(a.id)} aria-label={`delete alert ${a.id}`}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
