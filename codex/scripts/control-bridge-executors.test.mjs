import { describe, expect, it } from "vitest";
import { executeControllerPlan } from "./control-bridge-executors.mjs";

const plan = {
  schemaVersion: "steambench.controller-execution-plan.v1",
  transport: "virtual-controller",
  target: "xinput-standard",
  timing: "relative-ms",
  neutralOnCompletion: true,
  totalDurationMs: 80,
  maxBatchDurationMs: 4000,
  sourceActionLabels: ["button:a:tap"],
  steps: [
    { index: 1, atMs: 0, kind: "button-down", button: "a", sourceAction: "button:a:tap" },
    { index: 2, atMs: 0, kind: "wait", durationMs: 80, sourceAction: "button:a:tap" },
    { index: 3, atMs: 80, kind: "button-up", button: "a", sourceAction: "button:a:tap" }
  ]
};

describe("control bridge executors", () => {
  it("validates a virtual-controller plan without performing host input in audit mode", async () => {
    const report = await executeControllerPlan(plan, {
      executor: "audit",
      provider: "local-audit",
      sessionId: "control_test",
      runId: "run_test",
      taskId: "task_test"
    });

    expect(report).toMatchObject({
      schemaVersion: "steambench.controller-executor-report.v1",
      status: "validated",
      executor: "audit",
      provider: "local-audit",
      sessionId: "control_test",
      runId: "run_test",
      taskId: "task_test",
      planSchemaVersion: "steambench.controller-execution-plan.v1",
      target: "xinput-standard",
      plannedStepCount: 3,
      executedStepCount: 0,
      sideEffects: false,
      neutralOnCompletion: true
    });
    expect(report.stepPreview).toEqual(["0ms button-down a", "0ms wait 80ms", "80ms button-up a"]);
  });

  it("rejects executor modes that are not configured yet", async () => {
    await expect(executeControllerPlan(plan, { executor: "unconfigured" })).rejects.toThrow("executor_not_configured:unconfigured");
  });

  it("requires an explicit external command before using the GeForce NOW executor", async () => {
    await expect(executeControllerPlan(plan, { executor: "geforce-now" })).rejects.toThrow("executor_command_missing:geforce-now");
  });

  it("passes plans to a configured GeForce NOW executor command over stdin", async () => {
    const report = await executeControllerPlan(plan, {
      executor: "geforce-now",
      command: process.execPath,
      commandArgs: JSON.stringify(["scripts/fixtures/geforce-now-executor-fixture.mjs"]),
      sessionId: "control_test",
      runId: "run_test",
      taskId: "task_test",
      timeoutMs: 5000
    });

    expect(report).toMatchObject({
      schemaVersion: "steambench.controller-executor-report.v1",
      status: "validated",
      executor: "geforce-now",
      provider: "geforce-now-fixture",
      sessionId: "control_test",
      runId: "run_test",
      taskId: "task_test",
      planSchemaVersion: "steambench.controller-execution-plan.v1",
      plannedStepCount: 3,
      executedStepCount: 0,
      sideEffects: false,
      adapterProtocol: "steambench.controller-executor-request.v1",
      receivedStepKinds: ["button-down", "wait", "button-up"]
    });
  });

  it("uses the GeForce NOW gamepad executor scaffold in audit mode", async () => {
    const report = await executeControllerPlan(plan, {
      executor: "geforce-now",
      command: process.execPath,
      commandArgs: JSON.stringify(["scripts/geforce-now-gamepad-executor.mjs"]),
      sessionId: "control_test",
      runId: "run_test",
      taskId: "task_test",
      timeoutMs: 5000
    });

    expect(report).toMatchObject({
      schemaVersion: "steambench.controller-executor-report.v1",
      status: "validated",
      executor: "geforce-now",
      provider: "geforce-now-audit",
      sessionId: "control_test",
      runId: "run_test",
      taskId: "task_test",
      planSchemaVersion: "steambench.controller-execution-plan.v1",
      plannedStepCount: 3,
      executedStepCount: 0,
      sideEffects: false,
      adapterProtocol: "steambench.controller-executor-request.v1",
      backendProtocol: "steambench.geforce-now-gamepad-backend-request.v1",
      backend: "audit"
    });
  });

  it("lets the GeForce NOW gamepad executor scaffold delegate to a command backend", async () => {
    const report = await executeControllerPlan(plan, {
      executor: "geforce-now",
      command: process.execPath,
      commandArgs: JSON.stringify([
        "scripts/geforce-now-gamepad-executor.mjs",
        "--backend=command",
        `--backend-command=${process.execPath}`,
        `--backend-args=${JSON.stringify(["scripts/fixtures/geforce-now-gamepad-backend-fixture.mjs"])}`
      ]),
      sessionId: "control_test",
      runId: "run_test",
      taskId: "task_test",
      timeoutMs: 5000
    });

    expect(report).toMatchObject({
      schemaVersion: "steambench.controller-executor-report.v1",
      status: "executed",
      executor: "geforce-now",
      provider: "geforce-now-backend-fixture",
      plannedStepCount: 3,
      executedStepCount: 3,
      sideEffects: false,
      adapterProtocol: "steambench.controller-executor-request.v1",
      backendProtocol: "steambench.geforce-now-gamepad-backend-request.v1",
      backend: "command",
      backendStatus: "executed"
    });
  });

  it("rejects forbidden step kinds before an adapter can touch host input", async () => {
    await expect(
      executeControllerPlan({
        ...plan,
        steps: [{ index: 1, atMs: 0, kind: "os-hotkey", sourceAction: "bad" }]
      })
    ).rejects.toThrow("executor_forbidden_step_kind:os-hotkey");
  });
});
