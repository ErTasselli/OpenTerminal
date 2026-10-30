import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NextFunction, Request, Response } from "express";
import { dataDir } from "./db.js";

const keyFile = join(dataDir, ".api-key");

/** Shorter secrets are refused outright. This also closes the fail-open case
 * where an empty key file made `""` the expected key, so a request with no
 * X-Api-Key header compared equal and was let through. */
export const MIN_API_KEY_LENGTH = 32;

function validated(key: string, source: string): string {
  if (key.length < MIN_API_KEY_LENGTH) {
    throw new Error(
      `API key from ${source} is ${key.length} characters; at least ${MIN_API_KEY_LENGTH} are required. ` +
        `Set API_KEY to a strong secret (e.g. \`openssl rand -hex 24\`) or delete ${keyFile} to regenerate it.`
    );
  }
  return key;
}

function resolveApiKey(): string {
  const fromEnv = process.env.API_KEY?.trim();
  if (fromEnv) return validated(fromEnv, "API_KEY");
  try {
    // "wx" = create only if absent, so two processes starting together can't
    // overwrite each other's key; the loser just reads the winner's file.
    writeFileSync(keyFile, randomBytes(24).toString("hex"), { mode: 0o600, flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  return validated(readFileSync(keyFile, "utf8").trim(), keyFile);
}

export const apiKey = resolveApiKey();

if (!process.env.API_KEY) {
  console.warn(
    `No API_KEY set — using the key in ${keyFile}. ` +
      "The bundled web app reads this file automatically for local use. " +
      "For any deployment reachable beyond localhost, set API_KEY explicitly " +
      "on both the api and web services and keep this file private."
  );
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const provided = req.header("x-api-key") ?? "";
  const expected = Buffer.from(apiKey);
  const actual = Buffer.from(provided);
  if (expected.length > 0 && actual.length === expected.length && timingSafeEqual(actual, expected)) {
    next();
    return;
  }
  res.status(401).json({ error: "missing or invalid X-Api-Key header" });
}
