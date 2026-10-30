import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, accessToken, isAllowedHost, isSameOriginWrite, tokenMatches } from "@/lib/gate";

// Sign-in for deployments that set WEB_ACCESS_TOKEN (see web/lib/gate.ts).
// The token is exchanged once for an HttpOnly, SameSite=Strict cookie so page
// scripts can never read it and cross-site requests never carry it.
const FORM = (msg = "") => `<!doctype html><meta charset="utf-8"><title>OpenTerminal access</title>
<body style="background:#000;color:#ddd;font:14px monospace;padding:2rem">
<form method="post"><p>OpenTerminal access token</p>
<input name="token" type="password" autocomplete="current-password" autofocus style="width:28rem">
<button>Enter</button></form>${msg ? `<p style="color:#f55">${msg}</p>` : ""}</body>`;

const html = (body: string, status = 200) =>
  new NextResponse(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });

export async function GET(req: NextRequest) {
  if (!isAllowedHost(req.headers.get("host"))) return html("host not allowed", 403);
  return html(FORM(accessToken() ? "" : "No WEB_ACCESS_TOKEN configured; access is open on localhost."));
}

// Naive per-process brute-force brake: failed attempts slow everyone down.
let failures = 0;

export async function POST(req: NextRequest) {
  if (!isAllowedHost(req.headers.get("host"))) return html("host not allowed", 403);
  if (!isSameOriginWrite("POST", req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return html("cross-site request refused", 403);
  }
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  if (!accessToken() || !tokenMatches(token)) {
    failures = Math.min(failures + 1, 20);
    await new Promise((r) => setTimeout(r, 250 * failures));
    return html(FORM("Invalid token."), 401);
  }
  failures = 0;
  // Relative Location: req.url carries the server's internal hostname (e.g. the
  // container id in Docker), which the browser can't reach.
  const res = new NextResponse(null, { status: 303, headers: { location: "/" } });
  res.cookies.set(ACCESS_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    // TLS usually terminates in front of this process, so trust the configured
    // public origin rather than the (plain http) request this process sees.
    secure: (process.env.PUBLIC_ORIGIN ?? "").startsWith("https:") || req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
