import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir } from "../paths.js";

// Charles Schwab's individual Trader API. Authentication is OAuth 2.0 with a
// short-lived access token (30 min) and a rotating refresh token (7 days), so
// this module owns token persistence/refresh for every Schwab caller —
// market data, streamer login, and the auth CLI all go through it.

const API_BASE = (process.env.SCHWAB_API_BASE ?? "https://api.schwabapi.com").replace(/\/+$/, "");
const ACCESS_TOKEN_SAFETY_MS = 60_000;

// Schwab's documented app-wide limit is 120 requests/minute. Stay slightly
// below it and serialize the window so bursts queue instead of stampeding.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 110;
const requestTimes: number[] = [];

export type SchwabTokens = {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  token_type?: string;
  scope?: string;
};

export type SchwabStreamerInfo = {
  streamerSocketUrl: string;
  schwabClientCustomerId: string;
  schwabClientCorrelId: string;
  schwabClientChannel: string;
  schwabClientFunctionId: string;
};

export function schwabClientId(): string | undefined {
  return process.env.SCHWAB_CLIENT_ID?.trim() || undefined;
}

export function schwabClientSecret(): string | undefined {
  return process.env.SCHWAB_CLIENT_SECRET?.trim() || undefined;
}

export function schwabRedirectUri(): string {
  return process.env.SCHWAB_REDIRECT_URI?.trim() || "https://127.0.0.1";
}

export function schwabTokenFile(): string {
  return process.env.SCHWAB_TOKEN_FILE?.trim() || join(dataDir, ".schwab-token.json");
}

function readTokenFile(): SchwabTokens | null {
  const file = schwabTokenFile();
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<SchwabTokens>;
    if (!parsed.access_token) return null;
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      expires_at: Number(parsed.expires_at ?? 0),
      token_type: parsed.token_type,
      scope: parsed.scope,
    };
  } catch {
    return null;
  }
}

function saveTokens(tokens: SchwabTokens): void {
  const file = schwabTokenFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
}

let cached: SchwabTokens | null | undefined;
let refreshInFlight: Promise<SchwabTokens> | null = null;

function loadTokens(): SchwabTokens | null {
  // Re-check the file while no tokens are cached, so running the auth CLI
  // against a live server takes effect without a restart.
  if (cached !== undefined && cached !== null) return cached;

  // A token file is authoritative because every refresh rotates the token and
  // rewrites this file. Env vars are the bootstrap path for fresh installs and
  // containers without a writable data volume.
  const fromFile = readTokenFile();
  if (fromFile) {
    cached = fromFile;
    return cached;
  }

  const access = process.env.SCHWAB_ACCESS_TOKEN?.trim();
  const refresh = process.env.SCHWAB_REFRESH_TOKEN?.trim();
  if (!access && !refresh) {
    cached = null;
    return null;
  }
  cached = {
    access_token: access ?? "",
    refresh_token: refresh,
    // An env-only access token has no known expiry; assume the standard 30 min
    // from process start. Deployments should use SCHWAB_REFRESH_TOKEN instead.
    expires_at: access ? Date.now() + 25 * 60_000 : 0,
  };
  return cached;
}

export function isSchwabConfigured(): boolean {
  const tokens = loadTokens();
  const hasCreds = Boolean(schwabClientId() && schwabClientSecret());
  return Boolean(tokens && (tokens.access_token || tokens.refresh_token) && (hasCreds || tokens.access_token));
}

/** Safe-to-display auth state — never includes the token itself. */
export function schwabTokenStatus(): {
  configured: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  accessTokenExpiresAt: number | null;
} {
  const tokens = loadTokens();
  return {
    configured: isSchwabConfigured(),
    hasAccessToken: Boolean(tokens?.access_token),
    hasRefreshToken: Boolean(tokens?.refresh_token),
    accessTokenExpiresAt: tokens?.expires_at ? tokens.expires_at : null,
  };
}

/** Force a refresh on the next access-token read (used after a 401). */
export function invalidateSchwabToken(): void {
  if (cached) cached = { ...cached, expires_at: 0 };
}

async function requestTokens(body: URLSearchParams): Promise<SchwabTokens> {
  const id = schwabClientId();
  const secret = schwabClientSecret();
  if (!id || !secret) {
    throw new Error(
      "Schwab credentials missing: set SCHWAB_CLIENT_ID and SCHWAB_CLIENT_SECRET, then run `npm run schwab:auth -w server`."
    );
  }

  const res = await fetch(`${API_BASE}/v1/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`schwab oauth ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
  };
  if (!json.access_token) throw new Error("schwab oauth: response missing access_token");

  const tokens: SchwabTokens = {
    access_token: json.access_token,
    // Keep the previous refresh token if Schwab's response omits it; dropping
    // it would leave the next refresh with nothing to send.
    refresh_token: json.refresh_token ?? body.get("refresh_token") ?? undefined,
    expires_at: Date.now() + Number(json.expires_in ?? 1800) * 1000,
    token_type: json.token_type,
    scope: json.scope,
  };
  saveTokens(tokens);
  cached = tokens;
  return tokens;
}

async function refreshTokens(tokens: SchwabTokens): Promise<SchwabTokens> {
  if (!tokens.refresh_token) {
    throw new Error(
      "Schwab access token expired and no refresh token is available. Run `npm run schwab:auth -w server` to re-authorize."
    );
  }
  return requestTokens(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token })
  );
}

export async function getSchwabAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) {
    throw new Error(
      "Schwab is not configured. Set SCHWAB_CLIENT_ID/SCHWAB_CLIENT_SECRET and run `npm run schwab:auth -w server`."
    );
  }
  if (tokens.access_token && tokens.expires_at > Date.now() + ACCESS_TOKEN_SAFETY_MS) {
    return tokens.access_token;
  }

  if (!refreshInFlight) {
    refreshInFlight = refreshTokens(tokens).finally(() => {
      refreshInFlight = null;
    });
  }
  try {
    const refreshed = await refreshInFlight;
    return refreshed.access_token;
  } catch (err) {
    // Drop the cached copy so the next call can pick up a token file written
    // by the auth CLI (or retry a transient refresh failure).
    cached = null;
    throw err;
  }
}

export function schwabAuthorizationUrl(state?: string): string {
  const id = schwabClientId();
  if (!id) throw new Error("SCHWAB_CLIENT_ID is required to build the authorization URL");
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: schwabRedirectUri(),
    response_type: "code",
    scope: "api",
  });
  if (state) params.set("state", state);
  return `${API_BASE}/v1/oauth/authorize?${params.toString()}`;
}

/** Exchange an authorization code (or a full redirect URL containing one). */
export async function exchangeSchwabCode(input: string): Promise<SchwabTokens> {
  let code = input.trim();
  if (/^https?:\/\//i.test(code)) {
    const url = new URL(code);
    code = url.searchParams.get("code") ?? code;
  }
  if (!code) throw new Error("authorization code is required");
  return requestTokens(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: schwabRedirectUri(),
    })
  );
}

/** Forget the stored Schwab credentials (used by the Settings page). */
export function clearSchwabTokens(): void {
  try {
    if (existsSync(schwabTokenFile())) unlinkSync(schwabTokenFile());
  } catch {
    // Best effort; the in-memory copy is cleared regardless.
  }
  cached = null;
}

async function rateLimit(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (requestTimes.length > 0 && now - requestTimes[0] >= RATE_WINDOW_MS) requestTimes.shift();
    if (requestTimes.length < RATE_MAX) {
      requestTimes.push(now);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, RATE_WINDOW_MS - (now - requestTimes[0]) + 25));
  }
}

export async function schwabFetch(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  await rateLimit();
  const token = await getSchwabAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401 && !retried) {
    invalidateSchwabToken();
    return schwabFetch(path, init, true);
  }
  return res;
}

export async function schwabGet<T>(path: string): Promise<T> {
  const res = await schwabFetch(path);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`schwab ${res.status} ${path}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

export async function getSchwabStreamerInfo(): Promise<SchwabStreamerInfo> {
  const json = await schwabGet<{ streamerInfo?: SchwabStreamerInfo[] }>("/trader/v1/userPreference");
  const info = json.streamerInfo?.[0];
  if (
    !info?.streamerSocketUrl ||
    !info.schwabClientCustomerId ||
    !info.schwabClientCorrelId ||
    !info.schwabClientChannel ||
    !info.schwabClientFunctionId
  ) {
    throw new Error("schwab userPreference: missing streamerInfo");
  }
  return info;
}
