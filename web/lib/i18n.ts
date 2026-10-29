"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { HE } from "./he";

export type Lang = "en" | "he";

type LangState = { lang: Lang; setLang: (l: Lang) => void };

export const useLang = create<LangState>()(
  persist((set) => ({ lang: "en", setLang: (lang) => set({ lang }) }), { name: "openterminal-lang" })
);

/** Translate an English UI string. English text is the key; a missing entry
 * falls back to the English original, so untranslated strings never break. */
export function translate(lang: Lang, text: string): string {
  return lang === "he" ? HE[text] ?? text : text;
}

/** Returns `t(text)` bound to the current language, plus the text direction. */
export function useT() {
  const lang = useLang((s) => s.lang);
  const t = (text: string) => translate(lang, text);
  return Object.assign(t, { lang, dir: (lang === "he" ? "rtl" : "ltr") as "rtl" | "ltr" });
}
