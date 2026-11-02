import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the repo root from this module, then load the shared root .env before
// anything reads DATA_DIR/API_KEY/etc. Node's loader does not overwrite values
// already present in the real environment, which keeps shell/Docker overrides
// authoritative.
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const envCandidates = [
  process.env.ENV_FILE,
  join(repoRoot, ".env"),
  join(process.cwd(), ".env"),
  join(process.cwd(), "..", ".env"),
].filter((candidate): candidate is string => Boolean(candidate));

const envFile = envCandidates.find((candidate) => existsSync(candidate));
if (envFile && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envFile);
}

export const dataDir = process.env.DATA_DIR ?? join(repoRoot, "data");

mkdirSync(dataDir, { recursive: true });
