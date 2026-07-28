"use client";

import { useTerminal, type WidgetType } from "../store/terminal";

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
];

export default function Sidebar() {
  const addWidget = useTerminal((s) => s.addWidget);
  const resetWorkspace = useTerminal((s) => s.resetWorkspace);

  return (
    <nav className="w-32 bg-[var(--panel)] border-r border-[var(--border)] flex flex-col shrink-0">
      <div className="dim px-2 py-1 text-[10px] uppercase tracking-wider border-b border-[var(--border)]">
        Add widget
      </div>
      {ITEMS.map((item) => (
        <button
          key={item.type}
          onClick={() => addWidget(item.type)}
          className="text-left px-2 py-1.5 text-[11px] hover:bg-[#1a1a1a] hover:text-[var(--amber)] flex justify-between"
        >
          <span>{item.label}</span>
          <span className="dim text-[9px]">{item.key}</span>
        </button>
      ))}
      <div className="mt-auto border-t border-[var(--border)]">
        <button
          onClick={resetWorkspace}
          className="w-full text-left px-2 py-1.5 text-[11px] dim hover:text-[var(--down)]"
        >
          RESET LAYOUT
        </button>
      </div>
    </nav>
  );
}
