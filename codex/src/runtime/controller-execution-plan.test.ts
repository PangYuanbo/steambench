import { describe, expect, it } from "vitest";
import { buildRuntimeActionSpace } from "./action-space";
import { compileControllerExecutionPlan } from "./controller-execution-plan";

const controllerActionSpace = buildRuntimeActionSpace({
  adapter: {
    appid: 1145360,
    gameName: "Hades",
    launchUri: "steam://run/1145360",
    installHint: "Install Hades.",
    inputMode: "controller",
    captureMode: "screen-recording",
    saveStrategy: "seeded-save",
    readinessChecks: [],
    agentLoopHints: [],
    evidenceHints: []
  }
});

describe("controller execution plans", () => {
  it("compiles normalized controller actions into low-level virtual gamepad steps", () => {
    const plan = compileControllerExecutionPlan(
      [
        { type: "stick", stick: "left", x: 0.8, y: -0.2, durationMs: 300 },
        { type: "button", button: "a", action: "tap", durationMs: 80 },
        { type: "trigger", trigger: "rt", value: 1, durationMs: 120 }
      ],
      controllerActionSpace
    );

    expect(plan).toMatchObject({
      schemaVersion: "steambench.controller-execution-plan.v1",
      transport: "virtual-controller",
      target: "xinput-standard",
      timing: "relative-ms",
      neutralOnCompletion: true,
      totalDurationMs: 500,
      maxBatchDurationMs: 4000,
      sourceActionLabels: ["stick:left:0.80,-0.20", "button:a:tap", "trigger:rt:1.00"]
    });
    expect(plan?.steps.map((step) => step.kind)).toEqual([
      "set-stick",
      "wait",
      "reset-stick",
      "button-down",
      "wait",
      "button-up",
      "set-trigger",
      "wait",
      "reset-trigger"
    ]);
    expect(plan?.steps.at(-1)).toMatchObject({
      atMs: 500,
      kind: "reset-trigger",
      trigger: "rt",
      value: 0
    });
  });

  it("does not expose controller execution plans for keyboard-mouse action spaces", () => {
    const keyboardActionSpace = buildRuntimeActionSpace({
      adapter: {
        appid: 620,
        gameName: "Portal 2",
        launchUri: "steam://run/620",
        installHint: "Install Portal 2.",
        inputMode: "keyboard-mouse",
        captureMode: "screen-recording",
        saveStrategy: "seeded-save",
        readinessChecks: [],
        agentLoopHints: [],
        evidenceHints: []
      }
    });

    expect(compileControllerExecutionPlan([{ type: "key", key: "w", action: "tap", durationMs: 80 }], keyboardActionSpace)).toBeUndefined();
  });
});
