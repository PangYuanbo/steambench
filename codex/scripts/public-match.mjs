import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";
import { verifyCertificate } from "./result-certificate-verify.mjs";

const args = parseCliArgs();
const validExecuteModes = new Set(["inspect", "preflight", "create-match", "run-local", "advance-public-match"]);

function boolArg(name, fallback = false) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function configFromArgs() {
  const taskId = args.get("task-id") ?? args.get("taskId") ?? args.get("task");
  const humanUserId = args.get("human-user-id") ?? args.get("humanUserId") ?? args.get("human");
  const agentId = args.get("agent-id") ?? args.get("agentId") ?? args.get("agent");
  const execute = args.get("execute") ?? "inspect";
  if (!taskId) throw new Error("Provide --task-id=<task_id>.");
  if (!humanUserId) throw new Error("Provide --human-user-id=<human_user_id>.");
  if (!agentId) throw new Error("Provide --agent-id=<agent_id>.");
  if (!validExecuteModes.has(execute)) {
    throw new Error(`Provide --execute as one of: ${[...validExecuteModes].join(", ")}.`);
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    taskId,
    humanUserId,
    agentId,
    execute,
    reviewApproved: boolArg("review-approved", false),
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

function contractPath(config) {
  const query = new URLSearchParams();
  query.set("humanUserId", config.humanUserId);
  query.set("agentId", config.agentId);
  return `/api/public/tasks/${encodeURIComponent(config.taskId)}/runner-contract?${query}`;
}

function validateContract(contract, config) {
  const errors = [];
  if (contract?.schemaVersion !== "steambench.public-task-runner-contract.v1") errors.push("invalid_runner_contract_schema");
  if (contract?.runnable !== true) errors.push("runner_contract_not_runnable");
  if (contract?.canonicalArtifactName !== "output.mp4") errors.push("canonical_artifact_name_mismatch");
  if (contract?.proof?.canonicalArtifactPath !== "output/output.mp4") errors.push("canonical_artifact_path_mismatch");
  if (contract?.task?.id !== config.taskId) errors.push("contract_task_mismatch");
  if (contract?.entrypoints?.match?.preflight !== `${config.baseUrl.replace(/\/$/, "")}/api/matches/preflight`) {
    errors.push("match_preflight_endpoint_missing");
  }
  if (contract?.entrypoints?.match?.createMatch !== `${config.baseUrl.replace(/\/$/, "")}/api/matches`) {
    errors.push("match_create_endpoint_missing");
  }
  if (contract?.entrypoints?.match?.requiredBody?.taskId !== config.taskId) errors.push("match_required_body_task_mismatch");
  return errors;
}

function matchBody(config, contract) {
  return {
    ...(contract.entrypoints?.match?.requiredBody ?? { taskId: config.taskId }),
    humanUserId: config.humanUserId,
    agentId: config.agentId,
    reviewApproved: config.reviewApproved
  };
}

async function preflight(config, contract) {
  const endpoint = contract.entrypoints?.match?.preflight ?? "/api/matches/preflight";
  return readJson(config.baseUrl, endpoint, {
    method: "POST",
    body: JSON.stringify(matchBody(config, contract))
  });
}

async function createMatch(config, contract) {
  const endpoint = contract.entrypoints?.match?.createMatch ?? "/api/matches";
  return readJson(config.baseUrl, endpoint, {
    method: "POST",
    body: JSON.stringify(matchBody(config, contract))
  });
}

async function runMatchLocal(config, matchId) {
  return readJson(config.baseUrl, `/api/matches/${encodeURIComponent(matchId)}/run-local`, {
    method: "POST"
  });
}

async function remoteVerifyCertificate(config, certificate) {
  const payload = await readJson(config.baseUrl, "/api/result-certificates/verify", {
    method: "POST",
    body: JSON.stringify({ certificate })
  });
  return payload.verification;
}

async function fetchCertificate(config, matchId) {
  return readJson(config.baseUrl, `/api/matches/${encodeURIComponent(matchId)}/result-certificate`);
}

async function fetchScoreboard(config, taskId) {
  return readJson(config.baseUrl, `/api/public/tasks/${encodeURIComponent(taskId)}/scoreboard?season=all&limit=20`);
}

function compactMatch(payload) {
  const match = payload?.match ?? payload?.started?.match ?? payload?.evaluated?.match;
  return match
    ? {
        id: match.id,
        taskId: match.taskId,
        humanUserId: match.humanUserId,
        agentId: match.agentId,
        status: match.status,
        winner: match.winner,
        margin: match.margin,
        humanRunId: match.humanRunId,
        agentRunId: match.agentRunId
      }
    : undefined;
}

function compactArenaPacket(arenaPacket) {
  if (!arenaPacket) return undefined;
  return {
    schemaVersion: arenaPacket.schemaVersion,
    matchId: arenaPacket.matchId,
    taskId: arenaPacket.taskId,
    status: arenaPacket.status,
    readyForStart: arenaPacket.readyForStart,
    readyForEvaluation: arenaPacket.readyForEvaluation,
    readyForPublicShare: arenaPacket.readyForPublicShare,
    humanRunId: arenaPacket.human?.runId,
    agentRunId: arenaPacket.agent?.runId,
    resultCertificate: arenaPacket.endpoints?.resultCertificate
  };
}

function validateResult({ contractErrors, preflightPayload, matchPayload, runPayload, certificate, localVerification, remoteVerification, scoreboard }) {
  const errors = [...contractErrors];
  if (preflightPayload && preflightPayload.eligibility?.status === "blocked") errors.push("match_preflight_blocked");
  const match = compactMatch(runPayload) ?? compactMatch(matchPayload);
  if (matchPayload && !matchPayload.match?.id) errors.push("match_not_created");
  if (runPayload) {
    if (match?.status !== "scored") errors.push("match_not_scored");
    if (!runPayload.human?.evaluation?.passed) errors.push("human_side_not_scored");
    if (!runPayload.agent?.evaluation?.passed) errors.push("agent_side_not_scored");
    if (runPayload.arenaPacket?.readyForPublicShare !== true) errors.push("arena_packet_not_public_ready");
  }
  if (certificate) {
    if (certificate.schemaVersion !== "steambench.result-certificate.v1") errors.push("invalid_result_certificate_schema");
    if (certificate.kind !== "match") errors.push("invalid_result_certificate_kind");
    if (certificate.integrity?.readyForPublicShare !== true) errors.push("certificate_not_public_ready");
    if (localVerification?.valid !== true) errors.push("local_certificate_verification_failed");
    if (remoteVerification && remoteVerification?.valid !== true) errors.push("remote_certificate_verification_failed");
    if (remoteVerification && localVerification?.actualFingerprint !== remoteVerification.actualFingerprint) {
      errors.push("remote_certificate_fingerprint_mismatch");
    }
  }
  if (scoreboard && match) {
    if (!scoreboard.humanEntries?.some((entry) => entry.runId === match.humanRunId)) errors.push("public_scoreboard_missing_human_run");
    if (!scoreboard.agentEntries?.some((entry) => entry.runId === match.agentRunId)) errors.push("public_scoreboard_missing_agent_run");
    if (scoreboard.canonicalArtifactName !== "output.mp4") errors.push("public_scoreboard_artifact_mismatch");
  }
  return errors;
}

async function runPublicMatch(config = configFromArgs()) {
  const contractPayload = await readJson(config.baseUrl, contractPath(config));
  const contract = contractPayload.contract;
  const contractErrors = validateContract(contract, config);

  let preflightPayload;
  if (config.execute === "preflight" || config.execute === "create-match" || config.execute === "run-local" || config.execute === "advance-public-match") {
    preflightPayload = await preflight(config, contract);
  }

  let matchPayload;
  if (config.execute === "create-match" || config.execute === "run-local" || config.execute === "advance-public-match") {
    matchPayload = await createMatch(config, contract);
  }

  let runPayload;
  const matchId = matchPayload?.match?.id;
  if ((config.execute === "run-local" || config.execute === "advance-public-match") && matchId) {
    runPayload = await runMatchLocal(config, matchId);
  }

  const finalMatch = compactMatch(runPayload) ?? compactMatch(matchPayload);
  const certificatePayload = config.execute === "advance-public-match" && finalMatch?.id
    ? await fetchCertificate(config, finalMatch.id)
    : undefined;
  const certificate = certificatePayload?.certificate;
  const localVerification = certificate ? verifyCertificate(certificate) : undefined;
  const remoteVerification = config.remoteVerify && certificate
    ? await remoteVerifyCertificate(config, certificate)
    : undefined;
  const scoreboard = runPayload && finalMatch?.taskId
    ? (await fetchScoreboard(config, finalMatch.taskId)).scoreboard
    : undefined;
  const errors = validateResult({
    contractErrors,
    preflightPayload,
    matchPayload,
    runPayload,
    certificate,
    localVerification,
    remoteVerification,
    scoreboard
  });

  return {
    schemaVersion: "steambench.public-match-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    execute: config.execute,
    request: {
      taskId: config.taskId,
      humanUserId: config.humanUserId,
      agentId: config.agentId,
      reviewApproved: config.reviewApproved,
      remoteVerify: config.remoteVerify
    },
    contract: {
      schemaVersion: contract?.schemaVersion,
      taskId: contract?.task?.id,
      appid: contract?.task?.appid,
      runnable: contract?.runnable,
      canonicalArtifactName: contract?.canonicalArtifactName,
      matchPreflight: contract?.entrypoints?.match?.preflight,
      createMatch: contract?.entrypoints?.match?.createMatch,
      requiredBody: contract?.entrypoints?.match?.requiredBody
    },
    validation: {
      valid: contractErrors.length === 0,
      errors: contractErrors
    },
    preflight: preflightPayload
      ? {
          status: preflightPayload.eligibility?.status,
          blockers: preflightPayload.eligibility?.blockers,
          proofRequirements: preflightPayload.eligibility?.proofRequirements
        }
      : undefined,
    match: finalMatch,
    arenaPacket: compactArenaPacket(runPayload?.arenaPacket ?? matchPayload?.arenaPacket),
    run: runPayload
      ? {
          complete: runPayload.complete,
          humanPassed: runPayload.human?.evaluation?.passed,
          agentPassed: runPayload.agent?.evaluation?.passed,
          humanScore: runPayload.evaluated?.humanRun?.score,
          agentScore: runPayload.evaluated?.agentRun?.score
        }
      : undefined,
    certificate: certificate
      ? {
          schemaVersion: certificate.schemaVersion,
          kind: certificate.kind,
          id: certificate.id,
          status: certificate.status,
          verdict: certificate.verdict,
          winner: certificate.result?.winner,
          readyForPublicShare: certificate.integrity?.readyForPublicShare,
          fingerprint: certificate.verification?.fingerprint
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
          humanRunPresent: Boolean(scoreboard.humanEntries?.some((entry) => entry.runId === finalMatch?.humanRunId)),
          agentRunPresent: Boolean(scoreboard.agentEntries?.some((entry) => entry.runId === finalMatch?.agentRunId))
        }
      : undefined,
    summary: {
      valid: errors.length === 0,
      errors,
      taskId: contract?.task?.id,
      matchId: finalMatch?.id,
      matchStatus: finalMatch?.status,
      winner: finalMatch?.winner,
      humanRunId: finalMatch?.humanRunId,
      agentRunId: finalMatch?.agentRunId,
      preflightStatus: preflightPayload?.eligibility?.status,
      arenaReadyForPublicShare: runPayload?.arenaPacket?.readyForPublicShare,
      certificateReady: certificate?.integrity?.readyForPublicShare,
      localCertificateValid: localVerification?.valid,
      remoteCertificateValid: remoteVerification?.valid,
      publicScoreboardHasHumanRun: Boolean(scoreboard?.humanEntries?.some((entry) => entry.runId === finalMatch?.humanRunId)),
      publicScoreboardHasAgentRun: Boolean(scoreboard?.agentEntries?.some((entry) => entry.runId === finalMatch?.agentRunId)),
      fingerprint: localVerification?.actualFingerprint
    }
  };
}

export { runPublicMatch };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicMatch()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.summary.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
