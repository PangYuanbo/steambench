import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";
import { executeControllerPlan } from "./control-bridge-executors.mjs";

const args = parseCliArgs();
const validExecuteModes = new Set(["inspect", "create-run-session", "submit-example-actions", "advance-public-runner"]);

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
  const taskId = args.get("task-id") ?? args.get("taskId") ?? args.get("task");
  const execute = args.get("execute") ?? "inspect";
  if (!taskId) throw new Error("Provide --task-id=<task_id>.");
  if (!validExecuteModes.has(execute)) {
    throw new Error(`Provide --execute as one of: ${[...validExecuteModes].join(", ")}.`);
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    taskId,
    agentId: args.get("agent-id") ?? args.get("agentId") ?? args.get("agent"),
    humanUserId: args.get("human-user-id") ?? args.get("humanUserId") ?? args.get("human"),
    execute,
    ttlSeconds: intArg("ttl-seconds", 900, { min: 30, max: 3600 }),
    observation: args.get("observation") ?? "Public runner observed the task action space before example actions.",
    confidence: Number(args.get("confidence") ?? 0.75),
    checkpoint: args.get("checkpoint") ?? "Public runner submitted contract example actions.",
    idempotencyKey: args.get("idempotency-key"),
    executor: args.get("executor") ?? "audit",
    executorCommand: args.get("executor-command"),
    executorArgs: args.get("executor-args"),
    executorTimeoutMs: args.get("executor-timeout-ms"),
    createLivestream: boolArg("create-livestream", false),
    livestreamStatus: args.get("livestream-status") ?? "scheduled",
    livestreamTitle: args.get("livestream-title")
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
  if (config.agentId) query.set("agentId", config.agentId);
  if (config.humanUserId) query.set("humanUserId", config.humanUserId);
  const suffix = query.toString();
  return `/api/public/tasks/${encodeURIComponent(config.taskId)}/runner-contract${suffix ? `?${suffix}` : ""}`;
}

function validateContract(contract) {
  const errors = [];
  if (contract?.schemaVersion !== "steambench.public-task-runner-contract.v1") errors.push("invalid_runner_contract_schema");
  if (contract?.runnable !== true) errors.push("runner_contract_not_runnable");
  if (contract?.canonicalArtifactName !== "output.mp4") errors.push("canonical_artifact_name_mismatch");
  if (contract?.proof?.canonicalArtifactPath !== "output/output.mp4") errors.push("canonical_artifact_path_mismatch");
  if (contract?.agentActionContract?.schemaVersion !== "steambench.agent-action-contract.v1") errors.push("invalid_agent_action_contract_schema");
  if (contract?.agentActionContract?.observeBeforeAct !== true) errors.push("observe_before_act_not_required");
  if (contract?.agentActionContract?.actionBatch?.endpoint !== "/api/runs/<run_id>/action-batches") errors.push("action_batch_template_mismatch");
  if (contract?.agentActionContract?.actionBatch?.receiptSchemaVersion !== "steambench.agent-action-batch-receipt.v1") errors.push("receipt_schema_mismatch");
  if (contract?.agentActionContract?.permissions?.privilegedSystemInput !== false) errors.push("privileged_system_input_enabled");
  if (contract?.agentActionContract?.permissions?.constraints?.requireCanonicalCapture !== true) errors.push("canonical_capture_not_required");
  if (contract?.agentActionContract?.evidence?.canonicalArtifact !== "output/output.mp4") errors.push("agent_action_contract_artifact_mismatch");
  const bridgeRequired = contract?.agentActionContract?.bridge?.required === true;
  if (bridgeRequired) {
    if (contract?.agentActionContract?.bridge?.executorRequest?.schemaVersion !== "steambench.controller-executor-request.v1") errors.push("executor_request_schema_missing");
    if (contract?.agentActionContract?.bridge?.executorRequest?.reportSchemaVersion !== "steambench.controller-executor-report.v1") errors.push("executor_report_schema_missing");
    if (contract?.agentActionContract?.bridge?.executionPlanPreview?.schemaVersion !== "steambench.controller-execution-plan.v1") errors.push("execution_plan_preview_missing");
  }
  return errors;
}

function sessionBody(config, contract) {
  return {
    ...(contract.entrypoints?.agent?.requiredBody ?? { taskId: contract.task?.id }),
    ttlSeconds: config.ttlSeconds,
    ...(config.createLivestream
      ? {
          createLivestream: true,
          livestreamStatus: config.livestreamStatus,
          ...(config.livestreamTitle ? { livestreamTitle: config.livestreamTitle } : {})
        }
      : {}),
    ...(config.idempotencyKey ? { idempotencyKey: `${config.idempotencyKey}:run-session` } : {})
  };
}

function actionBatchBody(config, contract, session) {
  const template = contract.agentActionContract?.actionBatch?.requestBodyTemplate ?? {};
  const controlSessionId = session?.controlSession?.session?.id;
  return {
    ...template,
    ...(controlSessionId ? { controlSessionId } : { controlSessionId: undefined }),
    observation: config.observation,
    checkpoint: config.checkpoint,
    confidence: Number.isFinite(config.confidence) ? config.confidence : 0.75,
    source: "public-runner-contract",
    idempotencyKey: config.idempotencyKey ? `${config.idempotencyKey}:action-batch` : `public-runner:${contract.task?.id}:${Date.now().toString(36)}`
  };
}

function actionBatchEndpoint(config, session) {
  const endpoint = session?.accessPacket?.endpoints?.actionBatch ?? session?.links?.actionBatch;
  if (!endpoint) throw new Error("Run session did not return an action batch endpoint.");
  return resolveUrl(config.baseUrl, endpoint);
}

async function submitExecutorReport(config, actionBatch) {
  const request = actionBatch?.controllerExecutorRequest;
  if (!request?.plan) return undefined;
  const report = await executeControllerPlan(request.plan, {
    executor: config.executor,
    provider: config.executor === "audit" ? "public-runner-audit" : request.provider,
    sessionId: request.sessionId,
    runId: request.runId,
    taskId: request.taskId,
    command: config.executorCommand,
    commandArgs: config.executorArgs,
    timeoutMs: config.executorTimeoutMs
  });
  const submission = await readJson(config.baseUrl, `/api/runs/${encodeURIComponent(request.runId)}/controller-executor-reports`, {
    method: "POST",
    body: JSON.stringify({
      report,
      controlSessionId: request.sessionId,
      message: `Public runner ${report.status} ${report.plannedStepCount} planned controller step(s).`,
      idempotencyKey: config.idempotencyKey ? `${config.idempotencyKey}:executor-report` : undefined
    })
  });
  return { report, submission };
}

async function runPublicRunner(config = configFromArgs()) {
  const contractPayload = await readJson(config.baseUrl, contractPath(config));
  const contract = contractPayload.contract;
  const validationErrors = validateContract(contract);
  if (config.execute !== "inspect" && !config.agentId) {
    throw new Error("Provide --agent-id=<agent_id_or_handle> when executing a public runner contract.");
  }

  let session;
  if (config.execute === "create-run-session" || config.execute === "submit-example-actions" || config.execute === "advance-public-runner") {
    const endpoint = contract.entrypoints?.agent?.runSession;
    if (!endpoint) throw new Error("Public runner contract did not include an agent run-session endpoint.");
    session = await readJson(config.baseUrl, endpoint, {
      method: "POST",
      body: JSON.stringify(sessionBody(config, contract))
    });
  }

  let actionBatch;
  if (config.execute === "submit-example-actions" || config.execute === "advance-public-runner") {
    actionBatch = await readJson(config.baseUrl, actionBatchEndpoint(config, session), {
      method: "POST",
      body: JSON.stringify(actionBatchBody(config, contract, session))
    });
  }

  const executor = config.execute === "advance-public-runner"
    ? await submitExecutorReport(config, actionBatch)
    : undefined;
  const trace = session?.run?.id
    ? await readJson(config.baseUrl, `/api/runs/${encodeURIComponent(session.run.id)}/agent-trace`)
    : undefined;

  return {
    schemaVersion: "steambench.public-runner-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    execute: config.execute,
    request: {
      taskId: config.taskId,
      agentId: config.agentId,
      humanUserId: config.humanUserId
    },
    contract: {
      schemaVersion: contract?.schemaVersion,
      taskId: contract?.task?.id,
      appid: contract?.task?.appid,
      runnable: contract?.runnable,
      inputMode: contract?.agentActionContract?.permissions?.inputMode,
      transport: contract?.agentActionContract?.permissions?.transport,
      bridgeRequired: contract?.agentActionContract?.bridge?.required,
      actionBatchReceipt: contract?.agentActionContract?.actionBatch?.receiptSchemaVersion,
      executorRequest: contract?.agentActionContract?.bridge?.executorRequest?.schemaVersion,
      canonicalArtifact: contract?.agentActionContract?.evidence?.canonicalArtifact
    },
    validation: {
      valid: validationErrors.length === 0,
      errors: validationErrors
    },
    session: session
      ? {
          schemaVersion: session.schemaVersion,
          runId: session.run?.id,
          taskId: session.run?.taskId,
          handoffStatus: session.handoff?.status,
          controlSessionId: session.controlSession?.session?.id,
          bridgeReady: session.accessPacket?.audit?.readyForBridge,
          actionBatchEndpoint: session.accessPacket?.endpoints?.actionBatch ?? session.links?.actionBatch,
          executorReportEndpoint: session.accessPacket?.endpoints?.executorReport ?? session.links?.executorReport,
          livestreamId: session.livestream?.id
        }
      : undefined,
    actionBatch: actionBatch
      ? {
          receipt: actionBatch.receipt?.schemaVersion,
          acceptedActions: actionBatch.receipt?.acceptedActions,
          rejectedActions: actionBatch.receipt?.rejectedActions,
          labels: actionBatch.normalizedActionLabels,
          executionPlan: actionBatch.executionPlan
            ? {
                schemaVersion: actionBatch.executionPlan.schemaVersion,
                stepCount: actionBatch.executionPlan.steps.length,
                totalDurationMs: actionBatch.executionPlan.totalDurationMs
              }
            : undefined,
          executorRequest: actionBatch.controllerExecutorRequest
            ? {
                schemaVersion: actionBatch.controllerExecutorRequest.schemaVersion,
                executor: actionBatch.controllerExecutorRequest.executor,
                provider: actionBatch.controllerExecutorRequest.provider,
                stepCount: actionBatch.controllerExecutorRequest.plan?.steps?.length
              }
            : undefined
        }
      : undefined,
    executor: executor
      ? {
          reportStatus: executor.report.status,
          executor: executor.report.executor,
          provider: executor.report.provider,
          plannedStepCount: executor.report.plannedStepCount,
          executedStepCount: executor.report.executedStepCount,
          sideEffects: executor.report.sideEffects,
          submissionSchema: executor.submission.schemaVersion,
          traceExecutorReports: executor.submission.audit?.totals?.executorReports,
          traceVerdict: executor.submission.audit?.verdict
        }
      : undefined,
    trace: trace
      ? {
          status: trace.trace?.status,
          totals: trace.trace?.totals,
          readyForSubmission: trace.trace?.coverage?.readyForSubmission,
          nextActions: trace.trace?.nextActions
        }
      : undefined,
    summary: {
      valid: validationErrors.length === 0,
      executed: config.execute,
      runId: session?.run?.id,
      controlSessionId: session?.controlSession?.session?.id,
      acceptedActions: actionBatch?.receipt?.acceptedActions ?? 0,
      executorReported: Boolean(executor),
      bridgeReady: session?.accessPacket?.audit?.readyForBridge,
      readyForSubmission: trace?.trace?.coverage?.readyForSubmission
    }
  };
}

export { runPublicRunner };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicRunner()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.validation.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
