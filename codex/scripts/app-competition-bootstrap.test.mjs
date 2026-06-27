import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrapAppCompetition } from "./app-competition-bootstrap.mjs";

let server;

function readBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body ? JSON.parse(body) : {}));
  });
}

async function startMockApi() {
  const calls = [];
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : {};
    calls.push({ method: request.method, path: url.pathname, body });
    response.setHeader("content-type", "application/json");

    if (request.method === "POST" && url.pathname === "/api/steam/apps/discover") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        discoveries: [
          {
            id: "disc_portal",
            appid: 620,
            name: "Portal 2",
            source: "fixture",
            status: "candidate",
            benchmarkFit: 94,
            harnessRisk: "low"
          }
        ]
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/steam/apps/620/achievement-ladder") {
      response.end(JSON.stringify({
        source: "fixture",
        ladder: {
          totals: {
            achievements: 4,
            recommendedImports: 2,
            active: 4,
            candidates: 0
          }
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/steam/apps/discovery/disc_portal/import-achievements") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        source: "fixture",
        discovery: { id: "disc_portal", status: "imported" },
        imported: [{ id: "620:ACH_A" }, { id: "620:ACH_B" }]
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/steam/apps/620/publish-candidates") {
      response.end(JSON.stringify({
        publication: {
          status: "published",
          published: [{ task: { id: "620:ACH_A" } }],
          blocked: []
        }
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/steam/apps/620/onboarding") {
      response.end(JSON.stringify({
        onboarding: {
          status: "competition-ready",
          readinessScore: 100,
          stages: [],
          nextActions: []
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/users") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        user: {
          id: "user_bootstrap",
          handle: body.handle,
          type: "human"
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/users/user_bootstrap/steam") {
      response.end(JSON.stringify({
        user: {
          id: "user_bootstrap",
          handle: "bootstrap-human",
          type: "human",
          linkedSteamId: body.steamid,
          proofConsentAt: "2026-06-14T00:00:00.000Z"
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/agents") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        agent: {
          id: "agent_bootstrap",
          handle: body.handle,
          status: "active"
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/steam/apps/620/onboarding/run-local") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        run: {
          schemaVersion: "steambench.steam-app-onboarding-local-run.v1",
          links: {
            coveragePlan: "/api/games/620/coverage-plan",
            evidenceBundle: "/api/game-coverage-runs/coverage_bootstrap/evidence-bundle",
            resultCertificate: "/api/game-coverage-runs/coverage_bootstrap/result-certificate"
          }
        },
        coverage: {
          totals: {
            completedRuns: 2,
            scoreboardReady: 2
          }
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/games/620/competition/run-local") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        competitionRun: {
          schemaVersion: "steambench.game-competition-local-run.v1",
          suiteId: "620:ranked",
          suiteTier: "ranked",
          raceId: "race_bootstrap",
          status: "scored",
          complete: true,
          links: {
            suiteRace: "/api/suite-races/race_bootstrap",
            resultCertificate: "/api/suite-races/race_bootstrap/result-certificate"
          }
        },
        race: {
          winner: "tie"
        },
        certificate: {
          integrity: {
            readyForPublicShare: true
          }
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

describe("app competition bootstrap CLI runner", () => {
  it("bootstraps a Steam app into coverage and a scored suite race", async () => {
    const { baseUrl, calls } = await startMockApi();
    const summary = await bootstrapAppCompetition({
      baseUrl,
      query: "Portal",
      appids: [],
      useFixture: true,
      refresh: false,
      dryRun: false,
      publish: true,
      reviewApproved: true,
      forceReviewOverride: false,
      humanHandle: "bootstrap-human",
      agentHandle: "bootstrap-agent",
      steamid: "76561198000000000",
      humanUserId: undefined,
      agentId: undefined,
      top: 1,
      importLimit: 2,
      publishLimit: 2,
      coverageLimit: 2,
      suiteTier: "ranked",
      runCoverage: true,
      runCompetition: true
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.app-competition-bootstrap.v1",
      target: {
        appid: 620,
        name: "Portal 2"
      },
      human: {
        user: {
          id: "user_bootstrap",
          linkedSteamId: "76561198000000000"
        },
        created: true,
        linked: true
      },
      agent: {
        agent: {
          id: "agent_bootstrap"
        },
        created: true
      },
      onboardingRun: {
        completedRuns: 2,
        scoreboardReady: 2
      },
      competitionRun: {
        suiteId: "620:ranked",
        status: "scored",
        complete: true,
        winner: "tie",
        readyForPublicShare: true
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/steam/apps/discover",
      "GET /api/steam/apps/620/achievement-ladder",
      "POST /api/steam/apps/discovery/disc_portal/import-achievements",
      "GET /api/steam/apps/620/achievement-ladder",
      "POST /api/steam/apps/620/publish-candidates",
      "GET /api/steam/apps/620/onboarding",
      "POST /api/users",
      "POST /api/users/user_bootstrap/steam",
      "POST /api/agents",
      "POST /api/steam/apps/620/onboarding/run-local",
      "POST /api/games/620/competition/run-local"
    ]);
    const agentCreateCall = calls.find((call) => call.method === "POST" && call.path === "/api/agents");
    expect(agentCreateCall?.body.capabilities).toEqual(expect.arrayContaining([
      "controller",
      "seeded-save",
      "manual-review",
      "screen-capture",
      "output.mp4"
    ]));
  });
});
