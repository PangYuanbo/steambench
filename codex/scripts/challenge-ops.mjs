import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();

const validStatuses = new Set([
  "open",
  "accepted",
  "running",
  "scoreboard-ready",
  "evidence-missing",
  "blocked",
  "declined",
  "canceled",
  "failed"
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
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    status,
    limit: intArg("limit", 50, { min: 1, max: 200 }),
    execute: args.get("execute") ?? "",
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
  return `/api/challenges/ops-report?${queryString(config)}`;
}

function actionSignature(action) {
  return `${action.id}:${action.method}:${action.endpoint}`;
}

function nextAutomationAction(report) {
  return report.recommendedActions?.find((entry) => entry.id !== "inspect-challenges");
}

async function executeChallengeAction(config, action) {
  return {
    action,
    result: await readJson(config.baseUrl, action?.endpoint, actionRequest(action))
  };
}

async function advanceChallengeActions(config) {
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
    executedActions.push(await executeChallengeAction(config, action));
  }

  if (!refreshed) {
    refreshed = (await readJson(config.baseUrl, reportPath(config))).report;
  }

  return { executedActions, refreshed };
}

async function runChallengeOps(config = configFromArgs()) {
  let executedActions = [];
  let refreshed;
  if (config.execute === "advance-challenge-actions") {
    ({ executedActions, refreshed } = await advanceChallengeActions(config));
  } else {
    const payload = await readJson(config.baseUrl, reportPath(config));
    const report = payload.report;
    const action = config.execute
      ? report.recommendedActions?.find((entry) => entry.id === config.execute)
      : undefined;
    executedActions = config.execute ? [await executeChallengeAction(config, action)] : [];
    refreshed = executedActions.length > 0
      ? (await readJson(config.baseUrl, reportPath(config))).report
      : report;
  }
  const executedAction = executedActions[0];
  return {
    schemaVersion: "steambench.challenge-ops-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    status: config.status,
    report: refreshed,
    executedAction,
    executedActions,
    summary: {
      status: refreshed.status,
      challenges: refreshed.totals.challenges,
      selectedTickets: refreshed.totals.selectedTickets,
      open: refreshed.totals.open,
      accepted: refreshed.totals.accepted,
      running: refreshed.totals.running,
      scoreboardReady: refreshed.totals.scoreboardReady,
      evidenceMissing: refreshed.totals.evidenceMissing,
      blocked: refreshed.totals.blocked,
      failed: refreshed.totals.failed,
      scoreboardRows: refreshed.totals.scoreboardRows,
      actions: refreshed.recommendedActions.map((entry) => entry.id),
      executedActionId: executedAction?.action?.id,
      executedActionIds: executedActions.map((entry) => entry.action?.id),
      executedActionCount: executedActions.length,
      challengeId: executedAction?.result?.challenge?.id,
      challengeStatus: executedAction?.result?.challenge?.status,
      matchId: executedAction?.result?.match?.id,
      matchStatus: executedAction?.result?.match?.status,
      certificateKind: executedAction?.result?.certificate?.kind,
      readyForPublicShare: executedAction?.result?.certificate?.integrity?.readyForPublicShare
    }
  };
}

export { runChallengeOps };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runChallengeOps()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
