import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { verifyCertificate } from "./result-certificate-verify.mjs";
import { runPublicSubmit } from "./public-submit.mjs";

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
    generatedAt: "2026-06-14T00:00:00.000Z",
    kind: "run",
    id: "run_1",
    title: "Run run_1 result",
    status: "scoreboard-ready",
    verdict: "scoreboard-ready",
    canonicalArtifactName: "output.mp4",
    participants: [
      { side: "agent", id: "agent_1", handle: "agent-1", displayName: "Agent 1", score: 1000 }
    ],
    tasks: [
      { id: "620:ACH.WAKE_UP", appid: 620, gameName: "Portal 2", title: "Wake Up", track: "achievement", level: 1, score: 1000 }
    ],
    result: {
      score: 1000,
      scoreboardRows: 1
    },
    evidence: {
      eventCount: 4,
      artifactCount: 1,
      proofCount: 2,
      streamCount: 0,
      executorReportCount: 0,
      bundleReady: true
    },
    links: {
      evidenceBundle: "http://127.0.0.1/api/runs/run_1/evidence-bundle",
      resultCertificate: "http://127.0.0.1/api/runs/run_1/result-certificate"
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

async function startMockSubmitApi({ scoreboardReady = true } = {}) {
  const calls = [];
  const cert = certificate();
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : undefined;
    calls.push({ method: request.method, path: url.pathname, body });
    response.setHeader("content-type", "application/json");

    if (request.method === "POST" && url.pathname === "/api/runs/run_1/submission") {
      response.statusCode = scoreboardReady ? 201 : 202;
      response.end(JSON.stringify({
        receipt: {
          schemaVersion: "steambench.run-submission-receipt.v1",
          runId: "run_1",
          taskId: "620:ACH.WAKE_UP",
          canonicalArtifactName: "output.mp4",
          artifactPath: body.artifactPath,
          proofCount: 2,
          evaluated: true,
          scoreboardReady,
          links: {
            audit: "/api/runs/run_1/audit",
            evidenceBundle: "/api/runs/run_1/evidence-bundle",
            resultCertificate: "/api/runs/run_1/result-certificate"
          }
        },
        run: {
          id: "run_1",
          status: scoreboardReady ? "scored" : "completed",
          score: scoreboardReady ? 1000 : undefined
        },
        task: {
          id: "620:ACH.WAKE_UP",
          appid: 620,
          track: "achievement",
          title: "Wake Up"
        },
        proofs: [
          { id: "proof_1", type: "steam-achievement", status: "verified" },
          { id: "proof_2", type: "canonical-artifact", status: "verified" }
        ],
        evaluation: {
          passed: scoreboardReady,
          run: {
            score: scoreboardReady ? 1000 : undefined
          },
          row: scoreboardReady ? { rank: 1 } : undefined
        },
        audit: {
          verdict: scoreboardReady ? "scoreboard-ready" : "proof-missing",
          missingProofs: scoreboardReady ? [] : ["steam-achievement"],
          evidenceCounts: {
            events: 4,
            artifacts: 1,
            proofs: 2
          },
          controllerExecutorReports: []
        },
        bundle: {
          schemaVersion: "steambench.evidence-bundle.v1",
          integrity: {
            verdict: scoreboardReady ? "scoreboard-ready" : "proof-missing",
            canonicalArtifactPresent: true,
            requiredProofsVerified: scoreboardReady,
            scoreboardPublished: scoreboardReady,
            executorReportCount: 0
          }
        },
        certificate: cert
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/result-certificates/verify") {
      response.end(JSON.stringify({ verification: verifyCertificate(body.certificate) }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { baseUrl: `http://127.0.0.1:${address.port}`, calls, cert };
}

afterEach(async () => {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = undefined;
});

describe("public submit CLI", () => {
  it("submits canonical evidence and verifies the returned result certificate locally and remotely", async () => {
    const { baseUrl, calls, cert } = await startMockSubmitApi();

    const result = await runPublicSubmit({
      baseUrl,
      runId: "run_1",
      artifactPath: "output/output.mp4",
      userId: "human_1",
      steamid: "76561198000000000",
      steamProofSource: "test",
      allowMock: true,
      steamAchieved: true,
      evaluate: true,
      remoteVerify: true,
      idempotencyKey: "submit-test"
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.public-submit-cli.v1",
      request: {
        runId: "run_1",
        artifactPath: "output/output.mp4",
        userId: "human_1",
        steamid: "76561198000000000",
        evaluate: true,
        remoteVerify: true
      },
      receipt: {
        schemaVersion: "steambench.run-submission-receipt.v1",
        scoreboardReady: true
      },
      run: {
        id: "run_1",
        status: "scored",
        score: 1000
      },
      audit: {
        verdict: "scoreboard-ready",
        missingProofs: [],
        artifacts: 1,
        proofs: 2
      },
      bundle: {
        schemaVersion: "steambench.evidence-bundle.v1",
        canonicalArtifactPresent: true,
        requiredProofsVerified: true,
        scoreboardPublished: true
      },
      certificate: {
        schemaVersion: "steambench.result-certificate.v1",
        kind: "run",
        id: "run_1",
        readyForPublicShare: true,
        fingerprint: cert.verification.fingerprint
      },
      summary: {
        valid: true,
        errors: [],
        runId: "run_1",
        scoreboardReady: true,
        evaluationPassed: true,
        auditVerdict: "scoreboard-ready",
        certificateReady: true,
        localCertificateValid: true,
        remoteCertificateValid: true,
        fingerprint: cert.verification.fingerprint
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/runs/run_1/submission",
      "POST /api/result-certificates/verify"
    ]);
    expect(calls[0].body).toMatchObject({
      artifactPath: "output/output.mp4",
      userId: "human_1",
      allowMock: true,
      evaluate: true,
      idempotencyKey: "submit-test",
      steamProof: {
        achieved: true,
        source: "test",
        userId: "human_1",
        steamid: "76561198000000000"
      }
    });
  });

  it("marks the summary invalid when the submission is not scoreboard-ready", async () => {
    const { baseUrl } = await startMockSubmitApi({ scoreboardReady: false });

    const result = await runPublicSubmit({
      baseUrl,
      runId: "run_1",
      artifactPath: "output/output.mp4",
      allowMock: true,
      steamAchieved: true,
      evaluate: true,
      remoteVerify: false
    });

    expect(result.summary).toMatchObject({
      valid: false,
      scoreboardReady: false,
      evaluationPassed: false,
      auditVerdict: "proof-missing",
      localCertificateValid: true
    });
    expect(result.summary.errors).toEqual(expect.arrayContaining([
      "scoreboard_not_ready",
      "evaluation_not_passed",
      "run_not_scored",
      "audit_not_scoreboard_ready",
      "required_proofs_not_verified",
      "scoreboard_row_missing"
    ]));
  });
});
