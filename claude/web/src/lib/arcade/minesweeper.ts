/**
 * Minesweeper — a deterministic SteamBench arcade *deduction* env.
 *
 * TypeScript mirror of `harness/steambench_harness/envs/minesweeper.py`. A
 * different shape of challenge: a large, variable action space (reveal any of
 * the R*C cells) and pure logical deduction rather than reflex/search. First
 * click is always safe — mines are placed (deterministically, from the portable
 * Mulberry32 PRNG) *after* the opening reveal, excluding that cell and its
 * neighbours — so a run is fully determined by `(seed, first-action, ...)` and
 * replays identically.
 *
 * CRITICAL: the mine-placement PRNG draw order must match Python EXACTLY (the
 * row-major candidate ordering + rejection-sampling loop), or recorded
 * `(seed, actions)` traces won't replay. See `placeMines` below.
 */

import { ActionSpace, Env } from "./base";
import type { AchievementSpec, Action, Observation } from "./types";

const R = 9;
const C = 9;
const MINES = 10;
// The 8 neighbour offsets, in THIS order (mirrors Python `_NEIGHBORS`).
const NEIGHBORS: Array<[number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

// Action space = reveal any cell, named "r,c" (row-major, 81 names).
const ACTION_NAMES: string[] = (() => {
  const names: string[] = [];
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      names.push(`${r},${c}`);
    }
  }
  return names;
})();

/** Stable key for a cell, used for O(1) membership (mirrors Python tuples in a set). */
function cellKey(r: number, c: number): string {
  return `${r},${c}`;
}

export class Minesweeper extends Env {
  static env_id = "arcade/minesweeper";
  static appid = 9000005;
  static displayName = "Minesweeper";
  static description =
    `Clear a ${R}x${C} grid with ${MINES} hidden mines by deduction. Numbers show ` +
    "adjacent mine counts; the first reveal is always safe. Reveal every safe " +
    "cell to win — hit a mine and it's over.";
  static verify_mode = "replay" as const;
  static action_space = new ActionSpace([...ACTION_NAMES]);
  static achievements: AchievementSpec[] = [
    { id: "reveal_1", name: "First Dig", description: "Reveal your first cell.", rarity_hint: 0.95 },
    { id: "reveal_10", name: "Digging In", description: "Reveal 10 safe cells.", rarity_hint: 0.7 },
    { id: "reveal_30", name: "Clearing House", description: "Reveal 30 safe cells.", rarity_hint: 0.4 },
    { id: "reveal_50", name: "Almost There", description: "Reveal 50 safe cells.", rarity_hint: 0.16 },
    { id: "win", name: "Minesweeper", description: `Reveal all ${R * C - MINES} safe cells.`, rarity_hint: 0.06 },
  ];

  /** Set of mine cells, keyed by `"r,c"`. */
  mines: Set<string>;
  counts: number[][];
  revealed: boolean[][];
  placed: boolean;
  /** [r, c] of the exploded mine, or null. */
  exploded: [number, number] | null;

  constructor() {
    super();
    this.mines = new Set<string>();
    this.counts = Minesweeper.zeroGrid();
    this.revealed = Minesweeper.falseGrid();
    this.placed = false;
    this.exploded = null;
  }

  private static zeroGrid(): number[][] {
    const g: number[][] = [];
    for (let r = 0; r < R; r++) {
      g.push(new Array<number>(C).fill(0));
    }
    return g;
  }

  private static falseGrid(): boolean[][] {
    const g: boolean[][] = [];
    for (let r = 0; r < R; r++) {
      g.push(new Array<boolean>(C).fill(false));
    }
    return g;
  }

  // ---- lifecycle --------------------------------------------------------- //

  reset(seed = 0): Observation {
    this.begin(seed);
    this.mines = new Set<string>();
    this.counts = Minesweeper.zeroGrid();
    this.revealed = Minesweeper.falseGrid();
    this.placed = false;
    this.exploded = null;
    return this.observe(0.0);
  }

  private placeMines(safeR: number, safeC: number): void {
    // 1. excluded = safe cell + its 8 neighbours (off-board ones just won't
    //    appear among candidates).
    const excluded = new Set<string>();
    excluded.add(cellKey(safeR, safeC));
    for (const [dr, dc] of NEIGHBORS) {
      excluded.add(cellKey(safeR + dr, safeC + dc));
    }
    // 2. candidates in ROW-MAJOR order.
    const candidates: Array<[number, number]> = [];
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        if (!excluded.has(cellKey(r, c))) {
          candidates.push([r, c]);
        }
      }
    }
    // 3. Rejection sampling: a duplicate draw is silently re-drawn on the next
    //    iteration, so the NUMBER of randrange calls varies but is
    //    deterministic. The draw order + rejection must match Python EXACTLY.
    const mines = new Set<string>();
    while (mines.size < MINES) {
      const [r, c] = candidates[this.rng.randrange(candidates.length)];
      mines.add(cellKey(r, c));
    }
    this.mines = mines;
    // 4. counts[r][c] = number of NEIGHBORS that are mines (for non-mine cells).
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        if (mines.has(cellKey(r, c))) {
          continue;
        }
        let n = 0;
        for (const [dr, dc] of NEIGHBORS) {
          if (mines.has(cellKey(r + dr, c + dc))) {
            n += 1;
          }
        }
        this.counts[r][c] = n;
      }
    }
    this.placed = true;
  }

  private reveal(r: number, c: number): void {
    // Flood-fill reveal: opening a 0 cell cascades to its neighbours. Uses a
    // stack popped from the END (LIFO), mirroring Python `stack.pop()`.
    const stack: Array<[number, number]> = [[r, c]];
    while (stack.length > 0) {
      const [cr, cc] = stack.pop() as [number, number];
      if (!(cr >= 0 && cr < R && cc >= 0 && cc < C) || this.revealed[cr][cc]) {
        continue;
      }
      if (this.mines.has(cellKey(cr, cc))) {
        continue;
      }
      this.revealed[cr][cc] = true;
      if (this.counts[cr][cc] === 0) {
        for (const [dr, dc] of NEIGHBORS) {
          stack.push([cr + dr, cc + dc]);
        }
      }
    }
  }

  get revealedCount(): number {
    let n = 0;
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        if (this.revealed[r][c]) {
          n += 1;
        }
      }
    }
    return n;
  }

  step(action: Action): Observation {
    if (this.done) {
      return this.observe(0.0);
    }
    const name = this.actionSpace.name(action);
    const [r, c] = name.split(",").map((x) => parseInt(x, 10));
    this.steps += 1;

    if (this.revealed[r][c]) {
      return this.observe(0.0); // no-op on an already-open cell
    }

    if (!this.placed) {
      this.placeMines(r, c); // first click is always safe
    }

    const before = this.revealedCount;
    if (this.mines.has(cellKey(r, c))) {
      this.exploded = [r, c];
      this.done = true; // boom
      return this.observe(0.0);
    }

    this.reveal(r, c);
    this.score = this.revealedCount;
    const gained = this.revealedCount - before;
    this.checkAchievements();
    if (this.revealedCount >= R * C - MINES) {
      // all safe cells -> win
      this.unlock("win");
      this.done = true;
    }
    return this.observe(gained);
  }

  private checkAchievements(): void {
    const n = this.revealedCount;
    const ladder: Array<[number, string]> = [
      [1, "reveal_1"],
      [10, "reveal_10"],
      [30, "reveal_30"],
      [50, "reveal_50"],
    ];
    for (const [k, aid] of ladder) {
      if (n >= k) {
        this.unlock(aid);
      }
    }
  }

  // ---- rendering --------------------------------------------------------- //

  legalActions(): string[] {
    const out: string[] = [];
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        if (!this.revealed[r][c]) {
          out.push(`${r},${c}`);
        }
      }
    }
    return out;
  }

  private cellChar(r: number, c: number): string {
    if (this.exploded && this.exploded[0] === r && this.exploded[1] === c) {
      return "*";
    }
    if (!this.revealed[r][c]) {
      return "#";
    }
    const n = this.counts[r][c];
    return n ? String(n) : ".";
  }

  render(): string {
    const head =
      `revealed=${this.revealedCount}/${R * C - MINES} mines=${MINES} ` +
      (this.exploded ? "BOOM" : "ok");
    const rows: string[] = [];
    for (let r = 0; r < R; r++) {
      let row = "";
      for (let c = 0; c < C; c++) {
        row += this.cellChar(r, c);
      }
      rows.push(row);
    }
    return head + "\n" + rows.join("\n");
  }

  private view(): number[][] {
    // -1 hidden, -2 exploded mine, 0..8 revealed count
    const grid: number[][] = [];
    for (let r = 0; r < R; r++) {
      const row: number[] = [];
      for (let c = 0; c < C; c++) {
        if (this.exploded && this.exploded[0] === r && this.exploded[1] === c) {
          row.push(-2);
        } else if (!this.revealed[r][c]) {
          row.push(-1);
        } else {
          row.push(this.counts[r][c]);
        }
      }
      grid.push(row);
    }
    return grid;
  }

  private observe(reward: number): Observation {
    return {
      step: this.steps,
      state: {
        view: this.view(),
        rows: R,
        cols: C,
        mines: MINES,
        revealed: this.revealedCount,
        safe_total: R * C - MINES,
        exploded: this.exploded ? [this.exploded[0], this.exploded[1]] : null,
        score: this.score,
      },
      text: this.render(),
      frame: null,
      legal_actions: this.legalActions(),
      score: this.score,
      done: this.done,
      reward: reward,
      info: { revealed: this.revealedCount, exploded: this.exploded !== null },
    };
  }
}
