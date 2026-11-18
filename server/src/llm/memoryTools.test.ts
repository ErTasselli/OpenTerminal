import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// db.ts reads DATA_DIR at import time and opens a real sqlite file there, so
// point it at a throwaway directory instead of the app's real data/ folder,
// before dynamically importing db.js (and memoryTools.js, which imports it).
let tmpDir: string;
let db: (typeof import("../db.js"))["db"];
let runWriteMemoryTool: (typeof import("./memoryTools.js"))["runWriteMemoryTool"];
let runSearchMemoryTool: (typeof import("./memoryTools.js"))["runSearchMemoryTool"];

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "openterminal-memorytools-test-"));
  process.env.DATA_DIR = tmpDir;
  ({ db } = await import("../db.js"));
  ({ runWriteMemoryTool, runSearchMemoryTool } = await import("./memoryTools.js"));
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe("runWriteMemoryTool", () => {
  it("writes a note with no symbol/category", async () => {
    const result = await runWriteMemoryTool({ content: "User prefers dark mode" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const row = db.prepare("SELECT * FROM memory_entries WHERE id = ?").get(result.id) as any;
    expect(row.content).toBe("User prefers dark mode");
    expect(row.symbol).toBeNull();
    expect(row.category).toBeNull();
  });

  it("writes a note with symbol and category, uppercasing the symbol", async () => {
    const result = await runWriteMemoryTool({
      content: "Watching for Q3 earnings",
      symbol: "aapl",
      category: "watchlist",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const row = db.prepare("SELECT * FROM memory_entries WHERE id = ?").get(result.id) as any;
    expect(row.symbol).toBe("AAPL");
    expect(row.category).toBe("watchlist");
  });

  it("rejects empty/whitespace-only content", async () => {
    const result = await runWriteMemoryTool({ content: "   " });
    expect(result.ok).toBe(false);
  });

  it("rejects missing content", async () => {
    const result = await runWriteMemoryTool({});
    expect(result.ok).toBe(false);
  });

  // Judgment call (documented per the issue brief): an out-of-enum category is
  // dropped (saved as uncategorized) rather than rejecting the whole write --
  // see the comment on runWriteMemoryTool in memoryTools.ts.
  it("drops an invalid category rather than rejecting the whole write", async () => {
    const result = await runWriteMemoryTool({ content: "Some note", category: "not-a-real-category" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const row = db.prepare("SELECT * FROM memory_entries WHERE id = ?").get(result.id) as any;
    expect(row.category).toBeNull();
  });
});

describe("runSearchMemoryTool", () => {
  beforeAll(async () => {
    await runWriteMemoryTool({
      content: "TSLA looks overvalued per my own analysis of the Q2 numbers",
      symbol: "TSLA",
      category: "research-note",
    });
    await runWriteMemoryTool({ content: "User likes dark mode and compact tables", category: "preference" });
    await runWriteMemoryTool({ content: "Watch NVDA ahead of earnings", symbol: "NVDA", category: "watchlist" });
  });

  it("filters by symbol (case-insensitive)", async () => {
    const result = await runSearchMemoryTool({ symbol: "tsla" });
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((e) => e.symbol === "TSLA")).toBe(true);
  });

  it("filters by category", async () => {
    const result = await runSearchMemoryTool({ category: "preference" });
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((e) => e.category === "preference")).toBe(true);
  });

  it("filters by free-text query against content", async () => {
    const result = await runSearchMemoryTool({ query: "overvalued" });
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((e) => e.content.includes("overvalued"))).toBe(true);
  });

  it("combines symbol + category as an AND filter", async () => {
    const result = await runSearchMemoryTool({ symbol: "NVDA", category: "watchlist" });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].symbol).toBe("NVDA");
  });

  it("returns entries newest first when no filter is given", async () => {
    const result = await runSearchMemoryTool({});
    const timestamps = result.entries.map((e) => e.id);
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
  });

  it("caps results at the documented MAX_RESULTS (20)", async () => {
    for (let i = 0; i < 25; i++) {
      await runWriteMemoryTool({ content: `bulk note ${i}` });
    }
    const result = await runSearchMemoryTool({});
    expect(result.entries.length).toBe(20);
  });
});
