/**
 * Dodger — a deterministic SteamBench arcade *vision/reflex* env.
 *
 * TypeScript mirror of `harness/steambench_harness/envs/dodger.py` (and the
 * headless twin of `runtime/pixel_game.py`). Slide a paddle along the floor to
 * dodge blocks falling from above; the longer you last, the rarer the badge.
 *
 * Determinism note: block spawn columns are the only randomness — one
 * `this.rng.randrange(W - HW + 1)` draw per spawn, in spawn order, identical to
 * Python's `Mulberry32`. Everything else is integer arithmetic in the exact same
 * order as Python, so a recorded `(seed, actions)` trace — whether produced by a
 * human here, a Python agent, or the vision agent reading pixels on Modal —
 * replays to the same score in either language.
 */

import { ActionSpace, Env } from "./base";
import type { AchievementSpec, Action, Observation } from "./types";

// Shared with the Python env + pixel runtime; keep in lock-step.
const W = 168;
const H = 120;
const PW = 20;
const PH = 8;
const HW = 14;
const HH = 14;
const PLAYER_Y = H - PH - 3; // 109
const PSPEED = 7;
const FALL = 4;
const SPAWN_GAP = 26;
const ACTIONS = ["left", "stay", "right"] as const;

export class Dodger extends Env {
  static env_id = "arcade/dodger";
  static appid = 9000009;
  static displayName = "Dodger";
  static description =
    "Slide a paddle along the floor to dodge blocks falling from above. " +
    "The longer you last, the rarer the achievement — pure reflex and spatial " +
    "reading. This is the headless twin of the pixel runtime a vision agent " +
    "plays from raw frames.";
  static verify_mode = "replay" as const;
  static action_space = new ActionSpace([...ACTIONS]);
  static achievements: AchievementSpec[] = [
    { id: "survive_50", name: "Reflexes", description: "Survive 50 ticks.", rarity_hint: 0.6 },
    { id: "survive_150", name: "In the Groove", description: "Survive 150 ticks.", rarity_hint: 0.3 },
    { id: "survive_300", name: "Untouchable", description: "Survive 300 ticks.", rarity_hint: 0.12 },
    { id: "survive_600", name: "Bullet Time", description: "Survive 600 ticks.", rarity_hint: 0.035 },
    { id: "survive_1200", name: "Matrix", description: "Survive 1200 ticks.", rarity_hint: 0.006 },
  ];
  private static LADDER: [number, string][] = [
    [50, "survive_50"], [150, "survive_150"], [300, "survive_300"],
    [600, "survive_600"], [1200, "survive_1200"],
  ];

  px: number;
  hazards: [number, number][]; // [x, y]
  alive: boolean;
  private sinceSpawn: number;

  constructor() {
    super();
    this.px = Math.trunc((W - PW) / 2);
    this.hazards = [];
    this.alive = true;
    this.sinceSpawn = SPAWN_GAP;
  }

  reset(seed = 0): Observation {
    this.begin(seed);
    this.px = Math.trunc((W - PW) / 2);
    this.hazards = [];
    this.alive = true;
    this.sinceSpawn = SPAWN_GAP;
    return this.observe(0.0);
  }

  step(action: Action): Observation {
    if (this.done) {
      return this.observe(0.0);
    }
    const name = this.actionSpace.name(action);
    this.steps += 1;

    if (name === "left") {
      this.px = Math.max(0, this.px - PSPEED);
    } else if (name === "right") {
      this.px = Math.min(W - PW, this.px + PSPEED);
    }

    // Spawn a new wave on schedule (one rng draw per spawn), then fall.
    this.sinceSpawn += FALL;
    if (this.sinceSpawn >= SPAWN_GAP) {
      this.sinceSpawn = 0;
      const x = this.rng.randrange(W - HW + 1); // inclusive [0, W-HW]
      this.hazards.push([x, -HH]);
    }
    for (const hz of this.hazards) {
      hz[1] += FALL;
    }
    this.hazards = this.hazards.filter((h) => h[1] < H);

    // collision: paddle rect vs any hazard rect
    let hit = false;
    for (const [hx, hy] of this.hazards) {
      if (hx < this.px + PW && hx + HW > this.px && hy < PLAYER_Y + PH && hy + HH > PLAYER_Y) {
        hit = true;
        break;
      }
    }

    let reward: number;
    if (hit) {
      this.alive = false;
      this.done = true;
      reward = -1.0;
    } else {
      this.score += 1;
      reward = 1.0;
      for (const [thresh, aid] of Dodger.LADDER) {
        if (this.score >= thresh) {
          this.unlock(aid);
        }
      }
    }
    return this.observe(reward);
  }

  legalActions(): string[] {
    return [...ACTIONS];
  }

  render(): string {
    return (
      `score=${Math.trunc(this.score)} px=${this.px} hazards=${this.hazards.length} ` +
      `${this.alive ? "ALIVE" : "DEAD"}`
    );
  }

  private observe(reward: number): Observation {
    return {
      step: this.steps,
      state: {
        paddle_x: this.px,
        paddle_y: PLAYER_Y,
        paddle_w: PW,
        paddle_h: PH,
        paddle_speed: PSPEED,
        hazard_w: HW,
        hazard_h: HH,
        width: W,
        height: H,
        fall: FALL,
        hazards: this.hazards.map(([x, y]) => ({ x, y })),
        score: Math.trunc(this.score),
        alive: this.alive,
      },
      text: this.render(),
      frame: null,
      legal_actions: this.legalActions(),
      score: this.score,
      done: this.done,
      reward: reward,
      info: { score: Math.trunc(this.score), alive: this.alive },
    };
  }
}
