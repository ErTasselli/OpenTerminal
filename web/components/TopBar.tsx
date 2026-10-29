"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { useTerminal } from "../store/terminal";
import { useLang, useT } from "../lib/i18n";
import SettingsDialog from "./SettingsDialog";

type Status = {
  ok: boolean;
  providers: Array<{ name: string; ok: number; failed: number; lastLatencyMs: number | null }>;
  ai: boolean;
};

function Clock({ tz, label }: { tz: string; label: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  return (
    <span className="dim">
      {label}{" "}
      <span className="text-[var(--text)]">
        {now.toLocaleTimeString("en-GB", { timeZone: tz, hour12: false })}
      </span>
    </span>
  );
}

function marketStateNY(): { open: boolean } {
  const ny = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = ny.getDay();
  const mins = ny.getHours() * 60 + ny.getMinutes();
  const open = day >= 1 && day <= 5 && mins >= 570 && mins < 960; // 09:30–16:00
  return { open };
}

export default function TopBar() {
  const t = useT();
  const setLang = useLang((s) => s.setLang);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setCommandOpen = useTerminal((s) => s.setCommandOpen);
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const { data: status } = useQuery({
    queryKey: ["status"],
    queryFn: () => apiGet<Status>("/api/status"),
    refetchInterval: 30_000,
  });

  const market = marketStateNY();
  const healthy = status?.providers.filter((p) => p.ok > 0) ?? [];

  return (
    <header dir="ltr" className="flex items-center gap-4 px-3 h-8 bg-[var(--panel-2)] border-b border-[var(--border)] text-[11px] shrink-0">
      <span className="amber font-bold tracking-widest">OPENTERMINAL</span>
      <span className={market.open ? "up" : "down"}>● {market.open ? t("NYSE OPEN") : t("NYSE CLOSED")}</span>
      <Clock tz="America/New_York" label="NY" />
      <Clock tz="Europe/Rome" label="MIL" />
      <Clock tz="Europe/London" label="LDN" />
      <Clock tz="Asia/Tokyo" label="TYO" />
      <button
        className="term-btn flex-1 max-w-md text-left dim"
        onClick={() => setCommandOpen(true)}
      >
        {activeSymbol} — {t("search symbol…")} <span className="float-right">⌘K</span>
      </button>
      <span className="dim ml-auto">
        {t("feeds:")}{" "}
        {healthy.length > 0
          ? healthy.map((p) => `${p.name} ${p.lastLatencyMs ?? "—"}ms`).join(" · ")
          : t("connecting…")}
      </span>
      <span className={status?.ai ? "up" : "dim"}>AI {status?.ai ? "●" : "○"}</span>
      <button
        className="term-btn"
        title="English / עברית"
        onClick={() => setLang(t.lang === "he" ? "en" : "he")}
      >
        {t.lang === "he" ? "EN" : "עב"}
      </button>
      <button className="term-btn" title={t("Advanced settings")} onClick={() => setSettingsOpen(true)}>
        ⚙
      </button>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}
