/**
 * Flappy — a deterministic SteamBench arcade *timing/physics* env.
 *
 * TypeScript mirror of `harness/steambench_harness/envs/flappy.py`. Tap to flap
 * against gravity and thread the gaps between scrolling pipes.
 *
 * Determinism note: the physics uses only `+`/`-`/`*` and comparisons on
 * IEEE-754 doubles — never `Math.*`. To replay-verify against the Python env,
 * every arithmetic operation here is performed in the EXACT same order as
 * Python (e.g. `vy += GRAVITY` then `y += vy`, never folded into one
 * expression). Pipe gaps come from `this.rng.random()` (one draw per spawn, in
 * spawn order), which returns the same double as Python's `Mulberry32.random()`.
 */

import { ActionSpace, Env } from "./base";
import type { AchievementSpec, Action, Observation } from "./types";

const W = 120;
const H = 80;
const BIRD_X = 34;
const GRAVITY = 0.4;
const FLAP = -2.5;
const SPEED = 1.0;
const GAP_HALF = 12.0;
const PIPE_W = 8;
const PIPE_SPACING = 44;
// keep gap centers away from floor/ceiling (Python: GAP_HALF + 6 = 18.0)
const MARGIN = GAP_HALF + 6;
const ACTIONS = ["idle", "flap"] as const;

interface Pipe {
  x: number;
  gap: number;
  passed: boolean;
}

export class Flappy extends Env {
  static env_id = "arcade/flappy";
  static appid = 9000007;
  static displayName = "Flappy";
  static description =
    "Flap to stay airborne and thread the gaps between scrolling pipes. " +
    "Gravity never quits; one touch of a pipe or the ground ends the run.";
  static verify_mode = "replay" as const;
  static action_space = new ActionSpace([...ACTIONS]);
  static achievements: AchievementSpec[] = [
    { id: "pipe_1", name: "Liftoff", description: "Pass your first pipe.", rarity_hint: 0.8 },
    { id: "pipe_5", name: "Finding a Rhythm", description: "Pass 5 pipes.", rarity_hint: 0.5 },
    { id: "pipe_10", name: "In the Zone", description: "Pass 10 pipes.", rarity_hint: 0.28 },
    { id: "pipe_25", name: "Unflappable", description: "Pass 25 pipes.", rarity_hint: 0.1 },
    { id: "pipe_50", name: "Iron Wings", description: "Pass 50 pipes.", rarity_hint: 0.03 },
    { id: "pipe_100", name: "Legend of Flight", description: "Pass 100 pipes.", rarity_hint: 0.004 },
  ];

  y: number;
  vy: number;
  pipes: Pipe[];
  alive: boolean;

  constructor() {
    super();
    this.y = 0.0;
    this.vy = 0.0;
    this.pipes = [];
    this.alive = true;
  }

  reset(seed = 0): Observation {
    this.begin(seed);
    this.y = H / 2.0;
    this.vy = 0.0;
    this.alive = true;
    this.pipes = [];
    this.spawnPipe(W);
    return this.observe(0.0);
  }

  private spawnPipe(x: number): void {
    // ONE rng.random() draw per spawn; draw order matters for replay parity.
    const gap = MARGIN + this.rng.random() * (H - 2 * MARGIN);
    this.pipes.push({ x: x, gap: gap, passed: false });
  }

  step(action: Action): Observation {
    if (this.done) {
      return this.observe(0.0);
    }
    const name = this.actionSpace.name(action);
    this.steps += 1;
    if (name === "flap") {
      this.vy = FLAP;
    }
    this.vy += GRAVITY;
    this.y += this.vy;

    for (const p of this.pipes) {
      p.x -= SPEED;
    }
    // spawn a new pipe once the last one is far enough left
    if (this.pipes.length === 0 || this.pipes[this.pipes.length - 1].x <= W - PIPE_SPACING) {
      this.spawnPipe(W);
    }
    // drop pipes fully off-screen
    this.pipes = this.pipes.filter((p) => p.x > -PIPE_W);

    let reward = 0.0;
    for (const p of this.pipes) {
      if (!p.passed && p.x + PIPE_W < BIRD_X) {
        p.passed = true;
        this.score += 1;
        reward = 1.0;
      }
    }

    if (this.y < 0 || this.y > H) {
      this.alive = false;
    } else {
      for (const p of this.pipes) {
        if (p.x - PIPE_W <= BIRD_X && BIRD_X <= p.x + PIPE_W) {
          if (this.y < p.gap - GAP_HALF || this.y > p.gap + GAP_HALF) {
            this.alive = false;
            break;
          }
        }
      }
    }
    if (!this.alive) {
      this.done = true;
      reward = -1.0;
    }

    this.checkAchievements();
    return this.observe(reward);
  }

  private checkAchievements(): void {
    const ladder: [number, string][] = [
      [1, "pipe_1"],
      [5, "pipe_5"],
      [10, "pipe_10"],
      [25, "pipe_25"],
      [50, "pipe_50"],
      [100, "pipe_100"],
    ];
    for (const [n, aid] of ladder) {
      if (this.score >= n) {
        this.unlock(aid);
      }
    }
  }

  legalActions(): string[] {
    return [...ACTIONS];
  }

  private nextPipe(): Pipe | null {
    const ahead = this.pipes.filter((p) => p.x + PIPE_W >= BIRD_X);
    if (ahead.length === 0) {
      return null;
    }
    let best = ahead[0];
    for (const p of ahead) {
      if (p.x < best.x) {
        best = p;
      }
    }
    return best;
  }

  render(): string {
    const nxt = this.nextPipe();
    const gap = nxt ? roundTo(nxt.gap, 1) : null;
    const gapStr = gap === null ? "None" : formatNumber(gap);
    return (
      `score=${this.score} y=${this.y.toFixed(1)} vy=${this.vy.toFixed(1)} ` +
      `next_gap=${gapStr} ${this.alive ? "ALIVE" : "DEAD"}`
    );
  }

  private observe(reward: number): Observation {
    const nxt = this.nextPipe();
    return {
      step: this.steps,
      state: {
        bird_y: this.y,
        bird_vy: this.vy,
        width: W,
        height: H,
        bird_x: BIRD_X,
        gap_half: GAP_HALF,
        pipe_w: PIPE_W,
        pipes: this.pipes.map((p) => ({ x: p.x, gap: p.gap })),
        next_pipe: nxt ? { x: nxt.x, gap: nxt.gap } : null,
        score: this.score,
        alive: this.alive,
      },
      text: this.render(),
      frame: null,
      legal_actions: this.legalActions(),
      score: this.score,
      done: this.done,
      reward: reward,
      info: { score: this.score, alive: this.alive },
    };
  }
}

/** Round to a fixed number of decimal places (mirrors Python `round`). */
function roundTo(value: number, ndigits: number): number {
  const f = 10 ** ndigits;
  return Math.round(value * f) / f;
}

/** Mirror Python's `{:.1f}`-style trailing for a rounded float in render. */
function formatNumber(value: number): string {
  // Python prints round(x, 1) which yields e.g. "37.4" or "40.0".
  if (Number.isInteger(value)) {
    return value.toFixed(1);
  }
  return String(value);
}
