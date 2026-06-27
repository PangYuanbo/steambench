import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function optionalBoolArg(name) {
  const value = args.get(name);
  if (value === undefined) return undefined;
  return value === "1" || value === "true" || value === "yes";
}

function configFromArgs() {
  const agentId = args.get("agent-id") ?? args.get("agentId") ?? args.get("agent");
  const taskId = args.get("task-id") ?? args.get("taskId") ?? args.get("task");
  if (!agentId) throw new Error("Provide --agent-id=<agent_id_or_handle>.");
  if (!taskId) throw new Error("Provide --task-id=<task_id>.");
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    agentId,
    taskId,
    ttlSeconds: intArg("ttl-seconds", 900, { min: 30, max: 3600 }),
    createControlSession: optionalBoolArg("create-control-session"),
    createLivestream: optionalBoolArg("create-livestream"),
    livestreamStatus: args.get("livestream-status") ?? "scheduled",
    livestreamTitle: args.get("livestream-title"),
    currentScene: args.get("current-scene"),
    viewerCount: args.has("viewer-count") ? intArg("viewer-count", 0, { min: 0 }) : undefined,
    idempotencyKey: args.get("idempotency-key")
  };
}

async function readJson(baseUrl, path, options) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`${path} failed with ${response.status}: ${text}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function controlGrantFromSession(session) {
  const packet = session.accessPacket;
  if (!packet) return undefined;
  return {
    schemaVersion: "steambench.agent-control-grant.v1",
    runId: packet.lease?.runId,
    taskId: packet.lease?.taskId,
    agentId: packet.lease?.agentId,
    controlSessionId: packet.lease?.id,
    ttlRemainingSeconds: packet.lease?.ttlRemainingSeconds,
    inputMode: packet.permissions?.inputMode,
    transport: packet.permissions?.transport,
    readyForActions: packet.audit?.readyForActions,
    readyForBridge: packet.audit?.readyForBridge,
    allowedActionTypes: packet.permissions?.allowedActionTypes ?? [],
    controller: packet.permissions?.controller,
    constraints: packet.permissions?.constraints,
    forbiddenActions: packet.permissions?.forbiddenActions ?? [],
    bridge: packet.bridge,
    endpoints: {
      actionBatch: packet.endpoints?.actionBatch,
      bridgeManifest: packet.endpoints?.bridgeManifest,
      heartbeat: packet.endpoints?.heartbeat,
      trace: packet.endpoints?.trace,
      traceAudit: packet.endpoints?.traceAudit,
      submission: packet.endpoints?.submission,
      executorReport: packet.endpoints?.executorReport
    },
    expectedExecutorReport: packet.audit?.expectedExecutorReport,
    canonicalArtifact: packet.audit?.canonicalArtifact,
    acceptedArtifactName: packet.audit?.acceptedArtifactName
  };
}

async function runAgentRunSession(config = configFromArgs()) {
  const body = {
    taskId: config.taskId,
    ttlSeconds: config.ttlSeconds,
    ...(config.createControlSession === undefined ? {} : { createControlSession: config.createControlSession }),
    ...(config.createLivestream === undefined ? {} : { createLivestream: config.createLivestream }),
    ...(config.livestreamStatus ? { livestreamStatus: config.livestreamStatus } : {}),
    ...(config.livestreamTitle ? { livestreamTitle: config.livestreamTitle } : {}),
    ...(config.currentScene ? { currentScene: config.currentScene } : {}),
    ...(config.viewerCount === undefined ? {} : { viewerCount: config.viewerCount }),
    ...(config.idempotencyKey ? { idempotencyKey: config.idempotencyKey } : {})
  };
  const session = await readJson(config.baseUrl, `/api/agents/${encodeURIComponent(config.agentId)}/run-session`, {
    method: "POST",
    body: JSON.stringify(body)
  });

  return {
    schemaVersion: "steambench.agent-run-session-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    agentId: config.agentId,
    taskId: config.taskId,
    session,
    controlGrant: controlGrantFromSession(session),
    summary: {
      runId: session.run?.id,
      taskId: session.run?.taskId,
      agentId: session.agent?.id,
      status: session.handoff?.status,
      inputMode: session.handoff?.control?.inputMode,
      transport: session.handoff?.control?.transport,
      controlSessionId: session.controlSession?.session?.id,
      livestreamId: session.livestream?.id,
      livestreamStatus: session.livestream?.status,
      livestreamPlaybackUrl: session.livestream?.playbackUrl,
      accessPacketReady: session.accessPacket?.audit?.readyForActions,
      bridgeReady: session.accessPacket?.audit?.readyForBridge,
      bridgeExecutorCommand: session.accessPacket?.bridge?.executor?.command,
      bridgeExecutorRequest: session.accessPacket?.bridge?.executor?.requestSchemaVersion,
      bridgeExecutorReport: session.accessPacket?.bridge?.executor?.reportSchemaVersion,
      allowedActionTypes: session.accessPacket?.permissions?.allowedActionTypes,
      actionBatchEndpoint: session.accessPacket?.endpoints?.actionBatch,
      bridgeManifestEndpoint: session.accessPacket?.endpoints?.bridgeManifest,
      executorReportEndpoint: session.accessPacket?.endpoints?.executorReport ?? session.links?.executorReport,
      livestreamStatusEndpoint: session.links?.livestreamStatus,
      broadcastEndpoint: session.links?.broadcast,
      broadcastEvidenceBundleEndpoint: session.links?.broadcastEvidenceBundle,
      broadcastResultCertificateEndpoint: session.links?.broadcastResultCertificate,
      forbiddenActions: session.accessPacket?.permissions?.forbiddenActions,
      actions: session.handoff?.recommendedActions?.map((entry) => entry.id) ?? []
    }
  };
}

export { runAgentRunSession };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAgentRunSession()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
