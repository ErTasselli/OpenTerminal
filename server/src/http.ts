import https from "node:https";

// Upstream market-data hosts occasionally accept the TCP connection and then
// never answer, which with a bare fetch() holds the request (and every widget
// waiting on it) for over a minute. Every outbound call goes through here so
// a stuck provider fails fast and the fallback chain / stale cache takes over.
export const DEFAULT_TIMEOUT_MS = 8_000;

export function tfetch(url: string | URL, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(url, { ...init, signal });
}

/** GET via node:https. Some hosts (FRED's CDN) silently drop undici/fetch
 * connections but answer node:https with a curl-style User-Agent immediately. */
export function httpsGetText(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "user-agent": "curl/8.9.1", accept: "*/*" }, timeout: timeoutMs }, (res) => {
      if (!res.statusCode || res.statusCode >= 400) {
        res.resume();
        reject(new Error(`http ${res.statusCode} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`timeout after ${timeoutMs}ms for ${url}`)));
    req.on("error", reject);
  });
}
