import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runCompetitionEventOps } from "./competition-event-ops.mjs";

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
  let suiteRan = false;
  let campaignRan = false;
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : {};
    calls.push({ method: request.method, path: url.pathname, searchParams: url.searchParams, body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/competition-events/weekly/ops-report") {
      response.end(JSON.stringify({
        report: {
          schemaVersion: "steambench.competition-event-ops-report.v1",
          scope: "weekly",
          status: campaignRan ? "ready-to-share" : suiteRan ? "needs-campaign-comparison" : scheduled ? "needs-execution" : "needs-scheduling",
          selectedSuite: {
            id: "620:ranked",
            title: "Portal 2 Ranked"
          },
          totals: {
            registeredPairs: 2,
            scheduledRaces: scheduled ? 1 : 0,
            scoredRaces: suiteRan ? 1 : 0,
            campaignComparisons: campaignRan ? 1 : 0,
            readyForPublicShare: campaignRan
          },
          recommendedActions: campaignRan
            ? [
                {
                  id: "inspect-event-certificate",
                  method: "GET",
                  endpoint: "/api/competition-events/weekly/result-certificate"
                }
              ]
            : suiteRan
              ? [
                  {
                    id: "run-campaign-comparisons-local",
                    method: "POST",
                    endpoint: "/api/competition-events/weekly/run-campaign-comparisons-local",
                    body: {
                      maxPairs: 2
                    }
                  },
                  {
                    id: "inspect-event-certificate",
                    method: "GET",
                    endpoint: "/api/competition-events/weekly/result-certificate"
                  }
                ]
              : scheduled
                ? [
                {
                  id: "run-suite-local",
                  method: "POST",
                  endpoint: "/api/competition-events/weekly/run-suite",
                  body: {
                    suiteId: "620:ranked",
                    maxRaces: 1
                  }
                },
                {
                  id: "inspect-event-certificate",
                  method: "GET",
                  endpoint: "/api/competition-events/weekly/result-certificate"
                }
              ]
                : [
                {
                  id: "schedule-suite",
                  method: "POST",
                  endpoint: "/api/competition-events/weekly/schedule-suite",
                  body: {
                    suiteId: "620:ranked",
                    maxPairs: 2
                  }
                },
                {
                  id: "inspect-event-certificate",
                  method: "GET",
                  endpoint: "/api/competition-events/weekly/result-certificate"
                }
              ]
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/competition-events/weekly/schedule-suite") {
      scheduled = true;
      response.statusCode = 201;
      response.end(JSON.stringify({
        schedule: {
          scope: "weekly",
          scheduled: [{ race: { id: "suite_race_a", eventScope: "weekly" } }],
          bodyEcho: body
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/competition-events/weekly/run-suite") {
      suiteRan = true;
      response.end(JSON.stringify({
        run: {
          scope: "weekly",
          executed: [{ race: { id: "suite_race_a" } }],
          certificate: {
            kind: "competition-event"
          },
          bodyEcho: body
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/competition-events/weekly/run-campaign-comparisons-local") {
      campaignRan = true;
      response.end(JSON.stringify({
        run: {
          scope: "weekly",
          executed: [{ comparisonId: "human_a:campaign_a" }],
          certificate: {
            kind: "competition-event"
          },
          bodyEcho: body
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

describe("competition event ops CLI runner", () => {
  it("fetches an event ops report with suite filter and summarizes actions", async () => {
    const { baseUrl, calls } = await startMockApi();
    const summary = await runCompetitionEventOps({
      baseUrl,
      scope: "weekly",
      suiteId: "620:ranked",
      execute: "",
      maxPairs: 4,
      maxRaces: 3
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.competition-event-ops-cli.v1",
      scope: "weekly",
      summary: {
        status: "needs-scheduling",
        registeredPairs: 2,
        scheduledRaces: 0,
        selectedSuite: "620:ranked",
        recommendedActionIds: ["schedule-suite", "inspect-event-certificate"]
      }
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/api/competition-events/weekly/ops-report");
    expect(calls[0].searchParams.get("suiteId")).toBe("620:ranked");
  });

  it("explicitly executes a recommended event action", async () => {
    const { baseUrl, calls } = await startMockApi();
    const summary = await runCompetitionEventOps({
      baseUrl,
      scope: "weekly",
      suiteId: "620:ranked",
      execute: "schedule-suite",
      maxPairs: 4,
      maxRaces: 3
    });

    expect(summary).toMatchObject({
      summary: {
        status: "needs-execution",
        scheduledRaces: 1,
        recommendedActionIds: ["run-suite-local", "inspect-event-certificate"],
        executedActionId: "schedule-suite",
        scheduledCount: 1
      },
      executedAction: {
        result: {
          schedule: {
            scope: "weekly",
            scheduled: [{ race: { id: "suite_race_a" } }]
          }
        }
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/competition-events/weekly/ops-report",
      "POST /api/competition-events/weekly/schedule-suite",
      "GET /api/competition-events/weekly/ops-report"
    ]);
    expect(calls[1].body).toMatchObject({
      suiteId: "620:ranked",
      maxPairs: 4
    });
  });

  it("advances through scheduling, local suite execution, and campaign comparisons", async () => {
    const { baseUrl, calls } = await startMockApi();
    const summary = await runCompetitionEventOps({
      baseUrl,
      scope: "weekly",
      suiteId: "620:ranked",
      execute: "advance-event-actions",
      maxPairs: 4,
      maxRaces: 3,
      maxSteps: 4
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.competition-event-ops-cli.v1",
      scope: "weekly",
      executedAction: {
        action: { id: "schedule-suite" }
      },
      summary: {
        status: "ready-to-share",
        scheduledRaces: 1,
        scoredRaces: 1,
        campaignComparisons: 1,
        readyForPublicShare: true,
        recommendedActionIds: ["inspect-event-certificate"],
        executedActionId: "schedule-suite",
        executedActionIds: [
          "schedule-suite",
          "run-suite-local",
          "run-campaign-comparisons-local"
        ],
        executedActionCount: 3,
        scheduledCount: 1,
        executedRaces: 1,
        campaignComparisonCount: 1,
        certificateKind: "competition-event"
      }
    });
    expect(summary.executedActions.map((entry) => entry.action.id)).toEqual([
      "schedule-suite",
      "run-suite-local",
      "run-campaign-comparisons-local"
    ]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/competition-events/weekly/ops-report",
      "POST /api/competition-events/weekly/schedule-suite",
      "GET /api/competition-events/weekly/ops-report",
      "POST /api/competition-events/weekly/run-suite",
      "GET /api/competition-events/weekly/ops-report",
      "POST /api/competition-events/weekly/run-campaign-comparisons-local",
      "GET /api/competition-events/weekly/ops-report"
    ]);
    expect(calls[1].body).toMatchObject({
      suiteId: "620:ranked",
      maxPairs: 4
    });
    expect(calls[3].body).toMatchObject({
      suiteId: "620:ranked",
      maxRaces: 3
    });
    expect(calls[5].body).toMatchObject({
      maxPairs: 4
    });
  });
});
