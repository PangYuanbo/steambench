import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentProbe } from "./agent-runner-probe.mjs";

let server;

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("error", reject);
    request.on("end", () => resolve(body ? JSON.parse(body) : {}));
  });
}

async function startMockApi() {
  const calls = [];
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : undefined;
    calls.push({ method: request.method, path: url.pathname, search: url.searchParams.toString(), body });
    response.setHeader("content-type", "application/json");

    if (request.method === "POST" && url.pathname === "/api/runs") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        run: {
          id: "run_probe",
          taskId: body.taskId,
          competitor: body.competitor,
          competitorType: body.competitorType,
          status: "queued",
          runtimeProvider: body.runtimeProvider,
          artifactName: "output.mp4"
        }
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/runs/run_probe") {
      response.end(JSON.stringify({
        run: {
          id: "run_probe",
          taskId: "1145360:ACH.FIRST_INPUT",
          competitor: "probe-agent",
          competitorType: "agent",
          status: "queued",
          runtimeProvider: "local-sim",
          artifactName: "output.mp4"
        },
        task: {
          id: "1145360:ACH.FIRST_INPUT",
          title: "First Input"
        }
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/runs/run_probe/agent-playbook") {
      response.end(JSON.stringify({
        playbook: {
          schemaVersion: "steambench.agent-playbook.v1",
          runId: "run_probe",
          taskId: "1145360:ACH.FIRST_INPUT",
          control: {
            inputMode: "controller",
            allowedActionTypes: ["button", "stick", "trigger", "wait"],
            actionSpace: {
              schemaVersion: "steambench.runtime-action-space.v1",
              inputMode: "controller",
              transport: "virtual-controller",
              examples: [
                { type: "button", button: "a", action: "tap", durationMs: 80 }
              ]
            }
          },
          eventContract: {
            actionBatchEndpoint: "/api/runs/run_probe/action-batches",
            submissionEndpoint: "/api/runs/run_probe/submission"
          },
          evidence: {
            canonicalArtifact: "output/output.mp4"
          }
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runs/run_probe/control-sessions") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        schemaVersion: "steambench.runtime-control-session.v1",
        session: {
          id: "control_probe",
          status: "active",
          expiresAt: "2026-06-14T00:15:00.000Z",
          actionSpace: {
            transport: "virtual-controller"
          }
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runs/run_probe/action-batches") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        normalizedActions: body.actions,
        normalizedActionLabels: ["tap a"],
        executionPlan: {
          schemaVersion: "steambench.controller-execution-plan.v1",
          totalDurationMs: 80,
          steps: [
            { index: 1, atMs: 0, kind: "button-down", button: "a" },
            { index: 2, atMs: 80, kind: "button-up", button: "a" }
          ]
        }
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/runs/run_probe/agent-trace") {
      response.end(JSON.stringify({
        trace: {
          status: "queued",
          totals: {
            observations: 1,
            actionBatches: 1,
            actions: 1,
            checkpoints: 1,
            proofs: 0,
            artifacts: 0,
            errors: 0
          },
          coverage: {
            hasObservation: true,
            hasAction: true,
            readyForSubmission: true
          },
          nextActions: ["Attach the canonical output/output.mp4 artifact."]
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

describe("agent runner probe CLI", () => {
  it("inspects an existing run without granting control or submitting actions by default", async () => {
    const { baseUrl, calls } = await startMockApi();

    const result = await runAgentProbe({
      baseUrl,
      runId: "run_probe",
      competitor: "probe-agent",
      competitorType: "agent",
      runtimeProvider: "local-sim",
      observation: "Controller prompt visible.",
      checkpoint: "Pressed confirm.",
      controlSession: "auto",
      ttlSeconds: 600,
      confidence: 0.8,
      step: 2
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.agent-runner-probe-result.v1",
      execute: "inspect",
      createdRun: false,
      playbook: {
        inputMode: "controller",
        transport: "virtual-controller"
      },
      trace: {
        coverage: {
          readyForSubmission: true
        }
      }
    });
    expect(result.controlSession).toBeUndefined();
    expect(result.actionBatch).toBeUndefined();
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/runs/run_probe",
      "GET /api/runs/run_probe/agent-playbook",
      "GET /api/runs/run_probe/agent-trace"
    ]);
  });

  it("creates a run, grants a controller lease, and submits playbook example actions", async () => {
    const { baseUrl, calls } = await startMockApi();

    const result = await runAgentProbe({
      baseUrl,
      execute: "advance-probe",
      taskId: "1145360:ACH.FIRST_INPUT",
      competitor: "probe-agent",
      competitorType: "agent",
      runtimeProvider: "local-sim",
      observation: "Controller prompt visible.",
      checkpoint: "Pressed confirm.",
      controlSession: "auto",
      ttlSeconds: 600,
      confidence: 0.8,
      step: 2
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.agent-runner-probe-result.v1",
      createdRun: true,
      playbook: {
        inputMode: "controller",
        transport: "virtual-controller"
      },
      controlSession: {
        id: "control_probe",
        status: "active"
      },
      actionBatch: {
        acceptedActions: ["tap a"],
        actionCount: 1,
        executionPlan: {
          schemaVersion: "steambench.controller-execution-plan.v1",
          stepCount: 2
        }
      },
      trace: {
        coverage: {
          readyForSubmission: true
        }
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/runs",
      "GET /api/runs/run_probe/agent-playbook",
      "POST /api/runs/run_probe/control-sessions",
      "POST /api/runs/run_probe/action-batches",
      "GET /api/runs/run_probe/agent-trace"
    ]);
    expect(calls[2].body).toMatchObject({
      ttlSeconds: 600
    });
    expect(calls[3].body).toMatchObject({
      controlSessionId: "control_probe",
      step: 2,
      source: "agent-runner-probe"
    });
  });
});
