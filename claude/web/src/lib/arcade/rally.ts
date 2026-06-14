/**
 * Rally — a deterministic SteamBench arcade *adversarial vision* env (Pong).
 *
 * TypeScript mirror of `harness/steambench_harness/envs/rally.py` (and the
 * headless twin of the pixel runtime's RallyGame). Drive the left paddle, return
 * the attacking opponent's shots; the run ends the first time you miss.
 *
 * Determinism note: integer dynamics; the only rng is each serve's vertical
 * velocity (one draw). The opponent is a deterministic tracker/attacker, so the
 * whole rally is reproducible from (seed, actions).
 */

import { ActionSpace, Env } from "./base";
import type { AchievementSpec, Action, Observation } from "./types";

const W = 168;
const H = 120;
const PADW = 4;
const PADH = 26;
const AGENT_X = 4;
const OPP_X = W - 4 - PADW;
const PSPEED = 6;
const OPP_SPEED = 7;
const BS = 6;
const BASE_SPEED = 4;
const MAX_SPEED = 8;
const SERVE_VY = [-2, -1, 1, 2];
const ACTIONS = ["up", "down", "stay"] as const;

export class Rally extends Env {
  static env_id = "arcade/rally";
  static appid = 9000016;
  static displayName = "Rally";
  static description =
    "A Pong-style duel: drive the left paddle, read the ball, and beat the " +
    "built-in opponent — score when it can't reach your return, and the run " +
    "ends the first time you miss. Adversarial, temporal and visual at once.";
  static verify_mode = "replay" as const;
  static action_space = new ActionSpace([...ACTIONS]);
  static achievements: AchievementSpec[] = [
    { id: "rally_5", name: "Warm-up", description: "Return 5 of the opponent's shots.", rarity_hint: 0.6 },
    { id: "rally_15", name: "Rally", description: "Return 15 shots.", rarity_hint: 0.3 },
    { id: "rally_30", name: "Backboard", description: "Return 30 shots.", rarity_hint: 0.12 },
    { id: "rally_60", name: "Iron Wall", description: "Return 60 shots.", rarity_hint: 0.035 },
    { id: "rally_120", name: "Untouchable", description: "Return 120 shots.", rarity_hint: 0.006 },
  ];
  private static LADDER: [number, string][] = [
    [5, "rally_5"], [15, "rally_15"], [30, "rally_30"], [60, "rally_60"], [120, "rally_120"],
  ];

  ay: number; oy: number;
  bx: number; by: number; vx: number; vy: number; speed: number;
  points: number; alive: boolean;

  constructor() {
    super();
    this.ay = Math.trunc((H - PADH) / 2);
    this.oy = Math.trunc((H - PADH) / 2);
    this.bx = Math.trunc(W / 2); this.by = Math.trunc(H / 2);
    this.vx = -BASE_SPEED; this.vy = 1; this.speed = BASE_SPEED;
    this.points = 0; this.alive = true;
  }

  private serve(): void {
    this.bx = Math.trunc(W / 2);
    this.by = Math.trunc(H / 2);
    this.speed = BASE_SPEED;
    this.vx = -BASE_SPEED;
    this.vy = SERVE_VY[this.rng.randrange(SERVE_VY.length)];
  }

  reset(seed = 0): Observation {
    this.begin(seed);
    this.ay = Math.trunc((H - PADH) / 2);
    this.oy = Math.trunc((H - PADH) / 2);
    this.points = 0;
    this.alive = true;
    this.serve();
    return this.observe(0.0);
  }

  step(action: Action): Observation {
    if (this.done) return this.observe(0.0);
    const name = this.actionSpace.name(action);
    this.steps += 1;

    if (name === "up") this.ay = Math.max(0, this.ay - PSPEED);
    else if (name === "down") this.ay = Math.min(H - PADH, this.ay + PSPEED);

    const ballCy = this.by + Math.trunc(BS / 2);
    const oppCy = this.oy + Math.trunc(PADH / 2);
    if (ballCy < oppCy - 1) this.oy = Math.max(0, this.oy - OPP_SPEED);
    else if (ballCy > oppCy + 1) this.oy = Math.min(H - PADH, this.oy + OPP_SPEED);

    this.bx += this.vx;
    this.by += this.vy;
    if (this.by <= 0) { this.by = 0; this.vy = -this.vy; }
    else if (this.by >= H - BS) { this.by = H - BS; this.vy = -this.vy; }

    let reward = 0.0;
    if (this.vx < 0 && this.bx <= AGENT_X + PADW && this.bx > AGENT_X - this.speed) {
      if (this.by + BS > this.ay && this.by < this.ay + PADH) {
        this.bx = AGENT_X + PADW;
        this.speed = Math.min(MAX_SPEED, this.speed + 1);
        this.vx = this.speed;
        const off = (this.by + Math.trunc(BS / 2)) - (this.ay + Math.trunc(PADH / 2));
        // Python uses floor division (//) — `off` can be negative, where
        // Math.trunc would diverge — so floor here to stay bit-identical.
        this.vy = Math.max(-7, Math.min(7, Math.floor(off / 2)));
        this.points += 1;
        reward = 1.0;
        for (const [thresh, aid] of Rally.LADDER) {
          if (this.points >= thresh) this.unlock(aid);
        }
      }
    } else if (this.vx > 0 && this.bx + BS >= OPP_X && this.bx + BS < OPP_X + PADW + this.speed) {
      this.bx = OPP_X - BS;
      this.speed = Math.min(MAX_SPEED, this.speed + 1);
      this.vx = -this.speed;
      const agentCy = this.ay + Math.trunc(PADH / 2);
      this.vy = agentCy < Math.trunc(H / 2) ? this.speed - 2 : -(this.speed - 2);
    }

    if (this.bx + BS < 0) {
      this.alive = false;
      this.done = true;
      reward = -1.0;
    } else if (this.bx > W) {
      this.serve();
    }

    this.score = this.points;
    return this.observe(reward);
  }

  legalActions(): string[] {
    return [...ACTIONS];
  }

  render(): string {
    return `points=${this.points} ay=${this.ay} oy=${this.oy} ball=(${this.bx},${this.by}) v=(${this.vx},${this.vy}) ${this.alive ? "ALIVE" : "DEAD"}`;
  }

  private observe(reward: number): Observation {
    return {
      step: this.steps,
      state: {
        agent_x: AGENT_X, agent_y: this.ay, opp_x: OPP_X, opp_y: this.oy,
        paddle_w: PADW, paddle_h: PADH, paddle_speed: PSPEED,
        ball_x: this.bx, ball_y: this.by, ball_vx: this.vx, ball_vy: this.vy, ball_size: BS,
        width: W, height: H, points: this.points, score: this.points, alive: this.alive,
      },
      text: this.render(),
      frame: null,
      legal_actions: this.legalActions(),
      score: this.points,
      done: this.done,
      reward: reward,
      info: { points: this.points, alive: this.alive },
    };
  }
}
