import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runSteamIngest } from "./steam-ingest.mjs";

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
    calls.push({ method: request.method, path: url.pathname, search: url.search, body });
    response.setHeader("content-type", "application/json");

    if (request.method === "POST" && url.pathname === "/api/steam/apps/discover") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        discoveries: [
          {
            id: "disc_portal",
            appid: 620,
            name: "Portal 2",
            source: body.useFixture ? "fixture" : "steam-live",
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
        source: url.searchParams.get("useFixture") === "true" ? "fixture" : "steam-live",
        ladder: {
          totals: {
            achievements: 4,
            recommendedImports: 2,
            active: 1,
            candidates: calls.some((call) => call.path === "/api/steam/apps/discovery/disc_portal/import-achievements") ? 2 : 0
          }
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/steam/apps/discovery/disc_portal/import-achievements") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        source: "fixture",
        discovery: { id: "disc_portal", appid: 620, status: "imported" },
        imported: [{ id: "620:ACH_A" }, { id: "620:ACH_B" }]
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/steam/apps/620/onboarding") {
      response.end(JSON.stringify({
        onboarding: {
          status: "publication-ready",
          readinessScore: 72,
          stages: [
            { id: "discovery", status: "complete" },
            { id: "task-publication", status: "ready" }
          ],
          nextActions: ["Publish candidates: /api/steam/apps/620/publish-candidates"]
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

describe("steam ingest CLI runner", () => {
  it("discovers a Steam app, imports achievement candidates, and summarizes onboarding", async () => {
    const { baseUrl, calls } = await startMockApi();
    const summary = await runSteamIngest({
      baseUrl,
      query: "Portal",
      appids: [],
      useFixture: true,
      refresh: false,
      publish: false,
      reviewApproved: false,
      forceReviewOverride: false,
      dryRun: false,
      discoveryLimit: 5,
      importLimit: 2,
      publishLimit: 2,
      top: 1
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.steam-ingest-run.v1",
      query: "Portal",
      appids: [620],
      useFixture: true,
      results: [
        {
          appid: 620,
          candidateId: "disc_portal",
          importRun: {
            source: "fixture",
            imported: 2,
            discoveryStatus: "imported"
          },
          ladderAfter: {
            candidates: 2
          },
          onboarding: {
            status: "publication-ready",
            readyStages: ["task-publication"]
          }
        }
      ]
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/steam/apps/discover",
      "GET /api/steam/apps/620/achievement-ladder",
      "POST /api/steam/apps/discovery/disc_portal/import-achievements",
      "GET /api/steam/apps/620/achievement-ladder",
      "GET /api/steam/apps/620/onboarding"
    ]);
  });
});
