"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Candle } from "../lib/api";
import { ema } from "../lib/indicators";

export type AlertOp = ">=" | "<=" | "ema-up" | "ema-down" | "ema-any";
export type AlertInterval = "1h" | "4h" | "1d";
export const isEmaOp = (op: AlertOp) => op === "ema-up" || op === "ema-down" || op === "ema-any";

export type PriceAlert = {
  id: string;
  symbol: string;
  /** Price thresholds, or an EMA9/EMA20 crossover ("ema-up" = 9 crosses above 20). */
  op: AlertOp;
  price: number;
  /** EMA alerts only: candle size the averages are computed on. */
  interval?: AlertInterval;
  /** EMA alerts only: which side EMA9 was on at the last check (+1 above, -1 below). */
  emaSide?: 1 | -1 | null;
  /** Also send a Telegram message when it fires. */
  telegram: boolean;
  /** Set (ms epoch) once the condition was met; a triggered alert never fires again. */
  triggeredAt: number | null;
  triggeredPrice: number | null;
};

type AlertsState = {
  alerts: PriceAlert[];
  addAlert: (symbol: string, op: AlertOp, price: number, telegram: boolean, interval?: AlertInterval) => void;
  setEmaSide: (id: string, side: 1 | -1) => void;
  removeAlert: (id: string) => void;
  markTriggered: (id: string, price: number) => void;
  rearm: (id: string) => void;
};

export const useAlerts = create<AlertsState>()(
  persist(
    (set) => ({
      alerts: [],
      setEmaSide: (id, side) =>
        set((st) => ({ alerts: st.alerts.map((a) => (a.id === id ? { ...a, emaSide: side } : a)) })),
      addAlert: (symbol, op, price, telegram, interval) =>
        set((st) => ({
          alerts: [
            ...st.alerts,
            { id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, symbol, op, price, telegram, interval, emaSide: null, triggeredAt: null, triggeredPrice: null },
          ],
        })),
      removeAlert: (id) => set((st) => ({ alerts: st.alerts.filter((a) => a.id !== id) })),
      markTriggered: (id, price) =>
        set((st) => ({
          alerts: st.alerts.map((a) => (a.id === id ? { ...a, triggeredAt: Date.now(), triggeredPrice: price } : a)),
        })),
      rearm: (id) =>
        set((st) => ({
          alerts: st.alerts.map((a) => (a.id === id ? { ...a, triggeredAt: null, triggeredPrice: null, emaSide: null } : a)),
        })),
    }),
    { name: "openterminal-alerts" }
  )
);

/** Which side EMA9 is on relative to EMA20 on the latest candle; null when there is too little history. */
export function emaSide(candles: Candle[]): 1 | -1 | null {
  if (candles.length < 21) return null;
  const fast = ema(candles, 9).at(-1)?.value;
  const slow = ema(candles, 20).at(-1)?.value;
  if (fast === undefined || slow === undefined || fast === slow) return null;
  return fast > slow ? 1 : -1;
}

/** Did EMA9 cross EMA20 in the direction this alert watches, going from `prev` to `now`? */
export function emaCrossed(op: AlertOp, prev: 1 | -1 | null | undefined, now: 1 | -1 | null): boolean {
  if (!prev || !now || prev === now) return false;
  return op === "ema-any" || (op === "ema-up" ? now === 1 : now === -1);
}

export function isTriggered(op: ">=" | "<=", target: number, price: number): boolean {
  return op === ">=" ? price >= target : price <= target;
}
