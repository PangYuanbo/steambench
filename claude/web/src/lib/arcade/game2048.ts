/**
 * 2048 — a deterministic SteamBench arcade env.
 *
 * TypeScript mirror of `harness/steambench_harness/envs/game2048.py`. Fully
 * deterministic given `(seed, actions)`: all tile spawns come from `this.rng`,
 * so the server can replay-verify any run.
 */

import { ActionSpace, Env } from "./base";
import type { AchievementSpec, Action, Observation } from "./types";

const SIZE = 4;
const DIRS = ["up", "down", "left", "right"] as const;

/** Slide+merge one row to the left. Returns [newRow, gained, changed]. */
export function slideLeft(row: number[]): [number[], number, boolean] {
  const nonzero = row.filter((v) => v);
  const merged: number[] = [];
  let gained = 0;
  let i = 0;
  while (i < nonzero.length) {
    if (i + 1 < nonzero.length && nonzero[i] === nonzero[i + 1]) {
      const v = nonzero[i] * 2;
      merged.push(v);
      gained += v;
      i += 2;
    } else {
      merged.push(nonzero[i]);
      i += 1;
    }
  }
  while (merged.length < row.length) {
    merged.push(0);
  }
  const changed = !arraysEqual(merged, row);
  return [merged, gained, changed];
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Mirror of Python `str(...).center(width)` (extra pad to the right). */
function center(s: string, width: number): string {
  if (s.length >= width) return s;
  const total = width - s.length;
  const left = Math.floor(total / 2);
  const right = total - left;
  return " ".repeat(left) + s + " ".repeat(right);
}

export class Game2048 extends Env {
  static env_id = "arcade/2048";
  static appid = 9000001;
  static displayName = "2048";
  static description =
    "Slide numbered tiles on a 4x4 grid; equal tiles merge and double. " +
    "Reach the highest tile you can before the board jams.";
  static verify_mode = "replay" as const;
  static action_space = new ActionSpace([...DIRS]);
  static achievements: AchievementSpec[] = [
    { id: "tile_64", name: "Getting Started", description: "Reach the 64 tile.", rarity_hint: 0.8 },
    { id: "tile_128", name: "Warmed Up", description: "Reach the 128 tile.", rarity_hint: 0.62 },
    { id: "tile_256", name: "Climbing", description: "Reach the 256 tile.", rarity_hint: 0.4 },
    { id: "tile_512", name: "Halfway There", description: "Reach the 512 tile.", rarity_hint: 0.24 },
    { id: "tile_1024", name: "Big Numbers", description: "Reach the 1024 tile.", rarity_hint: 0.11 },
    { id: "tile_2048", name: "2048!", description: "Reach the fabled 2048 tile.", rarity_hint: 0.045 },
    { id: "tile_4096", name: "Beyond", description: "Reach the 4096 tile.", rarity_hint: 0.009 },
    { id: "tile_8192", name: "Grandmaster", description: "Reach the 8192 tile.", rarity_hint: 0.0009 },
    { id: "score_10k", name: "High Roller", description: "Score 10,000 points.", rarity_hint: 0.16 },
    { id: "score_20k", name: "Point Hoarder", description: "Score 20,000 points.", rarity_hint: 0.05 },
  ];

  board: number[][];

  constructor() {
    super();
    this.board = Game2048.emptyBoard();
  }

  private static emptyBoard(): number[][] {
    const b: number[][] = [];
    for (let r = 0; r < SIZE; r++) {
      b.push(new Array<number>(SIZE).fill(0));
    }
    return b;
  }

  // ---- lifecycle --------------------------------------------------------- //

  reset(seed = 0): Observation {
    this.begin(seed);
    this.board = Game2048.emptyBoard();
    this.spawn();
    this.spawn();
    return this.observe(0.0);
  }

  step(action: Action): Observation {
    if (this.done) {
      return this.observe(0.0);
    }
    const name = this.actionSpace.name(action);
    const beforeScore = this.score;
    const moved = this.move(name);
    if (moved) {
      this.spawn();
    }
    this.steps += 1;
    this.checkAchievements();
    if (!this.hasMoves()) {
      this.done = true;
    }
    return this.observe(this.score - beforeScore);
  }

  // ---- mechanics --------------------------------------------------------- //

  private move(direction: string): boolean {
    const b = this.board;
    let changed = false;
    let gained = 0;
    if (direction === "left") {
      const [next, g, ch] = this.applyRows(b);
      this.board = next;
      gained = g;
      changed = ch;
    } else if (direction === "right") {
      const rows = b.map((r) => [...r].reverse());
      const [next, g, ch] = this.applyRows(rows);
      this.board = next.map((r) => [...r].reverse());
      gained = g;
      changed = ch;
    } else if (direction === "up") {
      const rows = Game2048.transpose(b);
      const [next, g, ch] = this.applyRows(rows);
      this.board = Game2048.transpose(next);
      gained = g;
      changed = ch;
    } else if (direction === "down") {
      const rows = Game2048.transpose(b).map((r) => [...r].reverse());
      const [next, g, ch] = this.applyRows(rows);
      this.board = Game2048.transpose(next.map((r) => [...r].reverse()));
      gained = g;
      changed = ch;
    } else {
      return false;
    }
    this.score += gained;
    return changed;
  }

  private applyRows(rows: number[][]): [number[][], number, boolean] {
    const out: number[][] = [];
    let totalGained = 0;
    let changed = false;
    for (const r of rows) {
      const [nr, gained, ch] = slideLeft(r);
      out.push(nr);
      totalGained += gained;
      changed = changed || ch;
    }
    return [out, totalGained, changed];
  }

  private static transpose(b: number[][]): number[][] {
    const out: number[][] = [];
    for (let c = 0; c < b[0].length; c++) {
      const col: number[] = [];
      for (let r = 0; r < b.length; r++) {
        col.push(b[r][c]);
      }
      out.push(col);
    }
    return out;
  }

  private emptyCells(): [number, number][] {
    const cells: [number, number][] = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (this.board[r][c] === 0) {
          cells.push([r, c]);
        }
      }
    }
    return cells;
  }

  private spawn(): void {
    const empties = this.emptyCells();
    if (empties.length === 0) {
      return;
    }
    // CRITICAL ORDER: pick the cell first, THEN draw the value.
    const [r, c] = this.rng.choice(empties);
    this.board[r][c] = this.rng.random() < 0.1 ? 4 : 2;
  }

  private hasMoves(): boolean {
    if (this.emptyCells().length > 0) {
      return true;
    }
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = this.board[r][c];
        if (c + 1 < SIZE && this.board[r][c + 1] === v) {
          return true;
        }
        if (r + 1 < SIZE && this.board[r + 1][c] === v) {
          return true;
        }
      }
    }
    return false;
  }

  legalActions(): string[] {
    const legal: string[] = [];
    const snapshot = this.board.map((row) => [...row]);
    const savedScore = this.score;
    for (const d of DIRS) {
      if (this.move(d)) {
        legal.push(d);
      }
      this.board = snapshot.map((row) => [...row]);
      this.score = savedScore;
    }
    return legal;
  }

  get maxTile(): number {
    let m = 0;
    for (const row of this.board) {
      for (const v of row) {
        if (v > m) m = v;
      }
    }
    return m;
  }

  private checkAchievements(): void {
    const mt = this.maxTile;
    const ladder: [number, string][] = [
      [64, "tile_64"],
      [128, "tile_128"],
      [256, "tile_256"],
      [512, "tile_512"],
      [1024, "tile_1024"],
      [2048, "tile_2048"],
      [4096, "tile_4096"],
      [8192, "tile_8192"],
    ];
    for (const [n, aid] of ladder) {
      if (mt >= n) {
        this.unlock(aid);
      }
    }
    if (this.score >= 10000) {
      this.unlock("score_10k");
    }
    if (this.score >= 20000) {
      this.unlock("score_20k");
    }
  }

  // ---- rendering --------------------------------------------------------- //

  render(): string {
    const width = Math.max(5, String(this.maxTile).length + 1);
    const lines: string[] = [];
    for (const row of this.board) {
      lines.push(row.map((v) => center(v ? String(v) : ".", width)).join(""));
    }
    return `score=${this.score} max=${this.maxTile}\n` + lines.join("\n");
  }

  private observe(reward: number): Observation {
    const legal = this.legalActions();
    return {
      step: this.steps,
      state: {
        board: this.board.map((row) => [...row]),
        score: this.score,
        max_tile: this.maxTile,
        moves: this.steps,
      },
      text: this.render(),
      frame: null,
      legal_actions: legal,
      score: this.score,
      done: this.done,
      reward: reward,
      info: { max_tile: this.maxTile, newly: [] as string[] },
    };
  }
}
