// The AI assistant's persistent memory tools: write_memory lets it autonomously
// save a distilled note as a Memory Entry (see CONTEXT.md), with no propose/confirm
// gate (unlike a Pending Action); search_memory lets it recall entries during a
// later chat turn. Mirrors tools.ts's search_news pattern (ToolDef + a matching
// run*Tool executor) as the sibling tool file for this feature.
import { db } from "../db.js";
import { writeAuditLog } from "../audit.js";
import type { ToolDef } from "./types.js";

// Truncation length for the audit_log `summary` column on a memory_write entry --
// just enough to identify the entry in the Audit Log widget's list view without
// duplicating the full content (which lives in `detail`).
const SUMMARY_TRUNCATE_LENGTH = 80;

export const MEMORY_CATEGORIES = ["preference", "watchlist", "research-note"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export type MemoryEntry = {
  id: number;
  content: string;
  symbol: string | null;
  category: MemoryCategory | null;
  created_at: string;
};

/**
 * The single INSERT entry point for every Memory Entry write. Routed through
 * here (rather than inlined in the tool handler below) so a later audit-log
 * hook (#23, which needs to record every Memory Entry write) is a one-line
 * change to this function instead of a hunt across the file.
 */
export function createMemoryEntry(content: string, symbol: string | null, category: MemoryCategory | null): MemoryEntry {
  const info = db
    .prepare("INSERT INTO memory_entries (content, symbol, category) VALUES (?, ?, ?)")
    .run(content, symbol, category);
  const entry = db.prepare("SELECT * FROM memory_entries WHERE id = ?").get(info.lastInsertRowid) as MemoryEntry;
  writeAuditLog({
    eventType: "memory_write",
    summary: content.length > SUMMARY_TRUNCATE_LENGTH ? `${content.slice(0, SUMMARY_TRUNCATE_LENGTH)}…` : content,
    detail: { content, symbol, category },
  });
  return entry;
}

export const MEMORY_WRITE_TOOL: ToolDef = {
  name: "write_memory",
  description:
    "Save a distilled, AI-authored note as a Memory Entry so you can recall it in later chat turns. " +
    "Only save your own summarized conclusions here -- never raw tool output (fetched articles, quote dumps, etc). " +
    "Writes land immediately with no confirmation step.",
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "The distilled note to remember, written in your own words." },
      symbol: { type: "string", description: "Optional ticker symbol this note relates to, e.g. AAPL." },
      category: {
        type: "string",
        enum: [...MEMORY_CATEGORIES],
        description: "Optional category for this note: preference, watchlist, or research-note.",
      },
    },
    required: ["content"],
  },
};

export type WriteMemoryResult = { ok: true; id: number } | { ok: false; error: string };

/** Executes the write_memory tool call: validate, normalize, and insert via createMemoryEntry. */
export async function runWriteMemoryTool(args: Record<string, unknown>): Promise<WriteMemoryResult> {
  const content = typeof args.content === "string" ? args.content.trim() : "";
  if (!content) return { ok: false, error: "content is required" };

  // Uppercased for consistency with how portfolio.ts's txSchema normalizes symbols.
  const symbol = typeof args.symbol === "string" && args.symbol.trim() ? args.symbol.trim().toUpperCase() : null;

  // An out-of-enum category is dropped (saved as uncategorized) rather than failing
  // the whole write -- a model that hallucinates a category shouldn't lose the note
  // entirely. The table's CHECK constraint is the last-resort backstop either way.
  const category =
    typeof args.category === "string" && (MEMORY_CATEGORIES as readonly string[]).includes(args.category)
      ? (args.category as MemoryCategory)
      : null;

  const entry = createMemoryEntry(content, symbol, category);
  return { ok: true, id: entry.id };
}

// Caps how many Memory Entries are folded back into the model's context per call,
// the same way search_news caps headlines at MAX_RESULTS -- enough recall, not a
// wall of text.
const MAX_RESULTS = 20;

export const MEMORY_SEARCH_TOOL: ToolDef = {
  name: "search_memory",
  description:
    "Search previously saved Memory Entries to recall earlier notes, preferences, or research. " +
    "All arguments are optional and combine as an AND filter; omit all of them to get the most recent entries.",
  parameters: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Only return entries tagged with this ticker symbol, e.g. AAPL." },
      category: {
        type: "string",
        enum: [...MEMORY_CATEGORIES],
        description: "Only return entries in this category: preference, watchlist, or research-note.",
      },
      query: { type: "string", description: "Free-text substring to match against entry content." },
    },
    required: [],
  },
};

export type SearchMemoryResult = { ok: true; entries: MemoryEntry[] };

/** Executes the search_memory tool call: filter by symbol/category equality and a content LIKE, newest first, capped. */
export async function runSearchMemoryTool(args: Record<string, unknown>): Promise<SearchMemoryResult> {
  const symbol = typeof args.symbol === "string" && args.symbol.trim() ? args.symbol.trim().toUpperCase() : null;
  const category = typeof args.category === "string" && args.category.trim() ? args.category.trim() : null;
  const query = typeof args.query === "string" && args.query.trim() ? args.query.trim() : null;

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (symbol) {
    clauses.push("symbol = ?");
    params.push(symbol);
  }
  if (category) {
    clauses.push("category = ?");
    params.push(category);
  }
  if (query) {
    clauses.push("content LIKE ?");
    params.push(`%${query}%`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const entries = db
    .prepare(`SELECT * FROM memory_entries ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...params, MAX_RESULTS) as MemoryEntry[];
  return { ok: true, entries };
}
