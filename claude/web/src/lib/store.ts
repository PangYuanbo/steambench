// Run + agent store. In-memory by default (fine for the demo; resets on cold
// start). The async interface is intentional so a Postgres/Blob-backed impl can
// drop in later behind DATABASE_URL without touching callers.

import type { PlayerKind, RunRow } from "./types";

interface AgentRecord {
  id: string;
  name: string;
  key: string;
  kind: PlayerKind;
  created_at: number;
}

// Module-level singletons. On Vercel these live per warm instance.
const g = globalThis as unknown as {
  __sb_runs?: RunRow[];
  __sb_agents?: Map<string, AgentRecord>;
};

function runs(): RunRow[] {
  if (!g.__sb_runs) g.__sb_runs = [];
  return g.__sb_runs;
}
function agents(): Map<string, AgentRecord> {
  if (!g.__sb_agents) g.__sb_agents = new Map();
  return g.__sb_agents;
}

// Durable store on Modal (modal.Dict) when configured; in-memory fallback so a
// missing/failed store never breaks the app (worst case = per-instance memory).
const STORE_URL = process.env.MODAL_STORE_URL;
const STORE_SECRET = process.env.STORE_SECRET || "";

export async function addRun(run: RunRow): Promise<void> {
  if (STORE_URL) {
    try {
      const res = await fetch(`${STORE_URL}/runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${STORE_SECRET}`,
        },
        body: JSON.stringify({ run }),
      });
      if (res.ok) return;
    } catch {
      /* fall through to in-memory */
    }
  }
  runs().unshift(run); // newest first
  if (runs().length > 5000) runs().length = 5000;
}

export async function getSubmittedRuns(): Promise<RunRow[]> {
  if (STORE_URL) {
    try {
      // Cache the Modal store read for 30s so pages can ISR-cache instead of
      // re-fetching (and recomputing the leaderboard) on every request — this is
      // what kept TTFB at 1.6–3.5s. New runs still appear within ~30s.
      const res = await fetch(`${STORE_URL}/runs?limit=500`, { next: { revalidate: 30 } });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.runs)) return data.runs as RunRow[];
      }
    } catch {
      /* fall through to in-memory */
    }
  }
  return runs();
}

// --- agent API keys ------------------------------------------------------- //

function randomKey(): string {
  // sk_steambench_<24 hex> — not cryptographically critical for the demo.
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `sk_sb_${hex}`;
}

export async function registerAgent(
  name: string,
  kind: PlayerKind = "agent"
): Promise<AgentRecord> {
  const id = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 48) || "agent";
  const rec: AgentRecord = {
    id,
    name: name.trim().slice(0, 80) || id,
    key: randomKey(),
    kind,
    created_at: Date.now(),
  };
  agents().set(rec.key, rec);
  return rec;
}

export async function agentForKey(key: string | null): Promise<AgentRecord | null> {
  if (!key) return null;
  return agents().get(key) ?? null;
}
