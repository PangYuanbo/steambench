import type { BenchmarkTask } from "../benchmark/types";
import { actionLabel } from "../runtime/action-space";
import type { RuntimeRunEvent } from "../runtime/events";
import type { AgentProfile, BenchmarkRun, RuntimeControlSession } from "./store";

export type ControlBridgeManifest = {
  schemaVersion: "steambench.control-bridge-manifest.v1";
  generatedAt: string;
  bridge: {
    provider: "geforce-now";
    transport: RuntimeControlSession["actionSpace"]["transport"];
    inputMode: RuntimeControlSession["actionSpace"]["inputMode"];
    canonicalCaptureRequired: true;
    privilegedSystemInput: false;
    executor: {
      planSchemaVersion: "steambench.controller-execution-plan.v1";
      target: "xinput-standard";
      timing: "relative-ms";
      neutralOnCompletion: true;
      allowedStepKinds: string[];
    };
  };
  lease: {
    id: string;
    status: RuntimeControlSession["status"];
    runId: string;
    taskId: string;
    agentId?: string;
    createdAt: string;
    expiresAt: string;
    heartbeatAt?: string;
  };
  run: Pick<BenchmarkRun, "id" | "status" | "competitor" | "competitorType" | "runtimeProvider" | "artifactName">;
  task: Pick<BenchmarkTask, "id" | "appid" | "gameName" | "title" | "track" | "level" | "objective" | "estimatedRuntimeMinutes">;
  agent?: Pick<AgentProfile, "id" | "handle" | "displayName" | "provider" | "runtimeProvider" | "capabilities">;
  actionSpace: RuntimeControlSession["actionSpace"];
  endpoints: {
    actionBatch: string;
    accessPacket: string;
    heartbeat: string;
    revoke: string;
    trace: string;
    playbook: string;
    submission: string;
    executorReport: string;
  };
  evidence: {
    canonicalArtifact: "output/output.mp4";
    acceptedArtifactName: "output.mp4";
    forbiddenArtifactNames: ["output-test.mp4"];
    proof: BenchmarkTask["proof"];
  };
  audit: {
    observations: number;
    actionBatches: number;
    acceptedActions: number;
    lastActionLabels: string[];
    executorReports: number;
    lastExecutorStatus?: string;
    lastExecutor?: string;
    lastExecutorProvider?: string;
    lastExecutorSideEffects?: boolean;
    lastExecutorPlannedStepCount?: number;
    lastExecutorExecutedStepCount?: number;
    lastHeartbeatAt?: string;
    readyForBridge: boolean;
    blockers: string[];
  };
};

function eventNumber(event: RuntimeRunEvent | undefined, key: string): number {
  const value = event?.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseActionLabels(value: unknown): string[] {
  if (typeof value !== "string" || value.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    // Fall through to legacy delimiter parsing.
  }
  const delimiter = value.includes("|") ? "|" : ",";
  return value.split(delimiter).map((label) => label.trim()).filter(Boolean);
}

function eventString(event: RuntimeRunEvent | undefined, key: string): string | undefined {
  const value = event?.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function eventBoolean(event: RuntimeRunEvent | undefined, key: string): boolean | undefined {
  const value = event?.metadata?.[key];
  return typeof value === "boolean" ? value : undefined;
}

export function buildControlBridgeManifest(input: {
  session: RuntimeControlSession;
  run: BenchmarkRun;
  task: BenchmarkTask;
  agent?: AgentProfile | null;
  events: RuntimeRunEvent[];
  generatedAt?: string;
}): ControlBridgeManifest {
  const observations = input.events.filter((event) => event.type === "observe");
  const acts = input.events.filter((event) => event.type === "act");
  const executorReports = input.events.filter(
    (event) => event.metadata?.executorReport === "steambench.controller-executor-report.v1"
  );
  const lastAct = acts.at(-1);
  const lastExecutorReport = executorReports.at(-1);
  const lastActionLabels = parseActionLabels(lastAct?.metadata?.actions);
  const fallbackActionLabels = input.session.actionSpace.examples.map(actionLabel);
  const blockers = [];
  if (input.session.status !== "active") blockers.push("control_session_not_active");
  if (input.session.actionSpace.transport !== "virtual-controller") blockers.push("transport_not_virtual_controller");
  if (!input.session.actionSpace.permissions.controller) blockers.push("controller_permission_missing");
  if (input.session.actionSpace.permissions.privilegedSystemInput) blockers.push("privileged_system_input_enabled");
  if (!input.session.actionSpace.constraints.requireCanonicalCapture) blockers.push("canonical_capture_not_required");

  return {
    schemaVersion: "steambench.control-bridge-manifest.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    bridge: {
      provider: "geforce-now",
      transport: input.session.actionSpace.transport,
      inputMode: input.session.actionSpace.inputMode,
      canonicalCaptureRequired: true,
      privilegedSystemInput: false,
      executor: {
        planSchemaVersion: "steambench.controller-execution-plan.v1",
        target: "xinput-standard",
        timing: "relative-ms",
        neutralOnCompletion: true,
        allowedStepKinds: ["button-down", "button-up", "set-stick", "reset-stick", "set-trigger", "reset-trigger", "wait"]
      }
    },
    lease: {
      id: input.session.id,
      status: input.session.status,
      runId: input.session.runId,
      taskId: input.session.taskId,
      agentId: input.session.agentId,
      createdAt: input.session.createdAt,
      expiresAt: input.session.expiresAt,
      heartbeatAt: input.session.heartbeatAt
    },
    run: {
      id: input.run.id,
      status: input.run.status,
      competitor: input.run.competitor,
      competitorType: input.run.competitorType,
      runtimeProvider: input.run.runtimeProvider,
      artifactName: input.run.artifactName
    },
    task: {
      id: input.task.id,
      appid: input.task.appid,
      gameName: input.task.gameName,
      title: input.task.title,
      track: input.task.track,
      level: input.task.level,
      objective: input.task.objective,
      estimatedRuntimeMinutes: input.task.estimatedRuntimeMinutes
    },
    agent: input.agent
      ? {
          id: input.agent.id,
          handle: input.agent.handle,
          displayName: input.agent.displayName,
          provider: input.agent.provider,
          runtimeProvider: input.agent.runtimeProvider,
          capabilities: input.agent.capabilities
        }
      : undefined,
    actionSpace: input.session.actionSpace,
    endpoints: {
      actionBatch: `/api/runs/${input.session.runId}/action-batches`,
      accessPacket: `/api/control-sessions/${input.session.id}/access-packet`,
      heartbeat: `/api/control-sessions/${input.session.id}/heartbeat`,
      revoke: `/api/control-sessions/${input.session.id}/revoke`,
      trace: `/api/runs/${input.session.runId}/agent-trace`,
      playbook: `/api/runs/${input.session.runId}/agent-playbook${input.session.agentId ? `?agentId=${encodeURIComponent(input.session.agentId)}` : ""}`,
      submission: `/api/runs/${input.session.runId}/submission`,
      executorReport: `/api/runs/${input.session.runId}/controller-executor-reports`
    },
    evidence: {
      canonicalArtifact: "output/output.mp4",
      acceptedArtifactName: "output.mp4",
      forbiddenArtifactNames: ["output-test.mp4"],
      proof: input.task.proof
    },
    audit: {
      observations: observations.length,
      actionBatches: acts.length,
      acceptedActions: acts.reduce((total, event) => total + eventNumber(event, "actionCount"), 0),
      lastActionLabels: lastActionLabels.length > 0 ? lastActionLabels : fallbackActionLabels,
      executorReports: executorReports.length,
      lastExecutorStatus: eventString(lastExecutorReport, "executorStatus"),
      lastExecutor: eventString(lastExecutorReport, "executor"),
      lastExecutorProvider: eventString(lastExecutorReport, "executorProvider"),
      lastExecutorSideEffects: eventBoolean(lastExecutorReport, "sideEffects"),
      lastExecutorPlannedStepCount: eventNumber(lastExecutorReport, "plannedStepCount") || undefined,
      lastExecutorExecutedStepCount: eventNumber(lastExecutorReport, "executedStepCount") || undefined,
      lastHeartbeatAt: input.session.heartbeatAt,
      readyForBridge: blockers.length === 0,
      blockers
    }
  };
}
