import { Router } from "express";
import { botName, detectChatId, loadConfig, saveConfig, sendMessage } from "../telegram.js";

export const telegramRouter = Router();

// Mounted behind requireApiKey (see index.ts): these routes can spend the
// user's bot and write credentials, so they are never open.

telegramRouter.get("/status", (_req, res) => {
  const cfg = loadConfig();
  res.json({ configured: Boolean(cfg?.token), linked: Boolean(cfg?.chatId) });
});

// Body: { token?, chatId? }. A new token is validated with getMe; without a
// chatId the chat is auto-detected from the bot's pending /start message.
telegramRouter.post("/config", async (req, res) => {
  try {
    const existing = loadConfig();
    const token = typeof req.body?.token === "string" && req.body.token.trim() ? req.body.token.trim() : existing?.token;
    if (!token) return res.status(400).json({ error: "bot token required" });
    const username = await botName(token);
    let chatId = typeof req.body?.chatId === "string" && req.body.chatId.trim() ? req.body.chatId.trim() : null;
    if (!chatId && token === existing?.token) chatId = existing?.chatId ?? null;
    if (!chatId) chatId = await detectChatId(token);
    saveConfig({ token, chatId });
    res.json({ configured: true, linked: Boolean(chatId), bot: username });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "telegram setup failed" });
  }
});

telegramRouter.post("/send", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "text required" });
  const cfg = loadConfig();
  if (!cfg) return res.status(409).json({ error: "Telegram is not configured" });
  try {
    await sendMessage(cfg, text);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "telegram send failed" });
  }
});
