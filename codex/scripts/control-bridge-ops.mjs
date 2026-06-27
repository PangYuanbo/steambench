import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();
const validActions = new Set([
  "run-control-bridge",
  "inspect-bridge-manifest",
  "heartbeat-control-session",
  "revoke-expired-control-session",
  "advance-control-bridge-actions"
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
    status: args.get("status") ?? "",
    transport: args.get("transport") ?? "",
    limit: intArg("limit", 50, { min: 1, max: 200 }),
    execute,
    maxSteps: intArg("max-steps", 2, { min: 1, max: 10 }),
    executor: args.get("executor") ?? "audit",
    actions: args.get("actions"),
    observation: args.get("observation") ?? "Control bridge ops observed a playable state.",
    executorCommand: args.get("executor-command") ?? args.get("executorCommand"),
    executorArgs: args.get("executor-args") ?? args.get("executorArgs"),
    executorTimeoutMs: args.get("executor-timeout-ms") ?? args.get("executorTimeoutMs"),
    dryRun: args.get("dry-run") === "1" || args.get("dry-run") === "true",
    revoke: args.get("revoke") === "1" || args.get("revoke") === "true"
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
  const params = new URLSearchParams({
    limit: String(config.limit)
  });
  if (config.status) params.set("status", config.status);
  if (config.transport) params.set("transport", config.transport);
  return params.toString();
}

function reportPath(config) {
  return `/api/control-sessions/ops-report?${queryString(config)}`;
}

function actionRequest(action) {
  if (!action) throw new Error("Missing action to execute.");
  if (action.method === "GET") return { method: "GET" };
  if (action.method === "POST") {
    return {
      method: "POST",
      body: JSON.stringify(action.body ?? {})
    };
  }
  throw new Error(`Action ${action.id} is a CLI handoff.`);
}

function sessionFromBridgeAction(action) {
  const match = action?.command?.match(/--session=([^\s]+)/);
  if (!match) throw new Error(`Action ${action?.id ?? "unknown"} is missing a bridge session handoff.`);
  return match[1];
}

async function runBridgeExecutor(action, config) {
  const sessionId = sessionFromBridgeAction(action);
  const childArgs = [
    "scripts/control-bridge-runner.mjs",
    `--api=${config.baseUrl}`,
    `--session=${sessionId}`,
    `--executor=${config.executor}`,
    `--observation=${config.observation}`
  ];
  if (config.actions) childArgs.push(`--actions=${config.actions}`);
  if (config.executorCommand) childArgs.push(`--executor-command=${config.executorCommand}`);
  if (config.executorArgs) childArgs.push(`--executor-args=${config.executorArgs}`);
  if (config.executorTimeoutMs) childArgs.push(`--executor-timeout-ms=${config.executorTimeoutMs}`);
  if (config.dryRun) childArgs.push("--dry-run=true");
  if (config.revoke) childArgs.push("--revoke=true");
  const child = spawn(process.execPath, childArgs, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exit = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  if (exit.code !== 0) {
    throw new Error(`bridge runner failed with ${exit.code ?? exit.signal}:\n${stdout}\n${stderr}`);
  }
  return JSON.parse(stdout);
}

async function executeAction(action, config) {
  if (!action) throw new Error("Missing action to execute.");
  if (action.id === "run-control-bridge") {
    return runBridgeExecutor(action, config);
  }
  return readJson(config.baseUrl, action.endpoint, actionRequest(action));
}

function actionSignature(action) {
  return `${action.id}:${action.method}:${action.endpoint ?? action.command}`;
}

function nextAutomationAction(report) {
  return report.recommendedActions?.find((entry) =>
    entry.id === "run-control-bridge" ||
    entry.id === "heartbeat-control-session" ||
    entry.id === "revoke-expired-control-session"
  );
}

async function executeBridgeAction(config, action) {
  return {
    action,
    result: await executeAction(action, config)
  };
}

async function advanceControlBridgeActions(config) {
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
    executedActions.push(await executeBridgeAction(config, action));
  }

  if (!refreshed) {
    refreshed = (await readJson(config.baseUrl, reportPath(config))).report;
  }

  return { executedActions, refreshed };
}

async function runControlBridgeOps(config = configFromArgs()) {
  let executedActions = [];
  let refreshed;
  if (config.execute === "advance-control-bridge-actions") {
    ({ executedActions, refreshed } = await advanceControlBridgeActions(config));
  } else {
    const payload = await readJson(config.baseUrl, reportPath(config));
    const report = payload.report;
    const action = config.execute
      ? report.recommendedActions?.find((entry) => entry.id === config.execute)
      : undefined;
    executedActions = config.execute ? [await executeBridgeAction(config, action)] : [];
    refreshed = executedActions.length > 0
      ? (await readJson(config.baseUrl, reportPath(config))).report
      : report;
  }
  const executedAction = executedActions[0];
  const bridgeAction = executedActions.find((entry) => entry.action?.id === "run-control-bridge");
  const heartbeatAction = executedActions.find((entry) => entry.action?.id === "heartbeat-control-session");
  const revokeAction = executedActions.find((entry) => entry.action?.id === "revoke-expired-control-session");
  return {
    schemaVersion: "steambench.control-bridge-ops-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    report: refreshed,
    executedAction,
    executedActions,
    summary: {
      status: refreshed?.status,
      selectedSessions: refreshed?.totals?.selectedSessions,
      active: refreshed?.totals?.active,
      readyForBridge: refreshed?.totals?.readyForBridge,
      needsExecutorReport: refreshed?.totals?.needsExecutorReport,
      executorValidated: refreshed?.totals?.executorValidated,
      expired: refreshed?.totals?.expired,
      broken: refreshed?.totals?.broken,
      recommendedActionIds: refreshed?.recommendedActions?.map((entry) => entry.id) ?? [],
      executedActionId: executedAction?.action?.id,
      executedActionIds: executedActions.map((entry) => entry.action?.id),
      executedActionCount: executedActions.length,
      bridgeSessionId: bridgeAction?.result?.sessionId,
      bridgeExecutorStatus: bridgeAction?.result?.executorReport?.status,
      bridgeExecutorSideEffects: bridgeAction?.result?.executorReport?.sideEffects,
      bridgeAcceptedActions: bridgeAction?.result?.acceptedActionLabels?.length,
      heartbeatSessionId: heartbeatAction?.result?.session?.id,
      revokedSessionId: revokeAction?.result?.session?.id
    }
  };
}

export { runControlBridgeOps };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runControlBridgeOps()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
