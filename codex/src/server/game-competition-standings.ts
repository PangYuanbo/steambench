import { buildSeasonSnapshot, type CompetitorStanding, type SeasonScope, type SeasonWindow, type TaskLeaderboard } from "../benchmark/standings";
import type { BenchmarkTask, CompetitorType, GameCatalogEntry, ScoreboardRow } from "../benchmark/types";
import type { TaskRegistryEntry } from "./store";

export type GameCompetitionSummary = {
  winnerType?: CompetitorType | "tie";
  margin: number;
  humanScore: number;
  agentScore: number;
  scoredTasks: number;
  activeTasks: number;
  coveragePercent: number;
};

export type GameCompetitionStandings = {
  schemaVersion: "steambench.game-competition-standings.v1";
  generatedAt: string;
  game: GameCatalogEntry;
  season: SeasonWindow;
  summary: GameCompetitionSummary;
  totals: {
    scoreboardRows: number;
    activeTasks: number;
    candidateTasks: number;
    registryRows: number;
    scoredTasks: number;
    unscoredTasks: number;
    humanRuns: number;
    agentRuns: number;
    humanScore: number;
    agentScore: number;
  };
  leaders: {
    overall?: ScoreboardRow;
    human?: ScoreboardRow;
    agent?: ScoreboardRow;
  };
  competitors: CompetitorStanding[];
  taskLeaderboards: TaskLeaderboard[];
  taskCoverage: Array<{
    taskId: string;
    title: string;
    track: BenchmarkTask["track"];
    level: number;
    scoredRows: number;
    humanLeader?: ScoreboardRow;
    agentLeader?: ScoreboardRow;
    leader?: ScoreboardRow;
  }>;
};

function matchesGame(row: ScoreboardRow, game: GameCatalogEntry): boolean {
  return row.appid === game.appid || row.game === game.name;
}

function bestRow(rows: ScoreboardRow[], type?: CompetitorType): ScoreboardRow | undefined {
  return rows
    .filter((row) => type === undefined || row.type === type)
    .sort((a, b) => b.score - a.score || a.completedAt.localeCompare(b.completedAt) || a.competitor.localeCompare(b.competitor))[0];
}

function winnerFor(humanScore: number, agentScore: number, rowCount: number): GameCompetitionSummary["winnerType"] {
  if (rowCount === 0) return undefined;
  if (humanScore > agentScore) return "human";
  if (agentScore > humanScore) return "agent";
  return "tie";
}

export function buildGameCompetitionStandings(input: {
  game: GameCatalogEntry;
  tasks: BenchmarkTask[];
  taskRegistry: TaskRegistryEntry[];
  scoreboard: ScoreboardRow[];
  scope: SeasonScope;
  generatedAt?: string;
}): GameCompetitionStandings {
  const activeTasks = input.tasks.filter((task) => task.appid === input.game.appid);
  const registryTasks = input.taskRegistry.filter((task) => task.appid === input.game.appid);
  const gameRows = input.scoreboard.filter((row) => matchesGame(row, input.game));
  const season = buildSeasonSnapshot(gameRows, input.scope);
  const rows = season.leaderboards.flatMap((leaderboard) => leaderboard.entries);
  const activeTaskIds = new Set(activeTasks.map((task) => task.id));
  const scoredActiveTaskIds = new Set(
    rows.flatMap((row) => row.taskId && activeTaskIds.has(row.taskId) ? [row.taskId] : [])
  );
  const humanScore = rows.filter((row) => row.type === "human").reduce((sum, row) => sum + row.score, 0);
  const agentScore = rows.filter((row) => row.type === "agent").reduce((sum, row) => sum + row.score, 0);
  const coveragePercent = activeTasks.length > 0 ? Math.round((scoredActiveTaskIds.size / activeTasks.length) * 100) : 0;

  return {
    schemaVersion: "steambench.game-competition-standings.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    game: input.game,
    season: season.window,
    summary: {
      winnerType: winnerFor(humanScore, agentScore, rows.length),
      margin: Math.abs(humanScore - agentScore),
      humanScore,
      agentScore,
      scoredTasks: scoredActiveTaskIds.size,
      activeTasks: activeTasks.length,
      coveragePercent
    },
    totals: {
      scoreboardRows: rows.length,
      activeTasks: activeTasks.length,
      candidateTasks: registryTasks.filter((task) => task.status === "candidate").length,
      registryRows: registryTasks.length,
      scoredTasks: scoredActiveTaskIds.size,
      unscoredTasks: Math.max(0, activeTasks.length - scoredActiveTaskIds.size),
      humanRuns: rows.filter((row) => row.type === "human").length,
      agentRuns: rows.filter((row) => row.type === "agent").length,
      humanScore,
      agentScore
    },
    leaders: {
      overall: bestRow(rows),
      human: bestRow(rows, "human"),
      agent: bestRow(rows, "agent")
    },
    competitors: season.standings.competitors,
    taskLeaderboards: season.leaderboards,
    taskCoverage: activeTasks
      .map((task) => {
        const leaderboard = season.leaderboards.find((entry) => entry.taskId === task.id || entry.taskKey === task.id);
        const scoredRows = leaderboard?.entries.length ?? 0;
        return {
          taskId: task.id,
          title: task.title,
          track: task.track,
          level: task.level,
          scoredRows,
          humanLeader: leaderboard?.humanLeader,
          agentLeader: leaderboard?.agentLeader,
          leader: leaderboard?.leader
        };
      })
      .sort((a, b) => b.scoredRows - a.scoredRows || b.level - a.level || a.title.localeCompare(b.title))
  };
}
