"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet, fmt, fmtBig, pctClass, type Quote } from "../../lib/api";
import { normalizeSymbol, symbolsParam } from "../../lib/symbol";
import { sortWatchlistRows, type WatchlistSortKey } from "../../lib/watchlistSort";
import { useTerminal } from "../../store/terminal";
import Flash from "../Flash";

export default function WatchlistWidget() {
  const watchlist = useTerminal((s) => s.watchlist);
  const addToWatchlist = useTerminal((s) => s.addToWatchlist);
  const removeFromWatchlist = useTerminal((s) => s.removeFromWatchlist);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [sort, setSort] = useState<WatchlistSortKey>("symbol");
  const [dir, setDir] = useState<"asc" | "desc">("asc");

  const { data = [] } = useQuery({
    queryKey: ["watchlist", watchlist.join(",")],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(watchlist)}`),
    enabled: watchlist.length > 0,
    refetchInterval: 1_000,
  });

  // Reset to the default sort (Sym ascending) whenever the watched symbol
  // set itself changes (add/remove), rather than only on first mount.
  useEffect(() => {
    setSort("symbol");
    setDir("asc");
  }, [watchlist.join(",")]);

  const rows = watchlist.map((sym) => {
    const q = data.find((d) => d.symbol === sym);
    return { symbol: sym, price: q?.price, changePercent: q?.changePercent, volume: q?.volume, quote: q };
  });
  const sortedRows = sortWatchlistRows(rows, sort, dir);

  const th = (key: WatchlistSortKey, label: string) => (
    <th
      onClick={() => {
        if (sort === key) setDir(dir === "asc" ? "desc" : "asc");
        else setSort(key);
      }}
      className={sort === key ? "!text-[var(--amber)]" : ""}
    >
      {label} {sort === key ? (dir === "desc" ? "▼" : "▲") : ""}
    </th>
  );

  return (
    <div>
      <form
        className="flex gap-1 p-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim()) return;
          const sym = normalizeSymbol(input);
          if (!sym) {
            setInvalid(true);
            return;
          }
          addToWatchlist(sym);
          setInput("");
        }}
      >
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setInvalid(false);
          }}
          placeholder="Add ticker…"
          title={invalid ? "Not a valid ticker symbol" : undefined}
          aria-invalid={invalid}
          className={`flex-1 ${invalid ? "!border-[var(--down)]" : ""}`}
        />
        <button className="term-btn" type="submit">+</button>
      </form>
      <table className="data-table">
        <thead>
          <tr>
            {th("symbol", "Sym")}
            {th("price", "Last")}
            {th("changePercent", "Chg%")}
            {th("volume", "Vol")}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(({ symbol: sym, quote: q }) => (
            <tr key={sym} onClick={() => setActiveSymbol(sym)}>
              <td className="font-bold">{sym}</td>
              <td><Flash value={q?.price}>{fmt(q?.price)}</Flash></td>
              <td className={pctClass(q?.changePercent)}>
                <Flash value={q?.changePercent}>{fmt(q?.changePercent)}%</Flash>
              </td>
              <td>{fmtBig(q?.volume)}</td>
              <td>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromWatchlist(sym);
                  }}
                  className="dim hover:text-[var(--down)]"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
