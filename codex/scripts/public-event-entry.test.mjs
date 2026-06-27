import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runPublicEventEntry } from "./public-event-entry.mjs";

let server;

function eventEntry(baseUrl) {
  return {
    schemaVersion: "steambench.public-event-entry.v1",
    generatedAt: "2026-06-15T00:00:00.000Z",
    scope: "weekly",
    canonicalArtifactName: "output.mp4",
    event: {
      id: "event:weekly",
      title: "Weekly Human vs Agent Cup",
      status: "active",
      window: {
        scope: "weekly",
        label: "weekly",
        rowCount: 2
      },
      entrants: {
        registeredHumans: 1,
        registeredAgents: 1,
        registeredPairs: 1
      },
      score: {
        humanScore: 1000,
        agentScore: 1200
      },
      matches: {
        total: 1,
        scored: 1
      },
      suiteRaces: {
        total: 1,
        scored: 1
      }
    },
    selected: {
      task: {
        id: "1145360:ESCAPE_TARTARUS",
        appid: 1145360,
        gameName: "Hades",
        title: "Escape Tartarus",
        track: "achievement",
        level: 7,
        runnable: true
      },
      suite: {
        id: "1145360:ranked",
        title: "Hades Ranked",
        status: "ranked-ready",
        tier: "ranked",
        taskCount: 3,
        readinessScore: 88
      },
      human: {
        id: "human_1",
        handle: "steam-human",
        linkedSteamId: "76561198000000001",
        proofConsentAt: "2026-06-15T00:00:00.000Z"
      },
      agent: {
        id: "agent_1",
        handle: "runner",
        provider: "external",
        runtimeProvider: "local-sim",
        status: "active"
      }
    },
    readiness: {
      human: {
        status: "registered",
        canRegister: true,
        registrationId: "reg_human",
        blockers: []
      },
      agent: {
        status: "registered",
        canRegister: true,
        registrationId: "reg_agent",
        blockers: []
      },
      pair: {
        ready: true,
        registered: true,
        readyForRaceEntry: true
      },
      eventOps: {
        status: "ready-for-share",
        registeredPairs: 1,
        scheduledRaces: 1,
        scoredRaces: 1,
        readyForPublicShare: true,
        recommendedActionIds: ["inspect-event-certificate"]
      }
    },
    registration: {
      endpoint: `${baseUrl}/api/competition-events/weekly/register`,
      method: "POST",
      human: {
        bodyTemplate: {
          participantType: "human",
          participantId: "human_1",
          notes: "public-event-entry"
        },
        ready: true,
        alreadyRegistered: true
      },
      agent: {
        bodyTemplate: {
          participantType: "agent",
          participantId: "agent_1",
          notes: "public-event-entry"
        },
        ready: true,
        alreadyRegistered: true
      }
    },
    packets: {
      quickstart: {
        schemaVersion: "steambench.public-quickstart.v1",
        endpoint: `${baseUrl}/api/public/quickstart?season=weekly`
      },
      raceEntry: {
        schemaVersion: "steambench.public-task-race-entry.v1",
        readyForMatch: true,
        endpoint: `${baseUrl}/api/public/tasks/1145360%3AESCAPE_TARTARUS/race-entry`
      },
      bridgeHandoff: {
        schemaVersion: "steambench.public-bridge-handoff.v1",
        status: "ready-to-grant",
        bridgeable: true,
        endpoint: `${baseUrl}/api/public/tasks/1145360%3AESCAPE_TARTARUS/bridge-handoff`
      },
      opsReport: {
        schemaVersion: "steambench.competition-event-ops-report.v1",
        endpoint: `${baseUrl}/api/competition-events/weekly/ops-report?suiteId=1145360%3Aranked`
      }
    },
    commands: {
      inspectEntry: "npm run public:event-entry -- --scope=weekly --task-id=1145360:ESCAPE_TARTARUS",
      inspectEventOps: "npm run event:ops -- --scope=weekly --suite-id=1145360:ranked"
    },
    links: {
      event: `${baseUrl}/api/competition-events/weekly`,
      registrations: `${baseUrl}/api/competition-events/registrations`,
      evidenceBundle: `${baseUrl}/api/competition-events/weekly/evidence-bundle`,
      resultCertificate: `${baseUrl}/api/competition-events/weekly/result-certificate`,
      selectedTaskScoreboard: `${baseUrl}/api/public/tasks/1145360%3AESCAPE_TARTARUS/scoreboard?season=weekly&limit=12`
    },
    nextActions: ["Inspect event ops and schedule suite races for registered pairs."]
  };
}

async function startMockPublicApi() {
  const calls = [];
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    calls.push({ method: request.method, path: url.pathname, search: url.search });
    response.setHeader("content-type", "application/json");
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    if (request.method === "GET" && url.pathname === "/api/public/events/weekly/entry") {
      response.end(JSON.stringify({ entry: eventEntry(baseUrl) }));
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

describe("public event entry CLI", () => {
  it("validates the public event registration and race entry packet", async () => {
    const { baseUrl, calls } = await startMockPublicApi();

    const result = await runPublicEventEntry({
      baseUrl,
      scope: "weekly",
      appid: 1145360,
      taskId: "1145360:ESCAPE_TARTARUS",
      humanUserId: "human_1",
      agentId: "agent_1",
      provider: "external",
      suiteId: "1145360:ranked",
      limit: 12
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.public-event-entry-cli.v1",
      validation: {
        valid: true,
        errors: []
      },
      summary: {
        valid: true,
        scope: "weekly",
        eventStatus: "active",
        selectedTaskId: "1145360:ESCAPE_TARTARUS",
        selectedAppid: 1145360,
        selectedSuiteId: "1145360:ranked",
        humanStatus: "registered",
        humanCanRegister: true,
        agentStatus: "registered",
        agentCanRegister: true,
        pairReady: true,
        pairRegistered: true,
        readyForRaceEntry: true,
        eventOpsStatus: "ready-for-share",
        registeredPairs: 1,
        raceEntryReadyForMatch: true,
        bridgeHandoffStatus: "ready-to-grant",
        bridgeable: true
      }
    });
    expect(result.summary.recommendedActionIds).toEqual(["inspect-event-certificate"]);
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/public/events/weekly/entry",
        search: "?appid=1145360&taskId=1145360%3AESCAPE_TARTARUS&humanUserId=human_1&agentId=agent_1&provider=external&suiteId=1145360%3Aranked&limit=12"
      }
    ]);
  });
});
