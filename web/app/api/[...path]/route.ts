import { NextRequest, NextResponse } from "next/server";
import { getApiKey } from "@/lib/api-key";

// A route handler (rather than next.config.ts rewrites) because rewrites
// can't attach a header to the proxied request — and the shared API key
// must never reach the browser, only travel server-to-server.
const API_URL = process.env.API_URL ?? "http://localhost:4000";

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const url = `${API_URL}/api/${path.join("/")}${req.nextUrl.search}`;
  const apiKey = getApiKey();

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (apiKey) headers.set("x-api-key", apiKey);

  const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.method !== "DELETE";

  const upstream = await fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? await req.text() : undefined,
    cache: "no-store",
  });

  const body = upstream.status === 204 ? null : await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
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
