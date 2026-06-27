import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runResultCertificateIndex } from "./result-certificate-index.mjs";
import { verifyCertificate } from "./result-certificate-verify.mjs";

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

function certificate(kind, id, path) {
  const base = {
    schemaVersion: "steambench.result-certificate.v1",
    generatedAt: "2026-06-14T00:00:00.000Z",
    kind,
    id,
    title: `${kind} ${id}`,
    status: "scoreboard-ready",
    verdict: "scoreboard-ready",
    canonicalArtifactName: "output.mp4",
    participants: [
      { side: kind === "game-coverage-run" ? "human" : "agent", id: "participant_a", handle: "participant-a", displayName: "Participant A", score: 1000 }
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
      bundleReady: true
    },
    links: {
      evidenceBundle: `http://127.0.0.1${path.replace("result-certificate", "evidence-bundle")}`,
      resultCertificate: `http://127.0.0.1${path}`
    },
    integrity: {
      readyForPublicShare: true,
      checklist: [
        { id: "ready", label: "ready", status: "pass" }
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

async function startMockIndexApi(certificatesByPath) {
  const calls = [];
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : undefined;
    calls.push({ method: request.method, path: url.pathname, search: url.search, body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/result-certificates") {
      response.end(JSON.stringify({
        index: {
          schemaVersion: "steambench.result-certificate-index.v1",
          generatedAt: "2026-06-14T00:00:00.000Z",
          requested: {
            kind: url.searchParams.get("kind") ?? "all",
            limit: Number(url.searchParams.get("limit") ?? 50),
            readyForPublicShare: true
          },
          totals: {
            certificates: Object.keys(certificatesByPath).length,
            readyForPublicShare: Object.keys(certificatesByPath).length
          },
          certificates: Object.entries(certificatesByPath).map(([path, cert]) => ({
            kind: cert.kind,
            id: cert.id,
            title: cert.title,
            generatedAt: cert.generatedAt,
            status: cert.status,
            verdict: cert.verdict,
            readyForPublicShare: cert.integrity.readyForPublicShare,
            canonicalArtifactName: cert.canonicalArtifactName,
            fingerprint: cert.verification.fingerprint,
            verificationMethod: cert.verification.method,
            participants: cert.participants,
            tasks: cert.tasks,
            result: cert.result,
            links: {
              ...cert.links,
              resultCertificate: path
            }
          })),
          links: {
            verify: "/api/result-certificates/verify"
          }
        }
      }));
      return;
    }

    if (request.method === "GET" && certificatesByPath[url.pathname]) {
      response.end(JSON.stringify({ certificate: certificatesByPath[url.pathname] }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/result-certificates/verify") {
      const verification = verifyCertificate(body.certificate);
      response.statusCode = verification.valid ? 200 : 422;
      response.end(JSON.stringify({ verification }));
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
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = undefined;
});

describe("result certificate index CLI", () => {
  it("loads the public certificate index, pulls linked certificates, and verifies them locally and remotely", async () => {
    const comparison = certificate("human-agent-comparison", "human_a:campaign_a", "/api/comparisons/human-agent/result-certificate");
    const coverage = certificate("game-coverage-run", "coverage_a", "/api/game-coverage-runs/coverage_a/result-certificate");
    const { baseUrl, calls } = await startMockIndexApi({
      "/api/comparisons/human-agent/result-certificate": comparison,
      "/api/game-coverage-runs/coverage_a/result-certificate": coverage
    });

    const summary = await runResultCertificateIndex({
      baseUrl,
      kind: "all",
      limit: 20,
      verify: true,
      remote: true
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.result-certificate-index-audit-cli.v1",
      request: {
        kind: "all",
        limit: 20,
        verify: true,
        remote: true
      },
      summary: {
        valid: true,
        certificates: 2,
        verified: 2,
        remoteVerified: 2,
        failed: 0,
        byKind: {
          "human-agent-comparison": 1,
          "game-coverage-run": 1
        }
      }
    });
    expect(summary.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "human-agent-comparison",
        id: "human_a:campaign_a",
        fingerprint: comparison.verification.fingerprint,
        localValid: true,
        remoteStatus: 200,
        remoteValid: true,
        valid: true,
        errors: []
      }),
      expect.objectContaining({
        kind: "game-coverage-run",
        id: "coverage_a",
        fingerprint: coverage.verification.fingerprint,
        localValid: true,
        remoteStatus: 200,
        remoteValid: true,
        valid: true,
        errors: []
      })
    ]));
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/result-certificates",
      "GET /api/comparisons/human-agent/result-certificate",
      "POST /api/result-certificates/verify",
      "GET /api/game-coverage-runs/coverage_a/result-certificate",
      "POST /api/result-certificates/verify"
    ]);
  });

  it("flags an index fingerprint that disagrees with the linked certificate", async () => {
    const comparison = certificate("human-agent-comparison", "human_a:campaign_a", "/api/comparisons/human-agent/result-certificate");
    const { baseUrl } = await startMockIndexApi({
      "/api/comparisons/human-agent/result-certificate": {
        ...comparison,
        verification: {
          ...comparison.verification,
          fingerprint: "0".repeat(64)
        }
      }
    });

    const summary = await runResultCertificateIndex({
      baseUrl,
      kind: "all",
      limit: 20,
      verify: true,
      remote: true
    });

    expect(summary.summary).toMatchObject({
      valid: false,
      certificates: 1,
      failed: 1
    });
    expect(summary.entries[0].errors).toEqual(expect.arrayContaining([
      "fingerprint_mismatch",
      "index_actual_fingerprint_mismatch",
      "remote:fingerprint_mismatch"
    ]));
  });
});
