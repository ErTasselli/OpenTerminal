import {
  getSchwabAccessToken,
  getSchwabStreamerInfo,
  isSchwabConfigured,
  type SchwabStreamerInfo,
} from "./schwabAuth.js";

// Schwab's streaming API is a WebSocket whose protocol is close to the old
// TD Ameritrade one: log in with the OAuth access token, then SUBS/ADD/UNSUBS
// services such as LEVELONE_EQUITIES. This module keeps one upstream socket
// alive for all browser SSE clients and fans out merged quote updates.

export type LiveQuote = {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  time: number | null;
  source: "schwab-stream";
};

export type StreamerStatus = {
  configured: boolean;
  state: "idle" | "connecting" | "connected" | "error";
  connected: boolean;
  subscribed: string[];
  error: string | null;
};

type Listener = (quote: LiveQuote) => void;

type WebSocketLike = {
  send(data: string): void;
  close(): void;
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: { data?: unknown }) => void
  ): void;
};

type WebSocketCtor = new (url: string) => WebSocketLike;

// Fields requested from LEVELONE_EQUITIES. Sending the numeric ids keeps the
// payload small; responses can carry either numeric or named keys depending
// on the entitlement, so the parser accepts both.
const LEVEL_ONE_FIELDS = [
  0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 15, 17, 18, 19, 20, 21, 22, 23, 25, 34, 35, 42,
].join(",");

const FIELD_MAP: Array<[keyof Omit<LiveQuote, "symbol" | "source">, string, number]> = [
  ["price", "LAST_PRICE", 3],
  ["bid", "BID_PRICE", 1],
  ["ask", "ASK_PRICE", 2],
  ["volume", "TOTAL_VOLUME", 8],
  ["open", "OPEN_PRICE", 17],
  ["high", "HIGH_PRICE", 10],
  ["low", "LOW_PRICE", 11],
  ["previousClose", "CLOSE_PRICE", 12],
  ["change", "NET_CHANGE", 18],
  ["changePercent", "NET_CHANGE_PERCENT", 42],
];

const TIME_FIELDS = [
  ["time", "TRADE_TIME_MILLIS", 35],
  ["time", "QUOTE_TIME_MILLIS", 34],
] as const;

function numeric(record: Record<string, unknown>, name: string, id: number): number | null {
  const value = record[name] ?? record[String(id)];
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseLevelOne(content: Record<string, unknown>): Partial<LiveQuote> & { symbol: string } | null {
  const symbol = String(content.key ?? content["0"] ?? content.SYMBOL ?? "").trim().toUpperCase();
  if (!symbol) return null;

  const patch: Partial<LiveQuote> & { symbol: string } = { symbol };
  for (const [key, name, id] of FIELD_MAP) {
    const value = numeric(content, name, id);
    if (value !== null) patch[key] = value;
  }

  for (const [key, name, id] of TIME_FIELDS) {
    const value = numeric(content, name, id);
    if (value !== null) {
      patch[key] = Math.round(value / 1000);
      break;
    }
  }

  if (patch.price !== undefined && patch.price !== null) {
    const price = patch.price;
    const previousClose = patch.previousClose;
    if (patch.changePercent === undefined && previousClose) {
      patch.changePercent = ((price - previousClose) / previousClose) * 100;
    }
    if (patch.change === undefined && previousClose !== undefined && previousClose !== null) {
      patch.change = price - previousClose;
    }
  }
  return patch;
}

function emptyQuote(symbol: string): LiveQuote {
  return {
    symbol,
    price: null,
    change: null,
    changePercent: null,
    bid: null,
    ask: null,
    volume: null,
    open: null,
    high: null,
    low: null,
    previousClose: null,
    time: null,
    source: "schwab-stream",
  };
}

function webSocketCtor(): WebSocketCtor {
  const ctor = (globalThis as unknown as { WebSocket?: WebSocketCtor }).WebSocket;
  if (!ctor) throw new Error("Node.js 22+ is required for the built-in WebSocket client");
  return ctor;
}

class SchwabStreamer {
  private ws: WebSocketLike | null = null;
  private info: SchwabStreamerInfo | null = null;
  private state: StreamerStatus["state"] = "idle";
  private lastError: string | null = null;
  private authenticated = false;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private requestId = 0;
  private loginResolve: (() => void) | null = null;
  private loginReject: ((err: Error) => void) | null = null;

  private readonly listeners = new Map<Listener, Set<string>>();
  private readonly subscribed = new Set<string>();
  private readonly last = new Map<string, LiveQuote>();

  status(): StreamerStatus {
    return {
      configured: isSchwabConfigured(),
      state: this.state,
      connected: this.authenticated,
      subscribed: [...this.subscribed].sort(),
      error: this.lastError,
    };
  }

  subscribe(listener: Listener, symbols: string[]): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    const normalized = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 100);
    this.listeners.set(listener, new Set(normalized));

    for (const symbol of normalized) {
      const cached = this.last.get(symbol);
      if (cached) listener(cached);
    }

    if (!isSchwabConfigured()) {
      this.lastError = "Schwab streamer is not configured";
      return;
    }

    this.ensureConnected().catch((err: unknown) => {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.state = "error";
      this.scheduleReconnect();
    });

    if (this.authenticated) {
      const missing = normalized.filter((s) => !this.subscribed.has(s));
      if (missing.length > 0) this.sendSubscription(missing, "ADD");
    }
  }

  unsubscribe(listener: Listener): void {
    const previous = this.listeners.get(listener);
    this.listeners.delete(listener);
    if (!previous) return;

    const wanted = this.desiredSymbols();
    const removed = [...previous].filter((s) => !wanted.has(s) && this.subscribed.has(s));
    if (removed.length > 0 && this.authenticated) {
      this.sendSubscription(removed, "UNSUBS");
      for (const symbol of removed) this.subscribed.delete(symbol);
    }

    if (this.listeners.size === 0) {
      this.idleTimer = setTimeout(() => this.disconnect(), 60_000);
      this.idleTimer.unref();
    }
  }

  private desiredSymbols(): Set<string> {
    const out = new Set<string>();
    for (const symbols of this.listeners.values()) for (const symbol of symbols) out.add(symbol);
    return out;
  }

  private ensureConnected(): Promise<void> {
    if (this.authenticated && this.ws) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<void> {
    this.state = "connecting";
    this.lastError = null;

    const [token, info] = await Promise.all([getSchwabAccessToken(), getSchwabStreamerInfo()]);
    this.info = info;

    const ws = new (webSocketCtor())(info.streamerSocketUrl);
    this.ws = ws;

    const login = new Promise<void>((resolve, reject) => {
      this.loginResolve = resolve;
      this.loginReject = reject;
      const timer = setTimeout(() => reject(new Error("Schwab streamer login timed out")), 10_000);
      timer.unref();
      const clear = () => clearTimeout(timer);
      this.loginResolve = () => {
        clear();
        resolve();
      };
      this.loginReject = (err) => {
        clear();
        reject(err);
      };
    });

    ws.addEventListener("open", () => {
      this.sendRequest(
        "ADMIN",
        "LOGIN",
        {
          Authorization: token,
          SchwabClientChannel: info.schwabClientChannel,
          SchwabClientFunctionId: info.schwabClientFunctionId,
        },
        info
      );
    });

    ws.addEventListener("message", (event) => {
      const data = typeof event.data === "string" ? event.data : "";
      if (data) this.handleMessage(data);
    });

    ws.addEventListener("close", () => this.handleClose());
    ws.addEventListener("error", () => {
      this.lastError = "Schwab streamer socket error";
    });

    try {
      await login;
    } catch (err) {
      try {
        ws.close();
      } catch {
        // already closed
      }
      this.ws = null;
      throw err;
    }

    this.authenticated = true;
    this.subscribed.clear();
    this.state = "connected";
    this.lastError = null;

    const symbols = [...this.desiredSymbols()];
    if (symbols.length > 0) this.sendSubscription(symbols, "SUBS");
  }

  private sendRequest(
    service: string,
    command: string,
    parameters: Record<string, string>,
    info = this.info
  ): void {
    if (!this.ws || !info) return;
    const request = {
      service,
      command,
      requestid: String(++this.requestId),
      SchwabClientCustomerId: info.schwabClientCustomerId,
      SchwabClientCorrelId: info.schwabClientCorrelId,
      parameters,
    };
    this.ws.send(JSON.stringify({ requests: [request] }));
  }

  private sendSubscription(symbols: string[], command: "SUBS" | "ADD" | "UNSUBS"): void {
    if (symbols.length === 0) return;
    const parameters: Record<string, string> = { keys: symbols.join(",") };
    if (command !== "UNSUBS") parameters.fields = LEVEL_ONE_FIELDS;
    this.sendRequest("LEVELONE_EQUITIES", command, parameters);
    if (command !== "UNSUBS") for (const symbol of symbols) this.subscribed.add(symbol);
  }

  private handleMessage(raw: string): void {
    let message: {
      response?: Array<Record<string, any>>;
      data?: Array<Record<string, any>>;
    };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    for (const response of message.response ?? []) {
      if (response.service !== "ADMIN" || response.command !== "LOGIN") continue;
      const code = Number(response.content?.code ?? -1);
      if (code === 0) {
        this.loginResolve?.();
      } else {
        this.loginReject?.(
          new Error(`Schwab streamer login failed: ${response.content?.msg ?? `code ${code}`}`)
        );
      }
      this.loginResolve = null;
      this.loginReject = null;
    }

    for (const event of message.data ?? []) {
      if (event.service !== "LEVELONE_EQUITIES") continue;
      const content = Array.isArray(event.content) ? event.content : [event.content];
      for (const row of content) {
        if (!row || typeof row !== "object") continue;
        const patch = parseLevelOne(row as Record<string, unknown>);
        if (!patch || Object.keys(patch).length === 1) continue;

        const previous = this.last.get(patch.symbol) ?? emptyQuote(patch.symbol);
        const next: LiveQuote = {
          ...previous,
          ...patch,
          source: "schwab-stream",
        };
        this.last.set(next.symbol, next);

        for (const [listener, symbols] of this.listeners) {
          if (symbols.has(next.symbol)) listener(next);
        }
      }
    }
  }

  private handleClose(): void {
    this.authenticated = false;
    this.ws = null;
    this.subscribed.clear();
    this.loginReject?.(new Error("Schwab streamer socket closed"));
    this.loginResolve = null;
    this.loginReject = null;

    if (this.listeners.size === 0) {
      this.state = "idle";
      return;
    }

    this.state = "error";
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.listeners.size === 0) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected().catch((err: unknown) => {
        this.lastError = err instanceof Error ? err.message : String(err);
        this.state = "error";
        this.scheduleReconnect();
      });
    }, 5_000);
    this.reconnectTimer.unref();
  }

  private disconnect(): void {
    if (this.ws) {
      try {
        this.sendRequest("ADMIN", "LOGOUT", {});
      } catch {
        // Socket may already be closed.
      }
      this.ws.close();
    }
    this.ws = null;
    this.authenticated = false;
    this.subscribed.clear();
    this.state = "idle";
    this.lastError = null;
  }
}

export const schwabStreamer = new SchwabStreamer();
