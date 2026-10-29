"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, apiPost } from "../../lib/api";

type Portfolio = { id: number; name: string };

type PendingAction = {
  id: number;
  portfolio_id: number;
  operation: "ADD" | "EDIT" | "DELETE";
  status: "pending" | "confirmed" | "rejected";
  transaction_id: number | null;
  payload: string;
  created_at: string;
  resolved_at: string | null;
};

// The payload JSON snapshot stored on the Pending Action — the proposed new
// fields for ADD/EDIT, or the current row's fields for DELETE (see
// server/src/llm/transactionTools.ts).
type TxPayload = {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  executed_at: string;
  instrument_type: "EQUITY" | "OPTION";
  option_type: "CALL" | "PUT" | null;
  strike: number | null;
  expiration: string | null;
};

type Form = {
  symbol: string;
  side: string;
  quantity: string;
  price: string;
  executed_at: string;
  instrument_type: string;
  option_type: string;
  strike: string;
  expiration: string;
};

function formFromPayload(p: TxPayload): Form {
  return {
    symbol: p.symbol,
    side: p.side,
    quantity: String(p.quantity),
    price: String(p.price),
    executed_at: p.executed_at,
    instrument_type: p.instrument_type,
    option_type: p.option_type ?? "CALL",
    strike: p.strike !== null ? String(p.strike) : "",
    expiration: p.expiration ?? "",
  };
}

function PendingActionCard({ pa, pid }: { pa: PendingAction; pid: number }) {
  const qc = useQueryClient();
  const payload = JSON.parse(pa.payload) as TxPayload;
  const [form, setForm] = useState<Form>(() => formFromPayload(payload));

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["pending-actions", pid] });
    qc.invalidateQueries({ queryKey: ["positions", pid] });
    qc.invalidateQueries({ queryKey: ["transactions", pid] });
  }

  const confirm = useMutation({
    mutationFn: () => {
      const base = {
        symbol: form.symbol,
        side: form.side,
        quantity: Number(form.quantity),
        price: Number(form.price),
        executed_at: form.executed_at,
        instrument_type: form.instrument_type,
      };
      const body =
        pa.operation === "DELETE"
          ? {}
          : form.instrument_type === "OPTION"
          ? { ...base, option_type: form.option_type, strike: Number(form.strike), expiration: form.expiration }
          : base;
      return apiPost(`/api/portfolios/${pid}/pending-actions/${pa.id}/confirm`, body);
    },
    onSuccess: invalidateAll,
  });

  const reject = useMutation({
    mutationFn: () => apiPost(`/api/portfolios/${pid}/pending-actions/${pa.id}/reject`, {}),
    onSuccess: invalidateAll,
  });

  const busy = confirm.isPending || reject.isPending;

  return (
    <div className="border-b border-[var(--border)] p-2 space-y-1">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="amber font-bold">{pa.operation}</span>
        <span className="dim">proposed {new Date(pa.created_at).toLocaleString()}</span>
        {pa.operation !== "ADD" && <span className="dim">tx #{pa.transaction_id}</span>}
      </div>

      {pa.operation === "DELETE" ? (
        <div className="flex gap-2 text-[12px] flex-wrap">
          <span className="font-bold">{payload.symbol}</span>
          <span className={payload.side === "BUY" ? "up" : "down"}>{payload.side}</span>
          <span>{payload.quantity}</span>
          <span>@ {payload.price}</span>
          {payload.instrument_type === "OPTION" && (
            <span className="dim">
              {payload.option_type} ${payload.strike} {payload.expiration}
            </span>
          )}
        </div>
      ) : (
        <div className="flex gap-1 flex-wrap items-center">
          <input
            className="w-20"
            placeholder="Ticker"
            value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
          />
          <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}>
            <option>BUY</option>
            <option>SELL</option>
          </select>
          <select
            value={form.instrument_type}
            onChange={(e) => setForm({ ...form, instrument_type: e.target.value })}
          >
            <option>EQUITY</option>
            <option>OPTION</option>
          </select>
          <input
            className="w-20"
            placeholder="Qty"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
          <input
            className="w-24"
            placeholder="Price"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
          />
          <input
            className="w-40"
            placeholder="Executed at"
            value={form.executed_at}
            onChange={(e) => setForm({ ...form, executed_at: e.target.value })}
          />
          {form.instrument_type === "OPTION" && (
            <>
              <select value={form.option_type} onChange={(e) => setForm({ ...form, option_type: e.target.value })}>
                <option>CALL</option>
                <option>PUT</option>
              </select>
              <input
                className="w-20"
                placeholder="Strike"
                value={form.strike}
                onChange={(e) => setForm({ ...form, strike: e.target.value })}
              />
              <input
                className="w-32"
                type="date"
                value={form.expiration}
                onChange={(e) => setForm({ ...form, expiration: e.target.value })}
              />
            </>
          )}
        </div>
      )}

      <div className="flex gap-2 items-center">
        <button className="term-btn" disabled={busy} onClick={() => confirm.mutate()}>
          CONFIRM
        </button>
        <button className="term-btn hover:text-[var(--down)]" disabled={busy} onClick={() => reject.mutate()}>
          REJECT
        </button>
        {confirm.error && <span className="down text-[11px]">{(confirm.error as Error).message}</span>}
        {reject.error && <span className="down text-[11px]">{(reject.error as Error).message}</span>}
      </div>
    </div>
  );
}

export default function PendingActionsWidget() {
  const { data: portfolios = [] } = useQuery({
    queryKey: ["portfolios"],
    queryFn: () => apiGet<Portfolio[]>("/api/portfolios"),
  });
  const pid = portfolios[0]?.id;

  const { data: pendingActions = [], isLoading } = useQuery({
    queryKey: ["pending-actions", pid],
    queryFn: () => apiGet<PendingAction[]>(`/api/portfolios/${pid}/pending-actions`),
    enabled: !!pid,
  });

  if (!pid) return <div className="dim p-2">No portfolio yet.</div>;
  if (isLoading) return <div className="dim p-2">Loading…</div>;
  if (pendingActions.length === 0) {
    return <div className="dim p-2">No Pending Actions. AI-proposed transactions will show up here for review.</div>;
  }

  return (
    <div>
      {pendingActions.map((pa) => (
        <PendingActionCard key={pa.id} pa={pa} pid={pid} />
      ))}
    </div>
  );
}
