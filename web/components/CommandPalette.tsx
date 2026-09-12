"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiGet } from "../lib/api";
import { useTerminal } from "../store/terminal";

type SearchResult = { symbol: string; name: string; exchange: string; type: string };

export default function CommandPalette() {
  const open = useTerminal((s) => s.commandOpen);
  const setOpen = useTerminal((s) => s.setCommandOpen);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const addToWatchlist = useTerminal((s) => s.addToWatchlist);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: results = [] } = useQuery({
    queryKey: ["search", query],
    queryFn: () => apiGet<SearchResult[]>(`/api/search?q=${encodeURIComponent(query)}`),
    enabled: open && query.trim().length > 0,
    staleTime: 300_000,
  });

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => setSelected(0), [results.length]);

  if (!open) return null;

  const pick = (r: SearchResult, watch = false) => {
    setActiveSymbol(r.symbol);
    if (watch) addToWatchlist(r.symbol);
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[560px] bg-[var(--panel)] border border-[var(--amber-dim)]"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") setSelected((s) => Math.min(s + 1, results.length - 1));
            if (e.key === "ArrowUp") setSelected((s) => Math.max(s - 1, 0));
            if (e.key === "Enter" && results[selected]) pick(results[selected], e.shiftKey);
          }}
          placeholder="Ticker, company, ETF, crypto, index…  (Enter = load · Shift+Enter = load + watchlist)"
          className="w-full !border-0 !border-b !border-[var(--border)] px-3 py-2 text-[13px]"
        />
        <div className="max-h-80 overflow-auto">
          {results.map((r, i) => (
            <div
              key={r.symbol + i}
              onClick={() => pick(r)}
              className={`px-3 py-1.5 flex gap-3 cursor-pointer ${
                i === selected ? "bg-[var(--selected)] text-[var(--amber)]" : "hover:bg-[var(--hover)]"
              }`}
            >
              <span className="w-24 font-bold">{r.symbol}</span>
              <span className="flex-1 truncate">{r.name}</span>
              <span className="dim">{r.exchange}</span>
              <span className="dim w-16 text-right">{r.type}</span>
            </div>
          ))}
          {query && results.length === 0 && (
            <div className="px-3 py-3 dim">No results for “{query}”</div>
          )}
        </div>
      </div>
    </div>
  );
}
