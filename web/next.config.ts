import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Next only auto-loads .env files from web/. The monorepo keeps one shared
// root .env (API_URL, API_KEY_FILE, etc.), so load it here before Next reads
// process.env. Existing shell/Docker values are not overwritten.
const webDir = dirname(fileURLToPath(import.meta.url));
const root = join(webDir, "..");
const envFile = [process.env.ENV_FILE, join(root, ".env"), join(webDir, ".env")]
  .filter((candidate): candidate is string => Boolean(candidate))
  .find((candidate) => existsSync(candidate));
if (envFile && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envFile);
}

// API requests are proxied by web/app/api/[...path]/route.ts instead of a
// rewrite here, so the shared API key can be attached server-side. See
// web/lib/api-key.ts.
const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
