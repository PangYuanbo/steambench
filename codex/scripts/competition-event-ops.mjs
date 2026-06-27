import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();
const validActions = new Set([
  "inspect-registrations",
  "schedule-suite",
  "run-suite-local",
  "run-campaign-comparisons-local",
  "inspect-event-certificate",
  "advance-event-actions"
]);

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function configFromArgs() {
  const scope = args.get("scope") ?? "weekly";
  if (scope !== "all" && scope !== "daily" && scope !== "weekly") {
    throw new Error("Provide --scope=all|daily|weekly.");
  }
  const execute = args.get("execute") ?? "";
  if (execute && !validActions.has(execute)) {
    throw new Error(`Provide --execute as one of: ${[...validActions].join(", ")}.`);
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    scope,
    suiteId: args.get("suite-id") ?? "",
    execute,
    maxPairs: intArg("max-pairs", 10, { min: 1, max: 25 }),
    maxRaces: intArg("max-races", 5, { min: 1, max: 25 }),
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
  const params = new URLSearchParams();
  if (config.suiteId) params.set("suiteId", config.suiteId);
  return params.toString();
}

function reportPath(config) {
  const query = queryString(config);
  return `/api/competition-events/${encodeURIComponent(config.scope)}/ops-report${query ? `?${query}` : ""}`;
}

function actionRequest(action, config) {
  if (!action) throw new Error("Missing action to execute.");
  if (action.method === "GET") return { method: "GET" };
  const body = {
    ...(action.body ?? {})
  };
  if (action.id === "schedule-suite") {
    body.maxPairs = config.maxPairs;
  }
  if (action.id === "run-suite-local") {
    body.maxRaces = config.maxRaces;
  }
  if (action.id === "run-campaign-comparisons-local") {
    body.maxPairs = config.maxPairs;
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
    entry.id === "schedule-suite" ||
    entry.id === "run-suite-local" ||
    entry.id === "run-campaign-comparisons-local"
  );
}

async function executeEventAction(config, action) {
  return {
    action,
    result: await readJson(config.baseUrl, action?.endpoint, actionRequest(action, config))
  };
}

async function advanceEventActions(config) {
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
    executedActions.push(await executeEventAction(config, action));
  }

  if (!refreshed) {
    refreshed = (await readJson(config.baseUrl, reportPath(config))).report;
  }

  return { executedActions, refreshed };
}

async function runCompetitionEventOps(config = configFromArgs()) {
  let executedActions = [];
  let refreshed;
  if (config.execute === "advance-event-actions") {
    ({ executedActions, refreshed } = await advanceEventActions(config));
  } else {
    const payload = await readJson(config.baseUrl, reportPath(config));
    const action = config.execute
      ? payload.report?.recommendedActions?.find((entry) => entry.id === config.execute)
      : undefined;
    executedActions = config.execute ? [await executeEventAction(config, action)] : [];
    refreshed = executedActions.length > 0
      ? (await readJson(config.baseUrl, reportPath(config))).report
      : payload.report;
  }
  const executedAction = executedActions[0];
  const suiteRunAction = executedActions.find((entry) => entry.action?.id === "run-suite-local");
  const campaignRunAction = executedActions.find((entry) => entry.action?.id === "run-campaign-comparisons-local");
  const certificateAction = executedActions.find((entry) => entry.result?.certificate ?? entry.result?.run?.certificate);
  return {
    schemaVersion: "steambench.competition-event-ops-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    scope: config.scope,
    report: refreshed,
    executedAction,
    executedActions,
    summary: {
      status: refreshed?.status,
      registeredPairs: refreshed?.totals?.registeredPairs,
      scheduledRaces: refreshed?.totals?.scheduledRaces,
      scoredRaces: refreshed?.totals?.scoredRaces,
      campaignComparisons: refreshed?.totals?.campaignComparisons,
      readyForPublicShare: refreshed?.totals?.readyForPublicShare,
      selectedSuite: refreshed?.selectedSuite?.id,
      recommendedActionIds: refreshed?.recommendedActions?.map((entry) => entry.id) ?? [],
      executedActionId: executedAction?.action?.id,
      executedActionIds: executedActions.map((entry) => entry.action?.id),
      executedActionCount: executedActions.length,
      scheduledCount: executedAction?.result?.schedule?.scheduled?.length,
      executedRaces: suiteRunAction?.result?.run?.executed?.length,
      campaignComparisonCount: campaignRunAction?.result?.run?.executed?.length,
      certificateKind: certificateAction?.result?.certificate?.kind ?? certificateAction?.result?.run?.certificate?.kind
    }
  };
}

export { runCompetitionEventOps };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCompetitionEventOps()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
