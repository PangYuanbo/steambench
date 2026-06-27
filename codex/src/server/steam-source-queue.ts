import type { SteamTaskSourceOpsAction, SteamTaskSourceOpsReport } from "./steam-task-source-ops";
import type { SteamAppDiscoveryCandidate } from "./store";

export type SteamSourceQueueItem = {
  appid: number;
  gameName: string;
  discoveryStatus?: SteamAppDiscoveryCandidate["status"];
  benchmarkFit?: number;
  harnessRisk?: SteamAppDiscoveryCandidate["harnessRisk"];
  status: SteamTaskSourceOpsReport["status"];
  priorityScore: number;
  sourceRecords: number;
  newImportsAvailable: number;
  publishableCandidates: number;
  sourceBreakdown: {
    achievement: {
      records: number;
      recommendedImports: number;
      active: number;
      candidates: number;
      rejected: number;
    };
    stat: {
      records: number;
      proposed: number;
      newProposals: number;
      reviewRequired: number;
    };
    leaderboard: {
      records: number;
      proposed: number;
      newProposals: number;
      reviewRequired: number;
    };
  };
  registryTracks: {
    active: string[];
    candidates: string[];
    missingCandidates: string[];
  };
  activeTasks: number;
  candidateTasks: number;
  recommendedAction?: SteamTaskSourceOpsAction;
  actionIds: string[];
  reasons: string[];
  links: {
    taskSourceOps: string;
    onboarding: string;
    benchmarkBlueprint: string;
    coveragePlan: string;
  };
};

export type SteamSourceQueue = {
  schemaVersion: "steambench.steam-source-queue.v1";
  generatedAt: string;
  limit: number;
  totals: {
    apps: number;
    readyToPublish: number;
    readyToImport: number;
    catalogReady: number;
    needsSourceData: number;
    sourceRecords: number;
    newImportsAvailable: number;
    publishableCandidates: number;
    achievementRecords: number;
    statRecords: number;
    leaderboardRecords: number;
    achievementImportsAvailable: number;
    statImportsAvailable: number;
    leaderboardImportsAvailable: number;
  };
  items: SteamSourceQueueItem[];
  recommendedActions: Array<{
    id: string;
    appid: number;
    gameName: string;
    priority: SteamTaskSourceOpsAction["priority"];
    method: SteamTaskSourceOpsAction["method"];
    endpoint: string;
    body?: Record<string, unknown>;
    reason: string;
  }>;
  links: {
    steamDiscovery: "/api/steam/apps/discovery";
    platformOps: "/api/platform/ops-report";
  };
};

function statusPriority(status: SteamTaskSourceOpsReport["status"]): number {
  if (status === "ready-to-publish") return 4;
  if (status === "ready-to-import") return 3;
  if (status === "catalog-ready") return 2;
  return 1;
}

function riskAdjustment(risk?: SteamAppDiscoveryCandidate["harnessRisk"]): number {
  if (risk === "low") return 60;
  if (risk === "high") return -140;
  return 0;
}

function priorityScore(input: {
  ops: SteamTaskSourceOpsReport;
  discovery?: SteamAppDiscoveryCandidate;
}): number {
  const fit = input.discovery?.benchmarkFit ?? 70;
  return (
    statusPriority(input.ops.status) * 1000 +
    input.ops.totals.publishableCandidates * 450 +
    input.ops.totals.newImportsAvailable * 180 +
    input.ops.totals.sourceRecords * 4 +
    fit +
    riskAdjustment(input.discovery?.harnessRisk)
  );
}

function primaryAction(ops: SteamTaskSourceOpsReport): SteamTaskSourceOpsAction | undefined {
  return ops.recommendedActions.find((action) => action.id !== "inspect-benchmark-blueprint")
    ?? ops.recommendedActions[0];
}

function reasonsFor(input: {
  ops: SteamTaskSourceOpsReport;
  discovery?: SteamAppDiscoveryCandidate;
  action?: SteamTaskSourceOpsAction;
}): string[] {
  const reasons = [
    `${input.ops.totals.sourceRecords} Steam source record(s) inspected across achievements, stats, and leaderboards.`,
    `${input.ops.totals.newImportsAvailable} new task import(s) and ${input.ops.totals.publishableCandidates} publishable candidate(s) available.`
  ];
  if (input.discovery) {
    reasons.push(`Discovery fit ${input.discovery.benchmarkFit}/100 with ${input.discovery.harnessRisk} harness risk.`);
  }
  if (input.action) {
    reasons.push(`Next action: ${input.action.label}.`);
  }
  return reasons;
}

export function buildSteamSourceQueue(input: {
  entries: Array<{
    ops: SteamTaskSourceOpsReport;
    discovery?: SteamAppDiscoveryCandidate;
  }>;
  limit?: number;
  generatedAt?: string;
}): SteamSourceQueue {
  const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 10)));
  const items = input.entries
    .map((entry) => {
      const action = primaryAction(entry.ops);
      return {
        appid: entry.ops.appid,
        gameName: entry.ops.gameName,
        discoveryStatus: entry.discovery?.status,
        benchmarkFit: entry.discovery?.benchmarkFit,
        harnessRisk: entry.discovery?.harnessRisk,
        status: entry.ops.status,
        priorityScore: priorityScore(entry),
        sourceRecords: entry.ops.totals.sourceRecords,
        newImportsAvailable: entry.ops.totals.newImportsAvailable,
        publishableCandidates: entry.ops.totals.publishableCandidates,
        sourceBreakdown: {
          achievement: {
            records: entry.ops.sources.achievement.achievements,
            recommendedImports: entry.ops.sources.achievement.recommendedImports,
            active: entry.ops.sources.achievement.active,
            candidates: entry.ops.sources.achievement.candidates,
            rejected: entry.ops.sources.achievement.rejected
          },
          stat: {
            records: entry.ops.sources.stat.stats,
            proposed: entry.ops.sources.stat.proposed,
            newProposals: entry.ops.sources.stat.newProposals,
            reviewRequired: entry.ops.sources.stat.reviewRequired
          },
          leaderboard: {
            records: entry.ops.sources.leaderboard.leaderboards,
            proposed: entry.ops.sources.leaderboard.proposed,
            newProposals: entry.ops.sources.leaderboard.newProposals,
            reviewRequired: entry.ops.sources.leaderboard.reviewRequired
          }
        },
        registryTracks: {
          active: entry.ops.registry.activeTracks,
          candidates: entry.ops.registry.candidateTracks,
          missingCandidates: entry.ops.registry.missingCandidateTracks
        },
        activeTasks: entry.ops.registry.active,
        candidateTasks: entry.ops.registry.candidates,
        recommendedAction: action,
        actionIds: entry.ops.recommendedActions.map((candidate) => candidate.id),
        reasons: reasonsFor({ ops: entry.ops, discovery: entry.discovery, action }),
        links: {
          taskSourceOps: `/api/steam/apps/${entry.ops.appid}/task-source-ops`,
          onboarding: entry.ops.links.onboarding,
          benchmarkBlueprint: entry.ops.links.benchmarkBlueprint,
          coveragePlan: entry.ops.links.coveragePlan
        }
      } satisfies SteamSourceQueueItem;
    })
    .sort((left, right) =>
      right.priorityScore - left.priorityScore ||
      right.newImportsAvailable - left.newImportsAvailable ||
      right.publishableCandidates - left.publishableCandidates ||
      left.gameName.localeCompare(right.gameName)
    )
    .slice(0, limit);

  return {
    schemaVersion: "steambench.steam-source-queue.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    limit,
    totals: {
      apps: items.length,
      readyToPublish: items.filter((item) => item.status === "ready-to-publish").length,
      readyToImport: items.filter((item) => item.status === "ready-to-import").length,
      catalogReady: items.filter((item) => item.status === "catalog-ready").length,
      needsSourceData: items.filter((item) => item.status === "needs-source-data").length,
      sourceRecords: items.reduce((total, item) => total + item.sourceRecords, 0),
      newImportsAvailable: items.reduce((total, item) => total + item.newImportsAvailable, 0),
      publishableCandidates: items.reduce((total, item) => total + item.publishableCandidates, 0),
      achievementRecords: items.reduce((total, item) => total + item.sourceBreakdown.achievement.records, 0),
      statRecords: items.reduce((total, item) => total + item.sourceBreakdown.stat.records, 0),
      leaderboardRecords: items.reduce((total, item) => total + item.sourceBreakdown.leaderboard.records, 0),
      achievementImportsAvailable: items.reduce((total, item) => total + item.sourceBreakdown.achievement.recommendedImports, 0),
      statImportsAvailable: items.reduce((total, item) => total + item.sourceBreakdown.stat.newProposals, 0),
      leaderboardImportsAvailable: items.reduce((total, item) => total + item.sourceBreakdown.leaderboard.newProposals, 0)
    },
    items,
    recommendedActions: items
      .flatMap((item) => item.recommendedAction
        ? [{
            id: `steam-source:${item.appid}:${item.recommendedAction.id}`,
            appid: item.appid,
            gameName: item.gameName,
            priority: item.recommendedAction.priority,
            method: item.recommendedAction.method,
            endpoint: item.recommendedAction.endpoint,
            body: item.recommendedAction.body,
            reason: item.recommendedAction.reason
          }]
        : []
      )
      .slice(0, 5),
    links: {
      steamDiscovery: "/api/steam/apps/discovery",
      platformOps: "/api/platform/ops-report"
    }
  };
}
