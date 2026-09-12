"use client";

import { useEffect, useState } from "react";

export const THEMES = [
  "dark",
  "light",
  "dracula",
  "nord",
  "catppuccin",
  "tokyo-night",
  "gruvbox",
  "solarized-light",
] as const;

export type Theme = (typeof THEMES)[number];

const KEY = "***";
const EVENT = "openterminal-theme-change";

function isTheme(v: string | null | undefined): v is Theme {
  return !!v && (THEMES as readonly string[]).includes(v);
}

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const v = localStorage.getItem(KEY);
    return isTheme(v) ? v : "dark";
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
 * variables in globals.css. The "dark" values reproduce the original
 * hardcoded look byte-for-byte; the other palettes follow each color
 * scheme's published spec.
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
  dracula: {
    bg: "#21222c",
    text: "#6272a4",
    grid: "#2b2d3a",
    border: "#44475a",
    up: "#50fa7b",
    down: "#ff5555",
    line: "#bd93f9",
    lineTop: "rgba(189,147,249,0.25)",
    lineBottom: "rgba(189,147,249,0)",
    volUp: "rgba(80,250,123,0.4)",
    volDown: "rgba(255,85,85,0.4)",
    histUp: "rgba(80,250,123,0.6)",
    histDown: "rgba(255,85,85,0.6)",
    histBase: "#8be9fd",
    macdLine: "#8be9fd",
    signal: "#f8f8f2",
    bollOuter: "rgba(189,147,249,0.5)",
    bollMiddle: "rgba(189,147,249,0.8)",
    label: "#f8f8f2",
    indicator: {
      SMA20: "#f1fa8c",
      SMA50: "#8be9fd",
      SMA200: "#ff79c6",
      EMA20: "#ffb86c",
      VWAP: "#50fa7b",
      RSI: "#bd93f9",
      BOLL: "#bd93f9",
      MACD: "#8be9fd",
    },
  },
  nord: {
    bg: "#2e3440",
    text: "#616e88",
    grid: "#3b4252",
    border: "#434c5e",
    up: "#a3be8c",
    down: "#bf616a",
    line: "#88c0d0",
    lineTop: "rgba(136,192,208,0.25)",
    lineBottom: "rgba(136,192,208,0)",
    volUp: "rgba(163,190,140,0.4)",
    volDown: "rgba(191,97,106,0.4)",
    histUp: "rgba(163,190,140,0.6)",
    histDown: "rgba(191,97,106,0.6)",
    histBase: "#81a1c1",
    macdLine: "#81a1c1",
    signal: "#eceff4",
    bollOuter: "rgba(136,192,208,0.5)",
    bollMiddle: "rgba(136,192,208,0.8)",
    label: "#eceff4",
    indicator: {
      SMA20: "#ebcb8b",
      SMA50: "#81a1c1",
      SMA200: "#b48ead",
      EMA20: "#d08770",
      VWAP: "#8fbcbb",
      RSI: "#88c0d0",
      BOLL: "#88c0d0",
      MACD: "#81a1c1",
    },
  },
  catppuccin: {
    bg: "#1e1e2e",
    text: "#6c7086",
    grid: "#262637",
    border: "#313244",
    up: "#a6e3a1",
    down: "#f38ba8",
    line: "#cba6f7",
    lineTop: "rgba(203,166,247,0.25)",
    lineBottom: "rgba(203,166,247,0)",
    volUp: "rgba(166,227,161,0.4)",
    volDown: "rgba(243,139,168,0.4)",
    histUp: "rgba(166,227,161,0.6)",
    histDown: "rgba(243,139,168,0.6)",
    histBase: "#89b4fa",
    macdLine: "#89b4fa",
    signal: "#cdd6f4",
    bollOuter: "rgba(203,166,247,0.5)",
    bollMiddle: "rgba(203,166,247,0.8)",
    label: "#cdd6f4",
    indicator: {
      SMA20: "#f9e2af",
      SMA50: "#89b4fa",
      SMA200: "#f5c2e7",
      EMA20: "#fab387",
      VWAP: "#94e2d5",
      RSI: "#cba6f7",
      BOLL: "#cba6f7",
      MACD: "#89b4fa",
    },
  },
  "tokyo-night": {
    bg: "#1a1b26",
    text: "#565f89",
    grid: "#1f2335",
    border: "#292e42",
    up: "#9ece6a",
    down: "#f7768e",
    line: "#7aa2f7",
    lineTop: "rgba(122,162,247,0.25)",
    lineBottom: "rgba(122,162,247,0)",
    volUp: "rgba(158,206,106,0.4)",
    volDown: "rgba(247,118,142,0.4)",
    histUp: "rgba(158,206,106,0.6)",
    histDown: "rgba(247,118,142,0.6)",
    histBase: "#7dcfff",
    macdLine: "#7dcfff",
    signal: "#c0caf5",
    bollOuter: "rgba(122,162,247,0.5)",
    bollMiddle: "rgba(122,162,247,0.8)",
    label: "#c0caf5",
    indicator: {
      SMA20: "#e0af68",
      SMA50: "#7dcfff",
      SMA200: "#bb9af7",
      EMA20: "#ff9e64",
      VWAP: "#1abc9c",
      RSI: "#7aa2f7",
      BOLL: "#7aa2f7",
      MACD: "#7dcfff",
    },
  },
  gruvbox: {
    bg: "#282828",
    text: "#928374",
    grid: "#32302f",
    border: "#3c3836",
    up: "#b8bb26",
    down: "#fb4934",
    line: "#fe8019",
    lineTop: "rgba(254,128,25,0.25)",
    lineBottom: "rgba(254,128,25,0)",
    volUp: "rgba(184,187,38,0.4)",
    volDown: "rgba(251,73,52,0.4)",
    histUp: "rgba(184,187,38,0.6)",
    histDown: "rgba(251,73,52,0.6)",
    histBase: "#83a598",
    macdLine: "#83a598",
    signal: "#ebdbb2",
    bollOuter: "rgba(254,128,25,0.5)",
    bollMiddle: "rgba(254,128,25,0.8)",
    label: "#fbf1c7",
    indicator: {
      SMA20: "#fabd2f",
      SMA50: "#83a598",
      SMA200: "#d3869b",
      EMA20: "#8ec07c",
      VWAP: "#458588",
      RSI: "#fe8019",
      BOLL: "#fe8019",
      MACD: "#83a598",
    },
  },
  "solarized-light": {
    bg: "#fdf6e3",
    text: "#93a1a1",
    grid: "#eee8d5",
    border: "#d5cdbb",
    up: "#859900",
    down: "#dc322f",
    line: "#b58900",
    lineTop: "rgba(181,137,0,0.22)",
    lineBottom: "rgba(181,137,0,0)",
    volUp: "rgba(133,153,0,0.35)",
    volDown: "rgba(220,50,47,0.35)",
    histUp: "rgba(133,153,0,0.55)",
    histDown: "rgba(220,50,47,0.55)",
    histBase: "#268bd2",
    macdLine: "#268bd2",
    signal: "#586e75",
    bollOuter: "rgba(181,137,0,0.5)",
    bollMiddle: "rgba(181,137,0,0.8)",
    label: "#073642",
    indicator: {
      SMA20: "#cb4b16",
      SMA50: "#268bd2",
      SMA200: "#d33682",
      EMA20: "#6c71c4",
      VWAP: "#2aa198",
      RSI: "#b58900",
      BOLL: "#b58900",
      MACD: "#268bd2",
    },
  },
};