import { describe, expect, it } from "vitest";
import { buildTaskReview } from "../benchmark/task-review";
import type { BenchmarkTask, GameCatalogEntry } from "../benchmark/types";
import type { SteamAchievementBenchmarkLadder } from "./steam-achievement-ladder";
import type { TaskRegistryEntry } from "./store";
import { buildSteamTaskSourceOpsReport } from "./steam-task-source-ops";

const game: GameCatalogEntry = {
  appid: 620,
  name: "Portal 2",
  capsuleUrl: "https://cdn.example/portal2.jpg",
  headerUrl: "https://cdn.example/portal2-header.jpg",
  tracks: ["achievement", "stat", "leaderboard"],
  genres: ["Puzzle"],
  harnessRisk: "medium",
  benchmarkFit: 92,
  notes: "fixture"
};

function task(id: string, track: BenchmarkTask["track"], reviewRequired = false): BenchmarkTask {
  return {
    id,
    appid: 620,
    gameName: game.name,
    title: id,
    track,
    level: 4,
    score: 5000,
    objective: "Complete the benchmark contract.",
    proof: ["Canonical output/output.mp4 video artifact."],
    estimatedRuntimeMinutes: 12,
    suitability: reviewRequired ? "needs-review" : "ranked",
    suitabilityScore: reviewRequired ? 50 : 80,
    reviewRequired,
    fairnessVerdict: reviewRequired ? "controlled" : "good",
    riskFlags: reviewRequired ? ["leaderboardSnapshot"] : [],
    source: "fixture",
    signalSource: track === "leaderboard" ? "steam-leaderboard" : track === "stat" ? "steam-stat" : "steam-achievement"
  };
}

function ladder(recommended: BenchmarkTask[]): SteamAchievementBenchmarkLadder {
  return {
    schemaVersion: "steambench.steam-achievement-benchmark-ladder.v1",
    generatedAt: "2026-06-14T00:00:00.000Z",
    appid: 620,
    game,
    source: "fixture",
    canonicalArtifactName: "output.mp4",
    selectionRules: [],
    totals: {
      achievements: 3,
      active: 0,
      candidates: 0,
      rejected: 0,
      new: recommended.length,
      rankedReady: recommended.length,
      reviewRequired: 0,
      recommendedImports: recommended.length
    },
    bands: [],
    recommendedImports: recommended.map((entry) => ({
      task: entry,
      review: buildTaskReview(entry),
      importStatus: "new",
      recommendation: "import-candidate",
      reasons: []
    })),
    nextActions: [],
    links: {
      achievementTasks: "/api/steam/apps/620/achievement-tasks",
      importAchievements: "/api/steam/apps/620/import-achievements",
      importRecommended: "/api/steam/apps/620/achievement-ladder/import-recommended",
      publishCandidates: "/api/steam/apps/620/publish-candidates",
      coveragePlan: "/api/games/620/coverage-plan",
      benchmarkBlueprint: "/api/games/620/benchmark-blueprint"
    }
  };
}

describe("steam task source ops report", () => {
  it("prioritizes safe imports when source proposals are new", () => {
    const achievementTask = task("620:ACH.NEW", "achievement");
    const statTask = task("620:STAT.PORTALS", "stat");
    const leaderboardTask = task("620:LDRB.TIME", "leaderboard", true);

    const report = buildSteamTaskSourceOpsReport({
      appid: 620,
      gameName: game.name,
      ladder: ladder([achievementTask]),
      achievementSource: "fixture",
      statProposalRun: {
        source: "fixture",
        stats: 2,
        proposed: 1,
        reviewRequired: 0
      },
      statTasks: [statTask],
      leaderboardProposalRun: {
        source: "fixture",
        leaderboards: 2,
        proposed: 1,
        reviewRequired: 1
      },
      leaderboardTasks: [leaderboardTask],
      activeTasks: [],
      taskRegistry: [],
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report).toMatchObject({
      schemaVersion: "steambench.steam-task-source-ops-report.v1",
      status: "ready-to-import",
      totals: {
        sourceRecords: 7,
        newImportsAvailable: 3,
        publishableCandidates: 0
      },
      sources: {
        achievement: { recommendedImports: 1 },
        stat: { proposed: 1, newProposals: 1 },
        leaderboard: { proposed: 1, newProposals: 1, reviewRequired: 1 }
      }
    });
    expect(report.registry.missingCandidateTracks).toEqual(["achievement", "leaderboard", "stat"]);
    expect(report.recommendedActions.map((action) => action.id)).toEqual([
      "import-achievement-recommendations",
      "import-stat-proposals",
      "import-leaderboard-proposals",
      "inspect-benchmark-blueprint"
    ]);
  });

  it("prioritizes publication when candidates already exist", () => {
    const active = task("620:ACH.ACTIVE", "achievement");
    const candidate: TaskRegistryEntry = {
      ...task("620:LDRB.TIME", "leaderboard", true),
      status: "candidate",
      importedAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z"
    };

    const report = buildSteamTaskSourceOpsReport({
      appid: 620,
      gameName: game.name,
      ladder: ladder([]),
      achievementSource: "fixture",
      statProposalRun: {
        source: "fixture",
        stats: 0,
        proposed: 0,
        reviewRequired: 0
      },
      statTasks: [],
      leaderboardProposalRun: {
        source: "fixture",
        leaderboards: 1,
        proposed: 1,
        reviewRequired: 1
      },
      leaderboardTasks: [candidate],
      activeTasks: [active],
      taskRegistry: [candidate],
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.status).toBe("ready-to-publish");
    expect(report.sources.leaderboard.newProposals).toBe(0);
    expect(report.registry).toMatchObject({
      active: 1,
      candidates: 1,
      candidateReviewRequired: 1,
      activeTracks: ["achievement"],
      candidateTracks: ["leaderboard"]
    });
    expect(report.recommendedActions.map((action) => action.id)).toEqual([
      "publish-candidates",
      "inspect-benchmark-blueprint"
    ]);
  });
});
