"use client";

import { useEffect } from "react";
import { useLang, useT } from "../lib/i18n";
import { useTerminal } from "../store/terminal";
import AiSetup from "./AiSetup";
import { TelegramSetup } from "./widgets/AlertsWidget";

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const setLang = useLang((s) => s.setLang);
  const resetWorkspace = useTerminal((s) => s.resetWorkspace);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const clearLocalData = () => {
    if (!window.confirm(t("Delete all saved layout, watchlist, alerts and drawings from this browser?"))) return;
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("openterminal"))
        .forEach((k) => localStorage.removeItem(k));
    } catch {}
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60" onClick={onClose}>
      <div
        dir={t.dir}
        className="w-[480px] max-w-[92vw] max-h-[80vh] overflow-auto bg-[var(--panel)] border border-[var(--border)] text-[12px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between px-3 py-2 border-b border-[var(--border)] amber font-bold uppercase tracking-wider">
          <span>{t("Advanced settings")}</span>
          <button className="dim hover:text-[var(--down)]" onClick={onClose}>✕</button>
        </div>
        <div className="p-3 flex flex-col gap-3">
          <section className="border-b border-[var(--border)] pb-3">
            <div className="amber uppercase text-[10px] tracking-wider mb-1">{t("AI models")}</div>
            <AiSetup />
          </section>
          <section className="border-b border-[var(--border)] pb-1">
            <div className="amber uppercase text-[10px] tracking-wider">{t("Telegram")}</div>
            <TelegramSetup />
          </section>
          <div className="flex items-center justify-between">
            <span>{t("Language")}</span>
            <span className="flex gap-1">
              <button className={`term-btn ${t.lang === "en" ? "active" : ""}`} onClick={() => setLang("en")}>English</button>
              <button className={`term-btn ${t.lang === "he" ? "active" : ""}`} onClick={() => setLang("he")}>עברית</button>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>{t("Widget layout")}</span>
            <button className="term-btn" onClick={() => { resetWorkspace(); onClose(); }}>{t("RESET LAYOUT")}</button>
          </div>
          <div className="flex items-center justify-between">
            <span>{t("Saved data in this browser")}</span>
            <button className="term-btn" onClick={clearLocalData}>{t("Clear all")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
