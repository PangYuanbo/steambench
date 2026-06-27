import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runPublicRunner } from "./public-runner.mjs";

let server;

const plan = {
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
    { index: 2, atMs: 0, kind: "wait", durationMs: 80, sourceAction: "button:a:tap" },
    { index: 3, atMs: 80, kind: "button-up", button: "a", sourceAction: "button:a:tap" }
  ]
};

async function readBody(request) {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function runnerContract(baseUrl) {
  return {
    schemaVersion: "steambench.public-task-runner-contract.v1",
    runnable: true,
    canonicalArtifactName: "output.mp4",
    task: {
      id: "1145360:ESCAPE_TARTARUS",
      appid: 1145360,
      gameName: "Hades",
      title: "Escaped Tartarus"
    },
    proof: {
      canonicalArtifactPath: "output/output.mp4",
      artifactName: "output.mp4"
    },
    agentActionContract: {
      schemaVersion: "steambench.agent-action-contract.v1",
      observeBeforeAct: true,
      actionBatch: {
        method: "POST",
        endpoint: "/api/runs/<run_id>/action-batches",
        requestBodyTemplate: {
          controlSessionId: "<active_control_session_id>",
          observation: "Describe the visible game state before acting.",
          actions: [{ type: "button", button: "a", action: "tap", durationMs: 80 }],
          confidence: 0.75,
          idempotencyKey: "agent:<run_id>:step-1"
        },
        receiptSchemaVersion: "steambench.agent-action-batch-receipt.v1",
        acceptedActionLabels: ["button:a:tap"]
      },
      permissions: {
        inputMode: "controller",
        transport: "virtual-controller",
        allowedActionTypes: ["button", "stick", "trigger", "wait"],
        privilegedSystemInput: false,
        constraints: {
          requireCanonicalCapture: true,
          maxActionsPerBatch: 32,
          maxBatchDurationMs: 4000
        }
      },
      bridge: {
        required: true,
        provider: "geforce-now",
        executionPlanPreview: {
          schemaVersion: "steambench.controller-execution-plan.v1",
          target: "xinput-standard",
          stepCount: 3,
          totalDurationMs: 80
        },
        executorRequest: {
          schemaVersion: "steambench.controller-executor-request.v1",
          reportSchemaVersion: "steambench.controller-executor-report.v1",
          command: "npm run executor:geforce-now"
        }
      },
      evidence: {
        canonicalArtifact: "output/output.mp4",
        acceptedArtifactName: "output.mp4",
        forbiddenArtifactNames: ["output-test.mp4"]
      }
    },
    entrypoints: {
      agent: {
        runSession: `${baseUrl}/api/agents/agent_1/run-session`,
        requiredBody: {
          taskId: "1145360:ESCAPE_TARTARUS",
          createControlSession: true,
          ttlSeconds: 900
        }
      }
    }
  };
}

async function startMockPublicRunnerApi() {
  const calls = [];
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : undefined;
    calls.push({ method: request.method, path: url.pathname, search: url.search, body });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && decodeURIComponent(url.pathname) === "/api/public/tasks/1145360:ESCAPE_TARTARUS/runner-contract") {
      response.end(JSON.stringify({ contract: runnerContract(baseUrl) }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/agents/agent_1/run-session") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        schemaVersion: "steambench.agent-run-session.v1",
        run: {
          id: "run_1",
          taskId: "1145360:ESCAPE_TARTARUS"
        },
        handoff: {
          status: "ready-for-actions"
        },
        controlSession: {
          session: {
            id: "control_1",
            status: "active"
          }
        },
        accessPacket: {
          audit: {
            readyForBridge: true
          },
          endpoints: {
            actionBatch: "/api/runs/run_1/action-batches",
            executorReport: "/api/runs/run_1/controller-executor-reports"
          }
        },
        links: {
          actionBatch: "/api/runs/run_1/action-batches",
          executorReport: "/api/runs/run_1/controller-executor-reports"
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runs/run_1/action-batches") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        receipt: {
          schemaVersion: "steambench.agent-action-batch-receipt.v1",
          acceptedActions: 1,
          rejectedActions: 0
        },
        normalizedActionLabels: ["button:a:tap"],
        executionPlan: plan,
        controllerExecutorRequest: {
          schemaVersion: "steambench.controller-executor-request.v1",
          executor: "geforce-now",
          provider: "geforce-now-external",
          sessionId: "control_1",
          runId: "run_1",
          taskId: "1145360:ESCAPE_TARTARUS",
          plan
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runs/run_1/controller-executor-reports") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        schemaVersion: "steambench.controller-executor-report-submission.v1",
        audit: {
          verdict: "ready-for-submission",
          totals: {
            executorReports: 1
          }
        },
        event: {
          id: "evt_executor",
          metadata: {
            executorReport: "steambench.controller-executor-report.v1",
            executorStatus: body.report.status,
            sideEffects: body.report.sideEffects
          }
        }
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/runs/run_1/agent-trace") {
      response.end(JSON.stringify({
        trace: {
          status: "ready-for-submission",
          totals: {
            observations: 1,
            actionBatches: 1,
            actions: 1,
            executorReports: 1
          },
          coverage: {
            readyForSubmission: true
          },
          nextActions: ["submit output/output.mp4"]
        }
      }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
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

describe("public runner contract CLI", () => {
  it("inspects and validates a public runner contract without creating a run", async () => {
    const { baseUrl, calls } = await startMockPublicRunnerApi();

    const result = await runPublicRunner({
      baseUrl,
      taskId: "1145360:ESCAPE_TARTARUS",
      agentId: "agent_1",
      execute: "inspect",
      ttlSeconds: 900,
      observation: "inspect",
      confidence: 0.75,
      checkpoint: "inspect",
      executor: "audit"
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.public-runner-cli.v1",
      execute: "inspect",
      contract: {
        taskId: "1145360:ESCAPE_TARTARUS",
        inputMode: "controller",
        bridgeRequired: true,
        executorRequest: "steambench.controller-executor-request.v1",
        canonicalArtifact: "output/output.mp4"
      },
      validation: {
        valid: true,
        errors: []
      },
      summary: {
        valid: true,
        executed: "inspect",
        acceptedActions: 0,
        executorReported: false
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/public/tasks/1145360%3AESCAPE_TARTARUS/runner-contract"
    ]);
  });

  it("advances a public runner contract through run-session, example actions, and audit executor report", async () => {
    const { baseUrl, calls } = await startMockPublicRunnerApi();

    const result = await runPublicRunner({
      baseUrl,
      taskId: "1145360:ESCAPE_TARTARUS",
      agentId: "agent_1",
      execute: "advance-public-runner",
      ttlSeconds: 1200,
      observation: "Controller bridge ready.",
      confidence: 0.8,
      checkpoint: "Example action submitted.",
      idempotencyKey: "public-runner-test",
      executor: "audit"
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.public-runner-cli.v1",
      validation: {
        valid: true
      },
      session: {
        runId: "run_1",
        taskId: "1145360:ESCAPE_TARTARUS",
        handoffStatus: "ready-for-actions",
        controlSessionId: "control_1",
        bridgeReady: true,
        actionBatchEndpoint: "/api/runs/run_1/action-batches",
        executorReportEndpoint: "/api/runs/run_1/controller-executor-reports"
      },
      actionBatch: {
        receipt: "steambench.agent-action-batch-receipt.v1",
        acceptedActions: 1,
        rejectedActions: 0,
        labels: ["button:a:tap"],
        executionPlan: {
          schemaVersion: "steambench.controller-execution-plan.v1",
          stepCount: 3,
          totalDurationMs: 80
        },
        executorRequest: {
          schemaVersion: "steambench.controller-executor-request.v1",
          executor: "geforce-now",
          provider: "geforce-now-external",
          stepCount: 3
        }
      },
      executor: {
        reportStatus: "validated",
        executor: "audit",
        provider: "public-runner-audit",
        plannedStepCount: 3,
        executedStepCount: 0,
        sideEffects: false,
        submissionSchema: "steambench.controller-executor-report-submission.v1",
        traceExecutorReports: 1,
        traceVerdict: "ready-for-submission"
      },
      trace: {
        status: "ready-for-submission",
        readyForSubmission: true
      },
      summary: {
        valid: true,
        executed: "advance-public-runner",
        runId: "run_1",
        controlSessionId: "control_1",
        acceptedActions: 1,
        executorReported: true,
        bridgeReady: true,
        readyForSubmission: true
      }
    });

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/public/tasks/1145360%3AESCAPE_TARTARUS/runner-contract",
      "POST /api/agents/agent_1/run-session",
      "POST /api/runs/run_1/action-batches",
      "POST /api/runs/run_1/controller-executor-reports",
      "GET /api/runs/run_1/agent-trace"
    ]);
    expect(calls[1].body).toMatchObject({
      taskId: "1145360:ESCAPE_TARTARUS",
      createControlSession: true,
      ttlSeconds: 1200,
      idempotencyKey: "public-runner-test:run-session"
    });
    expect(calls[2].body).toMatchObject({
      controlSessionId: "control_1",
      observation: "Controller bridge ready.",
      checkpoint: "Example action submitted.",
      source: "public-runner-contract",
      idempotencyKey: "public-runner-test:action-batch"
    });
    expect(calls[3].body).toMatchObject({
      controlSessionId: "control_1",
      idempotencyKey: "public-runner-test:executor-report",
      report: {
        schemaVersion: "steambench.controller-executor-report.v1",
        status: "validated",
        sideEffects: false,
        plannedStepCount: 3
      }
    });
  });
});
