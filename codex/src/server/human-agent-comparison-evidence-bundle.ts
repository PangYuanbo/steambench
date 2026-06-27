import type { EvidenceChecklistItem, RunEvidenceBundle } from "./evidence-bundle";
import type { AgentCampaignEvidenceBundle } from "./agent-campaign-evidence-bundle";
import type { HumanAgentComparison } from "./human-agent-comparison";

export type HumanAgentComparisonEvidenceBundle = {
  schemaVersion: "steambench.human-agent-comparison-evidence-bundle.v1";
  generatedAt: string;
  comparisonId: string;
  humanUserId: string;
  agentId: string;
  campaignId: string;
  comparison: HumanAgentComparison;
  campaignBundle?: AgentCampaignEvidenceBundle;
  runBundles: Array<{
    taskId: string;
    humanRunId?: string;
    agentRunId?: string;
    humanBundle?: RunEvidenceBundle;
    agentBundle?: RunEvidenceBundle;
  }>;
  integrity: {
    verdict: HumanAgentComparison["status"];
    comparisonComplete: boolean;
    campaignBundleReady: boolean;
    allCompleteTasksHaveHumanBundle: boolean;
    allCompleteTasksHaveAgentBundle: boolean;
    humanSteamLinked: boolean;
    humanProofConsent: boolean;
    taskCount: number;
    completeTasks: number;
    humanMissing: number;
    agentMissing: number;
    eventCount: number;
    artifactCount: number;
    proofCount: number;
    streamCount: number;
    scoreboardRows: number;
    humanScore: number;
    agentScore: number;
    margin: number;
    checklist: EvidenceChecklistItem[];
  };
};

export function comparisonId(input: Pick<HumanAgentComparison, "human" | "campaign">): string {
  return `${input.human.id}:${input.campaign.id}`;
}

function countRunBundleField(
  runBundles: HumanAgentComparisonEvidenceBundle["runBundles"],
  field: "eventCount" | "artifactCount" | "proofCount" | "streamCount"
): number {
  return runBundles.reduce((total, entry) => {
    const humanCount = entry.humanBundle?.integrity[field] ?? 0;
    const agentCount = entry.agentBundle?.integrity[field] ?? 0;
    return total + humanCount + agentCount;
  }, 0);
}

export function buildHumanAgentComparisonEvidenceBundle(input: {
  comparison: HumanAgentComparison;
  campaignBundle?: AgentCampaignEvidenceBundle;
  runBundles: HumanAgentComparisonEvidenceBundle["runBundles"];
  generatedAt?: string;
}): HumanAgentComparisonEvidenceBundle {
  const comparisonComplete = input.comparison.status === "complete";
  const campaignBundleReady = input.campaignBundle?.integrity.verdict === "scoreboard-ready" &&
    input.campaignBundle.integrity.checklist.every((item) => item.status === "pass");
  const completeTaskBundles = input.runBundles.filter((entry) =>
    input.comparison.items.some((item) => item.task.id === entry.taskId && item.status === "complete")
  );
  const allCompleteTasksHaveHumanBundle = completeTaskBundles.length === input.comparison.totals.completeTasks &&
    completeTaskBundles.every((entry) => entry.humanBundle?.integrity.verdict === "scoreboard-ready");
  const allCompleteTasksHaveAgentBundle = completeTaskBundles.length === input.comparison.totals.completeTasks &&
    completeTaskBundles.every((entry) => entry.agentBundle?.integrity.verdict === "scoreboard-ready");
  const humanSteamLinked = Boolean(input.comparison.human.linkedSteamId);
  const humanProofConsent = Boolean(input.comparison.human.proofConsentAt);
  const checklist: EvidenceChecklistItem[] = [
    {
      id: "comparison-complete",
      label: "Human and agent have scored every comparison task",
      status: comparisonComplete ? "pass" : "fail"
    },
    {
      id: "campaign-bundle-ready",
      label: "Agent campaign evidence bundle is scoreboard-ready",
      status: campaignBundleReady ? "pass" : "fail"
    },
    {
      id: "human-run-bundles-ready",
      label: "Every completed comparison task has a human run evidence bundle",
      status: allCompleteTasksHaveHumanBundle ? "pass" : "fail"
    },
    {
      id: "agent-run-bundles-ready",
      label: "Every completed comparison task has an agent run evidence bundle",
      status: allCompleteTasksHaveAgentBundle ? "pass" : "fail"
    },
    {
      id: "human-steam-linked",
      label: "Human competitor has a linked Steam account",
      status: humanSteamLinked ? "pass" : "fail"
    },
    {
      id: "human-proof-consent",
      label: "Human competitor has granted Steam proof consent",
      status: humanProofConsent ? "pass" : "fail"
    }
  ];

  return {
    schemaVersion: "steambench.human-agent-comparison-evidence-bundle.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    comparisonId: comparisonId(input.comparison),
    humanUserId: input.comparison.human.id,
    agentId: input.comparison.agent?.id ?? input.comparison.campaign.agentId,
    campaignId: input.comparison.campaign.id,
    comparison: input.comparison,
    campaignBundle: input.campaignBundle,
    runBundles: input.runBundles,
    integrity: {
      verdict: input.comparison.status,
      comparisonComplete,
      campaignBundleReady,
      allCompleteTasksHaveHumanBundle,
      allCompleteTasksHaveAgentBundle,
      humanSteamLinked,
      humanProofConsent,
      taskCount: input.comparison.totals.tasks,
      completeTasks: input.comparison.totals.completeTasks,
      humanMissing: input.comparison.totals.humanMissing,
      agentMissing: input.comparison.totals.agentMissing,
      eventCount: countRunBundleField(input.runBundles, "eventCount"),
      artifactCount: countRunBundleField(input.runBundles, "artifactCount"),
      proofCount: countRunBundleField(input.runBundles, "proofCount"),
      streamCount: countRunBundleField(input.runBundles, "streamCount"),
      scoreboardRows: input.comparison.items.filter((item) => item.humanRow).length +
        input.comparison.items.filter((item) => item.agentRow).length,
      humanScore: input.comparison.totals.humanScore,
      agentScore: input.comparison.totals.agentScore,
      margin: input.comparison.totals.margin,
      checklist
    }
  };
}
