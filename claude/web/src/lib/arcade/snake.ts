/**
 * Snake — a deterministic SteamBench arcade env.
 *
 * TypeScript mirror of `harness/steambench_harness/envs/snake.py`. Food
 * placement is seeded from `this.rng` so runs replay exactly.
 */

import { ActionSpace, Env } from "./base";
import type { AchievementSpec, Action, Observation } from "./types";

const W = 12;
const H = 12;
const ACTIONS = ["up", "down", "left", "right"] as const;

type Cell = [number, number];

const DELTA: Record<string, Cell> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
const OPPOSITE: Record<string, string> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

/** Stable string key for a cell, used for O(1) occupancy checks. */
function key(x: number, y: number): string {
  return `${x},${y}`;
}

export class Snake extends Env {
  static env_id = "arcade/snake";
  static appid = 9000002;
  static displayName = "Snake";
  static description =
    `Steer a growing snake around a ${W}x${H} grid, eating food and avoiding ` +
    "the walls and your own tail. How long can you get?";
  static verify_mode = "replay" as const;
  static action_space = new ActionSpace([...ACTIONS]);
  static achievements: AchievementSpec[] = [
    { id: "len_5", name: "First Bites", description: "Grow to length 5.", rarity_hint: 0.85 },
    { id: "len_10", name: "Lengthening", description: "Grow to length 10.", rarity_hint: 0.55 },
    { id: "len_15", name: "Serpent", description: "Grow to length 15.", rarity_hint: 0.3 },
    { id: "len_20", name: "Anaconda", description: "Grow to length 20.", rarity_hint: 0.14 },
    { id: "len_30", name: "Titanoboa", description: "Grow to length 30.", rarity_hint: 0.04 },
    { id: "len_45", name: "Ouroboros", description: "Grow to length 45.", rarity_hint: 0.007 },
    {
      id: "fill_half",
      name: "Space Filler",
      description: `Fill half of the ${W * H}-cell board.`,
      rarity_hint: 0.0015,
    },
    { id: "survive_200", name: "Marathon", description: "Survive 200 ticks.", rarity_hint: 0.2 },
  ];

  /** snake[0] is the tail, snake[length-1] is the head (mirrors the deque). */
  snake: Cell[];
  direction: string;
  food: Cell;
  alive: boolean;

  constructor() {
    super();
    this.snake = [];
    this.direction = "right";
    this.food = [0, 0];
    this.alive = true;
  }

  reset(seed = 0): Observation {
    this.begin(seed);
    const cx = Math.floor(W / 2);
    const cy = Math.floor(H / 2);
    // length-3 snake heading right
    this.snake = [
      [cx - 2, cy],
      [cx - 1, cy],
      [cx, cy],
    ];
    this.direction = "right";
    this.alive = true;
    this.placeFood();
    return this.observe(0.0);
  }

  step(action: Action): Observation {
    if (this.done) {
      return this.observe(0.0);
    }
    const name = this.actionSpace.name(action);
    // Can't reverse straight into yourself; ignore the illegal 180.
    if (name !== OPPOSITE[this.direction]) {
      this.direction = name;
    }

    const [dx, dy] = DELTA[this.direction];
    const [hx, hy] = this.snake[this.snake.length - 1];
    const nx = hx + dx;
    const ny = hy + dy;
    this.steps += 1;
    let reward = 0.0;

    // Wall collision.
    if (!(nx >= 0 && nx < W && ny >= 0 && ny < H)) {
      this.alive = false;
      this.done = true;
      return this.observe(-1.0);
    }

    const ate = nx === this.food[0] && ny === this.food[1];
    const body = new Set<string>(this.snake.map(([x, y]) => key(x, y)));
    if (!ate) {
      // tail will move unless we grow
      const tail = this.snake[0];
      body.delete(key(tail[0], tail[1]));
    }
    if (body.has(key(nx, ny))) {
      this.alive = false;
      this.done = true;
      return this.observe(-1.0);
    }

    this.snake.push([nx, ny]);
    if (ate) {
      this.score += 1;
      reward = 1.0;
      this.placeFood();
    } else {
      this.snake.shift();
    }

    this.checkAchievements();
    if (this.snake.length >= W * H) {
      // perfect game
      this.done = true;
    }
    return this.observe(reward);
  }

  // ---- mechanics --------------------------------------------------------- //

  private placeFood(): void {
    const occupied = new Set<string>(this.snake.map(([x, y]) => key(x, y)));
    const free: Cell[] = [];
    // x OUTER, y INNER — must match the Python iteration order exactly.
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        if (!occupied.has(key(x, y))) {
          free.push([x, y]);
        }
      }
    }
    if (free.length === 0) {
      this.done = true;
      return;
    }
    this.food = this.rng.choice(free);
  }

  get length(): number {
    return this.snake.length;
  }

  private checkAchievements(): void {
    const ladder: [number, string][] = [
      [5, "len_5"],
      [10, "len_10"],
      [15, "len_15"],
      [20, "len_20"],
      [30, "len_30"],
      [45, "len_45"],
    ];
    for (const [n, aid] of ladder) {
      if (this.length >= n) {
        this.unlock(aid);
      }
    }
    if (this.length >= Math.floor((W * H) / 2)) {
      this.unlock("fill_half");
    }
    if (this.steps >= 200) {
      this.unlock("survive_200");
    }
  }

  legalActions(): string[] {
    // Everything except the immediate 180.
    return ACTIONS.filter((a) => a !== OPPOSITE[this.direction]);
  }

  // ---- rendering --------------------------------------------------------- //

  render(): string {
    const head = this.snake[this.snake.length - 1];
    const body = new Set<string>(
      this.snake.slice(0, -1).map(([x, y]) => key(x, y)),
    );
    const rows: string[] = [];
    for (let y = 0; y < H; y++) {
      const line: string[] = [];
      for (let x = 0; x < W; x++) {
        if (head && x === head[0] && y === head[1]) {
          line.push("@");
        } else if (body.has(key(x, y))) {
          line.push("o");
        } else if (x === this.food[0] && y === this.food[1]) {
          line.push("*");
        } else {
          line.push(".");
        }
      }
      rows.push(line.join(""));
    }
    const status =
      `len=${this.length} score=${this.score} dir=${this.direction} ` +
      `${this.alive ? "ALIVE" : "DEAD"}`;
    return status + "\n" + rows.join("\n");
  }

  private observe(reward: number): Observation {
    const head = this.snake.length ? this.snake[this.snake.length - 1] : null;
    return {
      step: this.steps,
      state: {
        snake: this.snake.map(([x, y]) => [x, y]),
        head: head ? [head[0], head[1]] : null,
        food: [this.food[0], this.food[1]],
        direction: this.direction,
        length: this.length,
        score: this.score,
        width: W,
        height: H,
        alive: this.alive,
      },
      text: this.render(),
      frame: null,
      legal_actions: this.legalActions(),
      score: this.score,
      done: this.done,
      reward: reward,
      info: { length: this.length, alive: this.alive },
    };
  }
}
