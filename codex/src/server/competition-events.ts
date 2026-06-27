import {
  buildStandings,
  buildTaskLeaderboards,
  filterRowsBySeasonScope,
  seasonWindow,
  type SeasonScope,
  type SeasonWindow
} from "../benchmark/standings";
import { buildSuiteRaceStandings } from "../benchmark/suite-standings";
import type { AgentProfile, BenchmarkMatch, BenchmarkRun, BenchmarkSuiteRace, CompetitionEventRegistration, LiveStreamSession, RunProof, UserAccount } from "./store";
import type { ScoreboardRow } from "../benchmark/types";

export type CompetitionEventSummary = {
  id: string;
  scope: SeasonScope;
  title: string;
  window: SeasonWindow;
  status: "active" | "empty";
  entrants: {
    consentedHumans: number;
    steamLinkedHumans: number;
    activeAgents: number;
    runnablePairs: number;
    registeredHumans: number;
    registeredAgents: number;
    registeredPairs: number;
  };
  score: {
    humanRuns: number;
    agentRuns: number;
    humanScore: number;
    agentScore: number;
    humanWins: number;
    agentWins: number;
    ties: number;
  };
  matches: {
    total: number;
    scored: number;
    running: number;
    scheduled: number;
    blocked: number;
  };
  suiteRaces: {
    total: number;
    scored: number;
    humanWins: number;
    agentWins: number;
    ties: number;
    humanScore: number;
    agentScore: number;
  };
  operations: {
    queuedRuns: number;
    activeRuns: number;
    pendingProofs: number;
    liveStreams: number;
  };
  leaders: Array<{
    taskId?: string;
    game: string;
    task: string;
    leader: string;
    score: number;
    humanLeader?: string;
    agentLeader?: string;
  }>;
};

function inWindow(isoValue: string, window: Omit<SeasonWindow, "rowCount">): boolean {
  if (!window.startDate || !window.endDate) return true;
  return isoValue.slice(0, 10) >= window.startDate && isoValue.slice(0, 10) <= window.endDate;
}

function eventTitle(scope: SeasonScope): string {
  if (scope === "daily") return "Today's Steam Benchmark Arena";
  if (scope === "weekly") return "Weekly Human vs Agent Cup";
  return "All-Time Steambench Arena";
}

export function buildCompetitionEventSummary(input: {
  scope: SeasonScope;
  users: UserAccount[];
  agents: AgentProfile[];
  runs: BenchmarkRun[];
  matches: BenchmarkMatch[];
  suiteRaces: BenchmarkSuiteRace[];
  scoreboard: ScoreboardRow[];
  proofs: RunProof[];
  streams: LiveStreamSession[];
  registrations?: CompetitionEventRegistration[];
  now?: Date;
}): CompetitionEventSummary {
  const windowBase = seasonWindow(input.scope, input.now);
  const scopedRows = filterRowsBySeasonScope(input.scoreboard, input.scope, input.now);
  const standings = buildStandings(scopedRows);
  const leaderboards = buildTaskLeaderboards(scopedRows);
  const scopedMatches = input.matches.filter((match) => inWindow(match.updatedAt, windowBase));
  const scopedSuiteRaces = input.suiteRaces.filter((race) =>
    race.eventScope ? race.eventScope === input.scope : inWindow(race.updatedAt, windowBase)
  );
  const suiteStandings = buildSuiteRaceStandings(scopedSuiteRaces);
  const scopedRuns = input.runs.filter((run) => inWindow(run.updatedAt, windowBase));
  const consentedHumanIds = new Set(
    input.users.filter((user) => user.type === "human" && user.linkedSteamId && user.proofConsentAt).map((user) => user.id)
  );
  const activeAgentIds = new Set(input.agents.filter((agent) => agent.status === "active").map((agent) => agent.id));
  const consentedHumans = consentedHumanIds.size;
  const activeAgents = activeAgentIds.size;
  const scopedRegistrations = (input.registrations ?? []).filter(
    (registration) => registration.status === "registered" && registration.eventScope === input.scope
  );
  const registeredHumanIds = new Set(scopedRegistrations.filter((registration) => registration.participantType === "human").map((registration) => registration.participantId));
  const registeredAgentIds = new Set(scopedRegistrations.filter((registration) => registration.participantType === "agent").map((registration) => registration.participantId));
  const eligibleRegisteredHumans = [...registeredHumanIds].filter((userId) => consentedHumanIds.has(userId)).length;
  const eligibleRegisteredAgents = [...registeredAgentIds].filter((agentId) => activeAgentIds.has(agentId)).length;
  const activeRuns = scopedRuns.filter((run) => run.status === "preparing" || run.status === "running" || run.status === "artifact-submitted" || run.status === "evaluating").length;

  return {
    id: `event:${input.scope}`,
    scope: input.scope,
    title: eventTitle(input.scope),
    window: {
      ...windowBase,
      rowCount: scopedRows.length
    },
    status: scopedRows.length > 0 || scopedMatches.length > 0 || scopedSuiteRaces.length > 0 ? "active" : "empty",
    entrants: {
      consentedHumans,
      steamLinkedHumans: input.users.filter((user) => user.type === "human" && user.linkedSteamId).length,
      activeAgents,
      runnablePairs: consentedHumans * activeAgents,
      registeredHumans: registeredHumanIds.size,
      registeredAgents: registeredAgentIds.size,
      registeredPairs: eligibleRegisteredHumans * eligibleRegisteredAgents
    },
    score: standings.totals,
    matches: {
      total: scopedMatches.length,
      scored: scopedMatches.filter((match) => match.status === "scored").length,
      running: scopedMatches.filter((match) => match.status === "running").length,
      scheduled: scopedMatches.filter((match) => match.status === "scheduled").length,
      blocked: scopedMatches.filter((match) => match.status === "failed" || match.status === "canceled").length
    },
    suiteRaces: {
      total: suiteStandings.totals.races,
      scored: suiteStandings.totals.scoredRaces,
      humanWins: suiteStandings.totals.humanWins,
      agentWins: suiteStandings.totals.agentWins,
      ties: suiteStandings.totals.ties,
      humanScore: suiteStandings.totals.humanScore,
      agentScore: suiteStandings.totals.agentScore
    },
    operations: {
      queuedRuns: scopedRuns.filter((run) => run.status === "queued").length,
      activeRuns,
      pendingProofs: input.proofs.filter((proof) => proof.status === "pending" && inWindow(proof.createdAt, windowBase)).length,
      liveStreams: input.streams.filter((stream) => stream.status === "live" && inWindow(stream.createdAt, windowBase)).length
    },
    leaders: leaderboards.slice(0, 5).map((leaderboard) => ({
      taskId: leaderboard.taskId,
      game: leaderboard.game,
      task: leaderboard.task,
      leader: leaderboard.leader.competitor,
      score: leaderboard.leader.score,
      humanLeader: leaderboard.humanLeader?.competitor,
      agentLeader: leaderboard.agentLeader?.competitor
    }))
  };
}

export function buildCompetitionEvents(input: Omit<Parameters<typeof buildCompetitionEventSummary>[0], "scope">): CompetitionEventSummary[] {
  return (["all", "daily", "weekly"] as const).map((scope) => buildCompetitionEventSummary({ ...input, scope }));
}
