/**
 * Tetris — a deterministic SteamBench arcade env (the score/ranking genre).
 *
 * TypeScript mirror of `harness/steambench_harness/envs/tetris.py`. Stack
 * tetrominoes, clear lines, chase a score. Deterministic given `(seed, actions)`:
 * pieces come from a 7-bag shuffled with the portable Mulberry32 PRNG, and
 * rotation uses fixed tables (no wall kicks), so this port replays runs
 * identically to the Python original.
 *
 * Gravity model: every move except soft/hard-drop is followed by a one-row
 * fall, giving an agent ~20 ticks to position each piece before it locks.
 */

import { ActionSpace, Env } from "./base";
import type { AchievementSpec, Action, Observation } from "./types";

export const W = 10;
export const H = 20;
const ACTIONS = ["left", "right", "rotate", "down", "drop"] as const;
const LINE_SCORE: Record<number, number> = { 0: 0, 1: 100, 2: 300, 3: 500, 4: 800 };

type Cell = [number, number];

// Each piece: 4 rotation states, each a list of 4 (x, y) minos in a 4-wide box.
// COPIED VERBATIM from the Python `PIECES` table.
export const PIECES: Record<string, Cell[][]> = {
  I: [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[1, 0], [1, 1], [1, 2], [1, 3]],
  ],
  O: (() => {
    const o: Cell[] = [[1, 0], [2, 0], [1, 1], [2, 1]];
    return [o, o, o, o];
  })(),
  T: [
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [1, 2]],
  ],
  S: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[1, 1], [2, 1], [0, 2], [1, 2]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
  ],
  Z: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[2, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 0], [0, 1], [1, 1], [0, 2]],
  ],
  J: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [0, 2], [1, 2]],
  ],
  L: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
  ],
};
// bag index -> piece (COPIED VERBATIM from Python `ORDER`).
export const ORDER = ["I", "O", "T", "S", "Z", "J", "L"] as const;

export class Tetris extends Env {
  static env_id = "arcade/tetris";
  static appid = 9000004;
  static displayName = "Tetris";
  static description =
    "Stack falling tetrominoes, clear lines, chase a high score. Move/rotate " +
    "with ~20 ticks per piece before gravity locks it; hard-drop to commit.";
  static verify_mode = "replay" as const;
  static action_space = new ActionSpace([...ACTIONS]);
  static achievements: AchievementSpec[] = [
    { id: "lines_1", name: "First Clear", description: "Clear your first line.", rarity_hint: 0.9 },
    { id: "lines_10", name: "Warmed Up", description: "Clear 10 lines.", rarity_hint: 0.6 },
    { id: "lines_25", name: "Stacking Up", description: "Clear 25 lines.", rarity_hint: 0.32 },
    { id: "lines_50", name: "Linesmith", description: "Clear 50 lines.", rarity_hint: 0.14 },
    { id: "lines_100", name: "Century", description: "Clear 100 lines.", rarity_hint: 0.04 },
    { id: "tetris", name: "TETRIS!", description: "Clear 4 lines at once.", rarity_hint: 0.16 },
    { id: "score_5k", name: "High Roller", description: "Score 5,000 points.", rarity_hint: 0.22 },
    { id: "score_20k", name: "Point Hoarder", description: "Score 20,000 points.", rarity_hint: 0.05 },
  ];

  board: number[][];
  bag: number[];
  lines: number;
  piece: number;
  rot: number;
  px: number;
  py: number;

  constructor() {
    super();
    this.board = Tetris.emptyBoard();
    this.bag = [];
    this.lines = 0;
    this.piece = 0;
    this.rot = 0;
    this.px = 0;
    this.py = 0;
  }

  private static emptyBoard(): number[][] {
    const b: number[][] = [];
    for (let r = 0; r < H; r++) {
      b.push(new Array<number>(W).fill(0));
    }
    return b;
  }

  // ---- lifecycle --------------------------------------------------------- //

  reset(seed = 0): Observation {
    this.begin(seed);
    this.board = Tetris.emptyBoard();
    this.bag = [];
    this.lines = 0;
    this.spawn();
    return this.observe(0.0);
  }

  private refill(): void {
    const bag = [0, 1, 2, 3, 4, 5, 6];
    // Fisher-Yates with the portable PRNG: for i in range(6, 0, -1).
    for (let i = 6; i > 0; i--) {
      const j = this.rng.randrange(i + 1);
      const tmp = bag[i];
      bag[i] = bag[j];
      bag[j] = tmp;
    }
    this.bag = bag;
  }

  private nextPiece(): number {
    if (this.bag.length === 0) {
      this.refill();
    }
    // bag.pop(0): shift from the front.
    return this.bag.shift() as number;
  }

  private spawn(): void {
    this.piece = this.nextPiece();
    this.rot = 0;
    this.px = 3;
    this.py = 0;
    if (this.collides(this.px, this.py, this.rot)) {
      this.done = true; // top-out
    }
  }

  // ---- mechanics --------------------------------------------------------- //

  private cells(x: number, y: number, rot: number): Cell[] {
    const name = ORDER[this.piece];
    return PIECES[name][rot].map(([mx, my]) => [x + mx, y + my] as Cell);
  }

  private collides(x: number, y: number, rot: number): boolean {
    for (const [cx, cy] of this.cells(x, y, rot)) {
      if (cx < 0 || cx >= W || cy >= H) {
        return true;
      }
      if (cy >= 0 && this.board[cy][cx]) {
        return true;
      }
    }
    return false;
  }

  private tryMove(dx: number, dy: number): boolean {
    if (this.collides(this.px + dx, this.py + dy, this.rot)) {
      return false;
    }
    this.px += dx;
    this.py += dy;
    return true;
  }

  private tryRotate(): boolean {
    const nr = (this.rot + 1) % 4;
    if (this.collides(this.px, this.py, nr)) {
      return false;
    }
    this.rot = nr;
    return true;
  }

  private lockAndSpawn(): number {
    const pid = this.piece + 1;
    for (const [cx, cy] of this.cells(this.px, this.py, this.rot)) {
      if (cy >= 0 && cy < H && cx >= 0 && cx < W) {
        this.board[cy][cx] = pid;
      }
    }
    const cleared = this.clearLines();
    const gained = LINE_SCORE[cleared] ?? 0; // defensive: cleared is always 0..4
    this.score += gained;
    this.lines += cleared;
    if (cleared === 4) {
      this.unlock("tetris");
    }
    this.spawn();
    return gained;
  }

  private clearLines(): number {
    // keep rows that are NOT all-filled.
    const kept = this.board.filter((row) => !row.every((c) => c));
    const cleared = H - kept.length;
    if (cleared) {
      const top: number[][] = [];
      for (let r = 0; r < cleared; r++) {
        top.push(new Array<number>(W).fill(0));
      }
      this.board = top.concat(kept);
    }
    return cleared;
  }

  step(action: Action): Observation {
    if (this.done) {
      return this.observe(0.0);
    }
    const name = this.actionSpace.name(action);
    this.steps += 1;
    let reward = 0.0;

    if (name === "left") {
      this.tryMove(-1, 0);
    } else if (name === "right") {
      this.tryMove(1, 0);
    } else if (name === "rotate") {
      this.tryRotate();
    } else if (name === "down") {
      if (!this.tryMove(0, 1)) {
        reward = this.lockAndSpawn();
      }
      this.checkAchievements();
      return this.observe(reward);
    } else if (name === "drop") {
      while (this.tryMove(0, 1)) {
        // fall to the bottom
      }
      reward = this.lockAndSpawn();
      this.checkAchievements();
      return this.observe(reward);
    }

    // gravity after a horizontal/rotate move
    if (!this.tryMove(0, 1)) {
      reward = this.lockAndSpawn();
    }
    this.checkAchievements();
    return this.observe(reward);
  }

  private checkAchievements(): void {
    const ladder: [number, string][] = [
      [1, "lines_1"],
      [10, "lines_10"],
      [25, "lines_25"],
      [50, "lines_50"],
      [100, "lines_100"],
    ];
    for (const [n, aid] of ladder) {
      if (this.lines >= n) {
        this.unlock(aid);
      }
    }
    if (this.score >= 5000) {
      this.unlock("score_5k");
    }
    if (this.score >= 20000) {
      this.unlock("score_20k");
    }
  }

  // ---- rendering --------------------------------------------------------- //

  legalActions(): string[] {
    return [...ACTIONS];
  }

  private gridWithPiece(): number[][] {
    const grid = this.board.map((row) => [...row]);
    if (!this.done) {
      for (const [cx, cy] of this.cells(this.px, this.py, this.rot)) {
        if (cy >= 0 && cy < H && cx >= 0 && cx < W) {
          grid[cy][cx] = this.piece + 1;
        }
      }
    }
    return grid;
  }

  render(): string {
    const grid = this.gridWithPiece();
    const head = `score=${this.score} lines=${this.lines} piece=${ORDER[this.piece]}`;
    const rows = grid.map((row) => row.map((c) => (c ? "#" : ".")).join(""));
    return head + "\n" + rows.join("\n");
  }

  private observe(reward: number): Observation {
    return {
      step: this.steps,
      state: {
        board: this.board.map((row) => [...row]),
        grid: this.gridWithPiece(),
        piece: ORDER[this.piece],
        piece_id: this.piece + 1,
        rot: this.rot,
        px: this.px,
        py: this.py,
        score: this.score,
        lines: this.lines,
        width: W,
        height: H,
        next: this.bag.length ? ORDER[this.bag[0]] : null,
      },
      text: this.render(),
      frame: null,
      legal_actions: this.legalActions(),
      score: this.score,
      done: this.done,
      reward: reward,
      info: { lines: this.lines },
    };
  }
}
