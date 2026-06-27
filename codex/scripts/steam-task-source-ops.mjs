import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();

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
  const appid = Number(args.get("appid"));
  if (!Number.isFinite(appid)) throw new Error("Provide --appid=<steam_appid>.");
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    appid,
    useFixture: boolArg("fixture", boolArg("use-fixture", false)),
    refresh: boolArg("refresh", false),
    limit: intArg("limit", 12, { min: 1, max: 50 }),
    gameName: args.get("game-name"),
    execute: args.get("execute") ?? "",
    maxSteps: intArg("max-steps", 3, { min: 1, max: 10 }),
    reviewApproved: boolArg("review-approved", false),
    forceReviewOverride: boolArg("force-review-override", false),
    reviewNotes: args.get("review-notes")
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

function opsQuery(config) {
  const query = new URLSearchParams();
  if (config.useFixture) query.set("useFixture", "true");
  if (config.refresh) query.set("refresh", "true");
  query.set("limit", String(config.limit));
  if (config.gameName) query.set("gameName", config.gameName);
  return query.toString();
}

function actionRequest(action, config) {
  if (!action) throw new Error("Missing action to execute.");
  if (action.method === "GET") return { method: "GET" };
  const body = {
    ...(action.body ?? {}),
    useFixture: config.useFixture,
    refresh: config.refresh,
    limit: config.limit,
    reviewNotes: config.reviewNotes ?? `Steam task source ops ${action.id}.`
  };
  if (config.gameName) body.gameName = config.gameName;
  if (action.id === "publish-candidates") {
    body.reviewApproved = config.reviewApproved;
    body.forceReviewOverride = config.forceReviewOverride;
  }
  return {
    method: action.method,
    body: JSON.stringify(body)
  };
}

function nextWritableAction(ops) {
  return ops.recommendedActions?.find((entry) => entry.method === "POST");
}

async function loadOps(config) {
  const appPath = `/api/steam/apps/${encodeURIComponent(config.appid)}`;
  return readJson(config.baseUrl, `${appPath}/task-source-ops?${opsQuery(config)}`);
}

async function executeOpsAction(config, action) {
  return {
    action,
    result: await readJson(config.baseUrl, action?.endpoint, actionRequest(action, config))
  };
}

async function advanceSourceActions(config) {
  const executedActions = [];
  let refreshedPayload = null;

  for (let step = 0; step < config.maxSteps; step += 1) {
    const payload = await loadOps(config);
    const action = nextWritableAction(payload.ops);
    if (!action) {
      refreshedPayload = payload;
      break;
    }
    executedActions.push(await executeOpsAction(config, action));
  }

  if (!refreshedPayload) {
    refreshedPayload = await loadOps(config);
  }

  return { executedActions, refreshedPayload };
}

function sumImportCount(executedActions) {
  return executedActions.reduce((total, entry) => {
    const imported = entry.result?.importRun?.imported ?? entry.result?.importRun?.totals?.imported ?? 0;
    return total + Number(imported ?? 0);
  }, 0);
}

function sumPublicationCount(executedActions, key) {
  return executedActions.reduce((total, entry) => total + (entry.result?.publication?.[key]?.length ?? 0), 0);
}

async function runSteamTaskSourceOps(config = configFromArgs()) {
  let executedActions = [];
  let refreshedPayload = null;
  if (config.execute === "advance-source-actions") {
    ({ executedActions, refreshedPayload } = await advanceSourceActions(config));
  } else {
    const payload = await loadOps(config);
    const ops = payload.ops;
    const action = config.execute
      ? ops.recommendedActions?.find((entry) => entry.id === config.execute)
      : undefined;
    executedActions = config.execute ? [await executeOpsAction(config, action)] : [];
    refreshedPayload = executedActions.length > 0 ? await loadOps(config) : payload;
  }
  const executedAction = executedActions[0];
  const refreshedOps = refreshedPayload.ops;

  return {
    schemaVersion: "steambench.steam-task-source-ops-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    appid: config.appid,
    useFixture: config.useFixture,
    refresh: config.refresh,
    ops: refreshedOps,
    executedAction,
    executedActions,
    summary: {
      status: refreshedOps.status,
      sourceRecords: refreshedOps.totals.sourceRecords,
      newImportsAvailable: refreshedOps.totals.newImportsAvailable,
      publishableCandidates: refreshedOps.totals.publishableCandidates,
      active: refreshedOps.registry.active,
      candidates: refreshedOps.registry.candidates,
      actions: refreshedOps.recommendedActions.map((entry) => entry.id),
      executedActionId: executedAction?.action?.id,
      executedActionIds: executedActions.map((entry) => entry.action?.id),
      executedActionCount: executedActions.length,
      imported: sumImportCount(executedActions),
      proposed: executedAction?.result?.importRun?.proposed,
      published: sumPublicationCount(executedActions, "published"),
      blocked: sumPublicationCount(executedActions, "blocked")
    },
    warnings: refreshedPayload.warnings
  };
}

export { runSteamTaskSourceOps };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSteamTaskSourceOps()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
