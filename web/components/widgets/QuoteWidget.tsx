"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, fmtBig, pctClass, type Quote } from "../../lib/api";
import { mergeLiveQuote, useLiveQuotes } from "../../lib/live";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import Flash from "../Flash";

type ShortVolume = { date: string; shortVolume: number; shortExemptVolume: number; totalVolume: number; shortVolumePercent: number };

export default function QuoteWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const { quotes: liveQuotes, connected } = useLiveQuotes([symbol]);
  const { data, error } = useQuery({
    queryKey: ["quote", symbol],
    queryFn: async () => (await apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(symbol)}`))[0],
    // Streaming covers last/bid/ask/volume; keep a slower REST refresh for
    // fundamentals so we don't burn Schwab's 120 req/min budget.
    refetchInterval: connected ? 15_000 : 1_000,
  });
  // FINRA's Reg SHO file only updates once a day (next-morning), so no point polling it fast.
  const { data: shortVol } = useQuery({
    queryKey: ["short-volume", symbol],
    queryFn: () => apiGet<ShortVolume | null>(`/api/short-volume/${encodeURIComponent(symbol)}`),
    staleTime: 3_600_000,
  });

  if (error) return <div className="p-2 down">Error: {(error as Error).message}</div>;
  if (!data) return <div className="p-2 dim">Loading {symbol}…</div>;

  const quote = mergeLiveQuote(data, liveQuotes[symbol]);
  const rows: Array<[string, string, string?]> = [
    ["Open", fmt(quote.open)],
    ["High", fmt(quote.high)],
    ["Low", fmt(quote.low)],
    ["Prev Close", fmt(quote.previousClose)],
    ["Bid", fmt(quote.bid)],
    ["Ask", fmt(quote.ask)],
    ["Volume", fmtBig(quote.volume)],
    ["Avg Vol 3M", fmtBig(quote.avgVolume)],
    ...(shortVol ? ([["Short Vol %", fmt(shortVol.shortVolumePercent, 1) + "%"]] as Array<[string, string]>) : []),
    ["Mkt Cap", fmtBig(quote.marketCap)],
    ["P/E (ttm)", fmt(quote.pe)],
    ["EPS (ttm)", fmt(quote.eps)],
    ["Div Yield", quote.dividendYield !== null ? fmt(quote.dividendYield * 100) + "%" : "—"],
    ["52W High", fmt(quote.week52High)],
    ["52W Low", fmt(quote.week52Low)],
    ["Beta", fmt(quote.beta)],
    ["Shares Out", fmtBig(quote.sharesOutstanding)],
  ];

  return (
    <div className="p-2">
      <div className="flex items-baseline gap-3 mb-1">
        <Flash value={quote.price} className="text-xl font-bold">{fmt(quote.price)}</Flash>
        <Flash value={quote.changePercent} className={`${pctClass(quote.changePercent)} text-sm`}>
          {quote.change !== null && quote.change >= 0 ? "+" : ""}
          {fmt(quote.change)} ({fmt(quote.changePercent)}%)
        </Flash>
        <span className="dim text-[10px] ml-auto">
          {quote.exchange ?? ""} · {quote.currency ?? ""} · {quote.source}
          {connected && quote.source === "schwab-stream" ? " ●" : ""}
        </span>
      </div>
      <div className="dim text-[11px] mb-2 truncate">{quote.name}</div>
      <div className="grid grid-cols-2 gap-x-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between border-b border-[#161616] py-0.5">
            <span className="dim">{label}</span>
            <span>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
