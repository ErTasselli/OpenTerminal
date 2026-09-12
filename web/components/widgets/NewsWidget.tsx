"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet } from "../../lib/api";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

type NewsItem = { title: string; link: string; publisher: string; publishedAt: string | null };

export default function NewsWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [mode, setMode] = useState<"symbol" | "global">("symbol");

  const { data = [], isLoading } = useQuery({
    queryKey: ["news", mode, symbol],
    queryFn: () => apiGet<NewsItem[]>(mode === "symbol" ? `/api/news?symbol=${symbol}` : "/api/news"),
    refetchInterval: 30_000,
  });

  return (
    <div>
      <div className="flex gap-1 p-1">
        <button className={`term-btn ${mode === "symbol" ? "active" : ""}`} onClick={() => setMode("symbol")}>
          {symbol}
        </button>
        <button className={`term-btn ${mode === "global" ? "active" : ""}`} onClick={() => setMode("global")}>
          GLOBAL
        </button>
      </div>
      {isLoading && <div className="p-2 dim">Loading news…</div>}
      {data.map((n, i) => (
        <a
          key={i}
          href={n.link}
          target="_blank"
          rel="noreferrer"
          className="block px-2 py-1 border-b border-[var(--table-border)] hover:bg-[var(--hover)]"
        >
          <div className="truncate">{n.title}</div>
          <div className="dim text-[10px]">
            {n.publisher}
            {n.publishedAt ? " · " + new Date(n.publishedAt).toLocaleString() : ""}
          </div>
        </a>
      ))}
    </div>
  );
}
