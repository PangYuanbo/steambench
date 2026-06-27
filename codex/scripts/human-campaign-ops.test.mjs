import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runHumanCampaignOps } from "./human-campaign-ops.mjs";

let server;

function planPayload(ran = false) {
  return {
    plan: {
      schemaVersion: "steambench.human-campaign-plan.v1",
      status: ran ? "complete" : "ready",
      user: {
        id: "human_a",
        type: "human",
        linkedSteamId: "76561198000000000"
      },
      source: {
        type: "agent-campaign",
        campaignId: "campaign_a",
        agentId: "agent_a",
        agentName: "Agent A"
      },
      totals: {
        tasks: 2,
        ready: ran ? 0 : 2,
        alreadyScored: ran ? 2 : 0,
        blocked: 0,
        achievementTasks: 1,
        manualTasks: 1,
        completionRate: ran ? 100 : 0,
        humanScore: ran ? 9000 : 0,
        agentScore: 8700
      },
      links: {
        proofPlan: "/api/users/human_a/steam-proof-plan",
        submitNext: ran ? undefined : "/api/users/human_a/steam-proof-submissions",
        comparison: "/api/comparisons/human-agent?humanUserId=human_a&campaignId=campaign_a",
        comparisonEvidenceBundle: "/api/comparisons/human-agent/evidence-bundle?humanUserId=human_a&campaignId=campaign_a",
        comparisonResultCertificate: "/api/comparisons/human-agent/result-certificate?humanUserId=human_a&campaignId=campaign_a"
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

    if (request.method === "GET" && url.pathname === "/api/users/human_a/human-campaign-plan") {
      response.end(JSON.stringify(planPayload(ran)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/users/human_a/human-campaigns/run-local") {
      ran = true;
      response.end(JSON.stringify({
        schemaVersion: "steambench.human-campaign-run.v1",
        userId: "human_a",
        campaignId: body.campaignId,
        planBefore: planPayload(false).plan,
        submissions: [
          { submission: { runId: "run_human_a", scoreboardReady: true } },
          { submission: { runId: "run_human_b", scoreboardReady: true } }
        ],
        planAfter: planPayload(true).plan,
        comparison: {
          schemaVersion: "steambench.human-agent-comparison.v1",
          status: "complete"
        },
        bundle: {
          schemaVersion: "steambench.human-agent-comparison-evidence-bundle.v1",
          integrity: {
            comparisonComplete: true
          }
        },
        certificate: {
          schemaVersion: "steambench.result-certificate.v1",
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

describe("human campaign ops CLI runner", () => {
  it("summarizes a human campaign plan without side effects", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runHumanCampaignOps({
      baseUrl,
      userId: "human_a",
      campaignId: "campaign_a",
      limit: 2,
      execute: ""
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.human-campaign-ops-cli.v1",
      userId: "human_a",
      campaignId: "campaign_a",
      summary: {
        status: "ready",
        sourceType: "agent-campaign",
        sourceCampaignId: "campaign_a",
        tasks: 2,
        ready: 2,
        alreadyScored: 0,
        completionRate: 0,
        humanScore: 0,
        agentScore: 8700,
        execute: "inspect"
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/users/human_a/human-campaign-plan"
    ]);
    expect(calls[0].search).toContain("campaignId=campaign_a");
    expect(calls[0].search).toContain("limit=2");
  });

  it("executes the human campaign local runner explicitly", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runHumanCampaignOps({
      baseUrl,
      userId: "human_a",
      campaignId: "campaign_a",
      limit: 2,
      execute: "run-local"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.human-campaign-ops-cli.v1",
      plan: {
        status: "complete",
        totals: {
          alreadyScored: 2,
          completionRate: 100,
          humanScore: 9000
        }
      },
      executedAction: {
        action: {
          id: "run-local",
          method: "POST",
          endpoint: "/api/users/human_a/human-campaigns/run-local"
        },
        result: {
          schemaVersion: "steambench.human-campaign-run.v1",
          submissions: [{ submission: { runId: "run_human_a" } }, { submission: { runId: "run_human_b" } }],
          comparison: {
            status: "complete"
          },
          certificate: {
            kind: "human-agent-comparison"
          }
        }
      },
      summary: {
        status: "complete",
        ready: 0,
        alreadyScored: 2,
        completionRate: 100,
        execute: "run-local",
        executedActionId: "run-local",
        submissions: 2,
        comparisonStatus: "complete",
        comparisonComplete: true,
        certificateKind: "human-agent-comparison",
        certificateReady: true
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/users/human_a/human-campaign-plan",
      "POST /api/users/human_a/human-campaigns/run-local",
      "GET /api/users/human_a/human-campaign-plan"
    ]);
    expect(calls[1].body).toEqual({
      campaignId: "campaign_a",
      limit: 2
    });
  });
});
