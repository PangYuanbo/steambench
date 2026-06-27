import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runPublicWatch } from "./public-watch.mjs";

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

function certificate(baseUrl, { streamId = "stream_1", ready = true } = {}) {
  const base = {
    schemaVersion: "steambench.result-certificate.v1",
    generatedAt: "2026-06-15T00:00:00.000Z",
    kind: "broadcast",
    id: streamId,
    title: "Public watch replay",
    status: ready ? "ended" : "needs-proof",
    verdict: ready ? "scoreboard-ready" : "proof-missing",
    canonicalArtifactName: "output.mp4",
    participants: [
      { side: "agent", id: "agent_1", handle: "codex-agent", displayName: "Codex Agent", score: ready ? 1200 : undefined }
    ],
    tasks: [
      { id: "620:ACH.WAKE_UP", appid: 620, gameName: "Portal 2", title: "Wake Up", track: "achievement", level: 1, score: 1000 }
    ],
    result: {
      score: ready ? 1200 : undefined,
      scoreboardRows: ready ? 1 : 0
    },
    evidence: {
      eventCount: ready ? 5 : 1,
      artifactCount: ready ? 1 : 0,
      proofCount: ready ? 2 : 0,
      streamCount: 1,
      executorReportCount: 0,
      bundleReady: ready
    },
    links: {
      broadcast: `${baseUrl}/api/broadcasts/${streamId}`,
      evidenceBundle: `${baseUrl}/api/broadcasts/${streamId}/evidence-bundle`,
      resultCertificate: `${baseUrl}/api/broadcasts/${streamId}/result-certificate`
    },
    integrity: {
      readyForPublicShare: ready,
      checklist: [
        { id: "stream-playback", label: "Broadcast playback URL is available", status: "pass" },
        { id: "timeline-present", label: "Broadcast has runtime timeline events", status: "pass" },
        { id: "canonical-artifact", label: "Broadcast run has canonical output.mp4 artifact", status: ready ? "pass" : "fail" },
        { id: "proofs-verified", label: "Broadcast run has verified primary and artifact proofs", status: ready ? "pass" : "fail" },
        { id: "scoreboard-row", label: "Broadcast run is published on the scoreboard", status: ready ? "pass" : "fail" }
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

function publicWatch(baseUrl, { ready = true } = {}) {
  const streamId = ready ? "stream_1" : "stream_missing";
  const cert = certificate(baseUrl, { streamId, ready });
  return {
    schemaVersion: "steambench.public-broadcast-watch.v1",
    generatedAt: "2026-06-15T00:00:00.000Z",
    canonicalArtifactName: "output.mp4",
    stream: {
      id: streamId,
      runId: "run_1",
      status: ready ? "ended" : "live",
      provider: "steambench-local",
      title: "Portal 2 replay",
      playbackUrl: `${baseUrl}/replays/${streamId}.m3u8`,
      viewerCount: ready ? 42 : 4,
      currentScene: ready ? "Run complete" : "Runtime live",
      createdAt: "2026-06-15T00:00:00.000Z",
      startedAt: "2026-06-15T00:00:01.000Z",
      endedAt: ready ? "2026-06-15T00:05:00.000Z" : undefined
    },
    run: {
      id: "run_1",
      status: ready ? "scored" : "running",
      competitor: "codex-agent",
      competitorType: "agent",
      runtimeProvider: "local-sim",
      score: ready ? 1200 : undefined,
      artifactName: "output.mp4",
      updatedAt: "2026-06-15T00:05:00.000Z"
    },
    task: {
      id: "620:ACH.WAKE_UP",
      appid: 620,
      gameName: "Portal 2",
      title: "Wake Up",
      track: "achievement",
      level: 1,
      score: 1000
    },
    watch: {
      playable: true,
      publicShareReady: ready,
      scoreboardReady: ready,
      proofReady: ready,
      timelinePresent: true,
      viewerCount: ready ? 42 : 4,
      highImportanceEvents: 0,
      timelinePreview: [
        { id: "evt_1", at: "2026-06-15T00:00:01.000Z", label: "01 · launch", eventType: "launch", message: "Runtime launched", importance: "normal" },
        { id: "evt_2", at: "2026-06-15T00:03:01.000Z", label: "02 · checkpoint", eventType: "checkpoint", message: "Achievement reached", importance: "normal" }
      ]
    },
    evidence: {
      verdict: ready ? "scoreboard-ready" : "incomplete",
      eventCount: ready ? 5 : 1,
      artifactCount: ready ? 1 : 0,
      proofCount: ready ? 2 : 0,
      checkpointCount: ready ? 1 : 0,
      executorReportCount: 0,
      canonicalArtifactPresent: ready,
      requiredProofsVerified: ready,
      scoreboardPublished: ready,
      checklist: cert.integrity.checklist
    },
    certificate: {
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
      links: cert.links
    },
    certificatePayload: cert,
    verification: {
      method: "sha256",
      fingerprint: cert.verification.fingerprint,
      endpoint: `${baseUrl}/api/result-certificates/verify`
    },
    links: {
      broadcast: `${baseUrl}/api/broadcasts/${streamId}`,
      evidenceBundle: `${baseUrl}/api/broadcasts/${streamId}/evidence-bundle`,
      resultCertificate: `${baseUrl}/api/broadcasts/${streamId}/result-certificate`,
      taskScoreboard: `${baseUrl}/api/public/tasks/620%3AACH.WAKE_UP/scoreboard`,
      gameBenchmarkPack: `${baseUrl}/api/public/games/620/benchmark-pack`,
      certificateVerify: `${baseUrl}/api/result-certificates/verify`
    }
  };
}

async function readBody(request) {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function startMockPublicApi({ ready = true } = {}) {
  const calls = [];
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    calls.push({ method: request.method, path: url.pathname, search: url.search });
    response.setHeader("content-type", "application/json");
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    if (request.method === "GET" && url.pathname === `/api/public/broadcasts/${ready ? "stream_1" : "stream_missing"}/watch`) {
      response.end(JSON.stringify({ watch: publicWatch(baseUrl, { ready }) }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/result-certificates/verify") {
      const body = await readBody(request);
      response.end(JSON.stringify({
        verification: {
          schemaVersion: "steambench.result-certificate-verification.v1",
          valid: body.certificate?.verification?.fingerprint === publicWatch(baseUrl, { ready }).certificatePayload.verification.fingerprint,
          method: "sha256",
          expectedFingerprint: body.certificate?.verification?.fingerprint,
          actualFingerprint: body.certificate?.verification?.fingerprint,
          signedFields,
          errors: [],
          certificate: {
            schemaVersion: body.certificate?.schemaVersion,
            kind: body.certificate?.kind,
            id: body.certificate?.id,
            status: body.certificate?.status,
            verdict: body.certificate?.verdict,
            readyForPublicShare: body.certificate?.integrity?.readyForPublicShare
          }
        }
      }));
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

describe("public watch CLI", () => {
  it("validates a public broadcast watch packet and remote certificate", async () => {
    const { baseUrl, calls } = await startMockPublicApi();
    const result = await runPublicWatch({
      baseUrl,
      streamId: "stream_1",
      execute: "verify-public-watch",
      timelineLimit: 4,
      remoteVerify: true
    });

    expect(result).toMatchObject({
      schemaVersion: "steambench.public-watch-cli.v1",
      api: baseUrl,
      execute: "verify-public-watch",
      validation: {
        valid: true,
        errors: []
      },
      summary: {
        valid: true,
        streamId: "stream_1",
        runId: "run_1",
        taskId: "620:ACH.WAKE_UP",
        status: "ended",
        viewerCount: 42,
        publicShareReady: true,
        scoreboardReady: true,
        proofReady: true,
        timelineEvents: 2,
        localCertificateValid: true,
        remoteCertificateValid: true
      }
    });
    expect(result.summary.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/public/broadcasts/stream_1/watch",
      "POST /api/result-certificates/verify"
    ]);
  });

  it("marks a public watch packet invalid when proof and scoreboard evidence are missing", async () => {
    const { baseUrl } = await startMockPublicApi({ ready: false });
    const result = await runPublicWatch({
      baseUrl,
      streamId: "stream_missing",
      execute: "inspect",
      timelineLimit: 4,
      remoteVerify: false
    });

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors).toEqual(expect.arrayContaining([
      "canonical_artifact_missing",
      "proofs_not_verified",
      "scoreboard_not_published",
      "certificate_not_public_share_ready"
    ]));
    expect(result.summary).toMatchObject({
      valid: false,
      streamId: "stream_missing",
      publicShareReady: false,
      scoreboardReady: false,
      proofReady: false,
      localCertificateValid: true
    });
  });
});
