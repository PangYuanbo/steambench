import type { BenchmarkTrack, CompetitorType, ScoreboardRow } from "./types";

export type CompetitorStanding = {
  rank: number;
  competitor: string;
  type: CompetitorType;
  runs: number;
  totalScore: number;
  bestScore: number;
  averageScore: number;
  lastCompletedAt: string;
};

export type MatchupStanding = {
  game: string;
  task: string;
  humanLeader?: ScoreboardRow;
  agentLeader?: ScoreboardRow;
  winnerType?: CompetitorType | "tie";
  margin: number;
};

export type GameStanding = {
  game: string;
  leader: ScoreboardRow;
  humanLeader?: ScoreboardRow;
  agentLeader?: ScoreboardRow;
};

export type TaskLeaderboardEntry = ScoreboardRow & {
  taskRank: number;
};

export type TaskLeaderboard = {
  taskKey: string;
  taskId?: string;
  appid?: number;
  game: string;
  task: string;
  track?: BenchmarkTrack;
  metricName?: string;
  leader: TaskLeaderboardEntry;
  humanLeader?: TaskLeaderboardEntry;
  agentLeader?: TaskLeaderboardEntry;
  entries: TaskLeaderboardEntry[];
};

export type Standings = {
  totals: {
    humanRuns: number;
    agentRuns: number;
    humanScore: number;
    agentScore: number;
    humanWins: number;
    agentWins: number;
    ties: number;
  };
  competitors: CompetitorStanding[];
  matchups: MatchupStanding[];
  games: GameStanding[];
  taskLeaderboards: TaskLeaderboard[];
};

export type SeasonScope = "all" | "daily" | "weekly";

export type SeasonWindow = {
  scope: SeasonScope;
  label: string;
  startDate?: string;
  endDate?: string;
  rowCount: number;
};

export type SeasonSnapshot = {
  window: SeasonWindow;
  standings: Standings;
  leaderboards: TaskLeaderboard[];
};

function bestByType(rows: ScoreboardRow[], type: CompetitorType): ScoreboardRow | undefined {
  return rows
    .filter((row) => row.type === type)
    .sort((a, b) => b.score - a.score || a.completedAt.localeCompare(b.completedAt))[0];
}

function taskKey(row: ScoreboardRow): string {
  return row.taskId ?? `${row.game}:${row.task}`;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function seasonWindow(scope: SeasonScope, now = new Date()): Omit<SeasonWindow, "rowCount"> {
  const endDate = isoDate(now);
  if (scope === "daily") {
    return {
      scope,
      label: "Today",
      startDate: endDate,
      endDate
    };
  }
  if (scope === "weekly") {
    return {
      scope,
      label: "Last 7 Days",
      startDate: isoDate(addUtcDays(now, -6)),
      endDate
    };
  }
  return {
    scope,
    label: "All Time"
  };
}

export function filterRowsBySeasonScope(rows: ScoreboardRow[], scope: SeasonScope, now = new Date()): ScoreboardRow[] {
  const window = seasonWindow(scope, now);
  if (!window.startDate || !window.endDate) return rows;
  return rows.filter((row) => row.completedAt >= window.startDate! && row.completedAt <= window.endDate!);
}

export function buildSeasonSnapshot(rows: ScoreboardRow[], scope: SeasonScope, now = new Date()): SeasonSnapshot {
  const filteredRows = filterRowsBySeasonScope(rows, scope, now);
  return {
    window: {
      ...seasonWindow(scope, now),
      rowCount: filteredRows.length
    },
    standings: buildStandings(filteredRows),
    leaderboards: buildTaskLeaderboards(filteredRows)
  };
}

export function buildSeasonSnapshots(rows: ScoreboardRow[], now = new Date()): SeasonSnapshot[] {
  return (["all", "daily", "weekly"] as const).map((scope) => buildSeasonSnapshot(rows, scope, now));
}

export function buildTaskLeaderboards(rows: ScoreboardRow[]): TaskLeaderboard[] {
  const byTask = new Map<string, ScoreboardRow[]>();
  for (const row of rows) {
    const key = taskKey(row);
    byTask.set(key, [...(byTask.get(key) ?? []), row]);
  }

  return [...byTask.entries()]
    .map(([key, taskRows]) => {
      const entries = [...taskRows]
        .sort((a, b) => b.score - a.score || a.completedAt.localeCompare(b.completedAt) || a.competitor.localeCompare(b.competitor))
        .map((entry, index) => ({ ...entry, taskRank: index + 1 }));
      const leader = entries[0];
      return {
        taskKey: key,
        taskId: leader.taskId,
        appid: leader.appid,
        game: leader.game,
        task: leader.task,
        track: leader.track,
        metricName: leader.metricName,
        leader,
        humanLeader: entries.find((entry) => entry.type === "human"),
        agentLeader: entries.find((entry) => entry.type === "agent"),
        entries
      };
    })
    .sort((a, b) => b.leader.score - a.leader.score || a.game.localeCompare(b.game) || a.task.localeCompare(b.task));
}

export function buildStandings(rows: ScoreboardRow[]): Standings {
  const competitors = new Map<string, CompetitorStanding>();
  for (const row of rows) {
    const key = `${row.type}:${row.competitor}`;
    const existing = competitors.get(key);
    if (existing) {
      existing.runs += 1;
      existing.totalScore += row.score;
      existing.bestScore = Math.max(existing.bestScore, row.score);
      existing.averageScore = Math.round(existing.totalScore / existing.runs);
      existing.lastCompletedAt = row.completedAt > existing.lastCompletedAt ? row.completedAt : existing.lastCompletedAt;
    } else {
      competitors.set(key, {
        rank: 0,
        competitor: row.competitor,
        type: row.type,
        runs: 1,
        totalScore: row.score,
        bestScore: row.score,
        averageScore: row.score,
        lastCompletedAt: row.completedAt
      });
    }
  }

  const competitorRows = [...competitors.values()]
    .sort((a, b) => b.totalScore - a.totalScore || b.bestScore - a.bestScore || a.competitor.localeCompare(b.competitor))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const byTask = new Map<string, ScoreboardRow[]>();
  const byGame = new Map<string, ScoreboardRow[]>();
  for (const row of rows) {
    const key = taskKey(row);
    byTask.set(key, [...(byTask.get(key) ?? []), row]);
    byGame.set(row.game, [...(byGame.get(row.game) ?? []), row]);
  }

  const totals = {
    humanRuns: rows.filter((row) => row.type === "human").length,
    agentRuns: rows.filter((row) => row.type === "agent").length,
    humanScore: rows.filter((row) => row.type === "human").reduce((sum, row) => sum + row.score, 0),
    agentScore: rows.filter((row) => row.type === "agent").reduce((sum, row) => sum + row.score, 0),
    humanWins: 0,
    agentWins: 0,
    ties: 0
  };

  const matchups = [...byTask.entries()]
    .map(([, taskRows]) => {
      const first = taskRows[0];
      const game = first.game;
      const task = first.task;
      const humanLeader = bestByType(taskRows, "human");
      const agentLeader = bestByType(taskRows, "agent");
      let winnerType: MatchupStanding["winnerType"];
      let margin = 0;
      if (humanLeader && agentLeader) {
        margin = Math.abs(humanLeader.score - agentLeader.score);
        if (humanLeader.score > agentLeader.score) {
          winnerType = "human";
          totals.humanWins += 1;
        } else if (agentLeader.score > humanLeader.score) {
          winnerType = "agent";
          totals.agentWins += 1;
        } else {
          winnerType = "tie";
          totals.ties += 1;
        }
      } else if (humanLeader) {
        winnerType = "human";
        totals.humanWins += 1;
      } else if (agentLeader) {
        winnerType = "agent";
        totals.agentWins += 1;
      }
      return {
        game,
        task,
        humanLeader,
        agentLeader,
        winnerType,
        margin
      };
    })
    .sort((a, b) => Math.max(b.humanLeader?.score ?? 0, b.agentLeader?.score ?? 0) - Math.max(a.humanLeader?.score ?? 0, a.agentLeader?.score ?? 0));

  const games = [...byGame.entries()]
    .map(([game, gameRows]) => {
      const leader = [...gameRows].sort((a, b) => b.score - a.score)[0];
      return {
        game,
        leader,
        humanLeader: bestByType(gameRows, "human"),
        agentLeader: bestByType(gameRows, "agent")
      };
    })
    .sort((a, b) => b.leader.score - a.leader.score);

  return {
    totals,
    competitors: competitorRows,
    matchups,
    games,
    taskLeaderboards: buildTaskLeaderboards(rows)
  };
}
