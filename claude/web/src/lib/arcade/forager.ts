/**
 * Forager — a deterministic SteamBench arcade *2D-navigation vision* env.
 *
 * TypeScript mirror of `harness/steambench_harness/envs/forager.py` (and the
 * headless twin of the pixel runtime's ForagerGame). Roam a 2D arena collecting
 * good drops while dodging roaming hazards.
 *
 * Determinism note: integer positions/velocities in Python's exact order. RNG
 * draw order is parity-critical: reset draws goods first (each: x then y), then
 * hazards (each: x, y, vx, vy); on collection a good respawns (x, y) and every
 * 18th collect adds a hazard (x, y, vx, vy). Same order here → `(seed, actions)`
 * replays identically.
 */

import { ActionSpace, Env } from "./base";
import type { AchievementSpec, Action, Observation } from "./types";

const W = 168;
const H = 120;
const PS = 10;
const PSPEED = 5;
const GS = 8;
const HS = 12;
const N_GOOD = 3;
const START_HAZ = 2;
const MAX_HAZ = 5;
const HAZ_V = [-3, -2, 2, 3];
const ACTIONS = ["up", "down", "left", "right", "stay"] as const;

export class Forager extends Env {
  static env_id = "arcade/forager";
  static appid = 9000014;
  static displayName = "Forager";
  static description =
    "Roam a 2D arena to collect the good drops while dodging the roaming " +
    "hazards — the first game with free up/down/left/right movement, so a " +
    "vision agent must reason over the whole board, not just one row.";
  static verify_mode = "replay" as const;
  static action_space = new ActionSpace([...ACTIONS]);
  static achievements: AchievementSpec[] = [
    { id: "collect_5", name: "Scavenger", description: "Collect 5 drops.", rarity_hint: 0.6 },
    { id: "collect_15", name: "Gatherer", description: "Collect 15 drops.", rarity_hint: 0.3 },
    { id: "collect_30", name: "Forager", description: "Collect 30 drops.", rarity_hint: 0.12 },
    { id: "collect_60", name: "Hoarder", description: "Collect 60 drops.", rarity_hint: 0.035 },
    { id: "collect_120", name: "Cornucopia", description: "Collect 120 drops.", rarity_hint: 0.006 },
  ];
  private static LADDER: [number, string][] = [
    [5, "collect_5"], [15, "collect_15"], [30, "collect_30"], [60, "collect_60"], [120, "collect_120"],
  ];

  px: number;
  py: number;
  goods: [number, number][];
  hazards: [number, number, number, number][]; // x, y, vx, vy
  collected: number;
  alive: boolean;

  constructor() {
    super();
    this.px = Math.trunc((W - PS) / 2);
    this.py = Math.trunc((H - PS) / 2);
    this.goods = [];
    this.hazards = [];
    this.collected = 0;
    this.alive = true;
  }

  private randGood(): [number, number] {
    const x = this.rng.randrange(W - GS + 1);
    const y = this.rng.randrange(H - GS + 1);
    return [x, y];
  }

  private randHazard(): [number, number, number, number] {
    const x = this.rng.randrange(W - HS + 1);
    const y = this.rng.randrange(Math.max(1, Math.trunc(H / 2) - HS));
    const vx = HAZ_V[this.rng.randrange(HAZ_V.length)];
    const vy = HAZ_V[this.rng.randrange(HAZ_V.length)];
    return [x, y, vx, vy];
  }

  reset(seed = 0): Observation {
    this.begin(seed);
    this.px = Math.trunc((W - PS) / 2);
    this.py = Math.trunc((H - PS) / 2);
    this.collected = 0;
    this.alive = true;
    this.goods = [];
    for (let i = 0; i < N_GOOD; i++) this.goods.push(this.randGood());
    this.hazards = [];
    for (let i = 0; i < START_HAZ; i++) this.hazards.push(this.randHazard());
    return this.observe(0.0);
  }

  step(action: Action): Observation {
    if (this.done) return this.observe(0.0);
    const name = this.actionSpace.name(action);
    this.steps += 1;

    if (name === "up") this.py = Math.max(0, this.py - PSPEED);
    else if (name === "down") this.py = Math.min(H - PS, this.py + PSPEED);
    else if (name === "left") this.px = Math.max(0, this.px - PSPEED);
    else if (name === "right") this.px = Math.min(W - PS, this.px + PSPEED);

    for (const hz of this.hazards) {
      hz[0] += hz[2];
      hz[1] += hz[3];
      if (hz[0] <= 0) { hz[0] = 0; hz[2] = -hz[2]; }
      else if (hz[0] >= W - HS) { hz[0] = W - HS; hz[2] = -hz[2]; }
      if (hz[1] <= 0) { hz[1] = 0; hz[3] = -hz[3]; }
      else if (hz[1] >= H - HS) { hz[1] = H - HS; hz[3] = -hz[3]; }
    }

    let reward = 0.0;
    for (let i = 0; i < this.goods.length; i++) {
      const [gx, gy] = this.goods[i];
      if (gx < this.px + PS && gx + GS > this.px && gy < this.py + PS && gy + GS > this.py) {
        this.collected += 1;
        reward += 1.0;
        for (const [thresh, aid] of Forager.LADDER) {
          if (this.collected >= thresh) this.unlock(aid);
        }
        this.goods[i] = this.randGood();
        if (this.collected % 18 === 0 && this.hazards.length < MAX_HAZ) {
          this.hazards.push(this.randHazard());
        }
      }
    }

    for (const [hx, hy] of this.hazards) {
      if (hx < this.px + PS && hx + HS > this.px && hy < this.py + PS && hy + HS > this.py) {
        this.alive = false;
        this.done = true;
        reward = -1.0;
        break;
      }
    }

    this.score = this.collected;
    return this.observe(reward);
  }

  legalActions(): string[] {
    return [...ACTIONS];
  }

  render(): string {
    return `collected=${this.collected} pos=(${this.px},${this.py}) hazards=${this.hazards.length} ${this.alive ? "ALIVE" : "DEAD"}`;
  }

  private observe(reward: number): Observation {
    return {
      step: this.steps,
      state: {
        player_x: this.px, player_y: this.py, player_size: PS, player_speed: PSPEED,
        good_size: GS, hazard_size: HS,
        goods: this.goods.map(([x, y]) => ({ x, y })),
        hazards: this.hazards.map(([x, y, vx, vy]) => ({ x, y, vx, vy })),
        width: W, height: H, collected: this.collected, score: this.collected, alive: this.alive,
      },
      text: this.render(),
      frame: null,
      legal_actions: this.legalActions(),
      score: this.collected,
      done: this.done,
      reward: reward,
      info: { collected: this.collected, alive: this.alive },
    };
  }
}
