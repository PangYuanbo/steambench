"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { make } from "@/lib/arcade/registry";
import type { Env } from "@/lib/arcade/base";
import type { EnvSpec, Observation } from "@/lib/arcade/types";
import { AnyBoard } from "@/components/boards";

const KEY_TO_DIR: Record<string, string> = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  w: "up", s: "down", a: "left", d: "right",
  W: "up", S: "down", A: "left", D: "right",
};

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function snapshot(o: Observation): Observation {
  return { ...o, state: { ...o.state } };
}

export function PlayClient({ envId, spec }: { envId: string; spec: EnvSpec }) {
  const isSnake = envId === "arcade/snake";
  const isSokoban = envId === "arcade/sokoban";
  const isTetris = envId === "arcade/tetris";
  const isMinesweeper = envId === "arcade/minesweeper";
  const isFlappy = envId === "arcade/flappy";
  const isConnect4 = envId === "arcade/connect4";
  const isDodger = envId === "arcade/dodger";
  const isCatcher = envId === "arcade/catcher";
  const isVolley = envId === "arcade/volley";
  const isStorm = envId === "arcade/storm";
  const isTurret = envId === "arcade/turret";
  const isForager = envId === "arcade/forager"; // free 2D movement (hold a direction)
  const isPhantom = envId === "arcade/phantom"; // bottom-paddle dodge with blackouts
  const isRally = envId === "arcade/rally"; // left paddle, hold ↑↓
  const isSlider = isDodger || isCatcher || isVolley || isStorm || isTurret || isPhantom; // paddle games: tick + hold ←→
  const fireQueuedRef = useRef(false);
  const envRef = useRef<Env | null>(null);
  const actionsRef = useRef<string[]>([]);
  const dirRef = useRef<string>("right");
  const seedRef = useRef<number>(0);

  const [obs, setObs] = useState<Observation | null>(null);
  const [seed, setSeed] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [forceDone, setForceDone] = useState(false);
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [submitMsg, setSubmitMsg] = useState<string>("");
  const [name, setName] = useState("");

  const startGame = useCallback(() => {
    const env = make(envId);
    const s = randomSeed();
    seedRef.current = s;
    setSeed(s);
    const o = env.reset(s);
    envRef.current = env;
    actionsRef.current = [];
    dirRef.current = isSnake
      ? String((o.state as { direction?: string }).direction ?? "right")
      : isSlider || isForager || isRally
        ? "stay"
        : "right";
    setObs(snapshot(o));
    setForceDone(false);
    setSubmitState("idle");
    setSubmitMsg("");
  }, [envId, isSnake, isSlider, isForager, isRally]);

  useEffect(() => {
    startGame();
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem("sb_name");
      if (saved) setName(saved);
    }
  }, [startGame]);

  const applyAction = useCallback((action: string) => {
    const env = envRef.current;
    if (!env || env.done) return;
    const before = new Set(env.unlocked);
    const o = env.step(action);
    actionsRef.current.push(action);
    const newly = [...env.unlocked].filter((a) => !before.has(a));
    if (newly.length) {
      const ach = spec.achievements.find((x) => x.id === newly[newly.length - 1]);
      setToast(`🏆 ${ach?.name ?? newly[newly.length - 1]}`);
      window.setTimeout(() => setToast(null), 2200);
    }
    setObs(snapshot(o));
  }, [spec]);

  // 2048 + Sokoban: event-driven on keypress. Snake: timer tick on heading.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (forceDone || envRef.current?.done) return; // submit overlay open
      if (isMinesweeper || isConnect4) return; // click-only games
      if (isFlappy) {
        if (e.key === " " || e.key === "ArrowUp" || e.key === "w") {
          e.preventDefault();
          applyAction("flap");
        }
        return;
      }
      if (isSlider) {
        if (isTurret && (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "W")) {
          e.preventDefault();
          fireQueuedRef.current = true;
        } else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
          e.preventDefault();
          dirRef.current = "left";
        } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
          e.preventDefault();
          dirRef.current = "right";
        }
        return;
      }
      if (isRally) {
        if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
          e.preventDefault();
          dirRef.current = "up";
        } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
          e.preventDefault();
          dirRef.current = "down";
        }
        return;
      }
      if (isTetris) {
        const map: Record<string, string> = {
          ArrowLeft: "left", ArrowRight: "right", ArrowUp: "rotate", ArrowDown: "down", " ": "drop",
          a: "left", d: "right", w: "rotate", s: "down",
        };
        const act = map[e.key];
        if (act) { e.preventDefault(); applyAction(act); }
        return;
      }
      if ((e.key === "r" || e.key === "R") && isSokoban) {
        e.preventDefault();
        applyAction("restart");
        return;
      }
      const dir = KEY_TO_DIR[e.key];
      if (!dir) return;
      e.preventDefault();
      if (isSnake || isForager) dirRef.current = dir;
      else applyAction(dir);
    }
    function onKeyUp(e: KeyboardEvent) {
      // Slider/Forager/Rally: releasing the movement key lets the player coast (stay).
      if (!isSlider && !isForager && !isRally) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "a", "A", "d", "D", "w", "W", "s", "S"].includes(e.key)) {
        dirRef.current = "stay";
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [isSnake, isSokoban, isTetris, isMinesweeper, isFlappy, isConnect4, isSlider, isForager, isRally, applyAction, forceDone]);

  // Tetris: a deterministic gravity tick injects "down" (recorded, so it
  // replay-verifies); key presses move/rotate/drop in between.
  useEffect(() => {
    if (!isTetris) return;
    const id = window.setInterval(() => {
      const env = envRef.current;
      if (!env || env.done) return;
      applyAction("down");
    }, 650);
    return () => window.clearInterval(id);
  }, [isTetris, applyAction]);

  // Flappy: a steady gravity tick; flapping is the player's input between ticks.
  useEffect(() => {
    if (!isFlappy) return;
    const id = window.setInterval(() => {
      const env = envRef.current;
      if (!env || env.done) return;
      applyAction("idle");
    }, 110);
    return () => window.clearInterval(id);
  }, [isFlappy, applyAction]);

  useEffect(() => {
    if (!isSnake) return;
    const id = window.setInterval(() => {
      const env = envRef.current;
      if (!env || env.done) return;
      applyAction(dirRef.current);
    }, 130);
    return () => window.clearInterval(id);
  }, [isSnake, applyAction]);

  // Slider games (Dodger/Catcher/Volley/Storm/Turret): world advances on a steady
  // tick; the held dir is the input. Turret also fires when a shot is queued.
  useEffect(() => {
    if (!isSlider) return;
    const id = window.setInterval(() => {
      const env = envRef.current;
      if (!env || env.done) return;
      let act = dirRef.current;
      if (isTurret && fireQueuedRef.current) {
        act = "fire";
        fireQueuedRef.current = false;
      }
      applyAction(act);
    }, 75);
    return () => window.clearInterval(id);
  }, [isSlider, isTurret, applyAction]);

  // Forager: the world advances on a steady tick; the held direction moves the
  // player in 2D (up/down/left/right), "stay" when nothing is held.
  useEffect(() => {
    if (!isForager) return;
    const id = window.setInterval(() => {
      const env = envRef.current;
      if (!env || env.done) return;
      applyAction(dirRef.current);
    }, 80);
    return () => window.clearInterval(id);
  }, [isForager, applyAction]);

  // Rally: the ball volleys on a steady tick; the held ↑/↓ moves the paddle.
  useEffect(() => {
    if (!isRally) return;
    const id = window.setInterval(() => {
      const env = envRef.current;
      if (!env || env.done) return;
      applyAction(dirRef.current);
    }, 70);
    return () => window.clearInterval(id);
  }, [isRally, applyAction]);

  const submit = useCallback(async () => {
    const env = envRef.current;
    if (!env) return;
    setSubmitState("submitting");
    if (name) window.localStorage.setItem("sb_name", name);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run: {
            env_id: envId,
            appid: spec.appid,
            agent_id: name.trim() || "anonymous-human",
            agent_kind: "human",
            seed: seedRef.current,
            actions: actionsRef.current,
            num_steps: env.steps,
            final_score: env.score,
            unlocked: [...env.unlocked].sort(),
            verify_mode: "replay",
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSubmitState("done");
        setSubmitMsg(`Verified ✓ — ${data.run.earned_points} pts, mastery ${(data.run.mastery * 100).toFixed(0)}%. You're on the board.`);
      } else {
        setSubmitState("error");
        setSubmitMsg(data.reason || data.error || "submission rejected");
      }
    } catch (err) {
      setSubmitState("error");
      setSubmitMsg(String(err));
    }
  }, [envId, name, spec.appid]);

  const done = (obs?.done ?? false) || forceDone;
  const score = obs?.score ?? 0;
  const unlocked = new Set(envRef.current?.unlocked ?? []);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* board */}
      <div className="card relative flex flex-col items-center justify-center p-6">
        {toast && (
          <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-lg border bg-bg-soft px-4 py-2 text-sm font-semibold shadow-lg" style={{ color: "var(--color-medium)", borderColor: "var(--color-medium)55" }}>
            {toast}
          </div>
        )}
        {obs && (
          <AnyBoard
            envId={envId}
            state={obs.state}
            onCell={isMinesweeper ? (r, c) => applyAction(`${r},${c}`) : undefined}
            onCol={isConnect4 ? (c) => applyAction(`${c}`) : undefined}
          />
        )}

        {/* controls */}
        {isMinesweeper || isConnect4 ? null : isFlappy ? (
          <button className="btn btn-primary mt-6 !px-10 !py-3 text-base" onClick={() => applyAction("flap")}>
            ↑ Flap (Space)
          </button>
        ) : isTetris ? (
          <div className="mt-6 flex gap-1.5">
            <DPad label="⟲" onClick={() => applyAction("rotate")} />
            <DPad label="←" onClick={() => applyAction("left")} />
            <DPad label="↓" onClick={() => applyAction("down")} />
            <DPad label="→" onClick={() => applyAction("right")} />
            <DPad label="⤓" onClick={() => applyAction("drop")} />
          </div>
        ) : isSlider ? (
          <div className="mt-6 flex gap-2">
            <DPad label="←" onClick={() => applyAction("left")} />
            {isTurret && <DPad label="🎯 Fire" onClick={() => applyAction("fire")} />}
            <DPad label="→" onClick={() => applyAction("right")} />
          </div>
        ) : isRally ? (
          <div className="mt-6 flex flex-col gap-1.5">
            <DPad label="↑" onClick={() => applyAction("up")} />
            <DPad label="↓" onClick={() => applyAction("down")} />
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-3 gap-1.5" style={{ width: 168 }}>
            <span />
            <DPad label="↑" onClick={() => (isSnake ? (dirRef.current = "up") : applyAction("up"))} />
            <span />
            <DPad label="←" onClick={() => (isSnake ? (dirRef.current = "left") : applyAction("left"))} />
            <DPad label="↓" onClick={() => (isSnake ? (dirRef.current = "down") : applyAction("down"))} />
            <DPad label="→" onClick={() => (isSnake ? (dirRef.current = "right") : applyAction("right"))} />
          </div>
        )}

        {isSokoban && (
          <div className="mt-3 flex gap-2">
            <button className="btn !py-1.5 text-sm" onClick={() => applyAction("restart")}>↺ Restart level (R)</button>
            <button className="btn !py-1.5 text-sm" onClick={() => setForceDone(true)}>Finish &amp; submit</button>
          </div>
        )}
        <div className="mt-3 text-center text-xs text-faint">
          {isSnake
            ? "Arrow keys / WASD steer · snake moves on its own"
            : isSokoban
              ? "Arrow keys / WASD push · R restarts the level if you jam a box"
              : isTetris
                ? "← → move · ↑ rotate · ↓ soft-drop · Space hard-drop · gravity ticks on its own"
                : isMinesweeper
                  ? "Click a cell to reveal it · the first click is always safe · deduce the mines"
                  : isFlappy
                    ? "Space / Flap to rise · gravity pulls you down · thread the gaps"
                    : isConnect4
                      ? "Click a column to drop your disc · beat the bot to four-in-a-row · best of 6"
                      : isDodger
                        ? "Hold ← → (or A/D) to slide · blocks fall on their own · survive as long as you can"
                        : isCatcher
                          ? "Hold ← → (or A/D) to slide · catch the green drops, dodge the red ones · one red ends it"
                          : isVolley
                            ? "Hold ← → (or A/D) to slide · keep the bouncing ball up · it speeds up — read its motion"
                            : isStorm
                              ? "Hold ← → (or A/D) to slide · blocks fall at different speeds · track them all and dodge"
                              : isTurret
                                ? "Hold ← → to aim · Space (or ↑) to fire · shoot every target before it reaches the floor · 3 leaks and you're out"
                                : isForager
                                  ? "Hold arrow keys / WASD to roam in 2D · grab the green drops, avoid the red hazards · one touch ends it"
                                  : isPhantom
                                    ? "Hold ← → to slide · the blocks BLINK OUT but keep falling — remember where they were and dodge"
                                    : isRally
                                      ? "Hold ↑ ↓ to move your paddle · return the opponent's shots · the rally speeds up — one miss ends it"
                                      : "Arrow keys / WASD to slide tiles"}
        </div>
      </div>

      {/* HUD */}
      <div className="space-y-4">
        <div className="card p-4">
          <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--color-human)" }}>
            <span aria-hidden>🧑</span> Your run
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-faint">Score</div>
              <div className="tabular text-3xl font-black" style={{ color: "var(--color-human)" }}>{Math.round(score)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-faint">Steps</div>
              <div className="tabular text-xl font-bold">{obs?.step ?? 0}</div>
            </div>
          </div>
          <div className="mt-2 text-xs text-faint">
            seed <span className="tabular text-muted">{seed}</span> · replay-verified
          </div>
          <button className="btn mt-3 w-full justify-center" onClick={startGame}>↻ New game</button>
        </div>

        <div className="card p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">
            Achievements · {unlocked.size}/{spec.achievements.length}
          </div>
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {spec.achievements.map((a) => {
              const got = unlocked.has(a.id);
              return (
                <div key={a.id} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${got ? "border-good/40 bg-good/5" : "border-border-soft opacity-60"}`}>
                  <span>{got ? "🏆" : "🔒"}</span>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate font-medium ${got ? "text-fg" : "text-muted"}`}>{a.name}</div>
                    <div className="truncate text-xs text-faint">{a.description}</div>
                  </div>
                  <span className="tabular text-xs text-faint">{a.percent_hint}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* game over / submit */}
      {done && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md p-6">
            <div className="text-center">
              <div className="text-sm uppercase tracking-wider text-faint">{obs?.done ? "Game over" : "Submit run"}</div>
              <div className="tabular mt-1 text-5xl font-black" style={{ color: "var(--color-human)" }}>{Math.round(score)}</div>
              <div className="mt-1 text-sm text-muted">
                {unlocked.size}/{spec.achievements.length} achievements · {obs?.step} steps
              </div>
            </div>

            {submitState !== "done" ? (
              <div className="mt-5 space-y-3">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="your display name"
                  maxLength={32}
                  className="w-full rounded-lg border border-border bg-bg-soft px-3 py-2 text-sm outline-none focus:border-brand"
                />
                <button className="btn btn-primary w-full justify-center" onClick={submit} disabled={submitState === "submitting"}>
                  {submitState === "submitting" ? "Verifying…" : "Submit to leaderboard"}
                </button>
                {submitState === "error" && <div className="text-sm text-bad">{submitMsg}</div>}
                <div className="flex gap-2">
                  {!obs?.done && (
                    <button className="btn flex-1 justify-center" onClick={() => setForceDone(false)}>Keep playing</button>
                  )}
                  <button className="btn flex-1 justify-center" onClick={startGame}>Play again</button>
                </div>
                <p className="text-center text-xs text-faint">
                  Your moves are replay-verified server-side — the score can&apos;t be faked.
                </p>
              </div>
            ) : (
              <div className="mt-5 space-y-3 text-center">
                <div className="rounded-lg border border-good/40 bg-good/10 p-3 text-sm text-good">{submitMsg}</div>
                <Link href="/leaderboard" className="btn btn-primary w-full justify-center">See the leaderboard →</Link>
                <button className="btn w-full justify-center" onClick={startGame}>Play again</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DPad({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-12 min-w-12 items-center justify-center rounded-xl border border-border-soft bg-surface-2 px-4 text-lg font-bold text-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:border-brand hover:bg-surface hover:text-brand active:scale-95"
    >
      {label}
    </button>
  );
}
