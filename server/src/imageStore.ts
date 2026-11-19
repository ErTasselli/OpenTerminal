import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./db.js";

// A screenshot pasted/dropped into the AI Assistant's chat input (#29) is saved here,
// once, under DATA_DIR -- the same "a plain file under dataDir" pattern auth.ts uses for
// .api-key, rather than a new SQLite table: an image is an opaque blob with no fields to
// query/filter/join on (unlike transactions, memory_entries, audit_log), so a table would
// only add a migration and a BLOB column for no relational benefit. See #30.
export const imagesDir = join(dataDir, "images");
mkdirSync(imagesDir, { recursive: true });

// The only mime types this ever stores -- the same set llm/types.ts's
// SUPPORTED_IMAGE_MIME_TYPES accepts from the wire (validateImagePart runs before any
// image reaches saveImage). Kept as an explicit allowlist, not derived from the mime
// string, so a stored image's id can be validated by its filename shape alone (see
// IMAGE_ID_PATTERN below) without ever trusting a caller-supplied extension.
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const MIME_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSION_BY_MIME).map(([mime, ext]) => [ext, mime])
);

// An image id is always `<sha256-hex>.<ext>`, ext one of the known extensions above.
// This is the only thing standing between a caller-supplied id (the serve-by-id route's
// :id param, or an "image-ref" part resurfacing from the Audit Log) and a filesystem
// path join in readImage below -- never join imagesDir with an id that hasn't passed
// this check first: a crafted id like "../../etc/passwd" must be rejected before it
// ever reaches join()/readFileSync, not caught after.
const IMAGE_ID_PATTERN = /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/;

export function isValidImageId(id: string): boolean {
  return IMAGE_ID_PATTERN.test(id);
}

export type StoredImage = { id: string; mimeType: string };

/**
 * Saves one base64-encoded image to disk under DATA_DIR/images, once. The id is the
 * sha256 hex digest of the raw bytes plus a fixed extension for its mimeType --
 * content-addressed, so attaching the same image bytes again (the same screenshot
 * pasted twice, or the same turn's image reaching this function more than once across
 * the Audit Log write and a capped-history rehydration) reuses the same file instead of
 * writing a duplicate; existsSync below makes the write itself a no-op in that case.
 * Caller must have already validated mimeType against SUPPORTED_IMAGE_MIME_TYPES
 * (llm/types.ts's validateImagePart) -- this function trusts it for any already-
 * validated chat request, but still throws on an unrecognized mime type rather than
 * writing a file with no matching extension.
 */
export function saveImage(base64Data: string, mimeType: string): StoredImage {
  const ext = EXTENSION_BY_MIME[mimeType];
  if (!ext) {
    throw new Error(`Cannot store unsupported image mime type "${mimeType}".`);
  }
  const bytes = Buffer.from(base64Data, "base64");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const id = `${hash}.${ext}`;
  const path = join(imagesDir, id);
  if (!existsSync(path)) {
    writeFileSync(path, bytes, { mode: 0o600 });
  }
  return { id, mimeType };
}

/**
 * Reads back a stored image's bytes + mimeType by id, for the serve-by-id route (and
 * for rehydrating a recent turn's image-ref back to raw bytes before a provider call --
 * see llm/imageHistoryCap.ts). Returns null for a missing file *or* a malformed id --
 * isValidImageId is checked first so a caller-supplied id never reaches path.join /
 * readFileSync unvalidated (path traversal defense; see IMAGE_ID_PATTERN above).
 */
export function readImage(id: string): { bytes: Buffer; mimeType: string } | null {
  if (!isValidImageId(id)) return null;
  const ext = id.slice(id.lastIndexOf(".") + 1);
  const mimeType = MIME_BY_EXTENSION[ext];
  if (!mimeType) return null;
  const path = join(imagesDir, id);
  if (!existsSync(path)) return null;
  try {
    return { bytes: readFileSync(path), mimeType };
  } catch {
    return null;
  }
}
