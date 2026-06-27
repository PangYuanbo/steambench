import type { BenchmarkTask, BenchmarkTrack } from "../benchmark/types";
import type { SteamAchievementBenchmarkLadder } from "./steam-achievement-ladder";
import type { SteamAppDiscoveryCandidate, TaskRegistryEntry } from "./store";

export type SteamTaskSourceOpsStatus = "ready-to-publish" | "ready-to-import" | "catalog-ready" | "needs-source-data";

export type SteamTaskSourceOpsAction = {
  id:
    | "import-achievement-recommendations"
    | "import-stat-proposals"
    | "import-leaderboard-proposals"
    | "publish-candidates"
    | "inspect-benchmark-blueprint";
  label: string;
  priority: "high" | "medium" | "low";
  method: "GET" | "POST";
  endpoint: string;
  body?: Record<string, unknown>;
  reason: string;
};

export type SteamTaskSourceOpsReport = {
  schemaVersion: "steambench.steam-task-source-ops-report.v1";
  generatedAt: string;
  appid: number;
  gameName: string;
  status: SteamTaskSourceOpsStatus;
  sources: {
    achievement: {
      source: "fixture" | "steam-live";
      achievements: number;
      active: number;
      candidates: number;
      rejected: number;
      recommendedImports: number;
      warning?: string;
    };
    stat: {
      source: "fixture" | "steam-live";
      stats: number;
      proposed: number;
      newProposals: number;
      reviewRequired: number;
      warning?: string;
    };
    leaderboard: {
      source: "fixture" | "steam-live";
      leaderboards: number;
      proposed: number;
      newProposals: number;
      reviewRequired: number;
      warning?: string;
    };
  };
  registry: {
    active: number;
    candidates: number;
    rejected: number;
    candidateReviewRequired: number;
    activeTracks: BenchmarkTrack[];
    candidateTracks: BenchmarkTrack[];
    missingCandidateTracks: BenchmarkTrack[];
  };
  totals: {
    sourceRecords: number;
    newImportsAvailable: number;
    publishableCandidates: number;
  };
  recommendedActions: SteamTaskSourceOpsAction[];
  links: {
    achievementLadder: string;
    importAchievementRecommendations: string;
    statProposals: string;
    importStatProposals: string;
    leaderboardProposals: string;
    importLeaderboardProposals: string;
    publishCandidates: string;
    benchmarkBlueprint: string;
    coveragePlan: string;
    onboarding: string;
  };
};

function uniqueTracks(tasks: Array<Pick<BenchmarkTask, "track">>): BenchmarkTrack[] {
  return [...new Set(tasks.map((task) => task.track))].sort();
}

function countNewProposalTasks(tasks: BenchmarkTask[], knownTaskIds: Set<string>) {
  return tasks.filter((task) => !knownTaskIds.has(task.id)).length;
}

function reportStatus(input: {
  candidates: number;
  newImportsAvailable: number;
  active: number;
  sourceRecords: number;
}): SteamTaskSourceOpsStatus {
  if (input.candidates > 0) return "ready-to-publish";
  if (input.newImportsAvailable > 0) return "ready-to-import";
  if (input.active > 0) return "catalog-ready";
  return input.sourceRecords > 0 ? "ready-to-import" : "needs-source-data";
}

function buildRecommendedActions(input: {
  appid: number;
  achievementRecommendedImports: number;
  statNewProposals: number;
  leaderboardNewProposals: number;
  candidateCount: number;
  candidateReviewRequired: number;
}): SteamTaskSourceOpsAction[] {
  const actions: SteamTaskSourceOpsAction[] = [];
  if (input.achievementRecommendedImports > 0) {
    actions.push({
      id: "import-achievement-recommendations",
      label: "Import achievement recommendations",
      priority: "high",
      method: "POST",
      endpoint: `/api/steam/apps/${input.appid}/achievement-ladder/import-recommended`,
      reason: `${input.achievementRecommendedImports} achievement recommendation(s) are not in the task registry yet.`
    });
  }
  if (input.statNewProposals > 0) {
    actions.push({
      id: "import-stat-proposals",
      label: "Import stat proposals",
      priority: actions.length === 0 ? "high" : "medium",
      method: "POST",
      endpoint: `/api/steam/apps/${input.appid}/stat-proposals/import-recommended`,
      reason: `${input.statNewProposals} Steam stat proposal(s) can become review candidates.`
    });
  }
  if (input.leaderboardNewProposals > 0) {
    actions.push({
      id: "import-leaderboard-proposals",
      label: "Import leaderboard proposals",
      priority: actions.length === 0 ? "high" : "medium",
      method: "POST",
      endpoint: `/api/steam/apps/${input.appid}/leaderboard-proposals/import-recommended`,
      reason: `${input.leaderboardNewProposals} Steam leaderboard proposal(s) can become controlled review candidates.`
    });
  }
  if (input.candidateCount > 0) {
    actions.push({
      id: "publish-candidates",
      label: "Publish review-cleared candidates",
      priority: actions.length === 0 ? "high" : "medium",
      method: "POST",
      endpoint: `/api/steam/apps/${input.appid}/publish-candidates`,
      body: { reviewApproved: input.candidateReviewRequired === 0 },
      reason: `${input.candidateCount} candidate task(s) are waiting in the registry.`
    });
  }
  actions.push({
    id: "inspect-benchmark-blueprint",
    label: "Inspect benchmark blueprint",
    priority: "low",
    method: "GET",
    endpoint: `/api/games/${input.appid}/benchmark-blueprint`,
    reason: "Use the blueprint to confirm readiness, review blockers, suite shape, and coverage gaps before scheduling runs."
  });
  return actions;
}

export function buildSteamTaskSourceOpsReport(input: {
  appid: number;
  gameName: string;
  discovery?: SteamAppDiscoveryCandidate;
  ladder: SteamAchievementBenchmarkLadder;
  achievementSource: "fixture" | "steam-live";
  achievementWarning?: string;
  statProposalRun: {
    source: "fixture" | "steam-live";
    stats: number;
    proposed: number;
    reviewRequired: number;
  };
  statTasks: BenchmarkTask[];
  statWarning?: string;
  leaderboardProposalRun: {
    source: "fixture" | "steam-live";
    leaderboards: number;
    proposed: number;
    reviewRequired: number;
  };
  leaderboardTasks: BenchmarkTask[];
  leaderboardWarning?: string;
  activeTasks: BenchmarkTask[];
  taskRegistry: TaskRegistryEntry[];
  generatedAt?: string;
}): SteamTaskSourceOpsReport {
  const activeTasks = input.activeTasks.filter((task) => task.appid === input.appid);
  const registry = input.taskRegistry.filter((task) => task.appid === input.appid);
  const registryIds = new Set(registry.map((task) => task.id));
  const activeIds = new Set(activeTasks.map((task) => task.id));
  const knownTaskIds = new Set([...registryIds, ...activeIds]);
  const candidates = registry.filter((task) => task.status === "candidate");
  const rejected = registry.filter((task) => task.status === "rejected");
  const statNewProposals = countNewProposalTasks(input.statTasks, knownTaskIds);
  const leaderboardNewProposals = countNewProposalTasks(input.leaderboardTasks, knownTaskIds);
  const candidateReviewRequired = candidates.filter((task) => task.reviewRequired).length;
  const candidateTracks = uniqueTracks(candidates);
  const activeTracks = uniqueTracks(activeTasks);
  const sourceTracks = uniqueTracks([...input.ladder.recommendedImports.map((entry) => entry.task), ...input.statTasks, ...input.leaderboardTasks]);
  const missingCandidateTracks = sourceTracks.filter((track) => !candidateTracks.includes(track) && !activeTracks.includes(track));
  const newImportsAvailable = input.ladder.totals.recommendedImports + statNewProposals + leaderboardNewProposals;
  const sourceRecords = input.ladder.totals.achievements + input.statProposalRun.stats + input.leaderboardProposalRun.leaderboards;
  const links = {
    achievementLadder: `/api/steam/apps/${input.appid}/achievement-ladder`,
    importAchievementRecommendations: `/api/steam/apps/${input.appid}/achievement-ladder/import-recommended`,
    statProposals: `/api/steam/apps/${input.appid}/stat-proposals`,
    importStatProposals: `/api/steam/apps/${input.appid}/stat-proposals/import-recommended`,
    leaderboardProposals: `/api/steam/apps/${input.appid}/leaderboard-proposals`,
    importLeaderboardProposals: `/api/steam/apps/${input.appid}/leaderboard-proposals/import-recommended`,
    publishCandidates: `/api/steam/apps/${input.appid}/publish-candidates`,
    benchmarkBlueprint: `/api/games/${input.appid}/benchmark-blueprint`,
    coveragePlan: `/api/games/${input.appid}/coverage-plan`,
    onboarding: `/api/steam/apps/${input.appid}/onboarding`
  };

  return {
    schemaVersion: "steambench.steam-task-source-ops-report.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    appid: input.appid,
    gameName: input.discovery?.name ?? input.gameName,
    status: reportStatus({
      candidates: candidates.length,
      newImportsAvailable,
      active: activeTasks.length,
      sourceRecords
    }),
    sources: {
      achievement: {
        source: input.achievementSource,
        achievements: input.ladder.totals.achievements,
        active: input.ladder.totals.active,
        candidates: input.ladder.totals.candidates,
        rejected: input.ladder.totals.rejected,
        recommendedImports: input.ladder.totals.recommendedImports,
        warning: input.achievementWarning
      },
      stat: {
        source: input.statProposalRun.source,
        stats: input.statProposalRun.stats,
        proposed: input.statProposalRun.proposed,
        newProposals: statNewProposals,
        reviewRequired: input.statProposalRun.reviewRequired,
        warning: input.statWarning
      },
      leaderboard: {
        source: input.leaderboardProposalRun.source,
        leaderboards: input.leaderboardProposalRun.leaderboards,
        proposed: input.leaderboardProposalRun.proposed,
        newProposals: leaderboardNewProposals,
        reviewRequired: input.leaderboardProposalRun.reviewRequired,
        warning: input.leaderboardWarning
      }
    },
    registry: {
      active: activeTasks.length,
      candidates: candidates.length,
      rejected: rejected.length,
      candidateReviewRequired,
      activeTracks,
      candidateTracks,
      missingCandidateTracks
    },
    totals: {
      sourceRecords,
      newImportsAvailable,
      publishableCandidates: candidates.length
    },
    recommendedActions: buildRecommendedActions({
      appid: input.appid,
      achievementRecommendedImports: input.ladder.totals.recommendedImports,
      statNewProposals,
      leaderboardNewProposals,
      candidateCount: candidates.length,
      candidateReviewRequired
    }),
    links
  };
}
