import { spawn } from "node:child_process";

const allowedStepKinds = new Set([
  "button-down",
  "button-up",
  "set-stick",
  "reset-stick",
  "set-trigger",
  "reset-trigger",
  "wait"
]);

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=") || "1"];
  })
);

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(input));
  });
}

function parseArgs(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Comma-separated args are a convenience for local probes without spaces.
  }
  return String(value).split(",").map((entry) => entry.trim()).filter(Boolean);
}

function fail(code, detail) {
  const error = detail ? `${code}:${detail}` : code;
  process.stderr.write(`${error}\n`);
  process.exit(1);
}

function assertRequest(request) {
  if (!request || typeof request !== "object") fail("gfn_executor_invalid_request");
  if (request.schemaVersion !== "steambench.controller-executor-request.v1") {
    fail("gfn_executor_unsupported_request_schema", request.schemaVersion);
  }
  if (request.executor !== "geforce-now") fail("gfn_executor_wrong_executor", request.executor);
  const plan = request.plan;
  if (!plan || typeof plan !== "object") fail("gfn_executor_missing_plan");
  if (plan.schemaVersion !== "steambench.controller-execution-plan.v1") {
    fail("gfn_executor_unsupported_plan_schema", plan.schemaVersion);
  }
  if (plan.transport !== "virtual-controller" || plan.target !== "xinput-standard") {
    fail("gfn_executor_unsupported_target", `${plan.transport}/${plan.target}`);
  }
  if (plan.neutralOnCompletion !== true) fail("gfn_executor_requires_neutral_completion");
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) fail("gfn_executor_empty_steps");

  let previousAtMs = -1;
  for (const step of plan.steps) {
    if (!allowedStepKinds.has(step.kind)) fail("gfn_executor_forbidden_step", step.kind);
    if (!Number.isFinite(step.atMs) || step.atMs < previousAtMs) fail("gfn_executor_non_monotonic_timing");
    previousAtMs = step.atMs;
  }
  return request;
}

function toBackendStep(request, step) {
  return {
    schemaVersion: "steambench.geforce-now-gamepad-step.v1",
    sessionId: request.sessionId,
    runId: request.runId,
    taskId: request.taskId,
    target: request.plan.target,
    timing: request.plan.timing,
    step
  };
}

function stepSummary(step) {
  if (step.kind === "button-down" || step.kind === "button-up") {
    return `${step.atMs}ms ${step.kind} ${step.button}`;
  }
  if (step.kind === "set-stick" || step.kind === "reset-stick") {
    return `${step.atMs}ms ${step.kind} ${step.stick} ${Number(step.x ?? 0).toFixed(2)},${Number(step.y ?? 0).toFixed(2)}`;
  }
  if (step.kind === "set-trigger" || step.kind === "reset-trigger") {
    return `${step.atMs}ms ${step.kind} ${step.trigger} ${Number(step.value ?? 0).toFixed(2)}`;
  }
  return `${step.atMs}ms wait ${step.durationMs}ms`;
}

async function runCommandBackend(request, backendRequest) {
  const command = args.get("backend-command") ?? process.env.STEAMBENCH_GEFORCE_NOW_BACKEND_CMD;
  if (!command) fail("gfn_executor_backend_command_missing");
  const commandArgs = parseArgs(args.get("backend-args") ?? process.env.STEAMBENCH_GEFORCE_NOW_BACKEND_ARGS);
  const timeoutMs = Number(args.get("backend-timeout-ms") ?? process.env.STEAMBENCH_GEFORCE_NOW_BACKEND_TIMEOUT_MS ?? 30000);
  const child = spawn(command, commandArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      STEAMBENCH_CONTROL_SESSION_ID: String(request.sessionId ?? ""),
      STEAMBENCH_RUN_ID: String(request.runId ?? ""),
      STEAMBENCH_TASK_ID: String(request.taskId ?? "")
    }
  });

  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
  }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000);

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdin.end(`${JSON.stringify(backendRequest)}\n`);

  const exit = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timer));

  if (exit.code !== 0) {
    fail("gfn_executor_backend_failed", `${exit.code ?? exit.signal}:${stderr.trim() || stdout.trim()}`);
  }
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    fail("gfn_executor_backend_invalid_json", stdout.trim());
  }
  if (report.schemaVersion !== "steambench.geforce-now-gamepad-backend-report.v1") {
    fail("gfn_executor_backend_bad_schema", report.schemaVersion);
  }
  if (report.sideEffects !== false) fail("gfn_executor_backend_side_effects_not_allowed");
  if (!Number.isFinite(report.executedStepCount) || report.executedStepCount < 0 || report.executedStepCount > request.plan.steps.length) {
    fail("gfn_executor_backend_bad_step_count", String(report.executedStepCount));
  }
  return report;
}

async function main() {
  const raw = await readStdin();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("gfn_executor_invalid_json");
  }
  const request = assertRequest(parsed);
  const backend = args.get("backend") ?? process.env.STEAMBENCH_GEFORCE_NOW_BACKEND ?? "audit";
  const backendRequest = {
    schemaVersion: "steambench.geforce-now-gamepad-backend-request.v1",
    provider: request.provider ?? "geforce-now-external",
    sessionId: request.sessionId,
    runId: request.runId,
    taskId: request.taskId,
    planSchemaVersion: request.plan.schemaVersion,
    target: request.plan.target,
    timing: request.plan.timing,
    totalDurationMs: request.plan.totalDurationMs,
    neutralOnCompletion: request.plan.neutralOnCompletion,
    steps: request.plan.steps.map((step) => toBackendStep(request, step))
  };

  let backendReport = {
    schemaVersion: "steambench.geforce-now-gamepad-backend-report.v1",
    status: "validated",
    backend,
    executedStepCount: 0,
    sideEffects: false
  };
  if (backend === "command") {
    backendReport = await runCommandBackend(request, backendRequest);
  } else if (backend !== "audit") {
    fail("gfn_executor_backend_not_configured", backend);
  }

  const executedStepCount = backendReport.executedStepCount ?? 0;
  const status = executedStepCount > 0 ? "executed" : "validated";
  const report = {
    schemaVersion: "steambench.controller-executor-report.v1",
    status,
    executor: "geforce-now",
    provider: backendReport.provider ?? `geforce-now-${backend}`,
    sessionId: request.sessionId,
    runId: request.runId,
    taskId: request.taskId,
    planSchemaVersion: request.plan.schemaVersion,
    target: request.plan.target,
    timing: request.plan.timing,
    totalDurationMs: request.plan.totalDurationMs,
    plannedStepCount: request.plan.steps.length,
    executedStepCount,
    sideEffects: false,
    neutralOnCompletion: request.plan.neutralOnCompletion,
    adapterProtocol: request.schemaVersion,
    backendProtocol: backendRequest.schemaVersion,
    backend,
    backendStatus: backendReport.status,
    stepPreview: request.plan.steps.slice(0, 12).map(stepSummary)
  };

  process.stdout.write(`${JSON.stringify(report)}\n`);
}

main().catch((error) => {
  fail("gfn_executor_unhandled", error instanceof Error ? error.message : String(error));
});
