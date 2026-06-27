import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runControlBridgeOps } from "./control-bridge-ops.mjs";

let server;

async function startMockApi() {
  const calls = [];
  let executorReported = false;
  const actionSpace = {
    schemaVersion: "steambench.runtime-action-space.v1",
    inputMode: "controller",
    transport: "virtual-controller",
    permissions: {
      controller: true,
      keyboard: false,
      mouse: false,
      turnBased: false,
      privilegedSystemInput: false
    },
    allowedActionTypes: ["button", "stick", "trigger", "wait"],
    controller: {
      layout: "xinput-standard",
      buttons: ["a", "b"],
      sticks: ["left"],
      triggers: ["rt"],
      stickRange: { min: -1, max: 1 },
      triggerRange: { min: 0, max: 1 },
      defaultTapMs: 80
    },
    constraints: {
      maxActionsPerBatch: 32,
      maxBatchDurationMs: 4000,
      minObserveBeforeAct: true,
      requireCanonicalCapture: true,
      forbiddenActions: ["os-hotkey"]
    },
    examples: [{ type: "button", button: "a", action: "tap", durationMs: 80 }]
  };
  const manifest = () => ({
    schemaVersion: "steambench.control-bridge-manifest.v1",
    bridge: {
      provider: "geforce-now",
      transport: "virtual-controller",
      inputMode: "controller",
      executor: {
        planSchemaVersion: "steambench.controller-execution-plan.v1",
        target: "xinput-standard",
        timing: "relative-ms",
        neutralOnCompletion: true
      }
    },
    lease: {
      id: "control_a",
      status: "active",
      runId: "run_a",
      taskId: "task_a"
    },
    actionSpace,
    endpoints: {
      actionBatch: "/api/runs/run_a/action-batches",
      heartbeat: "/api/control-sessions/control_a/heartbeat",
      revoke: "/api/control-sessions/control_a/revoke",
      trace: "/api/runs/run_a/agent-trace",
      executorReport: "/api/runs/run_a/controller-executor-reports"
    },
    evidence: {
      canonicalArtifact: "output/output.mp4",
      acceptedArtifactName: "output.mp4",
      forbiddenArtifactNames: ["output-test.mp4"]
    },
    audit: {
      readyForBridge: true,
      blockers: [],
      acceptedActions: executorReported ? 2 : 1,
      executorReports: executorReported ? 1 : 0,
      lastExecutorStatus: executorReported ? "validated" : undefined,
      lastExecutorSideEffects: executorReported ? false : undefined
    }
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const call = { method: request.method, path: url.pathname, searchParams: url.searchParams };
    if (bodyText) call.body = JSON.parse(bodyText);
    calls.push(call);
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/control-sessions/ops-report") {
      response.end(JSON.stringify({
        report: {
          schemaVersion: "steambench.control-bridge-ops-report.v1",
          status: executorReported ? "idle" : "needs-executor-report",
          totals: {
            selectedSessions: 2,
            active: 2,
            readyForBridge: 1,
            needsExecutorReport: executorReported ? 0 : 1,
            executorValidated: executorReported ? 1 : 0,
            expired: 0,
            broken: 0
          },
          recommendedActions: executorReported
            ? []
            : [
                {
                  id: "run-control-bridge",
                  method: "CLI",
                  command: "npm run bridge:control -- --session=control_a --executor=audit"
                }
              ]
        }
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/control-sessions/control_a/bridge-manifest") {
      response.end(JSON.stringify({ manifest: manifest() }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/control-sessions/control_a/heartbeat") {
      response.end(JSON.stringify({
        schemaVersion: "steambench.runtime-control-session.v1",
        session: {
          id: "control_a",
          runId: "run_a",
          status: "active",
          heartbeatAt: "2026-06-14T00:00:01.000Z"
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runs/run_a/action-batches") {
      response.end(JSON.stringify({
        normalizedActionLabels: ["button:a:tap"],
        controllerExecutorRequest: {
          schemaVersion: "steambench.controller-executor-request.v1",
          executor: "geforce-now",
          provider: "geforce-now-external",
          sessionId: "control_a",
          runId: "run_a",
          taskId: "task_a",
          plan: {
            schemaVersion: "steambench.controller-execution-plan.v1",
            transport: "virtual-controller",
            target: "xinput-standard",
            timing: "relative-ms",
            neutralOnCompletion: true,
            totalDurationMs: 80,
            maxBatchDurationMs: 4000,
            sourceActionLabels: ["button:a:tap"],
            steps: [
              { index: 1, atMs: 0, kind: "button-down", button: "a", sourceAction: "button:a:tap" },
              { index: 2, atMs: 80, kind: "button-up", button: "a", sourceAction: "button:a:tap" }
            ]
          }
        },
        executionPlan: {
          schemaVersion: "steambench.controller-execution-plan.v1",
          transport: "virtual-controller",
          target: "xinput-standard",
          timing: "relative-ms",
          neutralOnCompletion: true,
          totalDurationMs: 80,
          maxBatchDurationMs: 4000,
          sourceActionLabels: ["button:a:tap"],
          steps: [
            { index: 1, atMs: 0, kind: "button-down", button: "a", sourceAction: "button:a:tap" },
            { index: 2, atMs: 80, kind: "button-up", button: "a", sourceAction: "button:a:tap" }
          ]
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runs/run_a/controller-executor-reports") {
      executorReported = true;
      response.end(JSON.stringify({
        schemaVersion: "steambench.controller-executor-report-submission.v1",
        event: {
          id: "event_executor",
          type: "checkpoint",
          metadata: {
            executorStatus: "validated",
            executor: "audit",
            sideEffects: false
          }
        },
        audit: {
          verdict: "trace-ready",
          totals: {
            executorReports: 1
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

describe("control bridge ops CLI runner", () => {
  it("fetches bridge ops with filters and summarizes recommended actions", async () => {
    const { baseUrl, calls } = await startMockApi();
    const summary = await runControlBridgeOps({
      baseUrl,
      status: "active",
      transport: "virtual-controller",
      limit: 9
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.control-bridge-ops-cli.v1",
      summary: {
        status: "needs-executor-report",
        selectedSessions: 2,
        active: 2,
        readyForBridge: 1,
        needsExecutorReport: 1,
        recommendedActionIds: ["run-control-bridge"]
      }
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/api/control-sessions/ops-report");
    expect(calls[0].searchParams.get("status")).toBe("active");
    expect(calls[0].searchParams.get("transport")).toBe("virtual-controller");
    expect(calls[0].searchParams.get("limit")).toBe("9");
  });

  it("executes the run-control-bridge recommendation through the bridge runner", async () => {
    const { baseUrl, calls } = await startMockApi();
    const summary = await runControlBridgeOps({
      baseUrl,
      status: "active",
      transport: "virtual-controller",
      limit: 9,
      execute: "run-control-bridge",
      executor: "audit",
      observation: "Ops test observed a playable state."
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.control-bridge-ops-cli.v1",
      executedAction: {
        action: {
          id: "run-control-bridge",
          method: "CLI"
        },
        result: {
          schemaVersion: "steambench.control-bridge-runner-result.v1",
          sessionId: "control_a",
          runId: "run_a",
          executor: "audit",
          dryRun: false,
          executorReport: {
            status: "validated",
            sideEffects: false
          },
          executorSubmission: {
            schemaVersion: "steambench.controller-executor-report-submission.v1",
            traceExecutorReports: 1
          }
        }
      },
      summary: {
        status: "idle",
        needsExecutorReport: 0,
        executorValidated: 1,
        recommendedActionIds: [],
        executedActionId: "run-control-bridge",
        executedActionIds: ["run-control-bridge"],
        executedActionCount: 1,
        bridgeSessionId: "control_a",
        bridgeExecutorStatus: "validated",
        bridgeExecutorSideEffects: false,
        bridgeAcceptedActions: 1
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/control-sessions/ops-report",
      "GET /api/control-sessions/control_a/bridge-manifest",
      "POST /api/control-sessions/control_a/heartbeat",
      "POST /api/runs/run_a/action-batches",
      "POST /api/runs/run_a/controller-executor-reports",
      "GET /api/control-sessions/control_a/bridge-manifest",
      "GET /api/control-sessions/ops-report"
    ]);
    expect(calls[3].body).toMatchObject({
      controlSessionId: "control_a",
      observation: "Ops test observed a playable state.",
      actions: [{ type: "button", button: "a", action: "tap", durationMs: 80 }]
    });
  });

  it("advances control bridge executor handoffs and stops after validation", async () => {
    const { baseUrl, calls } = await startMockApi();
    const summary = await runControlBridgeOps({
      baseUrl,
      status: "active",
      transport: "virtual-controller",
      limit: 9,
      execute: "advance-control-bridge-actions",
      maxSteps: 2,
      executor: "audit",
      observation: "Ops advance observed a playable state."
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.control-bridge-ops-cli.v1",
      summary: {
        status: "idle",
        needsExecutorReport: 0,
        executorValidated: 1,
        recommendedActionIds: [],
        executedActionId: "run-control-bridge",
        executedActionIds: ["run-control-bridge"],
        executedActionCount: 1,
        bridgeSessionId: "control_a",
        bridgeExecutorStatus: "validated",
        bridgeExecutorSideEffects: false,
        bridgeAcceptedActions: 1
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/control-sessions/ops-report",
      "GET /api/control-sessions/control_a/bridge-manifest",
      "POST /api/control-sessions/control_a/heartbeat",
      "POST /api/runs/run_a/action-batches",
      "POST /api/runs/run_a/controller-executor-reports",
      "GET /api/control-sessions/control_a/bridge-manifest",
      "GET /api/control-sessions/ops-report"
    ]);
    expect(calls[3].body).toMatchObject({
      controlSessionId: "control_a",
      observation: "Ops advance observed a playable state.",
      actions: [{ type: "button", button: "a", action: "tap", durationMs: 80 }]
    });
  });
});
