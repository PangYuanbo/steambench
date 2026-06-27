import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runRuntimeDispatchOps } from "./runtime-dispatch-ops.mjs";

let server;

async function startMockApi() {
  const calls = [];
  let drained = false;
  let requeued = false;
  const dispatch = {
    id: "dispatch_local_a",
    runId: "run_a",
    taskId: "620:ACH_A",
    agentId: "agent_a",
    provider: "local",
    status: "planned",
    workerId: "worker_a",
    command: "node -e \"process.stdout.write('dispatch-worker-ok')\"",
    manifestUrl: "/api/runs/run_a/execution-manifest?agentId=agent_a",
    runtimePackageUrl: "/api/runs/run_a/runtime-package?agentId=agent_a"
  };
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const call = { method: request.method, path: url.pathname, searchParams: url.searchParams };
    if (bodyText) call.body = JSON.parse(bodyText);
    calls.push(call);
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/dispatches/ops-report") {
      const recommendedActions = [];
      if (!drained && !requeued) {
        recommendedActions.push({
          id: "requeue-expired-workers",
          method: "POST",
          endpoint: "/api/worker/requeue-expired"
        });
      }
      if (!drained) {
        recommendedActions.push({
          id: "drain-local-dispatches",
          method: "CLI",
          command: "npm run dispatch:drain -- --provider=local --status=planned,launched --limit=2"
        });
      }
      response.end(JSON.stringify({
        report: {
          schemaVersion: "steambench.runtime-dispatch-ops-report.v1",
          status: drained ? "idle" : "needs-drain",
          totals: {
            selectedDispatches: drained ? 0 : 3,
            pendingLocal: drained ? 0 : 2,
            pendingModal: drained ? 0 : 1,
            proofMissing: 0,
            failed: 0,
            workerExpired: requeued ? 0 : 1
          },
          recommendedActions
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/worker/requeue-expired") {
      requeued = true;
      response.end(JSON.stringify({
        schemaVersion: "steambench.worker-requeue.v1",
        requeuedRuns: ["run_expired"]
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/dispatches") {
      response.end(JSON.stringify({
        dispatches: drained
          ? []
          : [
              {
                dispatch,
                run: { id: "run_a", status: "queued" },
                task: { id: "620:ACH_A", title: "Achievement A" },
                agent: { id: "agent_a", handle: "agent-a" }
              }
            ]
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/dispatches/dispatch_local_a/status") {
      if (call.body.status === "completed") drained = true;
      response.end(JSON.stringify({
        dispatch: {
          ...dispatch,
          status: call.body.status,
          summary: call.body.summary
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

describe("runtime dispatch ops CLI runner", () => {
  it("fetches the dispatch ops report with filters and summarizes actions", async () => {
    const { baseUrl, calls } = await startMockApi();
    const summary = await runRuntimeDispatchOps({
      baseUrl,
      provider: "local",
      status: "planned,launched",
      limit: 7
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.runtime-dispatch-ops-cli.v1",
      summary: {
        status: "needs-drain",
        selectedDispatches: 3,
        pendingLocal: 2,
        pendingModal: 1,
        workerExpired: 1,
        recommendedActionIds: ["requeue-expired-workers", "drain-local-dispatches"]
      }
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/api/dispatches/ops-report");
    expect(calls[0].searchParams.get("provider")).toBe("local");
    expect(calls[0].searchParams.get("status")).toBe("planned,launched");
    expect(calls[0].searchParams.get("limit")).toBe("7");
  });

  it("executes the requeue-expired-workers API recommendation explicitly", async () => {
    const { baseUrl, calls } = await startMockApi();
    const summary = await runRuntimeDispatchOps({
      baseUrl,
      provider: "local",
      status: "planned,launched",
      limit: 7,
      execute: "requeue-expired-workers"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.runtime-dispatch-ops-cli.v1",
      executedAction: {
        action: {
          id: "requeue-expired-workers",
          method: "POST"
        },
        result: {
          requeuedRuns: ["run_expired"]
        }
      },
      summary: {
        executedActionId: "requeue-expired-workers",
        executedActionIds: ["requeue-expired-workers"],
        executedActionCount: 1,
        workerExpired: 0,
        requeuedRuns: 1
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/dispatches/ops-report",
      "POST /api/worker/requeue-expired",
      "GET /api/dispatches/ops-report"
    ]);
  });

  it("executes the drain-local-dispatches CLI recommendation explicitly", async () => {
    const { baseUrl, calls } = await startMockApi();
    const summary = await runRuntimeDispatchOps({
      baseUrl,
      provider: "local",
      status: "planned,launched",
      limit: 7,
      execute: "drain-local-dispatches"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.runtime-dispatch-ops-cli.v1",
      executedAction: {
        action: {
          id: "drain-local-dispatches",
          method: "CLI"
        },
        result: {
          schemaVersion: "steambench.runtime-dispatch-drain.v1",
          totals: {
            selected: 1,
            completed: 1,
            failed: 0
          },
          results: [
            {
              dispatchId: "dispatch_local_a",
              terminalStatus: "completed",
              stdout: "dispatch-worker-ok"
            }
          ]
        }
      },
      summary: {
        status: "idle",
        pendingLocal: 0,
        recommendedActionIds: [],
        executedActionId: "drain-local-dispatches",
        executedActionIds: ["drain-local-dispatches"],
        executedActionCount: 1,
        drainSelected: 1,
        drainCompleted: 1,
        drainFailed: 0
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/dispatches/ops-report",
      "GET /api/dispatches",
      "POST /api/dispatches/dispatch_local_a/status",
      "POST /api/dispatches/dispatch_local_a/status",
      "GET /api/dispatches/ops-report"
    ]);
  });

  it("advances expired worker requeue and local dispatch drain", async () => {
    const { baseUrl, calls } = await startMockApi();
    const summary = await runRuntimeDispatchOps({
      baseUrl,
      provider: "local",
      status: "planned,launched",
      limit: 7,
      execute: "advance-dispatch-actions",
      maxSteps: 2
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.runtime-dispatch-ops-cli.v1",
      summary: {
        status: "idle",
        pendingLocal: 0,
        workerExpired: 0,
        recommendedActionIds: [],
        executedActionId: "requeue-expired-workers",
        executedActionIds: ["requeue-expired-workers", "drain-local-dispatches"],
        executedActionCount: 2,
        requeuedRuns: 1,
        drainSelected: 1,
        drainCompleted: 1,
        drainFailed: 0
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/dispatches/ops-report",
      "POST /api/worker/requeue-expired",
      "GET /api/dispatches/ops-report",
      "GET /api/dispatches",
      "POST /api/dispatches/dispatch_local_a/status",
      "POST /api/dispatches/dispatch_local_a/status",
      "GET /api/dispatches/ops-report"
    ]);
  });
});
