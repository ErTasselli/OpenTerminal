"use client";

import { useEffect, useRef, useState } from "react";
import GridLayout, { WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useTerminal, type WidgetInstance } from "../store/terminal";
import QuoteWidget from "./widgets/QuoteWidget";
import ChartWidget from "./widgets/ChartWidget";
import WatchlistWidget from "./widgets/WatchlistWidget";
import NewsWidget from "./widgets/NewsWidget";
import HeatmapWidget from "./widgets/HeatmapWidget";
import ScreenerWidget from "./widgets/ScreenerWidget";
import CryptoWidget from "./widgets/CryptoWidget";
import MacroWidget from "./widgets/MacroWidget";
import OptionsWidget from "./widgets/OptionsWidget";
import PortfolioWidget from "./widgets/PortfolioWidget";
import AiWidget from "./widgets/AiWidget";
import TimeSalesWidget from "./widgets/TimeSalesWidget";
import TvWidget from "./widgets/TvWidget";
import RecapWidget from "./widgets/RecapWidget";

const Grid = WidthProvider(GridLayout);

function WidgetBody({ widget }: { widget: WidgetInstance }) {
  switch (widget.type) {
    case "quote": return <QuoteWidget widget={widget} />;
    case "chart": return <ChartWidget widget={widget} />;
    case "watchlist": return <WatchlistWidget />;
    case "news": return <NewsWidget widget={widget} />;
    case "heatmap": return <HeatmapWidget />;
    case "screener": return <ScreenerWidget />;
    case "crypto": return <CryptoWidget />;
    case "macro": return <MacroWidget />;
    case "options": return <OptionsWidget widget={widget} />;
    case "portfolio": return <PortfolioWidget />;
    case "ai": return <AiWidget />;
    case "tape": return <TimeSalesWidget widget={widget} />;
    case "tv": return <TvWidget />;
    case "recap": return <RecapWidget />;
  }
}

function SymbolTag({ widget, activeSymbol }: { widget: WidgetInstance; activeSymbol: string }) {
  const setWidgetSymbol = useTerminal((s) => s.setWidgetSymbol);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = widget.linked ? activeSymbol : widget.symbol ?? activeSymbol;

  useEffect(() => {
    if (!editing) return;
    setDraft(shown);
    requestAnimationFrame(() => inputRef.current?.select());
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value.toUpperCase())}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const v = draft.trim();
            if (v) setWidgetSymbol(widget.id, v);
            setEditing(false);
          }
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        className="ml-2 w-16 !border-0 !border-b !border-[var(--amber-dim)] bg-transparent text-[var(--text)] px-0 py-0 text-[13px] leading-none"
      />
    );
  }

  return (
    <span
      className="ml-2 text-[var(--text)] cursor-pointer hover:text-[var(--amber)]"
      title="Click to set this widget's ticker"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => setEditing(true)}
    >
      {shown}
    </span>
  );
}

const TITLES: Record<string, string> = {
  quote: "Quote", chart: "Chart", watchlist: "Watchlist", news: "News",
  heatmap: "Heatmap", screener: "Screener", crypto: "Crypto",
  macro: "Macro / Indexes", options: "Option Chain", portfolio: "Portfolio", ai: "AI Assistant",
  tape: "Time & Sales", tv: "Live TV", recap: "Market Recap",
};

export default function Workspace() {
  const widgets = useTerminal((s) => s.widgets);
  const layout = useTerminal((s) => s.layout);
  const setLayout = useTerminal((s) => s.setLayout);
  const removeWidget = useTerminal((s) => s.removeWidget);
  const toggleLinked = useTerminal((s) => s.toggleLinked);
  const activeSymbol = useTerminal((s) => s.activeSymbol);

  const symbolAware = new Set(["quote", "chart", "news", "options", "tape"]);

  return (
    <Grid
      className="layout"
      layout={layout}
      cols={12}
      rowHeight={30}
      margin={[4, 4]}
      draggableHandle=".panel-title"
      onLayoutChange={(l) => setLayout(l.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })))}
    >
      {widgets.map((w) => (
        <div key={w.id}>
          <div className="terminal-panel">
            <div className="panel-title">
              <span>
                {TITLES[w.type]}
                {symbolAware.has(w.type) && <SymbolTag widget={w} activeSymbol={activeSymbol} />}
              </span>
              <span className="flex gap-2 items-center">
                {symbolAware.has(w.type) && (
                  <button
                    title={w.linked ? "Linked to active symbol (click to unlink)" : "Unlinked (click to link)"}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => toggleLinked(w.id)}
                    className={w.linked ? "text-[var(--amber)]" : "dim"}
                  >
                    ⛓
                  </button>
                )}
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => removeWidget(w.id)}
                  className="dim hover:text-[var(--down)]"
                >
                  ✕
                </button>
              </span>
            </div>
            <div className="flex-1 overflow-auto min-h-0">
              <WidgetBody widget={w} />
            </div>
          </div>
        </div>
      ))}
    </Grid>
  );
}
