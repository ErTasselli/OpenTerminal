"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost, type Quote } from "../../lib/api";
import { useTerminal, type AiProviderId } from "../../store/terminal";

type Msg = { role: "user" | "assistant"; content: string };

type ProviderInfo = {
  id: AiProviderId;
  label: string;
  defaultModel: string;
  available: boolean;
  detail?: string;
};

export default function AiWidget() {
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const provider = useTerminal((s) => s.aiProvider);
  const model = useTerminal((s) => s.aiModel);
  const setProvider = useTerminal((s) => s.setAiProvider);
  const setModel = useTerminal((s) => s.setAiModel);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const providersQuery = useQuery({
    queryKey: ["ai-providers"],
    queryFn: () => apiGet<{ providers: ProviderInfo[]; defaultProvider: string }>("/api/ai/providers"),
    staleTime: 60_000,
  });

  const modelsQuery = useQuery({
    queryKey: ["ai-models", provider],
    queryFn: () =>
      apiGet<{ provider: string; models: string[]; defaultModel: string }>(
        `/api/ai/models?provider=${encodeURIComponent(provider)}`
      ),
    staleTime: 60_000,
  });

  const providers = providersQuery.data?.providers ?? [];
  const models = useMemo(() => modelsQuery.data?.models ?? [], [modelsQuery.data]);
  const providerInfo = providers.find((p) => p.id === provider);

  // Keep the picked model valid for the selected backend: fall back to the
  // backend's default (or its first model) when it no longer offers the
  // current pick — e.g. after switching from Claude to a local model.
  useEffect(() => {
    if (models.length === 0) return;
    if (model && models.includes(model)) return;
    const preferred = modelsQuery.data?.defaultModel;
    const next = preferred && models.includes(preferred) ? preferred : models[0];
    if (next) setModel(next);
  }, [models, modelsQuery.data, model, setModel]);

  const chat = useMutation({
    mutationFn: async (userText: string) => {
      let context: unknown = null;
      try {
        context = { activeSymbol, quote: (await apiGet<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(activeSymbol)}`))[0] };
      } catch {
        // context is best-effort
      }
      const next = [...messages, { role: "user" as const, content: userText }];
      const res = await apiPost<{ text: string }>("/api/ai/chat", {
        messages: next,
        context,
        provider,
        model,
      });
      return { next, reply: res.text };
    },
    onSuccess: ({ next, reply }) => {
      setMessages([...next, { role: "assistant", content: reply }]);
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

  const reload = () => {
    providersQuery.refetch();
    modelsQuery.refetch();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 p-1 border-b border-[var(--border)] shrink-0">
        <select
          value={provider}
          onChange={(e) => {
            const next = e.target.value as AiProviderId;
            setProvider(next);
            setModel(""); // resolved again once the new backend's models arrive
          }}
          title="Assistant backend"
          className="max-w-[45%] shrink-0"
        >
          {providers.length === 0 && <option value={provider}>{provider}</option>}
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.available ? "" : " (unavailable)"}
            </option>
          ))}
        </select>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          title="Model"
          className="flex-1 min-w-0"
          disabled={models.length === 0}
        >
          {models.length === 0 && (
            <option value="">{modelsQuery.isFetching ? "loading…" : "no models"}</option>
          )}
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button className="term-btn" title="Reload backends and models" onClick={reload}>
          ↻
        </button>
      </div>
      {providerInfo && !providerInfo.available && (
        <div className="dim px-2 py-1 border-b border-[var(--border)] shrink-0">
          {providerInfo.detail}
        </div>
      )}
      {modelsQuery.isError && (
        <div className="down px-2 py-1 border-b border-[var(--border)] shrink-0">
          {(modelsQuery.error as Error).message}
        </div>
      )}
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
