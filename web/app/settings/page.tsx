"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiPut } from "../../lib/api";

type DataSource = "schwab" | "public";

type SettingsPayload = {
  dataSource: DataSource;
  ai: {
    configured: boolean;
    source: "settings" | "env" | "none";
    baseUrl: string;
    model: string;
  };
  schwab: {
    configured: boolean;
    hasAccessToken: boolean;
    hasRefreshToken: boolean;
    accessTokenExpiresAt: number | null;
    clientIdConfigured: boolean;
    clientSecretConfigured: boolean;
    redirectUri: string;
    tokenFile: string;
    streaming: {
      configured: boolean;
      state: string;
      connected: boolean;
      subscribed: string[];
      error: string | null;
    };
  };
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-[var(--border)] bg-[var(--panel)] mb-3">
      <div className="panel-title cursor-default">{title}</div>
      <div className="p-3 space-y-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3">
      <span className="dim w-40 shrink-0">{label}</span>
      <span className="flex-1 flex items-center gap-2">{children}</span>
    </label>
  );
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={ok ? "up" : "down"}>● {children}</span>;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<SettingsPayload>("/api/settings"),
  });

  const [dataSource, setDataSource] = useState<DataSource>("schwab");
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!data || hydrated) return;
    setDataSource(data.dataSource);
    setBaseUrl(data.ai.baseUrl);
    setModel(data.ai.model);
    setHydrated(true);
  }, [data, hydrated]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["settings"] });
    await queryClient.invalidateQueries({ queryKey: ["status"] });
  };

  const save = useMutation({
    mutationFn: () => {
      const ai: Record<string, string | null> = {};
      if (apiKey.trim()) ai.apiKey = apiKey.trim();
      if (clearKey) ai.apiKey = null;
      if (baseUrl !== (data?.ai.baseUrl ?? "")) ai.baseUrl = baseUrl.trim() || null;
      if (model !== (data?.ai.model ?? "")) ai.model = model.trim() || null;
      return apiPut<SettingsPayload>("/api/settings", { dataSource, ai });
    },
    onSuccess: async () => {
      setApiKey("");
      setClearKey(false);
      setNotice("Settings saved.");
      await refresh();
    },
    onError: (err: Error) => setNotice(err.message),
  });

  const getAuthUrl = useMutation({
    mutationFn: () => apiGet<{ url: string }>("/api/schwab/auth-url"),
    onSuccess: ({ url }) => {
      setAuthUrl(url);
      setNotice("Authorization URL ready — open it, approve access, then paste the redirected URL below.");
    },
    onError: (err: Error) => setNotice(err.message),
  });

  const authenticate = useMutation({
    mutationFn: () => apiPost<{ ok: boolean }>("/api/schwab/auth", { url: callbackUrl }),
    onSuccess: async () => {
      setCallbackUrl("");
      setNotice("Schwab authenticated. The refresh token was saved.");
      await refresh();
    },
    onError: (err: Error) => setNotice(err.message),
  });

  const disconnect = useMutation({
    mutationFn: () => apiDelete("/api/schwab/auth"),
    onSuccess: async () => {
      setNotice("Schwab token removed.");
      await refresh();
    },
    onError: (err: Error) => setNotice(err.message),
  });

  const aiStatus = data?.ai;
  const schwab = data?.schwab;

  return (
    <div className="h-screen overflow-auto">
      <header className="sticky top-0 z-10 flex items-center gap-4 px-4 h-9 bg-[var(--panel-2)] border-b border-[var(--border)]">
        <Link href="/" className="amber font-bold tracking-widest">OPENTERMINAL</Link>
        <span className="dim">/ SETTINGS</span>
        <Link href="/" className="ml-auto dim hover:text-[var(--amber)]">← BACK TO TERMINAL</Link>
      </header>

      <main className="max-w-3xl mx-auto p-4">
        {error && <div className="down mb-3">Could not load settings: {(error as Error).message}</div>}
        {notice && <div className="border border-[var(--amber-dim)] px-3 py-2 mb-3 amber">{notice}</div>}

        <Panel title="Data source">
          <Row label="Market data">
            <select value={dataSource} onChange={(e) => setDataSource(e.target.value as DataSource)}>
              <option value="schwab">Schwab first (public fallback)</option>
              <option value="public">Public sources only</option>
            </select>
          </Row>
          <div className="dim text-[11px]">
            Schwab mode uses your brokerage feed for quotes, history, options, search and streaming.
            Symbols Schwab cannot serve (crypto, VIX, non-US) still fall back to the public providers.
            Public mode skips Schwab entirely.
          </div>
        </Panel>

        <Panel title="Schwab OAuth">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px]">
            <span>Client ID: <Badge ok={Boolean(schwab?.clientIdConfigured)}>{schwab?.clientIdConfigured ? "set" : "missing"}</Badge></span>
            <span>Client secret: <Badge ok={Boolean(schwab?.clientSecretConfigured)}>{schwab?.clientSecretConfigured ? "set" : "missing"}</Badge></span>
            <span>Token: <Badge ok={Boolean(schwab?.hasAccessToken || schwab?.hasRefreshToken)}>{schwab?.hasAccessToken ? "present" : "missing"}</Badge></span>
            <span>Streaming: <Badge ok={Boolean(schwab?.streaming.connected)}>{schwab?.streaming.state ?? "idle"}</Badge></span>
          </div>
          {(!schwab?.clientIdConfigured || !schwab?.clientSecretConfigured) && (
            <div className="down text-[11px]">
              Add SCHWAB_CLIENT_ID and SCHWAB_CLIENT_SECRET to <span className="amber">.env</span>, then restart the API.
            </div>
          )}
          <div className="dim text-[11px]">
            Callback URL: <span className="text-[var(--text)]">{schwab?.redirectUri ?? "https://127.0.0.1"}</span>
            {schwab?.accessTokenExpiresAt && (
              <> · access token expires {new Date(schwab.accessTokenExpiresAt).toLocaleString()}</>
            )}
          </div>
          <div className="text-[11px] dim">
            Generate the authorization URL here (or with <span className="amber">npm run schwab:auth -w server</span>),
            approve access, then paste the <span className="text-[var(--text)]">full URL you were redirected to</span> below.
          </div>
          <div className="flex gap-2 items-center">
            <button
              className="term-btn"
              disabled={!schwab?.clientIdConfigured || getAuthUrl.isPending}
              onClick={() => getAuthUrl.mutate()}
            >
              {getAuthUrl.isPending ? "BUILDING…" : "GET AUTHORIZATION URL"}
            </button>
            {authUrl && (
              <a href={authUrl} target="_blank" rel="noreferrer" className="amber text-[11px] underline">
                OPEN AUTHORIZATION URL ↗
              </a>
            )}
          </div>
          <input
            value={callbackUrl}
            onChange={(e) => setCallbackUrl(e.target.value)}
            placeholder="https://127.0.0.1/?code=..."
            className="w-full"
          />
          <div className="flex gap-2">
            <button
              className="term-btn"
              disabled={!callbackUrl.trim() || authenticate.isPending}
              onClick={() => authenticate.mutate()}
            >
              {authenticate.isPending ? "AUTHENTICATING…" : "AUTHENTICATE SCHWAB"}
            </button>
            <button
              className="term-btn"
              disabled={disconnect.isPending || !schwab?.configured}
              onClick={() => disconnect.mutate()}
            >
              DISCONNECT
            </button>
          </div>
          {schwab?.streaming.error && <div className="down text-[11px]">{schwab.streaming.error}</div>}
        </Panel>

        <Panel title="AI assistant">
          <div className="flex gap-3 items-center text-[11px]">
            <span>Credentials:</span>
            <Badge ok={Boolean(aiStatus?.configured)}>{aiStatus?.source === "settings" ? "saved in settings" : aiStatus?.source === "env" ? "from .env" : "not configured"}</Badge>
          </div>
          <Row label="Anthropic API key">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setClearKey(false); }}
              placeholder={aiStatus?.configured ? "configured — leave blank to keep" : "sk-ant-..."}
              className="flex-1"
              autoComplete="off"
            />
          </Row>
          <Row label="Base URL">
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.anthropic.com (optional)"
              className="flex-1"
            />
          </Row>
          <Row label="Model">
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="claude-opus-4-8"
              className="flex-1"
            />
          </Row>
          <label className="flex items-center gap-2 text-[11px] dim">
            <input type="checkbox" checked={clearKey} onChange={(e) => { setClearKey(e.target.checked); if (e.target.checked) setApiKey(""); }} />
            Clear the saved API key
          </label>
          <div className="dim text-[11px]">
            The key is stored only in <span className="amber">data/settings.json</span> (mode 0600, gitignored) and is never returned to the browser.
            Empty fields fall back to ANTHROPIC_* values from .env.
          </div>
        </Panel>

        <button className="term-btn" disabled={save.isPending || !data} onClick={() => save.mutate()}>
          {save.isPending ? "SAVING…" : "SAVE SETTINGS"}
        </button>
      </main>
    </div>
  );
}
