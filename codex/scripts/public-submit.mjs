import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";
import { verifyCertificate } from "./result-certificate-verify.mjs";

const args = parseCliArgs();

function boolArg(name, fallback = false) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function numberArg(name) {
  const value = args.get(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function configFromArgs() {
  const runId = args.get("run-id") ?? args.get("runId") ?? args.get("run");
  if (!runId) throw new Error("Provide --run-id=<run_id>.");
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    runId,
    artifactPath: args.get("artifact-path") ?? args.get("artifactPath") ?? "output/output.mp4",
    userId: args.get("user-id") ?? args.get("userId"),
    steamid: args.get("steamid"),
    steamProofSource: args.get("steam-proof-source") ?? "public-submit",
    allowMock: boolArg("allow-mock", true),
    steamAchieved: boolArg("steam-achieved", true),
    metricValue: numberArg("metric-value") ?? numberArg("metricValue"),
    manualReviewStatus: args.get("manual-review-status") ?? args.get("manualReviewStatus"),
    summary: args.get("summary"),
    reviewer: args.get("reviewer"),
    evaluate: boolArg("evaluate", true),
    remoteVerify: boolArg("remote-verify", true),
    idempotencyKey: args.get("idempotency-key")
  };
}

function resolveUrl(baseUrl, pathOrUrl) {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${baseUrl.replace(/\/$/, "")}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

async function readJson(baseUrl, pathOrUrl, options) {
  const url = resolveUrl(baseUrl, pathOrUrl);
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`${url} failed with ${response.status}: ${text}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function submissionBody(config) {
  return {
    artifactPath: config.artifactPath,
    allowMock: config.allowMock,
    evaluate: config.evaluate,
    ...(config.idempotencyKey ? { idempotencyKey: config.idempotencyKey } : {}),
    ...(config.userId ? { userId: config.userId } : {}),
    ...(config.metricValue === undefined ? {} : { metricValue: config.metricValue }),
    ...(config.manualReviewStatus ? { manualReviewStatus: config.manualReviewStatus } : {}),
    ...(config.summary ? { summary: config.summary } : {}),
    ...(config.reviewer ? { reviewer: config.reviewer } : {}),
    steamProof: {
      achieved: config.steamAchieved,
      source: config.steamProofSource,
      ...(config.userId ? { userId: config.userId } : {}),
      ...(config.steamid ? { steamid: config.steamid } : {})
    }
  };
}

function validateSubmission(payload, localVerification, remoteVerification) {
  const errors = [];
  if (payload?.receipt?.schemaVersion !== "steambench.run-submission-receipt.v1") errors.push("invalid_submission_receipt_schema");
  if (payload?.receipt?.canonicalArtifactName !== "output.mp4") errors.push("canonical_artifact_name_mismatch");
  if (payload?.receipt?.artifactPath !== "output/output.mp4") errors.push("canonical_artifact_path_mismatch");
  if (payload?.receipt?.scoreboardReady !== true) errors.push("scoreboard_not_ready");
  if (payload?.evaluation?.passed !== true) errors.push("evaluation_not_passed");
  if (payload?.run?.status !== "scored") errors.push("run_not_scored");
  if (payload?.audit?.verdict !== "scoreboard-ready") errors.push("audit_not_scoreboard_ready");
  if (payload?.bundle?.schemaVersion !== "steambench.evidence-bundle.v1") errors.push("invalid_evidence_bundle_schema");
  if (payload?.bundle?.integrity?.canonicalArtifactPresent !== true) errors.push("canonical_artifact_missing");
  if (payload?.bundle?.integrity?.requiredProofsVerified !== true) errors.push("required_proofs_not_verified");
  if (payload?.bundle?.integrity?.scoreboardPublished !== true) errors.push("scoreboard_row_missing");
  if (payload?.certificate?.schemaVersion !== "steambench.result-certificate.v1") errors.push("invalid_result_certificate_schema");
  if (payload?.certificate?.integrity?.readyForPublicShare !== true) errors.push("certificate_not_public_ready");
  if (localVerification?.valid !== true) errors.push("local_certificate_verification_failed");
  if (remoteVerification && remoteVerification?.valid !== true) errors.push("remote_certificate_verification_failed");
  if (
    remoteVerification &&
    localVerification?.actualFingerprint &&
    remoteVerification.actualFingerprint !== localVerification.actualFingerprint
  ) {
    errors.push("remote_certificate_fingerprint_mismatch");
  }
  return errors;
}

async function remoteVerifyCertificate(config, certificate) {
  const payload = await readJson(config.baseUrl, "/api/result-certificates/verify", {
    method: "POST",
    body: JSON.stringify({ certificate })
  });
  return payload.verification;
}

async function runPublicSubmit(config = configFromArgs()) {
  const submission = await readJson(config.baseUrl, `/api/runs/${encodeURIComponent(config.runId)}/submission`, {
    method: "POST",
    body: JSON.stringify(submissionBody(config))
  });
  const localVerification = verifyCertificate(submission.certificate);
  const remoteVerification = config.remoteVerify && submission.certificate
    ? await remoteVerifyCertificate(config, submission.certificate)
    : undefined;
  const errors = validateSubmission(submission, localVerification, remoteVerification);
  return {
    schemaVersion: "steambench.public-submit-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    request: {
      runId: config.runId,
      artifactPath: config.artifactPath,
      userId: config.userId,
      steamid: config.steamid,
      metricValue: config.metricValue,
      evaluate: config.evaluate,
      remoteVerify: config.remoteVerify
    },
    receipt: submission.receipt,
    run: submission.run
      ? {
          id: submission.run.id,
          status: submission.run.status,
          score: submission.run.score,
          scoreMetadata: submission.run.scoreMetadata
        }
      : undefined,
    task: submission.task
      ? {
          id: submission.task.id,
          appid: submission.task.appid,
          track: submission.task.track,
          title: submission.task.title
        }
      : undefined,
    proofs: Array.isArray(submission.proofs)
      ? submission.proofs.map((proof) => ({
          id: proof.id,
          type: proof.type,
          status: proof.status
        }))
      : [],
    evaluation: submission.evaluation
      ? {
          passed: submission.evaluation.passed,
          score: submission.evaluation.run?.score,
          rowRank: submission.evaluation.row?.rank
        }
      : undefined,
    audit: submission.audit
      ? {
          verdict: submission.audit.verdict,
          missingProofs: submission.audit.missingProofs,
          events: submission.audit.evidenceCounts?.events,
          artifacts: submission.audit.evidenceCounts?.artifacts,
          proofs: submission.audit.evidenceCounts?.proofs,
          executorReports: submission.audit.controllerExecutorReports?.length
        }
      : undefined,
    bundle: submission.bundle
      ? {
          schemaVersion: submission.bundle.schemaVersion,
          verdict: submission.bundle.integrity?.verdict,
          canonicalArtifactPresent: submission.bundle.integrity?.canonicalArtifactPresent,
          requiredProofsVerified: submission.bundle.integrity?.requiredProofsVerified,
          scoreboardPublished: submission.bundle.integrity?.scoreboardPublished,
          executorReportCount: submission.bundle.integrity?.executorReportCount
        }
      : undefined,
    certificate: submission.certificate
      ? {
          schemaVersion: submission.certificate.schemaVersion,
          kind: submission.certificate.kind,
          id: submission.certificate.id,
          status: submission.certificate.status,
          verdict: submission.certificate.verdict,
          readyForPublicShare: submission.certificate.integrity?.readyForPublicShare,
          fingerprint: submission.certificate.verification?.fingerprint
        }
      : undefined,
    verification: {
      local: localVerification,
      remote: remoteVerification
    },
    summary: {
      valid: errors.length === 0,
      errors,
      runId: config.runId,
      scoreboardReady: submission.receipt?.scoreboardReady,
      evaluationPassed: submission.evaluation?.passed,
      auditVerdict: submission.audit?.verdict,
      certificateReady: submission.certificate?.integrity?.readyForPublicShare,
      localCertificateValid: localVerification.valid,
      remoteCertificateValid: remoteVerification?.valid,
      fingerprint: localVerification.actualFingerprint
    }
  };
}

export { runPublicSubmit };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicSubmit()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.summary.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
