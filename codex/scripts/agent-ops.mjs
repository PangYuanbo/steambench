import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();
const validActions = new Set([
  "open-agent-run-session",
  "create-agent-campaign",
  "activate-agent",
  "inspect-agent-lab",
  "inspect-failed-agent-run",
  "drain-dispatches",
  "advance-agent-actions"
]);

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function boolArg(name, fallback = false) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function configFromArgs() {
  const provider = args.get("provider");
  if (provider !== undefined && provider !== "local" && provider !== "modal") {
    throw new Error("Provide --provider=local or --provider=modal.");
  }
  const execute = args.get("execute") ?? "";
  if (execute && !validActions.has(execute)) {
    throw new Error(`Provide --execute as one of: ${[...validActions].join(", ")}.`);
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    provider,
    limit: intArg("limit", 50, { min: 1, max: 200 }),
    execute,
    maxSteps: intArg("max-steps", 2, { min: 1, max: 10 }),
    campaignLimit: intArg("campaign-limit", intArg("campaignLimit", 3, { min: 1, max: 10 }), { min: 1, max: 10 }),
    dispatch: boolArg("dispatch", true),
    reviewApproved: boolArg("review-approved", false),
    ttlSeconds: intArg("ttl-seconds", 900, { min: 30, max: 3600 }),
    createControlSession: boolArg("create-control-session", true),
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

function queryString(config) {
  const query = new URLSearchParams();
  if (config.provider) query.set("provider", config.provider);
  query.set("limit", String(config.limit));
  return query.toString();
}

function reportPath(config) {
  return `/api/agents/ops-report?${queryString(config)}`;
}

function actionRequest(action, config) {
  if (!action) throw new Error("Missing action to execute.");
  if (action.method === "CLI") {
    throw new Error(`Action ${action.id} is a CLI handoff; run: ${action.command}`);
  }
  if (action.method === "GET") return { method: "GET" };
  const body = { ...(action.body ?? {}) };
  if (action.id === "create-agent-campaign") {
    body.limit = config.campaignLimit;
    body.dispatch = config.dispatch;
    body.reviewApproved = config.reviewApproved;
    if (config.provider) body.provider = config.provider;
  }
  if (action.id === "open-agent-run-session") {
    body.ttlSeconds = config.ttlSeconds;
    body.createControlSession = config.createControlSession;
    if (config.idempotencyKey) body.idempotencyKey = config.idempotencyKey;
  }
  return {
    method: action.method,
    body: JSON.stringify(body)
  };
}

function actionSignature(action) {
  return `${action.id}:${action.method}:${action.endpoint}`;
}

function nextAutomationAction(report) {
  return report.recommendedActions?.find((entry) =>
    entry.id === "open-agent-run-session" ||
    entry.id === "create-agent-campaign" ||
    entry.id === "activate-agent"
  );
}

async function executeAgentAction(config, action) {
  return {
    action,
    result: await readJson(config.baseUrl, action?.endpoint, actionRequest(action, config))
  };
}

async function advanceAgentActions(config) {
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
    executedActions.push(await executeAgentAction(config, action));
  }

  if (!refreshed) {
    refreshed = (await readJson(config.baseUrl, reportPath(config))).report;
  }

  return { executedActions, refreshed };
}

async function runAgentOps(config = configFromArgs()) {
  let executedActions = [];
  let refreshed;
  if (config.execute === "advance-agent-actions") {
    ({ executedActions, refreshed } = await advanceAgentActions(config));
  } else {
    const payload = await readJson(config.baseUrl, reportPath(config));
    const report = payload.report;
    const action = config.execute
      ? report.recommendedActions?.find((entry) => entry.id === config.execute)
      : undefined;
    executedActions = config.execute ? [await executeAgentAction(config, action)] : [];
    refreshed = executedActions.length > 0
      ? (await readJson(config.baseUrl, reportPath(config))).report
      : report;
  }
  const executedAction = executedActions[0];
  const campaignAction = executedActions.find((entry) => entry.action?.id === "create-agent-campaign");
  const runSessionAction = executedActions.find((entry) => entry.action?.id === "open-agent-run-session");
  const activateAction = executedActions.find((entry) => entry.action?.id === "activate-agent");
  return {
    schemaVersion: "steambench.agent-ops-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    provider: config.provider,
    report: refreshed,
    executedAction,
    executedActions,
    summary: {
      status: refreshed.status,
      agents: refreshed.totals.agents,
      active: refreshed.totals.active,
      paused: refreshed.totals.paused,
      readyForCampaign: refreshed.totals.readyForCampaign,
      queuedAgents: refreshed.totals.queuedAgents,
      queuedRuns: refreshed.totals.queuedRuns,
      activeRuns: refreshed.totals.activeRuns,
      failedRuns: refreshed.totals.failedRuns,
      actions: refreshed.recommendedActions.map((entry) => entry.id),
      executedActionId: executedAction?.action?.id,
      executedActionIds: executedActions.map((entry) => entry.action?.id),
      executedActionCount: executedActions.length,
      campaignId: campaignAction?.result?.campaign?.id,
      campaignRunCount: campaignAction?.result?.campaign?.runCount,
      campaignDispatchCount: campaignAction?.result?.campaign?.dispatchCount,
      runSessionId: runSessionAction?.result?.run?.id,
      runSessionTaskId: runSessionAction?.result?.run?.taskId,
      runSessionStatus: runSessionAction?.result?.handoff?.status,
      runSessionControlId: runSessionAction?.result?.controlSession?.session?.id,
      runSessionAccessPacketReady: runSessionAction?.result?.accessPacket?.audit?.readyForActions,
      runSessionBridgeReady: runSessionAction?.result?.accessPacket?.audit?.readyForBridge,
      activatedAgentId: activateAction?.result?.agent?.id
    }
  };
}

export { runAgentOps };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAgentOps()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
