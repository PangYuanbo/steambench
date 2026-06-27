import type { BenchmarkTask } from "../benchmark/types";
import type { RuntimeActionSpace } from "../runtime/action-space";
import { buildRuntimeRunPlan, type RuntimeRunEvent } from "../runtime/events";
import type { AgentProfile, BenchmarkRun } from "./store";

export type AgentPlaybook = {
  schemaVersion: "steambench.agent-playbook.v1";
  generatedAt: string;
  runId: string;
  taskId: string;
  agent?: {
    id: string;
    handle: string;
    command: string;
  };
  objective: {
    appid: number;
    gameName: string;
    title: string;
    track: BenchmarkTask["track"];
    metricName?: string;
    targetValue?: string;
    scoringRule?: string;
    maxRuntimeMinutes: number;
  };
  control: {
    inputMode: string;
    allowedActionTypes: string[];
    actionSpace: RuntimeActionSpace;
    loop: string[];
    stopConditions: string[];
  };
  eventContract: {
    actionBatchEndpoint: string;
    submissionEndpoint: string;
    requiredEventTypes: Array<"observe" | "act" | "proof" | "artifact">;
    metadataKeys: string[];
  };
  evidence: {
    canonicalArtifact: "output/output.mp4";
    proofRequirements: string[];
    captureHints: string[];
  };
};

export type AgentActionTrace = {
  schemaVersion: "steambench.agent-action-trace.v1";
  generatedAt: string;
  runId: string;
  taskId: string;
  status: BenchmarkRun["status"];
  totals: {
    observations: number;
    actionBatches: number;
    actions: number;
    checkpoints: number;
    proofs: number;
    artifacts: number;
    errors: number;
  };
  coverage: {
    hasObservation: boolean;
    hasAction: boolean;
    hasProof: boolean;
    hasArtifact: boolean;
    readyForSubmission: boolean;
  };
  timeline: Array<{
    id: string;
    type: RuntimeRunEvent["type"];
    message: string;
    createdAt: string;
    step?: number;
    actionCount?: number;
    confidence?: number;
  }>;
  nextActions: string[];
};

export function buildAgentPlaybook(input: {
  run: BenchmarkRun;
  task: BenchmarkTask;
  agent?: AgentProfile | null;
  generatedAt?: string;
}): AgentPlaybook {
  const plan = buildRuntimeRunPlan(input.task);
  return {
    schemaVersion: "steambench.agent-playbook.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    runId: input.run.id,
    taskId: input.task.id,
    agent: input.agent
      ? {
          id: input.agent.id,
          handle: input.agent.handle,
          command: input.agent.command
        }
      : undefined,
    objective: {
      appid: input.task.appid,
      gameName: input.task.gameName,
      title: input.task.title,
      track: input.task.track,
      metricName: input.task.metricName,
      targetValue: input.task.targetValue,
      scoringRule: input.task.scoringRule,
      maxRuntimeMinutes: input.task.estimatedRuntimeMinutes
    },
    control: {
      inputMode: plan.adapter.inputMode,
      allowedActionTypes: plan.actionSpace.allowedActionTypes,
      actionSpace: plan.actionSpace,
      loop: [
        "Observe the game screen or structured state.",
        "Emit one compact observe event with the current state summary.",
        "Execute a bounded action batch using the allowed control surface.",
        "Emit one act event with action count, input mode, confidence, and references.",
        "Emit checkpoints when objective progress or proof state changes."
      ],
      stopConditions: [
        "The task objective is achieved.",
        "The maximum runtime window is reached.",
        "The run is blocked by missing game state, Steam state, or capture setup.",
        "The canonical output/output.mp4 artifact has been finalized and submitted."
      ]
    },
    eventContract: {
      actionBatchEndpoint: `/api/runs/${input.run.id}/action-batches`,
      submissionEndpoint: `/api/runs/${input.run.id}/submission`,
      requiredEventTypes: ["observe", "act", "proof", "artifact"],
      metadataKeys: ["step", "observation", "actions", "actionCount", "confidence", "screenRef", "durationMs"]
    },
    evidence: {
      canonicalArtifact: "output/output.mp4",
      proofRequirements: input.task.track === "achievement"
        ? ["steam-achievement", "canonical-artifact"]
        : ["manual-review", "canonical-artifact"],
      captureHints: plan.adapter.evidenceHints
    }
  };
}

function eventNumber(event: RuntimeRunEvent, key: string): number | undefined {
  const value = event.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function buildAgentActionTrace(input: {
  run: BenchmarkRun;
  task: BenchmarkTask;
  events: RuntimeRunEvent[];
  generatedAt?: string;
}): AgentActionTrace {
  const observations = input.events.filter((event) => event.type === "observe");
  const acts = input.events.filter((event) => event.type === "act");
  const checkpoints = input.events.filter((event) => event.type === "checkpoint");
  const proofs = input.events.filter((event) => event.type === "proof");
  const artifacts = input.events.filter((event) => event.type === "artifact");
  const errors = input.events.filter((event) => event.type === "error");
  const actionCount = acts.reduce((total, event) => total + (eventNumber(event, "actionCount") ?? eventNumber(event, "actions") ?? 0), 0);
  const coverage = {
    hasObservation: observations.length > 0,
    hasAction: acts.length > 0,
    hasProof: proofs.length > 0,
    hasArtifact: artifacts.length > 0,
    readyForSubmission: observations.length > 0 && acts.length > 0
  };

  const nextActions = [];
  if (!coverage.hasObservation) nextActions.push("Emit an observe event with current game state.");
  if (!coverage.hasAction) nextActions.push("Submit an action batch after the first observation.");
  if (!coverage.hasArtifact) nextActions.push("Attach the canonical output/output.mp4 artifact.");
  if (!coverage.hasProof) nextActions.push(input.task.track === "achievement" ? "Verify Steam achievement proof." : "Submit manual metric proof.");
  if (input.run.status !== "scored" && coverage.hasArtifact && coverage.hasProof) nextActions.push("Evaluate the run or submit through the receipt endpoint.");
  if (nextActions.length === 0) nextActions.push("Trace is complete for current run state.");

  return {
    schemaVersion: "steambench.agent-action-trace.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    runId: input.run.id,
    taskId: input.task.id,
    status: input.run.status,
    totals: {
      observations: observations.length,
      actionBatches: acts.length,
      actions: actionCount,
      checkpoints: checkpoints.length,
      proofs: proofs.length,
      artifacts: artifacts.length,
      errors: errors.length
    },
    coverage,
    timeline: input.events
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((event) => ({
        id: event.id,
        type: event.type,
        message: event.message,
        createdAt: event.createdAt,
        step: eventNumber(event, "step"),
        actionCount: eventNumber(event, "actionCount") ?? eventNumber(event, "actions"),
        confidence: eventNumber(event, "confidence")
      })),
    nextActions
  };
}
