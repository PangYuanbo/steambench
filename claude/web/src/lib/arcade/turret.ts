/**
 * Turret — a deterministic SteamBench arcade *targeting-vision* env.
 *
 * TypeScript mirror of `harness/steambench_harness/envs/turret.py` (and the
 * headless twin of the pixel runtime's TurretGame). Slide the cannon and shoot
 * descending targets before they leak; three leaks ends the run.
 *
 * Determinism note: integer positions/velocities in Python's exact order. One
 * rng draw per spawn (the column), and spawns fire on a hits-dependent cadence
 * `max(9, 24 - hits//7)` — identical to Python — so `(seed, actions)` traces
 * replay identically (human, Python agent, or the vision agent from frames).
 */

import { ActionSpace, Env } from "./base";
import type { AchievementSpec, Action, Observation } from "./types";

const W = 168;
const H = 120;
const CW = 18;
const CH = 8;
const CANNON_Y = H - CH - 3; // 109
const PSPEED = 7;
const BUW = 4;
const BUH = 8;
const BULLET_SPEED = 9;
const TW = 14;
const TH = 12;
const TARGET_VY = 3;
const LEAK_Y = CANNON_Y;
const START_LIVES = 3;
const ACTIONS = ["left", "stay", "right", "fire"] as const;

export class Turret extends Env {
  static env_id = "arcade/turret";
  static appid = 9000013;
  static displayName = "Turret";
  static description =
    "Slide the cannon and shoot the descending targets before they reach the " +
    "floor — three leaks and you're done. Aim and fire (not just dodge): the " +
    "agent must read targets, the cannon, and its bullet in flight, then act.";
  static verify_mode = "replay" as const;
  static action_space = new ActionSpace([...ACTIONS]);
  static achievements: AchievementSpec[] = [
    { id: "hit_5", name: "Bullseye", description: "Destroy 5 targets.", rarity_hint: 0.6 },
    { id: "hit_15", name: "Sharpshooter", description: "Destroy 15 targets.", rarity_hint: 0.3 },
    { id: "hit_30", name: "Deadeye", description: "Destroy 30 targets.", rarity_hint: 0.12 },
    { id: "hit_60", name: "Gunslinger", description: "Destroy 60 targets.", rarity_hint: 0.035 },
    { id: "hit_120", name: "Annie Oakley", description: "Destroy 120 targets.", rarity_hint: 0.006 },
  ];
  private static LADDER: [number, string][] = [
    [5, "hit_5"], [15, "hit_15"], [30, "hit_30"], [60, "hit_60"], [120, "hit_120"],
  ];

  cx: number;
  bullet: [number, number] | null;
  targets: [number, number][];
  hits: number;
  lives: number;
  alive: boolean;

  constructor() {
    super();
    this.cx = Math.trunc((W - CW) / 2);
    this.bullet = null;
    this.targets = [];
    this.hits = 0;
    this.lives = START_LIVES;
    this.alive = true;
  }

  reset(seed = 0): Observation {
    this.begin(seed);
    this.cx = Math.trunc((W - CW) / 2);
    this.bullet = null;
    this.targets = [];
    this.hits = 0;
    this.lives = START_LIVES;
    this.alive = true;
    return this.observe(0.0);
  }

  private spawnEvery(): number {
    return Math.max(9, 24 - Math.trunc(this.hits / 7));
  }

  step(action: Action): Observation {
    if (this.done) return this.observe(0.0);
    const name = this.actionSpace.name(action);
    this.steps += 1;

    if (name === "left") this.cx = Math.max(0, this.cx - PSPEED);
    else if (name === "right") this.cx = Math.min(W - CW, this.cx + PSPEED);
    else if (name === "fire" && this.bullet === null) {
      this.bullet = [this.cx + Math.trunc(CW / 2) - Math.trunc(BUW / 2), CANNON_Y - BUH];
    }

    if (this.bullet !== null) {
      this.bullet[1] -= BULLET_SPEED;
      if (this.bullet[1] + BUH < 0) this.bullet = null;
    }

    if (this.steps % this.spawnEvery() === 0) {
      const x = this.rng.randrange(W - TW + 1);
      this.targets.push([x, -TH]);
    }
    for (const t of this.targets) t[1] += TARGET_VY;

    let reward = 0.0;
    if (this.bullet !== null) {
      const [bx, by] = this.bullet;
      for (let i = 0; i < this.targets.length; i++) {
        const [tx, ty] = this.targets[i];
        if (bx < tx + TW && bx + BUW > tx && by < ty + TH && by + BUH > ty) {
          this.targets.splice(i, 1);
          this.bullet = null;
          this.hits += 1;
          reward = 1.0;
          for (const [thresh, aid] of Turret.LADDER) {
            if (this.hits >= thresh) this.unlock(aid);
          }
          break;
        }
      }
    }

    const leaked = this.targets.filter((t) => t[1] + TH >= LEAK_Y);
    if (leaked.length > 0) {
      this.targets = this.targets.filter((t) => t[1] + TH < LEAK_Y);
      this.lives -= leaked.length;
      reward = -1.0;
      if (this.lives <= 0) {
        this.lives = 0;
        this.alive = false;
        this.done = true;
      }
    }

    this.score = this.hits;
    return this.observe(reward);
  }

  legalActions(): string[] {
    return [...ACTIONS];
  }

  render(): string {
    return (
      `hits=${this.hits} lives=${this.lives} cx=${this.cx} targets=${this.targets.length} ` +
      `bullet=${this.bullet ? "Y" : "N"} ${this.alive ? "ALIVE" : "DEAD"}`
    );
  }

  private observe(reward: number): Observation {
    return {
      step: this.steps,
      state: {
        cannon_x: this.cx, cannon_y: CANNON_Y, cannon_w: CW, cannon_h: CH, cannon_speed: PSPEED,
        bullet: this.bullet ? { x: this.bullet[0], y: this.bullet[1] } : null,
        bullet_w: BUW, bullet_h: BUH, target_w: TW, target_h: TH,
        targets: this.targets.map(([x, y]) => ({ x, y })),
        width: W, height: H, hits: this.hits, lives: this.lives, score: this.hits, alive: this.alive,
      },
      text: this.render(),
      frame: null,
      legal_actions: this.legalActions(),
      score: this.hits,
      done: this.done,
      reward: reward,
      info: { hits: this.hits, lives: this.lives, alive: this.alive },
    };
  }
}
