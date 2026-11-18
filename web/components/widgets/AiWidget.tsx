"use client";

import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { apiGet, apiPost, type Quote } from "../../lib/api";
import { useTerminal } from "../../store/terminal";

type ToolCallTrace = { name: string; arguments: Record<string, unknown> };
type Msg = { role: "user" | "assistant"; content: string; toolCalls?: ToolCallTrace[] };

type Portfolio = { id: number; name: string };
// A lightweight slice of GET /api/portfolios/:id/positions (see PortfolioWidget.tsx for the
// full shape) — just enough for the assistant to ground answers, not the full options fields.
type PositionSnapshot = { symbol: string; instrumentType: string; quantity: number; avgCost: number };
// A lightweight slice of GET /api/portfolios/:id/transactions, capped to the most recent
// MAX_RECENT_TRANSACTIONS rows — gives the model transaction ids so it can target an
// existing row via the propose_transaction Tool Call's EDIT/DELETE operations (ADR-0002:
// the model never writes to `transactions` directly, only proposes a Pending Action).
type TransactionSnapshot = { id: number; symbol: string; side: string; quantity: number; price: number; executed_at: string };

const MAX_RECENT_TRANSACTIONS = 20;

export default function AiWidget() {
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const watchlist = useTerminal((s) => s.watchlist);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = useMutation({
    mutationFn: async (userText: string) => {
      // Every turn auto-injects a lightweight positions snapshot, a capped recent-transactions
      // snapshot (so the model can target an existing row's id for propose_transaction's
      // EDIT/DELETE operations), and the client-side watchlist as context — best-effort, same
      // as the quote fetch: any one of these failing never blocks the chat itself. Run all
      // three independent lookups concurrently rather than serially, so one slow/failing
      // fetch doesn't add to the others' latency.
      const context: Record<string, unknown> = { activeSymbol, watchlist };
      // Positions and recent-transactions both need the same default portfolio id — share one
      // /api/portfolios fetch between them (chained, not awaited up front) so it stays
      // concurrent with the quote fetch instead of serializing in front of it.
      const portfolios = apiGet<Portfolio[]>("/api/portfolios");
      const [quoteResult, positionsResult, transactionsResult] = await Promise.allSettled([
        apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(activeSymbol)}`),
        portfolios.then((p) => {
          const pid = p[0]?.id;
          return pid ? apiGet<PositionSnapshot[]>(`/api/portfolios/${pid}/positions`) : [];
        }),
        portfolios.then((p) => {
          const pid = p[0]?.id;
          return pid ? apiGet<TransactionSnapshot[]>(`/api/portfolios/${pid}/transactions`) : [];
        }),
      ]);
      if (quoteResult.status === "fulfilled") context.quote = quoteResult.value[0];
      if (positionsResult.status === "fulfilled" && positionsResult.value.length > 0) {
        context.positions = positionsResult.value.map(
          (p): PositionSnapshot => ({
            symbol: p.symbol,
            instrumentType: p.instrumentType,
            quantity: p.quantity,
            avgCost: p.avgCost,
          })
        );
      }
      if (transactionsResult.status === "fulfilled" && transactionsResult.value.length > 0) {
        context.recentTransactions = transactionsResult.value
          .slice(0, MAX_RECENT_TRANSACTIONS)
          .map(
            (t): TransactionSnapshot => ({
              id: t.id,
              symbol: t.symbol,
              side: t.side,
              quantity: t.quantity,
              price: t.price,
              executed_at: t.executed_at,
            })
          );
      }

      const next = [...messages, { role: "user" as const, content: userText }];
      const res = await apiPost<{ text: string; toolCalls?: ToolCallTrace[] }>("/api/ai/chat", { messages: next, context });
      return { next, reply: res.text, toolCalls: res.toolCalls };
    },
    onSuccess: ({ next, reply, toolCalls }) => {
      setMessages([...next, { role: "assistant", content: reply, toolCalls }]);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 1e9 }), 50);
    },
  });

  const send = () => {
    const text = input.trim();
    if (!text || chat.isPending) return;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    chat.mutate(text);
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-auto p-2 space-y-2 min-h-0">
        {messages.length === 0 && (
          <div className="dim">
            Ask about {activeSymbol}, the market, an indicator, or a headline. The current quote is shared as context.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            <span className={m.role === "user" ? "amber" : "up"}>{m.role === "user" ? "YOU" : "AI"} ›</span>{" "}
            <span className="whitespace-pre-wrap">{m.content}</span>
            {m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0 && (
              <details className="dim text-xs mt-1">
                <summary className="cursor-pointer">looked up {m.toolCalls.length} thing{m.toolCalls.length === 1 ? "" : "s"}</summary>
                <ul className="pl-4 list-disc">
                  {m.toolCalls.map((t, j) => (
                    <li key={j}>
                      {t.name}
                      {Object.keys(t.arguments).length > 0 ? `(${JSON.stringify(t.arguments)})` : "()"}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
        {chat.isPending && <div className="dim">thinking…</div>}
        {chat.error && <div className="down">{(chat.error as Error).message}</div>}
      </div>
      <div className="flex gap-1 p-1 border-t border-[var(--border)] shrink-0">
        <input
          className="flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={`Ask about ${activeSymbol}…`}
        />
        <button className="term-btn" onClick={send}>SEND</button>
      </div>
    </div>
  );
}
