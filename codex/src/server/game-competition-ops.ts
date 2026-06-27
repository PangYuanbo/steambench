import type { BenchmarkSuite, BenchmarkSuiteTier } from "../benchmark/suites";
import type { GameCatalogEntry } from "../benchmark/types";
import type { GameCompetitionStandings } from "./game-competition-standings";
import type { GameCoveragePlan, GameCoveragePlanItem } from "./game-coverage-plan";
import type { GameCoverageRunRecord } from "./store";

export type GameCompetitionOpsAction = {
  id: string;
  label: string;
  priority: "high" | "medium" | "low";
  method: "GET" | "POST";
  endpoint: string;
  body?: Record<string, unknown>;
  reason: string;
};

export type GameCompetitionOpsReport = {
  schemaVersion: "steambench.game-competition-ops-report.v1";
  generatedAt: string;
  appid: number;
  game: GameCatalogEntry;
  status: "ready-to-race" | "needs-coverage" | "needs-publication" | "blocked";
  selectedSuite?: {
    id: string;
    tier: BenchmarkSuiteTier;
    title: string;
    status: BenchmarkSuite["status"];
    taskCount: number;
    readinessScore: number;
  };
  totals: {
    activeTasks: number;
    candidateTasks: number;
    scoredTasks: number;
    fullyCoveredTasks: number;
    humanGaps: number;
    agentGaps: number;
    readyHumanActions: number;
    readyAgentActions: number;
    suites: number;
    rankedReadySuites: number;
    controlledSuites: number;
    reviewRequiredSuites: number;
    recentCoverageRuns: number;
    scoreboardRows: number;
    publicShareReady: boolean;
  };
  standings: Pick<GameCompetitionStandings, "summary" | "leaders" | "season">;
  coverageGaps: Array<{
    taskId: string;
    title: string;
    track: GameCoveragePlanItem["task"]["track"];
    level: number;
    score: number;
    priority: GameCoveragePlanItem["priority"];
    gaps: GameCoveragePlanItem["gaps"];
    humanStatus?: NonNullable<GameCoveragePlanItem["selectedHuman"]>["status"];
    agentStatus?: NonNullable<GameCoveragePlanItem["selectedAgent"]>["status"];
    nextActions: string[];
  }>;
  suiteReadiness: Array<{
    id: string;
    tier: BenchmarkSuiteTier;
    title: string;
    status: BenchmarkSuite["status"];
    taskCount: number;
    readinessScore: number;
    rankedReadyTasks: number;
    controlledTasks: number;
    reviewRequiredTasks: number;
  }>;
  recentCoverageRuns: Array<Pick<GameCoverageRunRecord, "id" | "status" | "completedRuns" | "remainingHumanGaps" | "remainingAgentGaps" | "createdAt">>;
  recommendedActions: GameCompetitionOpsAction[];
  links: {
    standings: string;
    coveragePlan: string;
    scheduleCoverage: string;
    runCoverageLocal: string;
    benchmarkSuites: string;
    runCompetitionLocal: string;
    evidenceBundle: string;
    resultCertificate: string;
  };
};

function pickSuite(suites: BenchmarkSuite[], tier: BenchmarkSuiteTier): BenchmarkSuite | undefined {
  return suites.find((suite) => suite.tier === tier && suite.status === "ranked-ready")
    ?? suites.find((suite) => suite.tier === tier)
    ?? suites.find((suite) => suite.status === "ranked-ready")
    ?? suites[0];
}

function reportStatus(input: {
  coveragePlan: GameCoveragePlan;
  selectedSuite?: BenchmarkSuite;
  publicShareReady: boolean;
}): GameCompetitionOpsReport["status"] {
  if (input.coveragePlan.totals.activeTasks === 0 || !input.selectedSuite) return "needs-publication";
  if (input.selectedSuite.status === "review-required" || input.coveragePlan.totals.blockedTasks > 0) return "blocked";
  if (input.coveragePlan.totals.humanGaps > 0 || input.coveragePlan.totals.agentGaps > 0) return "needs-coverage";
  return input.publicShareReady ? "ready-to-race" : "needs-coverage";
}

function buildActions(input: {
  appid: number;
  suiteTier: BenchmarkSuiteTier;
  coveragePlan: GameCoveragePlan;
  selectedSuite?: BenchmarkSuite;
  selectedHumanId?: string;
  selectedAgentId?: string;
  publicShareReady: boolean;
}): GameCompetitionOpsAction[] {
  const actions: GameCompetitionOpsAction[] = [];
  if (input.coveragePlan.totals.candidateTasks > 0) {
    actions.push({
      id: "publish-candidates",
      label: "Publish reviewed task candidates",
      priority: "high",
      method: "POST",
      endpoint: `/api/steam/apps/${input.appid}/publish-candidates`,
      body: {
        reviewApproved: true,
        reviewNotes: "Approved from competition ops report."
      },
      reason: `${input.coveragePlan.totals.candidateTasks} candidate task(s) are not active yet.`
    });
  }
  const hasCoverageGap = input.coveragePlan.totals.humanGaps > 0 || input.coveragePlan.totals.agentGaps > 0;
  if (hasCoverageGap && (input.coveragePlan.totals.readyHumanActions > 0 || input.coveragePlan.totals.readyAgentActions > 0) && input.selectedHumanId && input.selectedAgentId) {
    actions.push({
      id: "schedule-coverage",
      label: "Queue coverage runs for ready gaps",
      priority: "high",
      method: "POST",
      endpoint: `/api/games/${input.appid}/coverage-plan/schedule`,
      body: {
        side: "both",
        humanUserId: input.selectedHumanId,
        agentId: input.selectedAgentId,
        limit: Math.min(12, input.coveragePlan.totals.readyHumanActions + input.coveragePlan.totals.readyAgentActions)
      },
      reason: `${input.coveragePlan.totals.readyHumanActions} human and ${input.coveragePlan.totals.readyAgentActions} agent action(s) are queueable.`
    });
  }
  if (hasCoverageGap && input.selectedHumanId && input.selectedAgentId) {
    actions.push({
      id: "run-local-coverage",
      label: "Run local coverage smoke",
      priority: "medium",
      method: "POST",
      endpoint: `/api/games/${input.appid}/coverage-plan/run-local`,
      body: {
        side: "both",
        humanUserId: input.selectedHumanId,
        agentId: input.selectedAgentId,
        limit: 4
      },
      reason: "Local coverage can quickly fill proof and scoreboard rows for demos."
    });
  }
  if (input.selectedSuite && input.selectedHumanId && input.selectedAgentId && input.selectedSuite.status !== "review-required") {
    actions.push({
      id: "run-suite-race",
      label: "Run selected suite race",
      priority: input.publicShareReady ? "medium" : "low",
      method: "POST",
      endpoint: `/api/games/${input.appid}/competition/run-local`,
      body: {
        humanUserId: input.selectedHumanId,
        agentId: input.selectedAgentId,
        suiteTier: input.suiteTier,
        reviewApproved: input.selectedSuite.status === "controlled"
      },
      reason: `${input.selectedSuite.title} is the current best suite target.`
    });
  }
  actions.push({
    id: "inspect-certificate",
    label: "Inspect public result certificate",
    priority: "low",
    method: "GET",
    endpoint: `/api/games/${input.appid}/result-certificate`,
    reason: "Use this before sharing the app leaderboard externally."
  });
  return actions;
}

export function buildGameCompetitionOpsReport(input: {
  game: GameCatalogEntry;
  standings: GameCompetitionStandings;
  coveragePlan: GameCoveragePlan;
  suites: BenchmarkSuite[];
  coverageRuns: GameCoverageRunRecord[];
  suiteTier?: BenchmarkSuiteTier;
  selectedHumanId?: string;
  selectedAgentId?: string;
  generatedAt?: string;
}): GameCompetitionOpsReport {
  const suiteTier = input.suiteTier ?? "ranked";
  const selectedSuite = pickSuite(input.suites, suiteTier);
  const publicShareReady =
    input.standings.totals.scoreboardRows > 0 &&
    input.coveragePlan.totals.activeTasks > 0 &&
    input.coveragePlan.totals.scoredTasks <= input.coveragePlan.totals.activeTasks &&
    input.standings.summary.coveragePercent >= 0 &&
    input.standings.summary.coveragePercent <= 100;
  const status = reportStatus({
    coveragePlan: input.coveragePlan,
    selectedSuite,
    publicShareReady
  });

  return {
    schemaVersion: "steambench.game-competition-ops-report.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    appid: input.game.appid,
    game: input.game,
    status,
    selectedSuite: selectedSuite
      ? {
          id: selectedSuite.id,
          tier: selectedSuite.tier,
          title: selectedSuite.title,
          status: selectedSuite.status,
          taskCount: selectedSuite.taskCount,
          readinessScore: selectedSuite.readinessScore
        }
      : undefined,
    totals: {
      activeTasks: input.coveragePlan.totals.activeTasks,
      candidateTasks: input.coveragePlan.totals.candidateTasks,
      scoredTasks: input.coveragePlan.totals.scoredTasks,
      fullyCoveredTasks: input.coveragePlan.totals.fullyCoveredTasks,
      humanGaps: input.coveragePlan.totals.humanGaps,
      agentGaps: input.coveragePlan.totals.agentGaps,
      readyHumanActions: input.coveragePlan.totals.readyHumanActions,
      readyAgentActions: input.coveragePlan.totals.readyAgentActions,
      suites: input.suites.length,
      rankedReadySuites: input.suites.filter((suite) => suite.status === "ranked-ready").length,
      controlledSuites: input.suites.filter((suite) => suite.status === "controlled").length,
      reviewRequiredSuites: input.suites.filter((suite) => suite.status === "review-required").length,
      recentCoverageRuns: input.coverageRuns.length,
      scoreboardRows: input.standings.totals.scoreboardRows,
      publicShareReady
    },
    standings: {
      summary: input.standings.summary,
      leaders: input.standings.leaders,
      season: input.standings.season
    },
    coverageGaps: input.coveragePlan.items
      .filter((item) => item.priority !== "covered")
      .slice(0, 12)
      .map((item) => ({
        taskId: item.task.id,
        title: item.task.title,
        track: item.task.track,
        level: item.task.level,
        score: item.task.score,
        priority: item.priority,
        gaps: item.gaps,
        humanStatus: item.selectedHuman?.status,
        agentStatus: item.selectedAgent?.status,
        nextActions: item.nextActions
      })),
    suiteReadiness: input.suites.map((suite) => ({
      id: suite.id,
      tier: suite.tier,
      title: suite.title,
      status: suite.status,
      taskCount: suite.taskCount,
      readinessScore: suite.readinessScore,
      rankedReadyTasks: suite.rankedReadyTasks,
      controlledTasks: suite.controlledTasks,
      reviewRequiredTasks: suite.reviewRequiredTasks
    })),
    recentCoverageRuns: input.coverageRuns.slice(0, 8).map((record) => ({
      id: record.id,
      status: record.status,
      completedRuns: record.completedRuns,
      remainingHumanGaps: record.remainingHumanGaps,
      remainingAgentGaps: record.remainingAgentGaps,
      createdAt: record.createdAt
    })),
    recommendedActions: buildActions({
      appid: input.game.appid,
      suiteTier,
      coveragePlan: input.coveragePlan,
      selectedSuite,
      selectedHumanId: input.selectedHumanId,
      selectedAgentId: input.selectedAgentId,
      publicShareReady
    }),
    links: {
      standings: `/api/games/${input.game.appid}/standings`,
      coveragePlan: `/api/games/${input.game.appid}/coverage-plan`,
      scheduleCoverage: `/api/games/${input.game.appid}/coverage-plan/schedule`,
      runCoverageLocal: `/api/games/${input.game.appid}/coverage-plan/run-local`,
      benchmarkSuites: `/api/games/${input.game.appid}/benchmark-suites`,
      runCompetitionLocal: `/api/games/${input.game.appid}/competition/run-local`,
      evidenceBundle: `/api/games/${input.game.appid}/evidence-bundle`,
      resultCertificate: `/api/games/${input.game.appid}/result-certificate`
    }
  };
}
