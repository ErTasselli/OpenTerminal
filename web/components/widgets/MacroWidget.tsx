"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, pctClass } from "../../lib/api";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";
import { useTerminal } from "../../store/terminal";
import Flash from "../Flash";

type MacroData = {
  yields: Array<{ tenor: string; value: number | null }>;
  vix: number | null;
  indexes: Array<{ symbol: string; label: string; price: number | null; changePercent: number | null }>;
};

export default function MacroWidget() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const { data, error } = useQuery({
    queryKey: ["macro"],
    queryFn: () => apiGet<MacroData>("/api/macro"),
    refetchInterval: 1_000,
  });

  if (error) return <div className="p-2 down">Error: {(error as Error).message}</div>;
  if (!data) return <div className="p-2 dim">Loading macro data…</div>;

  return (
    <div>
      <div className="px-2 py-1 dim text-[10px] uppercase flex justify-between">
        <span>US Treasury Yield Curve</span>
        {data.vix !== null && (
          <span className="cursor-pointer" onClick={() => setActiveSymbol("^VIX")}>
            VIX <Flash value={data.vix} className="amber">{fmt(data.vix, 2)}</Flash>
          </span>
        )}
      </div>
      <div className="h-24 px-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.yields} margin={{ top: 4, right: 12, bottom: 0, left: -22 }}>
            <XAxis dataKey="tenor" stroke="var(--text-dim)" fontSize={9} />
            <YAxis stroke="var(--text-dim)" fontSize={9} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", fontSize: 10 }}
              labelStyle={{ color: "var(--text-dim)" }}
            />
            <Line type="monotone" dataKey="value" stroke="var(--amber)" strokeWidth={1.5} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <table className="data-table">
        <thead>
          <tr><th>Index / Commodity</th><th>Last</th><th>Chg%</th></tr>
        </thead>
        <tbody>
          {data.indexes.map((q) => (
            <tr key={q.symbol} onClick={() => setActiveSymbol(q.symbol)}>
              <td>{q.label}</td>
              <td><Flash value={q.price}>{fmt(q.price)}</Flash></td>
              <td className={pctClass(q.changePercent)}>
                <Flash value={q.changePercent}>{fmt(q.changePercent)}%</Flash>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
