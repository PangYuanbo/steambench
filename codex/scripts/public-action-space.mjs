import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();

function configFromArgs() {
  const taskId = args.get("task-id") ?? args.get("taskId") ?? args.get("task");
  if (!taskId) throw new Error("Provide --task-id=<task_id>.");
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    taskId,
    agentId: args.get("agent-id") ?? args.get("agentId") ?? args.get("agent")
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

function actionSpacePath(config) {
  const query = new URLSearchParams();
  if (config.agentId) query.set("agentId", config.agentId);
  const suffix = query.toString();
  return `/api/public/tasks/${encodeURIComponent(config.taskId)}/action-space${suffix ? `?${suffix}` : ""}`;
}

function validateActionSpace(packet) {
  const errors = [];
  if (packet?.schemaVersion !== "steambench.public-task-action-space.v1") errors.push("invalid_action_space_schema");
  if (packet?.runnable !== true) errors.push("task_not_runnable");
  if (packet?.canonicalArtifactName !== "output.mp4") errors.push("canonical_artifact_name_mismatch");
  if (packet?.permissions?.schemaVersion !== "steambench.runtime-action-space.v1") errors.push("invalid_runtime_action_space_schema");
  if (!Array.isArray(packet?.permissions?.allowedActionTypes) || packet.permissions.allowedActionTypes.length === 0) errors.push("allowed_action_types_missing");
  if (packet?.permissions?.privilegedSystemInput !== false) errors.push("privileged_system_input_enabled");
  if (packet?.permissions?.observeBeforeAct !== true) errors.push("observe_before_act_not_required");
  if (packet?.permissions?.constraints?.requireCanonicalCapture !== true) errors.push("canonical_capture_not_required");
  if (packet?.evidence?.canonicalArtifact !== "output/output.mp4") errors.push("canonical_artifact_path_mismatch");
  if (packet?.exampleActionBatch?.schemaVersion !== "steambench.public-agent-action-batch-template.v1") errors.push("invalid_action_batch_template_schema");
  if (packet?.exampleActionBatch?.endpoint !== "/api/runs/<run_id>/action-batches") errors.push("action_batch_endpoint_mismatch");
  if (!Array.isArray(packet?.exampleActionBatch?.acceptedActionLabels) || packet.exampleActionBatch.acceptedActionLabels.length === 0) errors.push("accepted_action_labels_missing");
  if (packet?.bridge?.bridgeable === true) {
    if (packet?.permissions?.inputMode !== "controller") errors.push("bridgeable_input_mode_mismatch");
    if (packet?.permissions?.transport !== "virtual-controller") errors.push("bridgeable_transport_mismatch");
    if (packet?.bridge?.executorRequest !== "steambench.controller-executor-request.v1") errors.push("executor_request_schema_missing");
    if (packet?.bridge?.executorReport !== "steambench.controller-executor-report.v1") errors.push("executor_report_schema_missing");
    if (packet?.controlSession?.requiredBeforeHostInput !== true) errors.push("control_session_not_required_for_bridge");
    if (packet?.exampleActionBatch?.executionPlanPreview?.schemaVersion !== "steambench.controller-execution-plan.v1") errors.push("execution_plan_preview_missing");
  }
  return errors;
}

async function runPublicActionSpace(config = configFromArgs()) {
  const payload = await readJson(config.baseUrl, actionSpacePath(config));
  const packet = payload.actionSpace;
  const errors = validateActionSpace(packet);
  return {
    schemaVersion: "steambench.public-action-space-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    request: {
      taskId: config.taskId,
      agentId: config.agentId
    },
    actionSpace: packet,
    validation: {
      valid: errors.length === 0,
      errors
    },
    summary: {
      valid: errors.length === 0,
      taskId: packet?.task?.id,
      appid: packet?.task?.appid,
      inputMode: packet?.permissions?.inputMode,
      transport: packet?.permissions?.transport,
      bridgeable: packet?.bridge?.bridgeable,
      allowedActionTypes: packet?.permissions?.allowedActionTypes,
      requiresControlSession: packet?.controlSession?.requiredBeforeHostInput,
      canonicalArtifact: packet?.evidence?.canonicalArtifact,
      exampleActions: packet?.exampleActionBatch?.acceptedActionLabels
    }
  };
}

export { runPublicActionSpace };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicActionSpace()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.validation.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
