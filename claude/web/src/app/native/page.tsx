"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// Modal-hosted pixel runtime (runtime/modal_pixel.py).
const PIXEL_URL = "https://ybpang-1--steambench-pixel-web.modal.run";

type GameId = "dodger" | "catcher" | "volley" | "storm" | "turret" | "forager" | "phantom" | "rally";
const GAMES: Record<GameId, { label: string; blurb: string; agent: string; envId: string }> = {
  dodger: {
    label: "Dodger",
    blurb: "dodge the falling blocks — one-class vision (avoid)",
    agent: "cv-vision (pixels)",
    envId: "arcade/dodger",
  },
  catcher: {
    label: "Catcher",
    blurb: "catch green, dodge red — two-class vision (tell good from bad)",
    agent: "cv-catcher (pixels)",
    envId: "arcade/catcher",
  },
  volley: {
    label: "Volley",
    blurb: "keep the ball up — temporal vision (infer motion across frames)",
    agent: "cv-volley (pixels)",
    envId: "arcade/volley",
  },
  storm: {
    label: "Storm",
    blurb: "dodge many blocks at varying speeds — multi-object temporal tracking",
    agent: "cv-storm (pixels)",
    envId: "arcade/storm",
  },
  turret: {
    label: "Turret",
    blurb: "aim and shoot descending targets — targeting (acts on the world)",
    agent: "cv-turret (pixels)",
    envId: "arcade/turret",
  },
  forager: {
    label: "Forager",
    blurb: "roam a 2D arena, collect + dodge — free 2D navigation",
    agent: "cv-forager (pixels)",
    envId: "arcade/forager",
  },
  phantom: {
    label: "Phantom",
    blurb: "blocks blink out but keep falling — memory under occlusion (watch its recalled blocks)",
    agent: "cv-phantom (pixels)",
    envId: "arcade/phantom",
  },
  rally: {
    label: "Rally",
    blurb: "Pong vs a built-in opponent — adversarial (read the ball, out-last the attacker)",
    agent: "cv-rally (pixels)",
    envId: "arcade/rally",
  },
};
const KIND_COLOR: Record<string, string> = { hazard: "#fbbf24", good: "#4ade80", bad: "#f87171", ball: "#eeeef0", player: "#38bdf8" };

interface Ach { id: string; name: string; goal: number }
interface PItem { box: [number, number, number, number]; kind: string }
interface Perception { player: [number, number] | null; target: number | null; pw: number; items: PItem[] }
interface Geom { w: number; h: number; playerY: number; playerH: number; playerW: number }

export default function NativePage() {
  const [game, setGame] = useState<GameId>("dodger");
  const [status, setStatus] = useState<"idle" | "playing" | "done" | "error">("idle");
  const [frame, setFrame] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [action, setAction] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState("");
  const [achievements, setAchievements] = useState<Ach[]>([]);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [finalMsg, setFinalMsg] = useState("");
  const [unit, setUnit] = useState("ticks");
  const [perception, setPerception] = useState<Perception | null>(null);
  const [geom, setGeom] = useState<Geom | null>(null);
  const [showVision, setShowVision] = useState(true);
  const [doneInfo, setDoneInfo] = useState<{ seed: number; actions: string[]; score: number; unlocked: string[] } | null>(null);
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [submitMsg, setSubmitMsg] = useState("");
  const esRef = useRef<EventSource | null>(null);
  const actionsRef = useRef<string[]>([]);
  const seedRef = useRef<number>(0);
  const gameRef = useRef<GameId>("dodger");

  function stop() {
    esRef.current?.close();
    esRef.current = null;
  }
  useEffect(() => () => stop(), []);

  function start(which: GameId) {
    stop();
    setGame(which);
    gameRef.current = which;
    setStatus("playing");
    setFinalMsg("");
    setUnlocked([]);
    setPerception(null);
    setFrame(null);
    setDoneInfo(null);
    setSubmitState("idle");
    setSubmitMsg("");
    actionsRef.current = [];
    const seed = Math.floor(Math.random() * 1_000_000);
    seedRef.current = seed;
    const es = new EventSource(`${PIXEL_URL}/stream?game=${which}&seed=${seed}`);
    esRef.current = es;
    es.addEventListener("start", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setAchievements(d.achievements ?? []);
      setUnit(d.unit ?? "ticks");
      setGeom({ w: d.w, h: d.h, playerY: d.player_y, playerH: d.player_h, playerW: d.player_w });
    });
    es.addEventListener("frame", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setFrame(d.frame);
      setTick(d.tick);
      setAction(d.action);
      setReasoning(d.reasoning);
      setUnlocked(d.unlocked ?? []);
      setPerception(d.perception ?? null);
      if (d.action) actionsRef.current.push(d.action as string);
    });
    es.addEventListener("done", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setStatus("done");
      setFinalMsg(`${d.score} ${unit} · ${d.unlocked.length}/${achievements.length || 5} achievements`);
      setDoneInfo({ seed: seedRef.current, actions: [...actionsRef.current], score: d.score, unlocked: d.unlocked ?? [] });
      stop();
    });
    es.addEventListener("error", () => {
      setStatus((s) => (s === "done" ? s : "error"));
      stop();
    });
  }

  async function submitRun() {
    if (!doneInfo) return;
    const g = GAMES[gameRef.current];
    setSubmitState("submitting");
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run: {
            env_id: g.envId, agent_id: g.agent, agent_kind: "agent",
            seed: doneInfo.seed, actions: doneInfo.actions, num_steps: doneInfo.actions.length,
            final_score: doneInfo.score, unlocked: doneInfo.unlocked, verify_mode: "replay",
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSubmitState("done");
        setSubmitMsg(`Verified ✓ — ${data.run.earned_points} pts on the ${g.label} board.`);
      } else {
        setSubmitState("error");
        setSubmitMsg(data.reason || data.error || "rejected");
      }
    } catch (err) {
      setSubmitState("error");
      setSubmitMsg(String(err));
    }
  }

  const unlockedSet = new Set(unlocked);
  const vb = geom ? `0 0 ${geom.w} ${geom.h}` : "0 0 168 120";
  const kindsPresent = Array.from(new Set((perception?.items ?? []).map((it) => it.kind)));

  return (
    <div className="section-wrap max-w-6xl pt-12">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          {status === "playing" ? (
            <>
              <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-bad text-bad" />
              Native runtime · streaming
            </>
          ) : (
            "Native runtime · pixels"
          )}
        </div>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">An AI playing from raw pixels</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          A real rendered game runs on a <span className="text-fg">Modal</span> runtime, and a vision
          agent reads each <span className="text-fg">rendered frame</span> — not structured state — then
          acts. Eight games span the capability spectrum: avoid, two-class, motion, multi-object,
          targeting, 2D navigation, memory under occlusion, and adversarial. Turn on{" "}
          <span className="text-fg">&ldquo;what the AI sees&rdquo;</span> to watch its perception, then
          submit its pixel run to the board — replay-verified like any human&apos;s.
        </p>
      </div>

      {/* pick a modality — clicking starts the run */}
      <div className="mb-6 flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(GAMES) as GameId[]).map((gid) => {
            const active = game === gid;
            return (
              <button
                key={gid}
                onClick={() => start(gid)}
                disabled={status === "playing"}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
                  active
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border-soft text-muted hover:border-border hover:text-fg"
                }`}
              >
                {GAMES[gid].label}
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-faint">{GAMES[game].blurb}</div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="card flex flex-col items-center justify-center p-6">
          {frame ? (
            <div className="relative w-full" style={{ maxWidth: 504, aspectRatio: "168 / 120" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/png;base64,${frame}`}
                alt="live game frame"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", imageRendering: "pixelated", borderRadius: 12, background: "#0b0e16" }}
              />
              {showVision && perception && geom && (
                <svg viewBox={vb} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
                  {perception.items?.map((it, i) => (
                    <rect
                      key={i}
                      x={it.box[0] - 0.5} y={it.box[1] - 0.5}
                      width={it.box[2] - it.box[0] + 2} height={it.box[3] - it.box[1] + 2}
                      fill="none" stroke={KIND_COLOR[it.kind] ?? "#fbbf24"} strokeWidth={0.9} opacity={0.95}
                    />
                  ))}
                  {perception.target != null && (
                    <rect
                      x={perception.target} y={geom.playerY}
                      width={perception.pw} height={geom.playerH}
                      fill="#34d399" opacity={0.2} stroke="#34d399" strokeWidth={0.8} strokeDasharray="2.5 1.5"
                    />
                  )}
                  {perception.player && (
                    <rect
                      x={perception.player[0] - 0.5} y={geom.playerY - 0.5}
                      width={perception.player[1] - perception.player[0] + 2} height={geom.playerH + 1}
                      fill="none" stroke="#22d3ee" strokeWidth={1}
                    />
                  )}
                </svg>
              )}
            </div>
          ) : (
            <div className="py-24 text-center text-muted">
              Pick <span className="text-brand">{GAMES[game].label}</span> above — frames render here as the agent reads them.
            </div>
          )}

          {frame && (
            <label className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={showVision} onChange={(e) => setShowVision(e.target.checked)} />
              Show what the AI sees
              {showVision && (
                <span className="ml-1 flex items-center gap-2 text-[11px]">
                  <span className="text-[#22d3ee]">▭ paddle</span>
                  {kindsPresent.includes("hazard") && <span className="text-[#fbbf24]">▭ hazards</span>}
                  {kindsPresent.includes("good") && <span className="text-[#4ade80]">▭ good</span>}
                  {kindsPresent.includes("bad") && <span className="text-[#f87171]">▭ bad</span>}
                  {kindsPresent.includes("ball") && <span className="text-[#eeeef0]">▭ ball</span>}
                  <span className="text-[#34d399]">▭ target</span>
                </span>
              )}
            </label>
          )}

          {action !== undefined && frame && (
            <div className="mt-3 w-full max-w-md rounded-xl border border-border-soft bg-bg-soft p-4">
              <div className="flex items-center gap-1.5 text-xs text-faint">
                <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-accent text-accent" />
                tick <span className="tabular">{tick}</span> · {GAMES[game].agent}
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="tabular shrink-0 rounded bg-accent/10 px-2 py-0.5 text-sm font-semibold text-accent">
                  {action ?? "—"}
                </span>
                <span className="text-sm text-muted">{reasoning}</span>
              </div>
            </div>
          )}
          {status === "done" && (
            <div className="mt-4 w-full max-w-md space-y-2">
              <div className="rounded-lg border border-good/40 bg-good/10 px-4 py-2 text-sm text-good">{finalMsg}</div>
              {submitState === "done" ? (
                <div className="flex items-center justify-between rounded-lg border border-good/40 bg-good/5 px-4 py-2 text-sm">
                  <span className="text-good">{submitMsg}</span>
                  <Link href="/leaderboard" className="text-brand hover:underline">Leaderboard →</Link>
                </div>
              ) : (
                <button
                  className="btn btn-primary w-full justify-center"
                  onClick={submitRun}
                  disabled={submitState === "submitting" || !doneInfo || (doneInfo?.actions.length ?? 0) === 0}
                >
                  {submitState === "submitting" ? "Verifying on the engine…" : `Submit this vision run to the ${GAMES[game].label} board →`}
                </button>
              )}
              {submitState === "error" && <div className="text-sm text-bad">{submitMsg}</div>}
              <p className="text-center text-[11px] text-faint">
                The pixel-derived moves are replay-verified on the same TS engine that checks human runs.
              </p>
            </div>
          )}
          {status === "error" && (
            <div className="mt-4 text-sm text-bad">Stream ended — try again (the Modal runtime may be cold-starting).</div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-faint">How it works</div>
            <ol className="space-y-2 text-sm text-muted">
              <li><span className="text-fg">1.</span> Game renders an RGB frame on Modal.</li>
              <li><span className="text-fg">2.</span> Agent gets the <span className="text-fg">pixels</span> (PNG) and finds the paddle + items by colour.</li>
              <li><span className="text-fg">3.</span> It plans a move (a short look-ahead) and acts.</li>
              <li><span className="text-fg">4.</span> The boxes it drew stream here — its <span className="text-fg">actual perception</span>.</li>
            </ol>
          </div>
          <div className="card p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-faint">
              Achievements · {unlockedSet.size}/{achievements.length || 5}
            </div>
            <div className="space-y-1.5">
              {achievements.map((a) => {
                const got = unlockedSet.has(a.id);
                return (
                  <div key={a.id} className={`flex items-center justify-between rounded-md border px-2 py-1.5 text-sm ${got ? "border-good/40 bg-good/5 text-fg" : "border-border-soft text-muted opacity-60"}`}>
                    <span>{got ? "🏆" : "🔒"} {a.name}</span>
                    <span className="tabular text-xs text-faint">{a.goal} {unit}</span>
                  </div>
                );
              })}
              {achievements.length === 0 && <div className="text-sm text-faint">start a run to see objectives</div>}
            </div>
          </div>
          <div className="card p-4 text-xs text-muted">
            The deterministic arcade games (<Link href="/play" className="text-brand">/play</Link>) prove
            cross-language replay-verification; this proves the <span className="text-fg">pixels-in / inputs-out</span> path
            a real Steam-game runtime needs — and that it generalizes across games.
          </div>
        </div>
      </div>
    </div>
  );
}
