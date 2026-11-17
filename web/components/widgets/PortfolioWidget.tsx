"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, apiPost, apiDelete, fmt, pctClass, type Quote } from "../../lib/api";
import { symbolsParam } from "../../lib/symbol";

type Portfolio = { id: number; name: string };
type Position = { symbol: string; quantity: number; avgCost: number; realizedPnl: number };
type Tx = { id: number; symbol: string; side: string; quantity: number; price: number; executed_at: string };

// Quotes for London, Johannesburg and Tel Aviv come in the minor unit (pence,
// cents, agorot); their FX pair is quoted for the major unit.
const MINOR_UNITS: Record<string, { code: string; scale: number }> = {
  GBp: { code: "GBP", scale: 0.01 },
  GBX: { code: "GBP", scale: 0.01 },
  ZAc: { code: "ZAR", scale: 0.01 },
  ILA: { code: "ILS", scale: 0.01 },
};

/** The ISO currency a quote is priced in, and how many of those one quoted unit is. */
function currencyUnit(currency: string | null | undefined): { code: string; scale: number } {
  if (!currency) return { code: "USD", scale: 1 };
  return MINOR_UNITS[currency] ?? { code: currency.toUpperCase(), scale: 1 };
}

const fxSymbol = (code: string) => `${code}USD=X`;

export default function PortfolioWidget() {
  const qc = useQueryClient();
  const [portfolioId, setPortfolioId] = useState<number | null>(null);
  const [showTx, setShowTx] = useState(false);
  const [form, setForm] = useState({ symbol: "", side: "BUY", quantity: "", price: "" });

  const { data: portfolios = [] } = useQuery({
    queryKey: ["portfolios"],
    queryFn: () => apiGet<Portfolio[]>("/api/portfolios"),
  });
  const pid = portfolioId ?? portfolios[0]?.id;

  const { data: positions = [] } = useQuery({
    queryKey: ["positions", pid],
    queryFn: () => apiGet<Position[]>(`/api/portfolios/${pid}/positions`),
    enabled: !!pid,
  });

  const { data: txs = [] } = useQuery({
    queryKey: ["transactions", pid],
    queryFn: () => apiGet<Tx[]>(`/api/portfolios/${pid}/transactions`),
    enabled: !!pid && showTx,
  });

  const symbols = positions.map((p) => p.symbol);
  const { data: quotes = [] } = useQuery({
    queryKey: ["pf-quotes", symbols.join(",")],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(symbols)}`),
    enabled: symbols.length > 0,
    refetchInterval: 30_000,
  });

  // Positions can be priced in different currencies (AAPL in USD, PETR4.SA in BRL),
  // so totals are converted to USD before summing; per-row values stay in the
  // instrument's own currency. Costs are assumed to be entered in that currency too.
  const foreignCurrencies = [
    ...new Set(quotes.map((q) => currencyUnit(q.currency).code).filter((c) => c !== "USD")),
  ].sort();
  const { data: fxQuotes = [] } = useQuery({
    queryKey: ["pf-fx", foreignCurrencies.join(",")],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(foreignCurrencies.map(fxSymbol))}`),
    enabled: foreignCurrencies.length > 0,
    refetchInterval: 60_000,
  });
  const usdPer = (code: string): number | null =>
    code === "USD" ? 1 : fxQuotes.find((q) => q.symbol === fxSymbol(code))?.price ?? null;

  const addTx = useMutation({
    mutationFn: () =>
      apiPost(`/api/portfolios/${pid}/transactions`, {
        symbol: form.symbol,
        side: form.side,
        quantity: Number(form.quantity),
        price: Number(form.price),
        executed_at: new Date().toISOString(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["positions", pid] });
      qc.invalidateQueries({ queryKey: ["transactions", pid] });
      setForm({ symbol: "", side: "BUY", quantity: "", price: "" });
    },
  });

  const missingFx = new Set<string>();
  const totals = positions.reduce(
    (acc, p) => {
      const q = quotes.find((x) => x.symbol === p.symbol);
      const unit = currencyUnit(q?.currency);
      const rate = usdPer(unit.code);
      if (rate === null) {
        missingFx.add(unit.code);
        return acc;
      }
      const toUsd = unit.scale * rate;
      acc.marketValue += (q?.price ?? p.avgCost) * p.quantity * toUsd;
      acc.cost += p.avgCost * p.quantity * toUsd;
      acc.realized += p.realizedPnl * toUsd;
      return acc;
    },
    { marketValue: 0, cost: 0, realized: 0 }
  );
  const unrealized = totals.marketValue - totals.cost;

  return (
    <div>
      <div className="flex gap-2 p-1 items-center flex-wrap">
        <select value={pid ?? ""} onChange={(e) => setPortfolioId(Number(e.target.value))}>
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button className={`term-btn ${showTx ? "active" : ""}`} onClick={() => setShowTx(!showTx)}>
          TRANSACTIONS
        </button>
        <span className="ml-auto">
          {missingFx.size > 0 && <span className="dim">excl. {[...missingFx].join(", ")} (no FX) </span>}
          MV <span className="dim">USD</span> <span className="amber">{fmt(totals.marketValue)}</span>{" "}
          <span className="dim">Unrl</span> <span className={pctClass(unrealized)}>{fmt(unrealized)}</span>{" "}
          <span className="dim">Rlzd</span> <span className={pctClass(totals.realized)}>{fmt(totals.realized)}</span>
        </span>
      </div>

      <form
        className="flex gap-1 p-1 border-b border-[var(--border)]"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.symbol && form.quantity && form.price) addTx.mutate();
        }}
      >
        <input className="w-20" placeholder="Ticker" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} />
        <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}>
          <option>BUY</option><option>SELL</option>
        </select>
        <input className="w-20" placeholder="Qty" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
        <input className="w-24" placeholder="Price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        <button className="term-btn" type="submit">ADD</button>
        {addTx.error && <span className="down">{(addTx.error as Error).message}</span>}
      </form>

      {!showTx ? (
        <table className="data-table">
          <thead>
            <tr><th>Sym</th><th>Qty</th><th>Avg Cost</th><th>Last</th><th>Mkt Val</th><th>Unrl PnL</th><th>Rlzd PnL</th></tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const q = quotes.find((x) => x.symbol === p.symbol);
              const last = q?.price ?? null;
              const mv = last !== null ? last * p.quantity : null;
              const upnl = last !== null ? (last - p.avgCost) * p.quantity : null;
              return (
                <tr key={p.symbol}>
                  <td className="font-bold">
                    {p.symbol} <span className="dim font-normal">{q?.currency ?? ""}</span>
                  </td>
                  <td>{fmt(p.quantity, 4)}</td>
                  <td>{fmt(p.avgCost)}</td>
                  <td>{fmt(last)}</td>
                  <td>{fmt(mv)}</td>
                  <td className={pctClass(upnl)}>{fmt(upnl)}</td>
                  <td className={pctClass(p.realizedPnl)}>{fmt(p.realizedPnl)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Date</th><th>Sym</th><th>Side</th><th>Qty</th><th>Price</th><th></th></tr>
          </thead>
          <tbody>
            {txs.map((t) => (
              <tr key={t.id}>
                <td className="!text-left dim">{new Date(t.executed_at).toLocaleDateString()}</td>
                <td className="font-bold">{t.symbol}</td>
                <td className={t.side === "BUY" ? "up" : "down"}>{t.side}</td>
                <td>{fmt(t.quantity, 4)}</td>
                <td>{fmt(t.price)}</td>
                <td>
                  <button
                    className="dim hover:text-[var(--down)]"
                    onClick={async () => {
                      await apiDelete(`/api/portfolios/${pid}/transactions/${t.id}`);
                      qc.invalidateQueries({ queryKey: ["positions", pid] });
                      qc.invalidateQueries({ queryKey: ["transactions", pid] });
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
