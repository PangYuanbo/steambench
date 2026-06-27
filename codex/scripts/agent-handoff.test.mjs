import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentHandoff } from "./agent-handoff.mjs";

let server;

async function startMockApi() {
  const calls = [];
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    calls.push({ method: request.method, path: url.pathname, search: url.searchParams.toString() });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/runs/run_handoff/agent-handoff") {
      response.end(JSON.stringify({
        handoff: {
          schemaVersion: "steambench.agent-runtime-handoff.v1",
          status: "needs-control-session",
          run: {
            id: "run_handoff",
            status: "queued"
          },
          control: {
            inputMode: "controller",
            transport: "virtual-controller",
            requiresControlSession: true,
            activeSession: {
              id: "control_handoff",
              accessPacket: "/api/control-sessions/control_handoff/access-packet",
              bridgeManifest: "/api/control-sessions/control_handoff/bridge-manifest",
              executorReport: "/api/runs/run_handoff/controller-executor-reports"
            }
          },
          endpoints: {
            activeAccessPacket: "/api/control-sessions/control_handoff/access-packet",
            activeBridgeManifest: "/api/control-sessions/control_handoff/bridge-manifest",
            activeExecutorReport: "/api/runs/run_handoff/controller-executor-reports"
          },
          broadcast: {
            activeStream: {
              id: "stream_handoff",
              status: "live",
              detail: "/api/broadcasts/stream_handoff",
              evidenceBundle: "/api/broadcasts/stream_handoff/evidence-bundle",
              resultCertificate: "/api/broadcasts/stream_handoff/result-certificate",
              statusEndpoint: "/api/livestreams/stream_handoff/status"
            }
          },
          trace: {
            totals: {
              observations: 0,
              actionBatches: 0,
              actions: 0
            },
            coverage: {
              readyForSubmission: false
            }
          },
          blockers: ["control_session_required"],
          recommendedActions: [
            { id: "create-control-session" },
            { id: "inspect-broadcast" },
            { id: "submit-action-batch" },
            { id: "inspect-trace" }
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

describe("agent handoff CLI", () => {
  it("summarizes a run handoff packet", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runAgentHandoff({
      baseUrl,
      runId: "run_handoff",
      agentId: "agent_a"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.agent-handoff-cli.v1",
      summary: {
        status: "needs-control-session",
        runStatus: "queued",
        inputMode: "controller",
        transport: "virtual-controller",
        requiresControlSession: true,
        activeControlSessionId: "control_handoff",
        activeAccessPacketEndpoint: "/api/control-sessions/control_handoff/access-packet",
        activeBridgeManifestEndpoint: "/api/control-sessions/control_handoff/bridge-manifest",
        activeExecutorReportEndpoint: "/api/runs/run_handoff/controller-executor-reports",
        activeStreamId: "stream_handoff",
        activeStreamStatus: "live",
        activeBroadcastEndpoint: "/api/broadcasts/stream_handoff",
        activeBroadcastEvidenceBundleEndpoint: "/api/broadcasts/stream_handoff/evidence-bundle",
        activeBroadcastResultCertificateEndpoint: "/api/broadcasts/stream_handoff/result-certificate",
        livestreamStatusEndpoint: "/api/livestreams/stream_handoff/status",
        blockers: ["control_session_required"],
        actionsRecommended: ["create-control-session", "inspect-broadcast", "submit-action-batch", "inspect-trace"]
      }
    });
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/runs/run_handoff/agent-handoff",
        search: "agentId=agent_a"
      }
    ]);
  });
});
