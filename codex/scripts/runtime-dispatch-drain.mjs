import { spawn } from "node:child_process";
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
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    provider: args.get("provider") ?? "local",
    status: args.get("status") ?? "planned,launched",
    limit: intArg("limit", 1, { min: 1, max: 25 }),
    dryRun: boolArg("dry-run", false),
    dispatchId: args.get("dispatch-id") ?? ""
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

async function updateDispatchStatus(baseUrl, dispatchId, status, summary) {
  return readJson(baseUrl, `/api/dispatches/${encodeURIComponent(dispatchId)}/status`, {
    method: "POST",
    body: JSON.stringify({ status, summary })
  });
}

function truncate(value, max = 4000) {
  if (!value || value.length <= max) return value;
  return `${value.slice(0, max)}\n...[truncated ${value.length - max} chars]`;
}

function runShell(command) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({
        exitCode: 1,
        signal: null,
        stdout,
        stderr: `${stderr}${error.message}`
      });
    });
    child.on("close", (exitCode, signal) => {
      resolve({
        exitCode: exitCode ?? 1,
        signal,
        stdout,
        stderr
      });
    });
  });
}

function runnableDispatches(entries, config) {
  const allowedStatuses = new Set(config.status.split(",").map((entry) => entry.trim()).filter(Boolean));
  return entries
    .filter((entry) => entry.dispatch)
    .filter((entry) => !config.dispatchId || entry.dispatch.id === config.dispatchId)
    .filter((entry) => entry.dispatch.provider === config.provider)
    .filter((entry) => allowedStatuses.has(entry.dispatch.status))
    .slice(0, config.limit);
}

async function drainRuntimeDispatches(config = configFromArgs()) {
  const payload = await readJson(config.baseUrl, "/api/dispatches");
  const selected = runnableDispatches(payload.dispatches ?? [], config);
  const results = [];

  for (const entry of selected) {
    const dispatch = entry.dispatch;
    if (dispatch.provider !== "local") {
      results.push({
        dispatchId: dispatch.id,
        status: "skipped",
        reason: `Provider ${dispatch.provider} is not executable by this local drain command.`
      });
      continue;
    }
    if (config.dryRun) {
      results.push({
        dispatchId: dispatch.id,
        status: "dry-run",
        command: dispatch.command,
        runId: dispatch.runId,
        taskId: dispatch.taskId,
        agentId: dispatch.agentId
      });
      continue;
    }

    const launched = await updateDispatchStatus(
      config.baseUrl,
      dispatch.id,
      "launched",
      "Local dispatch drain launched worker command."
    );
    const completed = await runShell(dispatch.command);
    const terminalStatus = completed.exitCode === 0 ? "completed" : "failed";
    const updated = await updateDispatchStatus(
      config.baseUrl,
      dispatch.id,
      terminalStatus,
      completed.exitCode === 0
        ? "Local dispatch drain completed worker command."
        : `Local dispatch drain failed with exit ${completed.exitCode}.`
    );
    results.push({
      dispatchId: dispatch.id,
      runId: dispatch.runId,
      taskId: dispatch.taskId,
      agentId: dispatch.agentId,
      command: dispatch.command,
      launched: launched.dispatch,
      terminalStatus,
      exitCode: completed.exitCode,
      signal: completed.signal,
      stdout: truncate(completed.stdout),
      stderr: truncate(completed.stderr),
      updated: updated.dispatch
    });
  }

  return {
    schemaVersion: "steambench.runtime-dispatch-drain.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    dryRun: config.dryRun,
    filters: {
      provider: config.provider,
      status: config.status,
      limit: config.limit,
      dispatchId: config.dispatchId || undefined
    },
    totals: {
      availableDispatches: payload.dispatches?.length ?? 0,
      selected: selected.length,
      completed: results.filter((entry) => entry.terminalStatus === "completed").length,
      failed: results.filter((entry) => entry.terminalStatus === "failed").length,
      skipped: results.filter((entry) => entry.status === "skipped").length,
      dryRun: results.filter((entry) => entry.status === "dry-run").length
    },
    results
  };
}

export { drainRuntimeDispatches };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  drainRuntimeDispatches()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
