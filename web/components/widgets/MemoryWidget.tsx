"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiDelete } from "../../lib/api";

// A Memory Entry (see CONTEXT.md): a distilled, AI-authored note the assistant
// saves on its own via the write_memory tool. The user can delete one here but,
// per ADR-0002, cannot edit one in place -- there is deliberately no edit UI.
type MemoryEntry = {
  id: number;
  content: string;
  symbol: string | null;
  category: "preference" | "watchlist" | "research-note" | null;
  created_at: string;
};

export default function MemoryWidget() {
  const qc = useQueryClient();

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["memory"],
    queryFn: () => apiGet<MemoryEntry[]>("/api/memory"),
  });

  return (
    <div>
      <div className="flex gap-2 p-1 items-center">
        <span className="dim text-[11px]">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Sym</th>
            <th>Category</th>
            <th>Content</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td colSpan={5} className="dim">Loading…</td>
            </tr>
          )}
          {!isLoading && entries.length === 0 && (
            <tr>
              <td colSpan={5} className="dim">No memory entries yet.</td>
            </tr>
          )}
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="!text-left dim">{new Date(e.created_at).toLocaleString()}</td>
              <td className="font-bold">{e.symbol ?? "—"}</td>
              <td className="dim">{e.category ?? "—"}</td>
              <td className="!text-left">{e.content}</td>
              <td>
                <button
                  className="dim hover:text-[var(--down)]"
                  title="Delete this memory entry"
                  onClick={async () => {
                    await apiDelete(`/api/memory/${e.id}`);
                    qc.invalidateQueries({ queryKey: ["memory"] });
                  }}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
