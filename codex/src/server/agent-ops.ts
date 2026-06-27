import type { RuntimeDispatch } from "./store";
import { buildAgentRuntimeLab, type AgentRuntimeLab } from "./agent-runtime-lab";
import type { AgentProfile, StoreSnapshot } from "./store";
import type { BenchmarkTask } from "../benchmark/types";
import { buildRuntimeActionSpace } from "../runtime/action-space";
import { adapterForGame } from "../runtime/game-adapters";

export type AgentOpsTicketStatus =
  | "ready-for-campaign"
  | "queued"
  | "running"
  | "failed"
  | "paused"
  | "blocked";

export type AgentOpsTicket = {
  agent: Pick<AgentProfile, "id" | "handle" | "displayName" | "provider" | "runtimeProvider" | "status" | "capabilities">;
  status: AgentOpsTicketStatus;
  readiness: "ready" | "attention" | "blocked";
  lab: {
    status: AgentRuntimeLab["status"];
    totals: AgentRuntimeLab["totals"];
    queue: {
      nextRunId?: string;
      activeRuns: number;
      queuedRuns: number;
      expiredRuns: number;
    };
    recommendedReadyTasks: number;
    recommendedReviewTasks: number;
    recommendedBlockedTasks: number;
    missingCapabilities: string[];
  };
  nextTask?: Pick<BenchmarkTask, "id" | "appid" | "gameName" | "title" | "track" | "level">;
  links: {
    lab: string;
    campaignPlan: string;
    createCampaign: string;
    openRunSession?: string;
    queueRun?: string;
    nextRun?: string;
    nextRunDispatch?: string;
  };
};

export type AgentOpsReport = {
  schemaVersion: "steambench.agent-ops-report.v1";
  generatedAt: string;
  status: "ready-for-campaign" | "needs-dispatch" | "needs-attention" | "idle";
  filters: {
    provider?: RuntimeDispatch["provider"];
    limit: number;
  };
  totals: {
    agents: number;
    selectedAgents: number;
    active: number;
    paused: number;
    readyForCampaign: number;
    queuedAgents: number;
    runningAgents: number;
    failedAgents: number;
    blockedAgents: number;
    queuedRuns: number;
    activeRuns: number;
    failedRuns: number;
    readyRecommendedTasks: number;
    missingCapabilities: string[];
  };
  tickets: AgentOpsTicket[];
  recommendedActions: Array<{
    id: "open-agent-run-session" | "create-agent-campaign" | "inspect-agent-lab" | "drain-dispatches" | "inspect-failed-agent-run" | "activate-agent";
    label: string;
    priority: "high" | "medium" | "low";
    method: "GET" | "POST" | "CLI";
    endpoint?: string;
    command?: string;
    body?: Record<string, unknown>;
    reason: string;
  }>;
  links: {
    agents: "/api/agents";
    dispatchOps: "/api/dispatches/ops-report";
    campaignStandings: "/api/campaign-standings";
  };
};

function ticketStatus(agent: AgentProfile, lab: AgentRuntimeLab): AgentOpsTicketStatus {
  if (agent.status === "paused") return "paused";
  if (lab.totals.failedRuns > 0) return "failed";
  if (lab.totals.activeRuns > 0) return "running";
  if (lab.totals.queuedRuns > 0) return "queued";
  if (lab.recommendedTasks.some((entry) => entry.priority === "ready" && entry.readiness.ready)) return "ready-for-campaign";
  return "blocked";
}

function readiness(status: AgentOpsTicketStatus): AgentOpsTicket["readiness"] {
  if (status === "ready-for-campaign" || status === "queued" || status === "running") return "ready";
  if (status === "failed") return "attention";
  return "blocked";
}

function reportStatus(totals: AgentOpsReport["totals"]): AgentOpsReport["status"] {
  if (totals.failedAgents > 0 || totals.blockedAgents > 0) return "needs-attention";
  if (totals.queuedRuns + totals.activeRuns > 0) return "needs-dispatch";
  if (totals.readyForCampaign > 0) return "ready-for-campaign";
  return "idle";
}

function isVirtualControllerTask(task: BenchmarkTask): boolean {
  const adapter = adapterForGame(task);
  const actionSpace = buildRuntimeActionSpace({ adapter, task });
  return actionSpace.inputMode === "controller" && actionSpace.transport === "virtual-controller";
}

function selectNextRunSessionTask(lab: AgentRuntimeLab): BenchmarkTask | undefined {
  const readyTasks = lab.recommendedTasks
    .filter((entry) => entry.priority === "ready" && entry.readiness.ready)
    .map((entry) => entry.task);
  return readyTasks.find(isVirtualControllerTask) ?? readyTasks[0];
}

function actions(tickets: AgentOpsTicket[], provider: RuntimeDispatch["provider"]): AgentOpsReport["recommendedActions"] {
  const result: AgentOpsReport["recommendedActions"] = [];
  const ready = tickets.find((ticket) => ticket.status === "ready-for-campaign");
  if (ready) {
    result.push({
      id: "open-agent-run-session",
      label: "Open agent run session",
      priority: "high",
      method: "POST",
      endpoint: ready.links.openRunSession,
      body: ready.nextTask
        ? {
            taskId: ready.nextTask.id,
            ttlSeconds: 900
          }
        : undefined,
      reason: `${ready.agent.handle} can start ${ready.nextTask?.gameName ?? "the next ready task"} as a bounded runtime session.`
    });
    result.push({
      id: "create-agent-campaign",
      label: "Create agent campaign",
      priority: "medium",
      method: "POST",
      endpoint: ready.links.createCampaign,
      body: {
        provider,
        dispatch: true,
        limit: Math.min(3, ready.lab.recommendedReadyTasks)
      },
      reason: `${ready.agent.handle} has ${ready.lab.recommendedReadyTasks} ready task recommendation(s).`
    });
  }

  const queued = tickets.find((ticket) => ticket.lab.totals.queuedRuns > 0);
  if (queued) {
    result.push({
      id: "drain-dispatches",
      label: "Drain queued dispatches",
      priority: result.length === 0 ? "high" : "medium",
      method: "CLI",
      command: `npm run dispatch:ops -- --provider=${provider} --status=planned,launched`,
      reason: `${queued.agent.handle} has queued run(s) that need dispatch execution.`
    });
  }

  const failed = tickets.find((ticket) => ticket.status === "failed");
  if (failed?.links.nextRun) {
    result.push({
      id: "inspect-failed-agent-run",
      label: "Inspect failed agent run",
      priority: "high",
      method: "GET",
      endpoint: `${failed.links.nextRun}/audit`,
      reason: `${failed.agent.handle} has failed run(s) that should be triaged before more campaigns.`
    });
  }

  const paused = tickets.find((ticket) => ticket.status === "paused");
  if (paused) {
    result.push({
      id: "activate-agent",
      label: "Activate paused agent",
      priority: result.length === 0 ? "high" : "medium",
      method: "POST",
      endpoint: `/api/agents/${paused.agent.id}/status`,
      body: { status: "active" },
      reason: `${paused.agent.handle} is paused and cannot queue benchmark runs.`
    });
  }

  const ticket = tickets[0];
  if (ticket) {
    result.push({
      id: "inspect-agent-lab",
      label: "Inspect agent runtime lab",
      priority: "low",
      method: "GET",
      endpoint: ticket.links.lab,
      reason: "Inspect detailed readiness, queue state, recent evidence, and recommended tasks."
    });
  }

  return result;
}

export function buildAgentOpsReport(input: {
  agents: AgentProfile[];
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
  provider?: RuntimeDispatch["provider"];
  limit?: number;
  generatedAt?: string;
}): AgentOpsReport {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
  const provider = input.provider ?? "local";
  const selectedAgents = input.agents.slice(0, limit);
  const tickets = selectedAgents.map((agent): AgentOpsTicket => {
    const lab = buildAgentRuntimeLab({
      agent,
      snapshot: input.snapshot,
      tasks: input.tasks,
      limit: 8
    });
    const status = ticketStatus(agent, lab);
    const nextTask = selectNextRunSessionTask(lab);
    const nextRun = lab.queue.nextRun ?? lab.queue.activeRuns[0] ?? lab.recentRuns.find((run) => run.status === "failed");
    return {
      agent: {
        id: agent.id,
        handle: agent.handle,
        displayName: agent.displayName,
        provider: agent.provider,
        runtimeProvider: agent.runtimeProvider,
        status: agent.status,
        capabilities: agent.capabilities
      },
      status,
      readiness: readiness(status),
      lab: {
        status: lab.status,
        totals: lab.totals,
        queue: {
          nextRunId: lab.queue.nextRun?.id,
          activeRuns: lab.queue.activeRuns.length,
          queuedRuns: lab.queue.queuedRuns.length,
          expiredRuns: lab.queue.expiredRuns.length
        },
        recommendedReadyTasks: lab.recommendedTasks.filter((entry) => entry.priority === "ready").length,
        recommendedReviewTasks: lab.recommendedTasks.filter((entry) => entry.priority === "review").length,
        recommendedBlockedTasks: lab.recommendedTasks.filter((entry) => entry.priority === "blocked").length,
        missingCapabilities: lab.capabilities.missingAcrossRecommended
      },
      nextTask: nextTask
        ? {
            id: nextTask.id,
            appid: nextTask.appid,
            gameName: nextTask.gameName,
            title: nextTask.title,
            track: nextTask.track,
            level: nextTask.level
          }
        : undefined,
      links: {
        lab: `/api/agents/${agent.id}/lab`,
        campaignPlan: `/api/agents/${agent.id}/campaign-plan?provider=${provider}`,
        createCampaign: `/api/agents/${agent.id}/campaigns`,
        openRunSession: nextTask ? `/api/agents/${agent.id}/run-session` : undefined,
        queueRun: nextTask ? `/api/agents/${agent.id}/runs` : undefined,
        nextRun: nextRun ? `/api/runs/${nextRun.id}` : undefined,
        nextRunDispatch: nextRun ? `/api/runs/${nextRun.id}/dispatch` : undefined
      }
    };
  });
  const totals = {
    agents: input.agents.length,
    selectedAgents: selectedAgents.length,
    active: selectedAgents.filter((agent) => agent.status === "active").length,
    paused: selectedAgents.filter((agent) => agent.status === "paused").length,
    readyForCampaign: tickets.filter((ticket) => ticket.status === "ready-for-campaign").length,
    queuedAgents: tickets.filter((ticket) => ticket.status === "queued").length,
    runningAgents: tickets.filter((ticket) => ticket.status === "running").length,
    failedAgents: tickets.filter((ticket) => ticket.status === "failed").length,
    blockedAgents: tickets.filter((ticket) => ticket.status === "blocked").length,
    queuedRuns: tickets.reduce((total, ticket) => total + ticket.lab.totals.queuedRuns, 0),
    activeRuns: tickets.reduce((total, ticket) => total + ticket.lab.totals.activeRuns, 0),
    failedRuns: tickets.reduce((total, ticket) => total + ticket.lab.totals.failedRuns, 0),
    readyRecommendedTasks: tickets.reduce((total, ticket) => total + ticket.lab.recommendedReadyTasks, 0),
    missingCapabilities: [...new Set(tickets.flatMap((ticket) => ticket.lab.missingCapabilities))].sort()
  };

  return {
    schemaVersion: "steambench.agent-ops-report.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: reportStatus(totals),
    filters: {
      provider: input.provider,
      limit
    },
    totals,
    tickets,
    recommendedActions: actions(tickets, provider),
    links: {
      agents: "/api/agents",
      dispatchOps: "/api/dispatches/ops-report",
      campaignStandings: "/api/campaign-standings"
    }
  };
}
