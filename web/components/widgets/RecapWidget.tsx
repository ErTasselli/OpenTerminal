"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, pctClass } from "../../lib/api";
import { useTerminal } from "../../store/terminal";
import Flash from "../Flash";

type RecapRow = { symbol: string; name: string; changePercent: number | null };
type RecapIndex = { symbol: string; label: string; price: number | null; changePercent: number | null };
type RecapSector = { sector: string; avgChangePercent: number };
type RecapNews = { title: string; link: string; publisher: string; publishedAt: string | null };

type Recap = {
  summary: string;
  updatedAt: string;
  indexes: RecapIndex[];
  vix: number | null;
  gainers: RecapRow[];
  losers: RecapRow[];
  sectors: RecapSector[];
  news: RecapNews[];
};

export default function RecapWidget() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const { data, error } = useQuery({
    queryKey: ["recap"],
    queryFn: () => apiGet<Recap>("/api/recap"),
    refetchInterval: 15_000,
  });

  if (error) return <div className="p-2 down">Error: {(error as Error).message}</div>;
  if (!data) return <div className="p-2 dim">Loading market recap…</div>;

  return (
    <div>
      <div className="px-2 py-1 flex justify-between items-baseline">
        <span className="dim text-[10px] uppercase">Market Recap</span>
        <span className="dim text-[9px]">
          Updated {new Date(data.updatedAt).toLocaleTimeString()}
        </span>
      </div>

      <div className="px-2 pb-2 text-[12px] leading-relaxed border-b border-[#161616]">{data.summary}</div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Index</th>
            <th>Last</th>
            <th>Chg%</th>
          </tr>
        </thead>
        <tbody>
          {data.indexes.map((q) => (
            <tr key={q.symbol} onClick={() => setActiveSymbol(q.symbol)}>
              <td>{q.label}</td>
              <td>
                <Flash value={q.price}>{fmt(q.price)}</Flash>
              </td>
              <td className={pctClass(q.changePercent)}>
                <Flash value={q.changePercent}>{fmt(q.changePercent)}%</Flash>
              </td>
            </tr>
          ))}
          {data.vix !== null && (
            <tr className="cursor-pointer" onClick={() => setActiveSymbol("^VIX")}>
              <td>VIX</td>
              <td colSpan={2}>
                <Flash value={data.vix} className="amber">
                  {fmt(data.vix, 2)}
                </Flash>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-x-2 px-2 py-1">
        <div>
          <div className="dim text-[10px] uppercase mb-1">Top gainers</div>
          {data.gainers.map((r) => (
            <div key={r.symbol} className="flex justify-between cursor-pointer hover:bg-[#161616]" onClick={() => setActiveSymbol(r.symbol)}>
              <span className="truncate mr-1">{r.symbol}</span>
              <span className={pctClass(r.changePercent)}>
                <Flash value={r.changePercent}>{fmt(r.changePercent)}%</Flash>
              </span>
            </div>
          ))}
        </div>
        <div>
          <div className="dim text-[10px] uppercase mb-1">Top losers</div>
          {data.losers.map((r) => (
            <div key={r.symbol} className="flex justify-between cursor-pointer hover:bg-[#161616]" onClick={() => setActiveSymbol(r.symbol)}>
              <span className="truncate mr-1">{r.symbol}</span>
              <span className={pctClass(r.changePercent)}>
                <Flash value={r.changePercent}>{fmt(r.changePercent)}%</Flash>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="px-2 py-1 border-t border-[#161616]">
        <div className="dim text-[10px] uppercase mb-1">Sector performance</div>
        {data.sectors.map((s) => (
          <div key={s.sector} className="flex justify-between">
            <span className="truncate mr-1">{s.sector}</span>
            <span className={pctClass(s.avgChangePercent)}>{fmt(s.avgChangePercent)}%</span>
          </div>
        ))}
      </div>

      <div className="border-t border-[#161616]">
        <div className="dim text-[10px] uppercase px-2 pt-1">Headlines</div>
        {data.news.map((n, i) => (
          <a
            key={i}
            href={n.link}
            target="_blank"
            rel="noreferrer"
            className="block px-2 py-1 border-b border-[#161616] hover:bg-[#161616]"
          >
            <div className="truncate">{n.title}</div>
            <div className="dim text-[10px]">{n.publisher}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
