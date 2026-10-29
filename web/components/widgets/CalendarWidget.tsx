"use client";

import { useT } from "../../lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { apiGet, fmt, pctClass } from "../../lib/api";
import { symbolsParam } from "../../lib/symbol";
import { useTerminal } from "../../store/terminal";

type EconEvent = {
  title: string;
  country: string;
  date: string;
  impact: "Low" | "Medium" | "High" | "Holiday";
  forecast: string | null;
  previous: string | null;
  actual: string | null;
};

type EarningsEntry = {
  symbol: string;
  nextEarningsDate: number | null;
  lastEarningsDate: number | null;
  epsForecast: number | null;
};

const IMPACT_CLASS: Record<EconEvent["impact"], string> = {
  High: "down",
  Medium: "amber",
  Low: "dim",
  Holiday: "dim",
};

const TIMEZONES: Array<{ label: string; zone: string | undefined }> = [
  { label: "Local", zone: undefined },
  { label: "UTC", zone: "UTC" },
  { label: "New York", zone: "America/New_York" },
  { label: "Chicago", zone: "America/Chicago" },
  { label: "London", zone: "Europe/London" },
  { label: "Frankfurt", zone: "Europe/Berlin" },
  { label: "Tokyo", zone: "Asia/Tokyo" },
  { label: "Sydney", zone: "Australia/Sydney" },
];

function EconomicTab() {
  const t = useT();
  const [minImpact, setMinImpact] = useState<"all" | "medium">("medium");
  const [tz, setTz] = useState<string>("Local");

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["econ-calendar"],
    queryFn: () => apiGet<EconEvent[]>("/api/econ-calendar"),
    refetchInterval: 300_000,
  });

  const events = useMemo(
    () => (minImpact === "all" ? data : data.filter((e) => e.impact === "High" || e.impact === "Medium")),
    [data, minImpact]
  );

  if (error) return <div className="p-2 down">{t("Error:")} {(error as Error).message}</div>;
  if (isLoading) return <div className="p-2 dim">{t("Loading calendar…")}</div>;

  const zone = TIMEZONES.find((z) => z.label === tz)?.zone;

  return (
    <div>
      <div className="flex gap-1 p-1 items-center flex-wrap">
        <button className={`term-btn ${minImpact === "medium" ? "active" : ""}`} onClick={() => setMinImpact("medium")}>
          {t("HIGH+MED")}
        </button>
        <button className={`term-btn ${minImpact === "all" ? "active" : ""}`} onClick={() => setMinImpact("all")}>
          {t("ALL")}
        </button>
        <span className="w-2" />
        <select
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          className="term-btn !py-0.5 bg-[var(--panel)] cursor-pointer"
        >
          {TIMEZONES.map((z) => (
            <option key={z.label} value={z.label}>
              {t(z.label)}
            </option>
          ))}
        </select>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("Date")}</th>
            <th>{t("Ccy")}</th>
            <th>{t("Event")}</th>
            <th>{t("Forecast")}</th>
            <th>{t("Previous")}</th>
            <th>{t("Actual")}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={`${e.title}-${e.date}-${i}`}>
              <td className="!text-start dim whitespace-nowrap">
                {new Date(e.date).toLocaleString(undefined, {
                  timeZone: zone,
                  month: "short",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZoneName: "short",
                })}
              </td>
              <td>{e.country}</td>
              <td className={`!text-start ${IMPACT_CLASS[e.impact]}`}>{e.title}</td>
              <td>{e.forecast ?? "—"}</td>
              <td className="dim">{e.previous ?? "—"}</td>
              <td className={e.actual ? "text-[var(--text)]" : "dim"}>{e.actual ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {events.length === 0 && <div className="p-3 dim">{t("No events in this window.")}</div>}
    </div>
  );
}

const fmtDate = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleDateString("en-US") : "—");

type EarningsHistoryRow = {
  fiscalQtrEnd: string;
  dateReported: number;
  eps: number | null;
  consensusForecast: number | null;
  surprisePercent: number | null;
  dayAfterChangePercent: number | null;
};

/** Actual vs forecast: beat = green, miss = red, in-line = white. */
function surpriseClass(row: EarningsHistoryRow): string {
  if (row.eps === null || row.consensusForecast === null) return "dim";
  if (row.eps > row.consensusForecast) return "up";
  if (row.eps < row.consensusForecast) return "down";
  return "text-[var(--text)]";
}

function EarningsHistoryRows({ symbol }: { symbol: string }) {
  const t = useT();
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["earnings-history", symbol],
    queryFn: () => apiGet<EarningsHistoryRow[]>(`/api/earnings-history/${encodeURIComponent(symbol)}`),
    staleTime: 3_600_000,
  });

  if (error) return <div className="p-2 down">{t("Error:")} {(error as Error).message}</div>;
  if (isLoading) return <div className="p-2 dim">{t("Loading history for")} {symbol}…</div>;
  if (data.length === 0) return <div className="p-2 dim">{t("No earnings history for")} {symbol}.</div>;

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>{t("Quarter")}</th>
          <th>{t("Reported")}</th>
          <th>{t("Forecast")}</th>
          <th>{t("Actual")}</th>
          <th>{t("Surprise")}</th>
          <th>{t("Day After")}</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.dateReported}>
            <td className="!text-start dim">{row.fiscalQtrEnd}</td>
            <td className="!text-start dim">{fmtDate(row.dateReported)}</td>
            <td className="dim">{row.consensusForecast != null ? `$${row.consensusForecast.toFixed(2)}` : "—"}</td>
            <td className={surpriseClass(row)}>{row.eps != null ? `$${row.eps.toFixed(2)}` : "—"}</td>
            <td className={surpriseClass(row)}>{row.surprisePercent != null ? `${fmt(row.surprisePercent, 1)}%` : "—"}</td>
            <td className={pctClass(row.dayAfterChangePercent)}>
              {row.dayAfterChangePercent != null ? `${fmt(row.dayAfterChangePercent, 1)}%` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EarningsTab() {
  const t = useT();
  const watchlist = useTerminal((s) => s.watchlist);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["calendar", watchlist],
    queryFn: () => apiGet<EarningsEntry[]>(`/api/calendar?symbols=${symbolsParam(watchlist)}`),
    enabled: watchlist.length > 0,
    staleTime: 3_600_000,
  });

  const sorted = useMemo(
    () =>
      [...data].sort((a, b) => {
        if (a.nextEarningsDate === null && b.nextEarningsDate === null) return 0;
        if (a.nextEarningsDate === null) return 1;
        if (b.nextEarningsDate === null) return -1;
        return a.nextEarningsDate - b.nextEarningsDate;
      }),
    [data]
  );

  if (error) return <div className="p-2 down">{t("Error:")} {(error as Error).message}</div>;
  if (isLoading) return <div className="p-2 dim">{t("Loading earnings…")}</div>;

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>{t("Sym")}</th>
          <th>{t("Last Earnings")}</th>
          <th>{t("Next Earnings")}</th>
          <th>{t("EPS Est.")}</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((e) => (
          <Fragment key={e.symbol}>
            <tr
              onClick={() => setExpanded(expanded === e.symbol ? null : e.symbol)}
              className="cursor-pointer"
              title={t("Click for earnings history")}
            >
              <td className="!text-start text-[var(--text)] font-bold underline decoration-1">{e.symbol}</td>
              <td className="dim">{fmtDate(e.lastEarningsDate)}</td>
              <td className="amber">{fmtDate(e.nextEarningsDate)}</td>
              <td>{e.epsForecast != null ? `$${e.epsForecast.toFixed(2)}` : "—"}</td>
            </tr>
            {expanded === e.symbol && (
              <tr>
                <td colSpan={4} className="!text-start p-0">
                  <EarningsHistoryRows symbol={e.symbol} />
                </td>
              </tr>
            )}
          </Fragment>
        ))}
        {sorted.length === 0 && (
          <tr>
            <td colSpan={4} className="dim p-3">
              {t("No upcoming earnings data for your watchlist.")}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export default function CalendarWidget() {
  const t = useT();
  const [tab, setTab] = useState<"econ" | "earnings">("econ");

  return (
    <div>
      <div className="flex gap-1 p-1">
        <button className={`term-btn ${tab === "econ" ? "active" : ""}`} onClick={() => setTab("econ")}>
          {t("ECONOMIC")}
        </button>
        <button className={`term-btn ${tab === "earnings" ? "active" : ""}`} onClick={() => setTab("earnings")}>
          {t("EARNINGS")}
        </button>
      </div>
      {tab === "econ" ? <EconomicTab /> : <EarningsTab />}
    </div>
  );
}
