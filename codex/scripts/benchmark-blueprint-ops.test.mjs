import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runBenchmarkBlueprintOps } from "./benchmark-blueprint-ops.mjs";

let server;

function blueprint({ appid, name, status, readinessScore, canImportNow, rankedReadyTasks = 0, reviewRequiredTasks = 0 }) {
  return {
    schemaVersion: "steambench.benchmark-blueprint.v1",
    generatedAt: "2026-06-14T00:00:00.000Z",
    appid,
    game: {
      appid,
      name,
      capsuleUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_616x353.jpg`,
      headerUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
      tracks: ["achievement", "capture"],
      genres: ["Test"],
      harnessRisk: "low",
      benchmarkFit: 90,
      notes: "test"
    },
    status,
    readinessScore,
    reasons: [`${name} reason`],
    nextActions: [`${name} next action`, `${name} second action`, `${name} third action`],
    importPlan: {
      endpoint: `/api/steam/apps/${appid}/import-achievements`,
      source: canImportNow ? "fixture" : "none",
      availableAchievementTasks: canImportNow ? 4 : 0,
      importedAchievementTasks: rankedReadyTasks,
      recommendedImportLimit: 4,
      canImportNow
    },
    sourcePlan: {
      sourceRecords: canImportNow ? 8 : reviewRequiredTasks > 0 ? 6 : 4,
      newImportsAvailable: canImportNow ? 4 : reviewRequiredTasks > 0 ? 2 : 0,
      activeTracks: rankedReadyTasks > 0 ? ["achievement", "capture"] : [],
      candidateTracks: reviewRequiredTasks > 0 ? ["stat"] : [],
      missingCandidateTracks: canImportNow ? ["achievement", "leaderboard"] : reviewRequiredTasks > 0 ? ["leaderboard"] : [],
      achievement: {
        source: canImportNow ? "fixture" : "none",
        records: canImportNow ? 4 : 0,
        imported: rankedReadyTasks,
        newImports: canImportNow ? 4 : 0,
        canImportNow,
        endpoint: `/api/steam/apps/${appid}/achievement-ladder`,
        importEndpoint: `/api/steam/apps/${appid}/achievement-ladder/import-recommended`
      },
      stat: {
        source: reviewRequiredTasks > 0 ? "fixture" : "none",
        records: reviewRequiredTasks > 0 ? 3 : 0,
        proposed: reviewRequiredTasks > 0 ? 2 : 0,
        newProposals: reviewRequiredTasks > 0 ? 1 : 0,
        reviewRequired: reviewRequiredTasks,
        canImportNow: reviewRequiredTasks > 0,
        endpoint: `/api/steam/apps/${appid}/stat-proposals`,
        importEndpoint: `/api/steam/apps/${appid}/stat-proposals/import-recommended`
      },
      leaderboard: {
        source: canImportNow || reviewRequiredTasks > 0 ? "fixture" : "none",
        records: canImportNow ? 4 : reviewRequiredTasks > 0 ? 3 : 0,
        proposed: canImportNow ? 4 : reviewRequiredTasks > 0 ? 2 : 0,
        newProposals: canImportNow ? 0 : reviewRequiredTasks > 0 ? 1 : 0,
        reviewRequired: reviewRequiredTasks,
        canImportNow: reviewRequiredTasks > 0,
        endpoint: `/api/steam/apps/${appid}/leaderboard-proposals`,
        importEndpoint: `/api/steam/apps/${appid}/leaderboard-proposals/import-recommended`
      }
    },
    sourceActions: [
      ...(canImportNow
        ? [{
            id: "import-achievement-recommendations",
            label: "Import achievement recommendations",
            priority: "high",
            method: "POST",
            endpoint: `/api/steam/apps/${appid}/achievement-ladder/import-recommended`,
            body: { useFixture: true, limit: 4 },
            reason: "import achievements"
          }]
        : []),
      ...(reviewRequiredTasks > 0
        ? [
            {
              id: "import-stat-proposals",
              label: "Import stat proposals",
              priority: "high",
              method: "POST",
              endpoint: `/api/steam/apps/${appid}/stat-proposals/import-recommended`,
              body: { useFixture: true, limit: 1 },
              reason: "import stats"
            },
            {
              id: "import-leaderboard-proposals",
              label: "Import leaderboard proposals",
              priority: "medium",
              method: "POST",
              endpoint: `/api/steam/apps/${appid}/leaderboard-proposals/import-recommended`,
              body: { useFixture: true, limit: 1 },
              reason: "import leaderboards"
            }
          ]
        : [])
    ],
    taskLadder: [
      {
        id: "starter",
        label: "Starter ladder",
        levelRange: { min: 1, max: 3 },
        taskCount: rankedReadyTasks,
        activeTasks: rankedReadyTasks,
        candidateTasks: 0,
        rankedReadyTasks,
        reviewRequiredTasks,
        recommendedTaskIds: [],
        gaps: reviewRequiredTasks > 0 ? ["Needs review."] : []
      }
    ],
    suites: [],
    runtimePlan: {
      adapter: {
        id: `adapter_${appid}`,
        label: `${name} adapter`,
        launchHints: [],
        readinessChecks: [],
        agentLoopHints: [],
        evidenceHints: []
      },
      targetArtifactName: "output.mp4",
      stage2StartConstraints: [
        "Do not call session.run_file(...) in Stage 2 start()."
      ],
      proofRequirements: ["Canonical capture artifact output/output.mp4."],
      readinessChecks: [],
      agentLoopHints: [],
      evidenceHints: []
    },
    reviewPlan: {
      rankedReadyTasks,
      reviewRequiredTasks,
      rejectedTasks: 0,
      controls: [],
      risks: []
    },
    competitionPlan: {
      humanAgentRaceReady: status === "ranked-ready",
      suiteIds: status === "ranked-ready" ? [`${appid}:ranked`] : [],
      publicEndpoints: [`/api/games/${appid}/benchmark-blueprint`],
      proofGates: ["Scoring requires verified proof records and the canonical output.mp4 artifact."]
    }
  };
}

async function startMockApi() {
  const calls = [];
  const balatroActionIds = new Set(["import-stat-proposals", "import-leaderboard-proposals"]);
  const blueprints = [
    blueprint({ appid: 620, name: "Portal 2", status: "ranked-ready", readinessScore: 95, canImportNow: false, rankedReadyTasks: 4 }),
    blueprint({ appid: 646570, name: "Slay the Spire", status: "import-ready", readinessScore: 82, canImportNow: true }),
    blueprint({ appid: 2379780, name: "Balatro", status: "review-required", readinessScore: 78, canImportNow: false, reviewRequiredTasks: 2 })
  ];
  const focusedBlueprint = (found) => {
    if (found.appid !== 2379780) return found;
    return {
      ...found,
      sourceActions: found.sourceActions.filter((action) => balatroActionIds.has(action.id))
    };
  };
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const bodyText = request.method === "POST"
      ? await new Promise((resolve) => {
          let body = "";
          request.setEncoding("utf8");
          request.on("data", (chunk) => {
            body += chunk;
          });
          request.on("end", () => resolve(body));
        })
      : "";
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    calls.push({ method: request.method, path: url.pathname, search: url.search, body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/state") {
      response.end(JSON.stringify({ benchmarkBlueprints: blueprints }));
      return;
    }

    const match = url.pathname.match(/^\/api\/games\/(\d+)\/benchmark-blueprint$/);
    if (request.method === "GET" && match) {
      const appid = Number(match[1]);
      const found = blueprints.find((entry) => entry.appid === appid);
      if (!found) {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "game_or_discovery_not_found" }));
        return;
      }
      response.end(JSON.stringify({ blueprint: focusedBlueprint(found) }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/steam/apps/2379780/stat-proposals/import-recommended") {
      balatroActionIds.delete("import-stat-proposals");
      response.statusCode = 201;
      response.end(JSON.stringify({
        importRun: {
          schemaVersion: "steambench.steam-stat-recommended-import.v1",
          appid: 2379780,
          source: body?.useFixture ? "fixture" : "steam-live",
          requestedLimit: body?.limit,
          proposed: 2,
          imported: 1,
          reviewRequired: 1,
          links: {
            benchmarkBlueprint: "/api/games/2379780/benchmark-blueprint"
          }
        },
        imported: [{ id: "2379780:STAT.TEST", status: "candidate" }]
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/steam/apps/2379780/leaderboard-proposals/import-recommended") {
      balatroActionIds.delete("import-leaderboard-proposals");
      response.statusCode = 201;
      response.end(JSON.stringify({
        importRun: {
          schemaVersion: "steambench.steam-leaderboard-recommended-import.v1",
          appid: 2379780,
          source: body?.useFixture ? "fixture" : "steam-live",
          requestedLimit: body?.limit,
          proposed: 2,
          imported: 2,
          reviewRequired: 2,
          links: {
            benchmarkBlueprint: "/api/games/2379780/benchmark-blueprint"
          }
        },
        imported: [
          { id: "2379780:LEADERBOARD.TEST_ONE", status: "candidate" },
          { id: "2379780:LEADERBOARD.TEST_TWO", status: "candidate" }
        ]
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
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

describe("benchmark blueprint ops CLI runner", () => {
  it("summarizes blueprint readiness from dashboard state", async () => {
    const { baseUrl, calls } = await startMockApi();

    const result = await runBenchmarkBlueprintOps({
      baseUrl,
      status: "all",
      limit: 10
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.benchmark-blueprint-ops-cli.v1",
      summary: {
        blueprints: 3,
        rankedReady: 1,
        importReady: 1,
        reviewRequired: 1,
        needsSteamData: 0,
        canImportNow: 2,
        sourceRecords: 18,
        newSourceImportsAvailable: 6,
        achievementSourceRecords: 4,
        achievementNewImports: 4,
        statSourceRecords: 3,
        statProposals: 2,
        statNewProposals: 1,
        leaderboardSourceRecords: 7,
        leaderboardProposals: 6,
        leaderboardNewProposals: 1,
        sourceActions: 3,
        reviewRequiredTasks: 2,
        rankedReadyTasks: 4,
        outputMp4Contracts: 3,
        stage2StartContracts: 3,
        topAppid: 2379780,
        topGame: "Balatro",
        topStatus: "review-required",
        topSourceRecords: 6,
        topNewSourceImportsAvailable: 2,
        topSourceMissingCandidateTracks: ["leaderboard"],
        topSourceActionIds: ["import-stat-proposals", "import-leaderboard-proposals"]
      }
    });
    expect(result.items[0]).toMatchObject({
      appid: 2379780,
      blueprintEndpoint: "/api/games/2379780/benchmark-blueprint",
      targetArtifactName: "output.mp4",
      sourceRecords: 6,
      statNewProposals: 1,
      leaderboardNewProposals: 1,
      sourceActionIds: ["import-stat-proposals", "import-leaderboard-proposals"]
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/state"
    ]);
  });

  it("filters blueprints by status", async () => {
    const { baseUrl } = await startMockApi();

    const result = await runBenchmarkBlueprintOps({
      baseUrl,
      status: "import-ready",
      limit: 10
    });

    expect(result.summary).toMatchObject({
      blueprints: 1,
      importReady: 1,
      topAppid: 646570,
      topStatus: "import-ready",
      topImportEndpoint: "/api/steam/apps/646570/import-achievements",
      topSourceRecords: 8,
      topNewSourceImportsAvailable: 4
    });
    expect(result.items).toHaveLength(1);
  });

  it("loads a single app blueprint when appid is provided", async () => {
    const { baseUrl, calls } = await startMockApi();

    const result = await runBenchmarkBlueprintOps({
      baseUrl,
      appid: 620,
      status: "all",
      limit: 10,
      includeSourcePlan: true,
      useFixture: true
    });

    expect(result.summary).toMatchObject({
      blueprints: 1,
      rankedReady: 1,
      topAppid: 620,
      topStatus: "ranked-ready"
    });
    expect(result.items[0].humanAgentRaceReady).toBe(true);
    expect(result.items[0].sourceRecords).toBe(4);
    expect(result.items[0].sourceActionIds).toEqual([]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/games/620/benchmark-blueprint"
    ]);
  });

  it("executes a focused blueprint source action", async () => {
    const { baseUrl, calls } = await startMockApi();

    const result = await runBenchmarkBlueprintOps({
      baseUrl,
      appid: 2379780,
      status: "all",
      limit: 2,
      includeSourcePlan: true,
      useFixture: true,
      execute: "import-stat-proposals",
      reviewNotes: "blueprint import test"
    });

    expect(result.executedAction).toMatchObject({
      action: {
        id: "import-stat-proposals",
        endpoint: "/api/steam/apps/2379780/stat-proposals/import-recommended"
      },
      result: {
        importRun: {
          imported: 1
        }
      }
    });
    expect(result.summary).toMatchObject({
      executedActionId: "import-stat-proposals",
      imported: 1,
      topAppid: 2379780
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/games/2379780/benchmark-blueprint",
      "POST /api/steam/apps/2379780/stat-proposals/import-recommended",
      "GET /api/games/2379780/benchmark-blueprint"
    ]);
    expect(calls[1].body).toMatchObject({
      useFixture: true,
      limit: 2,
      reviewNotes: "blueprint import test"
    });
  });

  it("advances focused blueprint source actions with a bounded step count", async () => {
    const { baseUrl, calls } = await startMockApi();

    const result = await runBenchmarkBlueprintOps({
      baseUrl,
      appid: 2379780,
      status: "all",
      limit: 2,
      includeSourcePlan: true,
      useFixture: true,
      execute: "advance-source-actions",
      maxSteps: 2,
      reviewNotes: "blueprint advance test"
    });

    expect(result.summary).toMatchObject({
      executedActionId: "import-stat-proposals",
      executedActionIds: ["import-stat-proposals", "import-leaderboard-proposals"],
      executedSteps: 2,
      imported: 3,
      published: 0,
      blocked: 0,
      topAppid: 2379780,
      topSourceActionIds: []
    });
    expect(result.executedActions).toHaveLength(2);
    expect(result.executedActions.map((entry) => entry.action.id)).toEqual([
      "import-stat-proposals",
      "import-leaderboard-proposals"
    ]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/games/2379780/benchmark-blueprint",
      "POST /api/steam/apps/2379780/stat-proposals/import-recommended",
      "GET /api/games/2379780/benchmark-blueprint",
      "POST /api/steam/apps/2379780/leaderboard-proposals/import-recommended",
      "GET /api/games/2379780/benchmark-blueprint"
    ]);
    expect(calls[1].body).toMatchObject({
      useFixture: true,
      limit: 2,
      reviewNotes: "blueprint advance test"
    });
    expect(calls[3].body).toMatchObject({
      useFixture: true,
      limit: 2,
      reviewNotes: "blueprint advance test"
    });
  });
});
