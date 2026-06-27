import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runSteamSourceQueue } from "./steam-source-queue.mjs";

let server;

function sourceQueuePayload({ imported, published, limit }) {
  const recommendedAction = published
    ? {
        id: "inspect-benchmark-blueprint",
        label: "Inspect benchmark blueprint",
        priority: "low",
        method: "GET",
        endpoint: "/api/games/620/benchmark-blueprint",
        reason: "inspect"
      }
    : imported
      ? {
          id: "publish-candidates",
          label: "Publish candidates",
          priority: "high",
          method: "POST",
          endpoint: "/api/steam/apps/620/publish-candidates",
          body: { reviewApproved: false },
          reason: "publish"
        }
      : {
          id: "import-achievement-recommendations",
          label: "Import achievement recommendations",
          priority: "high",
          method: "POST",
          endpoint: "/api/steam/apps/620/achievement-ladder/import-recommended",
          reason: "import"
        };
  const queueAction = {
    ...recommendedAction,
    id: `steam-source:620:${recommendedAction.id}`,
    appid: 620,
    gameName: "Portal 2"
  };
  return {
    queue: {
      schemaVersion: "steambench.steam-source-queue.v1",
      generatedAt: "2026-06-14T00:00:00.000Z",
      limit,
      totals: {
        apps: 1,
        readyToPublish: imported && !published ? 1 : 0,
        readyToImport: imported ? 0 : 1,
        catalogReady: published ? 1 : 0,
        needsSourceData: 0,
        sourceRecords: 7,
        newImportsAvailable: imported ? 0 : 3,
        publishableCandidates: imported && !published ? 1 : 0,
        achievementRecords: 3,
        statRecords: 2,
        leaderboardRecords: 2,
        achievementImportsAvailable: imported ? 0 : 3,
        statImportsAvailable: 0,
        leaderboardImportsAvailable: 0
      },
      items: [
        {
          appid: 620,
          gameName: "Portal 2",
          status: published ? "catalog-ready" : imported ? "ready-to-publish" : "ready-to-import",
          priorityScore: published ? 2000 : imported ? 4000 : 3000,
          sourceRecords: 7,
          newImportsAvailable: imported ? 0 : 3,
          publishableCandidates: imported && !published ? 1 : 0,
          sourceBreakdown: {
            achievement: {
              records: 3,
              recommendedImports: imported ? 0 : 3,
              active: published ? 1 : 0,
              candidates: imported && !published ? 1 : 0,
              rejected: 0
            },
            stat: {
              records: 2,
              proposed: 2,
              newProposals: 0,
              reviewRequired: 0
            },
            leaderboard: {
              records: 2,
              proposed: 2,
              newProposals: 0,
              reviewRequired: 0
            }
          },
          registryTracks: {
            active: published ? ["achievement"] : [],
            candidates: imported && !published ? ["achievement"] : [],
            missingCandidates: imported ? [] : ["achievement"]
          },
          activeTasks: published ? 1 : 0,
          candidateTasks: imported && !published ? 1 : 0,
          actionIds: published
            ? ["inspect-benchmark-blueprint"]
            : imported
              ? ["publish-candidates", "inspect-benchmark-blueprint"]
              : ["import-achievement-recommendations", "inspect-benchmark-blueprint"],
          recommendedAction,
          reasons: ["ready"],
          links: {
            taskSourceOps: "/api/steam/apps/620/task-source-ops",
            onboarding: "/api/steam/apps/620/onboarding",
            benchmarkBlueprint: "/api/games/620/benchmark-blueprint",
            coveragePlan: "/api/games/620/coverage-plan"
          }
        }
      ],
      recommendedActions: [queueAction],
      links: {
        steamDiscovery: "/api/steam/apps/discovery",
        platformOps: "/api/platform/ops-report"
      }
    }
  };
}

async function startMockApi() {
  const calls = [];
  let imported = false;
  let published = false;
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    calls.push({ method: request.method, path: url.pathname, search: url.searchParams.toString(), body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/steam/source-queue") {
      response.end(JSON.stringify(sourceQueuePayload({
        imported,
        published,
        limit: Number(url.searchParams.get("limit") ?? 8)
      })));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/steam/apps/620/achievement-ladder/import-recommended") {
      imported = true;
      response.statusCode = 201;
      response.end(JSON.stringify({
        importRun: {
          schemaVersion: "steambench.steam-achievement-recommended-import.v1",
          appid: 620,
          totals: {
            imported: 1,
            skipped: 0
          }
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/steam/apps/620/publish-candidates") {
      published = true;
      response.end(JSON.stringify({
        publication: {
          schemaVersion: "steambench.task-publication.v1",
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

describe("steam source queue CLI runner", () => {
  it("summarizes the cross-app Steam source queue", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runSteamSourceQueue({
      baseUrl,
      useFixture: true,
      refresh: true,
      limit: 4,
      proposalLimit: 2,
      discoveryStatus: "shortlisted"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.steam-source-queue-cli.v1",
      useFixture: true,
      refresh: true,
      summary: {
        apps: 1,
        readyToImport: 1,
        newImportsAvailable: 3,
        topApp: 620,
        topSourceBreakdown: {
          achievement: {
            records: 3,
            recommendedImports: 3
          },
          stat: {
            records: 2,
            newProposals: 0
          },
          leaderboard: {
            records: 2,
            newProposals: 0
          }
        },
        topMissingCandidateTracks: ["achievement"],
        achievementRecords: 3,
        statRecords: 2,
        leaderboardRecords: 2,
        achievementImportsAvailable: 3,
        statImportsAvailable: 0,
        leaderboardImportsAvailable: 0,
        actions: ["steam-source:620:import-achievement-recommendations"]
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/steam/source-queue"
    ]);
    expect(calls[0].search).toContain("useFixture=true");
    expect(calls[0].search).toContain("refresh=true");
    expect(calls[0].search).toContain("limit=4");
    expect(calls[0].search).toContain("proposalLimit=2");
    expect(calls[0].search).toContain("discoveryStatus=shortlisted");
  });

  it("executes an explicit queue recommendation", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runSteamSourceQueue({
      baseUrl,
      useFixture: true,
      refresh: false,
      limit: 4,
      proposalLimit: 2,
      discoveryStatus: "",
      execute: "steam-source:620:import-achievement-recommendations",
      reviewNotes: "queue import"
    });

    expect(summary).toMatchObject({
      executedAction: {
        action: { id: "steam-source:620:import-achievement-recommendations" },
        result: {
          importRun: {
            schemaVersion: "steambench.steam-achievement-recommended-import.v1",
            totals: { imported: 1 }
          }
        }
      },
      summary: {
        readyToPublish: 1,
        publishableCandidates: 1,
        executedActionId: "steam-source:620:import-achievement-recommendations",
        nextActionId: "steam-source:620:publish-candidates",
        imported: 1,
        actions: ["steam-source:620:publish-candidates"]
      },
      executionReceipt: {
        schemaVersion: "steambench.steam-source-queue-execution.v1",
        actionId: "steam-source:620:import-achievement-recommendations",
        appid: 620,
        before: {
          readyToImport: 1,
          newImportsAvailable: 3,
          topActionId: "steam-source:620:import-achievement-recommendations"
        },
        after: {
          readyToPublish: 1,
          publishableCandidates: 1,
          topActionId: "steam-source:620:publish-candidates"
        },
        delta: {
          newImportsAvailable: -3,
          publishableCandidates: 1
        },
        result: {
          imported: 1
        }
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/steam/source-queue",
      "POST /api/steam/apps/620/achievement-ladder/import-recommended",
      "GET /api/steam/source-queue"
    ]);
    expect(calls[1].body).toEqual({
      useFixture: true,
      refresh: false,
      limit: 2,
      reviewNotes: "queue import"
    });
  });

  it("advances the next app through consecutive write recommendations", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runSteamSourceQueue({
      baseUrl,
      useFixture: true,
      refresh: false,
      limit: 4,
      proposalLimit: 2,
      discoveryStatus: "",
      execute: "advance-next",
      reviewApproved: true,
      maxSteps: 3,
      reviewNotes: "queue advance"
    });

    expect(summary).toMatchObject({
      summary: {
        catalogReady: 1,
        publishableCandidates: 0,
        executedActionId: "steam-source:620:publish-candidates",
        advancedSteps: 2,
        advancedActionIds: [
          "steam-source:620:import-achievement-recommendations",
          "steam-source:620:publish-candidates"
        ],
        nextActionId: "steam-source:620:inspect-benchmark-blueprint",
        published: 1
      },
      executedActions: [
        {
          action: { id: "steam-source:620:import-achievement-recommendations" },
          result: { importRun: { totals: { imported: 1 } } }
        },
        {
          action: { id: "steam-source:620:publish-candidates" },
          result: { publication: { published: [{ task: { id: "620:ACH.WAKE_UP" } }] } }
        }
      ],
      executionReceipt: {
        schemaVersion: "steambench.steam-source-queue-advance.v1",
        requestedAction: "advance-next",
        appid: 620,
        steps: [
          {
            index: 1,
            actionId: "steam-source:620:import-achievement-recommendations",
            result: { imported: 1 }
          },
          {
            index: 2,
            actionId: "steam-source:620:publish-candidates",
            result: { published: 1, blocked: 0 }
          }
        ],
        after: {
          catalogReady: 1,
          topActionId: "steam-source:620:inspect-benchmark-blueprint"
        }
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/steam/source-queue",
      "POST /api/steam/apps/620/achievement-ladder/import-recommended",
      "GET /api/steam/source-queue",
      "POST /api/steam/apps/620/publish-candidates",
      "GET /api/steam/source-queue"
    ]);
    expect(calls[1].body).toEqual({
      useFixture: true,
      refresh: false,
      limit: 2,
      reviewNotes: "queue advance"
    });
    expect(calls[3].body).toEqual({
      reviewApproved: true,
      useFixture: true,
      refresh: false,
      limit: 2,
      reviewNotes: "queue advance",
      forceReviewOverride: false
    });
  });
});
