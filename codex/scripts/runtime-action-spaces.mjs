import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();
const validInputModes = new Set(["keyboard-mouse", "controller", "turn-based-actions"]);
const validTransports = new Set(["local-desktop", "virtual-controller", "structured-turn-api"]);
const validActions = new Set([
  "create-control-run-session",
  "create-agent-run",
  "inspect-control-bridge-docs",
  "inspect-agent-ops",
  "advance-action-space-actions"
]);

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function numberArg(name) {
  const value = args.get(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Provide --${name}=<positive_integer>.`);
  }
  return parsed;
}

function configFromArgs() {
  const inputMode = args.get("input-mode") ?? args.get("inputMode");
  if (inputMode !== undefined && !validInputModes.has(inputMode)) {
    throw new Error(`Provide --input-mode as one of: ${[...validInputModes].join(", ")}.`);
  }
  const transport = args.get("transport");
  if (transport !== undefined && !validTransports.has(transport)) {
    throw new Error(`Provide --transport as one of: ${[...validTransports].join(", ")}.`);
  }
  const execute = args.get("execute") ?? "";
  if (execute && !validActions.has(execute)) {
    throw new Error(`Provide --execute as one of: ${[...validActions].join(", ")}.`);
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    appid: numberArg("appid"),
    agentId: args.get("agent-id") ?? args.get("agentId"),
    inputMode,
    transport,
    limit: intArg("limit", 50, { min: 1, max: 200 }),
    maxSteps: intArg("max-steps", 1, { min: 1, max: 10 }),
    execute
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
  if (config.appid !== undefined) query.set("appid", String(config.appid));
  if (config.agentId) query.set("agentId", config.agentId);
  if (config.inputMode) query.set("inputMode", config.inputMode);
  if (config.transport) query.set("transport", config.transport);
  query.set("limit", String(config.limit));
  return query.toString();
}

function catalogPath(config) {
  return `/api/runtime/action-spaces?${queryString(config)}`;
}

function actionRequest(action) {
  if (!action) throw new Error("Missing action to execute.");
  if (action.method === "GET") return { method: "GET" };
  return {
    method: action.method,
    body: JSON.stringify(action.body ?? {})
  };
}

function actionSignature(action) {
  return `${action.id}:${action.method}:${action.endpoint}`;
}

function nextAutomationAction(catalog) {
  return catalog.recommendedActions?.find((entry) =>
    entry.id === "create-control-run-session" ||
    entry.id === "create-agent-run"
  );
}

async function executeActionSpaceAction(config, action) {
  return {
    action,
    result: await readJson(config.baseUrl, action?.endpoint, actionRequest(action))
  };
}

async function advanceActionSpaceActions(config) {
  const executedActions = [];
  const seen = new Set();
  let refreshed = null;

  for (let step = 0; step < config.maxSteps; step += 1) {
    const payload = await readJson(config.baseUrl, catalogPath(config));
    const action = nextAutomationAction(payload.catalog);
    if (!action) {
      refreshed = payload.catalog;
      break;
    }
    const signature = actionSignature(action);
    if (seen.has(signature)) {
      refreshed = payload.catalog;
      break;
    }
    seen.add(signature);
    executedActions.push(await executeActionSpaceAction(config, action));
  }

  if (!refreshed) {
    refreshed = (await readJson(config.baseUrl, catalogPath(config))).catalog;
  }

  return { executedActions, refreshed };
}

async function runRuntimeActionSpaces(config = configFromArgs()) {
  let executedActions = [];
  let refreshed;
  if (config.execute === "advance-action-space-actions") {
    ({ executedActions, refreshed } = await advanceActionSpaceActions(config));
  } else {
    const payload = await readJson(config.baseUrl, catalogPath(config));
    const catalog = payload.catalog;
    const action = config.execute
      ? catalog.recommendedActions?.find((entry) => entry.id === config.execute)
      : undefined;
    executedActions = config.execute ? [await executeActionSpaceAction(config, action)] : [];
    refreshed = executedActions.length > 0
      ? (await readJson(config.baseUrl, catalogPath(config))).catalog
      : catalog;
  }
  const executedAction = executedActions[0];
  const runAction = executedActions.find((entry) => entry.result?.run);
  const controlAction = executedActions.find((entry) => entry.result?.controlSession);

  return {
    schemaVersion: "steambench.runtime-action-spaces-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    appid: config.appid,
    agentId: config.agentId,
    inputMode: config.inputMode,
    transport: config.transport,
    catalog: refreshed,
    executedAction,
    executedActions,
    summary: {
      tasks: refreshed.totals.tasks,
      controllerTasks: refreshed.totals.controllerTasks,
      virtualControllerTasks: refreshed.totals.virtualControllerTasks,
      bridgeableTasks: refreshed.totals.bridgeableTasks,
      readyForSelectedAgent: refreshed.totals.readyForSelectedAgent,
      blockedForSelectedAgent: refreshed.totals.blockedForSelectedAgent,
      actions: refreshed.recommendedActions.map((entry) => entry.id),
      executedActionId: executedAction?.action?.id,
      executedActionIds: executedActions.map((entry) => entry.action?.id),
      executedActionCount: executedActions.length,
      createdRunId: runAction?.result?.run?.id,
      createdTaskId: runAction?.result?.run?.taskId,
      controlSessionId: controlAction?.result?.controlSession?.session?.id,
      accessPacketReady: controlAction?.result?.accessPacket?.audit?.readyForActions,
      bridgeReady: controlAction?.result?.accessPacket?.audit?.readyForBridge,
      bridgeExecutorCommand: controlAction?.result?.accessPacket?.bridge?.executor?.command,
      bridgeExecutorRequest: controlAction?.result?.accessPacket?.bridge?.executor?.requestSchemaVersion,
      bridgeExecutorReport: controlAction?.result?.accessPacket?.bridge?.executor?.reportSchemaVersion,
      actionBatchEndpoint: controlAction?.result?.accessPacket?.endpoints?.actionBatch,
      bridgeManifestEndpoint: controlAction?.result?.accessPacket?.endpoints?.bridgeManifest,
      executorReportEndpoint: controlAction?.result?.accessPacket?.endpoints?.executorReport
    }
  };
}

export { runRuntimeActionSpaces };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRuntimeActionSpaces()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
