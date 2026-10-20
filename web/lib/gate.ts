import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Access control for the bundled web proxy, which attaches the API's shared
 * secret to every request it forwards. Without these checks anyone who can
 * reach port 3000 inherits full portfolio + paid-AI access.
 *
 * Two layers:
 *  1. Host / Origin allowlist (always on): defeats DNS rebinding and
 *     cross-site form posts against a terminal running on localhost.
 *  2. WEB_ACCESS_TOKEN (opt-in, REQUIRED when exposed beyond localhost): the
 *     browser must hold an HttpOnly cookie set via /access before any /api
 *     call is forwarded. Host headers are caller-controlled off-box, so layer
 *     1 alone never protects a network-exposed deployment.
 */
export const ACCESS_COOKIE = "ot_access";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Hostnames this app answers for: loopback plus PUBLIC_ORIGIN, if set. */
export function allowedHosts(): Set<string> {
  const hosts = new Set(LOOPBACK_HOSTS);
  const publicHost = hostOf(process.env.PUBLIC_ORIGIN ?? null);
  if (publicHost) hosts.add(publicHost);
  return hosts;
}

export function isAllowedHost(hostHeader: string | null): boolean {
  const h = hostOf(hostHeader);
  return h !== null && allowedHosts().has(h);
}

/** State-changing requests must come from this app's own pages. */
export function isSameOriginWrite(method: string, origin: string | null, secFetchSite: string | null): boolean {
  if (method === "GET" || method === "HEAD") return true;
  if (secFetchSite) return secFetchSite === "same-origin";
  // Browsers without Fetch Metadata still send Origin on cross-site POST/DELETE.
  if (origin) return isAllowedHost(origin);
  // No browser signals at all: a non-browser client (curl). Those can't ride
  // a victim's cookies, so CSRF doesn't apply; the token gate still does.
  return true;
}

export function accessToken(): string | null {
  const t = process.env.WEB_ACCESS_TOKEN?.trim();
  return t ? t : null;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time comparison (hashing first equalizes lengths). */
export function tokenMatches(provided: string | undefined | null): boolean {
  const expected = accessToken();
  if (!expected) return true; // gate disabled: loopback-only default
  if (!provided) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}
