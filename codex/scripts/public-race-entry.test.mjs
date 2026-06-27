import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runPublicRaceEntry } from "./public-race-entry.mjs";

let server;

function raceEntry(baseUrl, taskId = "620:ACH.WAKE_UP") {
  return {
    schemaVersion: "steambench.public-task-race-entry.v1",
    generatedAt: "2026-06-15T00:00:00.000Z",
    taskStatus: "active",
    runnable: true,
    readyForMatch: true,
    canonicalArtifactName: "output.mp4",
    task: {
      id: taskId,
      appid: 620,
      gameName: "Portal 2",
      title: "Wake Up",
      track: "achievement",
      level: 1
    },
    human: {
      status: "ready",
      ready: true,
      selectedUser: {
        id: "user_1",
        handle: "human",
        displayName: "Human",
        linkedSteamId: "76561198000000001",
        proofConsentAt: "2026-06-15T00:00:00.000Z"
      },
      entryPacket: {
        schemaVersion: "steambench.human-benchmark-entry-packet.v1",
        userId: "user_1",
        taskId,
        appid: 620,
        status: "ready",
        readyForSubmission: true,
        proofType: "steam-achievement",
        evidence: {
          canonicalArtifact: "output/output.mp4",
          acceptedArtifactName: "output.mp4",
          forbiddenArtifactNames: ["output-test.mp4"]
        }
      },
      nextActions: ["Human proof packet is ready for this task."]
    },
    agent: {
      status: "ready-to-run",
      ready: true,
      selectedAgent: {
        id: "agent_1",
        handle: "agent"
      },
      onboarding: {
        schemaVersion: "steambench.public-agent-onboarding.v1",
        status: "ready-to-run"
      },
      nextActions: ["Agent onboarding is ready for this task."]
    },
    actionSpace: {
      schemaVersion: "steambench.public-task-action-space.v1",
      canonicalArtifactName: "output.mp4",
      task: {
        id: taskId,
        appid: 620
      },
      permissions: {
        schemaVersion: "steambench.runtime-action-space.v1",
        inputMode: "keyboard-mouse",
        transport: "local-desktop",
        allowedActionTypes: ["key"],
        privilegedSystemInput: false,
        observeBeforeAct: true,
        constraints: {
          requireCanonicalCapture: true
        }
      },
      bridge: {
        bridgeable: false
      },
      evidence: {
        canonicalArtifact: "output/output.mp4"
      }
    },
    runnerContract: {
      endpoint: `${baseUrl}/api/public/tasks/${encodeURIComponent(taskId)}/runner-contract?agentId=agent_1`,
      method: "GET"
    },
    match: {
      preflight: {
        endpoint: `${baseUrl}/api/matches/preflight`,
        method: "POST",
        bodyTemplate: {
          taskId,
          humanUserId: "user_1",
          agentId: "agent_1"
        },
        eligibility: {
          taskId,
          eligible: true
        }
      },
      createMatch: {
        endpoint: `${baseUrl}/api/matches`,
        method: "POST"
      }
    },
    scoreboard: {
      endpoint: `${baseUrl}/api/public/tasks/${encodeURIComponent(taskId)}/scoreboard?season=all&limit=6`,
      season: "all"
    }
  };
}

async function startMockApi() {
  const calls = [];
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    calls.push({ method: request.method, path: url.pathname, search: url.search });
    response.setHeader("content-type", "application/json");
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    if (request.method === "GET" && decodeURIComponent(url.pathname) === "/api/public/tasks/620:ACH.WAKE_UP/race-entry") {
      response.end(JSON.stringify({ raceEntry: raceEntry(baseUrl) }));
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

describe("public race entry CLI", () => {
  it("validates the human-vs-agent race entry packet", async () => {
    const { baseUrl, calls } = await startMockApi();
    const result = await runPublicRaceEntry({
      baseUrl,
      taskId: "620:ACH.WAKE_UP",
      humanUserId: "user_1",
      agentId: "agent_1",
      provider: "external",
      limit: 6
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.public-race-entry-cli.v1",
      api: baseUrl,
      validation: {
        valid: true,
        errors: []
      },
      summary: {
        taskId: "620:ACH.WAKE_UP",
        appid: 620,
        runnable: true,
        readyForMatch: true,
        humanStatus: "ready",
        humanReady: true,
        agentStatus: "ready-to-run",
        agentReady: true,
        actionSpaceTransport: "local-desktop",
        bridgeable: false,
        matchEligible: true,
        canonicalArtifact: "output/output.mp4"
      }
    });
    expect(calls).toEqual([
      {
        method: "GET",
        path: "/api/public/tasks/620%3AACH.WAKE_UP/race-entry",
        search: "?humanUserId=user_1&agentId=agent_1&provider=external&limit=6"
      }
    ]);
  });
});
