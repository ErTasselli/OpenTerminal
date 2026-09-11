import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | null = null;

/**
 * The API server auto-generates a shared secret and writes it to
 * data/.api-key when API_KEY isn't set explicitly. This process (running
 * server-side only — never shipped to the browser) reads the same file so
 * local/Docker setups stay zero-config while the API itself requires a key.
 *
 * A successful read is cached, but a failure never is: in Docker the web
 * container can start before the api container has generated the file, so
 * every request retries the (cheap) read until it succeeds.
 */
export function getApiKey(): string | null {
  if (process.env.API_KEY) return process.env.API_KEY;
  if (cached) return cached;

  const keyFile = process.env.API_KEY_FILE ?? join(process.cwd(), "..", "data", ".api-key");
  try {
    cached = readFileSync(keyFile, "utf8").trim();
  } catch {
    return null;
  }
  return cached;
}
