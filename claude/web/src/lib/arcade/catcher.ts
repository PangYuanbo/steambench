/**
 * Catcher — a deterministic SteamBench arcade *vision* env (richer than Dodger).
 *
 * TypeScript mirror of `harness/steambench_harness/envs/catcher.py` (and the
 * headless twin of the pixel runtime's CatcherGame). Catch the good drops, dodge
 * the bad ones — a two-class perception task.
 *
 * Determinism note: each spawn draws TWO values in a fixed order — the column
 * `rng.randrange(W - IW + 1)`, then the kind `rng.randrange(BAD_DEN) < BAD_NUM`.
 * Everything else is integer arithmetic in Python's exact order, so a recorded
 * `(seed, actions)` trace — human, Python agent, or the vision agent reading
 * pixels — replays to the same score in either language.
 */

import { ActionSpace, Env } from "./base";
import type { AchievementSpec, Action, Observation } from "./types";

const W = 168;
const H = 120;
const PW = 24;
const PH = 8;
const IW = 12;
const IH = 12;
const PLAYER_Y = H - PH - 3; // 109
const PSPEED = 7;
const FALL = 4;
const SPAWN_GAP = 22;
const BAD_NUM = 37;
const BAD_DEN = 100;
const ACTIONS = ["left", "stay", "right"] as const;

export class Catcher extends Env {
  static env_id = "arcade/catcher";
  static appid = 9000010;
  static displayName = "Catcher";
  static description =
    "Catch the falling green drops, dodge the red ones. A two-class vision " +
    "task: tell good from bad, sweep up the good, flinch from the bad — one " +
    "red touch ends the run. The second game a vision agent plays from pixels.";
  static verify_mode = "replay" as const;
  static action_space = new ActionSpace([...ACTIONS]);
  static achievements: AchievementSpec[] = [
    { id: "catch_5", name: "First Drops", description: "Catch 5 good items.", rarity_hint: 0.6 },
    { id: "catch_15", name: "Bucket Hands", description: "Catch 15 good items.", rarity_hint: 0.32 },
    { id: "catch_30", name: "Sticky Fingers", description: "Catch 30 good items.", rarity_hint: 0.13 },
    { id: "catch_60", name: "Vacuum", description: "Catch 60 good items.", rarity_hint: 0.04 },
    { id: "catch_120", name: "Event Horizon", description: "Catch 120 good items.", rarity_hint: 0.006 },
  ];
  private static LADDER: [number, string][] = [
    [5, "catch_5"], [15, "catch_15"], [30, "catch_30"], [60, "catch_60"], [120, "catch_120"],
  ];

  px: number;
  items: [number, number, number][]; // [x, y, kind] kind 0=good 1=bad
  caught: number;
  alive: boolean;
  private sinceSpawn: number;

  constructor() {
    super();
    this.px = Math.trunc((W - PW) / 2);
    this.items = [];
    this.caught = 0;
    this.alive = true;
    this.sinceSpawn = SPAWN_GAP;
  }

  reset(seed = 0): Observation {
    this.begin(seed);
    this.px = Math.trunc((W - PW) / 2);
    this.items = [];
    this.caught = 0;
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

    this.sinceSpawn += FALL;
    if (this.sinceSpawn >= SPAWN_GAP) {
      this.sinceSpawn = 0;
      const x = this.rng.randrange(W - IW + 1);
      const kind = this.rng.randrange(BAD_DEN) < BAD_NUM ? 1 : 0;
      this.items.push([x, -IH, kind]);
    }
    for (const it of this.items) {
      it[1] += FALL;
    }

    let reward = 0.0;
    const survivors: [number, number, number][] = [];
    for (const [x, y, kind] of this.items) {
      const overlaps = x < this.px + PW && x + IW > this.px && y < PLAYER_Y + PH && y + IH > PLAYER_Y;
      if (overlaps) {
        if (kind === 1) {
          this.alive = false;
          this.done = true;
          reward = -1.0;
        } else {
          this.caught += 1;
          reward += 1.0;
        }
        continue;
      }
      if (y >= H) {
        continue;
      }
      survivors.push([x, y, kind]);
    }
    this.items = survivors;

    this.score = this.caught; // always reflects goods caught, even on a death tick
    if (!this.done) {
      for (const [thresh, aid] of Catcher.LADDER) {
        if (this.caught >= thresh) {
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
    let goods = 0;
    for (const it of this.items) if (it[2] === 0) goods += 1;
    const bads = this.items.length - goods;
    return `caught=${this.caught} px=${this.px} good=${goods} bad=${bads} ${this.alive ? "ALIVE" : "DEAD"}`;
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
        item_w: IW,
        item_h: IH,
        width: W,
        height: H,
        fall: FALL,
        items: this.items.map(([x, y, kind]) => ({ x, y, kind })),
        caught: this.caught,
        score: this.caught,
        alive: this.alive,
      },
      text: this.render(),
      frame: null,
      legal_actions: this.legalActions(),
      score: this.caught,
      done: this.done,
      reward: reward,
      info: { caught: this.caught, alive: this.alive },
    };
  }
}
