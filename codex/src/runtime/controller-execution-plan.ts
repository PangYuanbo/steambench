import { actionLabel, type AgentAction, type ControllerAction, type RuntimeActionSpace } from "./action-space";

type ButtonControllerAction = Extract<ControllerAction, { type: "button" }>;
type StickControllerAction = Extract<ControllerAction, { type: "stick" }>;
type TriggerControllerAction = Extract<ControllerAction, { type: "trigger" }>;

export type ControllerExecutionStep =
  | {
      index: number;
      atMs: number;
      kind: "button-down" | "button-up";
      button: ButtonControllerAction["button"];
      sourceAction: string;
    }
  | {
      index: number;
      atMs: number;
      kind: "set-stick" | "reset-stick";
      stick: StickControllerAction["stick"];
      x: number;
      y: number;
      sourceAction: string;
    }
  | {
      index: number;
      atMs: number;
      kind: "set-trigger" | "reset-trigger";
      trigger: TriggerControllerAction["trigger"];
      value: number;
      sourceAction: string;
    }
  | {
      index: number;
      atMs: number;
      kind: "wait";
      durationMs: number;
      sourceAction: string;
    };

type ControllerExecutionStepDraft =
  | Omit<Extract<ControllerExecutionStep, { kind: "button-down" | "button-up" }>, "index" | "atMs">
  | Omit<Extract<ControllerExecutionStep, { kind: "set-stick" | "reset-stick" }>, "index" | "atMs">
  | Omit<Extract<ControllerExecutionStep, { kind: "set-trigger" | "reset-trigger" }>, "index" | "atMs">
  | Omit<Extract<ControllerExecutionStep, { kind: "wait" }>, "index" | "atMs">;

export type ControllerExecutionPlan = {
  schemaVersion: "steambench.controller-execution-plan.v1";
  transport: "virtual-controller";
  target: "xinput-standard";
  timing: "relative-ms";
  neutralOnCompletion: true;
  totalDurationMs: number;
  maxBatchDurationMs: number;
  sourceActionLabels: string[];
  steps: ControllerExecutionStep[];
};

function isControllerAction(action: AgentAction): action is ControllerAction {
  return action.type === "button" || action.type === "stick" || action.type === "trigger" || action.type === "wait";
}

function actionDuration(action: ControllerAction, actionSpace: RuntimeActionSpace): number {
  if (action.type === "button") return action.durationMs ?? actionSpace.controller?.defaultTapMs ?? 80;
  return action.durationMs ?? 0;
}

export function compileControllerExecutionPlan(
  actions: AgentAction[],
  actionSpace: RuntimeActionSpace
): ControllerExecutionPlan | undefined {
  if (actionSpace.inputMode !== "controller" || actionSpace.transport !== "virtual-controller" || !actionSpace.controller) {
    return undefined;
  }

  let atMs = 0;
  const steps: ControllerExecutionStep[] = [];
  const sourceActionLabels: string[] = [];
  const push = (step: ControllerExecutionStepDraft) => {
    steps.push({
      index: steps.length + 1,
      atMs,
      ...step
    });
  };
  const wait = (durationMs: number, sourceAction: string) => {
    const safeDurationMs = Math.max(0, Math.round(durationMs));
    if (safeDurationMs === 0) return;
    push({ kind: "wait", durationMs: safeDurationMs, sourceAction });
    atMs += safeDurationMs;
  };

  for (const action of actions) {
    if (!isControllerAction(action)) continue;
    const sourceAction = actionLabel(action);
    sourceActionLabels.push(sourceAction);

    if (action.type === "button") {
      const durationMs = actionDuration(action, actionSpace);
      if (action.action === "release") {
        push({ kind: "button-up", button: action.button, sourceAction });
        wait(durationMs, sourceAction);
      } else if (action.action === "press") {
        push({ kind: "button-down", button: action.button, sourceAction });
        wait(durationMs, sourceAction);
      } else {
        push({ kind: "button-down", button: action.button, sourceAction });
        wait(durationMs, sourceAction);
        push({ kind: "button-up", button: action.button, sourceAction });
      }
      continue;
    }

    if (action.type === "stick") {
      const durationMs = actionDuration(action, actionSpace);
      push({ kind: "set-stick", stick: action.stick, x: action.x, y: action.y, sourceAction });
      wait(durationMs, sourceAction);
      push({ kind: "reset-stick", stick: action.stick, x: 0, y: 0, sourceAction });
      continue;
    }

    if (action.type === "trigger") {
      const durationMs = actionDuration(action, actionSpace);
      push({ kind: "set-trigger", trigger: action.trigger, value: action.value, sourceAction });
      wait(durationMs, sourceAction);
      push({ kind: "reset-trigger", trigger: action.trigger, value: 0, sourceAction });
      continue;
    }

    wait(action.durationMs, sourceAction);
  }

  return {
    schemaVersion: "steambench.controller-execution-plan.v1",
    transport: "virtual-controller",
    target: actionSpace.controller.layout,
    timing: "relative-ms",
    neutralOnCompletion: true,
    totalDurationMs: atMs,
    maxBatchDurationMs: actionSpace.constraints.maxBatchDurationMs,
    sourceActionLabels,
    steps
  };
}
