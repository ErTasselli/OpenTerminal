"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { normalizeSymbol } from "../lib/symbol";

export type WidgetType =
  | "quote"
  | "chart"
  | "watchlist"
  | "news"
  | "heatmap"
  | "screener"
  | "crypto"
  | "macro"
  | "options"
  | "portfolio"
  | "ai"
  | "calendar"
  | "insider"
  | "tv"
  | "recap"
  | "alerts"
  | "sectors"
  | "paper"
  | "replay";

export type WidgetInstance = {
  id: string;
  type: WidgetType;
  symbol?: string;
  linked: boolean; // follows the globally active symbol
};

export type LayoutItem = { i: string; x: number; y: number; w: number; h: number };

type TerminalState = {
  activeSymbol: string;
  widgets: WidgetInstance[];
  layout: LayoutItem[];
  /** Symbols of the active group (kept in sync; read by watchlist/calendar widgets). */
  watchlist: string[];
  watchlists: WatchlistGroup[];
  activeWatchlist: number;
  commandOpen: boolean;
  /** Beginner tooltips on terminal labels (TopBar LEARN toggle). */
  learnMode: boolean;
  toggleLearnMode: () => void;
  setActiveSymbol: (s: string) => void;
  setCommandOpen: (open: boolean) => void;
  addWidget: (type: WidgetType, symbol?: string) => void;
  removeWidget: (id: string) => void;
  setWidgetSymbol: (id: string, symbol: string) => void;
  toggleLinked: (id: string) => void;
  setLayout: (layout: LayoutItem[]) => void;
  addToWatchlist: (s: string) => void;
  removeFromWatchlist: (s: string) => void;
  setActiveWatchlist: (index: number) => void;
  addWatchlistGroup: (name: string) => void;
  renameWatchlistGroup: (index: number, name: string) => void;
  removeWatchlistGroup: (index: number) => void;
  resetWorkspace: () => void;
};

export type WatchlistGroup = { name: string; symbols: string[] };

export const WATCHLIST_LIMITS = { groups: 10, symbols: 60, name: 24 } as const;
const DEFAULT_WATCHLIST = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "SPY"];

const cleanName = (n: unknown, fallback: string) =>
  (typeof n === "string" ? n.trim().slice(0, WATCHLIST_LIMITS.name) : "") || fallback;

/** Re-validates groups from localStorage, which is user-editable and may be stale or hand-edited. */
export function sanitizeGroups(raw: unknown, legacy?: unknown): WatchlistGroup[] {
  const source: unknown[] = Array.isArray(raw) && raw.length ? raw : [{ name: "Main", symbols: Array.isArray(legacy) ? legacy : DEFAULT_WATCHLIST }];
  const groups = source.slice(0, WATCHLIST_LIMITS.groups).map((g, i) => {
    const obj = (g ?? {}) as { name?: unknown; symbols?: unknown };
    const symbols = Array.isArray(obj.symbols) ? obj.symbols : [];
    const clean = [...new Set(symbols.map((x) => (typeof x === "string" ? normalizeSymbol(x) : null)).filter((x): x is string => !!x))];
    return { name: cleanName(obj.name, `List ${i + 1}`), symbols: clean.slice(0, WATCHLIST_LIMITS.symbols) };
  });
  return groups.length ? groups : [{ name: "Main", symbols: DEFAULT_WATCHLIST }];
}

/** Applies `fn` to the active group and re-mirrors `watchlist`. */
function updateActive(st: TerminalState, fn: (symbols: string[]) => string[]) {
  const watchlists = st.watchlists.map((g, i) => (i === st.activeWatchlist ? { ...g, symbols: fn(g.symbols) } : g));
  return { watchlists, watchlist: watchlists[st.activeWatchlist]?.symbols ?? [] };
}

const DEFAULT_WIDGETS: WidgetInstance[] = [
  { id: "w-chart", type: "chart", linked: true },
  { id: "w-quote", type: "quote", linked: true },
  { id: "w-watchlist", type: "watchlist", linked: false },
  { id: "w-news", type: "news", linked: true },
  { id: "w-macro", type: "macro", linked: false },
];

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: "w-chart", x: 0, y: 0, w: 7, h: 12 },
  { i: "w-quote", x: 7, y: 0, w: 5, h: 6 },
  { i: "w-watchlist", x: 7, y: 6, w: 5, h: 6 },
  { i: "w-news", x: 0, y: 12, w: 7, h: 7 },
  { i: "w-macro", x: 7, y: 12, w: 5, h: 7 },
];

const SIZE_BY_TYPE: Record<WidgetType, { w: number; h: number }> = {
  quote: { w: 5, h: 6 },
  chart: { w: 7, h: 12 },
  watchlist: { w: 4, h: 7 },
  news: { w: 5, h: 8 },
  heatmap: { w: 7, h: 10 },
  screener: { w: 12, h: 9 },
  crypto: { w: 6, h: 9 },
  macro: { w: 5, h: 7 },
  options: { w: 12, h: 9 },
  portfolio: { w: 7, h: 8 },
  ai: { w: 5, h: 10 },
  calendar: { w: 12, h: 11 },
  insider: { w: 7, h: 9 },
  tv: { w: 6, h: 11 },
  recap: { w: 5, h: 12 },
  alerts: { w: 6, h: 8 },
  sectors: { w: 7, h: 9 },
  paper: { w: 8, h: 12 },
  replay: { w: 8, h: 12 },
};

export const useTerminal = create<TerminalState>()(
  persist(
    (set) => ({
      activeSymbol: "AAPL",
      widgets: DEFAULT_WIDGETS,
      layout: DEFAULT_LAYOUT,
      watchlist: DEFAULT_WATCHLIST,
      watchlists: [{ name: "Main", symbols: DEFAULT_WATCHLIST }],
      activeWatchlist: 0,
      commandOpen: false,
      learnMode: true,
      toggleLearnMode: () => set((st) => ({ learnMode: !st.learnMode })),
      setActiveSymbol: (s) => {
        const sym = normalizeSymbol(s);
        if (sym) set({ activeSymbol: sym });
      },
      setCommandOpen: (open) => set({ commandOpen: open }),
      addWidget: (type, symbol) =>
        set((st) => {
          const id = `w-${type}-${Date.now()}`;
          const size = SIZE_BY_TYPE[type];
          const maxY = st.layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
          return {
            widgets: [...st.widgets, { id, type, symbol, linked: !symbol }],
            layout: [...st.layout, { i: id, x: 0, y: maxY, ...size }],
          };
        }),
      removeWidget: (id) =>
        set((st) => ({
          widgets: st.widgets.filter((w) => w.id !== id),
          layout: st.layout.filter((l) => l.i !== id),
        })),
      setWidgetSymbol: (id, symbol) => {
        const sym = normalizeSymbol(symbol);
        if (!sym) return;
        set((st) => ({
          widgets: st.widgets.map((w) => (w.id === id ? { ...w, symbol: sym, linked: false } : w)),
        }));
      },
      toggleLinked: (id) =>
        set((st) => ({
          widgets: st.widgets.map((w) => (w.id === id ? { ...w, linked: !w.linked } : w)),
        })),
      setLayout: (layout) => set({ layout }),
      addToWatchlist: (s) => {
        const sym = normalizeSymbol(s);
        if (!sym) return;
        set((st) =>
          updateActive(st, (list) =>
            list.includes(sym) || list.length >= WATCHLIST_LIMITS.symbols ? list : [...list, sym]
          )
        );
      },
      removeFromWatchlist: (s) => set((st) => updateActive(st, (list) => list.filter((x) => x !== s))),
      setActiveWatchlist: (index) =>
        set((st) =>
          index >= 0 && index < st.watchlists.length
            ? { activeWatchlist: index, watchlist: st.watchlists[index].symbols }
            : {}
        ),
      addWatchlistGroup: (name) =>
        set((st) => {
          if (st.watchlists.length >= WATCHLIST_LIMITS.groups) return {};
          const watchlists = [...st.watchlists, { name: cleanName(name, `List ${st.watchlists.length + 1}`), symbols: [] }];
          return { watchlists, activeWatchlist: watchlists.length - 1, watchlist: [] };
        }),
      renameWatchlistGroup: (index, name) =>
        set((st) => ({
          watchlists: st.watchlists.map((g, i) => (i === index ? { ...g, name: cleanName(name, g.name) } : g)),
        })),
      removeWatchlistGroup: (index) =>
        set((st) => {
          if (st.watchlists.length <= 1 || index < 0 || index >= st.watchlists.length) return {};
          const watchlists = st.watchlists.filter((_g, i) => i !== index);
          const activeWatchlist = Math.min(st.activeWatchlist >= index && st.activeWatchlist > 0 ? st.activeWatchlist - 1 : st.activeWatchlist, watchlists.length - 1);
          return { watchlists, activeWatchlist, watchlist: watchlists[activeWatchlist].symbols };
        }),
      resetWorkspace: () => set({ widgets: DEFAULT_WIDGETS, layout: DEFAULT_LAYOUT }),
    }),
    {
      name: "openterminal-workspace",
      // v1: single `watchlist` became named groups. Every load re-validates
      // the groups, so a stale or hand-edited localStorage can't break the UI.
      version: 1,
      migrate: (persisted) => persisted as TerminalState,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<TerminalState>;
        const watchlists = sanitizeGroups(p.watchlists, p.watchlist);
        const activeWatchlist =
          Number.isInteger(p.activeWatchlist) && p.activeWatchlist! >= 0 && p.activeWatchlist! < watchlists.length ? p.activeWatchlist! : 0;
        return { ...current, ...p, watchlists, activeWatchlist, watchlist: watchlists[activeWatchlist].symbols };
      },
    }
  )
);

/** Symbol a widget should display: its own, or the active one when linked. */
export function useWidgetSymbol(widget: WidgetInstance): string {
  const active = useTerminal((s) => s.activeSymbol);
  return widget.linked ? active : widget.symbol ?? active;
}
