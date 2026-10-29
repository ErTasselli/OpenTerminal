import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./db.js";
import { tfetch } from "./http.js";

// Bot credentials come from TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID, or from
// data/telegram.json (written by the Alerts widget's setup form, mode 0600 and
// git-ignored). The token never leaves this process: no route returns it.

const file = join(dataDir, "telegram.json");

export type TelegramConfig = { token: string; chatId: string | null };

export function loadConfig(): TelegramConfig | null {
  const envToken = process.env.TELEGRAM_BOT_TOKEN;
  if (envToken) return { token: envToken, chatId: process.env.TELEGRAM_CHAT_ID ?? null };
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return typeof raw.token === "string" && raw.token ? { token: raw.token, chatId: raw.chatId ?? null } : null;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: TelegramConfig): void {
  writeFileSync(file, JSON.stringify(cfg), { mode: 0o600 });
}

async function call(token: string, method: string, body?: unknown): Promise<any> {
  const res = await tfetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.description ?? `telegram ${res.status}`);
  return json.result;
}

/** Validates a token and returns the bot's @username. */
export async function botName(token: string): Promise<string> {
  const me = await call(token, "getMe");
  return me.username as string;
}

/** The chat that most recently messaged the bot (the user presses Start first). */
export async function detectChatId(token: string): Promise<string | null> {
  const updates: any[] = await call(token, "getUpdates", { limit: 20, allowed_updates: ["message"] });
  for (let i = updates.length - 1; i >= 0; i--) {
    const chat = updates[i]?.message?.chat;
    if (chat?.id !== undefined) return String(chat.id);
  }
  return null;
}

export async function sendMessage(cfg: TelegramConfig, text: string): Promise<void> {
  if (!cfg.chatId) throw new Error("no Telegram chat linked yet");
  await call(cfg.token, "sendMessage", { chat_id: cfg.chatId, text: text.slice(0, 1000) });
}
