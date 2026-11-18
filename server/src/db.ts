import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// DATA_DIR lets the Docker image point this at the mounted volume: once
// compiled, dist/db.js sits two levels below /app instead of server/src, so
// the source-relative default below would otherwise resolve outside /app.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const dataDir = process.env.DATA_DIR ?? join(root, "data");
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, "terminal.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Shared by the CREATE TABLE below (fresh DBs) and the migration loop further
// down (pre-existing DBs) so the two column sets can't drift apart.
const OPTION_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: "instrument_type", ddl: "instrument_type TEXT NOT NULL DEFAULT 'EQUITY' CHECK (instrument_type IN ('EQUITY','OPTION'))" },
  { name: "option_type", ddl: "option_type TEXT CHECK (option_type IS NULL OR option_type IN ('CALL','PUT'))" },
  { name: "strike", ddl: "strike REAL CHECK (strike IS NULL OR strike > 0)" },
  { name: "expiration", ddl: "expiration TEXT" },
];

db.exec(`
CREATE TABLE IF NOT EXISTS portfolios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  price REAL NOT NULL CHECK (price >= 0),
  executed_at TEXT NOT NULL,
  ${OPTION_COLUMNS.map((c) => c.ddl).join(",\n  ")}
);
-- A Memory Entry (see CONTEXT.md): a distilled, AI-authored note the assistant
-- saves on its own via the write_memory tool, with no propose/confirm gate.
-- Not portfolio-scoped (memory is global, not per-portfolio) and no updated_at/
-- edit path -- the user can only delete a Memory Entry, never edit one in place.
CREATE TABLE IF NOT EXISTS memory_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  symbol TEXT,
  category TEXT CHECK (category IS NULL OR category IN ('preference','watchlist','research-note')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Migration for pre-existing DBs created before the option-position columns above
// existed: this file is the only migration mechanism in this repo (no framework),
// so it runs unconditionally at module load, right alongside the CREATE TABLE and
// defaultPortfolio seed logic below.
const existingColumns = new Set(
  (db.prepare("PRAGMA table_info(transactions)").all() as Array<{ name: string }>).map((c) => c.name)
);
for (const col of OPTION_COLUMNS) {
  if (!existingColumns.has(col.name)) {
    db.exec(`ALTER TABLE transactions ADD COLUMN ${col.ddl}`);
  }
}

const defaultPortfolio = db.prepare("SELECT id FROM portfolios LIMIT 1").get();
if (!defaultPortfolio) {
  db.prepare("INSERT INTO portfolios (name) VALUES (?)").run("Main");
}
