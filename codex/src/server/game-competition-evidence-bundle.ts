import type { BenchmarkTask, ScoreboardRow } from "../benchmark/types";
import type { GameCompetitionStandings } from "./game-competition-standings";

export type GameCompetitionEvidenceChecklistItem = {
  id: string;
  label: string;
  status: "pass" | "fail";
};

export type GameCompetitionEvidenceBundle = {
  schemaVersion: "steambench.game-competition-evidence-bundle.v1";
  generatedAt: string;
  appid: number;
  seasonScope: GameCompetitionStandings["season"]["scope"];
  standings: GameCompetitionStandings;
  activeTasks: Array<Pick<BenchmarkTask, "id" | "appid" | "gameName" | "title" | "track" | "level" | "score">>;
  topRows: ScoreboardRow[];
  integrity: {
    verdict: "scoreboard-ready" | "incomplete";
    activeTaskCount: number;
    scoredTaskCount: number;
    scoreboardRows: number;
    taskLeaderboardCount: number;
    coveragePercent: number;
    coverageWithinBounds: boolean;
    hasHumanRuns: boolean;
    hasAgentRuns: boolean;
    checklist: GameCompetitionEvidenceChecklistItem[];
  };
};

export function buildGameCompetitionEvidenceBundle(input: {
  standings: GameCompetitionStandings;
  tasks: BenchmarkTask[];
  generatedAt?: string;
}): GameCompetitionEvidenceBundle {
  const activeTasks = input.tasks
    .filter((task) => task.appid === input.standings.game.appid)
    .map((task) => ({
      id: task.id,
      appid: task.appid,
      gameName: task.gameName,
      title: task.title,
      track: task.track,
      level: task.level,
      score: task.score
    }));
  const coverageWithinBounds =
    input.standings.summary.coveragePercent >= 0 &&
    input.standings.summary.coveragePercent <= 100 &&
    input.standings.totals.scoredTasks <= input.standings.totals.activeTasks;
  const hasHumanRuns = input.standings.totals.humanRuns > 0;
  const hasAgentRuns = input.standings.totals.agentRuns > 0;
  const checklist: GameCompetitionEvidenceChecklistItem[] = [
    {
      id: "active-tasks",
      label: "Game has active benchmark tasks",
      status: activeTasks.length > 0 ? "pass" : "fail"
    },
    {
      id: "scoreboard-rows",
      label: "Game standings include scored rows",
      status: input.standings.totals.scoreboardRows > 0 ? "pass" : "fail"
    },
    {
      id: "task-leaderboards",
      label: "Game standings include task leaderboards",
      status: input.standings.taskLeaderboards.length > 0 ? "pass" : "fail"
    },
    {
      id: "coverage-bounded",
      label: "Task coverage is bounded to active tasks",
      status: coverageWithinBounds ? "pass" : "fail"
    },
    {
      id: "competitor-sides",
      label: "Game standings include at least one human or agent run",
      status: hasHumanRuns || hasAgentRuns ? "pass" : "fail"
    }
  ];
  const verdict = checklist.every((entry) => entry.status === "pass") ? "scoreboard-ready" : "incomplete";

  return {
    schemaVersion: "steambench.game-competition-evidence-bundle.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    appid: input.standings.game.appid,
    seasonScope: input.standings.season.scope,
    standings: input.standings,
    activeTasks,
    topRows: input.standings.taskLeaderboards
      .flatMap((leaderboard) => leaderboard.entries)
      .sort((a, b) => b.score - a.score || a.completedAt.localeCompare(b.completedAt) || a.competitor.localeCompare(b.competitor))
      .slice(0, 12),
    integrity: {
      verdict,
      activeTaskCount: activeTasks.length,
      scoredTaskCount: input.standings.totals.scoredTasks,
      scoreboardRows: input.standings.totals.scoreboardRows,
      taskLeaderboardCount: input.standings.taskLeaderboards.length,
      coveragePercent: input.standings.summary.coveragePercent,
      coverageWithinBounds,
      hasHumanRuns,
      hasAgentRuns,
      checklist
    }
  };
}
