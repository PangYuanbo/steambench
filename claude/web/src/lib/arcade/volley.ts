/**
 * Volley — a deterministic SteamBench arcade *temporal-vision* env.
 *
 * TypeScript mirror of `harness/steambench_harness/envs/volley.py` (and the
 * headless twin of the pixel runtime's VolleyGame). Keep a bouncing ball up: it
 * caroms off walls + ceiling and falls; slide under it to bounce it back.
 *
 * Determinism note: ALL physics is integer (positions + velocities) in the exact
 * same order as Python, so there is no float drift. The only randomness is the
 * launch — TWO draws in a fixed order: the column `rng.randrange(W - BS + 1)`,
 * then the horizontal velocity from `_LAUNCH_VX`. So `(seed, actions)` traces —
 * human, Python agent, or the vision agent reading frames — replay identically.
 */

import { ActionSpace, Env } from "./base";
import type { AchievementSpec, Action, Observation } from "./types";

const W = 168;
const H = 120;
const BS = 8;
const PW = 26;
const PH = 6;
const PLAYER_Y = H - PH - 3; // 111
const PSPEED = 6;
const LAUNCH_VX = [-8, -7, 7, 8];
const VY0 = 4;
const VY_MAX = 11;
const ACTIONS = ["left", "stay", "right"] as const;

export class Volley extends Env {
  static env_id = "arcade/volley";
  static appid = 9000011;
  static displayName = "Volley";
  static description =
    "Keep the bouncing ball up: it caroms off the walls and ceiling and falls " +
    "toward the floor — slide under it to bounce it back. One miss ends the run. " +
    "A vision agent must read the ball's motion, not just its position.";
  static verify_mode = "replay" as const;
  static action_space = new ActionSpace([...ACTIONS]);
  static achievements: AchievementSpec[] = [
    { id: "bounce_5", name: "Rally", description: "Bounce the ball 5 times.", rarity_hint: 0.6 },
    { id: "bounce_15", name: "Keepy-Uppy", description: "Bounce the ball 15 times.", rarity_hint: 0.3 },
    { id: "bounce_30", name: "Metronome", description: "Bounce the ball 30 times.", rarity_hint: 0.12 },
    { id: "bounce_60", name: "Wall", description: "Bounce the ball 60 times.", rarity_hint: 0.035 },
    { id: "bounce_120", name: "Unbreakable", description: "Bounce the ball 120 times.", rarity_hint: 0.006 },
  ];
  private static LADDER: [number, string][] = [
    [5, "bounce_5"], [15, "bounce_15"], [30, "bounce_30"], [60, "bounce_60"], [120, "bounce_120"],
  ];

  bx: number; by: number; vx: number; vy: number;
  px: number; bounces: number; alive: boolean;

  constructor() {
    super();
    this.bx = Math.trunc((W - BS) / 2);
    this.by = 12; this.vx = 2; this.vy = VY0;
    this.px = Math.trunc((W - PW) / 2);
    this.bounces = 0; this.alive = true;
  }

  reset(seed = 0): Observation {
    this.begin(seed);
    this.bx = this.rng.randrange(W - BS + 1);              // 1st draw
    this.by = 12;
    this.vx = LAUNCH_VX[this.rng.randrange(LAUNCH_VX.length)]; // 2nd draw
    this.vy = VY0;
    this.px = Math.trunc((W - PW) / 2);
    this.bounces = 0;
    this.alive = true;
    return this.observe(0.0);
  }

  step(action: Action): Observation {
    if (this.done) return this.observe(0.0);
    const name = this.actionSpace.name(action);
    this.steps += 1;

    if (name === "left") this.px = Math.max(0, this.px - PSPEED);
    else if (name === "right") this.px = Math.min(W - PW, this.px + PSPEED);

    this.bx += this.vx;
    this.by += this.vy;
    if (this.bx <= 0) { this.bx = 0; this.vx = -this.vx; }
    else if (this.bx >= W - BS) { this.bx = W - BS; this.vx = -this.vx; }
    if (this.by <= 0) { this.by = 0; this.vy = -this.vy; }

    let reward = 0.0;
    if (this.vy > 0 && this.by + BS >= PLAYER_Y) {
      const inBand = this.by <= PLAYER_Y + PH;
      const xOverlap = this.bx + BS > this.px && this.bx < this.px + PW;
      if (inBand && xOverlap) {
        this.bounces += 1;
        this.by = PLAYER_Y - BS;
        const mag = Math.min(VY_MAX, VY0 + Math.trunc(this.bounces / 10));
        this.vy = -mag;
        reward = 1.0;
        for (const [thresh, aid] of Volley.LADDER) {
          if (this.bounces >= thresh) this.unlock(aid);
        }
      } else if (this.by >= H) {
        this.alive = false;
        this.done = true;
        reward = -1.0;
      }
    }
    this.score = this.bounces;
    return this.observe(reward);
  }

  legalActions(): string[] {
    return [...ACTIONS];
  }

  render(): string {
    return (
      `bounces=${this.bounces} ball=(${this.bx},${this.by}) v=(${this.vx},${this.vy}) ` +
      `px=${this.px} ${this.alive ? "ALIVE" : "DEAD"}`
    );
  }

  private observe(reward: number): Observation {
    return {
      step: this.steps,
      state: {
        ball_x: this.bx, ball_y: this.by, ball_vx: this.vx, ball_vy: this.vy, ball_size: BS,
        paddle_x: this.px, paddle_y: PLAYER_Y, paddle_w: PW, paddle_h: PH, paddle_speed: PSPEED,
        width: W, height: H, bounces: this.bounces, score: this.bounces, alive: this.alive,
      },
      text: this.render(),
      frame: null,
      legal_actions: this.legalActions(),
      score: this.bounces,
      done: this.done,
      reward: reward,
      info: { bounces: this.bounces, alive: this.alive },
    };
  }
}
