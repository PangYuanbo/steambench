import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { verifyCertificate } from "./result-certificate-verify.mjs";
import { runPublicHuman } from "./public-human.mjs";

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
    kind: "run",
    id: "run_human_1",
    title: "Human run result",
    status: "scoreboard-ready",
    verdict: "scoreboard-ready",
    canonicalArtifactName: "output.mp4",
    participants: [
      { side: "human", id: "human_1", handle: "public-human", displayName: "Public Human", score: 1000 }
    ],
    tasks: [
      { id: "620:ACH.WAKE_UP", appid: 620, gameName: "Portal 2", title: "Wake Up", track: "achievement", level: 1, score: 1000 }
    ],
    result: {
      score: 1000,
      scoreboardRows: 1
    },
    evidence: {
      eventCount: 3,
      artifactCount: 1,
      proofCount: 2,
      streamCount: 0,
      executorReportCount: 0,
      bundleReady: true
    },
    links: {
      evidenceBundle: "http://127.0.0.1/api/runs/run_human_1/evidence-bundle",
      resultCertificate: "http://127.0.0.1/api/runs/run_human_1/result-certificate"
    },
    integrity: {
      readyForPublicShare: true,
      checklist: [
        { id: "canonical-artifact", label: "Canonical output.mp4 artifact is attached", status: "pass" },
        { id: "proofs-verified", label: "Required proof records are verified", status: "pass" },
        { id: "scoreboard-row", label: "Scoreboard row is published", status: "pass" }
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

function runnerContract(baseUrl, humanUserId = "human_1") {
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
      human: {
        proofSubmission: `${baseUrl}/api/users/${humanUserId}/steam-proof-submissions`,
        requiredBody: {
          taskId: "620:ACH.WAKE_UP"
        }
      }
    }
  };
}

function submissionPayload(cert = certificate()) {
  return {
    submission: {
      schemaVersion: "steambench.human-steam-proof-submission.v1",
      userId: "human_1",
      taskId: "620:ACH.WAKE_UP",
      runId: "run_human_1",
      proofType: "steam-achievement",
      scoreboardReady: true,
      links: {
        run: "/api/runs/run_human_1",
        evidenceBundle: "/api/runs/run_human_1/evidence-bundle",
        resultCertificate: "/api/runs/run_human_1/result-certificate"
      }
    },
    run: {
      id: "run_human_1",
      status: "scored",
      score: 1000
    },
    task: {
      id: "620:ACH.WAKE_UP",
      appid: 620,
      title: "Wake Up",
      track: "achievement"
    },
    evaluation: {
      passed: true,
      row: { rank: 1 }
    },
    bundle: {
      schemaVersion: "steambench.evidence-bundle.v1",
      integrity: {
        canonicalArtifactPresent: true,
        requiredProofsVerified: true,
        scoreboardPublished: true
      }
    },
    certificate: cert
  };
}

function taskScoreboard({ includeRun = true } = {}) {
  return {
    schemaVersion: "steambench.public-task-scoreboard.v1",
    canonicalArtifactName: "output.mp4",
    task: {
      id: "620:ACH.WAKE_UP"
    },
    totals: {
      rows: includeRun ? 1 : 0,
      humanRows: includeRun ? 1 : 0,
      agentRows: 0
    },
    matchup: {
      status: includeRun ? "human-only" : "empty"
    },
    humanEntries: includeRun
      ? [
          {
            runId: "run_human_1",
            type: "human",
            competitor: "human:public-human",
            canonicalArtifactName: "output.mp4",
            links: {
              evidenceBundle: "http://127.0.0.1/api/runs/run_human_1/evidence-bundle",
              resultCertificate: "http://127.0.0.1/api/runs/run_human_1/result-certificate"
            }
          }
        ]
      : []
  };
}

async function startMockHumanApi({ includeScoreboardRun = true } = {}) {
  const calls = [];
  const cert = certificate();
  let baseUrl = "";
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : undefined;
    calls.push({ method: request.method, path: url.pathname, search: url.search, body });
    response.setHeader("content-type", "application/json");

    if (request.method === "POST" && url.pathname === "/api/users") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        user: {
          id: "human_1",
          handle: body.handle,
          displayName: body.displayName,
          type: "human"
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/users/human_1/steam") {
      response.end(JSON.stringify({
        user: {
          id: "human_1",
          handle: "public-human",
          type: "human",
          linkedSteamId: body.steamid,
          proofConsentAt: body.proofConsent ? "2026-06-15T00:00:00.000Z" : undefined
        }
      }));
      return;
    }

    if (request.method === "GET" && decodeURIComponent(url.pathname) === "/api/public/tasks/620:ACH.WAKE_UP/runner-contract") {
      response.end(JSON.stringify({ contract: runnerContract(baseUrl, url.searchParams.get("humanUserId") ?? "human_1") }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/users/human_1/steam-proof-submissions") {
      response.statusCode = 201;
      response.end(JSON.stringify(submissionPayload(cert)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/result-certificates/verify") {
      response.end(JSON.stringify({ verification: verifyCertificate(body.certificate) }));
      return;
    }

    if (request.method === "GET" && decodeURIComponent(url.pathname) === "/api/public/tasks/620:ACH.WAKE_UP/scoreboard") {
      response.end(JSON.stringify({ scoreboard: taskScoreboard({ includeRun: includeScoreboardRun }) }));
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

describe("public human CLI", () => {
  it("creates a human competitor, links Steam, submits proof, verifies the certificate, and confirms public scoreboard publication", async () => {
    const { baseUrl, calls, cert } = await startMockHumanApi();

    const result = await runPublicHuman({
      baseUrl,
      taskId: "620:ACH.WAKE_UP",
      execute: "advance-public-human",
      handle: "public-human",
      displayName: "Public Human",
      steamid: "76561198000000000",
      proofConsent: true,
      remoteVerify: true
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.public-human-cli.v1",
      execute: "advance-public-human",
      created: {
        userId: "human_1",
        type: "human"
      },
      linked: {
        userId: "human_1",
        linkedSteamId: "76561198000000000"
      },
      contract: {
        schemaVersion: "steambench.public-task-runner-contract.v1",
        taskId: "620:ACH.WAKE_UP",
        canonicalArtifactName: "output.mp4"
      },
      validation: {
        valid: true,
        errors: []
      },
      submission: {
        schemaVersion: "steambench.human-steam-proof-submission.v1",
        userId: "human_1",
        runId: "run_human_1",
        scoreboardReady: true,
        runStatus: "scored",
        certificateReady: true
      },
      certificate: {
        schemaVersion: "steambench.result-certificate.v1",
        kind: "run",
        readyForPublicShare: true,
        fingerprint: cert.verification.fingerprint
      },
      summary: {
        valid: true,
        errors: [],
        userId: "human_1",
        taskId: "620:ACH.WAKE_UP",
        runId: "run_human_1",
        createdHuman: true,
        linkedSteam: true,
        proofConsented: true,
        scoreboardReady: true,
        certificateReady: true,
        localCertificateValid: true,
        remoteCertificateValid: true,
        publicScoreboardHasRun: true
      }
    });
    expect(result.summary.fingerprint).toBe(cert.verification.fingerprint);
    expect(calls.map((call) => `${call.method} ${call.path}${call.search}`)).toEqual([
      "POST /api/users",
      "POST /api/users/human_1/steam",
      "GET /api/public/tasks/620%3AACH.WAKE_UP/runner-contract?humanUserId=human_1",
      "POST /api/users/human_1/steam-proof-submissions",
      "POST /api/result-certificates/verify",
      "GET /api/public/tasks/620%3AACH.WAKE_UP/scoreboard?season=all&limit=20"
    ]);
    expect(calls.find((call) => call.path === "/api/users/human_1/steam")?.body).toMatchObject({
      steamid: "76561198000000000",
      proofConsent: true
    });
    expect(calls.find((call) => call.path === "/api/users/human_1/steam-proof-submissions")?.body).toEqual({
      taskId: "620:ACH.WAKE_UP"
    });
  });

  it("marks the result invalid when the public task scoreboard does not include the human run", async () => {
    const { baseUrl } = await startMockHumanApi({ includeScoreboardRun: false });

    const result = await runPublicHuman({
      baseUrl,
      taskId: "620:ACH.WAKE_UP",
      execute: "advance-public-human",
      handle: "public-human",
      displayName: "Public Human",
      steamid: "76561198000000000",
      proofConsent: true,
      remoteVerify: true
    });

    expect(result.summary).toMatchObject({
      valid: false,
      publicScoreboardHasRun: false
    });
    expect(result.summary.errors).toContain("public_scoreboard_missing_human_run");
  });
});
