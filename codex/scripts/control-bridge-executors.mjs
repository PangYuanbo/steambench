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

function assertControllerExecutionPlan(plan) {
  if (!plan || typeof plan !== "object") {
    throw new Error("executor_missing_controller_execution_plan");
  }
  if (plan.schemaVersion !== "steambench.controller-execution-plan.v1") {
    throw new Error(`executor_unsupported_plan_schema:${plan.schemaVersion}`);
  }
  if (plan.transport !== "virtual-controller" || plan.target !== "xinput-standard") {
    throw new Error(`executor_unsupported_target:${plan.transport}/${plan.target}`);
  }
  if (plan.neutralOnCompletion !== true) {
    throw new Error("executor_requires_neutral_on_completion");
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new Error("executor_empty_plan_steps");
  }
  let previousAtMs = -1;
  for (const step of plan.steps) {
    if (!allowedStepKinds.has(step.kind)) {
      throw new Error(`executor_forbidden_step_kind:${step.kind}`);
    }
    if (!Number.isFinite(step.atMs) || step.atMs < previousAtMs) {
      throw new Error("executor_non_monotonic_timing");
    }
    previousAtMs = step.atMs;
  }
}

function summarizeStep(step) {
  if (step.kind === "button-down" || step.kind === "button-up") {
    return `${step.atMs}ms ${step.kind} ${step.button}`;
  }
  if (step.kind === "set-stick" || step.kind === "reset-stick") {
    return `${step.atMs}ms ${step.kind} ${step.stick} ${Number(step.x).toFixed(2)},${Number(step.y).toFixed(2)}`;
  }
  if (step.kind === "set-trigger" || step.kind === "reset-trigger") {
    return `${step.atMs}ms ${step.kind} ${step.trigger} ${Number(step.value).toFixed(2)}`;
  }
  return `${step.atMs}ms wait ${step.durationMs}ms`;
}

function parseExecutorArgs(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Keep the fallback deliberately simple; callers that need spaces should pass JSON.
  }
  return String(value).split(",").map((entry) => entry.trim()).filter(Boolean);
}

function validateExecutorReport(report, plan, executor) {
  if (!report || typeof report !== "object") {
    throw new Error("executor_invalid_report");
  }
  if (report.schemaVersion !== "steambench.controller-executor-report.v1") {
    throw new Error(`executor_invalid_report_schema:${report.schemaVersion}`);
  }
  if (report.executor !== executor) {
    throw new Error(`executor_report_mismatch:${report.executor}`);
  }
  if (report.planSchemaVersion !== plan.schemaVersion) {
    throw new Error(`executor_report_plan_mismatch:${report.planSchemaVersion}`);
  }
  if (report.plannedStepCount !== plan.steps.length) {
    throw new Error(`executor_report_step_count_mismatch:${report.plannedStepCount}`);
  }
  if (report.status !== "validated" && report.status !== "executed") {
    throw new Error(`executor_report_bad_status:${report.status}`);
  }
  return report;
}

async function runExternalExecutor(plan, options) {
  const executor = options.executor;
  const command = options.command ?? process.env.STEAMBENCH_GEFORCE_NOW_EXECUTOR_CMD;
  if (!command) {
    throw new Error(`executor_command_missing:${executor}`);
  }
  const commandArgs = parseExecutorArgs(options.commandArgs ?? process.env.STEAMBENCH_GEFORCE_NOW_EXECUTOR_ARGS);
  const timeoutMs = Number(options.timeoutMs ?? process.env.STEAMBENCH_GEFORCE_NOW_EXECUTOR_TIMEOUT_MS ?? 10000);
  const payload = {
    schemaVersion: "steambench.controller-executor-request.v1",
    executor,
    provider: options.provider ?? "geforce-now-external",
    sessionId: options.sessionId,
    runId: options.runId,
    taskId: options.taskId,
    plan
  };

  const child = spawn(command, commandArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      STEAMBENCH_CONTROL_SESSION_ID: String(options.sessionId ?? ""),
      STEAMBENCH_RUN_ID: String(options.runId ?? ""),
      STEAMBENCH_TASK_ID: String(options.taskId ?? "")
    }
  });

  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
  }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000);

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdin.end(`${JSON.stringify(payload)}\n`);

  const exit = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timer));

  if (exit.code !== 0) {
    throw new Error(`executor_command_failed:${executor}:${exit.code ?? exit.signal}:${stderr.trim() || stdout.trim()}`);
  }
  try {
    return validateExecutorReport(JSON.parse(stdout), plan, executor);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`executor_invalid_json:${stdout.trim()}`);
    }
    throw error;
  }
}

export async function executeControllerPlan(plan, options = {}) {
  const executor = options.executor ?? "audit";
  assertControllerExecutionPlan(plan);
  if (executor === "geforce-now") return runExternalExecutor(plan, { ...options, executor });
  if (executor !== "audit") throw new Error(`executor_not_configured:${executor}`);

  return {
    schemaVersion: "steambench.controller-executor-report.v1",
    status: "validated",
    executor,
    provider: options.provider ?? "local-audit",
    sessionId: options.sessionId,
    runId: options.runId,
    taskId: options.taskId,
    planSchemaVersion: plan.schemaVersion,
    target: plan.target,
    timing: plan.timing,
    totalDurationMs: plan.totalDurationMs,
    plannedStepCount: plan.steps.length,
    executedStepCount: 0,
    sideEffects: false,
    neutralOnCompletion: plan.neutralOnCompletion,
    allowedStepKinds: Array.from(allowedStepKinds),
    stepPreview: plan.steps.slice(0, 12).map(summarizeStep)
  };
}
