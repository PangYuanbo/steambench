import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();

const validStatuses = new Set([
  "scoreboard-ready",
  "proof-missing",
  "scoreboard-missing",
  "row-inconsistent",
  "orphan-row",
  "in-progress",
  "failed"
]);
const validActions = new Set([
  "republish-scoreboard-row",
  "inspect-proof-missing-run",
  "inspect-scoreboard-inconsistency",
  "share-standings",
  "inspect-standings",
  "advance-scoreboard-actions"
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
  const appid = args.get("appid") === undefined ? undefined : Number(args.get("appid"));
  if (appid !== undefined && (!Number.isInteger(appid) || appid <= 0)) {
    throw new Error("Provide --appid as a positive integer.");
  }
  const execute = args.get("execute") ?? "";
  if (execute && !validActions.has(execute)) {
    throw new Error(`Provide --execute as one of: ${[...validActions].join(", ")}.`);
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    status,
    appid,
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
  if (config.appid !== undefined) query.set("appid", String(config.appid));
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
  return `/api/scoreboard/ops-report?${queryString(config)}`;
}

function actionSignature(action) {
  return `${action.id}:${action.method}:${action.endpoint}`;
}

function nextAutomationAction(report) {
  return report.recommendedActions?.find((entry) =>
    entry.id === "republish-scoreboard-row" ||
    entry.id === "share-standings"
  );
}

async function executeScoreboardAction(config, action) {
  return {
    action,
    result: await readJson(config.baseUrl, action?.endpoint, actionRequest(action))
  };
}

async function advanceScoreboardActions(config) {
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
    executedActions.push(await executeScoreboardAction(config, action));
  }

  if (!refreshed) {
    refreshed = (await readJson(config.baseUrl, reportPath(config))).report;
  }

  return { executedActions, refreshed };
}

async function runScoreboardOps(config = configFromArgs()) {
  let executedActions = [];
  let refreshed;
  if (config.execute === "advance-scoreboard-actions") {
    ({ executedActions, refreshed } = await advanceScoreboardActions(config));
  } else {
    const payload = await readJson(config.baseUrl, reportPath(config));
    const report = payload.report;
    const action = config.execute
      ? report.recommendedActions?.find((entry) => entry.id === config.execute)
      : undefined;
    executedActions = config.execute ? [await executeScoreboardAction(config, action)] : [];
    refreshed = executedActions.length > 0
      ? (await readJson(config.baseUrl, reportPath(config))).report
      : report;
  }
  const executedAction = executedActions[0];
  return {
    schemaVersion: "steambench.scoreboard-ops-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    status: config.status,
    appid: config.appid,
    report: refreshed,
    executedAction,
    executedActions,
    summary: {
      status: refreshed.status,
      runs: refreshed.totals.runs,
      scoreboardRows: refreshed.totals.scoreboardRows,
      selectedTickets: refreshed.totals.selectedTickets,
      scoreboardReady: refreshed.totals.scoreboardReady,
      proofMissing: refreshed.totals.proofMissing,
      scoreboardMissing: refreshed.totals.scoreboardMissing,
      rowInconsistent: refreshed.totals.rowInconsistent,
      orphanRows: refreshed.totals.orphanRows,
      actions: refreshed.recommendedActions.map((entry) => entry.id),
      executedActionId: executedAction?.action?.id,
      executedActionIds: executedActions.map((entry) => entry.action?.id),
      executedActionCount: executedActions.length,
      publishedRunId: executedAction?.result?.run?.id,
      publishedRank: executedAction?.result?.row?.rank,
      publishedScore: executedAction?.result?.row?.score,
      sharedStandings: executedActions.some((entry) => entry.action?.id === "share-standings"),
      standingsCompetitors: executedActions
        .find((entry) => entry.result?.standings?.competitors)
        ?.result?.standings?.competitors?.length
    }
  };
}

export { runScoreboardOps };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScoreboardOps()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
