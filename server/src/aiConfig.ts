import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./db.js";

// AI connection settings. Saved by the Settings dialog to data/ai.json (mode
// 0600, git-ignored); falls back to ANTHROPIC_API_KEY / ANTHROPIC_MODEL. The key
// never leaves this process: no route returns it.

const file = join(dataDir, "ai.json");

export type AiProvider = "anthropic" | "openai" | "openrouter" | "nvidia";
export type AiConfig = { provider: AiProvider; apiKey: string; model: string; baseUrl: string };

export const DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-4o",
  openrouter: "openai/gpt-4o",
  nvidia: "meta/llama-3.3-70b-instruct",
};
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
/** Hosted OpenAI-compatible providers with a fixed endpoint (always need a key). */
export const PRESET_BASE_URL: Partial<Record<AiProvider, string>> = {
  openrouter: "https://openrouter.ai/api/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
};
export const PROVIDERS = ["anthropic", "openai", "openrouter", "nvidia"] as const;

function readFile(): Partial<AiConfig> {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function loadAiConfig(): AiConfig {
  const f = readFile();
  const provider: AiProvider = PROVIDERS.find((x) => x === f.provider) ?? "anthropic";
  const apiKey = f.apiKey || (provider === "anthropic" ? process.env.ANTHROPIC_API_KEY ?? "" : "");
  const model = f.model || (provider === "anthropic" ? process.env.ANTHROPIC_MODEL : undefined) || DEFAULT_MODEL[provider];
  return { provider, apiKey, model, baseUrl: PRESET_BASE_URL[provider] ?? (f.baseUrl || DEFAULT_BASE_URL) };
}

/** An OpenAI-compatible server on a custom base URL (Ollama, LM Studio…) needs no key. */
export function isConfigured(c: AiConfig): boolean {
  if (c.provider === "anthropic") return Boolean(c.apiKey);
  if (c.provider !== "openai") return Boolean(c.apiKey);
  return Boolean(c.apiKey) || c.baseUrl.replace(/\/+$/, "") !== DEFAULT_BASE_URL;
}

export function saveAiConfig(patch: Partial<AiConfig>): AiConfig {
  const cur = readFile();
  const next: Partial<AiConfig> = { ...cur, ...patch };
  writeFileSync(file, JSON.stringify(next), { mode: 0o600 });
  return loadAiConfig();
}
