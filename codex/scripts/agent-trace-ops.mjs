import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();
const validVerdicts = new Set([
  "trace-ready",
  "needs-actions",
  "needs-control-session",
  "needs-executor-report",
  "invalid"
]);
const validActions = new Set([
  "create-control-session",
  "submit-action-batch",
  "run-bridge-executor",
  "inspect-invalid-trace",
  "inspect-agent-handoff",
  "advance-trace-actions"
]);

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function configFromArgs() {
  const verdict = args.get("verdict");
  if (verdict !== undefined && !validVerdicts.has(verdict)) {
    throw new Error(`Provide --verdict as one of: ${[...validVerdicts].join(", ")}.`);
  }
  const execute = args.get("execute") ?? "";
  if (execute && !validActions.has(execute)) {
    throw new Error(`Provide --execute as one of: ${[...validActions].join(", ")}.`);
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    verdict,
    limit: intArg("limit", 50, { min: 1, max: 200 }),
    execute,
    maxSteps: intArg("max-steps", 1, { min: 1, max: 10 }),
    ttlSeconds: intArg("ttl-seconds", intArg("ttlSeconds", 900, { min: 30, max: 3600 }), { min: 30, max: 3600 }),
    idempotencyKey: args.get("idempotency-key") ?? args.get("idempotencyKey")
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

function queryString(config) {
  const query = new URLSearchParams();
  if (config.verdict) query.set("verdict", config.verdict);
  query.set("limit", String(config.limit));
  return query.toString();
}

function reportPath(config) {
  return `/api/agent-traces/ops-report?${queryString(config)}`;
}

function actionRequest(action, config) {
  if (!action) throw new Error("Missing action to execute.");
  if (action.method === "CLI") {
    throw new Error(`Action ${action.id} is a CLI handoff; run: ${action.command}`);
  }
  if (action.method === "GET") return { method: "GET" };
  if (action.id === "submit-action-batch" && !action.body) {
    throw new Error("Action submit-action-batch requires an explicit action batch payload; inspect the agent handoff or use bridge:control.");
  }
  const body = { ...(action.body ?? {}) };
  if (action.id === "create-control-session") {
    body.ttlSeconds = config.ttlSeconds;
    if (config.idempotencyKey) body.idempotencyKey = config.idempotencyKey;
  }
  return {
    method: action.method,
    body: JSON.stringify(body)
  };
}

function actionSignature(action) {
  return `${action.id}:${action.method}:${action.endpoint ?? action.command}`;
}

function nextAutomationAction(report) {
  return report.recommendedActions?.find((entry) => entry.id === "create-control-session");
}

async function executeTraceAction(config, action) {
  return {
    action,
    result: await readJson(config.baseUrl, action?.endpoint, actionRequest(action, config))
  };
}

async function advanceTraceActions(config) {
  const executedActions = [];
  const seen = new Set();
  let refreshed = null;

  for (let step = 0; step < config.maxSteps; step += 1) {
    const payload = await readJson(config.baseUrl, reportPath(config));
    const action = nextAutomationAction(payload.report);
    if (!action) {
      refreshed = payload.report;
      break;
    }
    const signature = actionSignature(action);
    if (seen.has(signature)) {
      refreshed = payload.report;
      break;
    }
    seen.add(signature);
    executedActions.push(await executeTraceAction(config, action));
  }

  if (!refreshed) {
    refreshed = (await readJson(config.baseUrl, reportPath(config))).report;
  }

  return { executedActions, refreshed };
}

async function runAgentTraceOps(config = configFromArgs()) {
  let executedActions = [];
  let refreshed;
  if (config.execute === "advance-trace-actions") {
    ({ executedActions, refreshed } = await advanceTraceActions(config));
  } else {
    const payload = await readJson(config.baseUrl, reportPath(config));
    const report = payload.report;
    const action = config.execute
      ? report.recommendedActions?.find((entry) => entry.id === config.execute)
      : undefined;
    executedActions = config.execute ? [await executeTraceAction(config, action)] : [];
    refreshed = executedActions.length > 0
      ? (await readJson(config.baseUrl, reportPath(config))).report
      : report;
  }
  const executedAction = executedActions[0];
  const controlAction = executedActions.find((entry) => entry.action?.id === "create-control-session");
  return {
    schemaVersion: "steambench.agent-trace-ops-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    verdict: config.verdict,
    report: refreshed,
    executedAction,
    executedActions,
    summary: {
      status: refreshed.status,
      agentRuns: refreshed.totals.agentRuns,
      selectedRuns: refreshed.totals.selectedRuns,
      traceReady: refreshed.totals.traceReady,
      needsActions: refreshed.totals.needsActions,
      needsControlSession: refreshed.totals.needsControlSession,
      needsExecutorReport: refreshed.totals.needsExecutorReport,
      invalid: refreshed.totals.invalid,
      actions: refreshed.totals.actions,
      controlSessions: refreshed.totals.controlSessions,
      executorReports: refreshed.totals.executorReports,
      actionsRecommended: refreshed.recommendedActions.map((action) => action.id),
      executedActionId: executedAction?.action?.id,
      executedActionIds: executedActions.map((entry) => entry.action?.id),
      executedActionCount: executedActions.length,
      controlSessionId: controlAction?.result?.session?.id,
      controlSessionRunId: controlAction?.result?.session?.runId,
      controlSessionStatus: controlAction?.result?.session?.status
    }
  };
}

export { runAgentTraceOps };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAgentTraceOps()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
