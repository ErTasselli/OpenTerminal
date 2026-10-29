"use client";

import { useT } from "../../lib/i18n";
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
  const t = useT();
  const symbol = useWidgetSymbol(widget);
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["insider", symbol],
    queryFn: () => apiGet<InsiderTransaction[]>(`/api/insider/${encodeURIComponent(symbol)}`),
    staleTime: 3_600_000,
  });

  if (error) return <div className="p-2 down">{t("Error:")} {(error as Error).message}</div>;
  if (isLoading) return <div className="p-2 dim">{t("Loading insider transactions for")} {symbol}…</div>;

  return (
    <div>
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("Date")}</th>
            <th>{t("Insider")}</th>
            <th>{t("Title")}</th>
            <th>{t("Type")}</th>
            <th>{t("Shares")}</th>
            <th>{t("Price")}</th>
            <th>{t("Value")}</th>
            <th>{t("Owned After")}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((tx, i) => (
            <tr key={`${tx.ownerName}-${tx.transactionDate}-${i}`}>
              <td className="!text-start dim whitespace-nowrap">{tx.transactionDate}</td>
              <td className="!text-start">{tx.ownerName}</td>
              <td className="!text-start dim truncate max-w-[140px]" title={tx.ownerTitle ?? ""}>
                {tx.ownerTitle ?? (tx.isDirector ? t("Director") : tx.isTenPercentOwner ? t("10%+ Owner") : "—")}
              </td>
              <td className={tx.acquiredDisposed === "A" ? "up" : tx.acquiredDisposed === "D" ? "down" : "dim"}>
                {t(CODE_LABEL[tx.transactionCode] ?? tx.transactionCode)}
              </td>
              <td>{fmtBig(tx.shares)}</td>
              <td>{fmt(tx.pricePerShare)}</td>
              <td>{fmtBig(tx.value)}</td>
              <td className="dim">{fmtBig(tx.sharesOwnedAfter)}</td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td colSpan={8} className="dim p-3">
                {t("No recent open-market insider transactions for")} {symbol}.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
