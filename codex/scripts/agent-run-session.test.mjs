import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentRunSession } from "./agent-run-session.mjs";

let server;

async function startMockApi() {
  const calls = [];
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    calls.push({ method: request.method, path: url.pathname, body });
    response.setHeader("content-type", "application/json");

    if (request.method === "POST" && url.pathname === "/api/agents/agent_1/run-session") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        schemaVersion: "steambench.agent-run-session.v1",
        agent: {
          id: "agent_1",
          handle: "controller-agent"
        },
        run: {
          id: "run_1",
          taskId: body.taskId,
          status: "queued"
        },
        handoff: {
          status: "ready",
          control: {
            inputMode: "controller",
            transport: "virtual-controller"
          },
          recommendedActions: [
            { id: "claim-run" },
            { id: "open-bridge-manifest" }
          ]
        },
        controlSession: {
          session: {
            id: "control_1"
          }
        },
        ...(body.createLivestream
          ? {
              livestream: {
                id: "stream_1",
                runId: "run_1",
                status: body.livestreamStatus ?? "scheduled",
                provider: "hls",
                title: body.livestreamTitle ?? "Agent stream",
                ingestUrl: "rtmp://localhost/steambench/run_1",
                playbackUrl: "/streams/run_1.m3u8",
                thumbnailUrl: "/streams/run_1.jpg",
                viewerCount: body.viewerCount ?? 0,
                currentScene: body.currentScene ?? "Runtime session ready for bridge",
                createdAt: "2026-06-15T00:00:00.000Z"
              }
            }
          : {}),
        accessPacket: {
          schemaVersion: "steambench.runtime-control-access-packet.v1",
          lease: {
            id: "control_1",
            runId: "run_1",
            taskId: body.taskId,
            agentId: "agent_1",
            ttlRemainingSeconds: 899
          },
          permissions: {
            inputMode: "controller",
            transport: "virtual-controller",
            allowedActionTypes: ["button", "stick", "trigger", "wait"],
            controller: {
              layout: "xinput-standard",
              buttons: ["a", "b", "x", "y"],
              sticks: ["left", "right"],
              triggers: ["lt", "rt"],
              defaultTapMs: 80
            },
            constraints: {
              maxActionsPerBatch: 32,
              maxBatchDurationMs: 4000,
              minObserveBeforeAct: true,
              requireCanonicalCapture: true,
              forbiddenActions: ["os-hotkey", "process-spawn"]
            },
            forbiddenActions: ["os-hotkey", "process-spawn"]
          },
          endpoints: {
            actionBatch: "/api/runs/run_1/action-batches",
            bridgeManifest: "/api/control-sessions/control_1/bridge-manifest",
            heartbeat: "/api/control-sessions/control_1/heartbeat",
            trace: "/api/runs/run_1/agent-trace",
            traceAudit: "/api/runs/run_1/agent-trace/audit",
            submission: "/api/runs/run_1/submission",
            executorReport: "/api/runs/run_1/controller-executor-reports"
          },
          bridge: {
            provider: "geforce-now",
            ready: true,
            manifestSchemaVersion: "steambench.control-bridge-manifest.v1",
            executor: {
              command: "npm run executor:geforce-now",
              requestSchemaVersion: "steambench.controller-executor-request.v1",
              reportSchemaVersion: "steambench.controller-executor-report.v1",
              executionPlanSchemaVersion: "steambench.controller-execution-plan.v1",
              target: "xinput-standard",
              timing: "relative-ms",
              neutralOnCompletion: true
            },
            handoff: {
              readManifest: "/api/control-sessions/control_1/bridge-manifest",
              submitActions: "/api/runs/run_1/action-batches",
              heartbeat: "/api/control-sessions/control_1/heartbeat",
              reportBack: "/api/runs/run_1/controller-executor-reports",
              reportBackMode: "typed-controller-executor-report-submission"
            }
          },
          audit: {
            readyForActions: true,
            readyForBridge: true,
            expectedExecutorReport: "steambench.controller-executor-report.v1",
            canonicalArtifact: "output/output.mp4",
            acceptedArtifactName: "output.mp4"
          }
        },
        links: {
          executorReport: "/api/runs/run_1/controller-executor-reports",
          ...(body.createLivestream
            ? {
                livestreamStatus: "/api/livestreams/stream_1/status",
                broadcast: "/api/broadcasts/stream_1",
                broadcastEvidenceBundle: "/api/broadcasts/stream_1/evidence-bundle",
                broadcastResultCertificate: "/api/broadcasts/stream_1/result-certificate"
              }
            : {})
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

describe("agent run-session CLI", () => {
  it("returns a compact controller grant for bridge executors", async () => {
    const { baseUrl, calls } = await startMockApi();

    const result = await runAgentRunSession({
      baseUrl,
      agentId: "agent_1",
      taskId: "1145360:ESCAPE_CLEAR",
      ttlSeconds: 900,
      createControlSession: true,
      idempotencyKey: "test-run-session"
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.agent-run-session-cli.v1",
      controlGrant: {
        schemaVersion: "steambench.agent-control-grant.v1",
        runId: "run_1",
        taskId: "1145360:ESCAPE_CLEAR",
        agentId: "agent_1",
        controlSessionId: "control_1",
        inputMode: "controller",
        transport: "virtual-controller",
        readyForActions: true,
        readyForBridge: true,
        allowedActionTypes: ["button", "stick", "trigger", "wait"],
        endpoints: {
          actionBatch: "/api/runs/run_1/action-batches",
          bridgeManifest: "/api/control-sessions/control_1/bridge-manifest",
          executorReport: "/api/runs/run_1/controller-executor-reports"
        },
        bridge: {
          executor: {
            command: "npm run executor:geforce-now",
            requestSchemaVersion: "steambench.controller-executor-request.v1",
            reportSchemaVersion: "steambench.controller-executor-report.v1"
          }
        },
        expectedExecutorReport: "steambench.controller-executor-report.v1",
        canonicalArtifact: "output/output.mp4",
        acceptedArtifactName: "output.mp4"
      },
      summary: {
        runId: "run_1",
        controlSessionId: "control_1",
        accessPacketReady: true,
        bridgeReady: true,
        bridgeExecutorCommand: "npm run executor:geforce-now",
        bridgeExecutorRequest: "steambench.controller-executor-request.v1",
        bridgeExecutorReport: "steambench.controller-executor-report.v1",
        allowedActionTypes: ["button", "stick", "trigger", "wait"],
        actionBatchEndpoint: "/api/runs/run_1/action-batches",
        bridgeManifestEndpoint: "/api/control-sessions/control_1/bridge-manifest",
        executorReportEndpoint: "/api/runs/run_1/controller-executor-reports",
        forbiddenActions: ["os-hotkey", "process-spawn"]
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/agents/agent_1/run-session"
    ]);
    expect(calls[0].body).toEqual({
      taskId: "1145360:ESCAPE_CLEAR",
      ttlSeconds: 900,
      createControlSession: true,
      idempotencyKey: "test-run-session"
    });
  });

  it("can request a livestream and summarizes broadcast handoff links", async () => {
    const { baseUrl, calls } = await startMockApi();

    const result = await runAgentRunSession({
      baseUrl,
      agentId: "agent_1",
      taskId: "1145360:ESCAPE_CLEAR",
      ttlSeconds: 120,
      createControlSession: true,
      createLivestream: true,
      livestreamStatus: "live",
      livestreamTitle: "Bridge live proof",
      currentScene: "GeForce NOW bridge ready",
      viewerCount: 3
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.agent-run-session-cli.v1",
      summary: {
        runId: "run_1",
        controlSessionId: "control_1",
        livestreamId: "stream_1",
        livestreamStatus: "live",
        livestreamPlaybackUrl: "/streams/run_1.m3u8",
        livestreamStatusEndpoint: "/api/livestreams/stream_1/status",
        broadcastEndpoint: "/api/broadcasts/stream_1",
        broadcastEvidenceBundleEndpoint: "/api/broadcasts/stream_1/evidence-bundle",
        broadcastResultCertificateEndpoint: "/api/broadcasts/stream_1/result-certificate"
      }
    });
    expect(calls[0].body).toMatchObject({
      taskId: "1145360:ESCAPE_CLEAR",
      ttlSeconds: 120,
      createControlSession: true,
      createLivestream: true,
      livestreamStatus: "live",
      livestreamTitle: "Bridge live proof",
      currentScene: "GeForce NOW bridge ready",
      viewerCount: 3
    });
  });
});
