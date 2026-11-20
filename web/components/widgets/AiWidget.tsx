"use client";

import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { apiGet, apiPost, type Quote } from "../../lib/api";
import { toApiMessages, type ImageAttachment } from "../../lib/chatMessageParts";
import { buildPositionsContext, type PositionSnapshot } from "../../lib/positionsContext";
import { useTerminal } from "../../store/terminal";

type ToolCallTrace = { name: string; arguments: Record<string, unknown> };

type Msg = {
  role: "user" | "assistant";
  content: string;
  // Only ever set on a user message. Shown as a thumbnail in the transcript for every
  // turn it was attached to, but toApiMessages only ever sends it to the server on the
  // turn it was attached to -- an older turn's image is dropped before the request goes
  // out, so a long conversation never resends every image it's ever seen.
  image?: ImageAttachment;
  toolCalls?: ToolCallTrace[];
};

// Same mime-type allowlist and size cap as the server's SUPPORTED_IMAGE_MIME_TYPES /
// MAX_IMAGE_BYTES (server/src/llm/types.ts) -- kept here too so a bad attachment is
// rejected at paste/drop time with an immediate, specific message instead of a round
// trip to the server just to find out the same thing.
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function toDataUrl(image: ImageAttachment): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

/** Reads a File into an ImageAttachment (base64, no data: prefix) via FileReader. */
function readImageFile(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve({ mimeType: file.type, data: comma >= 0 ? result.slice(comma + 1) : result });
    };
    reader.onerror = () => reject(reader.error ?? new Error("failed to read image file"));
    reader.readAsDataURL(file);
  });
}

type Portfolio = { id: number; name: string };
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
  const [attachedImage, setAttachedImage] = useState<ImageAttachment | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Shared by paste and drop: rejects an unsupported type or an over-limit file with an
  // immediate, specific message (see SUPPORTED_IMAGE_TYPES/MAX_IMAGE_BYTES above), otherwise
  // reads the file and attaches it for the next send().
  const attachImageFile = async (file: File) => {
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
      setAttachError(`Unsupported image type "${file.type || "unknown"}".`);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setAttachError(`Image too large (${(file.size / (1024 * 1024)).toFixed(1)}MB, max ${MAX_IMAGE_BYTES / (1024 * 1024)}MB).`);
      return;
    }
    try {
      setAttachedImage(await readImageFile(file));
      setAttachError(null);
    } catch {
      setAttachError("Couldn't read that image — try again.");
    }
  };

  const chat = useMutation({
    mutationFn: async ({ text, image }: { text: string; image: ImageAttachment | null }) => {
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
      if (positionsResult.status === "fulfilled") {
        const positions = buildPositionsContext(positionsResult.value);
        if (positions) context.positions = positions;
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

      const userMsg: Msg = { role: "user", content: text, image: image ?? undefined };
      const next = [...messages, userMsg];
      const res = await apiPost<{ text: string; toolCalls?: ToolCallTrace[] }>("/api/ai/chat", {
        messages: toApiMessages(next),
        context,
      });
      return { next, reply: res.text, toolCalls: res.toolCalls };
    },
    onSuccess: ({ next, reply, toolCalls }) => {
      setMessages([...next, { role: "assistant", content: reply, toolCalls }]);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 1e9 }), 50);
    },
  });

  const send = () => {
    const text = input.trim();
    if ((!text && !attachedImage) || chat.isPending) return;
    const image = attachedImage;
    setMessages((m) => [...m, { role: "user", content: text, image: image ?? undefined }]);
    setInput("");
    setAttachedImage(null);
    chat.mutate({ text, image });
  };

  return (
    <div
      className="flex flex-col h-full"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
        if (file) attachImageFile(file);
      }}
    >
      <div ref={scrollRef} className="flex-1 overflow-auto p-2 space-y-2 min-h-0">
        {messages.length === 0 && (
          <div className="dim">
            Ask about {activeSymbol}, the market, an indicator, or a headline. The current quote is shared as context.
            Paste or drag in a screenshot to ask about it.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            <span className={m.role === "user" ? "amber" : "up"}>{m.role === "user" ? "YOU" : "AI"} ›</span>{" "}
            {m.image && (
              <img
                src={toDataUrl(m.image)}
                alt="attached screenshot"
                className="inline-block h-16 w-auto rounded border border-[var(--border)] align-bottom mr-1"
              />
            )}
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
      {attachError && <div className="down text-xs px-1">{attachError}</div>}
      {attachedImage && (
        <div className="flex items-center gap-2 px-1 pb-1 shrink-0">
          <img
            src={toDataUrl(attachedImage)}
            alt="attached screenshot preview"
            className="h-12 w-auto rounded border border-[var(--border)]"
          />
          <span className="dim text-xs">image attached</span>
          <button className="term-btn text-xs" onClick={() => setAttachedImage(null)}>
            REMOVE
          </button>
        </div>
      )}
      <div className="flex gap-1 p-1 border-t border-[var(--border)] shrink-0">
        <input
          className="flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          onPaste={(e) => {
            const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
            if (!item) return;
            e.preventDefault();
            const file = item.getAsFile();
            if (file) attachImageFile(file);
          }}
          placeholder={`Ask about ${activeSymbol}… (paste or drop a screenshot)`}
        />
        <button className="term-btn" onClick={send}>SEND</button>
      </div>
    </div>
  );
}
