import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();
const validActions = new Set([
  "start-scheduled-broadcast",
  "end-live-broadcast",
  "inspect-proof-missing-broadcast",
  "share-broadcast-certificate",
  "inspect-broadcast-center",
  "advance-broadcast-actions"
]);

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function configFromArgs() {
  const execute = args.get("execute") ?? "";
  if (execute && !validActions.has(execute)) {
    throw new Error(`Provide --execute as one of: ${[...validActions].join(", ")}.`);
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    status: args.get("status"),
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
  return `/api/broadcasts/ops-report?${queryString(config)}`;
}

function actionSignature(action) {
  return `${action.id}:${action.method}:${action.endpoint}`;
}

function nextAutomationAction(report) {
  return report.recommendedActions?.find((entry) =>
    entry.id === "start-scheduled-broadcast" ||
    entry.id === "end-live-broadcast" ||
    entry.id === "share-broadcast-certificate"
  );
}

async function executeBroadcastAction(config, action) {
  return {
    action,
    result: await readJson(config.baseUrl, action?.endpoint, actionRequest(action))
  };
}

async function advanceBroadcastActions(config) {
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
    executedActions.push(await executeBroadcastAction(config, action));
  }

  if (!refreshed) {
    refreshed = (await readJson(config.baseUrl, reportPath(config))).report;
  }

  return { executedActions, refreshed };
}

async function runBroadcastOps(config = configFromArgs()) {
  let executedActions = [];
  let refreshed;
  if (config.execute === "advance-broadcast-actions") {
    ({ executedActions, refreshed } = await advanceBroadcastActions(config));
  } else {
    const payload = await readJson(config.baseUrl, reportPath(config));
    const report = payload.report;
    const action = config.execute
      ? report.recommendedActions?.find((entry) => entry.id === config.execute)
      : undefined;
    executedActions = config.execute ? [await executeBroadcastAction(config, action)] : [];
    refreshed = executedActions.length > 0
      ? (await readJson(config.baseUrl, reportPath(config))).report
      : report;
  }
  const executedAction = executedActions[0];
  const certificateAction = executedActions.find((entry) => entry.result?.certificate);
  return {
    schemaVersion: "steambench.broadcast-ops-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    report: refreshed,
    executedAction,
    executedActions,
    summary: {
      status: refreshed.status,
      broadcasts: refreshed.totals.broadcasts,
      selectedBroadcasts: refreshed.totals.selectedBroadcasts,
      live: refreshed.totals.live,
      scheduled: refreshed.totals.scheduled,
      failed: refreshed.totals.failed,
      scoreboardReady: refreshed.totals.scoreboardReady,
      proofMissing: refreshed.totals.proofMissing,
      viewers: refreshed.totals.viewers,
      actions: refreshed.recommendedActions.map((entry) => entry.id),
      executedActionId: executedAction?.action?.id,
      executedActionIds: executedActions.map((entry) => entry.action?.id),
      executedActionCount: executedActions.length,
      streamId: executedAction?.result?.stream?.id ?? executedAction?.result?.certificate?.id,
      streamStatus: executedAction?.result?.stream?.status,
      certificateKind: certificateAction?.result?.certificate?.kind,
      readyForPublicShare: certificateAction?.result?.certificate?.integrity?.readyForPublicShare
    }
  };
}

export { runBroadcastOps };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBroadcastOps()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
