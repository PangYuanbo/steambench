/**
 * Connect Four — a deterministic SteamBench *adversarial* env.
 *
 * TypeScript mirror of `harness/steambench_harness/envs/connect4.py`. You play a
 * best-of-6 series against a fixed, rule-based opponent (win-if-you-can,
 * block-if-you-must, else play center-out). The opponent is deterministic and
 * there's no RNG, so a run is fully determined by your drops alone — trivially
 * replay-verifiable. Skill (lookahead) translates straight into wins.
 */

import { ActionSpace, Env } from "./base";
import type { AchievementSpec, Action, Observation } from "./types";

const COLS = 7;
const ROWS = 6;
const GAMES = 6; // best-of series
const CENTER_ORDER = [3, 2, 4, 1, 5, 0, 6]; // opponent's tie-break preference

type Board = number[][];

/** Lowest empty row in a column, or null if full. */
function dropRow(board: Board, col: number): number | null {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][col] === 0) {
      return r;
    }
  }
  return null;
}

function wins(board: Board, who: number): boolean {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] !== who) {
        continue;
      }
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
        [1, 1],
        [1, -1],
      ]) {
        let rr = r;
        let cc = c;
        let n = 0;
        while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === who) {
          n += 1;
          if (n === 4) {
            return true;
          }
          rr += dr;
          cc += dc;
        }
      }
    }
  }
  return false;
}

function legal(board: Board): number[] {
  const out: number[] = [];
  for (let c = 0; c < COLS; c++) {
    if (board[0][c] === 0) {
      out.push(c);
    }
  }
  return out;
}

/** First legal col (in 0..COLS order) that makes `who` win, else null. */
function winningMove(board: Board, who: number): number | null {
  for (const c of legal(board)) {
    const r = dropRow(board, c);
    if (r === null) {
      continue;
    }
    board[r][c] = who;
    const win = wins(board, who);
    board[r][c] = 0;
    if (win) {
      return c;
    }
  }
  return null;
}

function emptyBoard(): Board {
  const board: Board = [];
  for (let r = 0; r < ROWS; r++) {
    board.push(new Array<number>(COLS).fill(0));
  }
  return board;
}

export class Connect4 extends Env {
  static env_id = "arcade/connect4";
  static appid = 9000008;
  static displayName = "Connect Four";
  static description =
    "Play a best-of-6 series of Connect Four against a fixed rule-based " +
    "opponent. Drop discs to make four in a row; out-think the bot to win.";
  static verify_mode = "replay" as const;
  static action_space = new ActionSpace(
    Array.from({ length: COLS }, (_, c) => String(c)),
  );
  static achievements: AchievementSpec[] = [
    { id: "win_1", name: "On the Board", description: "Win a game vs the bot.", rarity_hint: 0.7 },
    { id: "win_2", name: "Got Its Number", description: "Win 2 games.", rarity_hint: 0.45 },
    { id: "win_3", name: "Majority", description: "Win 3 games.", rarity_hint: 0.28 },
    { id: "win_5", name: "Dominant", description: "Win 5 games.", rarity_hint: 0.1 },
    { id: "sweep", name: "Flawless", description: `Win all ${GAMES} — losing none.`, rarity_hint: 0.04 },
  ];

  board: Board;
  gameIndex: number;
  wins: number;
  losses: number;
  draws: number;

  constructor() {
    super();
    this.board = emptyBoard();
    this.gameIndex = 0;
    this.wins = 0;
    this.losses = 0;
    this.draws = 0;
  }

  // ---- lifecycle --------------------------------------------------------- //

  reset(seed = 0): Observation {
    this.begin(seed); // seed unused (no RNG) but keeps the contract
    this.gameIndex = 0;
    this.wins = 0;
    this.losses = 0;
    this.draws = 0;
    this.newGame();
    return this.observe(0.0);
  }

  private newGame(): void {
    this.board = emptyBoard();
    // Alternate who moves first across the series; opponent-first games open
    // with the opponent's deterministic move.
    if (this.gameIndex % 2 === 1) {
      this.opponentMove();
    }
  }

  private opponentMove(): void {
    const win = winningMove(this.board, 2);
    const block = winningMove(this.board, 1);
    let col: number;
    if (win !== null) {
      col = win;
    } else if (block !== null) {
      col = block;
    } else {
      const lg = legal(this.board);
      const centered = CENTER_ORDER.find((c) => lg.includes(c));
      col = centered !== undefined ? centered : lg.length > 0 ? lg[0] : 0;
    }
    const r = dropRow(this.board, col);
    if (r !== null) {
      this.board[r][col] = 2;
    }
  }

  private endGame(result: string): number {
    if (result === "win") {
      this.wins += 1;
    } else if (result === "loss") {
      this.losses += 1;
    } else {
      this.draws += 1;
    }
    this.score = this.wins;
    const reward = result === "win" ? 1.0 : result === "loss" ? -1.0 : 0.0;
    this.checkAchievements();
    this.gameIndex += 1;
    if (this.gameIndex >= GAMES) {
      this.done = true;
    } else {
      this.newGame();
    }
    return reward;
  }

  step(action: Action): Observation {
    if (this.done) {
      return this.observe(0.0);
    }
    const col = parseInt(this.actionSpace.name(action), 10);
    this.steps += 1;
    const r = dropRow(this.board, col);
    if (r === null) {
      return this.observe(0.0); // illegal (full column) — no-op
    }
    this.board[r][col] = 1;
    if (wins(this.board, 1)) {
      return this.observe(this.endGame("win"));
    }
    if (legal(this.board).length === 0) {
      return this.observe(this.endGame("draw"));
    }
    // opponent replies
    this.opponentMove();
    if (wins(this.board, 2)) {
      return this.observe(this.endGame("loss"));
    }
    if (legal(this.board).length === 0) {
      return this.observe(this.endGame("draw"));
    }
    return this.observe(0.0);
  }

  private checkAchievements(): void {
    for (const [n, aid] of [
      [1, "win_1"],
      [2, "win_2"],
      [3, "win_3"],
      [5, "win_5"],
    ] as Array<[number, string]>) {
      if (this.wins >= n) {
        this.unlock(aid);
      }
    }
    if (this.wins >= GAMES && this.losses === 0) {
      this.unlock("sweep");
    }
  }

  // ---- introspection ----------------------------------------------------- //

  legalActions(): string[] {
    return legal(this.board).map((c) => String(c));
  }

  render(): string {
    const sym: Record<number, string> = { 0: ".", 1: "X", 2: "O" };
    const head = `game ${this.gameIndex + 1}/${GAMES}  W${this.wins}-L${this.losses}-D${this.draws}`;
    const rows = this.board.map((row) => row.map((v) => sym[v]).join(""));
    return head + "\n" + rows.join("\n");
  }

  private observe(reward: number): Observation {
    return {
      step: this.steps,
      state: {
        board: this.board.map((row) => row.slice()),
        cols: COLS,
        rows: ROWS,
        game: this.gameIndex + 1,
        games: GAMES,
        wins: this.wins,
        losses: this.losses,
        draws: this.draws,
        you: 1,
        opponent: 2,
        score: this.score,
      },
      text: this.render(),
      frame: null,
      legal_actions: this.legalActions(),
      score: this.score,
      done: this.done,
      reward: reward,
      info: { wins: this.wins, losses: this.losses },
    };
  }
}
