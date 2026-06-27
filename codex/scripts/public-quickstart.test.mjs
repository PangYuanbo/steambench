import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runPublicQuickstart } from "./public-quickstart.mjs";

let server;

function quickstart(baseUrl) {
  return {
    schemaVersion: "steambench.public-quickstart.v1",
    generatedAt: "2026-06-15T00:00:00.000Z",
    scope: "weekly",
    canonicalArtifactName: "output.mp4",
    selected: {
      game: {
        appid: 1145360,
        name: "Hades",
        benchmarkFit: 91
      },
      task: {
        id: "1145360:ESCAPE_TARTARUS",
        appid: 1145360,
        title: "Escape Tartarus",
        runnable: true
      },
      human: {
        id: "human_1",
        handle: "steam-human"
      },
      agent: {
        id: "agent_1",
        handle: "runner"
      }
    },
    readiness: {
      human: {
        status: "ready",
        ready: true,
        selected: true
      },
      agent: {
        status: "ready-to-run",
        ready: true,
        selected: true,
        missingCapabilities: []
      },
      actionSpace: {
        inputMode: "controller",
        transport: "virtual-controller",
        bridgeable: true,
        requiresControlSession: true,
        privilegedSystemInput: false
      },
      match: {
        readyForMatch: true,
        preflightRequired: true
      }
    },
    packets: {
      hub: {
        schemaVersion: "steambench.public-competition-hub.v1",
        endpoint: `${baseUrl}/api/public/competition-hub?season=weekly&appid=1145360`
      },
      raceEntry: {
        schemaVersion: "steambench.public-task-race-entry.v1",
        endpoint: `${baseUrl}/api/public/tasks/1145360%3AESCAPE_TARTARUS/race-entry?humanUserId=human_1&agentId=agent_1`
      },
      actionSpace: {
        schemaVersion: "steambench.public-task-action-space.v1",
        endpoint: `${baseUrl}/api/public/tasks/1145360%3AESCAPE_TARTARUS/action-space?agentId=agent_1`
      },
      agentOnboarding: {
        schemaVersion: "steambench.public-agent-onboarding.v1",
        endpoint: `${baseUrl}/api/public/agents/onboarding?taskId=1145360%3AESCAPE_TARTARUS&agentId=agent_1`
      }
    },
    commands: {
      inspectHub: "npm run public:hub -- --season=weekly --appid=1145360 --task-id=1145360:ESCAPE_TARTARUS",
      registerAgent: "npm run public:agent -- --task-id=1145360:ESCAPE_TARTARUS --provider=external --execute=register --handle=<agent_handle>",
      inspectRaceEntry: "npm run public:race-entry -- --task-id=1145360:ESCAPE_TARTARUS --human-user-id=human_1 --agent-id=agent_1",
      runPublicMatch: "npm run public:match -- --task-id=1145360:ESCAPE_TARTARUS --human-user-id=human_1 --agent-id=agent_1 --execute=advance-public-match",
      runAgentSession: "npm run agent:run-session -- --agent-id=agent_1 --task-id=1145360:ESCAPE_TARTARUS --ttl-seconds=900",
      watchBroadcast: "npm run public:watch -- --stream-id=<stream_id> --execute=verify-public-watch"
    },
    steps: [
      { id: "inspect-hub", method: "GET", endpoint: `${baseUrl}/api/public/competition-hub` },
      { id: "create-human", method: "POST", endpoint: `${baseUrl}/api/users` },
      { id: "link-steam", method: "POST", endpoint: `${baseUrl}/api/users/human_1/steam` },
      { id: "grant-proof-consent", method: "POST", endpoint: `${baseUrl}/api/users/human_1/steam-proof-consent` },
      { id: "inspect-human-proof-plan", method: "GET", endpoint: `${baseUrl}/api/users/human_1/steam-proof-plan` },
      { id: "inspect-agent-onboarding", method: "GET", endpoint: `${baseUrl}/api/public/agents/onboarding` },
      { id: "register-agent", method: "POST", endpoint: `${baseUrl}/api/agents` },
      { id: "inspect-action-space", method: "GET", endpoint: `${baseUrl}/api/public/tasks/1145360%3AESCAPE_TARTARUS/action-space` },
      { id: "inspect-race-entry", method: "GET", endpoint: `${baseUrl}/api/public/tasks/1145360%3AESCAPE_TARTARUS/race-entry` },
      { id: "match-preflight", method: "POST", endpoint: `${baseUrl}/api/matches/preflight` },
      { id: "create-match", method: "POST", endpoint: `${baseUrl}/api/matches` },
      { id: "agent-run-session", method: "POST", endpoint: `${baseUrl}/api/agents/agent_1/run-session` },
      {
        id: "submit-action-batch",
        method: "POST",
        endpoint: `${baseUrl}/api/runs/<run_id>/action-batches`
      },
      {
        id: "submit-evidence",
        method: "POST",
        endpoint: `${baseUrl}/api/runs/<run_id>/submission`,
        bodyTemplate: {
          artifactPath: "output/output.mp4",
          allowMock: false
        }
      },
      { id: "watch-broadcast", method: "GET", endpoint: `${baseUrl}/api/public/broadcasts/<stream_id>/watch` }
    ],
    nextActions: ["Run match preflight and create the public race."]
  };
}

async function startMockPublicApi() {
  const calls = [];
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    calls.push({ method: request.method, path: url.pathname, search: url.search });
    response.setHeader("content-type", "application/json");
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    if (request.method === "GET" && url.pathname === "/api/public/quickstart") {
      response.end(JSON.stringify({ quickstart: quickstart(baseUrl) }));
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

describe("public quickstart CLI", () => {
  it("validates the public quickstart packet", async () => {
    const { baseUrl, calls } = await startMockPublicApi();
    const result = await runPublicQuickstart({
      baseUrl,
      season: "weekly",
      appid: 1145360,
      taskId: "1145360:ESCAPE_TARTARUS",
      humanUserId: "human_1",
      agentId: "agent_1",
      provider: "external",
      limit: 6
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.public-quickstart-cli.v1",
      api: baseUrl,
      validation: {
        valid: true,
        errors: []
      },
      summary: {
        scope: "weekly",
        selectedAppid: 1145360,
        selectedTaskId: "1145360:ESCAPE_TARTARUS",
        humanStatus: "ready",
        humanReady: true,
        agentStatus: "ready-to-run",
        agentReady: true,
        actionSpaceTransport: "virtual-controller",
        bridgeable: true,
        requiresControlSession: true,
        readyForMatch: true,
        steps: 15,
        canonicalArtifact: "output/output.mp4"
      }
    });
    expect(result.summary.commands).toEqual(expect.arrayContaining(["inspectHub", "registerAgent", "inspectRaceEntry", "runAgentSession"]));
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/public/quickstart",
        search: "?season=weekly&appid=1145360&taskId=1145360%3AESCAPE_TARTARUS&humanUserId=human_1&agentId=agent_1&provider=external&limit=6"
      }
    ]);
  });
});
