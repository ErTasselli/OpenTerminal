// Read/delete surface for Memory Entries (see CONTEXT.md). The AI writes Memory
// Entries itself via the write_memory tool (server/src/llm/memoryTools.ts) during
// a chat turn -- there is no POST/PUT here, since a Memory Entry is AI-authored
// and the user can only delete one, never edit it in place (ADR-0002).
import { Router } from "express";
import { db } from "../db.js";

export const memoryRouter = Router();

memoryRouter.get("/", (_req, res) => {
  res.json(db.prepare("SELECT * FROM memory_entries ORDER BY created_at DESC, id DESC").all());
});

memoryRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM memory_entries WHERE id = ?").run(req.params.id);
  res.status(204).end();
});
