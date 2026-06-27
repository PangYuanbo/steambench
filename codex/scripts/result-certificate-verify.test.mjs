import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runResultCertificateVerify, verifyCertificate } from "./result-certificate-verify.mjs";

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

function certificate(overrides = {}) {
  const base = {
    schemaVersion: "steambench.result-certificate.v1",
    generatedAt: "2026-06-14T00:00:00.000Z",
    kind: "human-agent-comparison",
    id: "human_a:campaign_a",
    title: "Human A vs Agent A",
    status: "complete",
    verdict: "scoreboard-ready",
    canonicalArtifactName: "output.mp4",
    participants: [
      { side: "human", id: "human_a", handle: "human-a", displayName: "Human A", score: 9200 },
      { side: "agent", id: "agent_a", handle: "agent-a", displayName: "Agent A", score: 8700 }
    ],
    tasks: [
      { id: "620:ACH.WAKE_UP", appid: 620, gameName: "Portal 2", title: "Wake Up", track: "achievement", level: 1, score: 1000 }
    ],
    result: {
      winner: "human",
      margin: 500,
      humanScore: 9200,
      agentScore: 8700,
      scoreboardRows: 2
    },
    evidence: {
      eventCount: 10,
      artifactCount: 2,
      proofCount: 2,
      streamCount: 0,
      bundleReady: true
    },
    links: {
      evidenceBundle: "http://127.0.0.1/api/comparisons/human-agent/evidence-bundle?humanUserId=human_a&campaignId=campaign_a",
      resultCertificate: "http://127.0.0.1/api/comparisons/human-agent/result-certificate?humanUserId=human_a&campaignId=campaign_a"
    },
    integrity: {
      readyForPublicShare: true,
      checklist: [
        { id: "comparison-complete", label: "complete", status: "pass" }
      ]
    },
    ...overrides
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

async function startMockApi(cert) {
  const calls = [];
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = request.method === "POST" ? await readBody(request) : undefined;
    calls.push({ method: request.method, path: url.pathname, body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/comparisons/human-agent/result-certificate") {
      response.end(JSON.stringify({ certificate: cert }));
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

describe("result certificate verify CLI", () => {
  it("loads a certificate URL, verifies it locally, and cross-checks the API verifier", async () => {
    const cert = certificate();
    const { baseUrl, calls } = await startMockApi(cert);

    const summary = await runResultCertificateVerify({
      baseUrl,
      url: "/api/comparisons/human-agent/result-certificate?humanUserId=human_a&campaignId=campaign_a",
      remote: true
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.result-certificate-verify-cli.v1",
      source: {
        type: "url"
      },
      verification: {
        schemaVersion: "steambench.result-certificate-verification.v1",
        valid: true,
        expectedFingerprint: cert.verification.fingerprint,
        actualFingerprint: cert.verification.fingerprint,
        errors: []
      },
      summary: {
        valid: true,
        kind: "human-agent-comparison",
        id: "human_a:campaign_a",
        readyForPublicShare: true,
        remoteStatus: 200,
        remoteValid: true,
        remoteMatches: true
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/comparisons/human-agent/result-certificate",
      "POST /api/result-certificates/verify"
    ]);
  });

  it("loads a local certificate file and flags signed-field tampering", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-certificate-verify-"));
    try {
      const cert = certificate();
      const tampered = {
        ...cert,
        result: {
          ...cert.result,
          humanScore: cert.result.humanScore + 1
        }
      };
      const certificatePath = join(dir, "certificate.json");
      await writeFile(certificatePath, JSON.stringify({ certificate: tampered }), "utf8");

      const summary = await runResultCertificateVerify({
        baseUrl: "http://127.0.0.1:8787",
        certificatePath,
        remote: false
      });

      expect(summary).toMatchObject({
        schemaVersion: "steambench.result-certificate-verify-cli.v1",
        source: {
          type: "file",
          path: certificatePath
        },
        verification: {
          valid: false,
          expectedFingerprint: cert.verification.fingerprint
        },
        summary: {
          valid: false,
          id: "human_a:campaign_a"
        }
      });
      expect(summary.verification.errors).toContain("fingerprint_mismatch");
      expect(summary.verification.actualFingerprint).not.toBe(summary.verification.expectedFingerprint);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
