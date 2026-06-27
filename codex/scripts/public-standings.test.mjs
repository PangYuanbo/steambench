import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runPublicStandings } from "./public-standings.mjs";

let server;

function standings(baseUrl) {
  return {
    schemaVersion: "steambench.public-standings.v1",
    generatedAt: "2026-06-15T00:00:00.000Z",
    scope: "weekly",
    canonicalArtifactName: "output.mp4",
    filters: {
      season: "weekly",
      appid: 620,
      track: "achievement",
      competitor: "agent",
      limit: 4
    },
    selectedGame: {
      appid: 620,
      name: "Portal 2"
    },
    window: {
      scope: "weekly",
      label: "Last 7 Days",
      rowCount: 2
    },
    totals: {
      humanRuns: 0,
      agentRuns: 2,
      humanScore: 0,
      agentScore: 2400,
      humanWins: 0,
      agentWins: 1,
      ties: 0,
      rows: 2,
      games: 1,
      tasks: 1,
      humanRows: 0,
      agentRows: 2
    },
    leaders: {
      competitors: [
        {
          rank: 1,
          competitor: "agent-runner",
          type: "agent",
          runs: 2,
          totalScore: 2400,
          bestScore: 1300,
          averageScore: 1200,
          lastCompletedAt: "2026-06-15"
        }
      ],
      humans: [],
      agents: [
        {
          rank: 1,
          competitor: "agent-runner",
          type: "agent",
          runs: 2,
          totalScore: 2400,
          bestScore: 1300,
          averageScore: 1200,
          lastCompletedAt: "2026-06-15"
        }
      ]
    },
    games: [
      {
        game: "Portal 2",
        leader: {
          rank: 1,
          taskId: "620:ACH.WAKE_UP",
          appid: 620,
          competitor: "agent-runner",
          type: "agent",
          game: "Portal 2",
          task: "Wake Up",
          track: "achievement",
          level: 1,
          score: 1300,
          evidence: "Steam proof + output.mp4",
          completedAt: "2026-06-15"
        },
        links: {
          catalog: `${baseUrl}/api/public/catalog?season=weekly&appid=620&limit=4`,
          benchmarkPack: `${baseUrl}/api/public/games/620/benchmark-pack?season=weekly&limit=4`,
          publicStandings: `${baseUrl}/api/public/standings?season=weekly&appid=620&limit=4`
        }
      }
    ],
    matchups: [],
    taskLeaderboards: [
      {
        taskKey: "620:ACH.WAKE_UP",
        taskId: "620:ACH.WAKE_UP",
        appid: 620,
        game: "Portal 2",
        task: "Wake Up",
        track: "achievement",
        leader: {
          rank: 1,
          taskRank: 1,
          taskId: "620:ACH.WAKE_UP",
          appid: 620,
          competitor: "agent-runner",
          type: "agent",
          game: "Portal 2",
          task: "Wake Up",
          track: "achievement",
          level: 1,
          score: 1300,
          evidence: "Steam proof + output.mp4",
          completedAt: "2026-06-15"
        },
        entries: [],
        links: {
          taskScoreboard: `${baseUrl}/api/public/tasks/620%3AACH.WAKE_UP/scoreboard?season=weekly&limit=4`,
          raceEntry: `${baseUrl}/api/public/tasks/620%3AACH.WAKE_UP/race-entry?limit=4`,
          quickstart: `${baseUrl}/api/public/quickstart?season=weekly&appid=620&taskId=620%3AACH.WAKE_UP&provider=external&limit=4`
        }
      }
    ],
    entrypoints: {
      publicCatalog: `${baseUrl}/api/public/catalog?season=weekly&limit=4`,
      taskScoreboardTemplate: `${baseUrl}/api/public/tasks/{taskId}/scoreboard?season=weekly&limit=4`,
      quickstartTemplate: `${baseUrl}/api/public/quickstart?season=weekly&appid={appid}&taskId={taskId}&provider=external&limit=4`
    },
    links: {
      catalog: `${baseUrl}/api/public/catalog?season=weekly&appid=620&limit=4`
    }
  };
}

async function startServer(handler) {
  server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

describe("public standings CLI", () => {
  it("validates the public standings packet", async () => {
    const baseUrl = await startServer((request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname !== "/api/public/standings") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ standings: standings(baseUrl) }));
    });

    const result = await runPublicStandings({
      baseUrl,
      season: "weekly",
      appid: 620,
      track: "achievement",
      competitor: "agent",
      limit: 4
    });

    expect(result.schemaVersion).toBe("steambench.public-standings-cli.v1");
    expect(result.validation.valid).toBe(true);
    expect(result.summary).toMatchObject({
      valid: true,
      scope: "weekly",
      rows: 2,
      humanRows: 0,
      agentRows: 2,
      competitors: 1,
      games: 1,
      taskLeaderboards: 1,
      topCompetitor: "agent-runner",
      topCompetitorType: "agent",
      topTaskId: "620:ACH.WAKE_UP"
    });
  });

  it("reports validation errors when competitor filters leak other competitor types", async () => {
    const baseUrl = await startServer((_request, response) => {
      const packet = standings(baseUrl);
      packet.leaders.competitors.push({
        rank: 2,
        competitor: "steam-human",
        type: "human",
        runs: 1,
        totalScore: 1000,
        bestScore: 1000,
        averageScore: 1000,
        lastCompletedAt: "2026-06-15"
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ standings: packet }));
    });

    const result = await runPublicStandings({
      baseUrl,
      season: "weekly",
      appid: 620,
      track: "achievement",
      competitor: "agent",
      limit: 4
    });

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors).toContain("wrong_competitor_returned");
  });
});
