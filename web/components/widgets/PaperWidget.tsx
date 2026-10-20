"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiDelete, apiGet, apiPost, fmt, pctClass, type Quote } from "../../lib/api";
import { useLiveQuotes } from "../../lib/live";
import { normalizeSymbol } from "../../lib/symbol";
import { useTerminal } from "../../store/terminal";
import Explain from "../Explain";

type Position = { symbol: string; quantity: number; avgCost: number; realizedPnl: number };
type Account = { startingCash: number; cash: number; positions: Position[]; reserved: { cash: number; shares: Record<string, number> } };
type Order = {
  id: number; symbol: string; side: "BUY" | "SELL"; type: "market" | "limit" | "stop"; quantity: number;
  limit_price: number | null; stop_price: number | null; status: "open" | "filled" | "cancelled" | "rejected";
  fill_price: number | null; reason: string | null; created_at: string;
};
type OrderType = Order["type"];

const usd = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `$${fmt(n)}`);

export default function PaperWidget() {
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const qc = useQueryClient();
  const [form, setForm] = useState({ symbol: "", side: "BUY" as "BUY" | "SELL", type: "market" as OrderType, quantity: "", price: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 5s: the server engine fills limit/stop orders in the background.
  const { data: acct, error } = useQuery({ queryKey: ["paper"], queryFn: () => apiGet<Account>("/api/paper"), refetchInterval: 5_000 });
  const { data: orders = [] } = useQuery({ queryKey: ["paper-orders"], queryFn: () => apiGet<Order[]>("/api/paper/orders"), refetchInterval: 5_000 });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["paper"] });
    qc.invalidateQueries({ queryKey: ["paper-orders"] });
  };

  const ticketSymbol = normalizeSymbol(form.symbol || activeSymbol) ?? "";
  const held = (acct?.positions ?? []).filter((p) => p.quantity > 0);
  const live = useLiveQuotes([...new Set([...held.map((p) => p.symbol), ticketSymbol].filter(Boolean))]);
  const quote = (s: string): Quote | undefined => live.quotes.get(s);

  const place = useMutation({
    mutationFn: () => {
      const quantity = Number(form.quantity);
      if (!ticketSymbol) throw new Error("enter a valid symbol");
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("quantity must be a positive number");
      const price = Number(form.price);
      if (form.type !== "market" && (!Number.isFinite(price) || price <= 0)) throw new Error(`enter a ${form.type} price`);
      return apiPost<Order>("/api/paper/orders", {
        symbol: ticketSymbol, side: form.side, type: form.type, quantity,
        ...(form.type === "limit" ? { limitPrice: price } : form.type === "stop" ? { stopPrice: price } : {}),
      });
    },
    onSuccess: (o) => {
      setMsg({
        ok: o.status !== "rejected",
        text: o.status === "filled" ? `Filled: ${o.side} ${o.quantity} ${o.symbol} @ ${usd(o.fill_price)}` : o.status === "open" ? `Order placed: waiting for ${o.symbol} to reach your price` : o.reason ?? o.status,
      });
      setForm((f) => ({ ...f, quantity: "", price: "" }));
      refresh();
    },
    onError: (e) => setMsg({ ok: false, text: (e as Error).message }),
  });
  const cancel = useMutation({ mutationFn: (id: number) => apiDelete(`/api/paper/orders/${id}`), onSuccess: refresh });
  const reset = useMutation({ mutationFn: () => apiPost("/api/paper/reset", {}), onSuccess: () => { setMsg(null); refresh(); } });

  if (error) return <div className="p-2 down">{(error as Error).message}</div>;
  if (!acct) return <div className="p-2 dim">Loading paper account…</div>;

  const marketValue = held.reduce((sum, p) => sum + p.quantity * (quote(p.symbol)?.price ?? p.avgCost), 0);
  const equity = acct.cash + marketValue;
  const pnl = equity - acct.startingCash;
  const tq = quote(ticketSymbol);
  const estPrice = form.type === "market" ? (form.side === "BUY" ? tq?.ask ?? tq?.price : tq?.bid ?? tq?.price) : Number(form.price) || null;
  const estTotal = estPrice && Number(form.quantity) > 0 ? estPrice * Number(form.quantity) : null;

  return (
    <div className="flex flex-col h-full text-[11px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 border-b border-[var(--border)] shrink-0">
        <span className="bg-[var(--amber)] text-black font-bold px-1" title="Simulated money, real live prices">
          <Explain nested term="paperTrading">SIMULATED</Explain>
        </span>
        <span><Explain className="dim">Equity</Explain> <b>{usd(equity)}</b></span>
        <span className={pctClass(pnl)}>{pnl >= 0 ? "+" : ""}{usd(pnl)} ({fmt((pnl / acct.startingCash) * 100)}%)</span>
        <span><span className="dim">Cash</span> {usd(acct.cash)}</span>
        <span><Explain className="dim">Buying power</Explain> {usd(acct.cash - acct.reserved.cash)}</span>
        <button
          className="term-btn ml-auto"
          onClick={() => window.confirm(`Reset the paper account to $${fmt(acct.startingCash)}? All simulated trades are deleted.`) && reset.mutate()}
        >
          RESET
        </button>
      </div>

      <form className="flex flex-wrap gap-1 p-1 items-center shrink-0" onSubmit={(e) => { e.preventDefault(); place.mutate(); }}>
        <input className="w-16" placeholder={activeSymbol} value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} aria-label="symbol" />
        {(["BUY", "SELL"] as const).map((s) => (
          <button key={s} type="button" className={`term-btn ${form.side === s ? (s === "BUY" ? "!bg-[#0d2010] up" : "!bg-[#200d0d] down") : ""}`} onClick={() => setForm({ ...form, side: s })}>
            {s}
          </button>
        ))}
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as OrderType })} aria-label="order type">
          <option value="market">Market</option>
          <option value="limit">Limit</option>
          <option value="stop">Stop</option>
        </select>
        <Explain term={`${form.type}Order`} className="dim">?</Explain>
        <input className="w-16" inputMode="decimal" placeholder="shares" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} aria-label="quantity" />
        {form.type !== "market" && (
          <input className="w-20" inputMode="decimal" placeholder={`${form.type} $`} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} aria-label={`${form.type} price`} />
        )}
        <button className="term-btn" disabled={place.isPending}>PLACE</button>
        <span className="dim">
          {ticketSymbol} {tq ? <>bid {fmt(tq.bid)} / ask {fmt(tq.ask)}</> : ""}
          {estTotal ? <> · ≈ {usd(estTotal)}</> : ""}
        </span>
      </form>
      {msg && <div className={`px-2 pb-1 ${msg.ok ? "up" : "down"}`}>{msg.text}</div>}

      <div className="flex-1 overflow-auto min-h-0">
        <table className="data-table">
          <thead>
            <tr>
              <th className="!text-left">Sym</th><th><Explain>Qty</Explain></th><th><Explain>Avg cost</Explain></th><th><Explain term="last">Last</Explain></th>
              <th><Explain>Unrealized</Explain></th><th><Explain>Realized</Explain></th>
            </tr>
          </thead>
          <tbody>
            {acct.positions.length === 0 && (
              <tr><td colSpan={6} className="!text-left dim">No trades yet. Try buying a few shares with a market order, then a limit order below the price.</td></tr>
            )}
            {acct.positions.map((p) => {
              const last = quote(p.symbol)?.price ?? null;
              const unreal = last !== null && p.quantity > 0 ? (last - p.avgCost) * p.quantity : null;
              return (
                <tr key={p.symbol} className="cursor-pointer hover:bg-[#161616]" onClick={() => setActiveSymbol(p.symbol)}>
                  <td className="!text-left amber">{p.symbol}</td>
                  <td>{fmt(p.quantity, 2)}</td>
                  <td>{p.quantity > 0 ? usd(p.avgCost) : "—"}</td>
                  <td>{usd(last)}</td>
                  <td className={pctClass(unreal)}>{unreal === null ? "—" : usd(unreal)}</td>
                  <td className={pctClass(p.realizedPnl)}>{usd(p.realizedPnl)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="dim px-2 pt-2 pb-1 uppercase text-[10px]">Orders</div>
        <table className="data-table">
          <tbody>
            {orders.slice(0, 25).map((o) => (
              <tr key={o.id} className={o.status === "open" ? "" : "dim"}>
                <td className="!text-left">{o.side === "BUY" ? <span className="up">BUY</span> : <span className="down">SELL</span>} {o.quantity} {o.symbol}</td>
                <td className="!text-left">
                  {o.type}
                  {o.limit_price !== null && ` @ ${usd(o.limit_price)}`}
                  {o.stop_price !== null && ` stop ${usd(o.stop_price)}`}
                </td>
                <td className="!text-left" title={o.reason ?? ""}>
                  {o.status === "filled" ? `filled ${usd(o.fill_price)}` : o.status === "rejected" ? `rejected: ${o.reason}` : o.status}
                </td>
                <td>{o.status === "open" && <button className="term-btn" onClick={() => cancel.mutate(o.id)}>CANCEL</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
