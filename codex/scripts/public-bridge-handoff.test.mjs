import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runPublicBridgeHandoff } from "./public-bridge-handoff.mjs";

let server;

function bridgeHandoff(baseUrl) {
  return {
    schemaVersion: "steambench.public-bridge-handoff.v1",
    generatedAt: "2026-06-15T00:00:00.000Z",
    status: "ready-to-grant",
    runnable: true,
    bridgeable: true,
    canonicalArtifactName: "output.mp4",
    task: {
      id: "1145360:ESCAPE_TARTARUS",
      appid: 1145360,
      gameName: "Hades",
      title: "Escape Tartarus",
      track: "achievement",
      level: 7,
      estimatedRuntimeMinutes: 35
    },
    selectedAgent: {
      id: "agent_1",
      handle: "runner",
      readiness: {
        ready: true,
        missingCapabilities: []
      }
    },
    permissions: {
      schemaVersion: "steambench.runtime-action-space.v1",
      inputMode: "controller",
      transport: "virtual-controller",
      allowedActionTypes: ["button", "stick", "trigger", "wait"],
      controller: {
        layout: "xinput-standard",
        buttons: ["a", "b", "x", "y"],
        sticks: ["left", "right"],
        triggers: ["lt", "rt"]
      },
      constraints: {
        requireCanonicalCapture: true,
        forbiddenActions: ["os-hotkey", "process-spawn", "file-write-outside-output"]
      },
      privilegedSystemInput: false,
      observeBeforeAct: true
    },
    grant: {
      method: "POST",
      endpoint: `${baseUrl}/api/agents/agent_1/run-session`,
      bodyTemplate: {
        taskId: "1145360:ESCAPE_TARTARUS",
        createControlSession: true,
        ttlSeconds: 900
      },
      responseSchemaVersion: "steambench.agent-run-session.v1",
      createsRun: true,
      createsControlSession: true,
      ttlSeconds: 900
    },
    postGrantPackets: {
      accessPacket: {
        schemaVersion: "steambench.runtime-control-access-packet.v1",
        endpoint: `${baseUrl}/api/control-sessions/<control_session_id>/access-packet`
      },
      bridgeManifest: {
        schemaVersion: "steambench.control-bridge-manifest.v1",
        endpoint: `${baseUrl}/api/control-sessions/<control_session_id>/bridge-manifest`
      },
      agentTrace: `${baseUrl}/api/runs/<run_id>/agent-trace`,
      traceAudit: `${baseUrl}/api/runs/<run_id>/agent-trace/audit`
    },
    actionBatch: {
      method: "POST",
      endpoint: "/api/runs/<run_id>/action-batches",
      bodyTemplate: {
        controlSessionId: "<control_session_id>",
        observation: "Describe the visible game state before acting.",
        actions: [{ type: "button", button: "a", action: "tap", durationMs: 80 }],
        confidence: 0.75
      },
      receiptSchemaVersion: "steambench.agent-action-batch-receipt.v1",
      acceptedActionLabels: ["button:a:tap"],
      executionPlanPreview: {
        schemaVersion: "steambench.controller-execution-plan.v1",
        target: "xinput-standard",
        stepCount: 3,
        totalDurationMs: 80
      }
    },
    executor: {
      provider: "geforce-now",
      command: "npm run executor:geforce-now",
      bridgeRunnerCommand: "npm run bridge:control -- --session=<control_session_id>",
      requestSchemaVersion: "steambench.controller-executor-request.v1",
      reportSchemaVersion: "steambench.controller-executor-report.v1",
      reportEndpoint: `${baseUrl}/api/runs/<run_id>/controller-executor-reports`,
      required: true,
      sideEffectsMustBeFalseForAudit: true
    },
    evidence: {
      canonicalArtifact: "output/output.mp4",
      acceptedArtifactName: "output.mp4",
      forbiddenArtifactNames: ["output-test.mp4"],
      submissionEndpoint: `${baseUrl}/api/runs/<run_id>/submission`
    },
    links: {
      publicActionSpace: `${baseUrl}/api/public/tasks/1145360%3AESCAPE_TARTARUS/action-space?agentId=agent_1`,
      runnerContract: `${baseUrl}/api/public/tasks/1145360%3AESCAPE_TARTARUS/runner-contract?agentId=agent_1`,
      controlBridgeOps: `${baseUrl}/api/control-sessions/ops-report?transport=virtual-controller`
    },
    nextActions: [
      "POST the grant body to open a bounded run session.",
      "Read the access packet or bridge manifest returned by the run session."
    ]
  };
}

async function startMockPublicApi() {
  const calls = [];
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    calls.push({ method: request.method, path: url.pathname, search: url.search });
    response.setHeader("content-type", "application/json");
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    if (request.method === "GET" && decodeURIComponent(url.pathname) === "/api/public/tasks/1145360:ESCAPE_TARTARUS/bridge-handoff") {
      response.end(JSON.stringify({ handoff: bridgeHandoff(baseUrl) }));
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
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

describe("public bridge handoff CLI", () => {
  it("validates a public GeForce NOW bridge handoff without granting control", async () => {
    const { baseUrl, calls } = await startMockPublicApi();

    const result = await runPublicBridgeHandoff({
      baseUrl,
      taskId: "1145360:ESCAPE_TARTARUS",
      agentId: "agent_1",
      provider: "external",
      ttlSeconds: 900
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.public-bridge-handoff-cli.v1",
      request: {
        taskId: "1145360:ESCAPE_TARTARUS",
        agentId: "agent_1",
        provider: "external",
        ttlSeconds: 900
      },
      validation: {
        valid: true,
        errors: []
      },
      summary: {
        valid: true,
        status: "ready-to-grant",
        taskId: "1145360:ESCAPE_TARTARUS",
        appid: 1145360,
        agentId: "agent_1",
        bridgeable: true,
        inputMode: "controller",
        transport: "virtual-controller",
        createsControlSession: true,
        ttlSeconds: 900,
        accessPacket: "steambench.runtime-control-access-packet.v1",
        bridgeManifest: "steambench.control-bridge-manifest.v1",
        executorRequest: "steambench.controller-executor-request.v1",
        executorReport: "steambench.controller-executor-report.v1",
        canonicalArtifact: "output/output.mp4"
      }
    });
    expect(result.summary.acceptedActions).toEqual(["button:a:tap"]);
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/public/tasks/1145360%3AESCAPE_TARTARUS/bridge-handoff",
        search: "?agentId=agent_1&provider=external&ttlSeconds=900"
      }
    ]);
  });
});
