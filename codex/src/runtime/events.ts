import type { BenchmarkTask } from "../benchmark/types";
import { buildRuntimeActionSpace, type RuntimeActionSpace } from "./action-space";
import { adapterForGame, type RuntimeGameAdapter } from "./game-adapters";

export const runtimeEventTypes = [
  "plan",
  "launch",
  "observe",
  "act",
  "checkpoint",
  "proof",
  "score",
  "heartbeat",
  "artifact",
  "livestream",
  "error"
] as const;

export type RuntimeEventType = (typeof runtimeEventTypes)[number];

export type RuntimeRunEvent = {
  id: string;
  runId: string;
  type: RuntimeEventType;
  message: string;
  createdAt: string;
  idempotencyKey?: string;
  metadata?: Record<string, string | number | boolean>;
};

export type RuntimeRunPlan = {
  runtime: "local-sim" | "modal-steam-vm" | "manual-human";
  appid: number;
  gameName: string;
  taskTitle: string;
  targetArtifact: "output.mp4";
  controlSurface: "keyboard-mouse" | "controller" | "turn-based-actions" | "manual-proof";
  evidenceRequired: string[];
  maxRuntimeMinutes: number;
  track: BenchmarkTask["track"];
  metricName?: string;
  targetValue?: string;
  scoringRule?: string;
  adapter: RuntimeGameAdapter;
  actionSpace: RuntimeActionSpace;
};

export function buildRuntimeRunPlan(task: BenchmarkTask): RuntimeRunPlan {
  const adapter = adapterForGame(task);
  const controlSurface = adapter.inputMode;

  return {
    runtime: "local-sim",
    appid: task.appid,
    gameName: task.gameName,
    taskTitle: task.title,
    targetArtifact: "output.mp4",
    controlSurface,
    evidenceRequired: task.proof,
    maxRuntimeMinutes: task.estimatedRuntimeMinutes,
    track: task.track,
    metricName: task.metricName,
    targetValue: task.targetValue,
    scoringRule: task.scoringRule,
    adapter,
    actionSpace: buildRuntimeActionSpace({ adapter, task })
  };
}

export function buildSimulatedRuntimeEvents(runId: string, task: BenchmarkTask): Omit<RuntimeRunEvent, "id" | "createdAt">[] {
  const plan = buildRuntimeRunPlan(task);
  return [
    {
      runId,
      type: "plan",
      message: `Resolved ${task.gameName} task "${task.title}" into a ${plan.controlSurface} runtime plan.`,
      metadata: {
        appid: task.appid,
        level: task.level,
        targetArtifact: plan.targetArtifact,
        track: task.track,
        metricName: task.metricName ?? ""
      }
    },
    {
      runId,
      type: "launch",
      message: `Prepared ${plan.runtime} session for Steam app ${task.appid}.`,
      metadata: {
        runtime: plan.runtime,
        maxRuntimeMinutes: plan.maxRuntimeMinutes,
        launchUri: plan.adapter.launchUri,
        saveStrategy: plan.adapter.saveStrategy
      }
    },
    {
      runId,
      type: "observe",
      message: "Captured initial game state and task objective.",
      metadata: {
        source: "screen-capture",
        fairnessVerdict: task.fairnessVerdict
      }
    },
    {
      runId,
      type: "act",
      message: `Agent executed the first bounded action sequence toward the ${task.track} target.`,
      metadata: {
        controlSurface: plan.controlSurface,
        inputMode: plan.adapter.inputMode,
        actionSpace: plan.actionSpace.schemaVersion,
        actions: 12
      }
    },
    {
      runId,
      type: "proof",
      message: "Attached canonical gameplay capture artifact output.mp4 for evaluator review.",
      metadata: {
        artifactName: "output.mp4",
        proofChannels: plan.evidenceRequired.length
      }
    }
  ];
}
