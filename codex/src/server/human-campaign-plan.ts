import type { BenchmarkTask } from "../benchmark/types";
import type { AgentBenchmarkCampaignReport } from "./agent-campaign-report";
import { buildHumanSteamProofPlan, type HumanSteamProofPlanItem } from "./human-steam-proof-plan";
import type { StoreSnapshot, UserAccount } from "./store";

export type HumanBenchmarkCampaignPlanItem = HumanSteamProofPlanItem & {
  campaignTaskIndex: number;
  agentRunId?: string;
  agentScore?: number;
};

export type HumanBenchmarkCampaignPlan = {
  schemaVersion: "steambench.human-campaign-plan.v1";
  user: UserAccount;
  steamid?: string;
  status: "ready" | "blocked" | "complete";
  source: {
    type: "agent-campaign" | "task-catalog";
    campaignId?: string;
    agentId?: string;
    agentName?: string;
  };
  totals: {
    tasks: number;
    ready: number;
    alreadyScored: number;
    blocked: number;
    achievementTasks: number;
    manualTasks: number;
    completionRate: number;
    agentScore: number;
    humanScore: number;
  };
  items: HumanBenchmarkCampaignPlanItem[];
  links: {
    proofPlan: string;
    submitNext?: string;
    comparison?: string;
    comparisonEvidenceBundle?: string;
    comparisonResultCertificate?: string;
  };
};

function campaignTasks(input: {
  campaignReport?: AgentBenchmarkCampaignReport;
  tasks: BenchmarkTask[];
  limit: number;
}): BenchmarkTask[] {
  if (!input.campaignReport) return input.tasks.slice(0, input.limit);
  return input.campaignReport.items
    .flatMap((item) => item.task ? [item.task] : [])
    .slice(0, input.limit);
}

export function buildHumanBenchmarkCampaignPlan(input: {
  user: UserAccount;
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
  campaignReport?: AgentBenchmarkCampaignReport;
  limit?: number;
}): HumanBenchmarkCampaignPlan {
  const limit = input.limit ?? 8;
  const selectedTasks = campaignTasks({
    campaignReport: input.campaignReport,
    tasks: input.tasks,
    limit
  });
  const proofPlan = buildHumanSteamProofPlan({
    user: input.user,
    snapshot: input.snapshot,
    tasks: selectedTasks,
    limit: selectedTasks.length
  });
  const items = proofPlan.items.map((item, index): HumanBenchmarkCampaignPlanItem => {
    const agentItem = input.campaignReport?.items.find((entry) => entry.task?.id === item.task.id);
    return {
      ...item,
      campaignTaskIndex: index,
      agentRunId: agentItem?.run?.id,
      agentScore: agentItem?.scoreboardRow?.score
    };
  });
  const blocked = items.filter((item) =>
    item.status === "steam-not-linked" || item.status === "consent-required" || item.status === "unsupported"
  ).length;
  const humanScore = items.reduce((total, item) => total + (item.existingScore ?? 0), 0);
  const agentScore = items.reduce((total, item) => total + (item.agentScore ?? 0), 0);
  const status: HumanBenchmarkCampaignPlan["status"] =
    proofPlan.totals.alreadyScored === items.length && items.length > 0
      ? "complete"
      : blocked > 0 || items.length === 0
        ? "blocked"
        : "ready";
  const campaignId = input.campaignReport?.campaign.id;
  const comparisonQuery = campaignId
    ? `humanUserId=${encodeURIComponent(input.user.id)}&campaignId=${encodeURIComponent(campaignId)}`
    : undefined;

  return {
    schemaVersion: "steambench.human-campaign-plan.v1",
    user: input.user,
    steamid: proofPlan.steamid,
    status,
    source: input.campaignReport
      ? {
          type: "agent-campaign",
          campaignId,
          agentId: input.campaignReport.campaign.agentId,
          agentName: input.campaignReport.agent?.displayName
        }
      : {
          type: "task-catalog"
        },
    totals: {
      tasks: items.length,
      ready: proofPlan.totals.ready,
      alreadyScored: proofPlan.totals.alreadyScored,
      blocked,
      achievementTasks: proofPlan.totals.achievementTasks,
      manualTasks: proofPlan.totals.manualTasks,
      completionRate: items.length === 0 ? 0 : Math.round((proofPlan.totals.alreadyScored / items.length) * 100),
      agentScore,
      humanScore
    },
    items,
    links: {
      proofPlan: `/api/users/${input.user.id}/steam-proof-plan`,
      submitNext: items.some((item) => item.status === "ready") ? `/api/users/${input.user.id}/steam-proof-submissions` : undefined,
      comparison: comparisonQuery ? `/api/comparisons/human-agent?${comparisonQuery}` : undefined,
      comparisonEvidenceBundle: comparisonQuery ? `/api/comparisons/human-agent/evidence-bundle?${comparisonQuery}` : undefined,
      comparisonResultCertificate: comparisonQuery ? `/api/comparisons/human-agent/result-certificate?${comparisonQuery}` : undefined
    }
  };
}
