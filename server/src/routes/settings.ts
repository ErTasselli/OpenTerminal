import { Router } from "express";
import {
  getSettings,
  publicAiSettings,
  updateSettings,
  type SettingsPatch,
} from "../settings.js";
import {
  isSchwabConfigured,
  schwabClientId,
  schwabClientSecret,
  schwabRedirectUri,
  schwabTokenFile,
  schwabTokenStatus,
} from "../providers/schwabAuth.js";
import { schwabStreamer } from "../providers/schwabStreamer.js";

export const settingsRouter = Router();

function payload() {
  return {
    dataSource: getSettings().dataSource,
    ai: publicAiSettings(),
    schwab: {
      ...schwabTokenStatus(),
      clientIdConfigured: Boolean(schwabClientId()),
      clientSecretConfigured: Boolean(schwabClientSecret()),
      redirectUri: schwabRedirectUri(),
      tokenFile: schwabTokenFile(),
      streaming: schwabStreamer.status(),
    },
  };
}

settingsRouter.get("/", (_req, res) => {
  res.json(payload());
});

settingsRouter.put("/", (req, res) => {
  const body = (req.body ?? {}) as SettingsPatch;
  if (body.dataSource !== undefined && body.dataSource !== "schwab" && body.dataSource !== "public") {
    return res.status(400).json({ error: 'dataSource must be "schwab" or "public"' });
  }
  if (body.ai !== undefined && (body.ai === null || typeof body.ai !== "object")) {
    return res.status(400).json({ error: "ai must be an object" });
  }
  if (body.ai?.baseUrl && !/^https?:\/\//i.test(body.ai.baseUrl)) {
    return res.status(400).json({ error: "ai.baseUrl must start with http:// or https://" });
  }

  try {
    updateSettings(body);
    res.json(payload());
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
