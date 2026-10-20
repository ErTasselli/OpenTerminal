"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, fmtBig } from "../../lib/api";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import Explain from "../Explain";

type OptionRow = {
  strike: number | null; lastPrice: number | null; bid: number | null; ask: number | null;
  volume: number | null; openInterest: number | null; impliedVolatility?: number | null; inTheMoney: boolean;
  greeks?: { iv: number; delta: number; gamma: number; theta: number; vega: number } | null;
};
type Chain = {
  symbol: string; underlyingPrice: number | null; expirationDates: string[];
  selectedDate: string | null; calls: OptionRow[]; puts: OptionRow[]; riskFreeRate?: number;
};

const MARKET_COLS = ["Last", "Bid", "Ask", "Vol", "OI · IV"];
const GREEK_COLS = ["IV", "Δ", "Γ", "Θ/day", "Vega"];

/** The 5 cells for one side of a strike row, in the selected view. */
function SideCells({ row, view, itmClass }: { row?: OptionRow; view: "market" | "greeks"; itmClass: string }) {
  const cls = row?.inTheMoney ? itmClass : "";
  const g = row?.greeks;
  const values =
    view === "market"
      ? [
          fmt(row?.lastPrice), fmt(row?.bid), fmt(row?.ask), fmtBig(row?.volume),
          `${fmtBig(row?.openInterest)} · ${row?.impliedVolatility ? fmt(row.impliedVolatility * 100, 0) + "%" : "—"}`,
        ]
      : g
      ? [fmt(g.iv * 100, 1) + "%", fmt(g.delta, 3), fmt(g.gamma, 4), fmt(g.theta, 3), fmt(g.vega, 3)]
      : ["—", "—", "—", "—", "—"];
  return (
    <>
      {values.map((v, i) => (
        <td key={i} className={cls}>{v}</td>
      ))}
    </>
  );
}

export default function OptionsWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [expiry, setExpiry] = useState<string | undefined>();
  const [view, setView] = useState<"market" | "greeks">("market");

  const { data, error, isLoading } = useQuery({
    queryKey: ["options", symbol, expiry],
    queryFn: () => apiGet<Chain>(`/api/options/${encodeURIComponent(symbol)}${expiry ? `?expiry=${encodeURIComponent(expiry)}` : ""}`),
    refetchInterval: 20_000,
    retry: 0,
  });

  if (error)
    return (
      <div className="p-2">
        <div className="down">Option chain unavailable for {symbol}</div>
        <div className="dim">{(error as Error).message}</div>
      </div>
    );
  if (isLoading || !data) return <div className="p-2 dim">Loading option chain…</div>;

  const byStrike = new Map<number, { call?: OptionRow; put?: OptionRow }>();
  for (const c of data.calls) if (c.strike !== null) byStrike.set(c.strike, { ...byStrike.get(c.strike), call: c });
  for (const p of data.puts) if (p.strike !== null) byStrike.set(p.strike, { ...byStrike.get(p.strike), put: p });
  const strikes = [...byStrike.keys()].sort((a, b) => a - b);

  return (
    <div>
      <div className="flex gap-2 items-center p-1">
        <span className="dim">Underlying</span>
        <span className="amber font-bold">{fmt(data.underlyingPrice)}</span>
        <Explain className="dim ml-2">Expiry</Explain>
        <select
          value={expiry ?? data.selectedDate ?? ""}
          onChange={(e) => setExpiry(e.target.value)}
        >
          {data.expirationDates.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <button
          className={`term-btn ml-auto ${view === "greeks" ? "active" : ""}`}
          onClick={() => setView(view === "market" ? "greeks" : "market")}
          title={`Black-Scholes model values (European approximation; r = ${data.riskFreeRate != null ? fmt(data.riskFreeRate * 100, 2) + "%" : "n/a"} 3M T-bill)`}
        >
          {view === "market" ? "GREEKS" : "MARKET"}
        </button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th colSpan={5} className="!text-center up"><Explain term="call">CALLS</Explain></th>
            <th className="!text-center"><Explain term="strike">STRIKE</Explain></th>
            <th colSpan={5} className="!text-center down"><Explain term="put">PUTS</Explain></th>
          </tr>
          <tr>
            {(view === "market" ? MARKET_COLS : GREEK_COLS).map((c) => <th key={`c-${c}`}><Explain>{c}</Explain></th>)}
            <th></th>
            {(view === "market" ? MARKET_COLS : GREEK_COLS).map((c) => <th key={`p-${c}`}><Explain>{c}</Explain></th>)}
          </tr>
        </thead>
        <tbody>
          {strikes.map((strike) => {
            const { call, put } = byStrike.get(strike)!;
            return (
              <tr key={strike}>
                <SideCells row={call} view={view} itmClass="bg-[#0d2010]" />
                <td className="!text-center font-bold amber">{fmt(strike)}</td>
                <SideCells row={put} view={view} itmClass="bg-[#200d0d]" />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
