"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, fmtBig } from "../../lib/api";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

type InsiderTransaction = {
  filingDate: string;
  transactionDate: string;
  ownerName: string;
  ownerTitle: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  transactionCode: string;
  acquiredDisposed: "A" | "D" | null;
  shares: number | null;
  pricePerShare: number | null;
  value: number | null;
  sharesOwnedAfter: number | null;
};

// SEC's single-letter transaction codes, the ones that actually show up in practice.
const CODE_LABEL: Record<string, string> = {
  P: "Open market buy",
  S: "Open market sale",
  A: "Grant/award",
  M: "Option exercise",
  G: "Gift",
  F: "Tax withholding",
  C: "Conversion",
  D: "Disposition to issuer",
};

export default function InsiderWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["insider", symbol],
    queryFn: () => apiGet<InsiderTransaction[]>(`/api/insider/${symbol}`),
    staleTime: 3_600_000,
  });

  if (error) return <div className="p-2 down">Error: {(error as Error).message}</div>;
  if (isLoading) return <div className="p-2 dim">Loading insider transactions for {symbol}…</div>;

  return (
    <div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Insider</th>
            <th>Title</th>
            <th>Type</th>
            <th>Shares</th>
            <th>Price</th>
            <th>Value</th>
            <th>Owned After</th>
          </tr>
        </thead>
        <tbody>
          {data.map((t, i) => (
            <tr key={`${t.ownerName}-${t.transactionDate}-${i}`}>
              <td className="!text-left dim whitespace-nowrap">{t.transactionDate}</td>
              <td className="!text-left">{t.ownerName}</td>
              <td className="!text-left dim truncate max-w-[140px]" title={t.ownerTitle ?? ""}>
                {t.ownerTitle ?? (t.isDirector ? "Director" : t.isTenPercentOwner ? "10%+ Owner" : "—")}
              </td>
              <td className={t.acquiredDisposed === "A" ? "up" : t.acquiredDisposed === "D" ? "down" : "dim"}>
                {CODE_LABEL[t.transactionCode] ?? t.transactionCode}
              </td>
              <td>{fmtBig(t.shares)}</td>
              <td>{fmt(t.pricePerShare)}</td>
              <td>{fmtBig(t.value)}</td>
              <td className="dim">{fmtBig(t.sharesOwnedAfter)}</td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td colSpan={8} className="dim p-3">
                No recent open-market insider transactions for {symbol}.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
