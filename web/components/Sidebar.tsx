"use client";

import { useTerminal, type WidgetType } from "../store/terminal";
import { useT } from "../lib/i18n";

const ITEMS: Array<{ type: WidgetType; label: string; key: string }> = [
  { type: "chart", label: "CHART", key: "⌥1" },
  { type: "quote", label: "QUOTE", key: "⌥2" },
  { type: "news", label: "NEWS", key: "⌥3" },
  { type: "screener", label: "SCREENER", key: "⌥4" },
  { type: "heatmap", label: "HEATMAP", key: "⌥5" },
  { type: "crypto", label: "CRYPTO", key: "⌥6" },
  { type: "options", label: "OPTIONS", key: "⌥7" },
  { type: "portfolio", label: "PORTFOLIO", key: "⌥8" },
  { type: "ai", label: "AI ASSIST", key: "⌥9" },
  { type: "watchlist", label: "WATCHLIST", key: "" },
  { type: "macro", label: "MACRO", key: "" },
  { type: "calendar", label: "CALENDAR", key: "" },
  { type: "insider", label: "INSIDER", key: "" },
  { type: "tv", label: "LIVE TV", key: "" },
  { type: "recap", label: "MARKET RECAP", key: "" },
  { type: "alerts", label: "ALERTS", key: "" },
  { type: "feargreed", label: "FEAR INDEX", key: "" },
];

export default function Sidebar() {
  const t = useT();
  const addWidget = useTerminal((s) => s.addWidget);
  const resetWorkspace = useTerminal((s) => s.resetWorkspace);

  return (
    <nav dir={t.dir} className="w-32 bg-[var(--panel)] border-r border-[var(--border)] flex flex-col shrink-0 overflow-y-auto">
      <div className="dim px-2 py-1 text-[10px] uppercase tracking-wider border-b border-[var(--border)]">
        {t("Add widget")}
      </div>
      {ITEMS.map((item) => (
        <button
          key={item.type}
          onClick={() => addWidget(item.type)}
          className="text-start px-2 py-1.5 text-[11px] hover:bg-[#1a1a1a] hover:text-[var(--amber)] flex justify-between"
        >
          <span>{t(item.label)}</span>
          <span className="dim text-[9px]">{item.key}</span>
        </button>
      ))}
      <div className="mt-auto border-t border-[var(--border)]">
        <button
          onClick={resetWorkspace}
          className="w-full text-start px-2 py-1.5 text-[11px] dim hover:text-[var(--down)]"
        >
          {t("RESET LAYOUT")}
        </button>
      </div>
    </nav>
  );
}
