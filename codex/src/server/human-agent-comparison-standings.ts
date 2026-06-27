import type { BenchmarkTask } from "../benchmark/types";
import { buildAgentBenchmarkCampaignReport } from "./agent-campaign-report";
import { buildHumanAgentComparison, type HumanAgentComparison } from "./human-agent-comparison";
import type { BenchmarkAgentCampaign, StoreSnapshot, UserAccount } from "./store";

export type HumanAgentComparisonLeaderboardEntry = {
  rank: number;
  comparisonId: string;
  status: HumanAgentComparison["status"];
  winner?: HumanAgentComparison["winner"];
  humanUserId: string;
  humanHandle: string;
  humanName: string;
  humanSteamLinked: boolean;
  humanProofConsent: boolean;
  agentId: string;
  agentHandle: string;
  agentName: string;
  campaignId: string;
  taskCount: number;
  completeTasks: number;
  humanScore: number;
  agentScore: number;
  humanWins: number;
  agentWins: number;
  ties: number;
  humanMissing: number;
  agentMissing: number;
  margin: number;
  readyForPublicShare: boolean;
  updatedAt: string;
  links: {
    comparison: string;
    evidenceBundle: string;
    resultCertificate: string;
    humanCampaignPlan: string;
    runHumanCampaignLocal: string;
    agentCampaign: string;
  };
};

export type HumanAgentCompetitorStanding = {
  rank: number;
  participantType: "human" | "agent";
  participantId: string;
  handle: string;
  name: string;
  comparisons: number;
  completeComparisons: number;
  wins: number;
  losses: number;
  ties: number;
  totalScore: number;
  bestComparisonScore: number;
  averageScore: number;
  taskWins: number;
  taskLosses: number;
  taskTies: number;
  missingTasks: number;
  lastUpdatedAt: string;
};

export type HumanAgentMatchupStanding = {
  rank: number;
  humanUserId: string;
  humanHandle: string;
  agentId: string;
  agentHandle: string;
  comparisons: number;
  completeComparisons: number;
  humanWins: number;
  agentWins: number;
  ties: number;
  humanScore: number;
  agentScore: number;
  margin: number;
  leader?: "human" | "agent" | "tie";
  lastUpdatedAt: string;
};

export type HumanAgentComparisonStandings = {
  schemaVersion: "steambench.human-agent-comparison-standings.v1";
  generatedAt: string;
  filters: {
    status?: HumanAgentComparison["status"];
    humanUserId?: string;
    agentId?: string;
    campaignId?: string;
    limit: number;
  };
  totals: {
    comparisons: number;
    completeComparisons: number;
    incompleteComparisons: number;
    humans: number;
    agents: number;
    campaigns: number;
    humanWins: number;
    agentWins: number;
    ties: number;
    humanScore: number;
    agentScore: number;
    humanMissing: number;
    agentMissing: number;
    readyForPublicShare: number;
  };
  leaderboard: HumanAgentComparisonLeaderboardEntry[];
  humans: HumanAgentCompetitorStanding[];
  agents: HumanAgentCompetitorStanding[];
  matchups: HumanAgentMatchupStanding[];
};

export type HumanAgentComparisonOpsReport = {
  schemaVersion: "steambench.human-agent-comparison-ops-report.v1";
  generatedAt: string;
  status: "ready-to-share" | "needs-human-runs" | "needs-agent-runs" | "needs-attention" | "empty";
  standings: HumanAgentComparisonStandings;
  recommendedActions: Array<{
    id: "run-human-campaign-local" | "inspect-agent-campaign" | "share-comparison-certificate" | "inspect-comparison-standings";
    label: string;
    priority: "high" | "medium" | "low";
    method: "GET" | "POST";
    endpoint: string;
    body?: Record<string, string | number | boolean>;
    reason: string;
  }>;
  links: {
    standings: "/api/comparisons/human-agent/standings";
  };
};

function comparisonId(comparison: Pick<HumanAgentComparison, "human" | "campaign">): string {
  return `${comparison.human.id}:${comparison.campaign.id}`;
}

function comparisonPath(entry: Pick<HumanAgentComparisonLeaderboardEntry, "humanUserId" | "campaignId">): string {
  return `/api/comparisons/human-agent?humanUserId=${encodeURIComponent(entry.humanUserId)}&campaignId=${encodeURIComponent(entry.campaignId)}`;
}

function entryFromComparison(comparison: HumanAgentComparison, campaign: BenchmarkAgentCampaign): HumanAgentComparisonLeaderboardEntry {
  const agent = comparison.agent;
  const entry = {
    rank: 0,
    comparisonId: comparisonId(comparison),
    status: comparison.status,
    winner: comparison.winner,
    humanUserId: comparison.human.id,
    humanHandle: comparison.human.handle,
    humanName: comparison.human.displayName,
    humanSteamLinked: Boolean(comparison.human.linkedSteamId),
    humanProofConsent: Boolean(comparison.human.proofConsentAt),
    agentId: agent?.id ?? campaign.agentId,
    agentHandle: agent?.handle ?? campaign.agentId,
    agentName: agent?.displayName ?? campaign.agentId,
    campaignId: campaign.id,
    taskCount: comparison.totals.tasks,
    completeTasks: comparison.totals.completeTasks,
    humanScore: comparison.totals.humanScore,
    agentScore: comparison.totals.agentScore,
    humanWins: comparison.totals.humanWins,
    agentWins: comparison.totals.agentWins,
    ties: comparison.totals.ties,
    humanMissing: comparison.totals.humanMissing,
    agentMissing: comparison.totals.agentMissing,
    margin: comparison.totals.margin,
    readyForPublicShare: comparison.status === "complete" && Boolean(comparison.human.linkedSteamId) && Boolean(comparison.human.proofConsentAt),
    updatedAt: campaign.updatedAt,
    links: {
      comparison: "",
      evidenceBundle: `/api/comparisons/human-agent/evidence-bundle?humanUserId=${encodeURIComponent(comparison.human.id)}&campaignId=${encodeURIComponent(campaign.id)}`,
      resultCertificate: `/api/comparisons/human-agent/result-certificate?humanUserId=${encodeURIComponent(comparison.human.id)}&campaignId=${encodeURIComponent(campaign.id)}`,
      humanCampaignPlan: `/api/users/${encodeURIComponent(comparison.human.id)}/human-campaign-plan?campaignId=${encodeURIComponent(campaign.id)}`,
      runHumanCampaignLocal: `/api/users/${encodeURIComponent(comparison.human.id)}/human-campaigns/run-local`,
      agentCampaign: `/api/campaigns/${encodeURIComponent(campaign.id)}`
    }
  };
  return {
    ...entry,
    links: {
      ...entry.links,
      comparison: comparisonPath(entry)
    }
  };
}

function sortEntries(entries: HumanAgentComparisonLeaderboardEntry[]): HumanAgentComparisonLeaderboardEntry[] {
  return [...entries]
    .sort((a, b) =>
      Number(b.readyForPublicShare) - Number(a.readyForPublicShare) ||
      b.humanScore + b.agentScore - (a.humanScore + a.agentScore) ||
      b.completeTasks - a.completeTasks ||
      b.margin - a.margin ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.humanHandle.localeCompare(b.humanHandle) ||
      a.agentHandle.localeCompare(b.agentHandle)
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function upsertCompetitor(input: {
  map: Map<string, HumanAgentCompetitorStanding>;
  participantType: "human" | "agent";
  participantId: string;
  handle: string;
  name: string;
  didWin: boolean;
  didLose: boolean;
  didTie: boolean;
  complete: boolean;
  score: number;
  taskWins: number;
  taskLosses: number;
  taskTies: number;
  missingTasks: number;
  updatedAt: string;
}) {
  const existing = input.map.get(input.participantId);
  if (existing) {
    existing.comparisons += 1;
    existing.completeComparisons += input.complete ? 1 : 0;
    existing.wins += input.didWin ? 1 : 0;
    existing.losses += input.didLose ? 1 : 0;
    existing.ties += input.didTie ? 1 : 0;
    existing.totalScore += input.score;
    existing.bestComparisonScore = Math.max(existing.bestComparisonScore, input.score);
    existing.averageScore = Math.round(existing.totalScore / existing.comparisons);
    existing.taskWins += input.taskWins;
    existing.taskLosses += input.taskLosses;
    existing.taskTies += input.taskTies;
    existing.missingTasks += input.missingTasks;
    existing.lastUpdatedAt = input.updatedAt > existing.lastUpdatedAt ? input.updatedAt : existing.lastUpdatedAt;
    return;
  }
  input.map.set(input.participantId, {
    rank: 0,
    participantType: input.participantType,
    participantId: input.participantId,
    handle: input.handle,
    name: input.name,
    comparisons: 1,
    completeComparisons: input.complete ? 1 : 0,
    wins: input.didWin ? 1 : 0,
    losses: input.didLose ? 1 : 0,
    ties: input.didTie ? 1 : 0,
    totalScore: input.score,
    bestComparisonScore: input.score,
    averageScore: input.score,
    taskWins: input.taskWins,
    taskLosses: input.taskLosses,
    taskTies: input.taskTies,
    missingTasks: input.missingTasks,
    lastUpdatedAt: input.updatedAt
  });
}

function rankCompetitors(entries: HumanAgentCompetitorStanding[]): HumanAgentCompetitorStanding[] {
  return [...entries]
    .sort((a, b) =>
      b.wins - a.wins ||
      b.totalScore - a.totalScore ||
      b.completeComparisons - a.completeComparisons ||
      b.bestComparisonScore - a.bestComparisonScore ||
      a.handle.localeCompare(b.handle)
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function buildCompetitorStandings(entries: HumanAgentComparisonLeaderboardEntry[]) {
  const humans = new Map<string, HumanAgentCompetitorStanding>();
  const agents = new Map<string, HumanAgentCompetitorStanding>();
  for (const entry of entries) {
    const complete = entry.status === "complete";
    upsertCompetitor({
      map: humans,
      participantType: "human",
      participantId: entry.humanUserId,
      handle: entry.humanHandle,
      name: entry.humanName,
      didWin: complete && entry.winner === "human",
      didLose: complete && entry.winner === "agent",
      didTie: complete && entry.winner === "tie",
      complete,
      score: entry.humanScore,
      taskWins: entry.humanWins,
      taskLosses: entry.agentWins,
      taskTies: entry.ties,
      missingTasks: entry.humanMissing,
      updatedAt: entry.updatedAt
    });
    upsertCompetitor({
      map: agents,
      participantType: "agent",
      participantId: entry.agentId,
      handle: entry.agentHandle,
      name: entry.agentName,
      didWin: complete && entry.winner === "agent",
      didLose: complete && entry.winner === "human",
      didTie: complete && entry.winner === "tie",
      complete,
      score: entry.agentScore,
      taskWins: entry.agentWins,
      taskLosses: entry.humanWins,
      taskTies: entry.ties,
      missingTasks: entry.agentMissing,
      updatedAt: entry.updatedAt
    });
  }
  return {
    humans: rankCompetitors([...humans.values()]),
    agents: rankCompetitors([...agents.values()])
  };
}

function buildMatchups(entries: HumanAgentComparisonLeaderboardEntry[]): HumanAgentMatchupStanding[] {
  const map = new Map<string, HumanAgentMatchupStanding>();
  for (const entry of entries) {
    const key = `${entry.humanUserId}:${entry.agentId}`;
    const existing = map.get(key);
    const complete = entry.status === "complete";
    if (existing) {
      existing.comparisons += 1;
      existing.completeComparisons += complete ? 1 : 0;
      existing.humanWins += complete && entry.winner === "human" ? 1 : 0;
      existing.agentWins += complete && entry.winner === "agent" ? 1 : 0;
      existing.ties += complete && entry.winner === "tie" ? 1 : 0;
      existing.humanScore += entry.humanScore;
      existing.agentScore += entry.agentScore;
      existing.margin = Math.abs(existing.humanScore - existing.agentScore);
      existing.leader = existing.humanScore > existing.agentScore ? "human" : existing.agentScore > existing.humanScore ? "agent" : "tie";
      existing.lastUpdatedAt = entry.updatedAt > existing.lastUpdatedAt ? entry.updatedAt : existing.lastUpdatedAt;
    } else {
      map.set(key, {
        rank: 0,
        humanUserId: entry.humanUserId,
        humanHandle: entry.humanHandle,
        agentId: entry.agentId,
        agentHandle: entry.agentHandle,
        comparisons: 1,
        completeComparisons: complete ? 1 : 0,
        humanWins: complete && entry.winner === "human" ? 1 : 0,
        agentWins: complete && entry.winner === "agent" ? 1 : 0,
        ties: complete && entry.winner === "tie" ? 1 : 0,
        humanScore: entry.humanScore,
        agentScore: entry.agentScore,
        margin: entry.margin,
        leader: entry.humanScore > entry.agentScore ? "human" : entry.agentScore > entry.humanScore ? "agent" : "tie",
        lastUpdatedAt: entry.updatedAt
      });
    }
  }
  return [...map.values()]
    .sort((a, b) =>
      b.completeComparisons - a.completeComparisons ||
      b.margin - a.margin ||
      b.humanScore + b.agentScore - (a.humanScore + a.agentScore) ||
      a.humanHandle.localeCompare(b.humanHandle)
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function allowedHumans(snapshot: StoreSnapshot, humanUserId?: string): UserAccount[] {
  return snapshot.users.filter((user) =>
    user.type === "human" &&
    (humanUserId === undefined || user.id === humanUserId)
  );
}

function allowedCampaigns(snapshot: StoreSnapshot, agentId?: string, campaignId?: string): BenchmarkAgentCampaign[] {
  return snapshot.agentCampaigns.filter((campaign) =>
    (agentId === undefined || campaign.agentId === agentId) &&
    (campaignId === undefined || campaign.id === campaignId)
  );
}

export function buildHumanAgentComparisonStandings(input: {
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
  status?: HumanAgentComparison["status"];
  humanUserId?: string;
  agentId?: string;
  campaignId?: string;
  limit?: number;
  generatedAt?: string;
}): HumanAgentComparisonStandings {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
  const entries: HumanAgentComparisonLeaderboardEntry[] = [];
  for (const campaign of allowedCampaigns(input.snapshot, input.agentId, input.campaignId)) {
    const report = buildAgentBenchmarkCampaignReport({
      campaign,
      snapshot: input.snapshot,
      tasks: input.tasks
    });
    for (const human of allowedHumans(input.snapshot, input.humanUserId)) {
      const comparison = buildHumanAgentComparison({
        human,
        campaignReport: report,
        snapshot: input.snapshot,
        tasks: input.tasks
      });
      if (input.status !== undefined && comparison.status !== input.status) continue;
      entries.push(entryFromComparison(comparison, campaign));
    }
  }

  const ranked = sortEntries(entries);
  const selected = ranked.slice(0, limit);
  const competitors = buildCompetitorStandings(ranked);
  return {
    schemaVersion: "steambench.human-agent-comparison-standings.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    filters: {
      status: input.status,
      humanUserId: input.humanUserId,
      agentId: input.agentId,
      campaignId: input.campaignId,
      limit
    },
    totals: {
      comparisons: ranked.length,
      completeComparisons: ranked.filter((entry) => entry.status === "complete").length,
      incompleteComparisons: ranked.filter((entry) => entry.status !== "complete").length,
      humans: new Set(ranked.map((entry) => entry.humanUserId)).size,
      agents: new Set(ranked.map((entry) => entry.agentId)).size,
      campaigns: new Set(ranked.map((entry) => entry.campaignId)).size,
      humanWins: ranked.filter((entry) => entry.winner === "human").length,
      agentWins: ranked.filter((entry) => entry.winner === "agent").length,
      ties: ranked.filter((entry) => entry.winner === "tie").length,
      humanScore: ranked.reduce((total, entry) => total + entry.humanScore, 0),
      agentScore: ranked.reduce((total, entry) => total + entry.agentScore, 0),
      humanMissing: ranked.reduce((total, entry) => total + entry.humanMissing, 0),
      agentMissing: ranked.reduce((total, entry) => total + entry.agentMissing, 0),
      readyForPublicShare: ranked.filter((entry) => entry.readyForPublicShare).length
    },
    leaderboard: selected,
    humans: competitors.humans,
    agents: competitors.agents,
    matchups: buildMatchups(ranked)
  };
}

function reportStatus(standings: HumanAgentComparisonStandings): HumanAgentComparisonOpsReport["status"] {
  if (standings.totals.comparisons === 0) return "empty";
  if (standings.totals.humanMissing > 0) return "needs-human-runs";
  if (standings.totals.agentMissing > 0) return "needs-agent-runs";
  if (standings.totals.readyForPublicShare > 0) return "ready-to-share";
  return "needs-attention";
}

function buildActions(standings: HumanAgentComparisonStandings): HumanAgentComparisonOpsReport["recommendedActions"] {
  const actions: HumanAgentComparisonOpsReport["recommendedActions"] = [];
  const humanGap = standings.leaderboard.find((entry) => entry.humanMissing > 0);
  if (humanGap) {
    actions.push({
      id: "run-human-campaign-local",
      label: "Run local human campaign",
      priority: "high",
      method: "POST",
      endpoint: humanGap.links.runHumanCampaignLocal,
      body: {
        campaignId: humanGap.campaignId,
        limit: humanGap.taskCount
      },
      reason: `${humanGap.humanHandle} is missing ${humanGap.humanMissing} human run(s) against ${humanGap.agentHandle}.`
    });
  }

  const agentGap = standings.leaderboard.find((entry) => entry.agentMissing > 0);
  if (agentGap) {
    actions.push({
      id: "inspect-agent-campaign",
      label: "Inspect agent campaign",
      priority: actions.length === 0 ? "high" : "medium",
      method: "GET",
      endpoint: agentGap.links.agentCampaign,
      reason: `${agentGap.agentHandle} is missing ${agentGap.agentMissing} agent run(s) for the comparison task set.`
    });
  }

  const shareable = standings.leaderboard.find((entry) => entry.readyForPublicShare);
  if (shareable) {
    actions.push({
      id: "share-comparison-certificate",
      label: "Share comparison certificate",
      priority: actions.length === 0 ? "high" : "low",
      method: "GET",
      endpoint: shareable.links.resultCertificate,
      reason: `${shareable.humanHandle} vs ${shareable.agentHandle} is complete and ready for public comparison sharing.`
    });
  }

  actions.push({
    id: "inspect-comparison-standings",
    label: "Inspect comparison standings",
    priority: "low",
    method: "GET",
    endpoint: "/api/comparisons/human-agent/standings",
    reason: "Review aggregate human-vs-agent comparison leaderboard and participant totals."
  });
  return actions;
}

export function buildHumanAgentComparisonOpsReport(input: Parameters<typeof buildHumanAgentComparisonStandings>[0]): HumanAgentComparisonOpsReport {
  const standings = buildHumanAgentComparisonStandings(input);
  return {
    schemaVersion: "steambench.human-agent-comparison-ops-report.v1",
    generatedAt: input.generatedAt ?? standings.generatedAt,
    status: reportStatus(standings),
    standings,
    recommendedActions: buildActions(standings),
    links: {
      standings: "/api/comparisons/human-agent/standings"
    }
  };
}
