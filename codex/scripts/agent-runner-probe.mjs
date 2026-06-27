import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();
const validExecuteModes = new Set(["inspect", "create-control-session", "submit-action-batch", "advance-probe"]);

function boolArg(config, name, fallback = false) {
  const value = config.args?.get(name);
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function intArg(config, name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = config.args?.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function configFromArgs(cliArgs = args) {
  const runId = cliArgs.get("run");
  const taskId = cliArgs.get("task") ?? cliArgs.get("taskId");
  const execute = cliArgs.get("execute") ?? "inspect";
  if (!validExecuteModes.has(execute)) {
    throw new Error(`Provide --execute as one of: ${[...validExecuteModes].join(", ")}.`);
  }
  if (!runId && !taskId) {
    throw new Error("Provide --run=<run_id> or --task=<task_id>.");
  }
  if (!runId && execute === "inspect") {
    throw new Error("Default --execute=inspect is read-only and requires --run=<run_id>; pass --execute=advance-probe to create a run from --task.");
  }
  const competitorType = cliArgs.get("competitor-type") === "human" ? "human" : "agent";
  const runtimeProvider = cliArgs.get("runtime-provider") ?? (competitorType === "human" ? "manual" : "local-sim");
  if (runtimeProvider !== "manual" && runtimeProvider !== "local-sim" && runtimeProvider !== "modal") {
    throw new Error("Provide --runtime-provider=manual, local-sim, or modal.");
  }
  return {
    args: cliArgs,
    baseUrl: cliArgs.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    execute,
    runId,
    taskId,
    agentId: cliArgs.get("agent") ?? cliArgs.get("agentId"),
    competitor: cliArgs.get("competitor") ?? "agent-probe",
    competitorType,
    runtimeProvider,
    observation: cliArgs.get("observation") ?? "Agent probe observed the task action space.",
    checkpoint: cliArgs.get("checkpoint") ?? "Agent probe submitted a valid action batch.",
    actionFile: cliArgs.get("actions"),
    idempotencyKey: cliArgs.get("idempotency-key"),
    controlSession: cliArgs.get("control-session") ?? "auto",
    ttlSeconds: intArg({ args: cliArgs }, "ttl-seconds", 900, { min: 30, max: 3600 }),
    confidence: Number(cliArgs.get("confidence") ?? 0.7),
    step: intArg({ args: cliArgs }, "step", 1, { min: 1, max: 10000 }),
    dryRun: boolArg({ args: cliArgs }, "dry-run", false)
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

async function loadActions(config, playbook) {
  if (!config.actionFile) return playbook.control.actionSpace.examples;
  const raw = await readFile(config.actionFile, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.actions)) return parsed.actions;
  throw new Error(`Action file ${config.actionFile} must be a JSON array or an object with an actions array.`);
}

function shouldCreateControlSession(config, playbook) {
  if (config.controlSession === "false" || config.controlSession === "0" || config.controlSession === "no") return false;
  if (config.controlSession === "true" || config.controlSession === "1" || config.controlSession === "yes") return true;
  return playbook.control.actionSpace.transport === "virtual-controller";
}

async function resolveRun(config) {
  if (config.runId) {
    const detail = await readJson(config.baseUrl, `/api/runs/${encodeURIComponent(config.runId)}`);
    return {
      created: false,
      run: detail.run,
      task: detail.task
    };
  }
  if ((config.execute ?? "inspect") === "inspect") {
    throw new Error("Read-only agent probe inspect requires an existing --run id.");
  }
  const payload = await readJson(config.baseUrl, "/api/runs", {
    method: "POST",
    body: JSON.stringify({
      taskId: config.taskId,
      competitor: config.competitor,
      competitorType: config.competitorType,
      runtimeProvider: config.runtimeProvider
    })
  });
  return {
    created: true,
    run: payload.run
  };
}

async function runAgentProbe(config = configFromArgs()) {
  const execute = config.execute ?? "inspect";
  if (!validExecuteModes.has(execute)) {
    throw new Error(`Provide execute as one of: ${[...validExecuteModes].join(", ")}.`);
  }
  const resolved = await resolveRun(config);
  const runId = resolved.run.id;
  const playbookPath = `/api/runs/${encodeURIComponent(runId)}/agent-playbook${config.agentId ? `?agentId=${encodeURIComponent(config.agentId)}` : ""}`;
  const playbookPayload = await readJson(config.baseUrl, playbookPath);
  const playbook = playbookPayload.playbook;
  const actions = await loadActions(config, playbook);
  const shouldGrantControl = execute === "create-control-session" ||
    execute === "advance-probe" ||
    (execute === "submit-action-batch" && shouldCreateControlSession(config, playbook));
  const controlSession = shouldGrantControl
    ? (await readJson(config.baseUrl, `/api/runs/${encodeURIComponent(runId)}/control-sessions`, {
        method: "POST",
        body: JSON.stringify({
          agentId: config.agentId,
          ttlSeconds: config.ttlSeconds,
          idempotencyKey: config.idempotencyKey ? `${config.idempotencyKey}:control-session` : undefined,
          summary: "Agent probe granted a bounded runtime control lease."
        })
      })).session
    : undefined;

  let actionBatch;
  if ((execute === "submit-action-batch" || execute === "advance-probe") && !config.dryRun) {
    actionBatch = await readJson(config.baseUrl, playbook.eventContract.actionBatchEndpoint, {
      method: "POST",
      body: JSON.stringify({
        controlSessionId: controlSession?.id,
        step: config.step,
        observation: config.observation,
        actions,
        checkpoint: config.checkpoint,
        confidence: Number.isFinite(config.confidence) ? config.confidence : 0.7,
        source: "agent-runner-probe",
        idempotencyKey: config.idempotencyKey ?? `agent-probe:${runId}:${Date.now().toString(36)}`
      })
    });
  }
  const tracePayload = await readJson(config.baseUrl, `/api/runs/${encodeURIComponent(runId)}/agent-trace`);
  return {
    schemaVersion: "steambench.agent-runner-probe-result.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    execute,
    dryRun: config.dryRun,
    createdRun: resolved.created,
    run: {
      id: runId,
      status: resolved.run.status,
      competitor: resolved.run.competitor,
      competitorType: resolved.run.competitorType
    },
    playbook: {
      schemaVersion: playbook.schemaVersion,
      inputMode: playbook.control.inputMode,
      transport: playbook.control.actionSpace.transport,
      allowedActionTypes: playbook.control.allowedActionTypes,
      actionBatchEndpoint: playbook.eventContract.actionBatchEndpoint,
      submissionEndpoint: playbook.eventContract.submissionEndpoint,
      canonicalArtifact: playbook.evidence.canonicalArtifact
    },
    controlSession: controlSession
      ? {
          id: controlSession.id,
          status: controlSession.status,
          transport: controlSession.actionSpace?.transport,
          expiresAt: controlSession.expiresAt
        }
      : undefined,
    actionBatch: actionBatch
      ? {
          acceptedActions: actionBatch.normalizedActionLabels,
          actionCount: actionBatch.normalizedActions.length,
          executionPlan: actionBatch.executionPlan
            ? {
                schemaVersion: actionBatch.executionPlan.schemaVersion,
                totalDurationMs: actionBatch.executionPlan.totalDurationMs,
                stepCount: actionBatch.executionPlan.steps.length
              }
            : undefined
        }
      : undefined,
    trace: {
      status: tracePayload.trace.status,
      totals: tracePayload.trace.totals,
      coverage: tracePayload.trace.coverage,
      nextActions: tracePayload.trace.nextActions
    }
  };
}

export { runAgentProbe };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAgentProbe()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
