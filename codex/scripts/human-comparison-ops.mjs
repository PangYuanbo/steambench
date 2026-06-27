import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();

const validStatuses = new Set(["complete", "human-incomplete", "agent-incomplete", "incomplete"]);
const validActions = new Set([
  "run-human-campaign-local",
  "inspect-agent-campaign",
  "share-comparison-certificate",
  "inspect-comparison-standings",
  "advance-comparison-actions"
]);

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function configFromArgs() {
  const status = args.get("status");
  if (status !== undefined && !validStatuses.has(status)) {
    throw new Error(`Provide --status as one of: ${[...validStatuses].join(", ")}.`);
  }
  const execute = args.get("execute") ?? "";
  if (execute && !validActions.has(execute)) {
    throw new Error(`Provide --execute as one of: ${[...validActions].join(", ")}.`);
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    status,
    humanUserId: args.get("human-user-id") ?? args.get("humanUserId"),
    agentId: args.get("agent-id") ?? args.get("agentId"),
    campaignId: args.get("campaign-id") ?? args.get("campaignId"),
    limit: intArg("limit", 50, { min: 1, max: 200 }),
    execute,
    maxSteps: intArg("max-steps", 3, { min: 1, max: 10 })
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
  if (config.status) query.set("status", config.status);
  if (config.humanUserId) query.set("humanUserId", config.humanUserId);
  if (config.agentId) query.set("agentId", config.agentId);
  if (config.campaignId) query.set("campaignId", config.campaignId);
  query.set("limit", String(config.limit));
  return query.toString();
}

function actionRequest(action) {
  if (!action) throw new Error("Missing action to execute.");
  if (action.method === "GET") return { method: "GET" };
  return {
    method: action.method,
    body: JSON.stringify(action.body ?? {})
  };
}

function reportPath(config) {
  return `/api/comparisons/human-agent/ops-report?${queryString(config)}`;
}

function actionSignature(action) {
  return `${action.id}:${action.method}:${action.endpoint}`;
}

function nextAutomationAction(report) {
  return report.recommendedActions?.find((entry) =>
    entry.id === "run-human-campaign-local" ||
    entry.id === "share-comparison-certificate"
  );
}

async function executeComparisonAction(config, action) {
  return {
    action,
    result: await readJson(config.baseUrl, action?.endpoint, actionRequest(action))
  };
}

async function advanceComparisonActions(config) {
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
    executedActions.push(await executeComparisonAction(config, action));
  }

  if (!refreshed) {
    refreshed = (await readJson(config.baseUrl, reportPath(config))).report;
  }

  return { executedActions, refreshed };
}

async function runHumanComparisonOps(config = configFromArgs()) {
  let executedActions = [];
  let refreshed;
  if (config.execute === "advance-comparison-actions") {
    ({ executedActions, refreshed } = await advanceComparisonActions(config));
  } else {
    const payload = await readJson(config.baseUrl, reportPath(config));
    const report = payload.report;
    const action = config.execute
      ? report.recommendedActions?.find((entry) => entry.id === config.execute)
      : undefined;
    executedActions = config.execute ? [await executeComparisonAction(config, action)] : [];
    refreshed = executedActions.length > 0
      ? (await readJson(config.baseUrl, reportPath(config))).report
      : report;
  }
  const executedAction = executedActions[0];

  return {
    schemaVersion: "steambench.human-comparison-ops-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    status: config.status,
    humanUserId: config.humanUserId,
    agentId: config.agentId,
    campaignId: config.campaignId,
    report: refreshed,
    executedAction,
    executedActions,
    summary: {
      status: refreshed.status,
      comparisons: refreshed.standings.totals.comparisons,
      completeComparisons: refreshed.standings.totals.completeComparisons,
      incompleteComparisons: refreshed.standings.totals.incompleteComparisons,
      readyForPublicShare: refreshed.standings.totals.readyForPublicShare,
      humanWins: refreshed.standings.totals.humanWins,
      agentWins: refreshed.standings.totals.agentWins,
      ties: refreshed.standings.totals.ties,
      humanScore: refreshed.standings.totals.humanScore,
      agentScore: refreshed.standings.totals.agentScore,
      actions: refreshed.recommendedActions.map((entry) => entry.id),
      executedActionId: executedAction?.action?.id,
      executedActionIds: executedActions.map((entry) => entry.action?.id),
      executedActionCount: executedActions.length,
      certificateKind: executedAction?.result?.certificate?.kind,
      certificateReady: executedAction?.result?.certificate?.integrity?.readyForPublicShare,
      humanCampaignRunStatus: executedAction?.result?.schemaVersion === "steambench.human-campaign-run.v1"
        ? executedAction.result.planAfter?.status
        : undefined
    }
  };
}

export { runHumanComparisonOps };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHumanComparisonOps()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
