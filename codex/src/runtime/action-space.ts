import type { BenchmarkTask } from "../benchmark/types";
import type { RuntimeGameAdapter } from "./game-adapters";

export type ControllerButton =
  | "a"
  | "b"
  | "x"
  | "y"
  | "lb"
  | "rb"
  | "back"
  | "start"
  | "guide"
  | "ls"
  | "rs"
  | "dpad-up"
  | "dpad-down"
  | "dpad-left"
  | "dpad-right";

export type ControllerStick = "left" | "right";
export type ControllerTrigger = "lt" | "rt";

export type ControllerAction =
  | {
      type: "button";
      button: ControllerButton;
      action?: "press" | "release" | "tap";
      durationMs?: number;
    }
  | {
      type: "stick";
      stick: ControllerStick;
      x: number;
      y: number;
      durationMs?: number;
    }
  | {
      type: "trigger";
      trigger: ControllerTrigger;
      value: number;
      durationMs?: number;
    }
  | {
      type: "wait";
      durationMs: number;
    };

export type KeyboardMouseAction =
  | { type: "key"; key: string; action?: "press" | "release" | "tap"; durationMs?: number }
  | { type: "mouse-move"; x: number; y: number; relative?: boolean; durationMs?: number }
  | { type: "mouse-click"; button: "left" | "right" | "middle"; durationMs?: number }
  | { type: "scroll"; dx?: number; dy?: number; durationMs?: number }
  | { type: "wait"; durationMs: number };

export type TurnBasedAction =
  | { type: "choose-card"; id: string }
  | { type: "choose-option"; id: string }
  | { type: "buy"; id: string }
  | { type: "sell"; id: string }
  | { type: "end-turn" }
  | { type: "confirm" }
  | { type: "wait"; durationMs: number };

export type AgentAction = ControllerAction | KeyboardMouseAction | TurnBasedAction;

export type RuntimeActionSpace = {
  schemaVersion: "steambench.runtime-action-space.v1";
  inputMode: RuntimeGameAdapter["inputMode"];
  transport: "local-desktop" | "virtual-controller" | "structured-turn-api";
  permissions: {
    controller: boolean;
    keyboard: boolean;
    mouse: boolean;
    turnBased: boolean;
    privilegedSystemInput: false;
  };
  allowedActionTypes: string[];
  controller?: {
    layout: "xinput-standard";
    buttons: ControllerButton[];
    sticks: ControllerStick[];
    triggers: ControllerTrigger[];
    stickRange: {
      min: -1;
      max: 1;
    };
    triggerRange: {
      min: 0;
      max: 1;
    };
    defaultTapMs: number;
  };
  constraints: {
    maxActionsPerBatch: number;
    maxBatchDurationMs: number;
    minObserveBeforeAct: true;
    requireCanonicalCapture: true;
    forbiddenActions: string[];
  };
  examples: AgentAction[];
};

const controllerButtons: ControllerButton[] = [
  "a",
  "b",
  "x",
  "y",
  "lb",
  "rb",
  "back",
  "start",
  "guide",
  "ls",
  "rs",
  "dpad-up",
  "dpad-down",
  "dpad-left",
  "dpad-right"
];

export function buildRuntimeActionSpace(input: {
  adapter: RuntimeGameAdapter;
  task?: Pick<BenchmarkTask, "track">;
}): RuntimeActionSpace {
  if (input.adapter.inputMode === "controller") {
    return {
      schemaVersion: "steambench.runtime-action-space.v1",
      inputMode: "controller",
      transport: "virtual-controller",
      permissions: {
        controller: true,
        keyboard: false,
        mouse: false,
        turnBased: false,
        privilegedSystemInput: false
      },
      allowedActionTypes: ["button", "stick", "trigger", "wait"],
      controller: {
        layout: "xinput-standard",
        buttons: controllerButtons,
        sticks: ["left", "right"],
        triggers: ["lt", "rt"],
        stickRange: {
          min: -1,
          max: 1
        },
        triggerRange: {
          min: 0,
          max: 1
        },
        defaultTapMs: 80
      },
      constraints: {
        maxActionsPerBatch: 32,
        maxBatchDurationMs: 4000,
        minObserveBeforeAct: true,
        requireCanonicalCapture: true,
        forbiddenActions: ["os-hotkey", "process-spawn", "file-write-outside-output", "network-control-plane"]
      },
      examples: [
        { type: "stick", stick: "left", x: 0.8, y: 0, durationMs: 350 },
        { type: "button", button: "a", action: "tap", durationMs: 80 },
        { type: "trigger", trigger: "rt", value: 1, durationMs: 120 }
      ]
    };
  }

  if (input.adapter.inputMode === "turn-based-actions") {
    return {
      schemaVersion: "steambench.runtime-action-space.v1",
      inputMode: "turn-based-actions",
      transport: "structured-turn-api",
      permissions: {
        controller: false,
        keyboard: false,
        mouse: false,
        turnBased: true,
        privilegedSystemInput: false
      },
      allowedActionTypes: ["choose-card", "choose-option", "buy", "sell", "end-turn", "confirm", "wait"],
      constraints: {
        maxActionsPerBatch: 12,
        maxBatchDurationMs: 15000,
        minObserveBeforeAct: true,
        requireCanonicalCapture: true,
        forbiddenActions: ["raw-pointer", "os-hotkey", "process-spawn", "file-write-outside-output"]
      },
      examples: [
        { type: "choose-option", id: "option-1" },
        { type: "confirm" }
      ]
    };
  }

  return {
    schemaVersion: "steambench.runtime-action-space.v1",
    inputMode: "keyboard-mouse",
    transport: "local-desktop",
    permissions: {
      controller: false,
      keyboard: true,
      mouse: true,
      turnBased: false,
      privilegedSystemInput: false
    },
    allowedActionTypes: ["key", "mouse-move", "mouse-click", "scroll", "wait"],
    constraints: {
      maxActionsPerBatch: 48,
      maxBatchDurationMs: 5000,
      minObserveBeforeAct: true,
      requireCanonicalCapture: true,
      forbiddenActions: ["os-hotkey", "process-spawn", "file-write-outside-output", "network-control-plane"]
    },
    examples: [
      { type: "key", key: "w", action: "press", durationMs: 250 },
      { type: "mouse-move", x: 35, y: -8, relative: true, durationMs: 80 },
      { type: "mouse-click", button: "left", durationMs: 60 }
    ]
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeAgentAction(action: unknown, actionSpace: RuntimeActionSpace): AgentAction | null {
  if (typeof action === "string") {
    if (action.startsWith("key:")) return { type: "key", key: action.slice(4), action: "tap" };
    if (action.startsWith("mouse-click:")) {
      const button = action.slice("mouse-click:".length);
      if (button === "left" || button === "right" || button === "middle") return { type: "mouse-click", button };
    }
    if (action === "wait") return { type: "wait", durationMs: 250 };
    return null;
  }
  if (!action || typeof action !== "object") return null;
  const record = action as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  if (!actionSpace.allowedActionTypes.includes(type)) return null;

  if (type === "button" && actionSpace.controller) {
    const button = record.button;
    if (typeof button !== "string" || !actionSpace.controller.buttons.includes(button as ControllerButton)) return null;
    const requestedAction = record.action;
    const buttonAction = requestedAction === "press" || requestedAction === "release" || requestedAction === "tap" ? requestedAction : "tap";
    return {
      type: "button",
      button: button as ControllerButton,
      action: buttonAction,
      durationMs: clamp(Number(record.durationMs ?? actionSpace.controller.defaultTapMs), 0, actionSpace.constraints.maxBatchDurationMs)
    };
  }
  if (type === "stick" && actionSpace.controller) {
    const stick = record.stick;
    if (stick !== "left" && stick !== "right") return null;
    return {
      type: "stick",
      stick,
      x: clamp(Number(record.x ?? 0), -1, 1),
      y: clamp(Number(record.y ?? 0), -1, 1),
      durationMs: clamp(Number(record.durationMs ?? 100), 0, actionSpace.constraints.maxBatchDurationMs)
    };
  }
  if (type === "trigger" && actionSpace.controller) {
    const trigger = record.trigger;
    if (trigger !== "lt" && trigger !== "rt") return null;
    return {
      type: "trigger",
      trigger,
      value: clamp(Number(record.value ?? 0), 0, 1),
      durationMs: clamp(Number(record.durationMs ?? 100), 0, actionSpace.constraints.maxBatchDurationMs)
    };
  }
  if (type === "wait") {
    return {
      type: "wait",
      durationMs: clamp(Number(record.durationMs ?? 250), 0, actionSpace.constraints.maxBatchDurationMs)
    };
  }
  if (type === "key") {
    const key = String(record.key ?? "");
    if (!key) return null;
    const requestedAction = record.action;
    const keyAction = requestedAction === "press" || requestedAction === "release" || requestedAction === "tap" ? requestedAction : "tap";
    return { type: "key", key, action: keyAction, durationMs: clamp(Number(record.durationMs ?? 80), 0, actionSpace.constraints.maxBatchDurationMs) };
  }
  if (type === "mouse-move") {
    return {
      type: "mouse-move",
      x: Number(record.x ?? 0),
      y: Number(record.y ?? 0),
      relative: record.relative === undefined ? true : Boolean(record.relative),
      durationMs: clamp(Number(record.durationMs ?? 80), 0, actionSpace.constraints.maxBatchDurationMs)
    };
  }
  if (type === "mouse-click") {
    const button = record.button;
    if (button !== "left" && button !== "right" && button !== "middle") return null;
    return { type: "mouse-click", button, durationMs: clamp(Number(record.durationMs ?? 60), 0, actionSpace.constraints.maxBatchDurationMs) };
  }
  if (type === "scroll") {
    return { type: "scroll", dx: Number(record.dx ?? 0), dy: Number(record.dy ?? 0), durationMs: clamp(Number(record.durationMs ?? 80), 0, actionSpace.constraints.maxBatchDurationMs) };
  }
  if (type === "choose-card" || type === "choose-option" || type === "buy" || type === "sell") {
    const id = String(record.id ?? "");
    return id ? { type, id } : null;
  }
  if (type === "end-turn" || type === "confirm") return { type };
  return null;
}

export function normalizeAgentActions(actions: unknown[], actionSpace: RuntimeActionSpace): AgentAction[] {
  return actions.flatMap((action) => {
    const normalized = normalizeAgentAction(action, actionSpace);
    return normalized ? [normalized] : [];
  }).slice(0, actionSpace.constraints.maxActionsPerBatch);
}

export function actionLabel(action: AgentAction): string {
  if (action.type === "button") return `button:${action.button}:${action.action ?? "tap"}`;
  if (action.type === "stick") return `stick:${action.stick}:${action.x.toFixed(2)},${action.y.toFixed(2)}`;
  if (action.type === "trigger") return `trigger:${action.trigger}:${action.value.toFixed(2)}`;
  if (action.type === "key") return `key:${action.key}:${action.action ?? "tap"}`;
  if (action.type === "mouse-click") return `mouse-click:${action.button}`;
  if (action.type === "mouse-move") return `mouse-move:${action.x},${action.y}`;
  if (action.type === "scroll") return `scroll:${action.dx ?? 0},${action.dy ?? 0}`;
  if ("id" in action) return `${action.type}:${action.id}`;
  return action.type;
}
