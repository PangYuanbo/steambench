import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();
const validActions = new Set([
  "requeue-expired-workers",
  "drain-local-dispatches",
  "inspect-modal-package",
  "inspect-failed-run",
  "inspect-proof-missing-run",
  "advance-dispatch-actions"
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
    provider: args.get("provider") ?? "",
    status: args.get("status") ?? "",
    limit: intArg("limit", 50, { min: 1, max: 200 }),
    execute,
    maxSteps: intArg("max-steps", 2, { min: 1, max: 10 }),
    dryRun: args.get("dry-run") === "1" || args.get("dry-run") === "true"
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
  if (config.provider) params.set("provider", config.provider);
  if (config.status) params.set("status", config.status);
  return params.toString();
}

function reportPath(config) {
  return `/api/dispatches/ops-report?${queryString(config)}`;
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

function commandArg(command, name) {
  const match = command?.match(new RegExp(`--${name}=([^\\s]+)`));
  return match?.[1];
}

async function runDrain(action, config) {
  const status = commandArg(action.command, "status") ?? config.status ?? "planned,launched";
  const limit = commandArg(action.command, "limit") ?? String(Math.min(config.limit, 25));
  const childArgs = [
    "scripts/runtime-dispatch-drain.mjs",
    `--api=${config.baseUrl}`,
    "--provider=local",
    `--status=${status}`,
    `--limit=${limit}`
  ];
  if (config.dryRun) childArgs.push("--dry-run=true");
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
    throw new Error(`dispatch drain failed with ${exit.code ?? exit.signal}:\n${stdout}\n${stderr}`);
  }
  return JSON.parse(stdout);
}

async function executeAction(action, config) {
  if (!action) throw new Error("Missing action to execute.");
  if (action.id === "drain-local-dispatches") {
    return runDrain(action, config);
  }
  return readJson(config.baseUrl, action.endpoint, actionRequest(action));
}

function actionSignature(action) {
  return `${action.id}:${action.method}:${action.endpoint ?? action.command}`;
}

function nextAutomationAction(report) {
  return report.recommendedActions?.find((entry) =>
    entry.id === "requeue-expired-workers" ||
    entry.id === "drain-local-dispatches"
  );
}

async function executeDispatchAction(config, action) {
  return {
    action,
    result: await executeAction(action, config)
  };
}

async function advanceDispatchActions(config) {
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
    executedActions.push(await executeDispatchAction(config, action));
  }

  if (!refreshed) {
    refreshed = (await readJson(config.baseUrl, reportPath(config))).report;
  }

  return { executedActions, refreshed };
}

async function runRuntimeDispatchOps(config = configFromArgs()) {
  let executedActions = [];
  let refreshed;
  if (config.execute === "advance-dispatch-actions") {
    ({ executedActions, refreshed } = await advanceDispatchActions(config));
  } else {
    const payload = await readJson(config.baseUrl, reportPath(config));
    const report = payload.report;
    const action = config.execute
      ? report.recommendedActions?.find((entry) => entry.id === config.execute)
      : undefined;
    executedActions = config.execute ? [await executeDispatchAction(config, action)] : [];
    refreshed = executedActions.length > 0
      ? (await readJson(config.baseUrl, reportPath(config))).report
      : report;
  }
  const executedAction = executedActions[0];
  const drainAction = executedActions.find((entry) => entry.action?.id === "drain-local-dispatches");
  const requeueAction = executedActions.find((entry) => entry.action?.id === "requeue-expired-workers");
  return {
    schemaVersion: "steambench.runtime-dispatch-ops-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    report: refreshed,
    executedAction,
    executedActions,
    summary: {
      status: refreshed?.status,
      selectedDispatches: refreshed?.totals?.selectedDispatches,
      pendingLocal: refreshed?.totals?.pendingLocal,
      pendingModal: refreshed?.totals?.pendingModal,
      proofMissing: refreshed?.totals?.proofMissing,
      failed: refreshed?.totals?.failed,
      workerExpired: refreshed?.totals?.workerExpired,
      recommendedActionIds: refreshed?.recommendedActions?.map((entry) => entry.id) ?? [],
      executedActionId: executedAction?.action?.id,
      executedActionIds: executedActions.map((entry) => entry.action?.id),
      executedActionCount: executedActions.length,
      drainSelected: drainAction?.result?.totals?.selected,
      drainCompleted: drainAction?.result?.totals?.completed,
      drainFailed: drainAction?.result?.totals?.failed,
      drainDryRun: drainAction?.result?.totals?.dryRun,
      requeuedRuns: requeueAction?.result?.requeuedRuns?.length
    }
  };
}

export { runRuntimeDispatchOps };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRuntimeDispatchOps()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
