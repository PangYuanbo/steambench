import type { RuntimeDispatch } from "./store";
import type { AgentBenchmarkCampaignReport } from "./agent-campaign-report";

export type AgentCampaignLeaderboardEntry = {
  rank: number;
  campaignId: string;
  agentId: string;
  agentHandle: string;
  agentName: string;
  provider: RuntimeDispatch["provider"];
  status: AgentBenchmarkCampaignReport["status"];
  taskCount: number;
  runCount: number;
  scoredRuns: number;
  dispatches: number;
  scoreboardRows: number;
  totalScore: number;
  averageScore: number;
  completionRate: number;
  completedAt: string;
};

export type AgentCampaignCompetitorStanding = {
  rank: number;
  agentId: string;
  agentHandle: string;
  agentName: string;
  campaigns: number;
  scoreboardReadyCampaigns: number;
  totalScore: number;
  bestCampaignScore: number;
  averageCampaignScore: number;
  scoredRuns: number;
  taskCoverage: number;
  lastCompletedAt: string;
};

export type AgentCampaignStandings = {
  schemaVersion: "steambench.agent-campaign-standings.v1";
  totals: {
    campaigns: number;
    scoreboardReadyCampaigns: number;
    agents: number;
    scoredRuns: number;
    scoreboardRows: number;
    totalScore: number;
  };
  leaderboard: AgentCampaignLeaderboardEntry[];
  competitors: AgentCampaignCompetitorStanding[];
};

function completionRate(report: AgentBenchmarkCampaignReport): number {
  if (report.totals.tasks === 0) return 0;
  return Math.round((report.totals.scoreboardRows / report.totals.tasks) * 100);
}

function leaderboardEntry(report: AgentBenchmarkCampaignReport): AgentCampaignLeaderboardEntry {
  return {
    rank: 0,
    campaignId: report.campaign.id,
    agentId: report.campaign.agentId,
    agentHandle: report.agent?.handle ?? report.campaign.agentId,
    agentName: report.agent?.displayName ?? report.campaign.agentId,
    provider: report.campaign.provider,
    status: report.status,
    taskCount: report.totals.tasks,
    runCount: report.totals.runs,
    scoredRuns: report.totals.scored,
    dispatches: report.totals.dispatches,
    scoreboardRows: report.totals.scoreboardRows,
    totalScore: report.totals.totalScore,
    averageScore: report.totals.scoreboardRows > 0 ? Math.round(report.totals.totalScore / report.totals.scoreboardRows) : 0,
    completionRate: completionRate(report),
    completedAt: report.campaign.updatedAt
  };
}

export function buildAgentCampaignStandings(reports: AgentBenchmarkCampaignReport[]): AgentCampaignStandings {
  const leaderboard = reports
    .map(leaderboardEntry)
    .sort((a, b) =>
      b.totalScore - a.totalScore ||
      b.completionRate - a.completionRate ||
      b.scoredRuns - a.scoredRuns ||
      b.completedAt.localeCompare(a.completedAt) ||
      a.agentHandle.localeCompare(b.agentHandle)
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const byAgent = new Map<string, AgentCampaignCompetitorStanding>();
  for (const entry of leaderboard) {
    const existing = byAgent.get(entry.agentId);
    if (existing) {
      existing.campaigns += 1;
      existing.scoreboardReadyCampaigns += entry.status === "scoreboard-ready" ? 1 : 0;
      existing.totalScore += entry.totalScore;
      existing.bestCampaignScore = Math.max(existing.bestCampaignScore, entry.totalScore);
      existing.scoredRuns += entry.scoredRuns;
      existing.taskCoverage += entry.scoreboardRows;
      existing.averageCampaignScore = Math.round(existing.totalScore / existing.campaigns);
      existing.lastCompletedAt = entry.completedAt > existing.lastCompletedAt ? entry.completedAt : existing.lastCompletedAt;
    } else {
      byAgent.set(entry.agentId, {
        rank: 0,
        agentId: entry.agentId,
        agentHandle: entry.agentHandle,
        agentName: entry.agentName,
        campaigns: 1,
        scoreboardReadyCampaigns: entry.status === "scoreboard-ready" ? 1 : 0,
        totalScore: entry.totalScore,
        bestCampaignScore: entry.totalScore,
        averageCampaignScore: entry.totalScore,
        scoredRuns: entry.scoredRuns,
        taskCoverage: entry.scoreboardRows,
        lastCompletedAt: entry.completedAt
      });
    }
  }

  const competitors = [...byAgent.values()]
    .sort((a, b) =>
      b.totalScore - a.totalScore ||
      b.bestCampaignScore - a.bestCampaignScore ||
      b.scoreboardReadyCampaigns - a.scoreboardReadyCampaigns ||
      a.agentHandle.localeCompare(b.agentHandle)
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  return {
    schemaVersion: "steambench.agent-campaign-standings.v1",
    totals: {
      campaigns: reports.length,
      scoreboardReadyCampaigns: leaderboard.filter((entry) => entry.status === "scoreboard-ready").length,
      agents: competitors.length,
      scoredRuns: leaderboard.reduce((total, entry) => total + entry.scoredRuns, 0),
      scoreboardRows: leaderboard.reduce((total, entry) => total + entry.scoreboardRows, 0),
      totalScore: leaderboard.reduce((total, entry) => total + entry.totalScore, 0)
    },
    leaderboard,
    competitors
  };
}
