// TS mirror of engine/steambench/scoring.py: per-run/per-game scoring, player
// aggregation, and the Human-vs-AI Elo board. Operates over RunRows so seed
// runs and freshly submitted runs are scored on one path.

import type {
  GameScore,
  HumanVsAI,
  PlayerKind,
  PlayerStanding,
  RunRow,
  Task,
} from "./types";

/** Score one run given the full task list of its game. */
export function scoreRun(
  unlocked: string[],
  tasks: Task[]
): { earned_points: number; earned_bits: number; total_bits: number; completed: number; total: number; mastery: number } {
  const done = new Set(unlocked);
  let earned_points = 0;
  let earned_bits = 0;
  let total_bits = 0;
  let completed = 0;
  for (const t of tasks) {
    total_bits += t.bits;
    // tasks carry source_ref (the achievement apiname/id)
    if (done.has(t.source_ref)) {
      earned_points += t.points;
      earned_bits += t.bits;
      completed += 1;
    }
  }
  const mastery = total_bits > 0 ? Math.min(1, earned_bits / total_bits) : 0;
  return { earned_points, earned_bits, total_bits, completed, total: tasks.length, mastery };
}

export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

export function eloUpdate(
  a: number,
  b: number,
  scoreA: number,
  k = 32
): [number, number] {
  const ea = expectedScore(a, b);
  const eb = 1 - ea;
  return [a + k * (scoreA - ea), b + k * (1 - scoreA - eb)];
}

export function matchOutcome(bitsA: number, bitsB: number, eps = 1e-9): number {
  if (Math.abs(bitsA - bitsB) <= eps) return 0.5;
  return bitsA > bitsB ? 1 : 0;
}

interface BestByPlayerEnv {
  // key: `${kind}:${player}` -> appid -> {bits, points, mastery, completed, total_bits}
  [playerKey: string]: Record<number, GameScore>;
}

/**
 * Aggregate standings from runs. The best run per (player, game) counts.
 * `tasksByApp` maps appid -> Task[] so we can score from `unlocked`.
 */
export function buildLeaderboard(
  runs: RunRow[],
  tasksByApp: Map<number, Task[]>,
  popularityWeight: (appid: number) => number = () => 1.2
): { standings: PlayerStanding[]; humanVsAI: HumanVsAI } {
  const best: BestByPlayerEnv = {};
  const kindByPlayer = new Map<string, PlayerKind>();

  for (const run of runs) {
    if (run.verified === false) continue;
    const tasks = tasksByApp.get(run.appid);
    if (!tasks || tasks.length === 0) continue;
    const s = scoreRun(run.unlocked, tasks);
    const key = `${run.agent_kind}:${run.agent_id}`;
    kindByPlayer.set(key, run.agent_kind);
    best[key] = best[key] || {};
    const prev = best[key][run.appid];
    const gs: GameScore = {
      appid: run.appid,
      earned_points: s.earned_points,
      earned_bits: s.earned_bits,
      total_bits: s.total_bits,
      completed_tasks: s.completed,
      total_tasks: s.total,
      mastery: s.mastery,
      completion: s.total ? s.completed / s.total : 0,
    };
    if (!prev || gs.earned_bits > prev.earned_bits) best[key][run.appid] = gs;
  }

  // Per-player standings.
  const standings: PlayerStanding[] = [];
  for (const [key, perGame] of Object.entries(best)) {
    const kind = kindByPlayer.get(key)!;
    const player_id = key.slice(kind.length + 1);
    let total_points = 0;
    let weighted_score = 0;
    let tasks_completed = 0;
    let games_played = 0;
    for (const [appidStr, gs] of Object.entries(perGame)) {
      if (gs.completed_tasks === 0) continue;
      const appid = Number(appidStr);
      total_points += gs.earned_points;
      tasks_completed += gs.completed_tasks;
      games_played += 1;
      weighted_score += gs.mastery * popularityWeight(appid) * 1000;
    }
    standings.push({
      player_id,
      kind,
      total_points,
      weighted_score,
      games_played,
      tasks_completed,
      legendary_count: 0,
      elo: 1200,
      per_game: perGame,
    });
  }
  standings.sort((a, b) => b.weighted_score - a.weighted_score);
  standings.forEach((s, i) => (s.rank = i + 1));

  // Human-vs-AI: per game, best-human-bits vs best-AI-bits -> one Elo match.
  const board: HumanVsAI = {
    human_elo: 1200,
    ai_elo: 1200,
    human_wins: 0,
    ai_wins: 0,
    draws: 0,
    games_contested: 0,
    leader: "tie",
    gap: 0,
  };
  const appidSet = new Set<number>();
  for (const perGame of Object.values(best))
    for (const a of Object.keys(perGame)) appidSet.add(Number(a));
  // Contest games in a stable (numeric) order so the headline Human-vs-AI Elo
  // is a deterministic function of the result set, not of run arrival order.
  const appids = [...appidSet].sort((a, b) => a - b);

  for (const appid of appids) {
    let bestHuman = -1;
    let bestAI = -1;
    for (const [key, perGame] of Object.entries(best)) {
      const gs = perGame[appid];
      if (!gs) continue;
      const kind = kindByPlayer.get(key)!;
      if (kind === "human") bestHuman = Math.max(bestHuman, gs.earned_bits);
      else bestAI = Math.max(bestAI, gs.earned_bits);
    }
    if (bestHuman < 0 || bestAI < 0) continue; // need both camps to contest
    const outcome = matchOutcome(bestHuman, bestAI);
    [board.human_elo, board.ai_elo] = eloUpdate(
      board.human_elo,
      board.ai_elo,
      outcome,
      24
    );
    if (outcome === 1) board.human_wins += 1;
    else if (outcome === 0) board.ai_wins += 1;
    else board.draws += 1;
    board.games_contested += 1;
  }
  board.human_elo = Math.round(board.human_elo * 10) / 10;
  board.ai_elo = Math.round(board.ai_elo * 10) / 10;
  board.gap = Math.round(Math.abs(board.human_elo - board.ai_elo) * 10) / 10;
  board.leader =
    board.human_elo > board.ai_elo
      ? "human"
      : board.ai_elo > board.human_elo
        ? "ai"
        : "tie";

  return { standings, humanVsAI: board };
}
