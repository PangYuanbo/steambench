import { filterRowsBySeasonScope, seasonWindow, type SeasonScope, type SeasonWindow } from "../benchmark/standings";
import type { BenchmarkTask, ScoreboardRow } from "../benchmark/types";
import type { AgentProfile, BenchmarkMatch, BenchmarkRun, UserAccount } from "./store";

export type MatchFeedSide = {
  competitor: string;
  status: BenchmarkRun["status"] | "not-started";
  runId?: string;
  score?: number;
};

export type MatchFeedEntry = {
  matchId: string;
  taskId: string;
  appid?: number;
  game?: string;
  task?: string;
  track?: BenchmarkTask["track"];
  status: BenchmarkMatch["status"];
  winner?: BenchmarkMatch["winner"];
  margin?: number;
  summary?: string;
  updatedAt: string;
  completedAt?: string;
  human: MatchFeedSide;
  agent: MatchFeedSide;
};

export type MatchFeed = {
  season: SeasonWindow;
  matches: MatchFeedEntry[];
};

function rowForRun(rows: ScoreboardRow[], runId?: string): ScoreboardRow | undefined {
  return runId ? rows.find((row) => row.runId === runId) : undefined;
}

function matchDate(match: BenchmarkMatch): string {
  return match.updatedAt.slice(0, 10);
}

export function buildMatchFeed(input: {
  matches: BenchmarkMatch[];
  runs: BenchmarkRun[];
  users: UserAccount[];
  agents: AgentProfile[];
  tasks: BenchmarkTask[];
  scoreboard: ScoreboardRow[];
  seasonScope?: SeasonScope;
  now?: Date;
  limit?: number;
}): MatchFeed {
  const scope = input.seasonScope ?? "all";
  const window = seasonWindow(scope, input.now);
  const scoredRowsInScope = filterRowsBySeasonScope(input.scoreboard, scope, input.now);
  const runIdsInScope = new Set(scoredRowsInScope.flatMap((row) => (row.runId ? [row.runId] : [])));
  const limit = input.limit ?? 24;

  const matches = input.matches
    .filter((match) => {
      if (scope === "all") return true;
      if (match.humanRunId && runIdsInScope.has(match.humanRunId)) return true;
      if (match.agentRunId && runIdsInScope.has(match.agentRunId)) return true;
      const date = matchDate(match);
      return Boolean(window.startDate && window.endDate && date >= window.startDate && date <= window.endDate);
    })
    .map((match) => {
      const task = input.tasks.find((entry) => entry.id === match.taskId);
      const humanRun = input.runs.find((entry) => entry.id === match.humanRunId);
      const agentRun = input.runs.find((entry) => entry.id === match.agentRunId);
      const human = input.users.find((entry) => entry.id === match.humanUserId);
      const agent = input.agents.find((entry) => entry.id === match.agentId);
      const humanRow = rowForRun(input.scoreboard, match.humanRunId);
      const agentRow = rowForRun(input.scoreboard, match.agentRunId);
      const humanSide: MatchFeedSide = {
        competitor: humanRun?.competitor ?? (human ? `human:${human.handle}` : "human:pending"),
        status: humanRun?.status ?? "not-started",
        runId: humanRun?.id,
        score: humanRun?.score ?? humanRow?.score
      };
      const agentSide: MatchFeedSide = {
        competitor: agentRun?.competitor ?? (agent ? `agent:${agent.handle}` : "agent:pending"),
        status: agentRun?.status ?? "not-started",
        runId: agentRun?.id,
        score: agentRun?.score ?? agentRow?.score
      };
      return {
        matchId: match.id,
        taskId: match.taskId,
        appid: task?.appid,
        game: task?.gameName,
        task: task?.title,
        track: task?.track,
        status: match.status,
        winner: match.winner,
        margin: match.margin,
        summary: match.summary,
        updatedAt: match.updatedAt,
        completedAt: match.status === "scored" ? matchDate(match) : undefined,
        human: humanSide,
        agent: agentSide
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);

  return {
    season: {
      ...window,
      rowCount: matches.length
    },
    matches
  };
}
