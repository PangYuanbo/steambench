/**
 * Storm — a deterministic SteamBench arcade *multi-object temporal-vision* env.
 *
 * TypeScript mirror of `harness/steambench_harness/envs/storm.py` (and the
 * headless twin of the pixel runtime's StormGame). Blocks rain down, each at its
 * OWN speed, so you must track several at once.
 *
 * Determinism note: integer positions/velocities in Python's exact order. Each
 * spawn draws TWO values in a fixed order — the column `rng.randrange(W - BW + 1)`,
 * then the fall speed `_VY_MIN + rng.randrange(_VY_SPAN)`. Spawns fire on a fixed
 * tick cadence (`steps % SPAWN_EVERY === 0`), so `(seed, actions)` traces replay
 * identically — human, Python agent, or the vision agent reading frames.
 */

import { ActionSpace, Env } from "./base";
import type { AchievementSpec, Action, Observation } from "./types";

const W = 168;
const H = 120;
const PW = 22;
const PH = 8;
const BW = 12;
const BH = 12;
const PLAYER_Y = H - PH - 3; // 109
const PSPEED = 7;
const SPAWN_EVERY = 8;
const VY_MIN = 3;
const VY_SPAN = 5;
const ACTIONS = ["left", "stay", "right"] as const;

export class Storm extends Env {
  static env_id = "arcade/storm";
  static appid = 9000012;
  static displayName = "Storm";
  static description =
    "Dodge the falling blocks — but every block falls at its own speed, so you " +
    "must track several at once and read each one's velocity to survive. " +
    "Multi-object temporal perception: the frontier a vision agent plays from raw frames.";
  static verify_mode = "replay" as const;
  static action_space = new ActionSpace([...ACTIONS]);
  static achievements: AchievementSpec[] = [
    { id: "survive_50", name: "Drizzle", description: "Survive 50 ticks.", rarity_hint: 0.6 },
    { id: "survive_150", name: "Downpour", description: "Survive 150 ticks.", rarity_hint: 0.3 },
    { id: "survive_300", name: "Squall", description: "Survive 300 ticks.", rarity_hint: 0.12 },
    { id: "survive_600", name: "Tempest", description: "Survive 600 ticks.", rarity_hint: 0.035 },
    { id: "survive_1200", name: "Eye of the Storm", description: "Survive 1200 ticks.", rarity_hint: 0.006 },
  ];
  private static LADDER: [number, string][] = [
    [50, "survive_50"], [150, "survive_150"], [300, "survive_300"],
    [600, "survive_600"], [1200, "survive_1200"],
  ];

  px: number;
  blocks: [number, number, number][]; // [x, y, vy]
  alive: boolean;

  constructor() {
    super();
    this.px = Math.trunc((W - PW) / 2);
    this.blocks = [];
    this.alive = true;
  }

  reset(seed = 0): Observation {
    this.begin(seed);
    this.px = Math.trunc((W - PW) / 2);
    this.blocks = [];
    this.alive = true;
    return this.observe(0.0);
  }

  step(action: Action): Observation {
    if (this.done) return this.observe(0.0);
    const name = this.actionSpace.name(action);
    this.steps += 1;

    if (name === "left") this.px = Math.max(0, this.px - PSPEED);
    else if (name === "right") this.px = Math.min(W - PW, this.px + PSPEED);

    if (this.steps % SPAWN_EVERY === 0) {
      const x = this.rng.randrange(W - BW + 1);
      const vy = VY_MIN + this.rng.randrange(VY_SPAN);
      this.blocks.push([x, -BH, vy]);
    }
    for (const b of this.blocks) b[1] += b[2];
    this.blocks = this.blocks.filter((b) => b[1] < H);

    let hit = false;
    for (const [bx, by] of this.blocks) {
      if (bx < this.px + PW && bx + BW > this.px && by < PLAYER_Y + PH && by + BH > PLAYER_Y) {
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
      for (const [thresh, aid] of Storm.LADDER) {
        if (this.score >= thresh) this.unlock(aid);
      }
    }
    return this.observe(reward);
  }

  legalActions(): string[] {
    return [...ACTIONS];
  }

  render(): string {
    return `score=${Math.trunc(this.score)} px=${this.px} blocks=${this.blocks.length} ${this.alive ? "ALIVE" : "DEAD"}`;
  }

  private observe(reward: number): Observation {
    return {
      step: this.steps,
      state: {
        paddle_x: this.px, paddle_y: PLAYER_Y, paddle_w: PW, paddle_h: PH, paddle_speed: PSPEED,
        block_w: BW, block_h: BH, width: W, height: H,
        blocks: this.blocks.map(([x, y, vy]) => ({ x, y, vy })),
        score: Math.trunc(this.score), alive: this.alive,
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
