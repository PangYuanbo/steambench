import { readFile } from "node:fs/promises";
import { executeControllerPlan } from "./control-bridge-executors.mjs";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=") || "1"];
  })
);

const baseUrl = args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787";
const requestedSessionId = args.get("session");
const requestedRunId = args.get("run");
const actionFile = args.get("actions");
const observation = args.get("observation") ?? "Control bridge observed a playable state.";
const shouldRevoke = args.get("revoke") === "1" || args.get("revoke") === "true";
const shouldDryRun = args.get("dry-run") === "1" || args.get("dry-run") === "true";
const executor = args.get("executor") ?? process.env.STEAMBENCH_CONTROL_EXECUTOR ?? "audit";
const executorCommand = args.get("executor-command");
const executorArgs = args.get("executor-args");
const executorTimeoutMs = args.get("executor-timeout-ms");

async function readJson(path, options) {
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

async function readJsonAllowConflict(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json" }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok && response.status !== 409) {
    throw new Error(`${path} failed with ${response.status}: ${text}`);
  }
  return { status: response.status, payload };
}

async function resolveSessionId() {
  if (requestedSessionId) return requestedSessionId;
  if (!requestedRunId) {
    throw new Error("Provide --session=<control_session_id> or --run=<run_id>.");
  }
  const sessions = await readJson(`/api/runs/${encodeURIComponent(requestedRunId)}/control-sessions`);
  const active = sessions.controlSessions?.find((entry) => entry.session?.status === "active");
  if (!active) {
    throw new Error(`No active control session found for run ${requestedRunId}.`);
  }
  return active.session.id;
}

async function loadActions(manifest) {
  if (!actionFile) return manifest.actionSpace.examples;
  const content = await readFile(actionFile, "utf8");
  const parsed = JSON.parse(content);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.actions)) return parsed.actions;
  throw new Error(`Action file ${actionFile} must be a JSON array or an object with an actions array.`);
}

const sessionId = await resolveSessionId();
const before = await readJsonAllowConflict(`/api/control-sessions/${encodeURIComponent(sessionId)}/bridge-manifest`);
const manifest = before.payload?.manifest;
if (!manifest) {
  throw new Error(`Control session ${sessionId} did not return a bridge manifest.`);
}
if (!manifest.audit.readyForBridge) {
  throw new Error(`Control session ${sessionId} is not bridge-ready: ${manifest.audit.blockers.join(", ")}`);
}
if (manifest.bridge.transport !== "virtual-controller" || manifest.actionSpace.inputMode !== "controller") {
  throw new Error(`Bridge runner only supports controller virtual-controller leases, got ${manifest.bridge.transport}/${manifest.actionSpace.inputMode}.`);
}
if (manifest.evidence.canonicalArtifact !== "output/output.mp4") {
  throw new Error(`Unexpected canonical artifact ${manifest.evidence.canonicalArtifact}.`);
}

const heartbeat = await readJson(manifest.endpoints.heartbeat, {
  method: "POST",
  body: JSON.stringify({})
});

const actions = await loadActions(manifest);
let actionBatch = null;
let executorReport = null;
let executorEvent = null;
if (!shouldDryRun) {
  actionBatch = await readJson(manifest.endpoints.actionBatch, {
    method: "POST",
    body: JSON.stringify({
      controlSessionId: sessionId,
      observation,
      actions,
      idempotencyKey: `bridge-runner:${sessionId}:${Date.now().toString(36)}`
    })
  });
  const executorRequest = actionBatch.controllerExecutorRequest;
  executorReport = await executeControllerPlan(executorRequest?.plan ?? actionBatch.executionPlan, {
    executor,
    provider: executor === "audit" ? "local-audit" : executorRequest?.provider ?? manifest.bridge.provider,
    sessionId: executorRequest?.sessionId ?? sessionId,
    runId: executorRequest?.runId ?? manifest.lease.runId,
    taskId: executorRequest?.taskId ?? manifest.lease.taskId,
    command: executorCommand,
    commandArgs: executorArgs,
    timeoutMs: executorTimeoutMs
  });
  executorEvent = await readJson(manifest.endpoints.executorReport ?? `/api/runs/${encodeURIComponent(manifest.lease.runId)}/controller-executor-reports`, {
    method: "POST",
    body: JSON.stringify({
      report: executorReport,
      message: `Controller executor ${executorReport.status} ${executorReport.plannedStepCount} planned step(s).`,
      controlSessionId: sessionId,
      idempotencyKey: `bridge-executor:${sessionId}:${Date.now().toString(36)}`
    })
  });
}

const after = await readJsonAllowConflict(`/api/control-sessions/${encodeURIComponent(sessionId)}/bridge-manifest`);
let revoked = null;
if (shouldRevoke) {
  revoked = await readJson(manifest.endpoints.revoke, {
    method: "POST",
    body: JSON.stringify({
      summary: "Control bridge runner closed the lease."
    })
  });
}

const summary = {
  schemaVersion: "steambench.control-bridge-runner-result.v1",
  sessionId,
  runId: manifest.lease.runId,
  taskId: manifest.lease.taskId,
  provider: manifest.bridge.provider,
  transport: manifest.bridge.transport,
  inputMode: manifest.bridge.inputMode,
  executor,
  dryRun: shouldDryRun,
  heartbeatAt: heartbeat.session?.heartbeatAt,
  actionCount: actions.length,
  acceptedActionLabels: actionBatch?.normalizedActionLabels ?? [],
  executorRequest: actionBatch?.controllerExecutorRequest
    ? {
        schemaVersion: actionBatch.controllerExecutorRequest.schemaVersion,
        executor: actionBatch.controllerExecutorRequest.executor,
        provider: actionBatch.controllerExecutorRequest.provider,
        sessionId: actionBatch.controllerExecutorRequest.sessionId,
        runId: actionBatch.controllerExecutorRequest.runId,
        taskId: actionBatch.controllerExecutorRequest.taskId,
        planSchemaVersion: actionBatch.controllerExecutorRequest.plan?.schemaVersion,
        stepCount: actionBatch.controllerExecutorRequest.plan?.steps?.length
      }
    : undefined,
  executionPlan: actionBatch?.executionPlan
    ? {
        schemaVersion: actionBatch.executionPlan.schemaVersion,
        target: actionBatch.executionPlan.target,
        totalDurationMs: actionBatch.executionPlan.totalDurationMs,
        stepCount: actionBatch.executionPlan.steps.length
      }
    : undefined,
  executorReport,
  executorSubmission: executorEvent
    ? {
        schemaVersion: executorEvent.schemaVersion,
        traceActions: executorEvent.trace?.totals?.actions,
        traceExecutorReports: executorEvent.audit?.totals?.executorReports,
        traceVerdict: executorEvent.audit?.verdict,
        traceAudit: executorEvent.links?.traceAudit
      }
    : undefined,
  executorEvent: executorEvent?.event
    ? {
        id: executorEvent.event.id,
        type: executorEvent.event.type,
        executorStatus: executorEvent.event.metadata?.executorStatus,
        executor: executorEvent.event.metadata?.executor,
        sideEffects: executorEvent.event.metadata?.sideEffects
      }
    : undefined,
  before: {
    status: before.status,
    readyForBridge: manifest.audit.readyForBridge,
    acceptedActions: manifest.audit.acceptedActions
  },
  after: {
    status: after.status,
    readyForBridge: after.payload?.manifest?.audit?.readyForBridge,
    acceptedActions: after.payload?.manifest?.audit?.acceptedActions,
    lastActionLabels: after.payload?.manifest?.audit?.lastActionLabels ?? [],
    executorReports: after.payload?.manifest?.audit?.executorReports,
    lastExecutorStatus: after.payload?.manifest?.audit?.lastExecutorStatus,
    lastExecutor: after.payload?.manifest?.audit?.lastExecutor,
    lastExecutorProvider: after.payload?.manifest?.audit?.lastExecutorProvider,
    lastExecutorSideEffects: after.payload?.manifest?.audit?.lastExecutorSideEffects
  },
  revoked: revoked
    ? {
        status: revoked.session?.status,
        summary: revoked.session?.summary
      }
    : undefined
};

console.log(JSON.stringify(summary, null, 2));
