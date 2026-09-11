import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NextFunction, Request, Response } from "express";
import { dataDir } from "./db.js";

const keyFile = join(dataDir, ".api-key");

function resolveApiKey(): string {
  if (process.env.API_KEY) return process.env.API_KEY;
  if (existsSync(keyFile)) return readFileSync(keyFile, "utf8").trim();
  const generated = randomBytes(24).toString("hex");
  writeFileSync(keyFile, generated, { mode: 0o600 });
  return generated;
}

export const apiKey = resolveApiKey();

if (!process.env.API_KEY) {
  console.warn(
    `No API_KEY set — generated one and saved it to ${keyFile}. ` +
      "The bundled web app reads this file automatically for local use. " +
      "For any deployment reachable beyond localhost, set API_KEY explicitly " +
      "on both the api and web services and keep this file private."
  );
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const provided = req.header("x-api-key") ?? "";
  const expected = Buffer.from(apiKey);
  const actual = Buffer.from(provided);
  if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
    next();
    return;
  }
  res.status(401).json({ error: "missing or invalid X-Api-Key header" });
}
