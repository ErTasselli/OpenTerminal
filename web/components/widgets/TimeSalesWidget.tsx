"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt } from "../../lib/api";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

// Mirrors the pairs the backend's Binance provider supports (server/src/providers/binance.ts).
const CRYPTO_SYMBOLS = new Set([
  "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "DOT", "LINK", "LTC", "MATIC",
]);

type Trade = { id: string; time: number | string; price: number; qty: number | null; isBuy: boolean | null };

const MAX_ROWS = 100;

function CryptoTape({ symbol }: { symbol: string }) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setTrades([]);
    setConnected(false);
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}usdt@trade`);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (ev) => {
      const d = JSON.parse(ev.data);
      const trade: Trade = { id: String(d.t), time: d.T, price: +d.p, qty: +d.q, isBuy: !d.m };
      setTrades((prev) => [trade, ...prev].slice(0, MAX_ROWS));
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [symbol]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-1 dim text-[10px] shrink-0">
        <span className={connected ? "up" : "down"}>{connected ? "● LIVE" : "○ CONNECTING…"}</span>
        <span>{symbol}/USDT · Binance</span>
      </div>
      <table className="data-table">
        <thead>
          <tr><th>Time</th><th>Price</th><th>Size</th></tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id} className="flash-white">
              <td className="!text-left dim">{new Date(t.time as number).toLocaleTimeString()}</td>
              <td className={t.isBuy ? "up" : "down"}>{fmt(t.price)}</td>
              <td>{fmt(t.qty, (t.qty ?? 0) < 1 ? 6 : 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type StockTrade = { time: string; price: number | null; volume: number | null };
type TradesResponse = { session: string | null; trades: StockTrade[] };

/** Nasdaq's marketStatus strings, normalized to a badge label + color. */
function sessionBadge(session: string | null): { label: string; className: string } {
  const s = (session ?? "").toLowerCase();
  if (s.includes("pre")) return { label: "PRE-MARKET", className: "amber" };
  if (s.includes("after") || s.includes("post")) return { label: "AFTER HOURS", className: "amber" };
  if (s.includes("open")) return { label: "OPEN", className: "up" };
  if (s.includes("close")) return { label: "CLOSED", className: "down" };
  return { label: session ?? "UNKNOWN", className: "dim" };
}

function StockTape({ symbol }: { symbol: string }) {
  const { data, error } = useQuery({
    queryKey: ["trades", symbol],
    queryFn: () => apiGet<TradesResponse>(`/api/trades/${symbol}`),
    refetchInterval: 2_000,
  });

  if (error) return <div className="p-2 down">Error: {(error as Error).message}</div>;

  const trades = data?.trades ?? [];
  const badge = sessionBadge(data?.session ?? null);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-1 dim text-[10px] shrink-0">
        <span className={badge.className}>● {badge.label}</span>
        <span>{symbol} · Nasdaq Last Sale</span>
      </div>
      {trades.length === 0 ? (
        <div className="p-3 dim leading-relaxed">
          No prints right now for this session ({badge.label.toLowerCase()}) — this feed only carries data while{" "}
          {symbol} is actively trading. It'll fill in as soon as the next trade prints, including pre-market and
          after-hours activity.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Time</th><th>Price</th><th>Volume</th></tr>
          </thead>
          <tbody>
            {trades.map((t, i) => (
              <tr key={`${t.time}-${t.price}-${t.volume}-${i}`} className={i === 0 ? "flash-white" : undefined}>
                <td className="!text-left dim">{t.time}</td>
                <td>{fmt(t.price)}</td>
                <td>{fmt(t.volume, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function TimeSalesWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  if (CRYPTO_SYMBOLS.has(symbol)) return <CryptoTape symbol={symbol} />;
  return <StockTape symbol={symbol} />;
}
