import type { EvidenceChecklistItem, RunEvidenceBundle } from "./evidence-bundle";
import type { AgentBenchmarkCampaignReport } from "./agent-campaign-report";
import type { AgentCampaignLeaderboardEntry, AgentCampaignStandings } from "./agent-campaign-standings";

export type AgentCampaignEvidenceBundle = {
  schemaVersion: "steambench.agent-campaign-evidence-bundle.v1";
  generatedAt: string;
  campaignId: string;
  agentId: string;
  report: AgentBenchmarkCampaignReport;
  standingsEntry?: AgentCampaignLeaderboardEntry;
  runBundles: Array<{
    runId: string;
    bundle?: RunEvidenceBundle;
  }>;
  integrity: {
    verdict: AgentBenchmarkCampaignReport["status"];
    campaignScoreboardReady: boolean;
    allCampaignRunsPresent: boolean;
    allRunBundlesPresent: boolean;
    allRunBundlesScoreboardReady: boolean;
    allDispatchesCompleted: boolean;
    standingsPublished: boolean;
    taskCount: number;
    runCount: number;
    dispatchCount: number;
    eventCount: number;
    artifactCount: number;
    proofCount: number;
    streamCount: number;
    scoreboardRows: number;
    totalScore: number;
    checklist: EvidenceChecklistItem[];
  };
};

export function buildAgentCampaignEvidenceBundle(input: {
  report: AgentBenchmarkCampaignReport;
  runBundles: Array<{
    runId: string;
    bundle?: RunEvidenceBundle;
  }>;
  standings: AgentCampaignStandings;
  generatedAt?: string;
}): AgentCampaignEvidenceBundle {
  const campaignScoreboardReady = input.report.status === "scoreboard-ready";
  const allCampaignRunsPresent = input.report.totals.runs === input.report.totals.tasks &&
    input.report.items.every((item) => item.run !== undefined);
  const allRunBundlesPresent = input.runBundles.length === input.report.campaign.runIds.length &&
    input.runBundles.every((entry) => entry.bundle !== undefined);
  const allRunBundlesScoreboardReady = allRunBundlesPresent &&
    input.runBundles.every((entry) => entry.bundle?.integrity.verdict === "scoreboard-ready");
  const allDispatchesCompleted = input.report.totals.dispatches === input.report.campaign.dispatchIds.length &&
    input.report.items.every((item) => item.dispatch?.status === "completed");
  const standingsEntry = input.standings.leaderboard.find((entry) => entry.campaignId === input.report.campaign.id);
  const standingsPublished = Boolean(standingsEntry);

  return {
    schemaVersion: "steambench.agent-campaign-evidence-bundle.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    campaignId: input.report.campaign.id,
    agentId: input.report.campaign.agentId,
    report: input.report,
    standingsEntry,
    runBundles: input.runBundles,
    integrity: {
      verdict: input.report.status,
      campaignScoreboardReady,
      allCampaignRunsPresent,
      allRunBundlesPresent,
      allRunBundlesScoreboardReady,
      allDispatchesCompleted,
      standingsPublished,
      taskCount: input.report.totals.tasks,
      runCount: input.report.totals.runs,
      dispatchCount: input.report.totals.dispatches,
      eventCount: input.runBundles.reduce((total, entry) => total + (entry.bundle?.integrity.eventCount ?? 0), 0),
      artifactCount: input.runBundles.reduce((total, entry) => total + (entry.bundle?.integrity.artifactCount ?? 0), 0),
      proofCount: input.runBundles.reduce((total, entry) => total + (entry.bundle?.integrity.proofCount ?? 0), 0),
      streamCount: input.runBundles.reduce((total, entry) => total + (entry.bundle?.integrity.streamCount ?? 0), 0),
      scoreboardRows: input.report.totals.scoreboardRows,
      totalScore: input.report.totals.totalScore,
      checklist: [
        {
          id: "campaign-scoreboard-ready",
          label: "Campaign report is scoreboard-ready",
          status: campaignScoreboardReady ? "pass" : "fail"
        },
        {
          id: "campaign-runs-present",
          label: "Every campaign task has a run",
          status: allCampaignRunsPresent ? "pass" : "fail"
        },
        {
          id: "run-bundles-present",
          label: "Every campaign run has an evidence bundle",
          status: allRunBundlesPresent ? "pass" : "fail"
        },
        {
          id: "run-bundles-scoreboard-ready",
          label: "Every run evidence bundle is scoreboard-ready",
          status: allRunBundlesScoreboardReady ? "pass" : "fail"
        },
        {
          id: "dispatches-completed",
          label: "Every campaign dispatch is completed",
          status: allDispatchesCompleted ? "pass" : "fail"
        },
        {
          id: "standings-published",
          label: "Campaign is present in campaign standings",
          status: standingsPublished ? "pass" : "fail"
        }
      ]
    }
  };
}
