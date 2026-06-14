import { make, ENV_IDS } from "@/lib/arcade/registry";
import { PIECES, W as TW, H as TH } from "@/lib/arcade/tetris";
import type { Observation } from "@/lib/arcade/types";
import { getGameByEnvId, getTasksForApp } from "@/lib/data";
import { scoreRun } from "@/lib/scoring";
import { addRun } from "@/lib/store";
import type { RunRow } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Cap concurrent live streams so a public endpoint can't run up an LLM bill.
const g = globalThis as unknown as { __sb_live?: number };
const MAX_CONCURRENT = 3;

const SYSTEM: Record<string, string> = {
  "arcade/2048":
    "You are an expert 2048 player. The board is 4x4; '.' is empty. A move slides ALL tiles that way and merges equal adjacent tiles. Keep your largest tile pinned in a corner and build a monotonic gradient. Choose the single best legal move.",
  "arcade/snake":
    "You are an expert Snake player. '@'=head, 'o'=body, '*'=food, '.'=empty. You move every tick. Plan a safe path to the food that doesn't trap you against a wall or your tail. Choose the single best legal move.",
};

const DELTA: Record<string, [number, number]> = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Strong heuristic fallback (used when the LLM is unavailable) ---------- //
// Snake: BFS to food with a flood-fill survival fallback (mirrors the Python
// reference agent — regularly reaches length 30-40). 2048: corner-priority over
// the legal (board-changing) moves.

function bfsPath(
  start: number[], goal: number[], blocked: Set<string>, w: number, h: number
): number[][] | null {
  const key = (x: number, y: number) => `${x},${y}`;
  const q: number[][] = [start];
  const prev = new Map<string, number[] | null>([[key(start[0], start[1]), null]]);
  while (q.length) {
    const cur = q.shift()!;
    if (cur[0] === goal[0] && cur[1] === goal[1]) {
      const path: number[][] = [];
      let node: number[] | null = cur;
      while (node && prev.get(key(node[0], node[1]))) {
        path.push(node);
        node = prev.get(key(node[0], node[1]))!;
      }
      return path.reverse();
    }
    for (const [dx, dy] of Object.values(DELTA)) {
      const nx = cur[0] + dx, ny = cur[1] + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const k = key(nx, ny);
      if (blocked.has(k) || prev.has(k)) continue;
      prev.set(k, cur);
      q.push([nx, ny]);
    }
  }
  return null;
}

function flood(start: number[], obstacles: Set<string>, w: number, h: number): number {
  const key = (x: number, y: number) => `${x},${y}`;
  if (obstacles.has(key(start[0], start[1]))) return 0;
  const seen = new Set([key(start[0], start[1])]);
  const q = [start];
  while (q.length) {
    const cur = q.shift()!;
    for (const [dx, dy] of Object.values(DELTA)) {
      const nx = cur[0] + dx, ny = cur[1] + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const k = key(nx, ny);
      if (obstacles.has(k) || seen.has(k)) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  return seen.size;
}

// BFS Sokoban solver (mirrors the Python reference agent). Replans from the
// current state each tick — the levels are tiny so this is instant — and emits
// the first move of the optimal push sequence.
function sokobanSolve(state: Record<string, unknown>): { move: string; reasoning: string } {
  const walls = new Set(((state.walls as number[][]) ?? []).map((p) => `${p[0]},${p[1]}`));
  const goals = new Set(((state.goals as number[][]) ?? []).map((p) => `${p[0]},${p[1]}`));
  const boxes0 = ((state.boxes as number[][]) ?? []).map((p): [number, number] => [p[0], p[1]]);
  const player0 = (state.player as number[]) ?? [0, 0];
  const lvl = (state.level_number as number) ?? 1;

  const boxKey = (bs: [number, number][]) => bs.map((b) => `${b[0]},${b[1]}`).sort().join("|");
  const solved = (bs: [number, number][]) => bs.length === goals.size && bs.every((b) => goals.has(`${b[0]},${b[1]}`));
  const deadlocked = (bs: [number, number][]) =>
    bs.some(([x, y]) => {
      if (goals.has(`${x},${y}`)) return false;
      const v = walls.has(`${x},${y - 1}`) || walls.has(`${x},${y + 1}`);
      const h = walls.has(`${x - 1},${y}`) || walls.has(`${x + 1},${y}`);
      return v && h;
    });

  type S = { p: [number, number]; b: [number, number][]; first: string | null; depth: number };
  const start: S = { p: [player0[0], player0[1]], b: boxes0, first: null, depth: 0 };
  if (solved(boxes0)) return { move: "restart", reasoning: "level already solved" };
  const seen = new Set<string>([`${player0[0]},${player0[1]}#${boxKey(boxes0)}`]);
  const q: S[] = [start];
  let nodes = 0;
  while (q.length && nodes < 100_000) {
    const cur = q.shift()!;
    nodes++;
    for (const [name, [dx, dy]] of Object.entries(DELTA)) {
      const nx = cur.p[0] + dx, ny = cur.p[1] + dy;
      const tk = `${nx},${ny}`;
      if (walls.has(tk)) continue;
      let nb = cur.b;
      const bi = cur.b.findIndex((b) => b[0] === nx && b[1] === ny);
      if (bi >= 0) {
        const bx = nx + dx, by = ny + dy;
        if (walls.has(`${bx},${by}`) || cur.b.some((b) => b[0] === bx && b[1] === by)) continue;
        nb = cur.b.map((b, i) => (i === bi ? [bx, by] as [number, number] : b));
        if (deadlocked(nb)) continue;
      }
      const key = `${nx},${ny}#${boxKey(nb)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const first = cur.first ?? name;
      if (solved(nb)) return { move: first, reasoning: `solving level ${lvl} (${cur.depth + 1} moves to go)` };
      q.push({ p: [nx, ny], b: nb, first, depth: cur.depth + 1 });
    }
  }
  return { move: "restart", reasoning: `level ${lvl}: replanning` };
}

function heuristicMove(envId: string, obs: Observation): { move: string; reasoning: string } {
  const legal = obs.legal_actions;
  if (envId.includes("sokoban")) return sokobanSolve(obs.state);
  if (envId.includes("flappy")) {
    const s = obs.state as { bird_y: number; bird_vy: number; next_pipe: { gap: number } | null; height: number };
    const target = s.next_pipe ? s.next_pipe.gap : s.height / 2;
    return { move: s.bird_y + s.bird_vy * 1.5 > target - 1 ? "flap" : "idle", reasoning: `aim for gap ${Math.round(target)}` };
  }
  if (envId.includes("snake")) {
    const s = obs.state as { snake: number[][]; head: number[] | null; food: number[]; width: number; height: number };
    if (s.head) {
      const body = new Set(s.snake.slice(0, -1).map(([x, y]) => `${x},${y}`));
      const path = bfsPath(s.head, s.food, body, s.width, s.height);
      if (path && path.length) {
        const step = path[0];
        const mv = Object.keys(DELTA).find((d) => DELTA[d][0] === step[0] - s.head![0] && DELTA[d][1] === step[1] - s.head![1]);
        if (mv && legal.includes(mv)) return { move: mv, reasoning: `BFS to food — ${path.length} steps` };
      }
      // survival: maximize reachable free space
      let best: string | null = null, bestSpace = -1;
      const obstacles = new Set(s.snake.slice(1).map(([x, y]) => `${x},${y}`));
      for (const mv of legal) {
        const [dx, dy] = DELTA[mv];
        const nx = s.head[0] + dx, ny = s.head[1] + dy;
        if (nx < 0 || nx >= s.width || ny < 0 || ny >= s.height) continue;
        if (obstacles.has(`${nx},${ny}`)) continue;
        const space = flood([nx, ny], obstacles, s.width, s.height);
        if (space > bestSpace) { bestSpace = space; best = mv; }
      }
      if (best) return { move: best, reasoning: `survival — ${bestSpace} cells reachable` };
    }
    return { move: legal[0] ?? "up", reasoning: "trapped" };
  }
  // 2048: legal_actions already excludes no-op moves; corner priority.
  const move = ["down", "left", "right", "up"].find((o) => legal.includes(o)) ?? legal[0];
  return { move, reasoning: "corner strategy" };
}

// Connect Four minimax (alpha-beta, depth 4) — stateless, mirrors the Python agent.
const C4C = 7, C4R = 6, C4ORDER = [3, 2, 4, 1, 5, 0, 6];
function c4Drop(b: number[][], c: number) { for (let r = C4R - 1; r >= 0; r--) if (b[r][c] === 0) return r; return -1; }
function c4Wins(b: number[][], who: number): boolean {
  for (let r = 0; r < C4R; r++) for (let c = 0; c < C4C; c++) {
    if (b[r][c] !== who) continue;
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      let rr = r, cc = c, n = 0;
      while (rr >= 0 && rr < C4R && cc >= 0 && cc < C4C && b[rr][cc] === who) { if (++n === 4) return true; rr += dr; cc += dc; }
    }
  }
  return false;
}
function c4Legal(b: number[][]) { const o: number[] = []; for (let c = 0; c < C4C; c++) if (b[0][c] === 0) o.push(c); return o; }
function c4Eval(b: number[][]): number {
  let s = 0;
  for (let r = 0; r < C4R; r++) for (let c = 0; c < C4C; c++)
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const cells: number[] = [];
      for (let k = 0; k < 4; k++) { const rr = r + dr * k, cc = c + dc * k; if (rr < 0 || rr >= C4R || cc < 0 || cc >= C4C) { cells.length = 0; break; } cells.push(b[rr][cc]); }
      if (cells.length < 4) continue;
      const me = cells.filter((x) => x === 1).length, op = cells.filter((x) => x === 2).length;
      if (me && op) continue;
      s += me === 3 ? 50 : me === 2 ? 10 : me === 1 ? 1 : op === 3 ? -50 : op === 2 ? -10 : op === 1 ? -1 : 0;
    }
  for (let r = 0; r < C4R; r++) s += b[r][3] === 1 ? 4 : b[r][3] === 2 ? -4 : 0;
  return s;
}
function c4mm(b: number[][], depth: number, a: number, bb: number, maxing: boolean): number {
  if (c4Wins(b, 1)) return 1e6 + depth;
  if (c4Wins(b, 2)) return -1e6 - depth;
  const legal = c4Legal(b);
  if (!depth || !legal.length) return c4Eval(b);
  const ord = C4ORDER.filter((x) => legal.includes(x));
  if (maxing) {
    let v = -1e18;
    for (const c of ord) { const r = c4Drop(b, c); b[r][c] = 1; v = Math.max(v, c4mm(b, depth - 1, a, bb, false)); b[r][c] = 0; a = Math.max(a, v); if (a >= bb) break; }
    return v;
  }
  let v = 1e18;
  for (const c of ord) { const r = c4Drop(b, c); b[r][c] = 2; v = Math.min(v, c4mm(b, depth - 1, a, bb, true)); b[r][c] = 0; bb = Math.min(bb, v); if (a >= bb) break; }
  return v;
}
function solveConnect4(state: Record<string, unknown>): { move: string; reasoning: string } {
  const b = (state.board as number[][]).map((r) => r.slice());
  const legal = c4Legal(b);
  let best = legal[0] ?? 3, bv = -1e30;
  for (const c of C4ORDER.filter((x) => legal.includes(x))) {
    const r = c4Drop(b, c); b[r][c] = 1; const v = c4mm(b, 4, -1e18, 1e18, false); b[r][c] = 0;
    if (v > bv) { bv = v; best = c; }
  }
  return { move: String(best), reasoning: `minimax → column ${best}` };
}

// Minesweeper solver (constraint propagation + safe-ish guess) — stateless,
// mirrors the Python agent. R=C=9.
const MR = 9, MC = 9;
const MNB = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
function solveMinesweeper(state: Record<string, unknown>): { move: string; reasoning: string } {
  const view = state.view as number[][];
  if (view.every((row) => row.every((v) => v < 0))) return { move: `${MR >> 1},${MC >> 1}`, reasoning: "open center" };
  const nbrs = (r: number, c: number) =>
    MNB.map(([dr, dc]) => [r + dr, c + dc]).filter(([nr, nc]) => nr >= 0 && nr < MR && nc >= 0 && nc < MC);
  const flags = new Set<string>(), safes = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < MR; r++)
      for (let c = 0; c < MC; c++) {
        const n = view[r][c];
        if (n < 0) continue;
        const hidden = nbrs(r, c).filter(([nr, nc]) => view[nr][nc] === -1 && !flags.has(`${nr},${nc}`));
        const flagged = nbrs(r, c).filter(([nr, nc]) => flags.has(`${nr},${nc}`));
        if (!hidden.length) continue;
        if (n - flagged.length === hidden.length) {
          for (const [hr, hc] of hidden) if (!flags.has(`${hr},${hc}`)) { flags.add(`${hr},${hc}`); changed = true; }
        } else if (n === flagged.length) {
          for (const [hr, hc] of hidden) if (!safes.has(`${hr},${hc}`)) { safes.add(`${hr},${hc}`); changed = true; }
        }
      }
  }
  for (const s of [...safes].sort()) {
    const [sr, sc] = s.split(",").map(Number);
    if (view[sr][sc] === -1) return { move: s, reasoning: `deduced safe ${s}` };
  }
  let best: string | null = null, bestK = 99;
  for (let r = 0; r < MR; r++)
    for (let c = 0; c < MC; c++) {
      if (view[r][c] !== -1 || flags.has(`${r},${c}`)) continue;
      const rn = nbrs(r, c).filter(([nr, nc]) => view[nr][nc] >= 0).length;
      if (rn < bestK) { bestK = rn; best = `${r},${c}`; }
    }
  return { move: best ?? "0,0", reasoning: best ? `guess ${best}` : "guess" };
}

// Tetris placement planner (El-Tetris weights) — mirrors the Python agent.
// Returns the full move sequence (rotate*, shift*, hard-drop) for one piece.
function _tCollides(board: number[][], piece: string, rot: number, px: number, py: number): boolean {
  for (const [mx, my] of PIECES[piece][rot]) {
    const cx = px + mx, cy = py + my;
    if (cx < 0 || cx >= TW || cy >= TH) return true;
    if (cy >= 0 && board[cy][cx]) return true;
  }
  return false;
}
function _tPlace(board: number[][], piece: string, rot: number, px: number): number[][] | null {
  if (_tCollides(board, piece, rot, px, 0)) return null;
  let y = 0;
  while (!_tCollides(board, piece, rot, px, y + 1)) y++;
  const nb = board.map((r) => r.slice());
  for (const [mx, my] of PIECES[piece][rot]) {
    const cy = y + my, cx = px + mx;
    if (cy >= 0 && cy < TH && cx >= 0 && cx < TW) nb[cy][cx] = 1;
  }
  return nb;
}
function _tEval(board: number[][]): number {
  const kept = board.filter((r) => !r.every((c) => c));
  const cleared = TH - kept.length;
  const nb = [...Array(cleared).fill(0).map(() => Array(TW).fill(0)), ...kept];
  const hs: number[] = [];
  for (let x = 0; x < TW; x++) {
    let h = 0;
    for (let y = 0; y < TH; y++) if (nb[y][x]) { h = TH - y; break; }
    hs.push(h);
  }
  const agg = hs.reduce((a, b) => a + b, 0);
  let bump = 0;
  for (let i = 0; i < TW - 1; i++) bump += Math.abs(hs[i] - hs[i + 1]);
  let holes = 0;
  for (let x = 0; x < TW; x++) {
    let seen = false;
    for (let y = 0; y < TH; y++) {
      if (nb[y][x]) seen = true;
      else if (seen) holes++;
    }
  }
  return -0.510066 * agg + 0.760666 * cleared - 0.35663 * holes - 0.184483 * bump;
}
function planTetris(state: Record<string, unknown>): { seq: string[]; reasoning: string } {
  const board = state.board as number[][];
  const piece = state.piece as string;
  const curPx = state.px as number;
  let best: [number, number] | null = null;
  let bestScore = -1e18;
  for (let rot = 0; rot < 4; rot++) {
    for (let px = -2; px < TW; px++) {
      const nb = _tPlace(board, piece, rot, px);
      if (!nb) continue;
      const sc = _tEval(nb);
      if (sc > bestScore) { bestScore = sc; best = [rot, px]; }
    }
  }
  if (!best) return { seq: ["drop"], reasoning: "no placement" };
  const [rot, px] = best;
  const seq: string[] = Array(rot).fill("rotate");
  const dx = px - curPx;
  for (let i = 0; i < Math.abs(dx); i++) seq.push(dx > 0 ? "right" : "left");
  seq.push("drop");
  return { seq, reasoning: `place ${piece} rot${rot} col${px}` };
}

// Dodger — short freeze-rollout look-ahead over the three moves (mirrors the
// Python reference agent agents/heuristic_dodger.py). Reads all geometry from
// the observation state. Tops out the survival ladder.
interface DGeom { W: number; H: number; PW: number; PH: number; PY: number; HW: number; HH: number; FALL: number; SPD: number }
const D_LOOK = 60, D_HORIZON = 18;
function dodgerGreedy(px: number, hazards: [number, number][], g: DGeom): string {
  const bandTop = g.PY - D_LOOK;
  const occ = new Uint8Array(g.W);
  for (const [hx, hy] of hazards) {
    if (hy + g.HH > bandTop && hy < g.PY + g.PH) {
      const x0 = Math.max(0, hx), x1 = Math.min(g.W, hx + g.HW);
      for (let x = x0; x < x1; x++) occ[x] = 1;
    }
  }
  let any = false;
  for (let x = 0; x < g.W; x++) if (occ[x]) { any = true; break; }
  if (!any) {
    const c = Math.trunc((g.W - g.PW) / 2);
    return px > c + 4 ? "left" : px < c - 4 ? "right" : "stay";
  }
  const maxX = g.W - g.PW;
  const spanOcc = (x: number) => { let n = 0; for (let i = x; i < x + g.PW; i++) n += occ[i]; return n; };
  let target = -1, bestDist = Infinity, foundSafe = false;
  for (let x = 0; x <= maxX; x++) {
    if (spanOcc(x) === 0) { foundSafe = true; const d = Math.abs(x - px); if (d < bestDist) { bestDist = d; target = x; } }
  }
  if (!foundSafe) { let bestOv = Infinity; for (let x = 0; x <= maxX; x++) { const ov = spanOcc(x); if (ov < bestOv) { bestOv = ov; target = x; } } }
  return target < px - 1 ? "left" : target > px + 1 ? "right" : "stay";
}
function dodgerRollout(px: number, hazards: [number, number][], first: string, g: DGeom): number {
  const advance = (p: number, haz: [number, number][], action: string): { p: number; haz: [number, number][]; dead: boolean } => {
    if (action === "left") p = Math.max(0, p - g.SPD);
    else if (action === "right") p = Math.min(g.W - g.PW, p + g.SPD);
    for (const hz of haz) hz[1] += g.FALL;
    haz = haz.filter((h) => h[1] < g.H);
    for (const [hx, hy] of haz) {
      if (hx < p + g.PW && hx + g.HW > p && hy < g.PY + g.PH && hy + g.HH > g.PY) return { p, haz, dead: true };
    }
    return { p, haz, dead: false };
  };
  let haz: [number, number][] = hazards.map(([x, y]) => [x, y]);
  let r = advance(px, haz, first);
  if (r.dead) return 0;
  let p = r.p; haz = r.haz; let survived = 1;
  for (let i = 0; i < D_HORIZON - 1; i++) {
    const a = dodgerGreedy(p, haz, g);
    r = advance(p, haz, a);
    if (r.dead) break;
    p = r.p; haz = r.haz; survived++;
  }
  return survived;
}
function solveDodger(state: Record<string, unknown>): { move: string; reasoning: string } {
  const g: DGeom = {
    W: state.width as number, H: state.height as number, PW: state.paddle_w as number,
    PH: state.paddle_h as number, PY: state.paddle_y as number, HW: state.hazard_w as number,
    HH: state.hazard_h as number, FALL: state.fall as number, SPD: (state.paddle_speed as number) ?? 7,
  };
  const px = state.paddle_x as number;
  const hazards = ((state.hazards as { x: number; y: number }[]) ?? []).map((h): [number, number] => [h.x, h.y]);
  const results = (["left", "stay", "right"] as const).map((a) => [dodgerRollout(px, hazards, a, g), a] as const);
  const best = Math.max(...results.map((r) => r[0]));
  const winners = results.filter((r) => r[0] === best).map((r) => r[1]);
  const greedy = dodgerGreedy(px, hazards, g);
  let choice: string;
  if (winners.includes(greedy as typeof winners[number])) {
    choice = greedy;
  } else {
    const c = Math.trunc((g.W - g.PW) / 2);
    const posOf = (a: string) => (a === "left" ? px - g.SPD : a === "right" ? px + g.SPD : px);
    choice = winners.reduce((bestA, a) => (Math.abs(posOf(a) - c) < Math.abs(posOf(bestA) - c) ? a : bestA));
  }
  return { move: choice, reasoning: `rollout ${best}t → ${choice}` };
}

// Catcher — rollout that maximizes catches while staying alive (mirrors the
// Python agents/heuristic_catcher.py). Two-class: catch good, dodge bad.
interface CGeom { W: number; H: number; PW: number; PH: number; PY: number; IW: number; IH: number; FALL: number; SPD: number }
const C_LOOK = 70, C_HORIZON = 16;
type CItem = [number, number, number]; // x, y, kind(0 good,1 bad)
function toward(px: number, t: number): string {
  return t < px - 1 ? "left" : t > px + 1 ? "right" : "stay";
}
function catcherGreedy(px: number, items: CItem[], g: CGeom): string {
  const occ = new Uint8Array(g.W);
  const bandTop = g.PY - C_LOOK;
  for (const [x, y, k] of items) {
    if (k === 1 && y + g.IH > bandTop && y < g.PY + g.PH) {
      for (let c = Math.max(0, x); c < Math.min(g.W, x + g.IW); c++) occ[c] = 1;
    }
  }
  const maxX = g.W - g.PW;
  const spanBad = (x: number) => { let n = 0; for (let i = x; i < x + g.PW; i++) n += occ[i]; return n; };
  if (spanBad(px) > 0) {
    let best = -1, bestD = Infinity;
    for (let x = 0; x <= maxX; x++) if (spanBad(x) === 0 && Math.abs(x - px) < bestD) { bestD = Math.abs(x - px); best = x; }
    if (best < 0) { let bv = Infinity; for (let x = 0; x <= maxX; x++) { const v = spanBad(x); if (v < bv) { bv = v; best = x; } } }
    return toward(px, best);
  }
  const greens = items.filter(([, , k]) => k === 0).filter(([, y]) => y < g.PY + g.PH && y + g.IH > bandTop).sort((a, b) => b[1] - a[1]);
  for (const [gx] of greens) {
    const desired = Math.min(maxX, Math.max(0, gx + Math.trunc(g.IW / 2) - Math.trunc(g.PW / 2)));
    if (spanBad(desired) === 0) return toward(px, desired);
  }
  return "stay";
}
function catcherRollout(px: number, items: CItem[], first: string, g: CGeom): number {
  const advance = (p: number, its: CItem[], action: string) => {
    if (action === "left") p = Math.max(0, p - g.SPD);
    else if (action === "right") p = Math.min(g.W - g.PW, p + g.SPD);
    for (const it of its) it[1] += g.FALL;
    let gained = 0, dead = false;
    const surv: CItem[] = [];
    for (const [x, y, k] of its) {
      if (x < p + g.PW && x + g.IW > p && y < g.PY + g.PH && y + g.IH > g.PY) {
        if (k === 1) dead = true; else gained += 1;
        continue;
      }
      if (y >= g.H) continue;
      surv.push([x, y, k]);
    }
    return { p, its: surv, gained, dead };
  };
  let its: CItem[] = items.map((it) => [it[0], it[1], it[2]]);
  let r = advance(px, its, first);
  let total = r.gained, tick = 1;
  if (r.dead) return total * 1000 + tick;
  let p = r.p; its = r.its;
  for (let i = 0; i < C_HORIZON - 1; i++) {
    const a = catcherGreedy(p, its, g);
    r = advance(p, its, a);
    total += r.gained; tick += 1; p = r.p; its = r.its;
    if (r.dead) return total * 1000 + tick;
  }
  return 1_000_000 + total * 1000 + tick;
}
function solveCatcher(state: Record<string, unknown>): { move: string; reasoning: string } {
  const g: CGeom = {
    W: state.width as number, H: state.height as number, PW: state.paddle_w as number,
    PH: state.paddle_h as number, PY: state.paddle_y as number, IW: state.item_w as number,
    IH: state.item_h as number, FALL: state.fall as number, SPD: (state.paddle_speed as number) ?? 7,
  };
  const px = state.paddle_x as number;
  const items = ((state.items as { x: number; y: number; kind: number }[]) ?? []).map((it): CItem => [it.x, it.y, it.kind]);
  const results = (["left", "stay", "right"] as const).map((a) => [catcherRollout(px, items, a, g), a] as const);
  const best = Math.max(...results.map((r) => r[0]));
  const winners = results.filter((r) => r[0] === best).map((r) => r[1]);
  const greedy = catcherGreedy(px, items, g);
  const choice = winners.includes(greedy as typeof winners[number]) ? greedy : winners[0];
  return { move: choice, reasoning: `catch rollout ${Math.floor(best % 1000)} → ${choice}` };
}

// Volley — predict the ball's landing x (simulate forward through wall bounces),
// center the paddle there. Mirrors agents/heuristic_volley.py.
function solveVolley(state: Record<string, unknown>): { move: string; reasoning: string } {
  const W = state.width as number, BS = state.ball_size as number;
  const PW = state.paddle_w as number, PY = state.paddle_y as number;
  const px = state.paddle_x as number;
  let bx = state.ball_x as number, by = state.ball_y as number;
  let vx = state.ball_vx as number, vy = state.ball_vy as number;
  let tx = bx;
  for (let i = 0; i < 400; i++) {
    bx += vx; by += vy;
    if (bx <= 0) { bx = 0; vx = -vx; } else if (bx >= W - BS) { bx = W - BS; vx = -vx; }
    if (by <= 0) { by = 0; vy = -vy; }
    if (vy > 0 && by + BS >= PY) { tx = bx; break; }
  }
  const target = Math.max(0, Math.min(W - PW, tx + Math.trunc(BS / 2) - Math.trunc(PW / 2)));
  const move = target < px - 1 ? "left" : target > px + 1 ? "right" : "stay";
  return { move, reasoning: `intercept @x${target}` };
}

// Storm — rollout dodge that respects each block's own speed (mirrors
// agents/heuristic_storm.py). Multi-object: many blocks, varying velocities.
interface SGeom { W: number; H: number; PW: number; PH: number; PY: number; BW: number; BH: number; SPD: number }
const S_LOOK_T = 13, S_HORIZON = 16;
type SBlock = [number, number, number]; // x, y, vy
function stormGreedy(px: number, blocks: SBlock[], g: SGeom): string {
  const occ = new Uint8Array(g.W);
  for (const [x, y, vy] of blocks) {
    if (vy <= 0) continue;
    const t = (g.PY - (y + g.BH)) / vy;
    if (t <= S_LOOK_T) for (let c = Math.max(0, x); c < Math.min(g.W, x + g.BW); c++) occ[c] = 1;
  }
  const maxX = g.W - g.PW;
  const spanOcc = (x: number) => { let n = 0; for (let i = x; i < x + g.PW; i++) n += occ[i]; return n; };
  let any = false;
  for (let x = 0; x < g.W; x++) if (occ[x]) { any = true; break; }
  if (!any) { const c = Math.trunc((g.W - g.PW) / 2); return px > c + 4 ? "left" : px < c - 4 ? "right" : "stay"; }
  let best = -1, bd = Infinity, found = false;
  for (let x = 0; x <= maxX; x++) if (spanOcc(x) === 0) { found = true; if (Math.abs(x - px) < bd) { bd = Math.abs(x - px); best = x; } }
  if (!found) { let bo = Infinity; for (let x = 0; x <= maxX; x++) { const o = spanOcc(x); if (o < bo) { bo = o; best = x; } } }
  return best < px - 1 ? "left" : best > px + 1 ? "right" : "stay";
}
function stormRollout(px: number, blocks: SBlock[], first: string, g: SGeom): number {
  const advance = (p: number, blks: SBlock[], action: string) => {
    if (action === "left") p = Math.max(0, p - g.SPD); else if (action === "right") p = Math.min(g.W - g.PW, p + g.SPD);
    for (const b of blks) b[1] += b[2];
    const surv = blks.filter((b) => b[1] < g.H);
    for (const [x, y] of surv) {
      if (x < p + g.PW && x + g.BW > p && y < g.PY + g.PH && y + g.BH > g.PY) return { p, blks: surv, dead: true };
    }
    return { p, blks: surv, dead: false };
  };
  let blks: SBlock[] = blocks.map((b) => [b[0], b[1], b[2]]);
  let r = advance(px, blks, first);
  if (r.dead) return 0;
  let p = r.p; blks = r.blks; let s = 1;
  for (let i = 0; i < S_HORIZON - 1; i++) { const a = stormGreedy(p, blks, g); r = advance(p, blks, a); if (r.dead) break; p = r.p; blks = r.blks; s++; }
  return s;
}
function solveStorm(state: Record<string, unknown>): { move: string; reasoning: string } {
  const g: SGeom = {
    W: state.width as number, H: state.height as number, PW: state.paddle_w as number,
    PH: state.paddle_h as number, PY: state.paddle_y as number, BW: state.block_w as number,
    BH: state.block_h as number, SPD: (state.paddle_speed as number) ?? 7,
  };
  const px = state.paddle_x as number;
  const blocks = ((state.blocks as { x: number; y: number; vy: number }[]) ?? []).map((b): SBlock => [b.x, b.y, b.vy]);
  const results = (["left", "stay", "right"] as const).map((a) => [stormRollout(px, blocks, a, g), a] as const);
  const best = Math.max(...results.map((r) => r[0]));
  const winners = results.filter((r) => r[0] === best).map((r) => r[1]);
  const greedy = stormGreedy(px, blocks, g);
  const choice = winners.includes(greedy as typeof winners[number]) ? greedy : winners[0];
  return { move: choice, reasoning: `track ${blocks.length} · rollout ${best}t → ${choice}` };
}

// Turret — aim at the lowest target and fire when lined up (mirrors
// agents/heuristic_turret.py). Targeting: act on the world, not just react.
function solveTurret(state: Record<string, unknown>): { move: string; reasoning: string } {
  const W = state.width as number, CW = state.cannon_w as number, TW = state.target_w as number;
  const cx = state.cannon_x as number;
  const targets = (state.targets as { x: number; y: number }[]) ?? [];
  const bullet = state.bullet as { x: number; y: number } | null;
  const cannonCx = cx + Math.trunc(CW / 2);
  if (targets.length === 0) {
    const c = Math.trunc((W - CW) / 2) + Math.trunc(CW / 2);
    return { move: cannonCx > c + 4 ? "left" : cannonCx < c - 4 ? "right" : "stay", reasoning: "no targets — recenter" };
  }
  let low = targets[0];
  for (const t of targets) if (t.y > low.y) low = t;
  const tcx = low.x + Math.trunc(TW / 2);
  if (Math.abs(cannonCx - tcx) <= 3) {
    return bullet ? { move: "stay", reasoning: "aligned — bullet in flight" } : { move: "fire", reasoning: `aligned @x${tcx} — fire` };
  }
  return { move: tcx < cannonCx ? "left" : "right", reasoning: `aim lowest target @x${tcx}` };
}

// Forager — 2D potential-field navigation (mirrors agents/heuristic_forager.py):
// attract to the nearest good, repel from hazards' next positions.
const F_MOVES: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0], stay: [0, 0] };
function solveForager(state: Record<string, unknown>): { move: string; reasoning: string } {
  const W = state.width as number, H = state.height as number;
  const PS = state.player_size as number, SPD = state.player_speed as number;
  const GS = state.good_size as number, HS = state.hazard_size as number;
  const px = state.player_x as number, py = state.player_y as number;
  const goods = (state.goods as { x: number; y: number }[]) ?? [];
  const hazards = (state.hazards as { x: number; y: number; vx: number; vy: number }[]) ?? [];
  const pcx = px + PS / 2, pcy = py + PS / 2;
  let gx = pcx, gy = pcy;
  if (goods.length) {
    let ng = goods[0], bd = Infinity;
    for (const g of goods) {
      const d = Math.abs(g.x + GS / 2 - pcx) + Math.abs(g.y + GS / 2 - pcy);
      if (d < bd) { bd = d; ng = g; }
    }
    gx = ng.x + GS / 2; gy = ng.y + GS / 2;
  }
  const danger = (nx: number, ny: number) => {
    const ncx = nx + PS / 2, ncy = ny + PS / 2;
    let t = 0;
    for (const h of hazards) {
      const hx = h.x + h.vx, hy = h.y + h.vy;
      const dx = hx + HS / 2 - ncx, dy = hy + HS / 2 - ncy;
      if (Math.abs(dx) < (PS + HS) / 2 + 1 && Math.abs(dy) < (PS + HS) / 2 + 1) t += 1000;
      else { const d2 = dx * dx + dy * dy; if (d2 < 30 * 30) t += 250 / (d2 / 80 + 1); }
    }
    return t;
  };
  let best = "stay", bs = -1e18;
  for (const [a, [dx, dy]] of Object.entries(F_MOVES)) {
    const nx = Math.max(0, Math.min(W - PS, px + dx * SPD));
    const ny = Math.max(0, Math.min(H - PS, py + dy * SPD));
    const attract = -(Math.abs(gx - (nx + PS / 2)) + Math.abs(gy - (ny + PS / 2)));
    const sc = attract - danger(nx, ny);
    if (sc > bs) { bs = sc; best = a; }
  }
  return { move: best, reasoning: `→ drop @(${Math.round(gx)},${Math.round(gy)})` };
}

// Phantom — memory dodge (mirrors agents/heuristic_phantom.py). STATEFUL: the
// caller keeps `memory` across ticks; refresh it when the screen is lit, and
// extrapolate (blocks keep falling) through the blackout, then dodge.
interface PhGeom { W: number; PW: number; PY: number; PH: number; BW: number; BH: number; H: number; FALL: number; SPD: number }
const PH_LOOK = 60, PH_HOR = 16;
function phGreedy(px: number, blocks: number[][], g: PhGeom): string {
  const occ = new Uint8Array(g.W);
  const bandTop = g.PY - PH_LOOK;
  for (const [bx, by] of blocks) {
    if (by + g.BH > bandTop && by < g.PY + g.PH) for (let c = Math.max(0, bx); c < Math.min(g.W, bx + g.BW); c++) occ[c] = 1;
  }
  const maxX = g.W - g.PW;
  const spanOcc = (x: number) => { let n = 0; for (let i = x; i < x + g.PW; i++) n += occ[i]; return n; };
  let any = false;
  for (let x = 0; x < g.W; x++) if (occ[x]) { any = true; break; }
  if (!any) { const c = Math.trunc((g.W - g.PW) / 2); return px > c + 4 ? "left" : px < c - 4 ? "right" : "stay"; }
  let best = -1, bd = Infinity, found = false;
  for (let x = 0; x <= maxX; x++) if (spanOcc(x) === 0) { found = true; if (Math.abs(x - px) < bd) { bd = Math.abs(x - px); best = x; } }
  if (!found) { let bo = Infinity; for (let x = 0; x <= maxX; x++) { const o = spanOcc(x); if (o < bo) { bo = o; best = x; } } }
  return best < px - 1 ? "left" : best > px + 1 ? "right" : "stay";
}
function phRollout(px: number, blocks: number[][], first: string, g: PhGeom): number {
  const advance = (p: number, blks: number[][], action: string) => {
    if (action === "left") p = Math.max(0, p - g.SPD); else if (action === "right") p = Math.min(g.W - g.PW, p + g.SPD);
    const nb: number[][] = [];
    for (const [bx, by] of blks) if (by + g.FALL < g.H) nb.push([bx, by + g.FALL]);
    for (const [bx, by] of nb) if (bx < p + g.PW && bx + g.BW > p && by < g.PY + g.PH && by + g.BH > g.PY) return { p, blks: nb, dead: true };
    return { p, blks: nb, dead: false };
  };
  let blks = blocks.map((b) => [b[0], b[1]]);
  let r = advance(px, blks, first);
  if (r.dead) return 0;
  let p = r.p; blks = r.blks; let s = 1;
  for (let i = 0; i < PH_HOR - 1; i++) { const a = phGreedy(p, blks, g); r = advance(p, blks, a); if (r.dead) break; p = r.p; blks = r.blks; s++; }
  return s;
}
function solvePhantom(state: Record<string, unknown>, memory: number[][]): { move: string; reasoning: string } {
  const g: PhGeom = {
    W: state.width as number, PW: state.paddle_w as number, PY: state.paddle_y as number,
    PH: state.paddle_h as number, BW: state.block_w as number, BH: state.block_h as number,
    H: state.height as number, FALL: state.fall as number, SPD: (state.paddle_speed as number) ?? 7,
  };
  const px = state.paddle_x as number;
  if (state.visible) {
    memory.length = 0;
    for (const b of (state.blocks as { x: number; y: number }[]) ?? []) memory.push([b.x, b.y]);
  } else {
    for (const m of memory) m[1] += g.FALL;
    for (let i = memory.length - 1; i >= 0; i--) if (memory[i][1] >= g.H) memory.splice(i, 1);
  }
  const results = (["left", "stay", "right"] as const).map((a) => [phRollout(px, memory, a, g), a] as const);
  const best = Math.max(...results.map((r) => r[0]));
  const winners = results.filter((r) => r[0] === best).map((r) => r[1]);
  const greedy = phGreedy(px, memory, g);
  const choice = winners.includes(greedy as typeof winners[number]) ? greedy : winners[0];
  return { move: choice, reasoning: `${state.visible ? "see" : "DARK·recall"} ${memory.length} → ${choice}` };
}

// Rally — predict where the opponent's shot crosses your paddle, intercept
// (mirrors agents/heuristic_rally.py). Adversarial: out-last the attacker.
function solveRally(state: Record<string, unknown>): { move: string; reasoning: string } {
  const H = state.height as number, PADH = state.paddle_h as number;
  const AGENT_X = state.agent_x as number, PADW = state.paddle_w as number, BS = state.ball_size as number;
  const ay = state.agent_y as number;
  const bx = state.ball_x as number, by = state.ball_y as number;
  const vx = state.ball_vx as number, vy = state.ball_vy as number;
  let target: number;
  if (vx < 0) {
    let sx = bx, sy = by, svy = vy, ty = by;
    for (let i = 0; i < 400; i++) {
      sx += vx; sy += svy;
      if (sy <= 0) { sy = 0; svy = -svy; } else if (sy >= H - BS) { sy = H - BS; svy = -svy; }
      if (sx <= AGENT_X + PADW) { ty = sy; break; }
    }
    target = ty + Math.trunc(BS / 2);
  } else {
    target = Math.trunc(H / 2);
  }
  const desired = Math.max(0, Math.min(H - PADH, target - Math.trunc(PADH / 2)));
  const move = desired < ay - 1 ? "up" : desired > ay + 1 ? "down" : "stay";
  return { move, reasoning: vx < 0 ? `intercept @y${target}` : "recenter" };
}

async function llmMove(
  apiKey: string, envId: string, obs: Observation, model: string
): Promise<{ move: string; reasoning: string }> {
  const legal = obs.legal_actions;
  const body = {
    model, temperature: 0.2, max_tokens: 90,
    response_format: { type: "json_object" as const },
    messages: [
      { role: "system" as const, content: SYSTEM[envId] ?? "You are an expert game player." },
      { role: "user" as const, content:
        `Board (step ${obs.step}, score ${obs.score}):\n${obs.text}\n\n` +
        `Legal moves: ${JSON.stringify(legal)}\n` +
        `Respond ONLY as JSON: {"reason":"<=12 words","move":"<one legal move>"}` },
    ],
  };
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`openai ${res.status}`);
    const data = await res.json();
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}");
    let move = String(parsed.move ?? "").toLowerCase().trim();
    if (!legal.includes(move)) {
      const m = move.match(/\b(up|down|left|right)\b/);
      move = m && legal.includes(m[1]) ? m[1] : "";
    }
    if (!move) return heuristicMove(envId, obs);
    return { move, reasoning: String(parsed.reason ?? "").slice(0, 120) };
  } catch {
    // Quota/network hiccup — degrade to the strong heuristic, not a blind move.
    return heuristicMove(envId, obs);
  }
}

async function llmAvailable(apiKey: string, model: string): Promise<boolean> {
  if (!apiKey) return false;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ok" }] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const envId = `arcade/${url.searchParams.get("env") ?? "2048"}`;
  if (!ENV_IDS.includes(envId)) {
    return Response.json({ error: "unknown env" }, { status: 400 });
  }
  const model = url.searchParams.get("model") || "gpt-4o-mini";
  const apiKey = process.env.OPENAI_API_KEY || "";

  g.__sb_live = g.__sb_live ?? 0;
  if (g.__sb_live >= MAX_CONCURRENT) {
    return Response.json({ error: "too many live games right now — try again shortly" }, { status: 429 });
  }
  g.__sb_live += 1;

  const encoder = new TextEncoder();
  const isSnake = envId.includes("snake");
  const isTetris = envId.includes("tetris");
  const isMine = envId.includes("minesweeper");
  const isFlappy = envId.includes("flappy");
  const isC4 = envId.includes("connect4");
  const isDodger = envId.includes("dodger");
  const isCatcher = envId.includes("catcher");
  const isVolley = envId.includes("volley");
  const isStorm = envId.includes("storm");
  const isTurret = envId.includes("turret");
  const isForager = envId.includes("forager");
  const isPhantom = envId.includes("phantom");
  const isRally = envId.includes("rally");
  const maxSteps = isSnake ? 400 : isTetris ? 420 : isMine ? 120 : isFlappy ? 500 : isC4 ? 80 : isDodger ? 620 : isCatcher ? 760 : isVolley ? 900 : isStorm ? 700 : isTurret ? 800 : isForager ? 800 : isPhantom ? 650 : isRally ? 900 : 200;
  const pace = isSnake ? 90 : isTetris ? 110 : isMine ? 280 : isFlappy ? 70 : isC4 ? 340 : isDodger ? 70 : isCatcher ? 65 : isVolley ? 50 : isStorm ? 65 : isTurret ? 55 : isForager ? 60 : isPhantom ? 70 : isRally ? 45 : 240;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const useLLM = isTetris || isMine || isFlappy || isC4 || isDodger || isCatcher || isVolley || isStorm || isTurret || isForager || isPhantom || isRally ? false : await llmAvailable(apiKey, model);
        const label = isTetris ? "SteamBench planner" : isMine ? "SteamBench solver" : isC4 ? "SteamBench minimax" : isDodger ? "SteamBench dodge AI" : isCatcher ? "SteamBench vision AI" : isVolley ? "SteamBench predict AI" : isStorm ? "SteamBench tracking AI" : isTurret ? "SteamBench aim AI" : isForager ? "SteamBench navigator AI" : isPhantom ? "SteamBench memory AI" : isRally ? "SteamBench rally AI" : useLLM ? model : "SteamBench heuristic";
        let tetrisPlan: string[] = [];
        const phantomMemory: number[][] = [];

        const env = make(envId);
        const seed = Math.floor(Math.random() * 1_000_000_000);
        let obs = env.reset(seed);
        const spec = env.spec();
        send("start", {
          env_id: envId, seed, name: spec.name, model: label,
          achievements: spec.achievements, action_space: spec.action_space,
        });
        send("step", {
          step: 0, action: null,
          reasoning: isTetris ? "new game (planner AI)" : isMine ? "new game (solver AI)" : isC4 ? "new series (minimax AI)" : isDodger ? "new game (vision/dodge AI)" : isCatcher ? "new game (catch/avoid AI)" : isVolley ? "new game (predict-the-bounce AI)" : isStorm ? "new game (multi-object tracking AI)" : isTurret ? "new game (aim-and-fire AI)" : isForager ? "new game (2D navigation AI)" : isPhantom ? "new game (memory / occlusion AI)" : isRally ? "new match (adversarial AI)" : useLLM ? "new game" : "new game (LLM quota unavailable — using heuristic AI)",
          state: obs.state, score: env.score, unlocked: [], newly: [],
        });

        while (!env.done && env.steps < maxSteps) {
          if (req.signal.aborted) break;
          const before = new Set(env.unlocked);
          let move: string;
          let reasoning: string;
          if (isTetris) {
            if (!tetrisPlan.length) {
              const p = planTetris(obs.state);
              tetrisPlan = p.seq.length ? p.seq : ["drop"];
              reasoning = p.reasoning;
            } else {
              reasoning = "executing placement";
            }
            move = tetrisPlan.shift() as string;
          } else if (isMine) {
            ({ move, reasoning } = solveMinesweeper(obs.state));
          } else if (isC4) {
            ({ move, reasoning } = solveConnect4(obs.state));
          } else if (isDodger) {
            ({ move, reasoning } = solveDodger(obs.state));
          } else if (isCatcher) {
            ({ move, reasoning } = solveCatcher(obs.state));
          } else if (isVolley) {
            ({ move, reasoning } = solveVolley(obs.state));
          } else if (isStorm) {
            ({ move, reasoning } = solveStorm(obs.state));
          } else if (isTurret) {
            ({ move, reasoning } = solveTurret(obs.state));
          } else if (isForager) {
            ({ move, reasoning } = solveForager(obs.state));
          } else if (isPhantom) {
            ({ move, reasoning } = solvePhantom(obs.state, phantomMemory));
          } else if (isRally) {
            ({ move, reasoning } = solveRally(obs.state));
          } else if (useLLM) {
            ({ move, reasoning } = await llmMove(apiKey, envId, obs, model));
          } else {
            ({ move, reasoning } = heuristicMove(envId, obs));
          }
          obs = env.step(move);
          const newly = [...env.unlocked].filter((a) => !before.has(a));
          send("step", {
            step: env.steps, action: move, reasoning, state: obs.state,
            score: env.score, unlocked: [...env.unlocked].sort(), newly,
          });
          await sleep(pace);
        }

        if (req.signal.aborted) return; // viewer left — don't record a partial run

        const game = getGameByEnvId(envId);
        const appid = game?.appid ?? 0;
        const tasks = getTasksForApp(appid);
        const sc = scoreRun([...env.unlocked].sort(), tasks);
        const row: RunRow = {
          env_id: envId, appid, game: game?.name ?? envId,
          agent_id: `${label} (live)`, // matches the streamed banner (planner/solver/minimax/heuristic/model)
          agent_kind: "agent", seed, score: env.score, steps: env.steps,
          unlocked: [...env.unlocked].sort(),
          earned_points: sc.earned_points,
          earned_bits: Math.round(sc.earned_bits * 100) / 100,
          mastery: Math.round(sc.mastery * 1e4) / 1e4,
          verified: true, created_at: Date.now(),
        };
        await addRun(row);
        send("done", {
          final_score: env.score, unlocked: row.unlocked, steps: env.steps,
          env_id: envId, seed, earned_points: sc.earned_points, mastery: row.mastery,
        });
      } catch (err) {
        send("error", { error: String(err) });
      } finally {
        g.__sb_live = Math.max(0, (g.__sb_live ?? 1) - 1);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
