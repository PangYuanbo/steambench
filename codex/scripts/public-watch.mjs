import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";
import { verifyCertificate } from "./result-certificate-verify.mjs";

const args = parseCliArgs();
const validExecuteModes = new Set(["inspect", "verify-public-watch"]);

function boolArg(name, fallback = false) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function configFromArgs() {
  const streamId = args.get("stream-id") ?? args.get("streamId") ?? args.get("stream");
  const execute = args.get("execute") ?? "inspect";
  if (!streamId) throw new Error("Provide --stream-id=<stream_id>.");
  if (!validExecuteModes.has(execute)) {
    throw new Error(`Provide --execute as one of: ${[...validExecuteModes].join(", ")}.`);
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    streamId,
    execute,
    timelineLimit: intArg("timeline-limit", intArg("limit", 8, { min: 1, max: 50 }), { min: 1, max: 50 }),
    remoteVerify: boolArg("remote-verify", execute === "verify-public-watch")
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

function watchPath(config) {
  const query = new URLSearchParams();
  query.set("timelineLimit", String(config.timelineLimit));
  return `/api/public/broadcasts/${encodeURIComponent(config.streamId)}/watch?${query}`;
}

async function remoteVerifyCertificate(config, certificate) {
  const payload = await readJson(config.baseUrl, "/api/result-certificates/verify", {
    method: "POST",
    body: JSON.stringify({ certificate })
  });
  return payload.verification;
}

function validateWatch(watch, localVerification, remoteVerification) {
  const errors = [];
  if (watch?.schemaVersion !== "steambench.public-broadcast-watch.v1") errors.push("invalid_public_watch_schema");
  if (watch?.canonicalArtifactName !== "output.mp4") errors.push("canonical_artifact_name_mismatch");
  if (!watch?.stream?.id) errors.push("stream_id_missing");
  if (!watch?.stream?.playbackUrl) errors.push("playback_url_missing");
  if (!watch?.run?.id) errors.push("run_id_missing");
  if (!watch?.task?.id) errors.push("task_id_missing");
  if (watch?.watch?.playable !== true) errors.push("watch_not_playable");
  if (watch?.watch?.timelinePresent !== true) errors.push("timeline_missing");
  if (watch?.evidence?.canonicalArtifactPresent !== true) errors.push("canonical_artifact_missing");
  if (watch?.evidence?.requiredProofsVerified !== true) errors.push("proofs_not_verified");
  if (watch?.evidence?.scoreboardPublished !== true) errors.push("scoreboard_not_published");
  if (watch?.certificate?.kind !== "broadcast") errors.push("certificate_kind_mismatch");
  if (watch?.certificate?.readyForPublicShare !== true) errors.push("certificate_not_public_share_ready");
  if (watch?.verification?.fingerprint !== watch?.certificate?.fingerprint) errors.push("watch_fingerprint_mismatch");
  if (localVerification?.valid !== true) errors.push("local_certificate_verification_failed");
  if (remoteVerification && remoteVerification?.valid !== true) errors.push("remote_certificate_verification_failed");
  if (remoteVerification && remoteVerification?.actualFingerprint !== localVerification?.actualFingerprint) {
    errors.push("remote_certificate_fingerprint_mismatch");
  }
  return errors;
}

async function runPublicWatch(config = configFromArgs()) {
  const payload = await readJson(config.baseUrl, watchPath(config));
  const watch = payload.watch;
  const certificate = watch?.certificatePayload;
  const localVerification = certificate ? verifyCertificate(certificate) : undefined;
  const remoteVerification = config.remoteVerify && certificate
    ? await remoteVerifyCertificate(config, certificate)
    : undefined;
  const validationErrors = validateWatch(watch, localVerification, remoteVerification);

  return {
    schemaVersion: "steambench.public-watch-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    execute: config.execute,
    request: {
      streamId: config.streamId,
      timelineLimit: config.timelineLimit,
      remoteVerify: config.remoteVerify
    },
    watch,
    validation: {
      valid: validationErrors.length === 0,
      errors: validationErrors
    },
    verification: {
      local: localVerification,
      remote: remoteVerification
    },
    summary: {
      valid: validationErrors.length === 0,
      streamId: watch?.stream?.id,
      runId: watch?.run?.id,
      taskId: watch?.task?.id,
      status: watch?.stream?.status,
      playbackUrl: watch?.stream?.playbackUrl,
      viewerCount: watch?.stream?.viewerCount,
      publicShareReady: watch?.watch?.publicShareReady,
      scoreboardReady: watch?.watch?.scoreboardReady,
      proofReady: watch?.watch?.proofReady,
      timelineEvents: watch?.watch?.timelinePreview?.length ?? 0,
      localCertificateValid: localVerification?.valid,
      remoteCertificateValid: remoteVerification?.valid,
      fingerprint: watch?.verification?.fingerprint
    }
  };
}

export { runPublicWatch };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicWatch()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.validation.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
