import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir } from "./paths.js";

// Runtime-editable settings live outside .env so the settings page can change
// them without a restart. Environment variables remain the fallback/default.

export type DataSource = "schwab" | "public";

type AiOverrides = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export type Settings = {
  dataSource: DataSource;
  ai: AiOverrides;
};

export type SettingsPatch = {
  dataSource?: unknown;
  ai?: {
    apiKey?: string | null;
    baseUrl?: string | null;
    model?: string | null;
  };
};

const settingsFile =
  process.env.SETTINGS_FILE?.trim() || join(dataDir, "settings.json");

let cached: Settings | null = null;

function normalize(raw: unknown): Settings {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const aiRaw = value.ai && typeof value.ai === "object" ? (value.ai as Record<string, unknown>) : {};

  const ai: AiOverrides = {};
  for (const key of ["apiKey", "baseUrl", "model"] as const) {
    const field = aiRaw[key];
    if (typeof field === "string" && field.trim()) ai[key] = field.trim();
  }

  return {
    dataSource: value.dataSource === "public" ? "public" : "schwab",
    ai,
  };
}

export function getSettings(): Settings {
  if (cached) return cached;
  try {
    cached = normalize(JSON.parse(readFileSync(settingsFile, "utf8")));
  } catch {
    cached = { dataSource: "schwab", ai: {} };
  }
  return cached;
}

export function settingsFilePath(): string {
  return settingsFile;
}

/** Exposed for tests that need to simulate a fresh process. */
export function resetSettingsCacheForTests(): void {
  cached = null;
}

export function updateSettings(patch: SettingsPatch): Settings {
  const current = getSettings();
  const next: Settings = {
    dataSource: current.dataSource,
    ai: { ...current.ai },
  };

  if (patch.dataSource !== undefined) {
    if (patch.dataSource !== "schwab" && patch.dataSource !== "public") {
      throw new Error('dataSource must be "schwab" or "public"');
    }
    next.dataSource = patch.dataSource;
  }

  if (patch.ai && typeof patch.ai === "object") {
    for (const key of ["apiKey", "baseUrl", "model"] as const) {
      const value = patch.ai[key];
      if (value === undefined) continue;
      if (value === null || (typeof value === "string" && value.trim() === "")) {
        delete next.ai[key];
      } else if (typeof value === "string") {
        next.ai[key] = value.trim();
      } else {
        throw new Error(`ai.${key} must be a string or null`);
      }
    }
  }

  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(next, null, 2), { mode: 0o600 });
  chmodSync(settingsFile, 0o600);
  cached = next;
  return next;
}

export function getAiConfig(): {
  apiKey: string | null;
  baseUrl: string | null;
  model: string;
} {
  const settings = getSettings();
  return {
    apiKey: settings.ai.apiKey || process.env.ANTHROPIC_API_KEY?.trim() || null,
    baseUrl: settings.ai.baseUrl || process.env.ANTHROPIC_BASE_URL?.trim() || null,
    model: settings.ai.model || process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-4-8",
  };
}

/** Settings-page view — never includes the API key itself. */
export function publicAiSettings(): {
  configured: boolean;
  source: "settings" | "env" | "none";
  baseUrl: string;
  model: string;
} {
  const settings = getSettings();
  const config = getAiConfig();
  return {
    configured: Boolean(config.apiKey),
    source: settings.ai.apiKey
      ? "settings"
      : process.env.ANTHROPIC_API_KEY?.trim()
      ? "env"
      : "none",
    baseUrl: config.baseUrl ?? "",
    model: config.model,
  };
}
