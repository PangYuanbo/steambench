import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runHumanProofOps } from "./human-proof-ops.mjs";

let server;

function reportPayload({ submitted = false, consented = false, linked = false } = {}) {
  const recommendedActions = [];
  if (!submitted) {
    recommendedActions.push({
      id: "submit-human-proof",
      label: "Submit next human proof",
      priority: "high",
      method: "POST",
      endpoint: "/api/users/u1/steam-proof-submissions",
      body: { taskId: "620:ACH_A" },
      reason: "ready"
    });
  }
  if (!consented) {
    recommendedActions.push({
      id: "grant-proof-consent",
      label: "Grant Steam proof consent",
      priority: recommendedActions.length === 0 ? "high" : "medium",
      method: "POST",
      endpoint: "/api/users/u2/steam-proof-consent",
      reason: "consent"
    });
  }
  if (!linked) {
    recommendedActions.push({
      id: "link-steam",
      label: "Link Steam account",
      priority: recommendedActions.length === 0 ? "high" : "medium",
      method: "POST",
      endpoint: "/api/users/u3/steam",
      reason: "link"
    });
  }
  recommendedActions.push({
    id: "inspect-human-proof-plan",
    label: "Inspect human proof plan",
    priority: "low",
    method: "GET",
    endpoint: "/api/users/u1/steam-proof-plan",
    reason: "inspect"
  });
  return {
    report: {
      schemaVersion: "steambench.human-proof-ops-report.v1",
      generatedAt: "2026-06-14T00:00:00.000Z",
      status: !submitted ? "ready-to-submit" : (!consented || !linked ? "needs-human-onboarding" : "scoreboard-covered"),
      filters: { appid: 620, limit: 4, userLimit: 20 },
      totals: {
        humans: 3,
        selectedHumans: 3,
        linked: linked ? 3 : 2,
        consented: consented ? 2 : 1,
        readyTickets: submitted ? 0 : 1,
        consentRequired: consented ? 0 : 1,
        steamNotLinked: linked ? 0 : 1,
        alreadyScored: submitted && consented && linked ? 1 : 0,
        noHumanTasks: 0,
        readyTasks: submitted ? 0 : 4,
        alreadyScoredTasks: submitted && consented && linked ? 1 : 0
      },
      tickets: [],
      recommendedActions,
      links: {
        users: "/api/users",
        standings: "/api/standings",
        proofReview: "/api/proofs/review"
      }
    }
  };
}

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
    calls.push({ method: request.method, path: url.pathname, search: url.searchParams.toString(), body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/human-proof/ops-report") {
      response.end(JSON.stringify(reportPayload({
        submitted: calls.some((call) => call.path === "/api/users/u1/steam-proof-submissions"),
        consented: calls.some((call) => call.path === "/api/users/u2/steam-proof-consent"),
        linked: calls.some((call) => call.path === "/api/users/u3/steam")
      })));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/users/u1/steam-proof-submissions") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        submission: {
          schemaVersion: "steambench.human-steam-proof-submission.v1",
          userId: "u1",
          taskId: body.taskId,
          runId: "run_human",
          scoreboardReady: true
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/users/u2/steam-proof-consent") {
      response.end(JSON.stringify({
        user: {
          id: "u2",
          proofConsent: body.consented
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/users/u3/steam") {
      response.end(JSON.stringify({
        user: {
          id: "u3",
          steamid: body.steamid,
          proofConsent: body.proofConsent
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

describe("human proof ops CLI runner", () => {
  it("summarizes human Steam proof readiness", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runHumanProofOps({
      baseUrl,
      appid: 620,
      limit: 4,
      userLimit: 20
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.human-proof-ops-cli.v1",
      appid: 620,
      summary: {
        status: "ready-to-submit",
        humans: 3,
        linked: 2,
        consented: 1,
        readyTickets: 1,
        consentRequired: 1,
        steamNotLinked: 1,
        readyTasks: 4,
        actions: ["submit-human-proof", "grant-proof-consent", "link-steam", "inspect-human-proof-plan"]
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/human-proof/ops-report"
    ]);
    expect(calls[0].search).toContain("appid=620");
    expect(calls[0].search).toContain("limit=4");
    expect(calls[0].search).toContain("userLimit=20");
  });

  it("executes a recommended human proof submission when requested", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runHumanProofOps({
      baseUrl,
      appid: 620,
      limit: 4,
      userLimit: 20,
      execute: "submit-human-proof"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.human-proof-ops-cli.v1",
      summary: {
        status: "needs-human-onboarding",
        readyTickets: 0,
        executedActionId: "submit-human-proof",
        executedActionIds: ["submit-human-proof"],
        executedActionCount: 1,
        submissionRunId: "run_human",
        submissionScoreboardReady: true,
        actions: ["grant-proof-consent", "link-steam", "inspect-human-proof-plan"]
      },
      executedAction: {
        action: {
          id: "submit-human-proof"
        },
        result: {
          submission: {
            taskId: "620:ACH_A",
            scoreboardReady: true
          }
        }
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/human-proof/ops-report",
      "POST /api/users/u1/steam-proof-submissions",
      "GET /api/human-proof/ops-report"
    ]);
    expect(calls[1].body).toEqual({ taskId: "620:ACH_A" });
  });

  it("advances human proof submissions and onboarding blockers", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runHumanProofOps({
      baseUrl,
      appid: 620,
      limit: 4,
      userLimit: 20,
      execute: "advance-human-proof-actions",
      maxSteps: 3,
      steamid: "76561198000000065",
      proofConsent: true
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.human-proof-ops-cli.v1",
      summary: {
        status: "scoreboard-covered",
        readyTickets: 0,
        consentRequired: 0,
        steamNotLinked: 0,
        executedActionId: "submit-human-proof",
        executedActionIds: ["submit-human-proof", "grant-proof-consent", "link-steam"],
        executedActionCount: 3,
        submissionRunId: "run_human",
        submissionScoreboardReady: true,
        consentedUserId: "u2",
        linkedUserId: "u3",
        actions: ["inspect-human-proof-plan"]
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/human-proof/ops-report",
      "POST /api/users/u1/steam-proof-submissions",
      "GET /api/human-proof/ops-report",
      "POST /api/users/u2/steam-proof-consent",
      "GET /api/human-proof/ops-report",
      "POST /api/users/u3/steam",
      "GET /api/human-proof/ops-report"
    ]);
    expect(calls[1].body).toEqual({ taskId: "620:ACH_A" });
    expect(calls[3].body).toEqual({ consented: true });
    expect(calls[5].body).toEqual({
      steamid: "76561198000000065",
      proofConsent: true
    });
  });
});
