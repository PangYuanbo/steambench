"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnyBoard } from "@/components/boards";

interface AchievementOut { id: string; name: string; description: string; percent_hint: number }
interface StepEvt {
  step: number; action: string | null; reasoning: string;
  state: Record<string, unknown>; score: number; unlocked: string[]; newly: string[];
}
interface RunRow {
  env_id: string; game: string; agent_id: string; agent_kind: string;
  score: number; steps: number; unlocked: string[]; earned_points: number; verified: boolean;
}

const ENVS = [
  { slug: "2048", env_id: "arcade/2048", label: "2048" },
  { slug: "snake", env_id: "arcade/snake", label: "Snake" },
  { slug: "sokoban", env_id: "arcade/sokoban", label: "Sokoban" },
  { slug: "tetris", env_id: "arcade/tetris", label: "Tetris" },
  { slug: "minesweeper", env_id: "arcade/minesweeper", label: "Minesweeper" },
  { slug: "flappy", env_id: "arcade/flappy", label: "Flappy" },
  { slug: "connect4", env_id: "arcade/connect4", label: "Connect 4" },
  { slug: "dodger", env_id: "arcade/dodger", label: "Dodger" },
  { slug: "catcher", env_id: "arcade/catcher", label: "Catcher" },
  { slug: "volley", env_id: "arcade/volley", label: "Volley" },
  { slug: "storm", env_id: "arcade/storm", label: "Storm" },
  { slug: "turret", env_id: "arcade/turret", label: "Turret" },
  { slug: "forager", env_id: "arcade/forager", label: "Forager" },
  { slug: "phantom", env_id: "arcade/phantom", label: "Phantom" },
  { slug: "rally", env_id: "arcade/rally", label: "Rally" },
];

export default function LivePage() {
  const [env, setEnv] = useState("2048");
  const [status, setStatus] = useState<"idle" | "playing" | "done" | "error">("idle");
  const [modelName, setModelName] = useState("");
  const [achievements, setAchievements] = useState<AchievementOut[]>([]);
  const [cur, setCur] = useState<StepEvt | null>(null);
  const [log, setLog] = useState<{ step: number; action: string | null; reasoning: string }[]>([]);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [finalMsg, setFinalMsg] = useState("");
  const [recent, setRecent] = useState<RunRow[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const envId = ENVS.find((e) => e.slug === env)!.env_id;

  async function loadRecent() {
    try {
      const r = await fetch("/api/runs?limit=40");
      const d = await r.json();
      setRecent((d.runs as RunRow[]).filter((x) => x.agent_kind === "agent").slice(0, 8));
    } catch { /* ignore */ }
  }
  useEffect(() => { loadRecent(); }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  function stop() {
    esRef.current?.close();
    esRef.current = null;
  }

  function start() {
    stop();
    setStatus("playing");
    setLog([]);
    setUnlocked([]);
    setCur(null);
    setFinalMsg("");
    const es = new EventSource(`/api/live/stream?env=${env}`);
    esRef.current = es;
    es.addEventListener("start", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setAchievements(d.achievements ?? []);
      setModelName(d.model ?? "");
    });
    es.addEventListener("step", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as StepEvt;
      setCur(d);
      setUnlocked(d.unlocked);
      if (d.action) setLog((l) => [...l.slice(-80), { step: d.step, action: d.action, reasoning: d.reasoning }]);
    });
    es.addEventListener("done", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setStatus("done");
      setFinalMsg(`Final score ${Math.round(d.final_score)} · ${d.unlocked.length} achievements · ${d.earned_points} pts`);
      stop();
      loadRecent();
    });
    es.addEventListener("error", () => {
      // EventSource fires error on close too; only flag if we weren't done.
      setStatus((s) => (s === "done" ? s : "error"));
      stop();
    });
  }

  useEffect(() => () => stop(), []);

  const score = cur?.score ?? 0;
  const unlockedSet = new Set(unlocked);

  return (
    <div className="section-wrap max-w-6xl pt-12">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ai">
          {status === "playing" ? (
            <>
              <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-bad text-bad" />
              Live · streaming
            </>
          ) : (
            "Live"
          )}
        </div>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Watch an AI play, move by move</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          An AI agent plays a SteamBench arcade game in real time — every move
          and its one-line reasoning streamed straight from the server (an LLM
          when an API key is configured, otherwise a strong search heuristic).
          The finished run is replay-verified and posted to the leaderboard.
        </p>
      </div>

      {/* controls: pick a game + go */}
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {ENVS.map((e) => {
            const active = env === e.slug;
            return (
              <button
                key={e.slug}
                onClick={() => setEnv(e.slug)}
                disabled={status === "playing"}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
                  active
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-border-soft text-muted hover:border-border hover:text-fg"
                }`}
              >
                {e.label}
              </button>
            );
          })}
        </div>
        <button className="btn btn-primary shrink-0" onClick={start} disabled={status === "playing"}>
          {status === "playing" ? "Playing…" : "▶ Start live game"}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* board + status */}
        <div className="card relative flex flex-col items-center justify-center p-6">
          {status === "idle" && (
            <div className="py-20 text-center text-muted">
              Press <span className="text-brand">Start live game</span> to watch the AI play {ENVS.find((e) => e.slug === env)!.label}.
            </div>
          )}
          {cur && <AnyBoard envId={envId} state={cur.state} />}
          {cur && (
            <div className="mt-4 w-full max-w-md rounded-xl border border-border-soft bg-bg-soft p-4">
              <div className="flex items-center justify-between text-xs text-faint">
                <span className="flex items-center gap-1.5">
                  <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-ai text-ai" />
                  step <span className="tabular">{cur.step}</span>
                  {modelName ? <> · {modelName}</> : null}
                </span>
                <span className="tabular font-bold text-brand">score {Math.round(score)}</span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="tabular shrink-0 rounded bg-ai/10 px-2 py-0.5 text-sm font-semibold text-ai">
                  {cur.action ?? "—"}
                </span>
                <span className="text-sm text-muted">{cur.reasoning}</span>
              </div>
            </div>
          )}
          {status === "done" && (
            <div className="mt-4 rounded-lg border border-good/40 bg-good/10 px-4 py-2 text-sm text-good">
              {finalMsg} — <Link href="/leaderboard" className="underline">see the board →</Link>
            </div>
          )}
          {status === "error" && (
            <div className="mt-4 text-sm text-bad">The live stream ended unexpectedly. Try again.</div>
          )}
        </div>

        {/* reasoning feed + achievements */}
        <div className="space-y-4">
          <div className="card p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-faint">Reasoning feed</div>
            <div ref={logRef} className="max-h-64 space-y-1.5 overflow-y-auto pr-1 text-sm">
              {log.length === 0 && <div className="text-faint">moves appear here…</div>}
              {log.map((l, i) => (
                <div key={i} className="animate-fade-in rounded border border-border-soft bg-bg-soft px-2 py-1">
                  <span className="tabular text-faint">#{l.step}</span>{" "}
                  <span className="text-ai">{l.action}</span>{" "}
                  <span className="text-muted">— {l.reasoning}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-faint">
              Achievements · {unlockedSet.size}/{achievements.length}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {achievements.map((a) => {
                const got = unlockedSet.has(a.id);
                return (
                  <span key={a.id} title={a.description}
                    className={`chip ${got ? "" : "opacity-50"}`}
                    style={got ? { color: "var(--color-good)", borderColor: "var(--color-good)55" } : undefined}>
                    {got ? "🏆" : "🔒"} {a.name}
                  </span>
                );
              })}
              {achievements.length === 0 && <span className="text-sm text-faint">start a game to see objectives</span>}
            </div>
          </div>
        </div>
      </div>

      {/* recent AI runs */}
      <div className="mt-12">
        <h2 className="mb-4 text-xl font-bold">Recent AI runs</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {recent.map((r, i) => (
            <div key={i} className="card p-4">
              <div className="flex items-center justify-between">
                <span className="truncate text-sm font-semibold">{r.game}</span>
                {r.verified && <span className="chip" style={{ color: "var(--color-good)" }}>✓</span>}
              </div>
              <div className="mt-1 truncate text-xs text-ai">{r.agent_id}</div>
              <div className="mt-3 flex items-end justify-between">
                <span className="tabular text-2xl font-semibold text-brand">{Math.round(r.score)}</span>
                <span className="text-xs text-faint">{r.unlocked.length} 🏆 · {r.earned_points} pts</span>
              </div>
            </div>
          ))}
          {recent.length === 0 && <div className="text-sm text-muted">No AI runs yet.</div>}
        </div>
      </div>
    </div>
  );
}
