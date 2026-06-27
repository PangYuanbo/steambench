import type { AgentProfile, BenchmarkRun, RuntimeControlSession } from "./store";
import type { BenchmarkTask } from "../benchmark/types";

export type RuntimeControlAccessPacket = {
  schemaVersion: "steambench.runtime-control-access-packet.v1";
  generatedAt: string;
  purpose: "bounded-agent-game-control";
  lease: {
    id: string;
    status: RuntimeControlSession["status"];
    runId: string;
    taskId: string;
    agentId?: string;
    createdAt: string;
    expiresAt: string;
    heartbeatAt?: string;
    ttlRemainingSeconds: number;
  };
  principal: {
    type: "agent" | "unbound";
    id?: string;
    handle?: string;
    displayName?: string;
    provider?: AgentProfile["provider"];
    runtimeProvider?: AgentProfile["runtimeProvider"];
  };
  run: Pick<BenchmarkRun, "id" | "status" | "competitor" | "competitorType" | "runtimeProvider" | "artifactName">;
  task: Pick<BenchmarkTask, "id" | "appid" | "gameName" | "title" | "track" | "level" | "objective" | "estimatedRuntimeMinutes">;
  permissions: {
    actionSpace: RuntimeControlSession["actionSpace"]["schemaVersion"];
    inputMode: RuntimeControlSession["actionSpace"]["inputMode"];
    transport: RuntimeControlSession["actionSpace"]["transport"];
    allowedActionTypes: RuntimeControlSession["actionSpace"]["allowedActionTypes"];
    controller: RuntimeControlSession["actionSpace"]["controller"];
    constraints: RuntimeControlSession["actionSpace"]["constraints"];
    privilegedSystemInput: false;
    canonicalCaptureRequired: true;
    forbiddenActions: string[];
  };
  bridge: {
    provider: "geforce-now";
    ready: boolean;
    inputMode: RuntimeControlSession["actionSpace"]["inputMode"];
    transport: RuntimeControlSession["actionSpace"]["transport"];
    manifestSchemaVersion: "steambench.control-bridge-manifest.v1";
    executor: {
      command: "npm run executor:geforce-now";
      requestSchemaVersion: "steambench.controller-executor-request.v1";
      reportSchemaVersion: "steambench.controller-executor-report.v1";
      executionPlanSchemaVersion: "steambench.controller-execution-plan.v1";
      target: "xinput-standard";
      timing: "relative-ms";
      neutralOnCompletion: true;
    };
    handoff: {
      readManifest: string;
      submitActions: string;
      heartbeat: string;
      reportBack: string;
      reportBackMode: "typed-controller-executor-report-submission";
    };
    checklist: string[];
  };
  endpoints: {
    actionBatch: string;
    bridgeManifest: string;
    heartbeat: string;
    revoke: string;
    trace: string;
    traceAudit: string;
    playbook: string;
    submission: string;
    executorReport: string;
  };
  audit: {
    readyForActions: boolean;
    readyForBridge: boolean;
    blockers: string[];
    expectedExecutorReport?: "steambench.controller-executor-report.v1";
    canonicalArtifact: "output/output.mp4";
    acceptedArtifactName: "output.mp4";
    forbiddenArtifactNames: ["output-test.mp4"];
  };
};

function ttlRemainingSeconds(expiresAt: string): number {
  const remainingMs = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(remainingMs)) return 0;
  return Math.max(0, Math.floor(remainingMs / 1000));
}

export function buildRuntimeControlAccessPacket(input: {
  session: RuntimeControlSession;
  run: BenchmarkRun;
  task: BenchmarkTask;
  agent?: AgentProfile | null;
  generatedAt?: string;
}): RuntimeControlAccessPacket {
  const blockers = [];
  if (input.session.status !== "active") blockers.push("control_session_not_active");
  if (ttlRemainingSeconds(input.session.expiresAt) <= 0) blockers.push("control_session_expired");
  if (input.session.runId !== input.run.id) blockers.push("run_mismatch");
  if (input.session.taskId !== input.task.id) blockers.push("task_mismatch");
  if (input.session.actionSpace.permissions.privilegedSystemInput) blockers.push("privileged_system_input_enabled");
  if (!input.session.actionSpace.constraints.requireCanonicalCapture) blockers.push("canonical_capture_not_required");
  const readyForBridge = input.session.actionSpace.inputMode === "controller" &&
    input.session.actionSpace.transport === "virtual-controller" &&
    input.session.actionSpace.permissions.controller === true &&
    blockers.length === 0;

  return {
    schemaVersion: "steambench.runtime-control-access-packet.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    purpose: "bounded-agent-game-control",
    lease: {
      id: input.session.id,
      status: input.session.status,
      runId: input.session.runId,
      taskId: input.session.taskId,
      agentId: input.session.agentId,
      createdAt: input.session.createdAt,
      expiresAt: input.session.expiresAt,
      heartbeatAt: input.session.heartbeatAt,
      ttlRemainingSeconds: ttlRemainingSeconds(input.session.expiresAt)
    },
    principal: input.agent
      ? {
          type: "agent",
          id: input.agent.id,
          handle: input.agent.handle,
          displayName: input.agent.displayName,
          provider: input.agent.provider,
          runtimeProvider: input.agent.runtimeProvider
        }
      : {
          type: "unbound"
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
    permissions: {
      actionSpace: input.session.actionSpace.schemaVersion,
      inputMode: input.session.actionSpace.inputMode,
      transport: input.session.actionSpace.transport,
      allowedActionTypes: input.session.actionSpace.allowedActionTypes,
      controller: input.session.actionSpace.controller,
      constraints: input.session.actionSpace.constraints,
      privilegedSystemInput: false,
      canonicalCaptureRequired: true,
      forbiddenActions: input.session.actionSpace.constraints.forbiddenActions
    },
    bridge: {
      provider: "geforce-now",
      ready: readyForBridge,
      inputMode: input.session.actionSpace.inputMode,
      transport: input.session.actionSpace.transport,
      manifestSchemaVersion: "steambench.control-bridge-manifest.v1",
      executor: {
        command: "npm run executor:geforce-now",
        requestSchemaVersion: "steambench.controller-executor-request.v1",
        reportSchemaVersion: "steambench.controller-executor-report.v1",
        executionPlanSchemaVersion: "steambench.controller-execution-plan.v1",
        target: "xinput-standard",
        timing: "relative-ms",
        neutralOnCompletion: true
      },
      handoff: {
        readManifest: `/api/control-sessions/${input.session.id}/bridge-manifest`,
        submitActions: `/api/runs/${input.session.runId}/action-batches`,
        heartbeat: `/api/control-sessions/${input.session.id}/heartbeat`,
        reportBack: `/api/runs/${input.session.runId}/controller-executor-reports`,
        reportBackMode: "typed-controller-executor-report-submission"
      },
      checklist: [
        "Fetch the bridge manifest before sending controller actions.",
        "Only emit actions allowed by the runtime action space.",
        "Run the controller execution plan through the GeForce NOW executor.",
        "Append the executor report as a checkpoint event with executor metadata.",
        "Keep the lease alive with heartbeat until submission or revoke."
      ]
    },
    endpoints: {
      actionBatch: `/api/runs/${input.session.runId}/action-batches`,
      bridgeManifest: `/api/control-sessions/${input.session.id}/bridge-manifest`,
      heartbeat: `/api/control-sessions/${input.session.id}/heartbeat`,
      revoke: `/api/control-sessions/${input.session.id}/revoke`,
      trace: `/api/runs/${input.session.runId}/agent-trace`,
      traceAudit: `/api/runs/${input.session.runId}/agent-trace/audit`,
      playbook: `/api/runs/${input.session.runId}/agent-playbook${input.session.agentId ? `?agentId=${encodeURIComponent(input.session.agentId)}` : ""}`,
      submission: `/api/runs/${input.session.runId}/submission`,
      executorReport: `/api/runs/${input.session.runId}/controller-executor-reports`
    },
    audit: {
      readyForActions: blockers.length === 0,
      readyForBridge,
      blockers,
      expectedExecutorReport: readyForBridge ? "steambench.controller-executor-report.v1" : undefined,
      canonicalArtifact: "output/output.mp4",
      acceptedArtifactName: "output.mp4",
      forbiddenArtifactNames: ["output-test.mp4"]
    }
  };
}
