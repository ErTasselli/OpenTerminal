"use client";

import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { apiGet, apiPost, type Quote } from "../../lib/api";
import { useTerminal } from "../../store/terminal";

type ToolCall = { name: string; ok: boolean; durationMs: number };
type Msg = { role: "user" | "assistant"; content: string; tools?: ToolCall[] };

export default function AiWidget() {
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = useMutation({
    mutationFn: async (userText: string) => {
      let context: unknown = null;
      try {
        context = { activeSymbol, quote: (await apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(activeSymbol)}`))[0] };
      } catch {
        // context is best-effort
      }
      const next = [...messages, { role: "user" as const, content: userText }];
      const res = await apiPost<{ text: string; toolCalls?: ToolCall[] }>("/api/ai/chat", {
        // Keep UI-only metadata (tool summaries) out of the Anthropic payload.
        messages: next.map(({ role, content }) => ({ role, content })),
        context,
      });
      return { next, reply: res.text, tools: res.toolCalls ?? [] };
    },
    onSuccess: ({ next, reply, tools }) => {
      setMessages([...next, { role: "assistant", content: reply, tools }]);
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
            Ask about {activeSymbol}, the market, an indicator, or a headline. I can pull live quotes,
            price history, option chains, news, insider transactions, and macro data from the terminal.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            <span className={m.role === "user" ? "amber" : "up"}>{m.role === "user" ? "YOU" : "AI"} ›</span>{" "}
            <span className="whitespace-pre-wrap">{m.content}</span>
            {m.tools && m.tools.length > 0 && (
              <div className="dim text-[10px] mt-1">
                used:{" "}
                {[...new Set(m.tools.map((t) => t.name))].join(", ")}
                {m.tools.some((t) => !t.ok) ? " (some lookups failed)" : ""}
              </div>
            )}
          </div>
        ))}
        {chat.isPending && <div className="dim">thinking and fetching terminal data…</div>}
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
