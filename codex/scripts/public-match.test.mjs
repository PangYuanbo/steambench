import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { verifyCertificate } from "./result-certificate-verify.mjs";
import { runPublicMatch } from "./public-match.mjs";

let server;

const signedFields = [
  "schemaVersion",
  "kind",
  "id",
  "title",
  "status",
  "verdict",
  "canonicalArtifactName",
  "participants",
  "tasks",
  "result",
  "evidence",
  "links",
  "integrity"
];

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function certificate() {
  const base = {
    schemaVersion: "steambench.result-certificate.v1",
    generatedAt: "2026-06-15T00:00:00.000Z",
    kind: "match",
    id: "match_1",
    title: "Public Human vs Public Agent",
    status: "scored",
    verdict: "scoreboard-ready",
    canonicalArtifactName: "output.mp4",
    participants: [
      { side: "human", id: "human_1", handle: "human-a", displayName: "Human A", score: 1000 },
      { side: "agent", id: "agent_1", handle: "agent-a", displayName: "Agent A", score: 1200 }
    ],
    tasks: [
      { id: "620:ACH.WAKE_UP", appid: 620, gameName: "Portal 2", title: "Wake Up", track: "achievement", level: 1, score: 1000 }
    ],
    result: {
      winner: "agent",
      margin: 200,
      humanScore: 1000,
      agentScore: 1200,
      scoreboardRows: 2
    },
    evidence: {
      eventCount: 8,
      artifactCount: 2,
      proofCount: 4,
      streamCount: 0,
      executorReportCount: 0,
      bundleReady: true
    },
    links: {
      match: "http://127.0.0.1/api/matches/match_1",
      resultCertificate: "http://127.0.0.1/api/matches/match_1/result-certificate"
    },
    integrity: {
      readyForPublicShare: true,
      checklist: [
        { id: "match-scored", label: "Match has final score", status: "pass" },
        { id: "human-run-ready", label: "Human run ready", status: "pass" },
        { id: "agent-run-ready", label: "Agent run ready", status: "pass" }
      ]
    }
  };
  const signedPayload = Object.fromEntries(signedFields.map((field) => [field, base[field]]));
  return {
    ...base,
    verification: {
      method: "sha256",
      fingerprint: createHash("sha256").update(stableJson(signedPayload)).digest("hex"),
      signedFields
    }
  };
}

async function readBody(request) {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function runnerContract(baseUrl) {
  return {
    schemaVersion: "steambench.public-task-runner-contract.v1",
    generatedAt: "2026-06-15T00:00:00.000Z",
    taskStatus: "active",
    runnable: true,
    canonicalArtifactName: "output.mp4",
    task: {
      id: "620:ACH.WAKE_UP",
      appid: 620,
      gameName: "Portal 2",
      title: "Wake Up",
      track: "achievement",
      level: 1,
      score: 1000
    },
    proof: {
      canonicalArtifactPath: "output/output.mp4",
      artifactName: "output.mp4"
    },
    entrypoints: {
      match: {
        preflight: `${baseUrl}/api/matches/preflight`,
        createMatch: `${baseUrl}/api/matches`,
        requiredBody: {
          taskId: "620:ACH.WAKE_UP"
        }
      }
    }
  };
}

function arenaPacket() {
  return {
    schemaVersion: "steambench.match-arena-packet.v1",
    matchId: "match_1",
    taskId: "620:ACH.WAKE_UP",
    status: "scored",
    readyForStart: false,
    readyForEvaluation: true,
    readyForPublicShare: true,
    human: {
      runId: "run_human_1"
    },
    agent: {
      runId: "run_agent_1"
    },
    endpoints: {
      resultCertificate: "/api/matches/match_1/result-certificate"
    }
  };
}

function scoredMatch() {
  return {
    id: "match_1",
    taskId: "620:ACH.WAKE_UP",
    humanUserId: "human_1",
    agentId: "agent_1",
    status: "scored",
    winner: "agent",
    margin: 200,
    humanRunId: "run_human_1",
    agentRunId: "run_agent_1"
  };
}

function scoreboard({ includeAgent = true } = {}) {
  return {
    schemaVersion: "steambench.public-task-scoreboard.v1",
    canonicalArtifactName: "output.mp4",
    task: {
      id: "620:ACH.WAKE_UP"
    },
    totals: {
      rows: includeAgent ? 2 : 1,
      humanRows: 1,
      agentRows: includeAgent ? 1 : 0
    },
    matchup: {
      status: includeAgent ? "complete" : "human-only"
    },
    humanEntries: [
      {
        runId: "run_human_1",
        type: "human",
        canonicalArtifactName: "output.mp4"
      }
    ],
    agentEntries: includeAgent
      ? [
          {
            runId: "run_agent_1",
            type: "agent",
            canonicalArtifactName: "output.mp4"
          }
        ]
      : []
  };
}

async function startMockMatchApi({ includeAgentScoreboardRun = true } = {}) {
  const calls = [];
  const cert = certificate();
  let baseUrl = "";
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : undefined;
    calls.push({ method: request.method, path: url.pathname, search: url.search, body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && decodeURIComponent(url.pathname) === "/api/public/tasks/620:ACH.WAKE_UP/runner-contract") {
      response.end(JSON.stringify({ contract: runnerContract(baseUrl) }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/matches/preflight") {
      response.end(JSON.stringify({
        eligibility: {
          status: "ready",
          taskId: body.taskId,
          blockers: [],
          proofRequirements: ["steam-achievement", "canonical-artifact"]
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/matches") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        match: {
          id: "match_1",
          taskId: body.taskId,
          humanUserId: body.humanUserId,
          agentId: body.agentId,
          status: "scheduled"
        },
        eligibility: {
          status: "ready"
        },
        arenaPacket: {
          schemaVersion: "steambench.match-arena-packet.v1",
          matchId: "match_1",
          readyForStart: true,
          readyForPublicShare: false
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/matches/match_1/run-local") {
      response.end(JSON.stringify({
        match: scoredMatch(),
        evaluated: {
          match: scoredMatch(),
          humanRun: {
            id: "run_human_1",
            score: 1000
          },
          agentRun: {
            id: "run_agent_1",
            score: 1200
          }
        },
        human: {
          evaluation: {
            passed: true
          }
        },
        agent: {
          evaluation: {
            passed: true
          }
        },
        complete: true,
        arenaPacket: arenaPacket()
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/matches/match_1/result-certificate") {
      response.end(JSON.stringify({ certificate: cert }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/result-certificates/verify") {
      response.end(JSON.stringify({ verification: verifyCertificate(body.certificate) }));
      return;
    }

    if (request.method === "GET" && decodeURIComponent(url.pathname) === "/api/public/tasks/620:ACH.WAKE_UP/scoreboard") {
      response.end(JSON.stringify({ scoreboard: scoreboard({ includeAgent: includeAgentScoreboardRun }) }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  return { baseUrl, calls, cert };
}

afterEach(async () => {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = undefined;
});

describe("public match CLI", () => {
  it("creates and runs a public human-vs-agent match, verifies its certificate, and confirms both scoreboard rows", async () => {
    const { baseUrl, calls, cert } = await startMockMatchApi();

    const result = await runPublicMatch({
      baseUrl,
      taskId: "620:ACH.WAKE_UP",
      humanUserId: "human_1",
      agentId: "agent_1",
      execute: "advance-public-match",
      reviewApproved: false,
      remoteVerify: true
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.public-match-cli.v1",
      execute: "advance-public-match",
      contract: {
        schemaVersion: "steambench.public-task-runner-contract.v1",
        taskId: "620:ACH.WAKE_UP",
        canonicalArtifactName: "output.mp4"
      },
      validation: {
        valid: true,
        errors: []
      },
      preflight: {
        status: "ready",
        blockers: []
      },
      match: {
        id: "match_1",
        status: "scored",
        winner: "agent",
        humanRunId: "run_human_1",
        agentRunId: "run_agent_1"
      },
      arenaPacket: {
        schemaVersion: "steambench.match-arena-packet.v1",
        matchId: "match_1",
        readyForPublicShare: true
      },
      certificate: {
        schemaVersion: "steambench.result-certificate.v1",
        kind: "match",
        readyForPublicShare: true,
        fingerprint: cert.verification.fingerprint
      },
      summary: {
        valid: true,
        errors: [],
        taskId: "620:ACH.WAKE_UP",
        matchId: "match_1",
        matchStatus: "scored",
        winner: "agent",
        humanRunId: "run_human_1",
        agentRunId: "run_agent_1",
        preflightStatus: "ready",
        arenaReadyForPublicShare: true,
        certificateReady: true,
        localCertificateValid: true,
        remoteCertificateValid: true,
        publicScoreboardHasHumanRun: true,
        publicScoreboardHasAgentRun: true
      }
    });
    expect(result.summary.fingerprint).toBe(cert.verification.fingerprint);
    expect(calls.map((call) => `${call.method} ${call.path}${call.search}`)).toEqual([
      "GET /api/public/tasks/620%3AACH.WAKE_UP/runner-contract?humanUserId=human_1&agentId=agent_1",
      "POST /api/matches/preflight",
      "POST /api/matches",
      "POST /api/matches/match_1/run-local",
      "GET /api/matches/match_1/result-certificate",
      "POST /api/result-certificates/verify",
      "GET /api/public/tasks/620%3AACH.WAKE_UP/scoreboard?season=all&limit=20"
    ]);
    expect(calls.find((call) => call.path === "/api/matches/preflight")?.body).toEqual({
      taskId: "620:ACH.WAKE_UP",
      humanUserId: "human_1",
      agentId: "agent_1",
      reviewApproved: false
    });
  });

  it("marks the result invalid when the public scoreboard lacks the agent run", async () => {
    const { baseUrl } = await startMockMatchApi({ includeAgentScoreboardRun: false });

    const result = await runPublicMatch({
      baseUrl,
      taskId: "620:ACH.WAKE_UP",
      humanUserId: "human_1",
      agentId: "agent_1",
      execute: "advance-public-match",
      remoteVerify: true
    });

    expect(result.summary).toMatchObject({
      valid: false,
      publicScoreboardHasHumanRun: true,
      publicScoreboardHasAgentRun: false
    });
    expect(result.summary.errors).toContain("public_scoreboard_missing_agent_run");
  });
});
