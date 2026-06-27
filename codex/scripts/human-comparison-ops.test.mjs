import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runHumanComparisonOps } from "./human-comparison-ops.mjs";

let server;

function reportPayload(ran = false) {
  return {
    report: {
      schemaVersion: "steambench.human-agent-comparison-ops-report.v1",
      status: ran ? "ready-to-share" : "needs-human-runs",
      standings: {
        schemaVersion: "steambench.human-agent-comparison-standings.v1",
        totals: {
          comparisons: 1,
          completeComparisons: ran ? 1 : 0,
          incompleteComparisons: ran ? 0 : 1,
          humans: 1,
          agents: 1,
          campaigns: 1,
          humanWins: ran ? 1 : 0,
          agentWins: 0,
          ties: 0,
          humanScore: ran ? 9000 : 0,
          agentScore: 8700,
          humanMissing: ran ? 0 : 2,
          agentMissing: 0,
          readyForPublicShare: ran ? 1 : 0
        },
        leaderboard: [],
        humans: [],
        agents: [],
        matchups: []
      },
      recommendedActions: ran
        ? [
            {
              id: "share-comparison-certificate",
              method: "GET",
              endpoint: "/api/comparisons/human-agent/result-certificate?humanUserId=human_a&campaignId=campaign_a",
              reason: "ready"
            },
            {
              id: "inspect-comparison-standings",
              method: "GET",
              endpoint: "/api/comparisons/human-agent/standings",
              reason: "inspect"
            }
          ]
        : [
            {
              id: "run-human-campaign-local",
              method: "POST",
              endpoint: "/api/users/human_a/human-campaigns/run-local",
              body: {
                campaignId: "campaign_a",
                limit: 2
              },
              reason: "missing human runs"
            },
            {
              id: "inspect-comparison-standings",
              method: "GET",
              endpoint: "/api/comparisons/human-agent/standings",
              reason: "inspect"
            }
          ],
      links: {
        standings: "/api/comparisons/human-agent/standings"
      }
    }
  };
}

async function readBody(request) {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function startMockApi() {
  const calls = [];
  let ran = false;
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : {};
    calls.push({ method: request.method, path: url.pathname, search: url.searchParams.toString(), body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/comparisons/human-agent/ops-report") {
      response.end(JSON.stringify(reportPayload(ran)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/users/human_a/human-campaigns/run-local") {
      ran = true;
      response.end(JSON.stringify({
        schemaVersion: "steambench.human-campaign-run.v1",
        planAfter: {
          status: "complete"
        }
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/comparisons/human-agent/result-certificate") {
      response.end(JSON.stringify({
        certificate: {
          kind: "human-agent-comparison",
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

describe("human comparison ops CLI runner", () => {
  it("summarizes comparison ops without side effects", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runHumanComparisonOps({
      baseUrl,
      humanUserId: "human_a",
      campaignId: "campaign_a",
      limit: 5,
      execute: ""
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.human-comparison-ops-cli.v1",
      summary: {
        status: "needs-human-runs",
        comparisons: 1,
        completeComparisons: 0,
        incompleteComparisons: 1,
        readyForPublicShare: 0,
        actions: ["run-human-campaign-local", "inspect-comparison-standings"]
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/comparisons/human-agent/ops-report"
    ]);
    expect(calls[0].search).toContain("humanUserId=human_a");
    expect(calls[0].search).toContain("campaignId=campaign_a");
    expect(calls[0].search).toContain("limit=5");
  });

  it("executes a recommended local human campaign action explicitly", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runHumanComparisonOps({
      baseUrl,
      humanUserId: "human_a",
      campaignId: "campaign_a",
      limit: 5,
      execute: "run-human-campaign-local"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.human-comparison-ops-cli.v1",
      executedAction: {
        action: {
          id: "run-human-campaign-local",
          method: "POST",
          endpoint: "/api/users/human_a/human-campaigns/run-local"
        },
        result: {
          schemaVersion: "steambench.human-campaign-run.v1"
        }
      },
      summary: {
        status: "ready-to-share",
        completeComparisons: 1,
        readyForPublicShare: 1,
        executedActionId: "run-human-campaign-local",
        humanCampaignRunStatus: "complete"
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/comparisons/human-agent/ops-report",
      "POST /api/users/human_a/human-campaigns/run-local",
      "GET /api/comparisons/human-agent/ops-report"
    ]);
    expect(calls[1].body).toEqual({
      campaignId: "campaign_a",
      limit: 2
    });
  });

  it("advances through missing human runs and comparison certificate sharing", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runHumanComparisonOps({
      baseUrl,
      humanUserId: "human_a",
      campaignId: "campaign_a",
      limit: 5,
      execute: "advance-comparison-actions",
      maxSteps: 3
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.human-comparison-ops-cli.v1",
      executedAction: {
        action: { id: "run-human-campaign-local" }
      },
      summary: {
        status: "ready-to-share",
        completeComparisons: 1,
        readyForPublicShare: 1,
        executedActionId: "run-human-campaign-local",
        executedActionIds: [
          "run-human-campaign-local",
          "share-comparison-certificate"
        ],
        executedActionCount: 2,
        humanCampaignRunStatus: "complete",
        actions: [
          "share-comparison-certificate",
          "inspect-comparison-standings"
        ]
      }
    });
    expect(summary.executedActions.map((entry) => entry.action.id)).toEqual([
      "run-human-campaign-local",
      "share-comparison-certificate"
    ]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/comparisons/human-agent/ops-report",
      "POST /api/users/human_a/human-campaigns/run-local",
      "GET /api/comparisons/human-agent/ops-report",
      "GET /api/comparisons/human-agent/result-certificate",
      "GET /api/comparisons/human-agent/ops-report"
    ]);
  });
});
