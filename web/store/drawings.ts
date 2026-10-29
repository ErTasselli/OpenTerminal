"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DrawingKind = "trend" | "hline" | "vline" | "rect" | "fib";
export type DrawingPoint = { time: number; price: number };
export type Drawing = { id: string; kind: DrawingKind; points: DrawingPoint[]; color: string };

/** Points a tool needs before the drawing is complete. */
export const POINTS_NEEDED: Record<DrawingKind, number> = { trend: 2, hline: 1, vline: 1, rect: 2, fib: 2 };

type DrawingsState = {
  bySymbol: Record<string, Drawing[]>;
  add: (symbol: string, kind: DrawingKind, points: DrawingPoint[], color: string) => void;
  update: (symbol: string, id: string, patch: Partial<Pick<Drawing, "points" | "color">>) => void;
  remove: (symbol: string, id: string) => void;
  clear: (symbol: string) => void;
};

export const useDrawings = create<DrawingsState>()(
  persist(
    (set) => ({
      bySymbol: {},
      add: (symbol, kind, points, color) =>
        set((st) => ({
          bySymbol: {
            ...st.bySymbol,
            [symbol]: [
              ...(st.bySymbol[symbol] ?? []),
              { id: `d-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind, points, color },
            ],
          },
        })),
      update: (symbol, id, patch) =>
        set((st) => ({
          bySymbol: {
            ...st.bySymbol,
            [symbol]: (st.bySymbol[symbol] ?? []).map((d) => (d.id === id ? { ...d, ...patch } : d)),
          },
        })),
      remove: (symbol, id) =>
        set((st) => ({ bySymbol: { ...st.bySymbol, [symbol]: (st.bySymbol[symbol] ?? []).filter((d) => d.id !== id) } })),
      clear: (symbol) => set((st) => ({ bySymbol: { ...st.bySymbol, [symbol]: [] } })),
    }),
    { name: "openterminal-drawings" }
  )
);
