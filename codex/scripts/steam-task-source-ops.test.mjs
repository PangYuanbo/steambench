import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runSteamTaskSourceOps } from "./steam-task-source-ops.mjs";

let server;

async function startMockApi({ initialImported = false } = {}) {
  const calls = [];
  let imported = initialImported;
  let statImported = false;
  let leaderboardImported = false;
  let published = false;
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    calls.push({ method: request.method, path: url.pathname, search: url.searchParams.toString(), body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/steam/apps/620/task-source-ops") {
      response.end(JSON.stringify({
        ops: {
          schemaVersion: "steambench.steam-task-source-ops-report.v1",
          generatedAt: "2026-06-14T00:00:00.000Z",
          appid: 620,
          gameName: "Portal 2",
          status: published ? "catalog-ready" : imported ? "ready-to-publish" : "ready-to-import",
          sources: {
            achievement: { source: "fixture", achievements: 3, active: published ? 1 : 0, candidates: imported && !published ? 1 : 0, rejected: 0, recommendedImports: imported ? 0 : 1 },
            stat: { source: "fixture", stats: 2, proposed: 2, newProposals: statImported ? 0 : 2, reviewRequired: 0 },
            leaderboard: { source: "fixture", leaderboards: 2, proposed: 2, newProposals: leaderboardImported ? 0 : 2, reviewRequired: 2 }
          },
          registry: {
            active: published ? 1 : 0,
            candidates: published ? 0 : Number(imported) + (statImported ? 2 : 0) + (leaderboardImported ? 2 : 0),
            rejected: 0,
            candidateReviewRequired: 0,
            activeTracks: published ? ["achievement"] : [],
            candidateTracks: [
              ...(imported && !published ? ["achievement"] : []),
              ...(statImported && !published ? ["stat"] : []),
              ...(leaderboardImported && !published ? ["leaderboard"] : [])
            ],
            missingCandidateTracks: [
              ...(imported || published ? [] : ["achievement"]),
              ...(statImported ? [] : ["stat"]),
              ...(leaderboardImported ? [] : ["leaderboard"])
            ]
          },
          totals: {
            sourceRecords: 7,
            newImportsAvailable: (imported ? 0 : 1) + (statImported ? 0 : 2) + (leaderboardImported ? 0 : 2),
            publishableCandidates: published ? 0 : Number(imported) + (statImported ? 2 : 0) + (leaderboardImported ? 2 : 0)
          },
          recommendedActions: [
            ...(imported ? [] : [{ id: "import-achievement-recommendations", label: "Import achievement recommendations", priority: "high", method: "POST", endpoint: "/api/steam/apps/620/achievement-ladder/import-recommended", reason: "new achievements" }]),
            ...(statImported ? [] : [{ id: "import-stat-proposals", label: "Import stat proposals", priority: "medium", method: "POST", endpoint: "/api/steam/apps/620/stat-proposals/import-recommended", reason: "new stats" }]),
            ...(leaderboardImported ? [] : [{ id: "import-leaderboard-proposals", label: "Import leaderboard proposals", priority: "medium", method: "POST", endpoint: "/api/steam/apps/620/leaderboard-proposals/import-recommended", reason: "new leaderboards" }]),
            ...(!published && (imported || statImported || leaderboardImported) ? [{ id: "publish-candidates", label: "Publish candidates", priority: "medium", method: "POST", endpoint: "/api/steam/apps/620/publish-candidates", body: { reviewApproved: true }, reason: "publish" }] : []),
            { id: "inspect-benchmark-blueprint", label: "Inspect benchmark blueprint", priority: "low", method: "GET", endpoint: "/api/games/620/benchmark-blueprint", reason: "inspect" }
          ],
          links: {
            achievementLadder: "/api/steam/apps/620/achievement-ladder",
            importAchievementRecommendations: "/api/steam/apps/620/achievement-ladder/import-recommended",
            statProposals: "/api/steam/apps/620/stat-proposals",
            importStatProposals: "/api/steam/apps/620/stat-proposals/import-recommended",
            leaderboardProposals: "/api/steam/apps/620/leaderboard-proposals",
            importLeaderboardProposals: "/api/steam/apps/620/leaderboard-proposals/import-recommended",
            publishCandidates: "/api/steam/apps/620/publish-candidates",
            benchmarkBlueprint: "/api/games/620/benchmark-blueprint",
            coveragePlan: "/api/games/620/coverage-plan",
            onboarding: "/api/steam/apps/620/onboarding"
          }
        },
        warnings: []
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/steam/apps/620/stat-proposals/import-recommended") {
      statImported = true;
      response.statusCode = 201;
      response.end(JSON.stringify({
        importRun: {
          schemaVersion: "steambench.steam-stat-recommended-import.v1",
          appid: 620,
          source: "fixture",
          proposed: 2,
          imported: 2,
          reviewRequired: 0
        },
        imported: [
          { id: "620:STAT.PORTALS_PLACED", title: "Portals Placed" },
          { id: "620:STAT.STEPS_TAKEN", title: "Steps Taken" }
        ]
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/steam/apps/620/leaderboard-proposals/import-recommended") {
      leaderboardImported = true;
      response.statusCode = 201;
      response.end(JSON.stringify({
        importRun: {
          schemaVersion: "steambench.steam-leaderboard-recommended-import.v1",
          appid: 620,
          source: "fixture",
          proposed: 2,
          imported: 2,
          reviewRequired: 2
        },
        imported: [
          { id: "620:LDRB.CHALLENGE_MODE_TIME", title: "Challenge Mode Time" },
          { id: "620:LDRB.LEAST_PORTALS", title: "Least Portals" }
        ]
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/steam/apps/620/achievement-ladder/import-recommended") {
      imported = true;
      response.statusCode = 201;
      response.end(JSON.stringify({
        importRun: {
          schemaVersion: "steambench.steam-achievement-recommended-import.v1",
          appid: 620,
          requestedLimit: body.limit,
          totals: {
            imported: 1,
            skipped: 2
          }
        },
        imported: [
          { id: "620:ACH.WAKE_UP", title: "Wake Up Call" }
        ]
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/steam/apps/620/publish-candidates") {
      published = true;
      response.end(JSON.stringify({
        publication: {
          schemaVersion: "steambench.task-publication.v1",
          appid: 620,
          totals: {
            published: 1,
            blocked: 0,
            alreadyActive: 0
          },
          published: [
            { task: { id: "620:ACH.WAKE_UP", status: "active" } }
          ],
          blocked: []
        }
      }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found", path: url.pathname }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { baseUrl: `http://127.0.0.1:${address.port}`, calls };
}

afterEach(async () => {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = undefined;
});

describe("steam task source ops CLI runner", () => {
  it("summarizes unified Steam source ops for one app", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runSteamTaskSourceOps({
      baseUrl,
      appid: 620,
      useFixture: true,
      refresh: true,
      limit: 2
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.steam-task-source-ops-cli.v1",
      appid: 620,
      useFixture: true,
      refresh: true,
      summary: {
        status: "ready-to-import",
        sourceRecords: 7,
        newImportsAvailable: 5,
        publishableCandidates: 0,
        active: 0,
        candidates: 0,
        actions: [
          "import-achievement-recommendations",
          "import-stat-proposals",
          "import-leaderboard-proposals",
          "inspect-benchmark-blueprint"
        ]
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/steam/apps/620/task-source-ops"
    ]);
    expect(calls[0].search).toContain("useFixture=true");
    expect(calls[0].search).toContain("refresh=true");
    expect(calls[0].search).toContain("limit=2");
  });

  it("executes a named import recommendation only when requested", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runSteamTaskSourceOps({
      baseUrl,
      appid: 620,
      useFixture: true,
      refresh: true,
      limit: 2,
      execute: "import-achievement-recommendations",
      reviewNotes: "test import"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.steam-task-source-ops-cli.v1",
      appid: 620,
      executedAction: {
        action: { id: "import-achievement-recommendations" },
        result: {
          importRun: {
            schemaVersion: "steambench.steam-achievement-recommended-import.v1",
            totals: { imported: 1 }
          }
        }
      },
      summary: {
        status: "ready-to-publish",
        newImportsAvailable: 4,
        publishableCandidates: 1,
        candidates: 1,
        executedActionId: "import-achievement-recommendations",
        imported: 1,
        actions: [
          "import-stat-proposals",
          "import-leaderboard-proposals",
          "publish-candidates",
          "inspect-benchmark-blueprint"
        ]
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/steam/apps/620/task-source-ops",
      "POST /api/steam/apps/620/achievement-ladder/import-recommended",
      "GET /api/steam/apps/620/task-source-ops"
    ]);
    expect(calls[1].body).toEqual({
      useFixture: true,
      refresh: true,
      limit: 2,
      reviewNotes: "test import"
    });
  });

  it("executes a named publication recommendation only when requested", async () => {
    const { baseUrl, calls } = await startMockApi({ initialImported: true });

    const summary = await runSteamTaskSourceOps({
      baseUrl,
      appid: 620,
      useFixture: true,
      refresh: false,
      limit: 2,
      execute: "publish-candidates",
      reviewApproved: true,
      forceReviewOverride: false,
      reviewNotes: "test publish"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.steam-task-source-ops-cli.v1",
      appid: 620,
      executedAction: {
        action: { id: "publish-candidates" },
        result: {
          publication: {
            schemaVersion: "steambench.task-publication.v1",
            totals: { published: 1, blocked: 0 }
          }
        }
      },
      summary: {
        status: "catalog-ready",
        publishableCandidates: 0,
        active: 1,
        candidates: 0,
        executedActionId: "publish-candidates",
        published: 1,
        blocked: 0
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/steam/apps/620/task-source-ops",
      "POST /api/steam/apps/620/publish-candidates",
      "GET /api/steam/apps/620/task-source-ops"
    ]);
    expect(calls[1].body).toEqual({
      reviewApproved: true,
      useFixture: true,
      refresh: false,
      limit: 2,
      reviewNotes: "test publish",
      forceReviewOverride: false
    });
  });

  it("advances consecutive writable source actions for one app", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runSteamTaskSourceOps({
      baseUrl,
      appid: 620,
      useFixture: true,
      refresh: true,
      limit: 2,
      execute: "advance-source-actions",
      maxSteps: 4,
      reviewApproved: true,
      reviewNotes: "advance source ops"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.steam-task-source-ops-cli.v1",
      appid: 620,
      summary: {
        status: "catalog-ready",
        newImportsAvailable: 0,
        publishableCandidates: 0,
        active: 1,
        candidates: 0,
        executedActionId: "import-achievement-recommendations",
        executedActionIds: [
          "import-achievement-recommendations",
          "import-stat-proposals",
          "import-leaderboard-proposals",
          "publish-candidates"
        ],
        executedActionCount: 4,
        imported: 5,
        published: 1,
        blocked: 0,
        actions: ["inspect-benchmark-blueprint"]
      }
    });
    expect(summary.executedActions.map((entry) => entry.action.id)).toEqual([
      "import-achievement-recommendations",
      "import-stat-proposals",
      "import-leaderboard-proposals",
      "publish-candidates"
    ]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/steam/apps/620/task-source-ops",
      "POST /api/steam/apps/620/achievement-ladder/import-recommended",
      "GET /api/steam/apps/620/task-source-ops",
      "POST /api/steam/apps/620/stat-proposals/import-recommended",
      "GET /api/steam/apps/620/task-source-ops",
      "POST /api/steam/apps/620/leaderboard-proposals/import-recommended",
      "GET /api/steam/apps/620/task-source-ops",
      "POST /api/steam/apps/620/publish-candidates",
      "GET /api/steam/apps/620/task-source-ops"
    ]);
    expect(calls[7].body).toMatchObject({
      reviewApproved: true,
      useFixture: true,
      refresh: true,
      limit: 2,
      reviewNotes: "advance source ops"
    });
  });
});
