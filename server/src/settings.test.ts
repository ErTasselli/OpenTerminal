import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let tmpDir: string;
let settingsFile: string;
let settings: typeof import("./settings.js");

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "openterminal-settings-"));
  settingsFile = join(tmpDir, "settings.json");
  process.env.SETTINGS_FILE = settingsFile;
  settings = await import("./settings.js");
});

beforeEach(() => {
  rmSync(settingsFile, { force: true });
  settings.resetSettingsCacheForTests();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_MODEL;
});

afterAll(() => {
  delete process.env.SETTINGS_FILE;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_MODEL;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("runtime settings", () => {
  it("defaults to Schwab mode with no AI override", () => {
    expect(settings.getSettings()).toEqual({ dataSource: "schwab", ai: {} });
    expect(settings.publicAiSettings()).toMatchObject({
      configured: false,
      source: "none",
      baseUrl: "",
      model: "claude-opus-4-8",
    });
  });

  it("persists data source and AI overrides without exposing the key", () => {
    const next = settings.updateSettings({
      dataSource: "public",
      ai: { apiKey: "sk-test", baseUrl: "https://example.test/v1", model: "test-model" },
    });

    expect(next.dataSource).toBe("public");
    expect(settings.getSettings().ai.apiKey).toBe("sk-test");
    expect(settings.publicAiSettings()).toEqual({
      configured: true,
      source: "settings",
      baseUrl: "https://example.test/v1",
      model: "test-model",
    });

    const saved = JSON.parse(readFileSync(settingsFile, "utf8"));
    expect(saved.ai.apiKey).toBe("sk-test");
  });

  it("falls back to environment AI values and lets null clear overrides", () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    process.env.ANTHROPIC_BASE_URL = "https://env.test";
    expect(settings.getAiConfig()).toEqual({
      apiKey: "env-key",
      baseUrl: "https://env.test",
      model: "claude-opus-4-8",
    });
    expect(settings.publicAiSettings().source).toBe("env");

    settings.updateSettings({ ai: { apiKey: "saved-key" } });
    expect(settings.publicAiSettings().source).toBe("settings");

    settings.updateSettings({ ai: { apiKey: null } });
    expect(settings.publicAiSettings().source).toBe("env");
  });

  it("rejects an unknown data source", () => {
    expect(() => settings.updateSettings({ dataSource: "nasdaq" })).toThrow(
      /dataSource must be "schwab" or "public"/
    );
  });
});
