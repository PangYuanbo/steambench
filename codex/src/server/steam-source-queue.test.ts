import { describe, expect, it } from "vitest";
import type { SteamTaskSourceOpsReport } from "./steam-task-source-ops";
import type { SteamAppDiscoveryCandidate } from "./store";
import { buildSteamSourceQueue } from "./steam-source-queue";

function ops(input: {
  appid: number;
  gameName: string;
  status: SteamTaskSourceOpsReport["status"];
  newImportsAvailable: number;
  publishableCandidates: number;
  sourceRecords?: number;
  statNewProposals?: number;
  leaderboardNewProposals?: number;
  missingCandidateTracks?: SteamTaskSourceOpsReport["registry"]["missingCandidateTracks"];
  actionId?: string;
}): SteamTaskSourceOpsReport {
  const actionId = input.actionId ?? (
    input.publishableCandidates > 0 ? "publish-candidates" : "import-achievement-recommendations"
  );
  return {
    schemaVersion: "steambench.steam-task-source-ops-report.v1",
    generatedAt: "2026-06-14T00:00:00.000Z",
    appid: input.appid,
    gameName: input.gameName,
    status: input.status,
    sources: {
      achievement: { source: "fixture", achievements: 2, active: 0, candidates: 0, rejected: 0, recommendedImports: input.newImportsAvailable },
      stat: { source: "fixture", stats: 1, proposed: 1, newProposals: input.statNewProposals ?? 0, reviewRequired: 0 },
      leaderboard: { source: "fixture", leaderboards: 1, proposed: 1, newProposals: input.leaderboardNewProposals ?? 0, reviewRequired: 0 }
    },
    registry: {
      active: input.status === "catalog-ready" ? 2 : 0,
      candidates: input.publishableCandidates,
      rejected: 0,
      candidateReviewRequired: 0,
      activeTracks: [],
      candidateTracks: [],
      missingCandidateTracks: input.missingCandidateTracks ?? []
    },
    totals: {
      sourceRecords: input.sourceRecords ?? 4,
      newImportsAvailable: input.newImportsAvailable,
      publishableCandidates: input.publishableCandidates
    },
    recommendedActions: [
      {
        id: actionId as SteamTaskSourceOpsReport["recommendedActions"][number]["id"],
        label: actionId,
        priority: input.publishableCandidates > 0 ? "high" : "medium",
        method: "POST",
        endpoint: `/api/steam/apps/${input.appid}/${actionId}`,
        reason: `${actionId} now`
      },
      {
        id: "inspect-benchmark-blueprint",
        label: "Inspect benchmark blueprint",
        priority: "low",
        method: "GET",
        endpoint: `/api/games/${input.appid}/benchmark-blueprint`,
        reason: "inspect"
      }
    ],
    links: {
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
    }
  };
}

function discovery(input: {
  appid: number;
  name: string;
  benchmarkFit: number;
  harnessRisk: SteamAppDiscoveryCandidate["harnessRisk"];
}): SteamAppDiscoveryCandidate {
  return {
    id: `discovery_${input.appid}`,
    appid: input.appid,
    name: input.name,
    query: "fixture",
    source: "fixture",
    status: "shortlisted",
    benchmarkFit: input.benchmarkFit,
    harnessRisk: input.harnessRisk,
    tracks: ["achievement"],
    estimatedAchievementTasks: 2,
    reasons: [],
    riskNotes: [],
    discoveredAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z"
  };
}

describe("steam source queue", () => {
  it("prioritizes publishable candidates before import-only apps", () => {
    const queue = buildSteamSourceQueue({
      entries: [
        {
          discovery: discovery({ appid: 620, name: "Portal 2", benchmarkFit: 92, harnessRisk: "medium" }),
          ops: ops({ appid: 620, gameName: "Portal 2", status: "ready-to-import", newImportsAvailable: 5, publishableCandidates: 0 })
        },
        {
          discovery: discovery({ appid: 1145360, name: "Hades", benchmarkFit: 90, harnessRisk: "low" }),
          ops: ops({ appid: 1145360, gameName: "Hades", status: "ready-to-publish", newImportsAvailable: 0, publishableCandidates: 2 })
        }
      ],
      limit: 5,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(queue).toMatchObject({
      schemaVersion: "steambench.steam-source-queue.v1",
      totals: {
        apps: 2,
        readyToPublish: 1,
        readyToImport: 1,
        newImportsAvailable: 5,
        publishableCandidates: 2,
        achievementRecords: 4,
        statRecords: 2,
        leaderboardRecords: 2,
        achievementImportsAvailable: 5,
        statImportsAvailable: 0,
        leaderboardImportsAvailable: 0
      }
    });
    expect(queue.items[1]).toMatchObject({
      appid: 620,
      sourceBreakdown: {
        achievement: {
          records: 2,
          recommendedImports: 5
        },
        stat: {
          records: 1,
          newProposals: 0
        },
        leaderboard: {
          records: 1,
          newProposals: 0
        }
      },
      registryTracks: {
        missingCandidates: []
      }
    });
    expect(queue.items.map((item) => item.appid)).toEqual([1145360, 620]);
    expect(queue.recommendedActions[0]).toMatchObject({
      id: "steam-source:1145360:publish-candidates",
      endpoint: "/api/steam/apps/1145360/publish-candidates"
    });
  });
});
