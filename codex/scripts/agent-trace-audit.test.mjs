import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentTraceAudit } from "./agent-trace-audit.mjs";

let server;

async function startMockApi() {
  const calls = [];
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    calls.push({ method: request.method, path: url.pathname, search: url.searchParams.toString() });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/runs/run_trace/agent-trace/audit") {
      response.end(JSON.stringify({
        audit: {
          schemaVersion: "steambench.agent-trace-audit.v1",
          verdict: "needs-executor-report",
          actionSpace: {
            inputMode: "controller",
            transport: "virtual-controller"
          },
          totals: {
            observations: 1,
            actionBatches: 1,
            actions: 3,
            controlSessions: 1,
            executorReports: 0,
            invalidFindings: 0
          },
          findings: [],
          recommendedActions: [
            { id: "run-bridge-executor" },
            { id: "inspect-agent-handoff" }
          ]
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

describe("agent trace audit CLI", () => {
  it("summarizes trace integrity", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runAgentTraceAudit({
      baseUrl,
      runId: "run_trace"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.agent-trace-audit-cli.v1",
      summary: {
        verdict: "needs-executor-report",
        inputMode: "controller",
        transport: "virtual-controller",
        observations: 1,
        actionBatches: 1,
        actions: 3,
        controlSessions: 1,
        executorReports: 0,
        invalidFindings: 0,
        actionsRecommended: ["run-bridge-executor", "inspect-agent-handoff"]
      }
    });
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/runs/run_trace/agent-trace/audit",
        search: ""
      }
    ]);
  });
});
