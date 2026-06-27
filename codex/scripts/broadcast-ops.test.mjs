import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runBroadcastOps } from "./broadcast-ops.mjs";

let server;

async function startMockApi() {
  const calls = [];
  let liveEnded = false;
  let scheduledStarted = false;
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    calls.push({ method: request.method, path: url.pathname, search: url.searchParams.toString(), body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/broadcasts/ops-report") {
      const status = url.searchParams.get("status");
      const liveMode = status === "live";
      const scheduledMode = status === "scheduled";
      const filteredLiveAfterEnd = liveMode && liveEnded;
      const filteredScheduledAfterStart = scheduledMode && scheduledStarted;
      response.end(JSON.stringify({
        report: {
          schemaVersion: "steambench.broadcast-ops-report.v1",
          generatedAt: "2026-06-14T00:00:00.000Z",
          status: filteredLiveAfterEnd || filteredScheduledAfterStart ? "idle" : liveMode || scheduledMode ? "monitoring" : "ready-to-share",
          filters: { status: status ?? "scoreboard-ready", limit: 5 },
          totals: {
            broadcasts: 3,
            selectedBroadcasts: filteredLiveAfterEnd || filteredScheduledAfterStart ? 0 : 1,
            live: liveMode && !filteredLiveAfterEnd ? 1 : 0,
            scheduled: scheduledMode && !filteredScheduledAfterStart ? 1 : 0,
            ended: liveMode ? (liveEnded ? 1 : 0) : 1,
            failed: 0,
            scoreboardReady: liveMode ? 0 : 1,
            proofReady: liveMode ? 0 : 1,
            proofMissing: 0,
            incomplete: 0,
            viewers: liveMode && !filteredLiveAfterEnd ? 4 : 0
          },
          tickets: [],
          recommendedActions: filteredLiveAfterEnd || filteredScheduledAfterStart
            ? [{ id: "inspect-broadcast-center", label: "Inspect broadcast center", priority: "low", method: "GET", endpoint: "/api/broadcasts/center", reason: "inspect" }]
            : scheduledMode
              ? [
                  { id: "start-scheduled-broadcast", label: "Start scheduled broadcast", priority: "high", method: "POST", endpoint: "/api/livestreams/scheduled_a/status", body: { status: "live", currentScene: "Runtime live", viewerCount: 1 }, reason: "scheduled" },
                  { id: "inspect-broadcast-center", label: "Inspect broadcast center", priority: "low", method: "GET", endpoint: "/api/broadcasts/center", reason: "inspect" }
                ]
            : liveMode
              ? [
                  { id: "end-live-broadcast", label: "End live broadcast", priority: "medium", method: "POST", endpoint: "/api/livestreams/live_a/status", body: { status: "ended", currentScene: "Run complete" }, reason: "live" },
                  { id: "inspect-broadcast-center", label: "Inspect broadcast center", priority: "low", method: "GET", endpoint: "/api/broadcasts/center", reason: "inspect" }
                ]
              : [
                  { id: "share-broadcast-certificate", label: "Share broadcast certificate", priority: "high", method: "GET", endpoint: "/api/broadcasts/stream_a/result-certificate", reason: "ready" },
                  { id: "inspect-broadcast-center", label: "Inspect broadcast center", priority: "low", method: "GET", endpoint: "/api/broadcasts/center", reason: "inspect" }
                ],
          links: {
            broadcasts: "/api/broadcasts",
            center: "/api/broadcasts/center"
          }
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/livestreams/scheduled_a/status") {
      scheduledStarted = true;
      response.end(JSON.stringify({
        stream: {
          id: "scheduled_a",
          status: "live",
          currentScene: "Runtime live"
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/livestreams/live_a/status") {
      liveEnded = true;
      response.end(JSON.stringify({
        stream: {
          id: "live_a",
          status: "ended",
          currentScene: "Run complete"
        }
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/broadcasts/stream_a/result-certificate") {
      response.end(JSON.stringify({
        certificate: {
          schemaVersion: "steambench.result-certificate.v1",
          id: "stream_a",
          kind: "broadcast",
          integrity: {
            readyForPublicShare: true
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

describe("broadcast ops CLI runner", () => {
  it("summarizes broadcast replay readiness", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runBroadcastOps({
      baseUrl,
      status: "scoreboard-ready",
      limit: 5
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.broadcast-ops-cli.v1",
      summary: {
        status: "ready-to-share",
        broadcasts: 3,
        selectedBroadcasts: 1,
        scoreboardReady: 1,
        proofMissing: 0,
        actions: ["share-broadcast-certificate", "inspect-broadcast-center"]
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/broadcasts/ops-report"
    ]);
    expect(calls[0].search).toContain("status=scoreboard-ready");
    expect(calls[0].search).toContain("limit=5");
  });

  it("executes a named broadcast certificate recommendation", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runBroadcastOps({
      baseUrl,
      status: "scoreboard-ready",
      limit: 5,
      execute: "share-broadcast-certificate"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.broadcast-ops-cli.v1",
      executedAction: {
        action: { id: "share-broadcast-certificate" },
        result: {
          certificate: {
            kind: "broadcast",
            id: "stream_a",
            integrity: { readyForPublicShare: true }
          }
        }
      },
      summary: {
        status: "ready-to-share",
        executedActionId: "share-broadcast-certificate",
        streamId: "stream_a",
        certificateKind: "broadcast",
        readyForPublicShare: true
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/broadcasts/ops-report",
      "GET /api/broadcasts/stream_a/result-certificate",
      "GET /api/broadcasts/ops-report"
    ]);
  });

  it("executes a named live broadcast end recommendation", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runBroadcastOps({
      baseUrl,
      status: "live",
      limit: 5,
      execute: "end-live-broadcast"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.broadcast-ops-cli.v1",
      executedAction: {
        action: { id: "end-live-broadcast" },
        result: {
          stream: {
            id: "live_a",
            status: "ended"
          }
        }
      },
      summary: {
        status: "idle",
        selectedBroadcasts: 0,
        live: 0,
        executedActionId: "end-live-broadcast",
        streamId: "live_a",
        streamStatus: "ended"
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/broadcasts/ops-report",
      "POST /api/livestreams/live_a/status",
      "GET /api/broadcasts/ops-report"
    ]);
    expect(calls[1].body).toEqual({
      status: "ended",
      currentScene: "Run complete"
    });
  });

  it("executes a named scheduled broadcast start recommendation", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runBroadcastOps({
      baseUrl,
      status: "scheduled",
      limit: 5,
      execute: "start-scheduled-broadcast"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.broadcast-ops-cli.v1",
      executedAction: {
        action: { id: "start-scheduled-broadcast" },
        result: {
          stream: {
            id: "scheduled_a",
            status: "live"
          }
        }
      },
      summary: {
        status: "idle",
        selectedBroadcasts: 0,
        scheduled: 0,
        executedActionId: "start-scheduled-broadcast",
        streamId: "scheduled_a",
        streamStatus: "live"
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/broadcasts/ops-report",
      "POST /api/livestreams/scheduled_a/status",
      "GET /api/broadcasts/ops-report"
    ]);
    expect(calls[1].body).toEqual({
      status: "live",
      currentScene: "Runtime live",
      viewerCount: 1
    });
  });

  it("advances a scheduled broadcast into live monitoring without running inspect actions", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runBroadcastOps({
      baseUrl,
      status: "scheduled",
      limit: 5,
      execute: "advance-broadcast-actions",
      maxSteps: 3
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.broadcast-ops-cli.v1",
      executedAction: {
        action: { id: "start-scheduled-broadcast" },
        result: {
          stream: {
            id: "scheduled_a",
            status: "live"
          }
        }
      },
      summary: {
        status: "idle",
        selectedBroadcasts: 0,
        scheduled: 0,
        actions: ["inspect-broadcast-center"],
        executedActionId: "start-scheduled-broadcast",
        executedActionIds: ["start-scheduled-broadcast"],
        executedActionCount: 1,
        streamId: "scheduled_a",
        streamStatus: "live"
      }
    });
    expect(summary.executedActions.map((entry) => entry.action.id)).toEqual([
      "start-scheduled-broadcast"
    ]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/broadcasts/ops-report",
      "POST /api/livestreams/scheduled_a/status",
      "GET /api/broadcasts/ops-report"
    ]);
  });

  it("advances a public-ready broadcast certificate", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runBroadcastOps({
      baseUrl,
      status: "scoreboard-ready",
      limit: 5,
      execute: "advance-broadcast-actions",
      maxSteps: 2
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.broadcast-ops-cli.v1",
      executedAction: {
        action: { id: "share-broadcast-certificate" }
      },
      summary: {
        status: "ready-to-share",
        scoreboardReady: 1,
        executedActionId: "share-broadcast-certificate",
        executedActionIds: ["share-broadcast-certificate"],
        executedActionCount: 1,
        streamId: "stream_a",
        certificateKind: "broadcast",
        readyForPublicShare: true
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/broadcasts/ops-report",
      "GET /api/broadcasts/stream_a/result-certificate",
      "GET /api/broadcasts/ops-report"
    ]);
  });
});
