import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runPublicSteamIntake } from "./public-steam-intake.mjs";

let server;

function intake(baseUrl, { complete = true } = {}) {
  return {
    schemaVersion: "steambench.public-steam-app-intake.v1",
    generatedAt: "2026-06-15T00:00:00.000Z",
    appid: 620,
    canonicalArtifactName: "output.mp4",
    publicReadiness: complete ? "publication-ready" : "needs-source-data",
    request: {
      useFixture: true,
      refresh: false,
      limit: 2
    },
    dataPolicy: {
      steamLiveEnabled: false,
      officialSteamSourcesOnly: true,
      proofConsentRequiredBeforePublicRanking: true,
      cache: { defaultTtlSeconds: 21600, entries: [] },
      allowedSources: [
        "ISteamApps/GetAppList/v2",
        "ISteamUserStats/GetGlobalAchievementPercentagesForApp"
      ]
    },
    game: {
      appid: 620,
      name: "Portal 2",
      benchmarkFit: 92,
      harnessRisk: "medium",
      tracks: ["achievement", "stat", "leaderboard"]
    },
    intake: {
      status: complete ? "publication-ready" : "discovery-needed",
      readinessScore: complete ? 84 : 20,
      sourceStatus: complete ? "ready-to-publish" : "needs-source-data",
      blueprintStatus: complete ? "review-required" : "needs-steam-data",
      nextActions: complete ? ["Publish candidates: /api/steam/apps/620/publish-candidates"] : [],
      warnings: []
    },
    sourceCoverage: {
      totals: {
        sourceRecords: complete ? 12 : 0,
        newImportsAvailable: complete ? 2 : 0,
        publishableCandidates: complete ? 4 : 0
      },
      missingTracks: [],
      sources: {
        achievement: { source: "fixture", records: 8, newImports: 2 },
        stat: { source: "fixture", records: 2, proposed: 2 },
        leaderboard: { source: "fixture", records: 2, proposed: 2 }
      },
      recommendedActions: complete
        ? [
            {
              id: "publish-candidates",
              label: "Publish candidates",
              priority: "high",
              method: "POST",
              endpoint: `${baseUrl}/api/steam/apps/620/publish-candidates`,
              body: { reviewApproved: true },
              reason: "publish"
            }
          ]
        : []
    },
    taskPipeline: {
      activeTasks: complete ? 2 : 0,
      candidateTasks: complete ? 4 : 0,
      rejectedTasks: 0,
      rankedReadyTasks: complete ? 2 : 0,
      reviewRequiredTasks: complete ? 2 : 0,
      suites: complete
        ? [{ id: "620:starter", tier: "starter", title: "Starter", status: "ranked-ready", taskCount: 2, readinessScore: 80 }]
        : [],
      taskLadder: [
        { id: "starter", label: "Starter ladder", levelRange: { min: 1, max: 3 }, taskCount: complete ? 2 : 0, activeTasks: 1, candidateTasks: 1, rankedReadyTasks: 1, reviewRequiredTasks: 0, recommendedTaskIds: ["620:ACH.WAKE_UP"], gaps: [] },
        { id: "ranked", label: "Ranked ladder", levelRange: { min: 4, max: 6 }, taskCount: complete ? 2 : 0, activeTasks: 1, candidateTasks: 1, rankedReadyTasks: 1, reviewRequiredTasks: 0, recommendedTaskIds: ["620:STAT.PORTALS"], gaps: [] },
        { id: "expert", label: "Expert ladder", levelRange: { min: 7, max: 10 }, taskCount: complete ? 1 : 0, activeTasks: 0, candidateTasks: 1, rankedReadyTasks: 0, reviewRequiredTasks: 1, recommendedTaskIds: ["620:LDRB.LEAST_PORTALS"], gaps: [] }
      ]
    },
    onboarding: {
      status: complete ? "publication-ready" : "discovery-needed",
      readinessScore: complete ? 84 : 20,
      stages: [
        { id: "discovery", label: "Discovery", status: "complete", summary: "discovered", metrics: {}, action: { id: "discovery", label: "Discover", method: "POST", endpoint: `${baseUrl}/api/steam/apps/discover` } },
        { id: "achievement-ladder", label: "Achievement ladder", status: complete ? "complete" : "pending", summary: "ladder", metrics: {}, action: { id: "achievement-ladder", label: "Import", method: "POST", endpoint: `${baseUrl}/api/steam/apps/620/achievement-ladder/import-recommended` } },
        { id: "task-publication", label: "Task publication", status: complete ? "ready" : "pending", summary: "publish", metrics: {}, action: { id: "task-publication", label: "Publish", method: "POST", endpoint: `${baseUrl}/api/steam/apps/620/publish-candidates` } },
        { id: "coverage", label: "Coverage", status: "pending", summary: "coverage", metrics: {}, action: { id: "coverage", label: "Run coverage", method: "POST", endpoint: `${baseUrl}/api/games/620/coverage-plan/run-local` } },
        { id: "competition", label: "Competition", status: "blocked", summary: "competition", metrics: {}, action: { id: "competition", label: "Open standings", method: "GET", endpoint: `${baseUrl}/api/games/620/standings` } }
      ],
      nextActions: complete ? ["Publish candidates: /api/steam/apps/620/publish-candidates"] : []
    },
    runtimeContract: {
      targetArtifactName: "output.mp4",
      stage2StartConstraints: complete ? ["Do not call session.run_file(...) in Stage 2 start()."] : [],
      proofRequirements: ["Canonical capture artifact output/output.mp4."],
      readinessChecks: ["Steam runtime installed."],
      agentLoopHints: ["Observe before acting."],
      adapter: { appid: 620, gameName: "Portal 2" }
    },
    publicEntrypoints: {
	      benchmarkPack: `${baseUrl}/api/public/games/620/benchmark-pack?season=all&limit=2`,
	      agentOnboarding: complete ? `${baseUrl}/api/public/agents/onboarding?taskId={taskId}&provider=external` : "",
	      taskScoreboardTemplate: `${baseUrl}/api/public/tasks/{taskId}/scoreboard?season=all`,
	      taskActionSpaceTemplate: complete ? `${baseUrl}/api/public/tasks/{taskId}/action-space` : "",
	      raceEntryTemplate: complete ? `${baseUrl}/api/public/tasks/{taskId}/race-entry` : "",
	      runnerContractTemplate: complete ? `${baseUrl}/api/public/tasks/{taskId}/runner-contract` : "",
      publicWatchTemplate: complete ? `${baseUrl}/api/public/broadcasts/{streamId}/watch` : "",
      publicSnapshot: `${baseUrl}/api/public/benchmark-snapshot?season=all&limit=2`,
      certificateVerify: `${baseUrl}/api/result-certificates/verify`
    },
    operatorEntrypoints: {
      taskSourceOps: `${baseUrl}/api/steam/apps/620/task-source-ops?useFixture=true&limit=2`,
      onboarding: `${baseUrl}/api/steam/apps/620/onboarding?useFixture=true&limit=2`,
      achievementLadder: `${baseUrl}/api/steam/apps/620/achievement-ladder?useFixture=true`,
      importRecommended: `${baseUrl}/api/steam/apps/620/achievement-ladder/import-recommended`,
      publishCandidates: `${baseUrl}/api/steam/apps/620/publish-candidates`,
      runCoverageLocal: `${baseUrl}/api/games/620/coverage-plan/run-local`,
      runOnboardingLocal: `${baseUrl}/api/steam/apps/620/onboarding/run-local`
    },
    links: {
      blueprint: `${baseUrl}/api/games/620/benchmark-blueprint?includeSourcePlan=true&useFixture=true&limit=2`,
      coveragePlan: `${baseUrl}/api/games/620/coverage-plan`,
      standings: `${baseUrl}/api/games/620/standings?season=all`,
      resultCertificate: `${baseUrl}/api/games/620/result-certificate?season=all`
    }
  };
}

async function startMockPublicApi({ complete = true } = {}) {
  const calls = [];
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    calls.push({ method: request.method, path: url.pathname, search: url.search });
    response.setHeader("content-type", "application/json");
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    if (request.method === "GET" && url.pathname === "/api/public/steam/apps/620/intake") {
      response.end(JSON.stringify({ intake: intake(baseUrl, { complete }) }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { baseUrl: `http://127.0.0.1:${address.port}`, calls };
}

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

describe("public Steam intake CLI", () => {
  it("validates a public Steam app intake packet", async () => {
    const { baseUrl, calls } = await startMockPublicApi();
    const result = await runPublicSteamIntake({
      baseUrl,
      appid: 620,
      useFixture: true,
      refresh: false,
      limit: 2
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.public-steam-intake-cli.v1",
      api: baseUrl,
      request: {
        appid: 620,
        useFixture: true,
        limit: 2
      },
      validation: {
        valid: true,
        errors: []
      },
      summary: {
        valid: true,
        appid: 620,
        game: "Portal 2",
        publicReadiness: "publication-ready",
        sourceStatus: "ready-to-publish",
        sourceRecords: 12,
        activeTasks: 2,
        candidateTasks: 4,
        rankedReadyTasks: 2,
        reviewRequiredTasks: 2,
        suites: 1,
        onboardingStatus: "publication-ready",
        actions: ["publish-candidates"]
      }
    });
    expect(result.summary.onboardingStages).toContain("task-publication:ready");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/public/steam/apps/620/intake"
    ]);
    expect(calls[0].search).toContain("useFixture=true");
  });

  it("marks an intake packet invalid when public runner/watch and Stage 2 contracts are missing", async () => {
    const { baseUrl } = await startMockPublicApi({ complete: false });
    const result = await runPublicSteamIntake({
      baseUrl,
      appid: 620,
      useFixture: true,
      refresh: false,
      limit: 2
    });

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors).toEqual(expect.arrayContaining([
      "stage2_constraints_missing",
      "public_runner_template_missing",
      "public_watch_template_missing"
    ]));
    expect(result.summary).toMatchObject({
      valid: false,
      publicReadiness: "needs-source-data",
      sourceStatus: "needs-source-data"
    });
  });
});
