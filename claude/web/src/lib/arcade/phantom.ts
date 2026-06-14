/**
 * Phantom — a deterministic SteamBench arcade *memory / occlusion vision* env.
 *
 * TypeScript mirror of `harness/steambench_harness/envs/phantom.py` (and the
 * headless twin of the pixel runtime's PhantomGame). Dodge falling blocks that
 * blink out of view on a fixed cycle — they keep falling (and killing) while
 * hidden, so you must remember them.
 *
 * Determinism note: integer dynamics; one rng draw per spawn (the column). The
 * blink is a pure function of `steps` (`steps % 14 < 9` = visible). Collision
 * uses the REAL blocks; the observation exposes them only while visible — but
 * the SCORE depends only on (seed, actions) via the real blocks, so a recorded
 * trace replays identically in Python and TypeScript.
 */

import { ActionSpace, Env } from "./base";
import type { AchievementSpec, Action, Observation } from "./types";

const W = 168;
const H = 120;
const PW = 20;
const PH = 8;
const BW = 14;
const BH = 14;
const PLAYER_Y = H - PH - 3; // 109
const PSPEED = 7;
const FALL = 4;
const SPAWN_GAP = 26;
const BLINK_PERIOD = 14;
const VISIBLE_TICKS = 9;
const ACTIONS = ["left", "stay", "right"] as const;

export class Phantom extends Env {
  static env_id = "arcade/phantom";
  static appid = 9000015;
  static displayName = "Phantom";
  static description =
    "Dodge the falling blocks — but the lights blink out and the blocks vanish " +
    "for a few ticks at a time while still falling. You must remember where they " +
    "were and where they're going. Memory under partial observability.";
  static verify_mode = "replay" as const;
  static action_space = new ActionSpace([...ACTIONS]);
  static achievements: AchievementSpec[] = [
    { id: "survive_50", name: "Blink", description: "Survive 50 ticks.", rarity_hint: 0.6 },
    { id: "survive_150", name: "Afterimage", description: "Survive 150 ticks.", rarity_hint: 0.3 },
    { id: "survive_300", name: "Sixth Sense", description: "Survive 300 ticks.", rarity_hint: 0.12 },
    { id: "survive_600", name: "Echolocation", description: "Survive 600 ticks.", rarity_hint: 0.035 },
    { id: "survive_1200", name: "Mind's Eye", description: "Survive 1200 ticks.", rarity_hint: 0.006 },
  ];
  private static LADDER: [number, string][] = [
    [50, "survive_50"], [150, "survive_150"], [300, "survive_300"],
    [600, "survive_600"], [1200, "survive_1200"],
  ];

  px: number;
  blocks: [number, number][];
  alive: boolean;
  private sinceSpawn: number;

  constructor() {
    super();
    this.px = Math.trunc((W - PW) / 2);
    this.blocks = [];
    this.alive = true;
    this.sinceSpawn = SPAWN_GAP;
  }

  reset(seed = 0): Observation {
    this.begin(seed);
    this.px = Math.trunc((W - PW) / 2);
    this.blocks = [];
    this.alive = true;
    this.sinceSpawn = SPAWN_GAP;
    return this.observe(0.0);
  }

  private visible(): boolean {
    return this.steps % BLINK_PERIOD < VISIBLE_TICKS;
  }

  step(action: Action): Observation {
    if (this.done) return this.observe(0.0);
    const name = this.actionSpace.name(action);
    this.steps += 1;

    if (name === "left") this.px = Math.max(0, this.px - PSPEED);
    else if (name === "right") this.px = Math.min(W - PW, this.px + PSPEED);

    this.sinceSpawn += FALL;
    if (this.sinceSpawn >= SPAWN_GAP) {
      this.sinceSpawn = 0;
      const x = this.rng.randrange(W - BW + 1);
      this.blocks.push([x, -BH]);
    }
    for (const b of this.blocks) b[1] += FALL;
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
      for (const [thresh, aid] of Phantom.LADDER) {
        if (this.score >= thresh) this.unlock(aid);
      }
    }
    return this.observe(reward);
  }

  legalActions(): string[] {
    return [...ACTIONS];
  }

  render(): string {
    return `score=${Math.trunc(this.score)} px=${this.px} blocks=${this.blocks.length} ${this.visible() ? "VIS" : "DARK"} ${this.alive ? "ALIVE" : "DEAD"}`;
  }

  private observe(reward: number): Observation {
    const visible = this.visible();
    const shown = visible ? this.blocks.map(([x, y]) => ({ x, y })) : [];
    return {
      step: this.steps,
      state: {
        paddle_x: this.px, paddle_y: PLAYER_Y, paddle_w: PW, paddle_h: PH, paddle_speed: PSPEED,
        block_w: BW, block_h: BH, fall: FALL, width: W, height: H,
        visible, blocks: shown, score: Math.trunc(this.score), alive: this.alive,
      },
      text: this.render(),
      frame: null,
      legal_actions: this.legalActions(),
      score: this.score,
      done: this.done,
      reward: reward,
      info: { score: Math.trunc(this.score), alive: this.alive, visible },
    };
  }
}
