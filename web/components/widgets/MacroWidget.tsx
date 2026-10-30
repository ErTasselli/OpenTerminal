"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, pctClass } from "../../lib/api";
import { pollUnlessLive, useLiveMacro } from "../../lib/live";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";
import { useTerminal } from "../../store/terminal";
import Flash from "../Flash";

type MacroData = {
  yields: Array<{ tenor: string; value: number | null }>;
  vix: number | null;
  indexes: Array<{ symbol: string; label: string; price: number | null; changePercent: number | null }>;
  policyRate: number | null;
  inflation: number | null;
};

export default function MacroWidget() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [region, setRegion] = useState<"us" | "eu">("us");
  const live = useLiveMacro<MacroData>(region);
  const { data: polled, error: pollError } = useQuery({
    queryKey: ["macro", region],
    queryFn: () => apiGet<MacroData>(`/api/macro?region=${region}`),
    refetchInterval: pollUnlessLive(live.connected),
  });
  const data = live.data ?? polled;
  const error = data ? null : pollError;

  return (
    <div>
      <div className="flex gap-1 p-1">
        {(["us", "eu"] as const).map((r) => (
          <button key={r} className={`term-btn ${region === r ? "active" : ""}`} onClick={() => setRegion(r)}>
            {r.toUpperCase()}
          </button>
        ))}
      </div>
      {error ? (
        <div className="p-2 down">Error: {(error as Error).message}</div>
      ) : !data ? (
        <div className="p-2 dim">Loading macro data…</div>
      ) : (
        <MacroBody data={data} region={region} setActiveSymbol={setActiveSymbol} />
      )}
    </div>
  );
}

function MacroBody({
  data,
  region,
  setActiveSymbol,
}: {
  data: MacroData;
  region: "us" | "eu";
  setActiveSymbol: (s: string) => void;
}) {
  return (
    <div>
      <div className="px-2 py-1 dim text-[10px] uppercase flex justify-between">
        <span>{region === "eu" ? "Euro Area AAA Yield Curve" : "US Treasury Yield Curve"}</span>
        {region === "us" && data.vix !== null && (
          <span className="cursor-pointer" onClick={() => setActiveSymbol("^VIX")}>
            VIX <Flash value={data.vix} className="amber">{fmt(data.vix, 2)}</Flash>
          </span>
        )}
        {region === "eu" && (data.policyRate !== null || data.inflation !== null) && (
          <span>
            {data.policyRate !== null && (
              <>ECB depo <Flash value={data.policyRate} className="amber">{fmt(data.policyRate, 2)}%</Flash></>
            )}
            {data.inflation !== null && (
              <>
                {" "}HICP <Flash value={data.inflation} className="amber">{fmt(data.inflation, 1)}%</Flash>
              </>
            )}
          </span>
        )}
      </div>
      <div className="h-24 px-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.yields} margin={{ top: 4, right: 12, bottom: 0, left: -22 }}>
            <XAxis dataKey="tenor" stroke="#808080" fontSize={9} />
            <YAxis stroke="#808080" fontSize={9} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ background: "#111", border: "1px solid #262626", fontSize: 10 }}
              labelStyle={{ color: "#808080" }}
            />
            <Line type="monotone" dataKey="value" stroke="#ff9900" strokeWidth={1.5} dot={{ r: 2 }} />
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
