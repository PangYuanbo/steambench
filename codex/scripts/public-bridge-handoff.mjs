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

function configFromArgs() {
  const taskId = args.get("task-id") ?? args.get("taskId") ?? args.get("task");
  if (!taskId) throw new Error("Provide --task-id=<task_id>.");
  const provider = args.get("provider") ?? "external";
  if (provider !== "local" && provider !== "modal" && provider !== "external") {
    throw new Error("Provide --provider=local|modal|external.");
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    taskId,
    agentId: args.get("agent-id") ?? args.get("agentId") ?? args.get("agent"),
    provider,
    ttlSeconds: intArg("ttl-seconds", 900, { min: 30, max: 3600 })
  };
}

function resolveUrl(baseUrl, pathOrUrl) {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${baseUrl.replace(/\/$/, "")}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

async function readJson(baseUrl, pathOrUrl) {
  const response = await fetch(resolveUrl(baseUrl, pathOrUrl), {
    headers: { "content-type": "application/json" }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`${pathOrUrl} failed with ${response.status}: ${text}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function handoffPath(config) {
  const query = new URLSearchParams();
  if (config.agentId) query.set("agentId", config.agentId);
  query.set("provider", config.provider);
  query.set("ttlSeconds", String(config.ttlSeconds));
  return `/api/public/tasks/${encodeURIComponent(config.taskId)}/bridge-handoff?${query}`;
}

function validateHandoff(handoff, config) {
  const errors = [];
  if (handoff?.schemaVersion !== "steambench.public-bridge-handoff.v1") errors.push("invalid_bridge_handoff_schema");
  if (!["ready-to-grant", "missing-agent", "missing-capabilities", "not-bridgeable", "task-not-runnable"].includes(handoff?.status)) {
    errors.push("invalid_bridge_handoff_status");
  }
  if (handoff?.task?.id !== config.taskId) errors.push("task_id_mismatch");
  if (handoff?.canonicalArtifactName !== "output.mp4") errors.push("canonical_artifact_name_mismatch");
  if (handoff?.permissions?.schemaVersion !== "steambench.runtime-action-space.v1") errors.push("runtime_action_space_missing");
  if (handoff?.permissions?.privilegedSystemInput !== false) errors.push("privileged_system_input_enabled");
  if (handoff?.permissions?.observeBeforeAct !== true) errors.push("observe_before_act_not_required");
  if (handoff?.evidence?.canonicalArtifact !== "output/output.mp4") errors.push("canonical_artifact_path_mismatch");
  if (handoff?.evidence?.forbiddenArtifactNames?.includes("output-test.mp4") !== true) errors.push("forbidden_artifact_missing");
  if (handoff?.grant?.method !== "POST") errors.push("grant_method_mismatch");
  if (handoff?.grant?.bodyTemplate?.taskId !== config.taskId) errors.push("grant_task_mismatch");
  if (handoff?.grant?.bodyTemplate?.ttlSeconds !== config.ttlSeconds) errors.push("grant_ttl_mismatch");
  if (handoff?.postGrantPackets?.accessPacket?.schemaVersion !== "steambench.runtime-control-access-packet.v1") errors.push("access_packet_schema_missing");
  if (handoff?.postGrantPackets?.bridgeManifest?.schemaVersion !== "steambench.control-bridge-manifest.v1") errors.push("bridge_manifest_schema_missing");
  if (handoff?.actionBatch?.receiptSchemaVersion !== "steambench.agent-action-batch-receipt.v1") errors.push("action_batch_receipt_schema_missing");
  if (!Array.isArray(handoff?.actionBatch?.acceptedActionLabels) || handoff.actionBatch.acceptedActionLabels.length === 0) errors.push("accepted_action_labels_missing");
  if (handoff?.executor?.requestSchemaVersion !== "steambench.controller-executor-request.v1") errors.push("executor_request_schema_missing");
  if (handoff?.executor?.reportSchemaVersion !== "steambench.controller-executor-report.v1") errors.push("executor_report_schema_missing");
  if (!String(handoff?.executor?.reportEndpoint ?? "").includes("/controller-executor-reports")) errors.push("executor_report_endpoint_missing");
  if (handoff?.bridgeable === true) {
    if (handoff?.permissions?.inputMode !== "controller") errors.push("bridgeable_input_mode_mismatch");
    if (handoff?.permissions?.transport !== "virtual-controller") errors.push("bridgeable_transport_mismatch");
    if (handoff?.grant?.bodyTemplate?.createControlSession !== true) errors.push("control_session_not_requested");
    if (handoff?.actionBatch?.bodyTemplate?.controlSessionId !== "<control_session_id>") errors.push("action_batch_control_session_missing");
    if (handoff?.actionBatch?.executionPlanPreview?.schemaVersion !== "steambench.controller-execution-plan.v1") errors.push("execution_plan_preview_missing");
  }
  return errors;
}

async function runPublicBridgeHandoff(config = configFromArgs()) {
  const payload = await readJson(config.baseUrl, handoffPath(config));
  const handoff = payload.handoff;
  const errors = validateHandoff(handoff, config);
  return {
    schemaVersion: "steambench.public-bridge-handoff-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    request: {
      taskId: config.taskId,
      agentId: config.agentId,
      provider: config.provider,
      ttlSeconds: config.ttlSeconds
    },
    handoff,
    validation: {
      valid: errors.length === 0,
      errors
    },
    summary: {
      valid: errors.length === 0,
      status: handoff?.status,
      taskId: handoff?.task?.id,
      appid: handoff?.task?.appid,
      agentId: handoff?.selectedAgent?.id,
      bridgeable: handoff?.bridgeable,
      inputMode: handoff?.permissions?.inputMode,
      transport: handoff?.permissions?.transport,
      grantEndpoint: handoff?.grant?.endpoint,
      createsControlSession: handoff?.grant?.createsControlSession,
      ttlSeconds: handoff?.grant?.ttlSeconds,
      accessPacket: handoff?.postGrantPackets?.accessPacket?.schemaVersion,
      bridgeManifest: handoff?.postGrantPackets?.bridgeManifest?.schemaVersion,
      executorRequest: handoff?.executor?.requestSchemaVersion,
      executorReport: handoff?.executor?.reportSchemaVersion,
      acceptedActions: handoff?.actionBatch?.acceptedActionLabels,
      canonicalArtifact: handoff?.evidence?.canonicalArtifact,
      nextActions: handoff?.nextActions
    }
  };
}

export { runPublicBridgeHandoff };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicBridgeHandoff()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.validation.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
