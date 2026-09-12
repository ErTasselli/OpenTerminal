"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, fmtBig } from "../../lib/api";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

type OptionRow = {
  strike: number | null; lastPrice: number | null; bid: number | null; ask: number | null;
  volume: number | null; openInterest: number | null; impliedVolatility?: number | null; inTheMoney: boolean;
};
type Chain = {
  symbol: string; underlyingPrice: number | null; expirationDates: string[];
  selectedDate: string | null; calls: OptionRow[]; puts: OptionRow[];
};

export default function OptionsWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [expiry, setExpiry] = useState<string | undefined>();

  const { data, error, isLoading } = useQuery({
    queryKey: ["options", symbol, expiry],
    queryFn: () => apiGet<Chain>(`/api/options/${symbol}${expiry ? `?expiry=${encodeURIComponent(expiry)}` : ""}`),
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
        <span className="dim ml-2">Expiry</span>
        <select
          value={expiry ?? data.selectedDate ?? ""}
          onChange={(e) => setExpiry(e.target.value)}
        >
          {data.expirationDates.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th colSpan={5} className="!text-center up">CALLS</th>
            <th className="!text-center">STRIKE</th>
            <th colSpan={5} className="!text-center down">PUTS</th>
          </tr>
          <tr>
            <th>Last</th><th>Bid</th><th>Ask</th><th>Vol</th><th>OI · IV</th>
            <th></th>
            <th>Last</th><th>Bid</th><th>Ask</th><th>Vol</th><th>OI · IV</th>
          </tr>
        </thead>
        <tbody>
          {strikes.map((strike) => {
            const { call, put } = byStrike.get(strike)!;
            return (
              <tr key={strike}>
                <td className={call?.inTheMoney ? "bg-[var(--itm-call)]" : ""}>{fmt(call?.lastPrice)}</td>
                <td className={call?.inTheMoney ? "bg-[var(--itm-call)]" : ""}>{fmt(call?.bid)}</td>
                <td className={call?.inTheMoney ? "bg-[var(--itm-call)]" : ""}>{fmt(call?.ask)}</td>
                <td className={call?.inTheMoney ? "bg-[var(--itm-call)]" : ""}>{fmtBig(call?.volume)}</td>
                <td className={call?.inTheMoney ? "bg-[var(--itm-call)]" : ""}>
                  {fmtBig(call?.openInterest)} · {call?.impliedVolatility ? fmt(call.impliedVolatility * 100, 0) + "%" : "—"}
                </td>
                <td className="!text-center font-bold amber">{fmt(strike)}</td>
                <td className={put?.inTheMoney ? "bg-[var(--itm-put)]" : ""}>{fmt(put?.lastPrice)}</td>
                <td className={put?.inTheMoney ? "bg-[var(--itm-put)]" : ""}>{fmt(put?.bid)}</td>
                <td className={put?.inTheMoney ? "bg-[var(--itm-put)]" : ""}>{fmt(put?.ask)}</td>
                <td className={put?.inTheMoney ? "bg-[var(--itm-put)]" : ""}>{fmtBig(put?.volume)}</td>
                <td className={put?.inTheMoney ? "bg-[var(--itm-put)]" : ""}>
                  {fmtBig(put?.openInterest)} · {put?.impliedVolatility ? fmt(put.impliedVolatility * 100, 0) + "%" : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
