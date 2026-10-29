"use client";

import { useT } from "../../lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, fmt, fmtBig } from "../../lib/api";
import { rowGreeks } from "../../lib/blackscholes";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

type OptionRow = {
  strike: number | null; lastPrice: number | null; bid: number | null; ask: number | null;
  volume: number | null; openInterest: number | null; impliedVolatility?: number | null; inTheMoney: boolean;
};
type Chain = {
  symbol: string; underlyingPrice: number | null; expirationDates: string[];
  selectedDate: string | null; calls: OptionRow[]; puts: OptionRow[];
};

function expiryTimestamp(label: string): number {
  if (!label) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return Date.parse(label + "T20:00:00Z");
  const now = new Date();
  let ts = Date.parse(`${label} ${now.getUTCFullYear()} 20:00:00 UTC`);
  // A label that already passed this year (e.g. "Jan 16" in December) means next year.
  if (ts < now.getTime() - 2 * 86_400_000) ts = Date.parse(`${label} ${now.getUTCFullYear() + 1} 20:00:00 UTC`);
  return ts;
}

export default function OptionsWidget({ widget }: { widget: WidgetInstance }) {
  const t = useT();
  const symbol = useWidgetSymbol(widget);
  const [expiry, setExpiry] = useState<string | undefined>();
  const [showGreeks, setShowGreeks] = useState(false);

  const { data, error, isLoading } = useQuery({
    queryKey: ["options", symbol, expiry],
    queryFn: () => apiGet<Chain>(`/api/options/${encodeURIComponent(symbol)}${expiry ? `?expiry=${encodeURIComponent(expiry)}` : ""}`),
    refetchInterval: 20_000,
    retry: 0,
  });

  if (error)
    return (
      <div className="p-2">
        <div className="down">{t("Option chain unavailable for")} {symbol}</div>
        <div className="dim">{(error as Error).message}</div>
      </div>
    );
  if (isLoading || !data) return <div className="p-2 dim">{t("Loading option chain…")}</div>;

  const byStrike = new Map<number, { call?: OptionRow; put?: OptionRow }>();
  for (const c of data.calls) if (c.strike !== null) byStrike.set(c.strike, { ...byStrike.get(c.strike), call: c });
  for (const p of data.puts) if (p.strike !== null) byStrike.set(p.strike, { ...byStrike.get(p.strike), put: p });
  const strikes = [...byStrike.keys()].sort((a, b) => a - b);

  const expirySel = expiry ?? data.selectedDate ?? "";
  // Expiry labels arrive as "Oct 19" (or ISO); options expire at the US close
  // (~20:00 UTC). Floor T at one hour so it never hits 0.
  const T = Math.max((expiryTimestamp(expirySel) - Date.now()) / (365 * 86_400_000), 1 / (365 * 24));
  const S = data.underlyingPrice;

  const cells = (row: OptionRow | undefined, isCall: boolean) => {
    const bg = row?.inTheMoney ? (isCall ? "bg-[#0d2010]" : "bg-[#200d0d]") : "";
    const g = showGreeks && row && S ? rowGreeks(isCall, row, S, T) : null;
    const iv = g ? g.iv : row?.impliedVolatility ?? null;
    return [
      <td key="l" className={bg}>{fmt(row?.lastPrice)}</td>,
      <td key="b" className={bg}>{fmt(row?.bid)}</td>,
      <td key="a" className={bg}>{fmt(row?.ask)}</td>,
      <td key="v" className={bg}>{fmtBig(row?.volume)}</td>,
      <td key="o" className={bg}>
        {fmtBig(row?.openInterest)} · {iv ? fmt(iv * 100, 0) + "%" : "—"}
      </td>,
      ...(showGreeks
        ? [
            <td key="d" className={bg}>{g ? fmt(g.delta, 3) : "—"}</td>,
            <td key="g" className={bg}>{g ? fmt(g.gamma, 4) : "—"}</td>,
            <td key="t" className={bg}>{g ? fmt(g.theta, 3) : "—"}</td>,
            <td key="x" className={bg}>{g ? fmt(g.vega, 3) : "—"}</td>,
          ]
        : []),
    ];
  };
  const span = showGreeks ? 9 : 5;
  const head = (
    <>
      <th>{t("Last")}</th><th>{t("Bid")}</th><th>{t("Ask")}</th><th>{t("Vol")}</th><th>OI · IV</th>
      {showGreeks && (<><th>Δ</th><th>Γ</th><th>Θ</th><th>Vega</th></>)}
    </>
  );

  return (
    <div>
      <div className="flex gap-2 items-center p-1">
        <span className="dim">{t("Underlying")}</span>
        <span className="amber font-bold">{fmt(data.underlyingPrice)}</span>
        <span className="dim ms-2">{t("Expiry")}</span>
        <select value={expirySel} onChange={(e) => setExpiry(e.target.value)}>
          {data.expirationDates.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <button
          className={`term-btn ${showGreeks ? "active" : ""}`}
          title={t("Black-Scholes Greeks (approximate, American options)")}
          onClick={() => setShowGreeks(!showGreeks)}
        >
          {t("GREEKS")}
        </button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th colSpan={span} className="!text-center up">{t("CALLS")}</th>
            <th className="!text-center">{t("STRIKE")}</th>
            <th colSpan={span} className="!text-center down">{t("PUTS")}</th>
          </tr>
          <tr>
            {head}
            <th></th>
            {head}
          </tr>
        </thead>
        <tbody>
          {strikes.map((strike) => {
            const { call, put } = byStrike.get(strike)!;
            return (
              <tr key={strike}>
                {cells(call, true)}
                <td className="!text-center font-bold amber">{fmt(strike)}</td>
                {cells(put, false)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
