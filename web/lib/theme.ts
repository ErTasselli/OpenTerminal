"use client";

import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "openterminal-theme";
const EVENT = "openterminal-theme-change";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode etc. — data-theme still applies for this session */
  }
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: theme }));
}

/** Shared theme state. Components re-render when the theme changes. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  useEffect(() => {
    const onChange = (e: Event) => setThemeState((e as CustomEvent<Theme>).detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return [theme, setTheme];
}

/**
 * Chart palettes. lightweight-charts, d3 and recharts need concrete color
 * strings, so themes are mirrored here as JS objects alongside the CSS
 * variables in globals.css. Dark values reproduce the original hardcoded
 * look byte-for-byte.
 */
export const CHART_THEME: Record<
  Theme,
  {
    bg: string;
    text: string;
    grid: string;
    border: string;
    up: string;
    down: string;
    line: string;
    lineTop: string;
    lineBottom: string;
    volUp: string;
    volDown: string;
    histUp: string;
    histDown: string;
    histBase: string;
    macdLine: string;
    signal: string;
    bollOuter: string;
    bollMiddle: string;
    label: string;
    indicator: Record<string, string>;
  }
> = {
  dark: {
    bg: "#0a0a0a",
    text: "#808080",
    grid: "#1a1a1a",
    border: "#262626",
    up: "#00c853",
    down: "#ff3d3d",
    line: "#ff9900",
    lineTop: "rgba(255,153,0,0.25)",
    lineBottom: "rgba(255,153,0,0)",
    volUp: "rgba(0,200,83,0.4)",
    volDown: "rgba(255,61,61,0.4)",
    histUp: "rgba(0,200,83,0.6)",
    histDown: "rgba(255,61,61,0.6)",
    histBase: "#4fc3f7",
    macdLine: "#4fc3f7",
    signal: "#ffffff",
    bollOuter: "rgba(255,153,0,0.5)",
    bollMiddle: "rgba(255,153,0,0.8)",
    label: "#ffffff",
    indicator: {
      SMA20: "#ffd966",
      SMA50: "#4fc3f7",
      SMA200: "#ba68c8",
      EMA20: "#ff8a65",
      VWAP: "#80cbc4",
      RSI: "#ff9900",
      BOLL: "#ff9900",
      MACD: "#4fc3f7",
    },
  },
  light: {
    bg: "#ffffff",
    text: "#6e6e6e",
    grid: "#e8e8e4",
    border: "#d4d4d0",
    up: "#1a8a3a",
    down: "#d32f2f",
    line: "#c96a00",
    lineTop: "rgba(201,106,0,0.22)",
    lineBottom: "rgba(201,106,0,0)",
    volUp: "rgba(26,138,58,0.35)",
    volDown: "rgba(211,47,47,0.35)",
    histUp: "rgba(26,138,58,0.55)",
    histDown: "rgba(211,47,47,0.55)",
    histBase: "#0277bd",
    macdLine: "#0277bd",
    signal: "#1f1f1f",
    bollOuter: "rgba(201,106,0,0.5)",
    bollMiddle: "rgba(201,106,0,0.8)",
    label: "#1f1f1f",
    indicator: {
      SMA20: "#b8860b",
      SMA50: "#0277bd",
      SMA200: "#7b1fa2",
      EMA20: "#d84315",
      VWAP: "#00796b",
      RSI: "#c96a00",
      BOLL: "#c96a00",
      MACD: "#0277bd",
    },
  },
};