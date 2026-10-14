"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";
import { apiGet, fmt, pctClass } from "../../lib/api";
import { symbolsParam } from "../../lib/symbol";
import Flash from "../Flash";
import { useTerminal } from "../../store/terminal";

type FxRow = {
  symbol: string;
  pair: string;
  ticker: string;
  digits: number;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  high: number | null;
  low: number | null;
  perfWeek: number | null;
  perfMonth: number | null;
  perfYtd: number | null;
  perfYear: number | null;
};

type Observado = {
  date: string;
  value: number;
  source: string;
  series: Array<{ date: string; value: number }>;
};

type SearchResult = { symbol: string; name: string; type: string };

function Pct({ value }: { value: number | null }) {
  return <td className={pctClass(value)}>{value === null ? "—" : `${fmt(value)}%`}</td>;
}

export default function FxWidget() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const fxPairs = useTerminal((s) => s.fxPairs);
  const addFxPair = useTerminal((s) => s.addFxPair);
  const removeFxPair = useTerminal((s) => s.removeFxPair);
  const resetFxPairs = useTerminal((s) => s.resetFxPairs);
  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState(false);

  const { data = [], error } = useQuery({
    queryKey: ["fx", fxPairs.join(",")],
    queryFn: () => apiGet<FxRow[]>(`/api/fx?symbols=${symbolsParam(fxPairs)}`),
    enabled: fxPairs.length > 0,
    refetchInterval: 2_000,
  });
  // Published once per banking day — no point polling it like a live quote.
  const { data: observado } = useQuery({
    queryKey: ["fx-observado"],
    queryFn: () => apiGet<Observado>("/api/fx/observado"),
    refetchInterval: 600_000,
    retry: 1,
  });

  // Resolve free text ("usd/brl", "brl", "real") through the same search the
  // command palette uses, taking its best FX match.
  const add = async () => {
    const q = input.trim();
    if (!q) return;
    try {
      const results = await apiGet<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`);
      const hit = results.find((r) => r.type === "forex");
      if (!hit) return setInvalid(true);
      addFxPair(hit.symbol);
      setInput("");
    } catch {
      setInvalid(true);
    }
  };

  const spot = data.find((r) => r.symbol === "USDCLP=X")?.price ?? null;
  const gap = spot !== null && observado ? spot - observado.value : null;

  return (
    <div>
      {observado && (
        <div className="px-2 py-1 border-b border-[var(--border)] flex flex-wrap gap-x-4 gap-y-0.5 items-baseline">
          <span className="dim">
            Dólar observado <span className="text-[9px]">({observado.date})</span>{" "}
            <span className="amber font-bold">{fmt(observado.value)}</span>
          </span>
          {gap !== null && (
            <span className="dim">
              Spot vs obs. <span className={pctClass(gap)}>{gap >= 0 ? "+" : ""}{fmt(gap)}</span>
            </span>
          )}
          <span className="dim text-[9px] ml-auto">{observado.source}</span>
        </div>
      )}
      {observado && observado.series.length > 1 && (
        <div className="h-20 px-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={observado.series} margin={{ top: 4, right: 12, bottom: 0, left: -14 }}>
              <XAxis dataKey="date" stroke="#808080" fontSize={9} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
              <YAxis stroke="#808080" fontSize={9} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ background: "#111", border: "1px solid #262626", fontSize: 10 }}
                labelStyle={{ color: "#808080" }}
                formatter={(v: number) => [fmt(v), "Observado"]}
              />
              <Line type="monotone" dataKey="value" stroke="#ff9900" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <form
        className="flex gap-1 p-1"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setInvalid(false);
          }}
          placeholder="Add pair… (usd/brl, gbp, yen, uf)"
          title={invalid ? "No currency pair matches that" : undefined}
          aria-invalid={invalid}
          className={`flex-1 ${invalid ? "!border-[var(--down)]" : ""}`}
        />
        <button className="term-btn" type="submit">+</button>
        <button className="term-btn" type="button" onClick={resetFxPairs} title="Restore the default pairs">
          ↺
        </button>
      </form>
      {error ? (
        <div className="p-2 down">Error: {(error as Error).message}</div>
      ) : fxPairs.length > 0 && data.length === 0 ? (
        <div className="p-2 dim">Loading FX…</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Pair</th><th>Last</th><th>Chg%</th><th>1W</th><th>1M</th><th>YTD</th><th>1Y</th><th></th></tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.symbol} title={`${r.ticker} — click to chart`} onClick={() => setActiveSymbol(r.symbol)}>
                <td className="!text-left font-bold">{r.pair}</td>
                <td><Flash value={r.price}>{fmt(r.price, r.digits)}</Flash></td>
                <td className={pctClass(r.changePercent)}>
                  <Flash value={r.changePercent}>{r.changePercent === null ? "—" : `${fmt(r.changePercent)}%`}</Flash>
                </td>
                <Pct value={r.perfWeek} />
                <Pct value={r.perfMonth} />
                <Pct value={r.perfYtd} />
                <Pct value={r.perfYear} />
                <td>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFxPair(r.symbol);
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
      )}
    </div>
  );
}
