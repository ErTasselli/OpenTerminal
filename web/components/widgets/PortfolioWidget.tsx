"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, apiPost, apiDelete, fmt, pctClass, type Quote } from "../../lib/api";
import { symbolsParam } from "../../lib/symbol";
import { validateCreditSpreadForm, type CreditSpreadFormInput } from "../../lib/creditSpread";

type Portfolio = { id: number; name: string };
type Position = {
  symbol: string;
  instrumentType: "EQUITY" | "OPTION";
  optionType: "CALL" | "PUT" | null;
  strike: number | null;
  expiration: string | null;
  quantity: number;
  avgCost: number;
  realizedPnl: number;
  multiplier: number;
};
type Tx = {
  id: number;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  executed_at: string;
  instrument_type: "EQUITY" | "OPTION";
  option_type: "CALL" | "PUT" | null;
  strike: number | null;
  expiration: string | null;
};
// Mirrors the shape of GET /api/options/:symbol (see OptionsWidget.tsx) — only
// the fields a position's mark-to-market lookup needs.
type OptionChain = { calls: Array<{ strike: number | null; lastPrice: number | null }>; puts: Array<{ strike: number | null; lastPrice: number | null }> };

const emptyForm = {
  symbol: "",
  side: "BUY",
  quantity: "",
  price: "",
  instrumentType: "EQUITY",
  optionType: "CALL",
  strike: "",
  expiration: "",
};

const emptySpreadForm: CreditSpreadFormInput = {
  symbol: "",
  optionType: "CALL",
  expiration: "",
  quantity: "",
  shortStrike: "",
  shortPrice: "",
  longStrike: "",
  longPrice: "",
};

export default function PortfolioWidget() {
  const qc = useQueryClient();
  const [portfolioId, setPortfolioId] = useState<number | null>(null);
  const [showTx, setShowTx] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [entryMode, setEntryMode] = useState<"SINGLE" | "SPREAD">("SINGLE");
  const [spreadForm, setSpreadForm] = useState<CreditSpreadFormInput>(emptySpreadForm);
  const [spreadError, setSpreadError] = useState<string | null>(null);

  // Clears a stale inline validation error as soon as the user edits any
  // field, rather than leaving it displayed (misleadingly) until the next
  // submit attempt.
  function updateSpreadField<K extends keyof CreditSpreadFormInput>(key: K, value: CreditSpreadFormInput[K]) {
    setSpreadForm((f) => ({ ...f, [key]: value }));
    setSpreadError(null);
  }

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

  const symbols = [...new Set(positions.filter((p) => p.instrumentType === "EQUITY").map((p) => p.symbol))];
  const { data: quotes = [] } = useQuery({
    queryKey: ["pf-quotes", symbols.join(",")],
    queryFn: () => apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(symbols)}`),
    enabled: symbols.length > 0,
    refetchInterval: 30_000,
  });

  // Options are priced off their own contract (strike/expiration/type), not the
  // underlying's equity quote — one option-chain fetch per unique (symbol,
  // expiration) pair covers every position sharing that pair regardless of strike.
  const optionChainKeys = [
    ...new Set(
      positions.filter((p) => p.instrumentType === "OPTION").map((p) => `${p.symbol}|${p.expiration}`)
    ),
  ];
  const optionChainResults = useQueries({
    queries: optionChainKeys.map((key) => {
      const [symbol, expiration] = key.split("|");
      return {
        queryKey: ["pf-option-chain", symbol, expiration],
        queryFn: () => apiGet<OptionChain>(`/api/options/${encodeURIComponent(symbol)}?expiry=${encodeURIComponent(expiration)}`),
        refetchInterval: 30_000,
      };
    }),
  });

  function lastPriceFor(p: Position): number | null {
    if (p.instrumentType !== "OPTION") {
      return quotes.find((x) => x.symbol === p.symbol)?.price ?? null;
    }
    const idx = optionChainKeys.indexOf(`${p.symbol}|${p.expiration}`);
    const chain = optionChainResults[idx]?.data;
    if (!chain || p.strike === null) return null;
    const rows = p.optionType === "PUT" ? chain.puts : chain.calls;
    return rows.find((r) => r.strike === p.strike)?.lastPrice ?? null;
  }

  const addTx = useMutation({
    mutationFn: () => {
      const base = {
        symbol: form.symbol,
        side: form.side,
        quantity: Number(form.quantity),
        price: Number(form.price),
        executed_at: new Date().toISOString(),
        instrument_type: form.instrumentType,
      };
      const payload =
        form.instrumentType === "OPTION"
          ? {
              ...base,
              option_type: form.optionType,
              strike: Number(form.strike),
              expiration: form.expiration,
            }
          : base;
      return apiPost(`/api/portfolios/${pid}/transactions`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["positions", pid] });
      qc.invalidateQueries({ queryKey: ["transactions", pid] });
      setForm(emptyForm);
    },
  });

  // Submits both Legs of a Credit Spread as one linked write via POST
  // /:id/credit-spreads (issue #51/ADR-0004). Always builds short=SELL/
  // long=BUY sharing one symbol/option_type/expiration, so the server's
  // "opposite sides" and "same underlying" invariants can't be violated from
  // this form; validateCreditSpreadForm mirrors the two invariants that can
  // (different strikes, net credit) for inline validation before submit.
  const addSpread = useMutation({
    mutationFn: () => {
      const payload = {
        symbol: spreadForm.symbol.toUpperCase(),
        option_type: spreadForm.optionType,
        expiration: spreadForm.expiration,
        quantity: Number(spreadForm.quantity),
        executed_at: new Date().toISOString(),
        short_strike: Number(spreadForm.shortStrike),
        short_price: Number(spreadForm.shortPrice),
        long_strike: Number(spreadForm.longStrike),
        long_price: Number(spreadForm.longPrice),
      };
      return apiPost(`/api/portfolios/${pid}/credit-spreads`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["positions", pid] });
      qc.invalidateQueries({ queryKey: ["transactions", pid] });
      setSpreadForm(emptySpreadForm);
      setSpreadError(null);
    },
  });

  const totals = positions.reduce(
    (acc, p) => {
      const last = lastPriceFor(p);
      const mv = (last ?? p.avgCost) * p.quantity * p.multiplier;
      acc.marketValue += mv;
      acc.cost += p.avgCost * p.quantity * p.multiplier;
      acc.realized += p.realizedPnl;
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
          MV <span className="amber">{fmt(totals.marketValue)}</span>{" "}
          <span className="dim">Unrl</span> <span className={pctClass(unrealized)}>{fmt(unrealized)}</span>{" "}
          <span className="dim">Rlzd</span> <span className={pctClass(totals.realized)}>{fmt(totals.realized)}</span>
        </span>
      </div>

      <div className="flex gap-2 p-1 items-center">
        <button
          className={`term-btn ${entryMode === "SINGLE" ? "active" : ""}`}
          onClick={() => setEntryMode("SINGLE")}
        >
          SINGLE LEG
        </button>
        <button
          className={`term-btn ${entryMode === "SPREAD" ? "active" : ""}`}
          onClick={() => setEntryMode("SPREAD")}
        >
          CREDIT SPREAD
        </button>
      </div>

      {entryMode === "SINGLE" ? (
        <form
          className="flex gap-1 p-1 border-b border-[var(--border)]"
          onSubmit={(e) => {
            e.preventDefault();
            const ok =
              form.symbol && form.quantity && form.price &&
              (form.instrumentType !== "OPTION" || (form.optionType && form.strike && form.expiration));
            if (ok) addTx.mutate();
          }}
        >
          <input className="w-20" placeholder="Ticker" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} />
          <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}>
            <option>BUY</option><option>SELL</option>
          </select>
          <select value={form.instrumentType} onChange={(e) => setForm({ ...form, instrumentType: e.target.value })}>
            <option>EQUITY</option><option>OPTION</option>
          </select>
          <input className="w-20" placeholder="Qty" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          <input className="w-24" placeholder="Price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          {form.instrumentType === "OPTION" && (
            <>
              <select value={form.optionType} onChange={(e) => setForm({ ...form, optionType: e.target.value })}>
                <option>CALL</option><option>PUT</option>
              </select>
              <input className="w-20" placeholder="Strike" value={form.strike} onChange={(e) => setForm({ ...form, strike: e.target.value })} />
              <input className="w-32" type="date" value={form.expiration} onChange={(e) => setForm({ ...form, expiration: e.target.value })} />
            </>
          )}
          <button className="term-btn" type="submit">ADD</button>
          {addTx.error && <span className="down">{(addTx.error as Error).message}</span>}
        </form>
      ) : (
        <form
          className="flex gap-1 p-1 border-b border-[var(--border)] flex-wrap items-center"
          onSubmit={(e) => {
            e.preventDefault();
            const err = validateCreditSpreadForm(spreadForm);
            setSpreadError(err);
            if (!err) addSpread.mutate();
          }}
        >
          <input className="w-20" placeholder="Ticker" value={spreadForm.symbol} onChange={(e) => updateSpreadField("symbol", e.target.value.toUpperCase())} />
          <select value={spreadForm.optionType} onChange={(e) => updateSpreadField("optionType", e.target.value as "CALL" | "PUT")}>
            <option>CALL</option><option>PUT</option>
          </select>
          <input className="w-32" type="date" value={spreadForm.expiration} onChange={(e) => updateSpreadField("expiration", e.target.value)} />
          <input className="w-16" placeholder="Qty" value={spreadForm.quantity} onChange={(e) => updateSpreadField("quantity", e.target.value)} />
          <span className="dim">Short</span>
          <input className="w-20" placeholder="Strike" value={spreadForm.shortStrike} onChange={(e) => updateSpreadField("shortStrike", e.target.value)} />
          <input className="w-20" placeholder="Price" value={spreadForm.shortPrice} onChange={(e) => updateSpreadField("shortPrice", e.target.value)} />
          <span className="dim">Long</span>
          <input className="w-20" placeholder="Strike" value={spreadForm.longStrike} onChange={(e) => updateSpreadField("longStrike", e.target.value)} />
          <input className="w-20" placeholder="Price" value={spreadForm.longPrice} onChange={(e) => updateSpreadField("longPrice", e.target.value)} />
          <button className="term-btn" type="submit">ADD SPREAD</button>
          {(spreadError || addSpread.error) && (
            <span className="down">{spreadError ?? (addSpread.error as Error).message}</span>
          )}
        </form>
      )}

      {!showTx ? (
        <table className="data-table">
          <thead>
            <tr><th>Sym</th><th>Type</th><th>Qty</th><th>Avg Cost</th><th>Last</th><th>Mkt Val</th><th>Unrl PnL</th><th>Rlzd PnL</th></tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const last = lastPriceFor(p);
              const mv = last !== null ? last * p.quantity * p.multiplier : null;
              const upnl = last !== null ? (last - p.avgCost) * p.quantity * p.multiplier : null;
              const typeLabel =
                p.instrumentType === "OPTION"
                  ? `${p.optionType} $${p.strike} ${p.expiration}`
                  : "EQUITY";
              return (
                <tr key={`${p.symbol}-${p.instrumentType}-${p.optionType ?? ""}-${p.strike ?? ""}-${p.expiration ?? ""}`}>
                  <td className="font-bold">{p.symbol}</td>
                  <td className="dim">{typeLabel}</td>
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
