import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runSteamLeaderboardProposals } from "./steam-leaderboard-proposals.mjs";

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
    calls.push({ method: request.method, path: url.pathname, search: url.searchParams.toString(), body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/steam/apps/620/leaderboard-proposals") {
      response.end(JSON.stringify({
        source: "fixture",
        proposalRun: {
          schemaVersion: "steambench.steam-leaderboard-proposal-run.v1",
          appid: 620,
          leaderboards: 2,
          proposed: 2,
          reviewRequired: 2
        },
        leaderboards: [{ id: "12345", name: "challenge_mode_time" }],
        proposals: [{ key: "LDRB.CHALLENGE_MODE_TIME" }],
        tasks: [{ id: "620:LDRB.CHALLENGE_MODE_TIME" }],
        reviews: [{ taskId: "620:LDRB.CHALLENGE_MODE_TIME", decision: "review-required" }]
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/steam/apps/620/leaderboard-proposals/import-recommended") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        importRun: {
          schemaVersion: "steambench.steam-leaderboard-recommended-import.v1",
          appid: 620,
          source: body.useFixture ? "fixture" : "steam-live",
          proposed: 2,
          imported: 2,
          reviewRequired: 2
        },
        imported: [
          { id: "620:LDRB.CHALLENGE_MODE_TIME", status: "candidate" },
          { id: "620:LDRB.LEAST_PORTALS", status: "candidate" }
        ],
        reviews: [{ taskId: "620:LDRB.CHALLENGE_MODE_TIME", decision: "review-required" }]
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/steam/apps/620/publish-candidates") {
      response.end(JSON.stringify({
        publication: {
          schemaVersion: "steambench.task-publication.v1",
          published: [{ task: { id: "620:LDRB.CHALLENGE_MODE_TIME" } }],
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

describe("steam leaderboard proposal CLI runner", () => {
  it("previews leaderboard metadata proposals without importing", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runSteamLeaderboardProposals({
      baseUrl,
      appid: 620,
      useFixture: true,
      refresh: false,
      importRecommended: false,
      publish: false,
      reviewApproved: false,
      forceReviewOverride: false,
      limit: 2,
      publishLimit: 10
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.steam-leaderboard-proposals-cli.v1",
      appid: 620,
      source: "fixture",
      imported: false,
      summary: {
        leaderboards: 2,
        proposed: 2,
        reviewRequired: 2
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/steam/apps/620/leaderboard-proposals"
    ]);
    expect(calls[0].search).toContain("useFixture=true");
    expect(calls[0].search).toContain("limit=2");
  });

  it("imports leaderboard proposals and can publish review-approved candidates", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runSteamLeaderboardProposals({
      baseUrl,
      appid: 620,
      useFixture: true,
      refresh: true,
      importRecommended: true,
      publish: true,
      reviewApproved: true,
      forceReviewOverride: true,
      limit: 2,
      publishLimit: 10,
      reviewNotes: "leaderboard fixture"
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.steam-leaderboard-proposals-cli.v1",
      appid: 620,
      imported: true,
      publish: true,
      summary: {
        proposed: 2,
        imported: 2,
        reviewRequired: 2,
        published: 1,
        blocked: 0
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/steam/apps/620/leaderboard-proposals/import-recommended",
      "POST /api/steam/apps/620/publish-candidates"
    ]);
    expect(calls[0].body).toMatchObject({
      useFixture: true,
      refresh: true,
      limit: 2,
      reviewNotes: "leaderboard fixture"
    });
    expect(calls[1].body).toMatchObject({
      limit: 10,
      reviewApproved: true,
      forceReviewOverride: true,
      reviewNotes: "leaderboard fixture"
    });
  });
});
