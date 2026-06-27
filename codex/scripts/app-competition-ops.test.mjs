import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runCompetitionOps } from "./app-competition-ops.mjs";

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
  let scheduled = false;
  let raced = false;
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : {};
    calls.push({ method: request.method, path: url.pathname, searchParams: url.searchParams, body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/games/620/competition/ops-report") {
      response.end(JSON.stringify({
        report: {
          schemaVersion: "steambench.game-competition-ops-report.v1",
          status: scheduled ? "ready-to-race" : "needs-coverage",
          appid: 620,
          selectedSuite: {
            id: "620:ranked",
            tier: "ranked"
          },
          totals: {
            activeTasks: 4,
            humanGaps: scheduled ? 0 : 1,
            agentGaps: scheduled ? 0 : 2
          },
          recommendedActions: raced
            ? [
                {
                  id: "inspect-certificate",
                  method: "GET",
                  endpoint: "/api/games/620/result-certificate"
                }
              ]
            : scheduled
              ? [
                  {
                    id: "run-suite-race",
                    method: "POST",
                    endpoint: "/api/games/620/competition/run-local",
                    body: {
                      humanUserId: "user_a",
                      agentId: "agent_b",
                      suiteTier: "ranked",
                      reviewApproved: false
                    }
                  },
                  {
                    id: "inspect-certificate",
                    method: "GET",
                    endpoint: "/api/games/620/result-certificate"
                  }
                ]
              : [
                  {
                    id: "schedule-coverage",
                    method: "POST",
                    endpoint: "/api/games/620/coverage-plan/schedule",
                    body: {
                      side: "both",
                      humanUserId: "user_a",
                      agentId: "agent_b",
                      limit: 3
                    }
                  },
                  {
                    id: "inspect-certificate",
                    method: "GET",
                    endpoint: "/api/games/620/result-certificate"
                  }
                ]
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/games/620/competition/run-local") {
      raced = true;
      response.statusCode = 201;
      response.end(JSON.stringify({
        run: {
          schemaVersion: "steambench.game-competition-run.v1",
          completedRuns: 2,
          bodyEcho: body
        },
        certificate: {
          schemaVersion: "steambench.result-certificate.v1",
          kind: "game-competition"
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/games/620/coverage-plan/schedule") {
      scheduled = true;
      response.statusCode = 201;
      response.end(JSON.stringify({
        schedule: {
          schemaVersion: "steambench.game-coverage-schedule.v1",
          totals: {
            queuedRuns: 3,
            dispatches: 2
          },
          bodyEcho: body
        }
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/games/620/result-certificate") {
      response.end(JSON.stringify({
        certificate: {
          schemaVersion: "steambench.result-certificate.v1",
          kind: "game-competition"
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

describe("app competition ops CLI runner", () => {
  it("fetches an app ops report and summarizes recommended actions", async () => {
    const { baseUrl, calls } = await startMockApi();
    const summary = await runCompetitionOps({
      baseUrl,
      appid: 620,
      humanUserId: "user_a",
      agentId: "agent_b",
      suiteTier: "ranked",
      season: "weekly",
      limit: 9
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.app-competition-ops-cli.v1",
      appid: 620,
      summary: {
        status: "needs-coverage",
        activeTasks: 4,
        humanGaps: 1,
        agentGaps: 2,
        selectedSuite: "620:ranked",
        recommendedActionIds: ["schedule-coverage", "inspect-certificate"]
      }
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/api/games/620/competition/ops-report");
    expect(calls[0].searchParams.get("humanUserId")).toBe("user_a");
    expect(calls[0].searchParams.get("agentId")).toBe("agent_b");
    expect(calls[0].searchParams.get("suiteTier")).toBe("ranked");
    expect(calls[0].searchParams.get("season")).toBe("weekly");
    expect(calls[0].searchParams.get("limit")).toBe("9");
  });

  it("explicitly executes a recommended POST action", async () => {
    const { baseUrl, calls } = await startMockApi();
    const summary = await runCompetitionOps({
      baseUrl,
      appid: 620,
      humanUserId: "user_a",
      agentId: "agent_b",
      suiteTier: "ranked",
      season: "all",
      limit: 4,
      execute: "schedule-coverage"
    });

    expect(summary).toMatchObject({
      summary: {
        status: "ready-to-race",
        humanGaps: 0,
        agentGaps: 0,
        recommendedActionIds: ["run-suite-race", "inspect-certificate"],
        executedActionId: "schedule-coverage",
        queuedRuns: 3,
        dispatches: 2
      },
      executedAction: {
        action: {
          id: "schedule-coverage",
          method: "POST",
          endpoint: "/api/games/620/coverage-plan/schedule"
        },
        result: {
          schedule: {
            totals: {
              queuedRuns: 3,
              dispatches: 2
            }
          }
        }
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/games/620/competition/ops-report",
      "POST /api/games/620/coverage-plan/schedule",
      "GET /api/games/620/competition/ops-report"
    ]);
    expect(calls[1].body).toEqual({
      side: "both",
      humanUserId: "user_a",
      agentId: "agent_b",
      limit: 3
    });
  });

  it("advances through coverage scheduling and suite race execution", async () => {
    const { baseUrl, calls } = await startMockApi();
    const summary = await runCompetitionOps({
      baseUrl,
      appid: 620,
      humanUserId: "user_a",
      agentId: "agent_b",
      suiteTier: "ranked",
      season: "all",
      limit: 4,
      execute: "advance-competition-actions",
      maxSteps: 3
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.app-competition-ops-cli.v1",
      appid: 620,
      executedAction: {
        action: { id: "schedule-coverage" }
      },
      summary: {
        status: "ready-to-race",
        humanGaps: 0,
        agentGaps: 0,
        recommendedActionIds: ["inspect-certificate"],
        executedActionId: "schedule-coverage",
        executedActionIds: [
          "schedule-coverage",
          "run-suite-race"
        ],
        executedActionCount: 2,
        queuedRuns: 3,
        dispatches: 2,
        completedRuns: 2,
        certificateKind: "game-competition"
      }
    });
    expect(summary.executedActions.map((entry) => entry.action.id)).toEqual([
      "schedule-coverage",
      "run-suite-race"
    ]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/games/620/competition/ops-report",
      "POST /api/games/620/coverage-plan/schedule",
      "GET /api/games/620/competition/ops-report",
      "POST /api/games/620/competition/run-local",
      "GET /api/games/620/competition/ops-report"
    ]);
    expect(calls[1].body).toEqual({
      side: "both",
      humanUserId: "user_a",
      agentId: "agent_b",
      limit: 3
    });
    expect(calls[3].body).toEqual({
      humanUserId: "user_a",
      agentId: "agent_b",
      suiteTier: "ranked",
      reviewApproved: false
    });
  });
});
