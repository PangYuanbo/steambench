import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const plan = {
  schemaVersion: "steambench.controller-execution-plan.v1",
  transport: "virtual-controller",
  target: "xinput-standard",
  timing: "relative-ms",
  neutralOnCompletion: true,
  totalDurationMs: 200,
  maxBatchDurationMs: 4000,
  sourceActionLabels: ["button:a:tap", "stick:left:0.40,0.20"],
  steps: [
    { index: 1, atMs: 0, kind: "button-down", button: "a", sourceAction: "button:a:tap" },
    { index: 2, atMs: 80, kind: "button-up", button: "a", sourceAction: "button:a:tap" },
    { index: 3, atMs: 100, kind: "set-stick", stick: "left", x: 0.4, y: 0.2, sourceAction: "stick:left:0.40,0.20" },
    { index: 4, atMs: 200, kind: "reset-stick", stick: "left", sourceAction: "stick:left:0.40,0.20" }
  ]
};

function request(overrides = {}) {
  return {
    schemaVersion: "steambench.controller-executor-request.v1",
    executor: "geforce-now",
    provider: "geforce-now-external",
    sessionId: "control_test",
    runId: "run_test",
    taskId: "task_test",
    plan,
    ...overrides
  };
}

function runExecutor(payload, args = []) {
  return spawnSync(process.execPath, ["scripts/geforce-now-gamepad-executor.mjs", ...args], {
    cwd: process.cwd(),
    input: `${JSON.stringify(payload)}\n`,
    encoding: "utf8"
  });
}

describe("GeForce NOW gamepad executor CLI", () => {
  it("validates controller executor requests without host input in audit mode", () => {
    const result = runExecutor(request());

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      schemaVersion: "steambench.controller-executor-report.v1",
      status: "validated",
      executor: "geforce-now",
      provider: "geforce-now-audit",
      sessionId: "control_test",
      runId: "run_test",
      taskId: "task_test",
      planSchemaVersion: "steambench.controller-execution-plan.v1",
      target: "xinput-standard",
      plannedStepCount: 4,
      executedStepCount: 0,
      sideEffects: false,
      neutralOnCompletion: true,
      adapterProtocol: "steambench.controller-executor-request.v1",
      backendProtocol: "steambench.geforce-now-gamepad-backend-request.v1",
      backend: "audit",
      backendStatus: "validated"
    });
    expect(report.stepPreview).toEqual([
      "0ms button-down a",
      "80ms button-up a",
      "100ms set-stick left 0.40,0.20",
      "200ms reset-stick left 0.00,0.00"
    ]);
  });

  it("delegates sanitized gamepad backend requests to a configured command backend", () => {
    const result = runExecutor(request(), [
      "--backend=command",
      `--backend-command=${process.execPath}`,
      `--backend-args=${JSON.stringify(["scripts/fixtures/geforce-now-gamepad-backend-fixture.mjs"])}`
    ]);

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      schemaVersion: "steambench.controller-executor-report.v1",
      status: "executed",
      executor: "geforce-now",
      provider: "geforce-now-backend-fixture",
      plannedStepCount: 4,
      executedStepCount: 4,
      sideEffects: false,
      adapterProtocol: "steambench.controller-executor-request.v1",
      backendProtocol: "steambench.geforce-now-gamepad-backend-request.v1",
      backend: "command",
      backendStatus: "executed"
    });
  });

  it("rejects unsupported executor payloads before a backend command can run", () => {
    const result = runExecutor(request({ executor: "keyboard" }), [
      "--backend=command",
      `--backend-command=${process.execPath}`,
      `--backend-args=${JSON.stringify(["scripts/fixtures/geforce-now-gamepad-backend-fixture.mjs"])}`
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("gfn_executor_wrong_executor:keyboard");
  });
});
