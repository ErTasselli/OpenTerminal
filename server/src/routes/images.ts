import { Router } from "express";
import { readImage } from "../imageStore.js";

// Serves a chat-attached image back by the id llm/auditImages.ts's toAuditMessages (or
// imageStore.ts's saveImage directly) returned when it was persisted to disk under
// DATA_DIR/images (#30). Mounted at /api/images behind requireApiKey (see index.ts) --
// same auth gate as every other endpoint that can return a user's own data (Memory
// Entries, the Audit Log, portfolios).
export const imagesRouter = Router();

imagesRouter.get("/:id", (req, res) => {
  // readImage itself re-validates req.params.id's shape (imageStore.ts's
  // IMAGE_ID_PATTERN) before ever joining it into a filesystem path -- this route never
  // does its own path.join, specifically so a caller-supplied id can't reach the
  // filesystem without passing through that one validated chokepoint first.
  const stored = readImage(req.params.id);
  if (!stored) {
    res.status(404).json({ error: "image not found" });
    return;
  }
  // The id is a content hash: the same id always resolves to the same bytes, so a long
  // cache lifetime is safe (nothing ever needs invalidating in place).
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.type(stored.mimeType).send(stored.bytes);
});
