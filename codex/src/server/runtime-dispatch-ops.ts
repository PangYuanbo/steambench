import type { BenchmarkTask } from "../benchmark/types";
import type { RunAuditSummary } from "./run-audit";
import type { AgentProfile, BenchmarkRun, RuntimeDispatch } from "./store";

export type RuntimeDispatchOpsAction = {
  id: string;
  label: string;
  priority: "high" | "medium" | "low";
  method: "GET" | "POST" | "CLI";
  endpoint?: string;
  command?: string;
  body?: Record<string, unknown>;
  reason: string;
};

export type RuntimeDispatchOpsEntry = {
  dispatch: RuntimeDispatch;
  run?: BenchmarkRun;
  task?: BenchmarkTask | null;
  agent?: AgentProfile;
  audit?: RunAuditSummary;
};

export type RuntimeDispatchOpsReport = {
  schemaVersion: "steambench.runtime-dispatch-ops-report.v1";
  generatedAt: string;
  status: "idle" | "needs-drain" | "needs-modal-launch" | "needs-attention" | "monitoring";
  filters: {
    provider?: RuntimeDispatch["provider"];
    statuses?: RuntimeDispatch["status"][];
    limit: number;
  };
  totals: {
    dispatches: number;
    selectedDispatches: number;
    byStatus: Record<RuntimeDispatch["status"], number>;
    byProvider: Record<RuntimeDispatch["provider"], number>;
    pendingLocal: number;
    pendingModal: number;
    active: number;
    completed: number;
    failed: number;
    canceled: number;
    scoreboardReady: number;
    proofMissing: number;
    inProgress: number;
    runFailed: number;
    missingRun: number;
    missingTask: number;
    workerQueued: number;
    workerLeased: number;
    workerExpired: number;
  };
  tickets: Array<{
    dispatch: RuntimeDispatch;
    run?: Pick<BenchmarkRun, "id" | "status" | "competitor" | "competitorType" | "runtimeProvider" | "score" | "artifactName" | "updatedAt">;
    task?: Pick<BenchmarkTask, "id" | "appid" | "gameName" | "title" | "track" | "level" | "score">;
    agent?: Pick<AgentProfile, "id" | "handle" | "displayName" | "provider" | "runtimeProvider" | "status">;
    audit?: RunAuditSummary;
    readiness: "scoreboard-ready" | "proof-missing" | "failed" | "in-progress" | "missing-run" | "missing-task";
    links: {
      dispatchStatus: string;
      run?: string;
      audit?: string;
      evidenceBundle?: string;
      resultCertificate?: string;
      modalPackage?: string;
    };
  }>;
  recommendedActions: RuntimeDispatchOpsAction[];
  links: {
    dispatches: string;
    workerQueue: string;
    requeueExpired: string;
  };
};

const dispatchStatuses: RuntimeDispatch["status"][] = ["planned", "launched", "claimed", "completed", "failed", "canceled"];
const dispatchProviders: RuntimeDispatch["provider"][] = ["local", "modal"];
const pendingDispatchStatuses = new Set<RuntimeDispatch["status"]>(["planned", "launched"]);
const activeDispatchStatuses = new Set<RuntimeDispatch["status"]>(["launched", "claimed"]);

function emptyStatusCounts(): Record<RuntimeDispatch["status"], number> {
  return Object.fromEntries(dispatchStatuses.map((status) => [status, 0])) as Record<RuntimeDispatch["status"], number>;
}

function emptyProviderCounts(): Record<RuntimeDispatch["provider"], number> {
  return Object.fromEntries(dispatchProviders.map((provider) => [provider, 0])) as Record<RuntimeDispatch["provider"], number>;
}

function readinessFor(entry: RuntimeDispatchOpsEntry): RuntimeDispatchOpsReport["tickets"][number]["readiness"] {
  if (!entry.run) return "missing-run";
  if (!entry.task) return "missing-task";
  if (entry.audit?.verdict) return entry.audit.verdict;
  return entry.run.status === "failed" ? "failed" : "in-progress";
}

function reportStatus(input: {
  totals: RuntimeDispatchOpsReport["totals"];
}): RuntimeDispatchOpsReport["status"] {
  if (input.totals.failed > 0 || input.totals.runFailed > 0 || input.totals.proofMissing > 0 || input.totals.missingRun > 0 || input.totals.missingTask > 0) {
    return "needs-attention";
  }
  if (input.totals.pendingLocal > 0) return "needs-drain";
  if (input.totals.pendingModal > 0) return "needs-modal-launch";
  if (input.totals.active > 0 || input.totals.inProgress > 0) return "monitoring";
  return "idle";
}

function buildActions(input: {
  tickets: RuntimeDispatchOpsReport["tickets"];
  totals: RuntimeDispatchOpsReport["totals"];
  filters: RuntimeDispatchOpsReport["filters"];
}): RuntimeDispatchOpsAction[] {
  const actions: RuntimeDispatchOpsAction[] = [];
  if (input.totals.workerExpired > 0) {
    actions.push({
      id: "requeue-expired-workers",
      label: "Requeue expired worker leases",
      priority: "high",
      method: "POST",
      endpoint: "/api/worker/requeue-expired",
      body: {
        reason: "Runtime dispatch ops report found expired leases.",
        maxRuns: input.totals.workerExpired
      },
      reason: `${input.totals.workerExpired} worker lease(s) are expired.`
    });
  }

  if (input.totals.pendingLocal > 0) {
    const statuses = input.filters.statuses?.join(",") || "planned,launched";
    const limit = Math.min(input.totals.pendingLocal, input.filters.limit);
    actions.push({
      id: "drain-local-dispatches",
      label: "Drain pending local dispatches",
      priority: "high",
      method: "CLI",
      command: `npm run dispatch:drain -- --provider=local --status=${statuses} --limit=${limit}`,
      reason: `${input.totals.pendingLocal} local dispatch ticket(s) are ready for worker execution.`
    });
  }

  const modalTicket = input.tickets.find((ticket) => ticket.dispatch.provider === "modal" && pendingDispatchStatuses.has(ticket.dispatch.status));
  if (modalTicket) {
    actions.push({
      id: "inspect-modal-package",
      label: "Fetch next Modal handoff package",
      priority: "medium",
      method: "GET",
      endpoint: `/api/dispatches/${modalTicket.dispatch.id}/modal-package`,
      reason: `Modal dispatch ${modalTicket.dispatch.id} needs a cloud launch handoff.`
    });
  }

  const failedTicket = input.tickets.find((ticket) => ticket.dispatch.status === "failed" || ticket.readiness === "failed");
  if (failedTicket?.run) {
    actions.push({
      id: "inspect-failed-run",
      label: "Inspect failed run audit",
      priority: "high",
      method: "GET",
      endpoint: `/api/runs/${failedTicket.run.id}/audit`,
      reason: `Run ${failedTicket.run.id} is failed or attached to a failed dispatch.`
    });
  }

  const proofMissingTicket = input.tickets.find((ticket) => ticket.readiness === "proof-missing");
  if (proofMissingTicket?.run) {
    actions.push({
      id: "inspect-proof-missing-run",
      label: "Inspect missing proof evidence",
      priority: "medium",
      method: "GET",
      endpoint: `/api/runs/${proofMissingTicket.run.id}/evidence-bundle`,
      reason: `Run ${proofMissingTicket.run.id} is not certificate-ready yet.`
    });
  }

  return actions;
}

export function buildRuntimeDispatchOpsReport(input: {
  dispatches: RuntimeDispatchOpsEntry[];
  provider?: RuntimeDispatch["provider"];
  statuses?: RuntimeDispatch["status"][];
  limit?: number;
  workerQueueTotals?: {
    queued: number;
    leased: number;
    expired: number;
  };
  generatedAt?: string;
}): RuntimeDispatchOpsReport {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
  const statusSet = input.statuses?.length ? new Set(input.statuses) : undefined;
  const selectedEntries = input.dispatches
    .filter((entry) => !input.provider || entry.dispatch.provider === input.provider)
    .filter((entry) => !statusSet || statusSet.has(entry.dispatch.status))
    .slice(0, limit);

  const byStatus = emptyStatusCounts();
  const byProvider = emptyProviderCounts();
  for (const entry of selectedEntries) {
    byStatus[entry.dispatch.status] += 1;
    byProvider[entry.dispatch.provider] += 1;
  }

  const tickets: RuntimeDispatchOpsReport["tickets"] = selectedEntries.map((entry) => {
    const readiness = readinessFor(entry);
    return {
      dispatch: entry.dispatch,
      run: entry.run
        ? {
            id: entry.run.id,
            status: entry.run.status,
            competitor: entry.run.competitor,
            competitorType: entry.run.competitorType,
            runtimeProvider: entry.run.runtimeProvider,
            score: entry.run.score,
            artifactName: entry.run.artifactName,
            updatedAt: entry.run.updatedAt
          }
        : undefined,
      task: entry.task
        ? {
            id: entry.task.id,
            appid: entry.task.appid,
            gameName: entry.task.gameName,
            title: entry.task.title,
            track: entry.task.track,
            level: entry.task.level,
            score: entry.task.score
          }
        : undefined,
      agent: entry.agent
        ? {
            id: entry.agent.id,
            handle: entry.agent.handle,
            displayName: entry.agent.displayName,
            provider: entry.agent.provider,
            runtimeProvider: entry.agent.runtimeProvider,
            status: entry.agent.status
          }
        : undefined,
      audit: entry.audit,
      readiness,
      links: {
        dispatchStatus: `/api/dispatches/${entry.dispatch.id}/status`,
        run: entry.run ? `/api/runs/${entry.run.id}` : undefined,
        audit: entry.run ? `/api/runs/${entry.run.id}/audit` : undefined,
        evidenceBundle: entry.run ? `/api/runs/${entry.run.id}/evidence-bundle` : undefined,
        resultCertificate: entry.run ? `/api/runs/${entry.run.id}/result-certificate` : undefined,
        modalPackage: entry.dispatch.provider === "modal" ? `/api/dispatches/${entry.dispatch.id}/modal-package` : undefined
      }
    };
  });

  const totals: RuntimeDispatchOpsReport["totals"] = {
    dispatches: input.dispatches.length,
    selectedDispatches: selectedEntries.length,
    byStatus,
    byProvider,
    pendingLocal: selectedEntries.filter((entry) => entry.dispatch.provider === "local" && pendingDispatchStatuses.has(entry.dispatch.status)).length,
    pendingModal: selectedEntries.filter((entry) => entry.dispatch.provider === "modal" && pendingDispatchStatuses.has(entry.dispatch.status)).length,
    active: selectedEntries.filter((entry) => activeDispatchStatuses.has(entry.dispatch.status)).length,
    completed: byStatus.completed,
    failed: byStatus.failed,
    canceled: byStatus.canceled,
    scoreboardReady: tickets.filter((ticket) => ticket.readiness === "scoreboard-ready").length,
    proofMissing: tickets.filter((ticket) => ticket.readiness === "proof-missing").length,
    inProgress: tickets.filter((ticket) => ticket.readiness === "in-progress").length,
    runFailed: tickets.filter((ticket) => ticket.readiness === "failed").length,
    missingRun: tickets.filter((ticket) => ticket.readiness === "missing-run").length,
    missingTask: tickets.filter((ticket) => ticket.readiness === "missing-task").length,
    workerQueued: input.workerQueueTotals?.queued ?? 0,
    workerLeased: input.workerQueueTotals?.leased ?? 0,
    workerExpired: input.workerQueueTotals?.expired ?? 0
  };

  return {
    schemaVersion: "steambench.runtime-dispatch-ops-report.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: reportStatus({ totals }),
    filters: {
      provider: input.provider,
      statuses: input.statuses,
      limit
    },
    totals,
    tickets,
    recommendedActions: buildActions({
      tickets,
      totals,
      filters: {
        provider: input.provider,
        statuses: input.statuses,
        limit
      }
    }),
    links: {
      dispatches: "/api/dispatches",
      workerQueue: "/api/worker/queue",
      requeueExpired: "/api/worker/requeue-expired"
    }
  };
}
