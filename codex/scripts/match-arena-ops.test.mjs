import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { runMatchArenaOps } from "./match-arena-ops.mjs";

function reportPayload(ran = false) {
  return {
    report: {
      schemaVersion: "steambench.match-arena-ops-report.v1",
      status: ran ? "ready-to-share" : "needs-execution",
      totals: {
        matches: 1,
        selectedTickets: 1,
        needsStart: ran ? 0 : 1,
        needsHumanProof: 0,
        needsAgentEvidence: 0,
        readyToEvaluate: 0,
        scoreboardReady: ran ? 1 : 0,
        evidenceMissing: 0,
        failed: 0,
        canceled: 0,
        scoreboardRows: ran ? 2 : 0
      },
      tickets: [
        {
          status: ran ? "scoreboard-ready" : "needs-start",
          match: {
            id: "match_1",
            taskId: "620:ACH_WIN",
            humanUserId: "human_1",
            agentId: "agent_1",
            status: ran ? "scored" : "scheduled",
            updatedAt: "2026-06-14T00:00:00.000Z"
          },
          arenaPacket: {
            schemaVersion: "steambench.match-arena-packet.v1",
            matchId: "match_1",
            readyForPublicShare: ran
          },
          links: {
            arenaPacket: "/api/matches/match_1/arena-packet",
            runLocal: "/api/matches/match_1/run-local",
            resultCertificate: "/api/matches/match_1/result-certificate"
          }
        }
      ],
      recommendedActions: ran
        ? [
            {
              id: "share-match-certificate",
              label: "Share match certificate",
              priority: "high",
              method: "GET",
              endpoint: "/api/matches/match_1/result-certificate",
              reason: "ready"
            }
          ]
        : [
            {
              id: "run-match-local",
              label: "Run match locally",
              priority: "high",
              method: "POST",
              endpoint: "/api/matches/match_1/run-local",
              reason: "run"
            }
          ],
      links: {
        matches: "/api/matches",
        matchFeed: "/api/matches/feed",
        standings: "/api/standings"
      }
    }
  };
}

async function withServer(handler, test) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    return await test(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe("match arena ops CLI", () => {
  it("summarizes match arena operations without side effects by default", async () => {
    const calls = [];
    await withServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      calls.push(`${request.method} ${url.pathname}${url.search}`);
      if (request.method === "GET" && url.pathname === "/api/matches/arena-ops-report") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(reportPayload(false)));
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    }, async (baseUrl) => {
      const result = await runMatchArenaOps({ baseUrl, limit: 10, execute: "" });
      expect(result).toMatchObject({
        schemaVersion: "steambench.match-arena-ops-cli.v1",
        summary: {
          status: "needs-execution",
          matches: 1,
          needsStart: 1,
          actions: ["run-match-local"]
        }
      });
      expect(calls).toEqual(["GET /api/matches/arena-ops-report?limit=10"]);
    });
  });

  it("executes a recommended local match run when requested", async () => {
    const calls = [];
    await withServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      calls.push(`${request.method} ${url.pathname}${url.search}`);
      if (request.method === "GET" && url.pathname === "/api/matches/arena-ops-report") {
        const ran = calls.some((call) => call === "POST /api/matches/match_1/run-local");
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(reportPayload(ran)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/matches/match_1/run-local") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          match: {
            id: "match_1",
            status: "scored"
          },
          arenaPacket: {
            schemaVersion: "steambench.match-arena-packet.v1",
            matchId: "match_1",
            readyForPublicShare: true
          }
        }));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/matches/match_1/result-certificate") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          certificate: {
            kind: "match",
            id: "match_1",
            integrity: {
              readyForPublicShare: true
            }
          }
        }));
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    }, async (baseUrl) => {
      const result = await runMatchArenaOps({ baseUrl, limit: 10, execute: "run-match-local" });
      expect(result.summary).toMatchObject({
        status: "ready-to-share",
        executedActionId: "run-match-local",
        matchId: "match_1",
        matchStatus: "scored",
        readyForPublicShare: true,
        scoreboardReady: 1
      });
      expect(calls).toEqual([
        "GET /api/matches/arena-ops-report?limit=10",
        "POST /api/matches/match_1/run-local",
        "GET /api/matches/arena-ops-report?limit=10"
      ]);
    });
  });

  it("advances through local run and certificate sharing without repeating terminal actions", async () => {
    const calls = [];
    await withServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      calls.push(`${request.method} ${url.pathname}${url.search}`);
      if (request.method === "GET" && url.pathname === "/api/matches/arena-ops-report") {
        const ran = calls.some((call) => call === "POST /api/matches/match_1/run-local");
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(reportPayload(ran)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/matches/match_1/run-local") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          match: {
            id: "match_1",
            status: "scored"
          },
          arenaPacket: {
            schemaVersion: "steambench.match-arena-packet.v1",
            matchId: "match_1",
            readyForPublicShare: true
          }
        }));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/matches/match_1/result-certificate") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          certificate: {
            kind: "match",
            id: "match_1",
            integrity: {
              readyForPublicShare: true
            }
          }
        }));
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    }, async (baseUrl) => {
      const result = await runMatchArenaOps({
        baseUrl,
        limit: 10,
        execute: "advance-match-actions",
        maxSteps: 3
      });
      expect(result.summary).toMatchObject({
        status: "ready-to-share",
        executedActionId: "run-match-local",
        executedActionIds: ["run-match-local", "share-match-certificate"],
        executedActionCount: 2,
        matchId: "match_1",
        matchStatus: "scored",
        readyForPublicShare: true,
        scoreboardReady: 1
      });
      expect(result.executedActions.map((entry) => entry.action.id)).toEqual([
        "run-match-local",
        "share-match-certificate"
      ]);
      expect(calls).toEqual([
        "GET /api/matches/arena-ops-report?limit=10",
        "POST /api/matches/match_1/run-local",
        "GET /api/matches/arena-ops-report?limit=10",
        "GET /api/matches/match_1/result-certificate",
        "GET /api/matches/arena-ops-report?limit=10"
      ]);
    });
  });
});
