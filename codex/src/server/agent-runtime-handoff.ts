import type { BenchmarkTask } from "../benchmark/types";
import type { AgentActionTrace, AgentPlaybook } from "./agent-playbook";
import type { AgentProfile, BenchmarkRun, LiveStreamSession, RuntimeControlSession } from "./store";

export type AgentRuntimeHandoffStatus =
  | "ready-for-actions"
  | "needs-control-session"
  | "ready-for-submission"
  | "complete"
  | "blocked";

export type AgentRuntimeHandoff = {
  schemaVersion: "steambench.agent-runtime-handoff.v1";
  generatedAt: string;
  status: AgentRuntimeHandoffStatus;
  run: Pick<BenchmarkRun, "id" | "taskId" | "competitor" | "competitorType" | "status" | "runtimeProvider" | "artifactName" | "score">;
  task: Pick<BenchmarkTask, "id" | "appid" | "gameName" | "title" | "track" | "level" | "objective" | "estimatedRuntimeMinutes">;
  agent?: Pick<AgentProfile, "id" | "handle" | "displayName" | "provider" | "runtimeProvider" | "capabilities" | "status">;
  control: {
    inputMode: AgentPlaybook["control"]["inputMode"];
    transport: AgentPlaybook["control"]["actionSpace"]["transport"];
    allowedActionTypes: string[];
    requiresControlSession: boolean;
    activeSession?: Pick<RuntimeControlSession, "id" | "status" | "expiresAt" | "heartbeatAt"> & {
      accessPacket: string;
      bridgeManifest: string;
      executorReport: string;
    };
    sessions: Array<Pick<RuntimeControlSession, "id" | "status" | "expiresAt" | "heartbeatAt">>;
  };
  playbook: Pick<AgentPlaybook, "schemaVersion" | "objective" | "evidence"> & {
    loop: string[];
    stopConditions: string[];
  };
  trace: Pick<AgentActionTrace, "schemaVersion" | "totals" | "coverage" | "nextActions">;
  broadcast: {
    activeStream?: Pick<LiveStreamSession, "id" | "status" | "title" | "provider" | "playbackUrl" | "viewerCount" | "currentScene" | "startedAt" | "endedAt"> & {
      detail: string;
      evidenceBundle: string;
      resultCertificate: string;
      statusEndpoint: string;
    };
    streams: Array<Pick<LiveStreamSession, "id" | "status" | "title" | "provider" | "playbackUrl" | "viewerCount" | "currentScene" | "startedAt" | "endedAt">>;
  };
  blockers: string[];
  recommendedActions: Array<{
    id: "create-control-session" | "open-livestream" | "inspect-broadcast" | "submit-action-batch" | "run-agent-probe" | "submit-run" | "inspect-trace" | "inspect-bridge-manifest";
    label: string;
    priority: "high" | "medium" | "low";
    method: "GET" | "POST" | "CLI";
    endpoint?: string;
    command?: string;
    body?: Record<string, unknown>;
    reason: string;
  }>;
  endpoints: {
    playbook: string;
    trace: string;
    actionBatch: string;
    submission: string;
    controlSessions: string;
    activeAccessPacket?: string;
    activeBridgeManifest?: string;
    activeExecutorReport?: string;
    livestreams: string;
    activeBroadcast?: string;
    activeBroadcastEvidenceBundle?: string;
    activeBroadcastResultCertificate?: string;
    activeLivestreamStatus?: string;
    evidenceBundle: string;
    resultCertificate: string;
  };
};

function status(input: {
  run: BenchmarkRun;
  playbook: AgentPlaybook;
  trace: AgentActionTrace;
  activeSession?: RuntimeControlSession;
}): AgentRuntimeHandoffStatus {
  if (input.run.status === "scored") return "complete";
  if (input.run.status === "failed" || input.run.status === "canceled") return "blocked";
  const requiresControlSession = input.playbook.control.actionSpace.transport === "virtual-controller";
  if (requiresControlSession && !input.activeSession) return "needs-control-session";
  if (input.trace.coverage.readyForSubmission) return "ready-for-submission";
  return "ready-for-actions";
}

function blockers(input: {
  run: BenchmarkRun;
  playbook: AgentPlaybook;
  activeSession?: RuntimeControlSession;
}): string[] {
  const result = new Set<string>();
  if (input.run.status === "failed") result.add("run_failed");
  if (input.run.status === "canceled") result.add("run_canceled");
  if (input.playbook.control.actionSpace.transport === "virtual-controller" && !input.activeSession) {
    result.add("control_session_required");
  }
  if (input.playbook.evidence.canonicalArtifact !== "output/output.mp4") result.add("canonical_artifact_contract_mismatch");
  if (input.playbook.control.actionSpace.permissions.privilegedSystemInput) result.add("privileged_system_input_enabled");
  return [...result].sort();
}

function actions(input: {
  run: BenchmarkRun;
  status: AgentRuntimeHandoffStatus;
  playbook: AgentPlaybook;
  trace: AgentActionTrace;
  activeSession?: RuntimeControlSession;
  activeStream?: LiveStreamSession;
  agentId?: string;
}): AgentRuntimeHandoff["recommendedActions"] {
  const result: AgentRuntimeHandoff["recommendedActions"] = [];
  const agentQuery = input.agentId ? `?agentId=${encodeURIComponent(input.agentId)}` : "";
  if (input.status === "needs-control-session") {
    result.push({
      id: "create-control-session",
      label: "Create control session",
      priority: "high",
      method: "POST",
      endpoint: `/api/runs/${input.run.id}/control-sessions`,
      body: input.agentId ? { agentId: input.agentId, ttlSeconds: 900 } : { ttlSeconds: 900 },
      reason: "This run uses a virtual-controller action space and needs a bounded control lease before actions are accepted by a bridge."
    });
  }

  if (input.activeSession) {
    result.push({
      id: "inspect-bridge-manifest",
      label: "Inspect bridge manifest",
      priority: "medium",
      method: "GET",
      endpoint: `/api/control-sessions/${input.activeSession.id}/bridge-manifest`,
      reason: "The active control lease exposes the bridge-safe controller execution contract."
    });
  }

  if (input.activeStream) {
    result.push({
      id: "inspect-broadcast",
      label: "Inspect broadcast",
      priority: input.activeStream.status === "live" ? "medium" : "low",
      method: "GET",
      endpoint: `/api/broadcasts/${input.activeStream.id}`,
      reason: "The run has a gameplay stream attached; inspect broadcast proof, timeline, and public replay readiness."
    });
  } else if (input.status === "ready-for-actions" || input.status === "needs-control-session") {
    result.push({
      id: "open-livestream",
      label: "Open livestream",
      priority: "medium",
      method: "POST",
      endpoint: `/api/runs/${input.run.id}/livestreams`,
      body: {
        title: `${input.run.competitor} gameplay broadcast`
      },
      reason: "Open a gameplay stream before bridge actions so the run can produce broadcast evidence alongside the canonical capture."
    });
  }

  if (input.status === "ready-for-actions" || input.status === "needs-control-session") {
    result.push({
      id: "submit-action-batch",
      label: "Submit action batch",
      priority: input.status === "ready-for-actions" ? "high" : "medium",
      method: "POST",
      endpoint: input.playbook.eventContract.actionBatchEndpoint,
      body: {
        controlSessionId: input.activeSession?.id,
        observation: "Agent observed game state.",
        actions: input.playbook.control.actionSpace.examples
      },
      reason: "Submit a bounded batch from the declared runtime action space."
    });
    result.push({
      id: "run-agent-probe",
      label: "Run agent probe",
      priority: "medium",
      method: "CLI",
      command: `npm run agent:probe -- --run=${input.run.id}${input.agentId ? ` --agent=${input.agentId}` : ""} --execute=advance-probe`,
      reason: "Exercise the playbook, action batch endpoint, control lease, and trace in one local probe."
    });
  }

  if (input.status === "ready-for-submission") {
    result.push({
      id: "submit-run",
      label: "Submit run evidence",
      priority: "high",
      method: "POST",
      endpoint: input.playbook.eventContract.submissionEndpoint,
      body: {
        artifactPath: "output/output.mp4"
      },
      reason: "The action trace has observation and action coverage; submit canonical capture and proof when available."
    });
  }

  result.push({
    id: "inspect-trace",
    label: "Inspect agent trace",
    priority: "low",
    method: "GET",
    endpoint: `/api/runs/${input.run.id}/agent-trace${agentQuery}`,
    reason: "Inspect observed states, accepted action batches, and remaining proof/artifact work."
  });

  return result;
}

export function buildAgentRuntimeHandoff(input: {
  run: BenchmarkRun;
  task: BenchmarkTask;
  agent?: AgentProfile | null;
  playbook: AgentPlaybook;
  trace: AgentActionTrace;
  controlSessions: RuntimeControlSession[];
  streams?: LiveStreamSession[];
  generatedAt?: string;
}): AgentRuntimeHandoff {
  const activeSession = input.controlSessions.find((session) => session.status === "active");
  const streams = [...(input.streams ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activeStream = streams.find((stream) => stream.status === "live") ?? streams.find((stream) => stream.status === "scheduled") ?? streams[0];
  const currentStatus = status({
    run: input.run,
    playbook: input.playbook,
    trace: input.trace,
    activeSession
  });
  const agentQuery = input.agent?.id ? `?agentId=${encodeURIComponent(input.agent.id)}` : "";
  return {
    schemaVersion: "steambench.agent-runtime-handoff.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: currentStatus,
    run: {
      id: input.run.id,
      taskId: input.run.taskId,
      competitor: input.run.competitor,
      competitorType: input.run.competitorType,
      status: input.run.status,
      runtimeProvider: input.run.runtimeProvider,
      artifactName: input.run.artifactName,
      score: input.run.score
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
          capabilities: input.agent.capabilities,
          status: input.agent.status
        }
      : undefined,
    control: {
      inputMode: input.playbook.control.inputMode,
      transport: input.playbook.control.actionSpace.transport,
      allowedActionTypes: input.playbook.control.allowedActionTypes,
      requiresControlSession: input.playbook.control.actionSpace.transport === "virtual-controller",
      activeSession: activeSession
          ? {
            id: activeSession.id,
            status: activeSession.status,
            expiresAt: activeSession.expiresAt,
            heartbeatAt: activeSession.heartbeatAt,
            accessPacket: `/api/control-sessions/${activeSession.id}/access-packet`,
            bridgeManifest: `/api/control-sessions/${activeSession.id}/bridge-manifest`,
            executorReport: `/api/runs/${input.run.id}/controller-executor-reports`
          }
        : undefined,
      sessions: input.controlSessions.map((session) => ({
        id: session.id,
        status: session.status,
        expiresAt: session.expiresAt,
        heartbeatAt: session.heartbeatAt
      }))
    },
    playbook: {
      schemaVersion: input.playbook.schemaVersion,
      objective: input.playbook.objective,
      evidence: input.playbook.evidence,
      loop: input.playbook.control.loop,
      stopConditions: input.playbook.control.stopConditions
    },
    trace: {
      schemaVersion: input.trace.schemaVersion,
      totals: input.trace.totals,
      coverage: input.trace.coverage,
      nextActions: input.trace.nextActions
    },
    broadcast: {
      activeStream: activeStream
        ? {
            id: activeStream.id,
            status: activeStream.status,
            title: activeStream.title,
            provider: activeStream.provider,
            playbackUrl: activeStream.playbackUrl,
            viewerCount: activeStream.viewerCount,
            currentScene: activeStream.currentScene,
            startedAt: activeStream.startedAt,
            endedAt: activeStream.endedAt,
            detail: `/api/broadcasts/${activeStream.id}`,
            evidenceBundle: `/api/broadcasts/${activeStream.id}/evidence-bundle`,
            resultCertificate: `/api/broadcasts/${activeStream.id}/result-certificate`,
            statusEndpoint: `/api/livestreams/${activeStream.id}/status`
          }
        : undefined,
      streams: streams.map((stream) => ({
        id: stream.id,
        status: stream.status,
        title: stream.title,
        provider: stream.provider,
        playbackUrl: stream.playbackUrl,
        viewerCount: stream.viewerCount,
        currentScene: stream.currentScene,
        startedAt: stream.startedAt,
        endedAt: stream.endedAt
      }))
    },
    blockers: blockers({
      run: input.run,
      playbook: input.playbook,
      activeSession
    }),
    recommendedActions: actions({
      run: input.run,
      status: currentStatus,
      playbook: input.playbook,
      trace: input.trace,
      activeSession,
      activeStream,
      agentId: input.agent?.id
    }),
    endpoints: {
      playbook: `/api/runs/${input.run.id}/agent-playbook${agentQuery}`,
      trace: `/api/runs/${input.run.id}/agent-trace`,
      actionBatch: input.playbook.eventContract.actionBatchEndpoint,
      submission: input.playbook.eventContract.submissionEndpoint,
      controlSessions: `/api/runs/${input.run.id}/control-sessions`,
      activeAccessPacket: activeSession ? `/api/control-sessions/${activeSession.id}/access-packet` : undefined,
      activeBridgeManifest: activeSession ? `/api/control-sessions/${activeSession.id}/bridge-manifest` : undefined,
      activeExecutorReport: activeSession ? `/api/runs/${input.run.id}/controller-executor-reports` : undefined,
      livestreams: `/api/runs/${input.run.id}/livestreams`,
      activeBroadcast: activeStream ? `/api/broadcasts/${activeStream.id}` : undefined,
      activeBroadcastEvidenceBundle: activeStream ? `/api/broadcasts/${activeStream.id}/evidence-bundle` : undefined,
      activeBroadcastResultCertificate: activeStream ? `/api/broadcasts/${activeStream.id}/result-certificate` : undefined,
      activeLivestreamStatus: activeStream ? `/api/livestreams/${activeStream.id}/status` : undefined,
      evidenceBundle: `/api/runs/${input.run.id}/evidence-bundle${agentQuery}`,
      resultCertificate: `/api/runs/${input.run.id}/result-certificate${agentQuery}`
    }
  };
}
