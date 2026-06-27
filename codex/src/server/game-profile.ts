import { buildTaskLeaderboards, type TaskLeaderboard } from "../benchmark/standings";
import type { BenchmarkSuite } from "../benchmark/suites";
import type { TaskReview } from "../benchmark/task-review";
import type { BenchmarkTask, BenchmarkTrack, GameCatalogEntry, ScoreboardRow } from "../benchmark/types";
import type { BroadcastCenterRow } from "./broadcast-center";
import { buildGameCompetitionStandings, type GameCompetitionSummary } from "./game-competition-standings";
import type { TaskRegistryEntry } from "./store";

export type GameTrackSummary = {
  track: BenchmarkTrack;
  tasks: number;
  scoredRows: number;
  bestScore?: number;
};

export type GameBenchmarkProfile = {
  game: GameCatalogEntry;
  totals: {
    tasks: number;
    activeTasks: number;
    candidates: number;
    rejected: number;
    rankedReady: number;
    reviewRequired: number;
    controlled: number;
    scoreboardRows: number;
    humanRuns: number;
    agentRuns: number;
    broadcasts: number;
    scoreboardReadyBroadcasts: number;
    proofReadyBroadcasts: number;
  };
  competition: GameCompetitionSummary;
  levelRange?: {
    min: number;
    max: number;
  };
  tracks: GameTrackSummary[];
  topTasks: Array<{
    task: BenchmarkTask;
    review?: TaskReview;
  }>;
  suites: BenchmarkSuite[];
  leaderboards: TaskLeaderboard[];
  recentRows: ScoreboardRow[];
  broadcasts: BroadcastCenterRow[];
};

function matchesGame(row: ScoreboardRow, game: GameCatalogEntry): boolean {
  return row.appid === game.appid || row.game === game.name;
}

const uniqueTracks = (tasks: BenchmarkTask[]) =>
  [...new Set(tasks.map((task) => task.track))].sort((a, b) => a.localeCompare(b)) as BenchmarkTrack[];

export function buildGameBenchmarkProfile(input: {
  game: GameCatalogEntry;
  tasks: BenchmarkTask[];
  taskRegistry: TaskRegistryEntry[];
  reviews: TaskReview[];
  suites: BenchmarkSuite[];
  scoreboard: ScoreboardRow[];
  broadcasts: BroadcastCenterRow[];
}): GameBenchmarkProfile {
  const activeTasks = input.tasks.filter((task) => task.appid === input.game.appid);
  const registryTasks = input.taskRegistry.filter((task) => task.appid === input.game.appid);
  const activeTaskIds = new Set(activeTasks.map((task) => task.id));
  const allTasks = [
    ...activeTasks,
    ...registryTasks.filter((task) => !activeTaskIds.has(task.id))
  ];
  const reviewsByTask = new Map(input.reviews.map((review) => [review.taskId, review]));
  const rows = input.scoreboard.filter((row) => matchesGame(row, input.game));
  const competition = buildGameCompetitionStandings({
    game: input.game,
    tasks: input.tasks,
    taskRegistry: input.taskRegistry,
    scoreboard: input.scoreboard,
    scope: "all"
  });
  const broadcasts = input.broadcasts.filter((row) => row.task.appid === input.game.appid);
  const levels = allTasks.map((task) => task.level);
  const tracks = uniqueTracks(allTasks).map((track) => {
    const trackRows = rows.filter((row) => row.track === track);
    return {
      track,
      tasks: allTasks.filter((task) => task.track === track).length,
      scoredRows: trackRows.length,
      bestScore: trackRows.sort((a, b) => b.score - a.score)[0]?.score
    };
  });

  return {
    game: input.game,
    totals: {
      tasks: allTasks.length,
      activeTasks: activeTasks.length,
      candidates: registryTasks.filter((task) => task.status === "candidate").length,
      rejected: registryTasks.filter((task) => task.status === "rejected").length,
      rankedReady: allTasks.filter((task) => reviewsByTask.get(task.id)?.decision === "ranked-ready").length,
      reviewRequired: allTasks.filter((task) => reviewsByTask.get(task.id)?.decision === "review-required").length,
      controlled: allTasks.filter((task) => task.fairnessVerdict === "controlled").length,
      scoreboardRows: rows.length,
      humanRuns: rows.filter((row) => row.type === "human").length,
      agentRuns: rows.filter((row) => row.type === "agent").length,
      broadcasts: broadcasts.length,
      scoreboardReadyBroadcasts: broadcasts.filter((row) => row.scoreboardReady).length,
      proofReadyBroadcasts: broadcasts.filter((row) => row.proofReady).length
    },
    competition: competition.summary,
    levelRange: levels.length > 0
      ? {
          min: Math.min(...levels),
          max: Math.max(...levels)
        }
      : undefined,
    tracks,
    topTasks: allTasks
      .slice()
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, 8)
      .map((task) => ({
        task,
        review: reviewsByTask.get(task.id)
      })),
    suites: input.suites.filter((suite) => suite.appid === input.game.appid),
    leaderboards: buildTaskLeaderboards(rows).slice(0, 8),
    recentRows: rows
      .slice()
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt) || b.score - a.score)
      .slice(0, 8),
    broadcasts: broadcasts.slice(0, 8)
  };
}

export function buildGameBenchmarkProfiles(input: Omit<Parameters<typeof buildGameBenchmarkProfile>[0], "game"> & {
  games: GameCatalogEntry[];
}): GameBenchmarkProfile[] {
  return input.games
    .map((game) => buildGameBenchmarkProfile({ ...input, game }))
    .sort((a, b) =>
      b.totals.scoreboardReadyBroadcasts - a.totals.scoreboardReadyBroadcasts ||
      b.totals.scoreboardRows - a.totals.scoreboardRows ||
      b.totals.rankedReady - a.totals.rankedReady ||
      b.game.benchmarkFit - a.game.benchmarkFit
    );
}
