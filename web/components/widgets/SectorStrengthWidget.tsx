"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, pctClass } from "../../lib/api";
import { useTerminal } from "../../store/terminal";
import Explain from "../Explain";

type Period = "d1" | "w1" | "m1" | "m3";
type Returns = Record<Period, number | null>;
type Row = { symbol: string; name: string; returns: Returns; rs: Returns };
type Payload = { benchmark: { symbol: string; returns: Returns }; sectors: Row[]; asOf: string };

const PERIODS: Array<[Period, string]> = [["d1", "1D"], ["w1", "1W"], ["m1", "1M"], ["m3", "3M"]];

/** Signed percent/points with a + for gains, so leaders and laggards read at a glance. */
const signed = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${fmt(n)}`);

export default function SectorStrengthWidget() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [mode, setMode] = useState<"rs" | "returns">("rs");
  const [sortBy, setSortBy] = useState<Period>("m1");

  const { data, error, isLoading } = useQuery({
    queryKey: ["sector-strength"],
    queryFn: () => apiGet<Payload>("/api/sector-strength"),
    refetchInterval: 15_000,
  });

  if (error) return <div className="p-2 down">{(error as Error).message}</div>;
  if (isLoading || !data) return <div className="p-2 dim">Loading sector strength…</div>;

  const value = (r: Row, p: Period) => (mode === "rs" ? r.rs[p] : r.returns[p]);
  const rows = [...data.sectors].sort((a, b) => (value(b, sortBy) ?? -Infinity) - (value(a, sortBy) ?? -Infinity));
  // Bar length scaled to the largest magnitude in the sorted column.
  const scale = Math.max(0.01, ...rows.map((r) => Math.abs(value(r, sortBy) ?? 0)));

  return (
    <div>
      <div className="flex gap-1 p-1 items-center">
        <button className={`term-btn ${mode === "rs" ? "active" : ""}`} onClick={() => setMode("rs")}>
          <Explain nested term="relativeStrength">VS {data.benchmark.symbol}</Explain>
        </button>
        <button className={`term-btn ${mode === "returns" ? "active" : ""}`} onClick={() => setMode("returns")}>
          ABSOLUTE
        </button>
        <span className="dim text-[10px] ml-auto">
          {data.benchmark.symbol} {PERIODS.map(([p, l]) => `${l} ${signed(data.benchmark.returns[p])}%`).join("  ")}
        </span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th className="!text-left">Sector</th>
            {PERIODS.map(([p, label]) => (
              <th key={p} onClick={() => setSortBy(p)} className={`cursor-pointer ${sortBy === p ? "!text-[var(--amber)]" : ""}`}>
                {label} {sortBy === p ? "▼" : ""}
              </th>
            ))}
            <th className="w-24"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = value(r, sortBy);
            return (
              <tr key={r.symbol} className="cursor-pointer hover:bg-[#161616]" onClick={() => setActiveSymbol(r.symbol)}>
                <td className="!text-left">
                  <span className="amber">{r.symbol}</span> <span className="dim">{r.name}</span>
                </td>
                {PERIODS.map(([p]) => (
                  <td key={p} className={pctClass(value(r, p))}>
                    {signed(value(r, p))}
                    {mode === "returns" ? "%" : ""}
                  </td>
                ))}
                <td>
                  <div className="h-2 bg-[#161616] relative">
                    {v !== null && (
                      <div
                        className={`absolute top-0 h-2 ${v >= 0 ? "bg-[var(--up)] left-1/2" : "bg-[var(--down)] right-1/2"}`}
                        style={{ width: `${(Math.abs(v) / scale) * 50}%` }}
                      />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="dim text-[10px] px-2 py-1">
        {mode === "rs" ? "Points above/below SPY over each period." : "Total return over each period."} Click a sector to chart it.
      </div>
    </div>
  );
}
