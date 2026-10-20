import { NextRequest, NextResponse } from "next/server";
import { getApiKey } from "@/lib/api-key";
import { ACCESS_COOKIE, accessToken, isAllowedHost, isSameOriginWrite, tokenMatches } from "@/lib/gate";

// A route handler (rather than next.config.ts rewrites) because rewrites
// can't attach a header to the proxied request — and the shared API key
// must never reach the browser, only travel server-to-server.
const API_URL = process.env.API_URL ?? "http://localhost:4000";
// AI answers can take a while; everything else is a cached market lookup.
const TIMEOUT_MS = { ai: 120_000, default: 30_000 };
// Upstream response headers worth relaying (Retry-After lets the UI back off on 429;
// Content-Disposition names CSV downloads). An allowlist, so internal headers never leak.
const PASS_HEADERS = ["content-type", "retry-after", "cache-control", "content-disposition", "x-content-type-options"];

const deny = (status: number, error: string) => NextResponse.json({ error }, { status });

/** Access checks; null = allowed. See web/lib/gate.ts for the threat model. */
function guard(req: NextRequest): NextResponse | null {
  const host = req.headers.get("host");
  if (!isAllowedHost(host)) {
    // Unknown Host = DNS rebinding, or an exposed deployment without PUBLIC_ORIGIN.
    return deny(403, "host not allowed (set PUBLIC_ORIGIN when serving beyond localhost)");
  }
  if (!isSameOriginWrite(req.method, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return deny(403, "cross-site request refused");
  }
  const token = accessToken();
  if (token !== null && token.length < 32) return deny(500, "WEB_ACCESS_TOKEN must be at least 32 characters");
  const loopback = isAllowedHost(host) && !process.env.PUBLIC_ORIGIN;
  if (token === null && !loopback && process.env.WEB_ALLOW_UNAUTHENTICATED !== "1") {
    // Fail closed: a public origin with no access token would hand the API key to anyone.
    return deny(503, "WEB_ACCESS_TOKEN is required when PUBLIC_ORIGIN is set");
  }
  if (!tokenMatches(req.cookies.get(ACCESS_COOKIE)?.value ?? req.headers.get("x-access-token"))) {
    return deny(401, "access token required: open /access to sign in");
  }
  return null;
}

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const blocked = guard(req);
  if (blocked) return blocked;

  // Segments arrive URL-decoded; refuse anything that could change the path shape.
  if (path.some((s) => s === "." || s === ".." || /[\/\\]/.test(s))) return deny(400, "invalid path");

  const url = `${API_URL}/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const apiKey = getApiKey();

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (apiKey) headers.set("x-api-key", apiKey);
  // Relayed, not fabricated: only meaningful (and only trusted by the API)
  // when TRUST_PROXY=1 is set there — see server/src/app.ts.
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);

  const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.method !== "DELETE";

  // Live streams have no deadline; they end when the browser disconnects
  // (req.signal), which also closes the upstream connection to the API.
  const streaming = path[0] === "stream";
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? await req.text() : undefined,
      cache: "no-store",
      signal: streaming ? req.signal : AbortSignal.timeout(path[0] === "ai" ? TIMEOUT_MS.ai : TIMEOUT_MS.default),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    console.error("[proxy]", req.method, path.join("/"), timedOut ? "timeout" : err);
    return deny(timedOut ? 504 : 502, timedOut ? "API request timed out" : "API server unreachable");
  }

  const out = new Headers();
  for (const h of PASS_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (!out.has("content-type")) out.set("content-type", "application/json");
  if (streaming && upstream.ok && upstream.body) {
    out.set("cache-control", "no-cache, no-transform");
    out.set("x-accel-buffering", "no");
    return new NextResponse(upstream.body, { status: upstream.status, headers: out });
  }
  const body = upstream.status === 204 ? null : await upstream.arrayBuffer();
  return new NextResponse(body, { status: upstream.status, headers: out });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
