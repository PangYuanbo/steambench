import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runScoreboardOps } from "./scoreboard-ops.mjs";

let server;

async function startMockApi() {
  const calls = [];
  let published = false;
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    calls.push({ method: request.method, path: url.pathname, search: url.searchParams.toString(), body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/scoreboard/ops-report") {
      response.end(JSON.stringify({
        report: {
          schemaVersion: "steambench.scoreboard-ops-report.v1",
          generatedAt: "2026-06-14T00:00:00.000Z",
          status: published ? "ready-to-share" : "needs-publication",
          filters: {
            status: url.searchParams.get("status"),
            appid: Number(url.searchParams.get("appid") ?? 620),
            limit: Number(url.searchParams.get("limit") ?? 5)
          },
          totals: {
            runs: 4,
            scoreboardRows: published ? 4 : 3,
            selectedTickets: 1,
            scoreboardReady: published ? 1 : 0,
            proofMissing: 0,
            scoreboardMissing: published ? 0 : 1,
            rowInconsistent: 0,
            orphanRows: 0,
            inProgress: 0,
            failed: 0,
            totalPublishedScore: 0
          },
          tickets: [],
          recommendedActions: published
            ? [
                { id: "share-standings", label: "Share standings", priority: "high", method: "GET", endpoint: "/api/standings", reason: "share" },
                { id: "inspect-standings", label: "Inspect standings", priority: "low", method: "GET", endpoint: "/api/standings", reason: "inspect" }
              ]
            : [
                { id: "republish-scoreboard-row", label: "Republish scoreboard row", priority: "high", method: "POST", endpoint: "/api/runs/run_a/score", reason: "republish" },
                { id: "inspect-standings", label: "Inspect standings", priority: "low", method: "GET", endpoint: "/api/standings", reason: "inspect" }
              ],
          links: {
            standings: "/api/standings",
            leaderboards: "/api/leaderboards",
            seasons: "/api/seasons"
          }
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runs/run_a/score") {
      published = true;
      response.end(JSON.stringify({
        run: {
          id: "run_a",
          status: "scored",
          score: 3200
        },
        row: {
          rank: 1,
          runId: "run_a",
          score: 3200
        },
        task: {
          id: "620:ACH.WAKE_UP",
          appid: 620
        }
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/standings") {
      response.end(JSON.stringify({
        standings: {
          competitors: [
            { competitor: "human:pilot", score: 3200 },
            { competitor: "agent:runner", score: 2900 }
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

describe("scoreboard ops CLI runner", () => {
  it("summarizes scoreboard integrity readiness", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runScoreboardOps({
      baseUrl,
      status: "scoreboard-missing",
      appid: 620,
      limit: 5
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.scoreboard-ops-cli.v1",
      summary: {
        status: "needs-publication",
        runs: 4,
        scoreboardRows: 3,
        selectedTickets: 1,
        scoreboardMissing: 1,
        actions: ["republish-scoreboard-row", "inspect-standings"]
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/scoreboard/ops-report"
    ]);
    expect(calls[0].search).toContain("status=scoreboard-missing");
    expect(calls[0].search).toContain("appid=620");
    expect(calls[0].search).toContain("limit=5");
  });

  it("executes a named scoreboard publication recommendation only when requested", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runScoreboardOps({
      baseUrl,
      status: "scoreboard-missing",
      appid: 620,
      limit: 5,
      execute: "republish-scoreboard-row"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.scoreboard-ops-cli.v1",
      summary: {
        status: "ready-to-share",
        scoreboardRows: 4,
        scoreboardReady: 1,
        scoreboardMissing: 0,
        executedActionId: "republish-scoreboard-row",
        publishedRunId: "run_a",
        publishedRank: 1,
        publishedScore: 3200
      },
      executedAction: {
        action: { id: "republish-scoreboard-row" },
        result: {
          run: { id: "run_a", status: "scored" },
          row: { rank: 1, runId: "run_a", score: 3200 }
        }
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/scoreboard/ops-report",
      "POST /api/runs/run_a/score",
      "GET /api/scoreboard/ops-report"
    ]);
    expect(calls[1].body).toEqual({});
  });

  it("advances through scoreboard publication and standings sharing", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runScoreboardOps({
      baseUrl,
      appid: 620,
      limit: 5,
      execute: "advance-scoreboard-actions",
      maxSteps: 3
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.scoreboard-ops-cli.v1",
      executedAction: {
        action: { id: "republish-scoreboard-row" }
      },
      summary: {
        status: "ready-to-share",
        scoreboardRows: 4,
        scoreboardReady: 1,
        scoreboardMissing: 0,
        executedActionId: "republish-scoreboard-row",
        executedActionIds: [
          "republish-scoreboard-row",
          "share-standings"
        ],
        executedActionCount: 2,
        publishedRunId: "run_a",
        sharedStandings: true,
        standingsCompetitors: 2,
        actions: ["share-standings", "inspect-standings"]
      }
    });
    expect(summary.executedActions.map((entry) => entry.action.id)).toEqual([
      "republish-scoreboard-row",
      "share-standings"
    ]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/scoreboard/ops-report",
      "POST /api/runs/run_a/score",
      "GET /api/scoreboard/ops-report",
      "GET /api/standings",
      "GET /api/scoreboard/ops-report"
    ]);
  });
});
