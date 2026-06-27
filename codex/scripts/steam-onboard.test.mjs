import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runSteamOnboard } from "./steam-onboard.mjs";

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

function onboarding(status = "coverage-ready") {
  return {
    onboarding: {
      schemaVersion: "steambench.steam-app-onboarding.v1",
      appid: 620,
      status,
      readinessScore: status === "competition-ready" ? 94 : 76,
      stages: [
        { id: "discovery", status: "complete" },
        { id: "achievement-ladder", status: "complete" },
        { id: "task-publication", status: "complete" },
        { id: "coverage", status: status === "competition-ready" ? "complete" : "ready" },
        { id: "competition", status: status === "competition-ready" ? "complete" : "blocked" }
      ],
      nextActions: status === "competition-ready" ? ["Share standings"] : ["Run coverage"]
    }
  };
}

async function startMockApi() {
  const calls = [];
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : {};
    calls.push({ method: request.method, path: url.pathname, search: url.searchParams.toString(), body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/steam/apps/620/onboarding") {
      const afterRun = calls.some((call) => call.path === "/api/steam/apps/620/onboarding/run-local");
      response.end(JSON.stringify(onboarding(afterRun ? "competition-ready" : "coverage-ready")));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/steam/apps/620/onboarding/run-local") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        run: {
          schemaVersion: "steambench.steam-app-onboarding-local-run.v1",
          appid: 620,
          steps: [
            { id: "import-recommended", status: "skipped" },
            { id: "publish-candidates", status: "skipped" },
            { id: "coverage-local-run", status: "changed", completedRuns: 2 }
          ],
          links: {
            onboarding: "/api/steam/apps/620/onboarding",
            coveragePlan: "/api/games/620/coverage-plan"
          }
        },
        coverage: {
          schemaVersion: "steambench.game-coverage-local-run.v1",
          totals: {
            completedRuns: 2,
            scoreboardReady: 2,
            humanRuns: 1,
            agentRuns: 1
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

describe("steam onboard CLI runner", () => {
  it("inspects onboarding without side effects by default", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runSteamOnboard({
      baseUrl,
      appid: 620,
      execute: "inspect",
      useFixture: true,
      refresh: false,
      reviewApproved: true,
      forceReviewOverride: false,
      side: "both",
      limit: 3
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.steam-onboard-cli.v1",
      appid: 620,
      execute: "inspect",
      summary: {
        status: "coverage-ready",
        readyStages: ["coverage"],
        blockedStages: ["competition"]
      }
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "GET",
      path: "/api/steam/apps/620/onboarding"
    });
    expect(calls[0].search).toContain("useFixture=true");
    expect(calls[0].search).toContain("limit=3");
  });

  it("executes local onboarding coverage when requested", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runSteamOnboard({
      baseUrl,
      appid: 620,
      execute: "run-local",
      useFixture: true,
      refresh: false,
      reviewApproved: true,
      forceReviewOverride: false,
      reviewNotes: "test run-local",
      humanUserId: "user_human",
      agentId: "agent_one",
      side: "both",
      limit: 2
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.steam-onboard-cli.v1",
      execute: "run-local",
      summary: {
        status: "competition-ready",
        executedActionId: "run-local",
        completedRuns: 2,
        scoreboardReady: 2
      },
      executedAction: {
        id: "run-local",
        coverage: {
          completedRuns: 2,
          scoreboardReady: 2
        }
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/steam/apps/620/onboarding",
      "POST /api/steam/apps/620/onboarding/run-local",
      "GET /api/steam/apps/620/onboarding"
    ]);
    expect(calls[1].body).toMatchObject({
      useFixture: true,
      reviewApproved: true,
      humanUserId: "user_human",
      agentId: "agent_one",
      side: "both",
      limit: 2
    });
  });
});
