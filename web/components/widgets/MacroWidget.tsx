"use client";

import { useT } from "../../lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, pctClass } from "../../lib/api";
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
  const t = useT();
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [region, setRegion] = useState<"us" | "eu" | "il">("us");
  const { data, error } = useQuery({
    queryKey: ["macro", region],
    queryFn: () => apiGet<MacroData>(`/api/macro?region=${region}`),
    refetchInterval: 1_000,
  });

  return (
    <div>
      <div className="flex gap-1 p-1">
        {(["us", "eu", "il"] as const).map((r) => (
          <button key={r} className={`term-btn ${region === r ? "active" : ""}`} onClick={() => setRegion(r)}>
            {r.toUpperCase()}
          </button>
        ))}
      </div>
      {error ? (
        <div className="p-2 down">{t("Error:")} {(error as Error).message}</div>
      ) : !data ? (
        <div className="p-2 dim">{t("Loading macro data…")}</div>
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
  region: "us" | "eu" | "il";
  setActiveSymbol: (s: string) => void;
}) {
  const t = useT();
  return (
    <div>
      <div className="px-2 py-1 dim text-[10px] uppercase flex justify-between">
        <span>{region === "il" ? t("Tel Aviv & Shekel") : region === "eu" ? t("Euro Area AAA Yield Curve") : t("US Treasury Yield Curve")}</span>
        {region === "us" && data.vix !== null && (
          <span className="cursor-pointer" onClick={() => setActiveSymbol("^VIX")}>
            VIX <Flash value={data.vix} className="amber">{fmt(data.vix, 2)}</Flash>
          </span>
        )}
        {region === "eu" && (data.policyRate !== null || data.inflation !== null) && (
          <span>
            {data.policyRate !== null && (
              <>{t("ECB depo")} <Flash value={data.policyRate} className="amber">{fmt(data.policyRate, 2)}%</Flash></>
            )}
            {data.inflation !== null && (
              <>
                {" "}HICP <Flash value={data.inflation} className="amber">{fmt(data.inflation, 1)}%</Flash>
              </>
            )}
          </span>
        )}
      </div>
      {data.yields.length > 0 && (
      <div className="h-24 px-1" dir="ltr">
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
      )}
      <table className="data-table">
        <thead>
          <tr><th>{t("Index / Commodity")}</th><th>{t("Last")}</th><th>{t("Chg%")}</th></tr>
        </thead>
        <tbody>
          {data.indexes.map((q) => (
            <tr key={q.symbol} onClick={region === "il" ? undefined : () => setActiveSymbol(q.symbol)}>
              <td>{t(q.label)}</td>
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
