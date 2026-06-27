import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentOps } from "./agent-ops.mjs";

let server;

async function startMockApi() {
  const calls = [];
  let campaignCreated = false;
  let runSessionOpened = false;
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    calls.push({ method: request.method, path: url.pathname, search: url.searchParams.toString(), body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/agents/ops-report") {
      const recommendedActions = [];
      if (!runSessionOpened) {
        recommendedActions.push({ id: "open-agent-run-session", label: "Open agent run session", priority: "high", method: "POST", endpoint: "/api/agents/a1/run-session", body: { taskId: "620:STAT.PORTALS", ttlSeconds: 900 }, reason: "ready" });
      }
      if (!campaignCreated) {
        recommendedActions.push({ id: "create-agent-campaign", label: "Create agent campaign", priority: runSessionOpened ? "high" : "medium", method: "POST", endpoint: "/api/agents/a1/campaigns", reason: "ready" });
      }
      recommendedActions.push({ id: "drain-dispatches", label: "Drain queued dispatches", priority: "medium", method: "CLI", command: "npm run dispatch:ops -- --provider=local --status=planned,launched", reason: "queued" });
      response.end(JSON.stringify({
        report: {
          schemaVersion: "steambench.agent-ops-report.v1",
          generatedAt: "2026-06-14T00:00:00.000Z",
          status: "needs-dispatch",
          filters: { provider: "local", limit: 10 },
          totals: {
            agents: 2,
            selectedAgents: 2,
            active: 2,
            paused: 0,
            readyForCampaign: campaignCreated || runSessionOpened ? 0 : 1,
            queuedAgents: campaignCreated || runSessionOpened ? 2 : 1,
            runningAgents: 0,
            failedAgents: 0,
            blockedAgents: 0,
            queuedRuns: campaignCreated ? 3 : runSessionOpened ? 2 : 1,
            activeRuns: 0,
            failedRuns: 0,
            readyRecommendedTasks: 4,
            missingCapabilities: []
          },
          tickets: [],
          recommendedActions,
          links: {
            agents: "/api/agents",
            dispatchOps: "/api/dispatches/ops-report",
            campaignStandings: "/api/campaign-standings"
          }
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/agents/a1/campaigns") {
      campaignCreated = true;
      response.statusCode = 201;
      response.end(JSON.stringify({
        campaign: {
          schemaVersion: "steambench.agent-campaign.v1",
          id: "camp_1",
          selectedTaskCount: 2,
          runCount: 2,
          dispatchCount: 2,
          report: {
            schemaVersion: "steambench.agent-campaign-report.v1",
            campaign: { id: "camp_1" },
            totals: { runs: 2, dispatches: 2 }
          }
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/agents/a1/run-session") {
      runSessionOpened = true;
      response.statusCode = 201;
      response.end(JSON.stringify({
        schemaVersion: "steambench.agent-run-session.v1",
        run: {
          id: "run_session_1",
          taskId: body.taskId
        },
        handoff: {
          status: "ready-for-actions"
        },
        controlSession: {
          session: {
            id: "control_1"
          }
        },
        accessPacket: {
          schemaVersion: "steambench.runtime-control-access-packet.v1",
          audit: {
            readyForActions: true,
            readyForBridge: true
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

describe("agent ops CLI runner", () => {
  it("summarizes cross-agent runtime readiness", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runAgentOps({
      baseUrl,
      provider: "local",
      limit: 10
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.agent-ops-cli.v1",
      provider: "local",
      summary: {
        status: "needs-dispatch",
        agents: 2,
        active: 2,
        readyForCampaign: 1,
        queuedAgents: 1,
        queuedRuns: 1,
        actions: ["open-agent-run-session", "create-agent-campaign", "drain-dispatches"]
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/agents/ops-report"
    ]);
    expect(calls[0].search).toContain("provider=local");
    expect(calls[0].search).toContain("limit=10");
  });

  it("executes an agent run-session recommendation with a bounded lease", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runAgentOps({
      baseUrl,
      provider: "local",
      limit: 10,
      execute: "open-agent-run-session",
      ttlSeconds: 120,
      createControlSession: true,
      idempotencyKey: "ops-run-session"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.agent-ops-cli.v1",
      provider: "local",
      executedAction: {
        action: { id: "open-agent-run-session" },
        result: {
          schemaVersion: "steambench.agent-run-session.v1",
          run: {
            id: "run_session_1",
            taskId: "620:STAT.PORTALS"
          },
          controlSession: {
            session: {
              id: "control_1"
            }
          }
        }
      },
      summary: {
        status: "needs-dispatch",
        readyForCampaign: 0,
        queuedAgents: 2,
        queuedRuns: 2,
        executedActionId: "open-agent-run-session",
        executedActionIds: ["open-agent-run-session"],
        executedActionCount: 1,
        runSessionId: "run_session_1",
        runSessionTaskId: "620:STAT.PORTALS",
        runSessionStatus: "ready-for-actions",
        runSessionControlId: "control_1",
        runSessionAccessPacketReady: true,
        runSessionBridgeReady: true
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/agents/ops-report",
      "POST /api/agents/a1/run-session",
      "GET /api/agents/ops-report"
    ]);
    expect(calls[1].body).toEqual({
      taskId: "620:STAT.PORTALS",
      ttlSeconds: 120,
      createControlSession: true,
      idempotencyKey: "ops-run-session"
    });
  });

  it("executes a named API recommendation only when requested", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runAgentOps({
      baseUrl,
      provider: "local",
      limit: 10,
      execute: "create-agent-campaign",
      campaignLimit: 2,
      dispatch: true,
      reviewApproved: false
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.agent-ops-cli.v1",
      provider: "local",
      executedAction: {
        action: { id: "create-agent-campaign" },
        result: {
          campaign: {
            schemaVersion: "steambench.agent-campaign.v1",
            id: "camp_1",
            runCount: 2,
            dispatchCount: 2
          }
        }
      },
      summary: {
        status: "needs-dispatch",
        readyForCampaign: 0,
        queuedAgents: 2,
        queuedRuns: 3,
        executedActionId: "create-agent-campaign",
        executedActionIds: ["create-agent-campaign"],
        executedActionCount: 1,
        campaignId: "camp_1",
        campaignRunCount: 2,
        campaignDispatchCount: 2
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/agents/ops-report",
      "POST /api/agents/a1/campaigns",
      "GET /api/agents/ops-report"
    ]);
    expect(calls[1].body).toEqual({
      limit: 2,
      dispatch: true,
      reviewApproved: false,
      provider: "local"
    });
  });

  it("advances API-backed agent runtime actions and stops before CLI handoffs", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runAgentOps({
      baseUrl,
      provider: "local",
      limit: 10,
      execute: "advance-agent-actions",
      maxSteps: 3,
      ttlSeconds: 120,
      createControlSession: true,
      idempotencyKey: "ops-advance-agent",
      campaignLimit: 2,
      dispatch: true,
      reviewApproved: false
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.agent-ops-cli.v1",
      provider: "local",
      summary: {
        status: "needs-dispatch",
        readyForCampaign: 0,
        queuedAgents: 2,
        queuedRuns: 3,
        executedActionId: "open-agent-run-session",
        executedActionIds: ["open-agent-run-session", "create-agent-campaign"],
        executedActionCount: 2,
        runSessionId: "run_session_1",
        runSessionTaskId: "620:STAT.PORTALS",
        runSessionStatus: "ready-for-actions",
        runSessionControlId: "control_1",
        runSessionAccessPacketReady: true,
        runSessionBridgeReady: true,
        campaignId: "camp_1",
        campaignRunCount: 2,
        campaignDispatchCount: 2,
        actions: ["drain-dispatches"]
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/agents/ops-report",
      "POST /api/agents/a1/run-session",
      "GET /api/agents/ops-report",
      "POST /api/agents/a1/campaigns",
      "GET /api/agents/ops-report"
    ]);
    expect(calls[1].body).toEqual({
      taskId: "620:STAT.PORTALS",
      ttlSeconds: 120,
      createControlSession: true,
      idempotencyKey: "ops-advance-agent"
    });
    expect(calls[3].body).toEqual({
      limit: 2,
      dispatch: true,
      reviewApproved: false,
      provider: "local"
    });
  });
});
