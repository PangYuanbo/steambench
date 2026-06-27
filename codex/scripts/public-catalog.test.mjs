import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runPublicCatalog } from "./public-catalog.mjs";

let server;

function catalog(baseUrl) {
  return {
    schemaVersion: "steambench.public-catalog.v1",
    generatedAt: "2026-06-15T00:00:00.000Z",
    scope: "weekly",
    canonicalArtifactName: "output.mp4",
    publicDataPolicy: {
      officialSteamSourcesOnly: true,
      proofConsentRequiredBeforePublicRanking: true
    },
    filters: {
      season: "weekly",
      appid: 1145360,
      transport: "virtual-controller",
      bridgeable: true,
      provider: "external",
      limit: 4
    },
    totals: {
      games: 1,
      tasks: 1,
      activeTasks: 1,
      candidateTasks: 0,
      bridgeableTasks: 1,
      scoreboardRows: 2,
      humanRows: 1,
      agentRows: 1
    },
    games: [
      {
        appid: 1145360,
        name: "Hades",
        benchmarkFit: 94,
        harnessRisk: "medium",
        tracks: ["achievement", "capture"],
        activeTasks: 1,
        candidateTasks: 0,
        bridgeableTasks: 1,
        scoreboardRows: 2,
        bestTask: {
          id: "1145360:ESCAPE_TARTARUS",
          title: "Escape Tartarus",
          track: "achievement",
          runnable: true,
          bridgeable: true,
          transport: "virtual-controller"
        },
        links: {
          catalog: `${baseUrl}/api/public/catalog?season=weekly&appid=1145360&provider=external&limit=4`,
          benchmarkPack: `${baseUrl}/api/public/games/1145360/benchmark-pack?season=weekly&limit=4`,
          steamIntake: `${baseUrl}/api/public/steam/apps/1145360/intake?limit=4`,
          hub: `${baseUrl}/api/public/competition-hub?season=weekly&appid=1145360&provider=external&limit=4`,
          eventEntry: `${baseUrl}/api/public/events/weekly/entry?appid=1145360&provider=external&limit=4`,
          quickstart: `${baseUrl}/api/public/quickstart?season=weekly&appid=1145360&provider=external&limit=4`
        }
      }
    ],
    tasks: [
      {
        id: "1145360:ESCAPE_TARTARUS",
        appid: 1145360,
        gameName: "Hades",
        title: "Escape Tartarus",
        track: "achievement",
        level: 7,
        score: 1800,
        taskStatus: "active",
        runnable: true,
        actionSpace: {
          schemaVersion: "steambench.runtime-action-space.v1",
          inputMode: "controller",
          transport: "virtual-controller",
          allowedActionTypes: ["button", "stick", "trigger", "wait"],
          privilegedSystemInput: false,
          bridgeable: true,
          requiresControlSession: true
        },
        evidence: {
          canonicalArtifactName: "output.mp4",
          canonicalArtifact: "output/output.mp4",
          proofRequirements: ["steam-achievement", "canonical-artifact"]
        },
        links: {
          eventEntry: `${baseUrl}/api/public/events/weekly/entry?appid=1145360&taskId=1145360%3AESCAPE_TARTARUS&provider=external&limit=4`,
          quickstart: `${baseUrl}/api/public/quickstart?season=weekly&appid=1145360&taskId=1145360%3AESCAPE_TARTARUS&provider=external&limit=4`,
          actionSpace: `${baseUrl}/api/public/tasks/1145360%3AESCAPE_TARTARUS/action-space`,
          bridgeHandoff: `${baseUrl}/api/public/tasks/1145360%3AESCAPE_TARTARUS/bridge-handoff?provider=external`
        }
      }
    ],
    entrypoints: {
      quickstartTemplate: `${baseUrl}/api/public/quickstart?season=weekly&appid={appid}&taskId={taskId}&provider=external&limit=4`,
      bridgeHandoffTemplate: `${baseUrl}/api/public/tasks/{taskId}/bridge-handoff?agentId={agentId}&provider=external`
    },
    nextActions: ["Pick a catalog task, then inspect its public action-space."]
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

describe("public catalog CLI", () => {
  it("validates the public catalog discovery packet", async () => {
    const baseUrl = await startServer((request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname !== "/api/public/catalog") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ catalog: catalog(baseUrl) }));
    });

    const result = await runPublicCatalog({
      baseUrl,
      season: "weekly",
      appid: 1145360,
      transport: "virtual-controller",
      bridgeable: true,
      provider: "external",
      limit: 4
    });

    expect(result.schemaVersion).toBe("steambench.public-catalog-cli.v1");
    expect(result.validation.valid).toBe(true);
    expect(result.summary).toMatchObject({
      valid: true,
      scope: "weekly",
      games: 1,
      tasks: 1,
      bridgeableTasks: 1,
      firstGameAppid: 1145360,
      firstTaskId: "1145360:ESCAPE_TARTARUS",
      firstTaskTransport: "virtual-controller",
      firstTaskBridgeable: true,
      canonicalArtifact: "output/output.mp4"
    });
  });

  it("reports validation errors when a bridgeable catalog returns a non-bridge task", async () => {
    const baseUrl = await startServer((request, response) => {
      const packet = catalog(baseUrl);
      packet.tasks[0].actionSpace.bridgeable = false;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ catalog: packet }));
    });

    const result = await runPublicCatalog({
      baseUrl,
      season: "weekly",
      appid: 1145360,
      transport: "virtual-controller",
      bridgeable: true,
      provider: "external",
      limit: 4
    });

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors).toContain("non_bridgeable_task_returned");
  });
});
