import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentTraceOps } from "./agent-trace-ops.mjs";

let server;

async function startMockApi() {
  const calls = [];
  let controlCreated = false;
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const call = { method: request.method, path: url.pathname, search: url.searchParams.toString() };
    if (bodyText) call.body = JSON.parse(bodyText);
    calls.push(call);
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/agent-traces/ops-report") {
      if (url.searchParams.get("verdict") === "needs-control-session") {
        response.end(JSON.stringify({
          report: {
            schemaVersion: "steambench.agent-trace-ops-report.v1",
            status: controlCreated ? "idle" : "needs-runtime",
            totals: {
              agentRuns: 4,
              selectedRuns: controlCreated ? 0 : 1,
              traceReady: 0,
              needsActions: 0,
              needsControlSession: controlCreated ? 0 : 1,
              needsExecutorReport: 0,
              invalid: 0,
              actions: 0,
              controlSessions: controlCreated ? 1 : 0,
              executorReports: 0
            },
            tickets: controlCreated
              ? []
              : [
                  {
                    run: { id: "run_controller" },
                    verdict: "needs-control-session"
                  }
                ],
            recommendedActions: controlCreated
              ? []
              : [
                  {
                    id: "create-control-session",
                    method: "POST",
                    endpoint: "/api/runs/run_controller/control-sessions",
                    body: { ttlSeconds: 900 }
                  },
                  { id: "inspect-agent-handoff", method: "GET", endpoint: "/api/runs/run_controller/agent-handoff" }
                ]
          }
        }));
        return;
      }
      response.end(JSON.stringify({
        report: {
          schemaVersion: "steambench.agent-trace-ops-report.v1",
          status: "needs-runtime",
          totals: {
            agentRuns: 4,
            selectedRuns: 1,
            traceReady: 0,
            needsActions: 0,
            needsControlSession: 0,
            needsExecutorReport: 1,
            invalid: 0,
            actions: 3,
            controlSessions: 1,
            executorReports: 0
          },
          tickets: [
            {
              run: { id: "run_trace" },
              verdict: "needs-executor-report"
            }
          ],
          recommendedActions: [
            { id: "run-bridge-executor" },
            { id: "inspect-agent-handoff" }
          ]
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runs/run_controller/control-sessions") {
      controlCreated = true;
      response.statusCode = 201;
      response.end(JSON.stringify({
        schemaVersion: "steambench.runtime-control-session.v1",
        session: {
          id: "control_1",
          runId: "run_controller",
          status: "active",
          ttlSeconds: call.body.ttlSeconds
        },
        links: {
          actionBatch: "/api/runs/run_controller/action-batches",
          bridgeManifest: "/api/control-sessions/control_1/bridge-manifest"
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

describe("agent trace ops CLI", () => {
  it("summarizes cross-run trace operations", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runAgentTraceOps({
      baseUrl,
      verdict: "needs-executor-report",
      limit: 7
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.agent-trace-ops-cli.v1",
      verdict: "needs-executor-report",
      summary: {
        status: "needs-runtime",
        agentRuns: 4,
        selectedRuns: 1,
        traceReady: 0,
        needsActions: 0,
        needsControlSession: 0,
        needsExecutorReport: 1,
        invalid: 0,
        actions: 3,
        controlSessions: 1,
        executorReports: 0,
        actionsRecommended: ["run-bridge-executor", "inspect-agent-handoff"]
      }
    });
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/agent-traces/ops-report",
        search: "verdict=needs-executor-report&limit=7"
      }
    ]);
  });

  it("executes the create-control-session API recommendation explicitly", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runAgentTraceOps({
      baseUrl,
      verdict: "needs-control-session",
      limit: 7,
      execute: "create-control-session",
      ttlSeconds: 120,
      idempotencyKey: "test-control"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.agent-trace-ops-cli.v1",
      verdict: "needs-control-session",
      executedAction: {
        action: {
          id: "create-control-session",
          method: "POST",
          endpoint: "/api/runs/run_controller/control-sessions"
        },
        result: {
          schemaVersion: "steambench.runtime-control-session.v1",
          session: {
            id: "control_1",
            runId: "run_controller",
            status: "active",
            ttlSeconds: 120
          }
        }
      },
      summary: {
        status: "idle",
        selectedRuns: 0,
        needsControlSession: 0,
        controlSessions: 1,
        actionsRecommended: [],
        executedActionId: "create-control-session",
        executedActionIds: ["create-control-session"],
        executedActionCount: 1,
        controlSessionId: "control_1",
        controlSessionRunId: "run_controller",
        controlSessionStatus: "active"
      }
    });
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/agent-traces/ops-report",
        search: "verdict=needs-control-session&limit=7"
      },
      {
        method: "POST",
        path: "/api/runs/run_controller/control-sessions",
        search: "",
        body: {
          ttlSeconds: 120,
          idempotencyKey: "test-control"
        }
      },
      {
        method: "GET",
        path: "/api/agent-traces/ops-report",
        search: "verdict=needs-control-session&limit=7"
      }
    ]);
  });

  it("advances control-session creation and stops before bridge handoffs", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runAgentTraceOps({
      baseUrl,
      verdict: "needs-control-session",
      limit: 7,
      execute: "advance-trace-actions",
      maxSteps: 2,
      ttlSeconds: 120,
      idempotencyKey: "advance-control"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.agent-trace-ops-cli.v1",
      verdict: "needs-control-session",
      summary: {
        status: "idle",
        selectedRuns: 0,
        needsControlSession: 0,
        controlSessions: 1,
        actionsRecommended: [],
        executedActionId: "create-control-session",
        executedActionIds: ["create-control-session"],
        executedActionCount: 1,
        controlSessionId: "control_1",
        controlSessionRunId: "run_controller",
        controlSessionStatus: "active"
      }
    });
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/agent-traces/ops-report",
        search: "verdict=needs-control-session&limit=7"
      },
      {
        method: "POST",
        path: "/api/runs/run_controller/control-sessions",
        search: "",
        body: {
          ttlSeconds: 120,
          idempotencyKey: "advance-control"
        }
      },
      {
        method: "GET",
        path: "/api/agent-traces/ops-report",
        search: "verdict=needs-control-session&limit=7"
      }
    ]);
  });
});
