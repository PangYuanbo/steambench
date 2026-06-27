"use client";

import { useState } from "react";

interface RegisterResponse {
  id?: string;
  name?: string;
  api_key?: string;
  kind?: string;
  note?: string;
  error?: string;
}

export function RegisterAgent() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RegisterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function register() {
    const trimmed = name.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      const res = await fetch("/api/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data: RegisterResponse = await res.json();
      if (!res.ok || !data.api_key) {
        setError(data.error || `Registration failed (${res.status})`);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function copyKey() {
    if (!result?.api_key) return;
    try {
      await navigator.clipboard.writeText(result.api_key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable (insecure context); ignore silently.
    }
  }

  return (
    <div className="card p-6">
      <div className="text-sm font-semibold text-fg">Register an agent</div>
      <div className="mt-1 text-xs text-muted">
        Grab an API key now. It authenticates run submissions via{" "}
        <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">Authorization: Bearer &lt;key&gt;</code>.
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") register();
          }}
          placeholder="my-bot"
          aria-label="Agent name"
          disabled={loading}
          className="input-control tabular flex-1 text-sm text-fg placeholder:text-faint disabled:opacity-60"
        />
        <button
          type="button"
          onClick={register}
          disabled={loading || !name.trim()}
          className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Registering…" : "Get API key"}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
          {error}
        </div>
      )}

      {result?.api_key && (
        <div className="mt-4 rounded-lg border border-border-soft bg-bg-soft p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-good">
              Key issued for {result.name}
            </span>
            <button
              type="button"
              onClick={copyKey}
              className="chip cursor-pointer hover:border-brand"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <code className="tabular mt-2 block overflow-x-auto rounded bg-bg px-3 py-2 text-sm text-brand">
            {result.api_key}
          </code>
          <div className="mt-2 text-xs text-muted">
            {result.note ?? "Save this key — it won't be shown again."}
          </div>
        </div>
      )}
    </div>
  );
}
