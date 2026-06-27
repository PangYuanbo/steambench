import type { RuntimeRunEvent } from "../runtime/events";
import type { BenchmarkTask } from "../benchmark/types";
import type { AgentProfile, BenchmarkRun, RuntimeControlSession } from "./store";

export type ControlBridgeOpsTicketStatus =
  | "ready-for-bridge"
  | "needs-executor-report"
  | "executor-validated"
  | "expired"
  | "revoked"
  | "not-controller"
  | "broken";

export type ControlBridgeOpsTicket = {
  session: Pick<RuntimeControlSession, "id" | "runId" | "taskId" | "agentId" | "status" | "createdAt" | "updatedAt" | "expiresAt" | "heartbeatAt"> & {
    transport: RuntimeControlSession["actionSpace"]["transport"];
    inputMode: RuntimeControlSession["actionSpace"]["inputMode"];
  };
  run?: Pick<BenchmarkRun, "id" | "status" | "competitor" | "competitorType" | "runtimeProvider" | "artifactName" | "eventCount" | "updatedAt">;
  task?: Pick<BenchmarkTask, "id" | "appid" | "gameName" | "title" | "track" | "level">;
  agent?: Pick<AgentProfile, "id" | "handle" | "displayName" | "provider" | "runtimeProvider" | "status">;
  status: ControlBridgeOpsTicketStatus;
  readiness: "ready" | "attention" | "closed";
  actionBatches: number;
  acceptedActions: number;
  executorReports: number;
  lastExecutorStatus?: string;
  lastExecutorProvider?: string;
  lastExecutorSideEffects?: boolean;
  blockers: string[];
  links: {
    bridgeManifest: string;
    actionBatch: string;
    heartbeat: string;
    revoke: string;
    trace: string;
    runAudit: string;
  };
};

export type ControlBridgeOpsReport = {
  schemaVersion: "steambench.control-bridge-ops-report.v1";
  generatedAt: string;
  status: "idle" | "ready-for-bridge" | "needs-executor-report" | "needs-attention";
  filters: {
    statuses?: RuntimeControlSession["status"][];
    transport?: RuntimeControlSession["actionSpace"]["transport"];
    limit: number;
  };
  totals: {
    sessions: number;
    selectedSessions: number;
    active: number;
    expired: number;
    revoked: number;
    virtualController: number;
    readyForBridge: number;
    needsExecutorReport: number;
    executorValidated: number;
    broken: number;
  };
  tickets: ControlBridgeOpsTicket[];
  recommendedActions: Array<{
    id: string;
    label: string;
    priority: "high" | "medium" | "low";
    method: "GET" | "POST" | "CLI";
    endpoint?: string;
    command?: string;
    body?: Record<string, unknown>;
    reason: string;
  }>;
  links: {
    controlSessions: "/api/control-sessions/ops-report";
    bridgeRunner: "npm run bridge:control";
  };
};

function metadataNumber(event: RuntimeRunEvent | undefined, key: string): number {
  const value = event?.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function metadataString(event: RuntimeRunEvent | undefined, key: string): string | undefined {
  const value = event?.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function metadataBoolean(event: RuntimeRunEvent | undefined, key: string): boolean | undefined {
  const value = event?.metadata?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function ticketStatus(input: {
  session: RuntimeControlSession;
  run?: BenchmarkRun;
  task?: BenchmarkTask;
  actionBatches: number;
  executorReports: number;
  lastExecutorSideEffects?: boolean;
  blockers: string[];
}): ControlBridgeOpsTicketStatus {
  if (!input.run || !input.task) return "broken";
  if (input.session.status === "expired") return "expired";
  if (input.session.status === "revoked") return "revoked";
  if (
    input.session.actionSpace.transport !== "virtual-controller" ||
    !input.session.actionSpace.permissions.controller ||
    input.session.actionSpace.inputMode !== "controller"
  ) {
    return "not-controller";
  }
  if (input.executorReports > 0 && input.lastExecutorSideEffects !== true) return "executor-validated";
  if (input.actionBatches > 0) return "needs-executor-report";
  return input.blockers.length === 0 ? "ready-for-bridge" : "broken";
}

function ticketReadiness(status: ControlBridgeOpsTicketStatus): ControlBridgeOpsTicket["readiness"] {
  if (status === "ready-for-bridge" || status === "executor-validated") return "ready";
  if (status === "expired" || status === "revoked") return "closed";
  return "attention";
}

function reportStatus(totals: ControlBridgeOpsReport["totals"]): ControlBridgeOpsReport["status"] {
  if (totals.broken > 0 || totals.expired > 0) return "needs-attention";
  if (totals.needsExecutorReport > 0) return "needs-executor-report";
  if (totals.readyForBridge > 0) return "ready-for-bridge";
  return "idle";
}

function recommendedActions(tickets: ControlBridgeOpsTicket[]): ControlBridgeOpsReport["recommendedActions"] {
  const actions: ControlBridgeOpsReport["recommendedActions"] = [];
  const needsExecutor = tickets.find((ticket) => ticket.status === "needs-executor-report");
  if (needsExecutor) {
    actions.push({
      id: "run-control-bridge",
      label: "Run control bridge executor",
      priority: "high",
      method: "CLI",
      command: `npm run bridge:control -- --session=${needsExecutor.session.id} --executor=audit`,
      reason: `Control session ${needsExecutor.session.id} has action batches without a persisted executor report.`
    });
  }

  const ready = tickets.find((ticket) => ticket.status === "ready-for-bridge");
  if (ready) {
    actions.push({
      id: "inspect-bridge-manifest",
      label: "Inspect bridge manifest",
      priority: actions.length === 0 ? "high" : "medium",
      method: "GET",
      endpoint: ready.links.bridgeManifest,
      reason: `Control session ${ready.session.id} is active with virtual-controller permissions.`
    });
  }

  const activeWithoutHeartbeat = tickets.find((ticket) => ticket.session.status === "active" && !ticket.session.heartbeatAt);
  if (activeWithoutHeartbeat) {
    actions.push({
      id: "heartbeat-control-session",
      label: "Heartbeat active lease",
      priority: "medium",
      method: "POST",
      endpoint: activeWithoutHeartbeat.links.heartbeat,
      reason: `Control session ${activeWithoutHeartbeat.session.id} has not recorded a bridge heartbeat yet.`
    });
  }

  const expired = tickets.find((ticket) => ticket.status === "expired");
  if (expired) {
    actions.push({
      id: "revoke-expired-control-session",
      label: "Revoke expired lease",
      priority: "low",
      method: "POST",
      endpoint: expired.links.revoke,
      body: {
        summary: "Revoked after bridge ops detected an expired control lease."
      },
      reason: `Control session ${expired.session.id} is expired and should not accept action batches.`
    });
  }

  return actions;
}

export function buildControlBridgeOpsReport(input: {
  sessions: RuntimeControlSession[];
  runs: BenchmarkRun[];
  tasks: BenchmarkTask[];
  agents: AgentProfile[];
  events: RuntimeRunEvent[];
  statuses?: RuntimeControlSession["status"][];
  transport?: RuntimeControlSession["actionSpace"]["transport"];
  limit?: number;
  generatedAt?: string;
}): ControlBridgeOpsReport {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
  const statusSet = input.statuses?.length ? new Set(input.statuses) : undefined;
  const selectedSessions = input.sessions
    .filter((session) => !statusSet || statusSet.has(session.status))
    .filter((session) => !input.transport || session.actionSpace.transport === input.transport)
    .slice(0, limit);
  const tickets = selectedSessions.map((session): ControlBridgeOpsTicket => {
    const run = input.runs.find((entry) => entry.id === session.runId);
    const task = input.tasks.find((entry) => entry.id === session.taskId);
    const agent = session.agentId ? input.agents.find((entry) => entry.id === session.agentId) : undefined;
    const runEvents = input.events.filter((event) => event.runId === session.runId);
    const acts = runEvents.filter((event) => event.type === "act");
    const executorReports = runEvents.filter(
      (event) =>
        event.metadata?.executorReport === "steambench.controller-executor-report.v1" &&
        event.metadata?.controlSessionId === session.id
    );
    const lastExecutor = executorReports.at(-1);
    const blockers = [];
    if (!run) blockers.push("run_missing");
    if (!task) blockers.push("task_missing");
    if (session.status !== "active") blockers.push(`control_session_${session.status}`);
    if (session.actionSpace.transport !== "virtual-controller") blockers.push("transport_not_virtual_controller");
    if (!session.actionSpace.permissions.controller) blockers.push("controller_permission_missing");
    if (session.actionSpace.permissions.privilegedSystemInput) blockers.push("privileged_system_input_enabled");

    const acceptedActions = acts.reduce((total, event) => total + metadataNumber(event, "actionCount"), 0);
    const status = ticketStatus({
      session,
      run,
      task,
      actionBatches: acts.length,
      executorReports: executorReports.length,
      lastExecutorSideEffects: metadataBoolean(lastExecutor, "sideEffects"),
      blockers
    });

    return {
      session: {
        id: session.id,
        runId: session.runId,
        taskId: session.taskId,
        agentId: session.agentId,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt,
        heartbeatAt: session.heartbeatAt,
        transport: session.actionSpace.transport,
        inputMode: session.actionSpace.inputMode
      },
      run: run
        ? {
            id: run.id,
            status: run.status,
            competitor: run.competitor,
            competitorType: run.competitorType,
            runtimeProvider: run.runtimeProvider,
            artifactName: run.artifactName,
            eventCount: run.eventCount,
            updatedAt: run.updatedAt
          }
        : undefined,
      task: task
        ? {
            id: task.id,
            appid: task.appid,
            gameName: task.gameName,
            title: task.title,
            track: task.track,
            level: task.level
          }
        : undefined,
      agent: agent
        ? {
            id: agent.id,
            handle: agent.handle,
            displayName: agent.displayName,
            provider: agent.provider,
            runtimeProvider: agent.runtimeProvider,
            status: agent.status
          }
        : undefined,
      status,
      readiness: ticketReadiness(status),
      actionBatches: acts.length,
      acceptedActions,
      executorReports: executorReports.length,
      lastExecutorStatus: metadataString(lastExecutor, "executorStatus"),
      lastExecutorProvider: metadataString(lastExecutor, "executorProvider"),
      lastExecutorSideEffects: metadataBoolean(lastExecutor, "sideEffects"),
      blockers,
      links: {
        bridgeManifest: `/api/control-sessions/${session.id}/bridge-manifest`,
        actionBatch: `/api/runs/${session.runId}/action-batches`,
        heartbeat: `/api/control-sessions/${session.id}/heartbeat`,
        revoke: `/api/control-sessions/${session.id}/revoke`,
        trace: `/api/runs/${session.runId}/agent-trace`,
        runAudit: `/api/runs/${session.runId}/audit`
      }
    };
  });

  const totals: ControlBridgeOpsReport["totals"] = {
    sessions: input.sessions.length,
    selectedSessions: tickets.length,
    active: tickets.filter((ticket) => ticket.session.status === "active").length,
    expired: tickets.filter((ticket) => ticket.status === "expired").length,
    revoked: tickets.filter((ticket) => ticket.status === "revoked").length,
    virtualController: tickets.filter((ticket) => ticket.session.transport === "virtual-controller").length,
    readyForBridge: tickets.filter((ticket) => ticket.status === "ready-for-bridge").length,
    needsExecutorReport: tickets.filter((ticket) => ticket.status === "needs-executor-report").length,
    executorValidated: tickets.filter((ticket) => ticket.status === "executor-validated").length,
    broken: tickets.filter((ticket) => ticket.status === "broken").length
  };

  return {
    schemaVersion: "steambench.control-bridge-ops-report.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: reportStatus(totals),
    filters: {
      statuses: input.statuses,
      transport: input.transport,
      limit
    },
    totals,
    tickets,
    recommendedActions: recommendedActions(tickets),
    links: {
      controlSessions: "/api/control-sessions/ops-report",
      bridgeRunner: "npm run bridge:control"
    }
  };
}
