import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runPublicActionSpace } from "./public-action-space.mjs";

let server;

function publicActionSpace({ runnable = true, bridgeable = true, schemaVersion = "steambench.public-task-action-space.v1" } = {}) {
  return {
    schemaVersion,
    generatedAt: "2026-06-15T00:00:00.000Z",
    taskStatus: runnable ? "active" : "candidate",
    runnable,
    canonicalArtifactName: "output.mp4",
    task: {
      id: "1145360:ESCAPE_TARTARUS",
      appid: 1145360,
      gameName: "Hades",
      title: "Escaped Tartarus",
      track: "achievement",
      level: 7,
      estimatedRuntimeMinutes: 35
    },
    permissions: {
      schemaVersion: "steambench.runtime-action-space.v1",
      inputMode: "controller",
      transport: "virtual-controller",
      allowedActionTypes: ["button", "stick", "trigger", "wait"],
      controller: {
        layout: "xinput-standard",
        buttons: ["a", "b", "x", "y", "dpad-up"],
        sticks: ["left", "right"],
        triggers: ["lt", "rt"],
        defaultTapMs: 80
      },
      constraints: {
        maxActionsPerBatch: 32,
        maxBatchDurationMs: 4000,
        minObserveBeforeAct: true,
        requireCanonicalCapture: true,
        forbiddenActions: ["os-hotkey", "process-spawn", "file-write-outside-output"]
      },
      privilegedSystemInput: false,
      observeBeforeAct: true
    },
    selectedAgent: {
      id: "agent_1",
      handle: "runtime-agent",
      readiness: {
        ready: true,
        missingCapabilities: []
      }
    },
    bridge: {
      provider: "geforce-now",
      bridgeable,
      required: bridgeable,
      manifestRequired: "steambench.control-bridge-manifest.v1",
      executorRequest: "steambench.controller-executor-request.v1",
      executorReport: "steambench.controller-executor-report.v1"
    },
    exampleActionBatch: {
      schemaVersion: "steambench.public-agent-action-batch-template.v1",
      endpoint: "/api/runs/<run_id>/action-batches",
      requiresControlSessionId: bridgeable,
      requestBodyTemplate: {
        controlSessionId: "<active_control_session_id>",
        observation: "Describe the visible game state before acting.",
        actions: [{ type: "button", button: "a", action: "tap", durationMs: 80 }],
        confidence: 0.75
      },
      acceptedActionLabels: ["button:a:tap"],
      executionPlanPreview: {
        schemaVersion: "steambench.controller-execution-plan.v1",
        target: "xinput-standard",
        timing: "relative-ms",
        neutralOnCompletion: true,
        stepCount: 3,
        totalDurationMs: 80,
        maxBatchDurationMs: 4000
      }
    },
    controlSession: {
      requiredBeforeHostInput: bridgeable,
      ttlSecondsDefault: 900,
      accessPacketSchemaVersion: "steambench.runtime-control-access-packet.v1",
      bridgeManifestSchemaVersion: "steambench.control-bridge-manifest.v1"
    },
    evidence: {
      canonicalArtifact: "output/output.mp4",
      acceptedArtifactName: "output.mp4",
      forbiddenArtifactNames: ["output-test.mp4"]
    },
    entrypoints: {
      actionBatch: "/api/runs/<run_id>/action-batches",
      runSession: "http://127.0.0.1/api/agents/agent_1/run-session"
    }
  };
}

async function startMockPublicActionSpaceApi(options = {}) {
  const calls = [];
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    calls.push({ method: request.method, path: url.pathname, search: url.search });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && decodeURIComponent(url.pathname) === "/api/public/tasks/1145360:ESCAPE_TARTARUS/action-space") {
      response.end(JSON.stringify({ actionSpace: publicActionSpace(options) }));
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

describe("public action-space CLI", () => {
  it("validates a public controller action-space packet without side effects", async () => {
    const { baseUrl, calls } = await startMockPublicActionSpaceApi();

    const result = await runPublicActionSpace({
      baseUrl,
      taskId: "1145360:ESCAPE_TARTARUS",
      agentId: "agent_1"
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.public-action-space-cli.v1",
      request: {
        taskId: "1145360:ESCAPE_TARTARUS",
        agentId: "agent_1"
      },
      validation: {
        valid: true,
        errors: []
      },
      summary: {
        valid: true,
        taskId: "1145360:ESCAPE_TARTARUS",
        appid: 1145360,
        inputMode: "controller",
        transport: "virtual-controller",
        bridgeable: true,
        requiresControlSession: true,
        canonicalArtifact: "output/output.mp4",
        exampleActions: ["button:a:tap"]
      }
    });
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/public/tasks/1145360%3AESCAPE_TARTARUS/action-space",
        search: "?agentId=agent_1"
      }
    ]);
  });

  it("marks invalid action-space packets as failed validation", async () => {
    const { baseUrl } = await startMockPublicActionSpaceApi({
      schemaVersion: "steambench.public-task-runner-contract.v1",
      runnable: false
    });

    const result = await runPublicActionSpace({
      baseUrl,
      taskId: "1145360:ESCAPE_TARTARUS"
    });

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors).toEqual(expect.arrayContaining([
      "invalid_action_space_schema",
      "task_not_runnable"
    ]));
  });
});
