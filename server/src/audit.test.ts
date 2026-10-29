import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// db.ts reads DATA_DIR at import time and opens a real sqlite file there, so
// point it at a throwaway directory instead of the app's real data/ folder,
// before dynamically importing db.js (and audit.js, which imports it).
let tmpDir: string;
let db: (typeof import("./db.js"))["db"];
let writeAuditLog: (typeof import("./audit.js"))["writeAuditLog"];

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "openterminal-audit-test-"));
  process.env.DATA_DIR = tmpDir;
  ({ db } = await import("./db.js"));
  ({ writeAuditLog } = await import("./audit.js"));
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe("writeAuditLog", () => {
  it("round-trips a basic insert with no model/token metadata", () => {
    writeAuditLog({ eventType: "memory_write", summary: "note", detail: { content: "note" } });

    const row = db
      .prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1")
      .get() as Record<string, unknown>;
    expect(row.event_type).toBe("memory_write");
    expect(row.summary).toBe("note");
    expect(JSON.parse(row.detail as string)).toEqual({ content: "note" });
    expect(row.model).toBeNull();
    expect(row.input_tokens).toBeNull();
    expect(row.output_tokens).toBeNull();
    expect(row.created_at).toBeTruthy();
  });

  it("round-trips model/token metadata", () => {
    writeAuditLog({
      eventType: "chat",
      summary: "hi -> hello",
      detail: { messages: [], response: "hello" },
      model: "anthropic",
      inputTokens: 12,
      outputTokens: 34,
    });

    const row = db
      .prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1")
      .get() as Record<string, unknown>;
    expect(row.model).toBe("anthropic");
    expect(row.input_tokens).toBe(12);
    expect(row.output_tokens).toBe(34);
  });

  it("rejects an unrecognized event_type via the CHECK constraint", () => {
    expect(() =>
      db
        .prepare("INSERT INTO audit_log (event_type, summary, detail) VALUES (?, ?, ?)")
        .run("bogus", "x", "{}")
    ).toThrow();
  });
});

describe("audit_log append-only triggers", () => {
  it("raises on a direct UPDATE against audit_log", () => {
    const info = writeAuditLog({ eventType: "error", summary: "boom", detail: { error: "boom" } }) as unknown;
    const row = db.prepare("SELECT id FROM audit_log ORDER BY id DESC LIMIT 1").get() as { id: number };

    expect(() =>
      db.prepare("UPDATE audit_log SET summary = ? WHERE id = ?").run("tampered", row.id)
    ).toThrow(/append-only/i);

    const after = db.prepare("SELECT summary FROM audit_log WHERE id = ?").get(row.id) as { summary: string };
    expect(after.summary).toBe("boom");
    void info;
  });

  it("raises on a direct DELETE against audit_log", () => {
    writeAuditLog({ eventType: "error", summary: "to-delete", detail: { error: "to-delete" } });
    const row = db.prepare("SELECT id FROM audit_log ORDER BY id DESC LIMIT 1").get() as { id: number };

    expect(() => db.prepare("DELETE FROM audit_log WHERE id = ?").run(row.id)).toThrow(/append-only/i);

    const stillThere = db.prepare("SELECT id FROM audit_log WHERE id = ?").get(row.id);
    expect(stillThere).toBeDefined();
  });
});
