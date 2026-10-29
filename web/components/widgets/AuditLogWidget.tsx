"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";

// An Audit Log Entry (see CONTEXT.md): an append-only record of one unit of AI
// activity -- a full chat transcript, a Tool Call, a Pending Action lifecycle
// event, or a Memory Entry write -- plus call metadata and failures. This
// widget is read-only by design: there is no edit/delete affordance anywhere
// here, mirroring the fact that /api/audit-log has no mutating route at all.
type AuditEventType = "chat" | "tool_call" | "pending_action" | "memory_write" | "error";

type AuditLogEntry = {
  id: number;
  created_at: string;
  event_type: AuditEventType;
  summary: string;
  detail: string; // JSON blob, shape varies per event_type
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
};

const EVENT_TYPES: AuditEventType[] = ["chat", "tool_call", "pending_action", "memory_write", "error"];

export default function AuditLogWidget() {
  const [eventType, setEventType] = useState<AuditEventType | "">("");

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["audit-log", eventType],
    queryFn: () =>
      apiGet<AuditLogEntry[]>(
        `/api/audit-log${eventType ? `?event_type=${encodeURIComponent(eventType)}` : ""}`
      ),
  });

  return (
    <div>
      <div className="flex gap-2 p-1 items-center">
        <span className="dim text-[11px]">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
        <select
          className="ml-auto !w-auto text-[11px]"
          value={eventType}
          onChange={(e) => setEventType(e.target.value as AuditEventType | "")}
        >
          <option value="">All types</option>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Type</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td colSpan={3} className="dim">Loading…</td>
            </tr>
          )}
          {!isLoading && entries.length === 0 && (
            <tr>
              <td colSpan={3} className="dim">No audit log entries yet.</td>
            </tr>
          )}
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="!text-left dim">{new Date(e.created_at).toLocaleString()}</td>
              <td className="font-bold">{e.event_type}</td>
              <td className="!text-left">
                {e.summary}
                <details className="dim text-xs mt-1">
                  <summary className="cursor-pointer">detail</summary>
                  <pre className="whitespace-pre-wrap break-all">
                    {JSON.stringify(JSON.parse(e.detail), null, 2)}
                  </pre>
                  {(e.model || e.input_tokens != null || e.output_tokens != null) && (
                    <div className="mt-1">
                      {e.model && <span>model: {e.model} </span>}
                      {e.input_tokens != null && <span>in: {e.input_tokens} </span>}
                      {e.output_tokens != null && <span>out: {e.output_tokens}</span>}
                    </div>
                  )}
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
