"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, fmtBig, pctClass, type Quote } from "../../lib/api";
import { pollUnlessLive, useLiveQuotes } from "../../lib/live";
import { normalizeSymbol, symbolsParam } from "../../lib/symbol";
import { useTerminal } from "../../store/terminal";
import Flash from "../Flash";
import Explain from "../Explain";

/** Named watchlist groups as tabs: click to switch, double-click to rename. */
function GroupTabs() {
  const groups = useTerminal((s) => s.watchlists);
  const active = useTerminal((s) => s.activeWatchlist);
  const setActive = useTerminal((s) => s.setActiveWatchlist);
  const add = useTerminal((s) => s.addWatchlistGroup);
  const rename = useTerminal((s) => s.renameWatchlistGroup);
  const remove = useTerminal((s) => s.removeWatchlistGroup);
  return (
    <div className="flex gap-1 px-1 pt-1 flex-wrap items-center" role="tablist">
      {groups.map((g, i) => (
        <span key={i} className={`term-btn flex items-center gap-1 ${i === active ? "active" : ""}`}>
          <button
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            onDoubleClick={() => {
              const name = window.prompt("Rename watchlist", g.name);
              if (name !== null) rename(i, name);
            }}
            title="Double-click to rename"
          >
            {g.name} <span className="dim">{g.symbols.length}</span>
          </button>
          {groups.length > 1 && i === active && (
            <button
              className="dim hover:text-[var(--down)]"
              aria-label={`delete ${g.name}`}
              onClick={() => {
                if (window.confirm(`Delete watchlist "${g.name}"?`)) remove(i);
              }}
            >
              ×
            </button>
          )}
        </span>
      ))}
      <button
        className="term-btn"
        aria-label="new watchlist"
        onClick={() => {
          const name = window.prompt("New watchlist name");
          if (name !== null) add(name);
        }}
      >
        +
      </button>
    </div>
  );
}

export default function WatchlistWidget() {
  const watchlist = useTerminal((s) => s.watchlist);
  const addToWatchlist = useTerminal((s) => s.addToWatchlist);
  const removeFromWatchlist = useTerminal((s) => s.removeFromWatchlist);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState(false);

  const live = useLiveQuotes(watchlist);
  const { data: polled = [] } = useQuery({
    queryKey: ["watchlist", watchlist.join(",")],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(watchlist)}`),
    enabled: watchlist.length > 0,
    refetchInterval: pollUnlessLive(live.connected),
  });
  // Live values win per symbol; anything the stream hasn't sent yet keeps its polled value.
  const bySymbol = new Map(polled.map((q) => [q.symbol, q]));
  const data = watchlist.map((s) => live.quotes.get(s) ?? bySymbol.get(s)).filter((q): q is Quote => !!q);

  return (
    <div>
      <GroupTabs />
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
          <tr><th>Sym</th><th><Explain term="last">Last</Explain></th><th><Explain>Chg%</Explain></th><th><Explain>Vol</Explain></th><th></th></tr>
        </thead>
        <tbody>
          {watchlist.map((sym) => {
            const q = data.find((d) => d.symbol === sym);
            return (
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
