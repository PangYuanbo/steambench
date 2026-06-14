/**
 * Sokoban — a deterministic SteamBench arcade *planning* env.
 *
 * TypeScript mirror of `harness/steambench_harness/envs/sokoban.py`. You push
 * boxes ('$') onto goals ('.'); solving a level advances to the next, harder
 * one. The action space includes `restart` (reset the current level) so a stuck
 * agent can recover. Levels are fixed (no RNG), so a run is fully determined by
 * its action trace and replay-verifies exactly.
 */

import { ActionSpace, Env } from "./base";
import type { AchievementSpec, Action, Observation } from "./types";

const ACTIONS = ["up", "down", "left", "right", "restart"] as const;

type Cell = [number, number];

const DELTA: Record<string, Cell> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

// Hand-authored, verified-solvable levels of increasing difficulty.
// '#' wall, ' ' floor, '@' player, '$' box, '.' goal, '*' box-on-goal, '+' player-on-goal.
const LEVELS = [
  // 1 — one push right
  "#####\n#@$.#\n#####",
  // 2 — push two boxes down
  "######\n#@   #\n#$$  #\n#..  #\n######",
  // 3 — push three boxes down
  "#######\n#@    #\n#$$$  #\n#...  #\n#######",
  // 4 — an L-shaped push (right, then down)
  "######\n#@   #\n# $  #\n#  . #\n######",
  // 5 — two boxes, two corners
  "######\n#@ . #\n# $$ #\n# .  #\n######",
  // 6 — a roomier puzzle
  "#######\n#@    #\n# $$  #\n# ..  #\n#     #\n#######",
];

/** Stable string key for a cell, used for O(1) occupancy checks. */
function key(x: number, y: number): string {
  return `${x},${y}`;
}

interface ParsedLevel {
  walls: Set<string>;
  goals: Set<string>;
  boxes: Set<string>;
  player: Cell;
}

function parse(level: string): ParsedLevel {
  const walls = new Set<string>();
  const goals = new Set<string>();
  const boxes = new Set<string>();
  let player: Cell = [0, 0];
  const rows = level.split("\n");
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === "#") {
        walls.add(key(x, y));
      } else if (ch === "." || ch === "+" || ch === "*") {
        goals.add(key(x, y));
      }
      if (ch === "@" || ch === "+") {
        player = [x, y];
      } else if (ch === "$" || ch === "*") {
        boxes.add(key(x, y));
      }
    }
  }
  return { walls, goals, boxes, player };
}

/** Two sets of cell keys are equal iff same size and same members. */
function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const k of a) {
    if (!b.has(k)) {
      return false;
    }
  }
  return true;
}

/**
 * Mirror Python `sorted(set_of_(x,y)_tuples)`: lexicographic by x then y.
 * Returns `[x, y]` pairs.
 */
function sortedCells(cells: Set<string>): number[][] {
  const out: Cell[] = [];
  for (const k of cells) {
    const [x, y] = k.split(",").map(Number);
    out.push([x, y]);
  }
  out.sort((p, q) => (p[0] !== q[0] ? p[0] - q[0] : p[1] - q[1]));
  return out.map(([x, y]) => [x, y]);
}

export class Sokoban extends Env {
  static env_id = "arcade/sokoban";
  static appid = 9000003;
  static displayName = "Sokoban";
  static description =
    "Push every box ('$') onto a goal ('.'). Solve a level to advance to a " +
    "harder one. Pure planning — beware corners; use restart if you jam.";
  static verify_mode = "replay" as const;
  static action_space = new ActionSpace([...ACTIONS]);
  static achievements: AchievementSpec[] = [
    { id: "solve_1", name: "First Push", description: "Solve level 1.", rarity_hint: 0.85 },
    { id: "solve_2", name: "Getting It", description: "Solve level 2.", rarity_hint: 0.6 },
    { id: "solve_3", name: "Box Wrangler", description: "Solve level 3.", rarity_hint: 0.35 },
    { id: "solve_4", name: "Cornered No More", description: "Solve level 4.", rarity_hint: 0.18 },
    { id: "solve_5", name: "Warehouse Keeper", description: "Solve level 5.", rarity_hint: 0.07 },
    { id: "solve_all", name: "Sokoban Master", description: "Solve every level.", rarity_hint: 0.025 },
  ];

  levelIndex: number;
  levelsSolved: number;
  walls: Set<string>;
  goals: Set<string>;
  boxes: Set<string>;
  player: Cell;
  private dims: Cell;

  constructor() {
    super();
    this.levelIndex = 0;
    this.levelsSolved = 0;
    this.walls = new Set<string>();
    this.goals = new Set<string>();
    this.boxes = new Set<string>();
    this.player = [0, 0];
    this.dims = [0, 0];
  }

  // ---- lifecycle --------------------------------------------------------- //

  reset(seed = 0): Observation {
    this.begin(seed); // seed unused (levels are fixed) but keeps the contract
    this.levelIndex = 0;
    this.levelsSolved = 0;
    this.loadLevel(0);
    return this.observe(0.0);
  }

  private loadLevel(i: number): void {
    const level = LEVELS[i];
    const { walls, goals, boxes, player } = parse(level);
    this.walls = walls;
    this.goals = goals;
    this.boxes = boxes;
    this.player = player;
    const rows = level.split("\n");
    let maxLen = 0;
    for (const r of rows) {
      if (r.length > maxLen) {
        maxLen = r.length;
      }
    }
    this.dims = [maxLen, rows.length];
  }

  step(action: Action): Observation {
    if (this.done) {
      return this.observe(0.0);
    }
    const name = this.actionSpace.name(action);
    this.steps += 1;

    if (name === "restart") {
      this.loadLevel(this.levelIndex);
      return this.observe(0.0);
    }

    const [dx, dy] = DELTA[name];
    const [px, py] = this.player;
    const nx = px + dx;
    const ny = py + dy;
    const target = key(nx, ny);
    if (this.walls.has(target)) {
      return this.observe(0.0); // blocked
    }
    if (this.boxes.has(target)) {
      const beyond = key(nx + dx, ny + dy);
      if (this.walls.has(beyond) || this.boxes.has(beyond)) {
        return this.observe(0.0); // box can't move
      }
      this.boxes.delete(target);
      this.boxes.add(beyond);
      this.player = [nx, ny];
    } else {
      this.player = [nx, ny];
    }

    let reward = 0.0;
    if (setsEqual(this.boxes, this.goals)) {
      // level solved
      this.levelsSolved += 1;
      this.score = 100 * this.levelsSolved;
      reward = 100.0;
      this.unlock(`solve_${Math.min(this.levelsSolved, 5)}`);
      if (this.levelsSolved >= LEVELS.length) {
        this.unlock("solve_all");
        this.done = true;
      } else {
        this.levelIndex += 1;
        this.loadLevel(this.levelIndex);
      }
    }
    return this.observe(reward);
  }

  // ---- introspection ----------------------------------------------------- //

  get boxesOnGoal(): number {
    let n = 0;
    for (const b of this.boxes) {
      if (this.goals.has(b)) {
        n += 1;
      }
    }
    return n;
  }

  legalActions(): string[] {
    return [...ACTIONS]; // all always permitted (restart is always safe)
  }

  render(): string {
    const [w, h] = this.dims;
    const out: string[] = [
      `level ${this.levelIndex + 1}/${LEVELS.length}  solved=${this.levelsSolved}  score=${this.score}`,
    ];
    for (let y = 0; y < h; y++) {
      const line: string[] = [];
      for (let x = 0; x < w; x++) {
        const p = key(x, y);
        if (this.walls.has(p)) {
          line.push("#");
        } else if (x === this.player[0] && y === this.player[1]) {
          line.push(this.goals.has(p) ? "+" : "@");
        } else if (this.boxes.has(p)) {
          line.push(this.goals.has(p) ? "*" : "$");
        } else if (this.goals.has(p)) {
          line.push(".");
        } else {
          line.push(" ");
        }
      }
      out.push(line.join(""));
    }
    return out.join("\n");
  }

  private observe(reward: number): Observation {
    const [w, h] = this.dims;
    return {
      step: this.steps,
      state: {
        level_index: this.levelIndex,
        level_number: this.levelIndex + 1,
        total_levels: LEVELS.length,
        levels_solved: this.levelsSolved,
        width: w,
        height: h,
        player: [this.player[0], this.player[1]],
        walls: sortedCells(this.walls),
        goals: sortedCells(this.goals),
        boxes: sortedCells(this.boxes),
        score: this.score,
      },
      text: this.render(),
      frame: null,
      legal_actions: this.legalActions(),
      score: this.score,
      done: this.done,
      reward: reward,
      info: { levels_solved: this.levelsSolved, boxes_on_goal: this.boxesOnGoal },
    };
  }
}
