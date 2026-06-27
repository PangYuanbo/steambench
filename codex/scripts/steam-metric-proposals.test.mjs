import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runSteamMetricProposals } from "./steam-metric-proposals.mjs";

let server;

function readBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body ? JSON.parse(body) : {}));
  });
}

async function startMockApi() {
  const calls = [];
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : {};
    calls.push({ method: request.method, path: url.pathname, body });
    response.setHeader("content-type", "application/json");

    if (request.method === "POST" && url.pathname === "/api/steam/apps/620/metric-proposals") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        proposalRun: {
          schemaVersion: "steambench.steam-metric-proposal-run.v1",
          appid: 620,
          proposed: body.proposals.length,
          candidates: body.proposals.length,
          tracks: body.proposals.map((entry) => entry.track),
          reviewRequired: 1
        },
        candidates: body.proposals.map((entry) => ({ id: `620:${entry.key}`, track: entry.track, status: "candidate" })),
        reviews: body.proposals.map((entry) => ({ taskId: `620:${entry.key}`, decision: entry.track === "leaderboard" ? "review-required" : "ranked-ready" }))
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/steam/apps/620/publish-candidates") {
      response.end(JSON.stringify({
        publication: {
          schemaVersion: "steambench.task-publication.v1",
          published: [{ task: { id: "620:STAT.TEST_A" } }],
          blocked: []
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

describe("steam metric proposal CLI runner", () => {
  it("imports a metric proposal manifest and can publish accepted candidates", async () => {
    const { baseUrl, calls } = await startMockApi();
    const dir = await mkdtemp(join(tmpdir(), "steambench-metrics-"));
    const file = join(dir, "metrics.json");
    await writeFile(file, JSON.stringify({
      reviewNotes: "metric fixture",
      proposals: [
        {
          key: "STAT.TEST_A",
          title: "Test Stat A",
          track: "stat",
          level: 4,
          targetValue: "100",
          metricName: "score",
          objective: "Reach 100 score.",
          estimatedRuntimeMinutes: 12,
          scoringRule: "Rank higher score higher."
        },
        {
          key: "LDRB.TEST_B",
          title: "Test Leaderboard B",
          track: "leaderboard",
          level: 6,
          targetValue: "fastest time",
          metricName: "time_seconds",
          objective: "Finish quickly.",
          estimatedRuntimeMinutes: 20,
          scoringRule: "Rank lower time higher."
        }
      ]
    }));

    try {
      const summary = await runSteamMetricProposals({
        baseUrl,
        appid: 620,
        file,
        publish: true,
        reviewApproved: true,
        forceReviewOverride: false,
        publishLimit: 10
      });

      expect(summary).toMatchObject({
        schemaVersion: "steambench.steam-metric-proposals-cli.v1",
        appid: 620,
        publish: true,
        summary: {
          proposed: 2,
          candidates: 2,
          reviewRequired: 1,
          published: 1,
          blocked: 0
        }
      });
      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
        "POST /api/steam/apps/620/metric-proposals",
        "POST /api/steam/apps/620/publish-candidates"
      ]);
      expect(calls[0].body.proposals.map((entry) => entry.key)).toEqual(["STAT.TEST_A", "LDRB.TEST_B"]);
      expect(calls[1].body).toMatchObject({
        limit: 10,
        reviewApproved: true,
        reviewNotes: "metric fixture"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
