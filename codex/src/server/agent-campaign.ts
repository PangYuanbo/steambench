import type { BenchmarkTask } from "../benchmark/types";
import type { RuntimeReadiness } from "../runtime/readiness";
import { buildAgentRuntimeLab, type AgentRuntimeLabTask } from "./agent-runtime-lab";
import type { AgentProfile, BenchmarkRun, RuntimeDispatch, StoreSnapshot } from "./store";

export type AgentBenchmarkCampaignPlanItem = {
  task: BenchmarkTask;
  readiness: RuntimeReadiness;
  reviewDecision: AgentRuntimeLabTask["reviewDecision"];
  priority: AgentRuntimeLabTask["priority"];
  reason: string;
  blockedByActiveRun?: BenchmarkRun;
  links?: AgentBenchmarkCampaignLinks;
};

export type AgentBenchmarkCampaignLinks = {
  manifestUrl: string;
  runtimePackageUrl: string;
  playbookUrl: string;
  traceUrl: string;
  submissionUrl: string;
};

export type AgentBenchmarkCampaignPlan = {
  schemaVersion: "steambench.agent-campaign.v1";
  agent: AgentProfile;
  provider: RuntimeDispatch["provider"];
  requestedTaskCount: number;
  eligibleTaskCount: number;
  selectedTaskCount: number;
  reviewApproved: boolean;
  dispatch: boolean;
  items: AgentBenchmarkCampaignPlanItem[];
  skipped: AgentBenchmarkCampaignPlanItem[];
  totals: {
    recommended: number;
    ready: number;
    review: number;
    blocked: number;
    skippedActive: number;
  };
};

export function buildAgentCampaignLinks(runId: string, agentId: string): AgentBenchmarkCampaignLinks {
  const agentQuery = `?agentId=${encodeURIComponent(agentId)}`;
  return {
    manifestUrl: `/api/runs/${runId}/execution-manifest${agentQuery}`,
    runtimePackageUrl: `/api/runs/${runId}/runtime-package${agentQuery}`,
    playbookUrl: `/api/runs/${runId}/agent-playbook${agentQuery}`,
    traceUrl: `/api/runs/${runId}/agent-trace`,
    submissionUrl: `/api/runs/${runId}/submission`
  };
}

function runBelongsToAgent(run: BenchmarkRun, agent: AgentProfile): boolean {
  return run.competitor === `agent:${agent.handle}` || run.competitor === agent.handle || run.competitor === agent.displayName;
}

function activeRunForTask(snapshot: StoreSnapshot, agent: AgentProfile, taskId: string): BenchmarkRun | undefined {
  return snapshot.runs.find((run) =>
    runBelongsToAgent(run, agent) &&
    run.taskId === taskId &&
    (run.status === "queued" || run.status === "preparing" || run.status === "running")
  );
}

function isSelectable(entry: Pick<AgentRuntimeLabTask, "readiness" | "priority">, reviewApproved: boolean): boolean {
  if (!entry.readiness.ready) return false;
  if (entry.priority === "ready") return true;
  return reviewApproved && entry.priority === "review";
}

export function buildAgentBenchmarkCampaignPlan(input: {
  agent: AgentProfile;
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
  provider: RuntimeDispatch["provider"];
  requestedTaskCount: number;
  reviewApproved?: boolean;
  dispatch?: boolean;
}): AgentBenchmarkCampaignPlan {
  const reviewApproved = Boolean(input.reviewApproved);
  const dispatch = input.dispatch ?? true;
  const requestedTaskCount = Math.max(1, Math.floor(input.requestedTaskCount));
  const lab = buildAgentRuntimeLab({
    agent: input.agent,
    snapshot: input.snapshot,
    tasks: input.tasks,
    limit: input.tasks.length
  });

  const recommended = lab.recommendedTasks.map((entry) => ({
    task: entry.task,
    readiness: entry.readiness,
    reviewDecision: entry.reviewDecision,
    priority: entry.priority,
    reason: entry.reason,
    blockedByActiveRun: activeRunForTask(input.snapshot, input.agent, entry.task.id)
  }));
  const skipped = recommended.filter((entry) => entry.blockedByActiveRun);
  const eligible = recommended.filter((entry) => !entry.blockedByActiveRun && isSelectable(entry, reviewApproved));
  const items = eligible.slice(0, requestedTaskCount);

  return {
    schemaVersion: "steambench.agent-campaign.v1",
    agent: input.agent,
    provider: input.provider,
    requestedTaskCount,
    eligibleTaskCount: eligible.length,
    selectedTaskCount: items.length,
    reviewApproved,
    dispatch,
    items,
    skipped,
    totals: {
      recommended: recommended.length,
      ready: recommended.filter((entry) => entry.priority === "ready").length,
      review: recommended.filter((entry) => entry.priority === "review").length,
      blocked: recommended.filter((entry) => entry.priority === "blocked").length,
      skippedActive: skipped.length
    }
  };
}
