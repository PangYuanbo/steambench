import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";
import { verifyCertificate } from "./result-certificate-verify.mjs";

const args = parseCliArgs();
const validExecuteModes = new Set(["inspect", "ensure-human", "link-steam", "submit-proof", "advance-public-human"]);

function boolArg(name, fallback = false) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function configFromArgs() {
  const taskId = args.get("task-id") ?? args.get("taskId") ?? args.get("task");
  const execute = args.get("execute") ?? "inspect";
  if (!taskId) throw new Error("Provide --task-id=<task_id>.");
  if (!validExecuteModes.has(execute)) {
    throw new Error(`Provide --execute as one of: ${[...validExecuteModes].join(", ")}.`);
  }
  const stamp = Date.now().toString(36);
  const handle = args.get("handle") ?? `public-human-${stamp}`;
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    taskId,
    execute,
    userId: args.get("user-id") ?? args.get("userId") ?? args.get("human-user-id") ?? args.get("humanUserId"),
    handle,
    displayName: args.get("display-name") ?? args.get("displayName") ?? handle,
    steamid: args.get("steamid"),
    proofConsent: boolArg("proof-consent", true),
    remoteVerify: boolArg("remote-verify", true)
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

function contractPath(config, userId = config.userId) {
  const query = new URLSearchParams();
  if (userId) query.set("humanUserId", userId);
  const suffix = query.toString();
  return `/api/public/tasks/${encodeURIComponent(config.taskId)}/runner-contract${suffix ? `?${suffix}` : ""}`;
}

function validateContract(contract, userId) {
  const errors = [];
  if (contract?.schemaVersion !== "steambench.public-task-runner-contract.v1") errors.push("invalid_runner_contract_schema");
  if (contract?.runnable !== true) errors.push("runner_contract_not_runnable");
  if (contract?.canonicalArtifactName !== "output.mp4") errors.push("canonical_artifact_name_mismatch");
  if (contract?.proof?.canonicalArtifactPath !== "output/output.mp4") errors.push("canonical_artifact_path_mismatch");
  if (contract?.entrypoints?.human?.requiredBody?.taskId !== contract?.task?.id) errors.push("human_required_body_task_mismatch");
  if (userId && !contract?.entrypoints?.human?.proofSubmission?.includes(`/api/users/${userId}/steam-proof-submissions`)) {
    errors.push("human_proof_submission_endpoint_missing");
  }
  return errors;
}

async function createHuman(config) {
  return readJson(config.baseUrl, "/api/users", {
    method: "POST",
    body: JSON.stringify({
      handle: config.handle,
      displayName: config.displayName,
      type: "human"
    })
  });
}

async function linkSteam(config, userId) {
  if (!config.steamid) throw new Error("Provide --steamid=<17_digit_steamid> when linking Steam.");
  return readJson(config.baseUrl, `/api/users/${encodeURIComponent(userId)}/steam`, {
    method: "POST",
    body: JSON.stringify({
      steamid: config.steamid,
      proofConsent: config.proofConsent
    })
  });
}

async function submitHumanProof(config, contract, userId) {
  const endpoint = contract?.entrypoints?.human?.proofSubmission ?? `/api/users/${encodeURIComponent(userId)}/steam-proof-submissions`;
  return readJson(config.baseUrl, endpoint, {
    method: "POST",
    body: JSON.stringify({
      taskId: contract?.task?.id ?? config.taskId
    })
  });
}

async function remoteVerifyCertificate(config, certificate) {
  const payload = await readJson(config.baseUrl, "/api/result-certificates/verify", {
    method: "POST",
    body: JSON.stringify({ certificate })
  });
  return payload.verification;
}

function compactSubmission(submission) {
  if (!submission) return undefined;
  return {
    schemaVersion: submission.submission?.schemaVersion,
    userId: submission.submission?.userId,
    taskId: submission.submission?.taskId,
    runId: submission.submission?.runId,
    proofType: submission.submission?.proofType,
    scoreboardReady: submission.submission?.scoreboardReady,
    runStatus: submission.run?.status,
    score: submission.run?.score,
    evaluationPassed: submission.evaluation?.passed,
    bundleSchema: submission.bundle?.schemaVersion,
    certificateSchema: submission.certificate?.schemaVersion,
    certificateReady: submission.certificate?.integrity?.readyForPublicShare
  };
}

function validateResult({ contractErrors, submission, localVerification, remoteVerification, scoreboard, userId }) {
  const errors = [...contractErrors];
  if (submission) {
    if (submission.submission?.schemaVersion !== "steambench.human-steam-proof-submission.v1") errors.push("invalid_human_submission_schema");
    if (submission.submission?.scoreboardReady !== true) errors.push("human_submission_not_scoreboard_ready");
    if (submission.run?.status !== "scored") errors.push("human_run_not_scored");
    if (submission.bundle?.schemaVersion !== "steambench.evidence-bundle.v1") errors.push("invalid_evidence_bundle_schema");
    if (submission.bundle?.integrity?.canonicalArtifactPresent !== true) errors.push("canonical_artifact_missing");
    if (submission.certificate?.schemaVersion !== "steambench.result-certificate.v1") errors.push("invalid_result_certificate_schema");
    if (submission.certificate?.integrity?.readyForPublicShare !== true) errors.push("certificate_not_public_ready");
    if (localVerification?.valid !== true) errors.push("local_certificate_verification_failed");
    if (remoteVerification && remoteVerification?.valid !== true) errors.push("remote_certificate_verification_failed");
    if (remoteVerification && localVerification?.actualFingerprint !== remoteVerification.actualFingerprint) {
      errors.push("remote_certificate_fingerprint_mismatch");
    }
    const runId = submission.submission?.runId;
    if (scoreboard && !scoreboard.humanEntries?.some((entry) => entry.runId === runId && entry.type === "human")) {
      errors.push("public_scoreboard_missing_human_run");
    }
    if (scoreboard?.canonicalArtifactName !== "output.mp4") errors.push("public_scoreboard_artifact_mismatch");
  }
  if (userId && scoreboard?.humanEntries?.some((entry) => entry.runId === submission?.submission?.runId)) {
    const competitor = scoreboard.humanEntries.find((entry) => entry.runId === submission?.submission?.runId)?.competitor;
    if (typeof competitor === "string" && !competitor.startsWith("human:")) errors.push("human_scoreboard_competitor_mismatch");
  }
  return errors;
}

async function runPublicHuman(config = configFromArgs()) {
  let userId = config.userId;
  let created;
  let linked;

  if ((config.execute === "ensure-human" || config.execute === "link-steam" || config.execute === "advance-public-human") && !userId) {
    created = await createHuman(config);
    userId = created.user?.id;
  }

  if ((config.execute === "link-steam" || config.execute === "advance-public-human") && userId && config.steamid) {
    linked = await linkSteam(config, userId);
  }

  const contractPayload = await readJson(config.baseUrl, contractPath(config, userId));
  const contract = contractPayload.contract;
  const contractErrors = validateContract(contract, userId);

  let submission;
  if ((config.execute === "submit-proof" || config.execute === "advance-public-human") && userId) {
    submission = await submitHumanProof(config, contract, userId);
  } else if (config.execute === "submit-proof" || config.execute === "advance-public-human") {
    throw new Error("Provide --user-id=<human_user_id> or allow --execute=advance-public-human to create one.");
  }

  const localVerification = submission?.certificate ? verifyCertificate(submission.certificate) : undefined;
  const remoteVerification = config.remoteVerify && submission?.certificate
    ? await remoteVerifyCertificate(config, submission.certificate)
    : undefined;
  const scoreboard = submission?.submission?.runId
    ? (await readJson(config.baseUrl, `/api/public/tasks/${encodeURIComponent(contract.task.id)}/scoreboard?season=all&limit=20`)).scoreboard
    : undefined;
  const errors = validateResult({
    contractErrors,
    submission,
    localVerification,
    remoteVerification,
    scoreboard,
    userId
  });

  return {
    schemaVersion: "steambench.public-human-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    execute: config.execute,
    request: {
      taskId: config.taskId,
      userId,
      handle: config.handle,
      steamid: config.steamid,
      proofConsent: config.proofConsent,
      remoteVerify: config.remoteVerify
    },
    created: created
      ? {
          userId: created.user?.id,
          handle: created.user?.handle,
          type: created.user?.type
        }
      : undefined,
    linked: linked
      ? {
          userId: linked.user?.id,
          linkedSteamId: linked.user?.linkedSteamId,
          proofConsentAt: linked.user?.proofConsentAt
        }
      : undefined,
    contract: {
      schemaVersion: contract?.schemaVersion,
      taskId: contract?.task?.id,
      appid: contract?.task?.appid,
      runnable: contract?.runnable,
      canonicalArtifactName: contract?.canonicalArtifactName,
      proofSubmission: contract?.entrypoints?.human?.proofSubmission,
      requiredBody: contract?.entrypoints?.human?.requiredBody
    },
    validation: {
      valid: contractErrors.length === 0,
      errors: contractErrors
    },
    submission: compactSubmission(submission),
    certificate: submission?.certificate
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
    scoreboard: scoreboard
      ? {
          schemaVersion: scoreboard.schemaVersion,
          taskId: scoreboard.task?.id,
          rows: scoreboard.totals?.rows,
          humanRows: scoreboard.totals?.humanRows,
          agentRows: scoreboard.totals?.agentRows,
          matchupStatus: scoreboard.matchup?.status,
          humanRunPresent: Boolean(scoreboard.humanEntries?.some((entry) => entry.runId === submission?.submission?.runId))
        }
      : undefined,
    summary: {
      valid: errors.length === 0,
      errors,
      userId,
      taskId: contract?.task?.id,
      runId: submission?.submission?.runId,
      createdHuman: Boolean(created),
      linkedSteam: Boolean(linked?.user?.linkedSteamId),
      proofConsented: Boolean(linked?.user?.proofConsentAt),
      scoreboardReady: submission?.submission?.scoreboardReady,
      certificateReady: submission?.certificate?.integrity?.readyForPublicShare,
      localCertificateValid: localVerification?.valid,
      remoteCertificateValid: remoteVerification?.valid,
      publicScoreboardHasRun: Boolean(scoreboard?.humanEntries?.some((entry) => entry.runId === submission?.submission?.runId)),
      fingerprint: localVerification?.actualFingerprint
    }
  };
}

export { runPublicHuman };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicHuman()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.summary.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
