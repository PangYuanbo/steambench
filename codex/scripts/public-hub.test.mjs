import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runPublicHub } from "./public-hub.mjs";

let server;

function hub(baseUrl) {
  return {
    schemaVersion: "steambench.public-competition-hub.v1",
    generatedAt: "2026-06-15T00:00:00.000Z",
    scope: "weekly",
    canonicalArtifactName: "output.mp4",
    publicDataPolicy: {
      officialSteamSourcesOnly: true,
      proofConsentRequiredBeforePublicRanking: true
    },
    selected: {
      game: {
        appid: 620,
        name: "Portal 2",
        benchmarkFit: 94,
        harnessRisk: "medium",
        tracks: ["achievement", "stat", "leaderboard"]
      },
      task: {
        id: "620:ACH.WAKE_UP",
        appid: 620,
        gameName: "Portal 2",
        title: "Wake Up",
        track: "achievement",
        level: 1,
        runnable: true
      },
      gamePack: {
        schemaVersion: "steambench.public-game-benchmark-pack.v1",
        appid: 620,
        tasks: [{ id: "620:ACH.WAKE_UP" }]
      },
      actionSpace: {
        schemaVersion: "steambench.public-task-action-space.v1",
        permissions: {
          transport: "local-desktop"
        },
        bridge: {
          bridgeable: false
        }
      },
      raceEntry: {
        schemaVersion: "steambench.public-task-race-entry.v1",
        human: {
          status: "missing-human"
        }
      }
    },
    platform: {
      totals: {
        activeTasks: 12,
        activeGames: 1
      },
      season: {
        totals: {
          rows: 2
        }
      },
      events: [],
      certificates: {
        totals: {
          readyForPublicShare: 2
        }
      }
    },
    games: [
      {
        appid: 620,
        name: "Portal 2",
        activeTasks: 12,
        scoreboardRows: 2
      }
    ],
    featuredTasks: [
      {
        id: "620:ACH.WAKE_UP",
        appid: 620,
        links: {
          raceEntry: `${baseUrl}/api/public/tasks/620%3AACH.WAKE_UP/race-entry?provider=external&limit=6`
        }
      }
    ],
    broadcasts: {
      totals: {
        broadcasts: 1
      }
    },
    entrypoints: {
      taskRaceEntryTemplate: `${baseUrl}/api/public/tasks/{taskId}/race-entry?humanUserId={userId}&agentId={agentId}&provider=external`,
      publicWatchTemplate: `${baseUrl}/api/public/broadcasts/{streamId}/watch`
    }
  };
}

async function startMockPublicApi() {
  const calls = [];
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    calls.push({ method: request.method, path: url.pathname, search: url.search });
    response.setHeader("content-type", "application/json");
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    if (request.method === "GET" && url.pathname === "/api/public/competition-hub") {
      response.end(JSON.stringify({ hub: hub(baseUrl) }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { baseUrl: `http://127.0.0.1:${address.port}`, calls };
}

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

describe("public hub CLI", () => {
  it("validates the public competition hub packet", async () => {
    const { baseUrl, calls } = await startMockPublicApi();
    const result = await runPublicHub({
      baseUrl,
      season: "weekly",
      appid: 620,
      taskId: "620:ACH.WAKE_UP",
      provider: "external",
      limit: 6
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.public-hub-cli.v1",
      api: baseUrl,
      validation: {
        valid: true,
        errors: []
      },
      summary: {
        scope: "weekly",
        selectedAppid: 620,
        selectedTaskId: "620:ACH.WAKE_UP",
        activeTasks: 12,
        games: 1,
        featuredTasks: 1,
        raceEntryStatus: "missing-human",
        actionSpaceTransport: "local-desktop",
        bridgeable: false,
        broadcasts: 1
      }
    });
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/public/competition-hub",
        search: "?season=weekly&appid=620&taskId=620%3AACH.WAKE_UP&provider=external&limit=6"
      }
    ]);
  });
});
