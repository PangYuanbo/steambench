import type { BenchmarkTask } from "../benchmark/types";
import type { RuntimeRunEvent } from "../runtime/events";
import { buildAgentTraceAuditReport, type AgentTraceAuditReport, type AgentTraceAuditVerdict } from "./agent-trace-audit";
import type { BenchmarkRun, RuntimeControlSession } from "./store";

export type AgentTraceOpsTicket = {
  run: Pick<BenchmarkRun, "id" | "taskId" | "competitor" | "competitorType" | "status" | "runtimeProvider" | "updatedAt">;
  task: Pick<BenchmarkTask, "id" | "appid" | "gameName" | "title" | "track" | "level">;
  verdict: AgentTraceAuditVerdict;
  readiness: "ready" | "attention" | "pending";
  audit: Pick<AgentTraceAuditReport, "totals" | "integrity" | "findings"> & {
    inputMode: AgentTraceAuditReport["actionSpace"]["inputMode"];
    transport: AgentTraceAuditReport["actionSpace"]["transport"];
    activeControlSessionId?: string;
  };
  links: {
    traceAudit: string;
    handoff: string;
    playbook: string;
    trace: string;
    actionBatch: string;
    controlSessions: string;
    evidenceBundle: string;
  };
};

export type AgentTraceOpsReport = {
  schemaVersion: "steambench.agent-trace-ops-report.v1";
  generatedAt: string;
  status: "ready" | "needs-runtime" | "needs-attention" | "idle";
  filters: {
    verdict?: AgentTraceAuditVerdict;
    limit: number;
  };
  totals: {
    agentRuns: number;
    selectedRuns: number;
    traceReady: number;
    needsActions: number;
    needsControlSession: number;
    needsExecutorReport: number;
    invalid: number;
    actions: number;
    controlSessions: number;
    executorReports: number;
    invalidFindings: number;
  };
  tickets: AgentTraceOpsTicket[];
  recommendedActions: Array<{
    id: "run-bridge-executor" | "create-control-session" | "submit-action-batch" | "inspect-invalid-trace" | "inspect-agent-handoff";
    label: string;
    priority: "high" | "medium" | "low";
    method: "GET" | "POST" | "CLI";
    endpoint?: string;
    command?: string;
    body?: Record<string, unknown>;
    reason: string;
  }>;
  links: {
    handoffs: "/api/agent-traces/ops-report";
    agents: "/api/agents/ops-report";
    bridgeOps: "/api/control-sessions/ops-report";
  };
};

function readiness(verdict: AgentTraceAuditVerdict): AgentTraceOpsTicket["readiness"] {
  if (verdict === "trace-ready") return "ready";
  if (verdict === "invalid") return "attention";
  return "pending";
}

function reportStatus(totals: AgentTraceOpsReport["totals"]): AgentTraceOpsReport["status"] {
  if (totals.invalid > 0) return "needs-attention";
  if (totals.needsActions + totals.needsControlSession + totals.needsExecutorReport > 0) return "needs-runtime";
  if (totals.traceReady > 0) return "ready";
  return "idle";
}

function actions(tickets: AgentTraceOpsTicket[]): AgentTraceOpsReport["recommendedActions"] {
  const result: AgentTraceOpsReport["recommendedActions"] = [];
  const invalid = tickets.find((ticket) => ticket.verdict === "invalid");
  if (invalid) {
    result.push({
      id: "inspect-invalid-trace",
      label: "Inspect invalid trace",
      priority: "high",
      method: "GET",
      endpoint: invalid.links.traceAudit,
      reason: `${invalid.run.id} has trace integrity errors that must be fixed before publication.`
    });
  }

  const needsExecutor = tickets.find((ticket) => ticket.verdict === "needs-executor-report");
  if (needsExecutor) {
    result.push({
      id: "run-bridge-executor",
      label: "Run bridge executor",
      priority: result.length === 0 ? "high" : "medium",
      method: "CLI",
      command: needsExecutor.audit.activeControlSessionId
        ? `npm run bridge:control -- --session=${needsExecutor.audit.activeControlSessionId} --executor=audit`
        : `npm run bridge:control -- --run=${needsExecutor.run.id} --executor=audit`,
      reason: `${needsExecutor.run.id} has controller actions but no side-effect-free executor report.`
    });
  }

  const needsControl = tickets.find((ticket) => ticket.verdict === "needs-control-session");
  if (needsControl) {
    result.push({
      id: "create-control-session",
      label: "Create control session",
      priority: result.length === 0 ? "high" : "medium",
      method: "POST",
      endpoint: needsControl.links.controlSessions,
      body: { ttlSeconds: 900 },
      reason: `${needsControl.run.id} needs a bounded control lease before controller actions can be bridged.`
    });
  }

  const needsActions = tickets.find((ticket) => ticket.verdict === "needs-actions");
  if (needsActions) {
    result.push({
      id: "submit-action-batch",
      label: "Submit action batch",
      priority: result.length === 0 ? "high" : "medium",
      method: "POST",
      endpoint: needsActions.links.actionBatch,
      reason: `${needsActions.run.id} needs observation and action coverage.`
    });
  }

  const ticket = tickets[0];
  if (ticket) {
    result.push({
      id: "inspect-agent-handoff",
      label: "Inspect agent handoff",
      priority: "low",
      method: "GET",
      endpoint: ticket.links.handoff,
      reason: "Inspect the per-run handoff for playbook, trace coverage, leases, and next actions."
    });
  }
  return result;
}

export function buildAgentTraceOpsReport(input: {
  runs: BenchmarkRun[];
  tasks: BenchmarkTask[];
  events: RuntimeRunEvent[];
  controlSessions: RuntimeControlSession[];
  verdict?: AgentTraceAuditVerdict;
  limit?: number;
  generatedAt?: string;
}): AgentTraceOpsReport {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
  const agentRuns = input.runs.filter((run) => run.competitorType === "agent");
  const tickets = agentRuns
    .map((run): AgentTraceOpsTicket | null => {
      const task = tasksById.get(run.taskId);
      if (!task) return null;
      const runControlSessions = input.controlSessions.filter((session) => session.runId === run.id);
      const activeControlSession = runControlSessions.find((session) => session.status === "active");
      const audit = buildAgentTraceAuditReport({
        run,
        task,
        events: input.events.filter((event) => event.runId === run.id),
        controlSessions: runControlSessions,
        generatedAt: input.generatedAt
      });
      const opsVerdict: AgentTraceAuditVerdict =
        audit.actionSpace.transport === "virtual-controller" && !activeControlSession
          ? "needs-control-session"
          : audit.verdict;
      return {
        run: {
          id: run.id,
          taskId: run.taskId,
          competitor: run.competitor,
          competitorType: run.competitorType,
          status: run.status,
          runtimeProvider: run.runtimeProvider,
          updatedAt: run.updatedAt
        },
        task: {
          id: task.id,
          appid: task.appid,
          gameName: task.gameName,
          title: task.title,
          track: task.track,
          level: task.level
        },
        verdict: opsVerdict,
        readiness: readiness(opsVerdict),
        audit: {
          totals: audit.totals,
          integrity: audit.integrity,
          findings: audit.findings,
          inputMode: audit.actionSpace.inputMode,
          transport: audit.actionSpace.transport,
          activeControlSessionId: activeControlSession?.id
        },
        links: {
          traceAudit: `/api/runs/${run.id}/agent-trace/audit`,
          handoff: `/api/runs/${run.id}/agent-handoff`,
          playbook: `/api/runs/${run.id}/agent-playbook`,
          trace: `/api/runs/${run.id}/agent-trace`,
          actionBatch: `/api/runs/${run.id}/action-batches`,
          controlSessions: `/api/runs/${run.id}/control-sessions`,
          evidenceBundle: `/api/runs/${run.id}/evidence-bundle`
        }
      };
    })
    .filter((ticket): ticket is AgentTraceOpsTicket => Boolean(ticket))
    .filter((ticket) => !input.verdict || ticket.verdict === input.verdict)
    .sort((a, b) => {
      const priority = (ticket: AgentTraceOpsTicket) => {
        if (ticket.verdict === "invalid") return 0;
        if (ticket.verdict === "needs-executor-report") return 1;
        if (ticket.verdict === "needs-control-session") return 2;
        if (ticket.verdict === "needs-actions") return 3;
        return 4;
      };
      return priority(a) - priority(b) || b.run.updatedAt.localeCompare(a.run.updatedAt);
    })
    .slice(0, limit);
  const totals = {
    agentRuns: agentRuns.length,
    selectedRuns: tickets.length,
    traceReady: tickets.filter((ticket) => ticket.verdict === "trace-ready").length,
    needsActions: tickets.filter((ticket) => ticket.verdict === "needs-actions").length,
    needsControlSession: tickets.filter((ticket) => ticket.verdict === "needs-control-session").length,
    needsExecutorReport: tickets.filter((ticket) => ticket.verdict === "needs-executor-report").length,
    invalid: tickets.filter((ticket) => ticket.verdict === "invalid").length,
    actions: tickets.reduce((total, ticket) => total + ticket.audit.totals.actions, 0),
    controlSessions: tickets.reduce((total, ticket) => total + ticket.audit.totals.controlSessions, 0),
    executorReports: tickets.reduce((total, ticket) => total + ticket.audit.totals.executorReports, 0),
    invalidFindings: tickets.reduce((total, ticket) => total + ticket.audit.totals.invalidFindings, 0)
  };

  return {
    schemaVersion: "steambench.agent-trace-ops-report.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: reportStatus(totals),
    filters: {
      verdict: input.verdict,
      limit
    },
    totals,
    tickets,
    recommendedActions: actions(tickets),
    links: {
      handoffs: "/api/agent-traces/ops-report",
      agents: "/api/agents/ops-report",
      bridgeOps: "/api/control-sessions/ops-report"
    }
  };
}
