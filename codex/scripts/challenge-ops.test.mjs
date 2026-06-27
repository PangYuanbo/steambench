import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runChallengeOps } from "./challenge-ops.mjs";

let server;

async function startMockApi() {
  const calls = [];
  let accepted = false;
  let ran = false;
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    calls.push({ method: request.method, path: url.pathname, search: url.searchParams.toString(), body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/challenges/ops-report") {
      const filteredOpenAfterAcceptance = accepted && url.searchParams.get("status") === "open";
      const filteredAcceptedAfterRun = ran && url.searchParams.get("status") === "accepted";
      response.end(JSON.stringify({
        report: {
          schemaVersion: "steambench.challenge-ops-report.v1",
          status: filteredOpenAfterAcceptance || filteredAcceptedAfterRun ? "idle" : ran ? "ready-to-share" : accepted ? "needs-execution" : "needs-acceptance",
          totals: {
            challenges: 3,
            selectedTickets: filteredOpenAfterAcceptance || filteredAcceptedAfterRun ? 0 : 1,
            open: accepted || ran ? 0 : 1,
            accepted: accepted && !ran && !filteredOpenAfterAcceptance ? 1 : 0,
            running: 0,
            scoreboardReady: ran && !filteredAcceptedAfterRun ? 1 : 0,
            evidenceMissing: 0,
            blocked: 0,
            declined: 0,
            canceled: 0,
            failed: 0,
            scoreboardRows: ran ? 2 : 0
          },
          tickets: [],
          recommendedActions: [
            filteredOpenAfterAcceptance || filteredAcceptedAfterRun
              ? { id: "inspect-challenges", label: "Inspect challenges", priority: "low", method: "GET", endpoint: "/api/challenges", reason: "inspect" }
              : ran
              ? { id: "share-challenge-certificate", label: "Share challenge certificate", priority: "high", method: "GET", endpoint: "/api/challenges/ch_1/result-certificate", reason: "share" }
              : accepted
              ? { id: "run-challenge-local", label: "Run challenge locally", priority: "high", method: "POST", endpoint: "/api/challenges/ch_1/run-local", reason: "run" }
              : { id: "accept-open-challenge", label: "Accept open challenge", priority: "high", method: "POST", endpoint: "/api/challenges/ch_1/accept", reason: "accept" },
            ...(filteredOpenAfterAcceptance || filteredAcceptedAfterRun ? [] : [{ id: "inspect-challenges" }])
          ]
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/challenges/ch_1/run-local") {
      accepted = true;
      ran = true;
      response.end(JSON.stringify({
        challenge: {
          id: "ch_1",
          status: "scored"
        },
        match: {
          id: "match_1",
          status: "scored"
        }
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/challenges/ch_1/result-certificate") {
      response.end(JSON.stringify({
        certificate: {
          kind: "challenge",
          id: "ch_1",
          integrity: {
            readyForPublicShare: true
          }
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/challenges/ch_1/accept") {
      accepted = true;
      response.end(JSON.stringify({
        challenge: {
          id: "ch_1",
          status: "accepted"
        },
        match: {
          id: "match_1",
          status: "scheduled"
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

describe("challenge ops CLI runner", () => {
  it("summarizes challenge queue operations", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runChallengeOps({
      baseUrl,
      status: "open",
      limit: 5
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.challenge-ops-cli.v1",
      status: "open",
      summary: {
        status: "needs-acceptance",
        challenges: 3,
        selectedTickets: 1,
        open: 1,
        actions: ["accept-open-challenge", "inspect-challenges"]
      }
    });
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/challenges/ops-report",
        search: "status=open&limit=5",
        body: undefined
      }
    ]);
  });

  it("executes a named challenge recommendation only when requested", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runChallengeOps({
      baseUrl,
      status: "open",
      limit: 5,
      execute: "accept-open-challenge"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.challenge-ops-cli.v1",
      status: "open",
      executedAction: {
        action: { id: "accept-open-challenge" },
        result: {
          challenge: { id: "ch_1", status: "accepted" },
          match: { id: "match_1", status: "scheduled" }
        }
      },
      summary: {
        status: "idle",
        open: 0,
        accepted: 0,
        executedActionId: "accept-open-challenge",
        challengeId: "ch_1",
        challengeStatus: "accepted",
        matchId: "match_1",
        matchStatus: "scheduled"
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/challenges/ops-report",
      "POST /api/challenges/ch_1/accept",
      "GET /api/challenges/ops-report"
    ]);
    expect(calls[1].body).toEqual({});
  });

  it("advances through acceptance, local run, and certificate sharing", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runChallengeOps({
      baseUrl,
      limit: 5,
      execute: "advance-challenge-actions",
      maxSteps: 4
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.challenge-ops-cli.v1",
      executedAction: {
        action: { id: "accept-open-challenge" }
      },
      summary: {
        status: "ready-to-share",
        scoreboardReady: 1,
        scoreboardRows: 2,
        executedActionId: "accept-open-challenge",
        executedActionIds: [
          "accept-open-challenge",
          "run-challenge-local",
          "share-challenge-certificate"
        ],
        executedActionCount: 3,
        challengeId: "ch_1",
        challengeStatus: "accepted",
        matchId: "match_1",
        matchStatus: "scheduled",
        actions: ["share-challenge-certificate", "inspect-challenges"]
      }
    });
    expect(summary.executedActions.map((entry) => entry.action.id)).toEqual([
      "accept-open-challenge",
      "run-challenge-local",
      "share-challenge-certificate"
    ]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/challenges/ops-report",
      "POST /api/challenges/ch_1/accept",
      "GET /api/challenges/ops-report",
      "POST /api/challenges/ch_1/run-local",
      "GET /api/challenges/ops-report",
      "GET /api/challenges/ch_1/result-certificate",
      "GET /api/challenges/ops-report"
    ]);
  });
});
