import type { BenchmarkTask, ScoreboardRow } from "../benchmark/types";
import { buildAgentBenchmarkCampaignReport } from "./agent-campaign-report";
import { buildHumanAgentComparison, type HumanAgentComparison } from "./human-agent-comparison";
import type { AgentProfile, BenchmarkAgentCampaign, BenchmarkMatch, BenchmarkRun, BenchmarkSuiteRace, CompetitionEventRegistration, LiveStreamSession, RunArtifact, RunProof, StoreSnapshot, UserAccount } from "./store";

export type CompetitorProfileParticipant =
  | {
      type: "human";
      id: string;
      handle: string;
      displayName: string;
      linkedSteamId?: string;
      proofConsentAt?: string;
      proofConsentRevokedAt?: string;
    }
  | {
      type: "agent";
      id: string;
      userId: string;
      handle: string;
      displayName: string;
      provider: AgentProfile["provider"];
      runtimeProvider: AgentProfile["runtimeProvider"];
      status: AgentProfile["status"];
      capabilities: string[];
    };

export type CompetitorProfile = {
  participant: CompetitorProfileParticipant;
  registrations: CompetitionEventRegistration[];
  runs: {
    total: number;
    scored: number;
    failed: number;
    totalScore: number;
    bestScore?: number;
    recent: BenchmarkRun[];
  };
  matches: {
    total: number;
    scored: number;
    wins: number;
    losses: number;
    ties: number;
    recent: BenchmarkMatch[];
  };
  suiteRaces: {
    total: number;
    scored: number;
    wins: number;
    losses: number;
    ties: number;
    eventScoped: number;
    totalScore: number;
    recent: BenchmarkSuiteRace[];
  };
  evidence: {
    artifacts: number;
    proofs: number;
    verifiedProofs: number;
    streams: number;
    liveStreams: number;
  };
  scoreboard: {
    rows: number;
    totalScore: number;
    bestScore?: number;
    latestCompletedAt?: string;
    recent: ScoreboardRow[];
  };
  campaignComparisons: {
    total: number;
    complete: number;
    wins: number;
    losses: number;
    ties: number;
    readyForPublicShare: number;
    humanMissing: number;
    agentMissing: number;
    totalHumanScore: number;
    totalAgentScore: number;
    recent: Array<{
      comparisonId: string;
      status: HumanAgentComparison["status"];
      winner?: HumanAgentComparison["winner"];
      humanUserId: string;
      humanHandle: string;
      agentId: string;
      agentHandle: string;
      campaignId: string;
      taskCount: number;
      completeTasks: number;
      humanScore: number;
      agentScore: number;
      humanMissing: number;
      agentMissing: number;
      margin: number;
      readyForPublicShare: boolean;
      updatedAt: string;
      links: {
        comparison: string;
        evidenceBundle: string;
        resultCertificate: string;
      };
    }>;
  };
};

function runBelongsTo(input: { run: BenchmarkRun; type: "human" | "agent"; handle: string }): boolean {
  return input.run.competitorType === input.type && input.run.competitor === `${input.type}:${input.handle}`;
}

function scoreboardRowBelongsTo(input: { row: ScoreboardRow; type: "human" | "agent"; handle: string }): boolean {
  return input.row.type === input.type && input.row.competitor === `${input.type}:${input.handle}`;
}

function matchResult(input: { match: BenchmarkMatch; type: "human" | "agent" }): "win" | "loss" | "tie" | "none" {
  if (input.match.status !== "scored" || !input.match.winner) return "none";
  if (input.match.winner === "tie") return "tie";
  return input.match.winner === input.type ? "win" : "loss";
}

function suiteRaceResult(input: { race: BenchmarkSuiteRace; type: "human" | "agent" }): "win" | "loss" | "tie" | "none" {
  if (input.race.status !== "scored" || !input.race.winner) return "none";
  if (input.race.winner === "tie") return "tie";
  return input.race.winner === input.type ? "win" : "loss";
}

function comparisonId(comparison: Pick<HumanAgentComparison, "human" | "campaign">): string {
  return `${comparison.human.id}:${comparison.campaign.id}`;
}

function compactComparison(input: {
  comparison: HumanAgentComparison;
  campaign: BenchmarkAgentCampaign;
}) {
  const agent = input.comparison.agent;
  const humanUserId = input.comparison.human.id;
  const campaignId = input.campaign.id;
  const readyForPublicShare = input.comparison.status === "complete" &&
    Boolean(input.comparison.human.linkedSteamId) &&
    Boolean(input.comparison.human.proofConsentAt);
  return {
    comparisonId: comparisonId(input.comparison),
    status: input.comparison.status,
    winner: input.comparison.winner,
    humanUserId,
    humanHandle: input.comparison.human.handle,
    agentId: agent?.id ?? input.campaign.agentId,
    agentHandle: agent?.handle ?? input.campaign.agentId,
    campaignId,
    taskCount: input.comparison.totals.tasks,
    completeTasks: input.comparison.totals.completeTasks,
    humanScore: input.comparison.totals.humanScore,
    agentScore: input.comparison.totals.agentScore,
    humanMissing: input.comparison.totals.humanMissing,
    agentMissing: input.comparison.totals.agentMissing,
    margin: input.comparison.totals.margin,
    readyForPublicShare,
    updatedAt: input.campaign.updatedAt,
    links: {
      comparison: `/api/comparisons/human-agent?humanUserId=${encodeURIComponent(humanUserId)}&campaignId=${encodeURIComponent(campaignId)}`,
      evidenceBundle: `/api/comparisons/human-agent/evidence-bundle?humanUserId=${encodeURIComponent(humanUserId)}&campaignId=${encodeURIComponent(campaignId)}`,
      resultCertificate: `/api/comparisons/human-agent/result-certificate?humanUserId=${encodeURIComponent(humanUserId)}&campaignId=${encodeURIComponent(campaignId)}`
    }
  };
}

function buildCampaignComparisons(input: {
  type: "human" | "agent";
  participantId: string;
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
}): CompetitorProfile["campaignComparisons"] {
  const humans = input.type === "human"
    ? input.snapshot.users.filter((user) => user.id === input.participantId && user.type === "human")
    : input.snapshot.users.filter((user) => user.type === "human");
  const campaigns = input.type === "agent"
    ? input.snapshot.agentCampaigns.filter((campaign) => campaign.agentId === input.participantId)
    : input.snapshot.agentCampaigns;
  const recent: CompetitorProfile["campaignComparisons"]["recent"] = [];
  for (const campaign of campaigns) {
    const campaignReport = buildAgentBenchmarkCampaignReport({
      campaign,
      snapshot: input.snapshot,
      tasks: input.tasks
    });
    for (const human of humans) {
      recent.push(compactComparison({
        campaign,
        comparison: buildHumanAgentComparison({
          human,
          campaignReport,
          snapshot: input.snapshot,
          tasks: input.tasks
        })
      }));
    }
  }
  const participantWon = (entry: (typeof recent)[number]) =>
    input.type === "human" ? entry.winner === "human" : entry.winner === "agent";
  const participantLost = (entry: (typeof recent)[number]) =>
    input.type === "human" ? entry.winner === "agent" : entry.winner === "human";
  const sorted = recent.sort((a, b) =>
    Number(b.readyForPublicShare) - Number(a.readyForPublicShare) ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    a.humanHandle.localeCompare(b.humanHandle) ||
    a.agentHandle.localeCompare(b.agentHandle)
  );
  return {
    total: recent.length,
    complete: recent.filter((entry) => entry.status === "complete").length,
    wins: recent.filter((entry) => entry.status === "complete" && participantWon(entry)).length,
    losses: recent.filter((entry) => entry.status === "complete" && participantLost(entry)).length,
    ties: recent.filter((entry) => entry.status === "complete" && entry.winner === "tie").length,
    readyForPublicShare: recent.filter((entry) => entry.readyForPublicShare).length,
    humanMissing: recent.reduce((total, entry) => total + entry.humanMissing, 0),
    agentMissing: recent.reduce((total, entry) => total + entry.agentMissing, 0),
    totalHumanScore: recent.reduce((total, entry) => total + entry.humanScore, 0),
    totalAgentScore: recent.reduce((total, entry) => total + entry.agentScore, 0),
    recent: sorted.slice(0, 8)
  };
}

export function buildCompetitorProfile(input: {
  type: "human" | "agent";
  participantId: string;
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
}): CompetitorProfile | null {
  const user = input.type === "human" ? input.snapshot.users.find((entry) => entry.id === input.participantId && entry.type === "human") : undefined;
  const agent = input.type === "agent" ? input.snapshot.agents.find((entry) => entry.id === input.participantId) : undefined;
  if (!user && !agent) return null;

  const handle = user?.handle ?? agent!.handle;
  const participant: CompetitorProfileParticipant = user
    ? {
        type: "human",
        id: user.id,
        handle: user.handle,
        displayName: user.displayName,
        linkedSteamId: user.linkedSteamId,
        proofConsentAt: user.proofConsentAt,
        proofConsentRevokedAt: user.proofConsentRevokedAt
      }
    : {
        type: "agent",
        id: agent!.id,
        userId: agent!.userId,
        handle: agent!.handle,
        displayName: agent!.displayName,
        provider: agent!.provider,
        runtimeProvider: agent!.runtimeProvider,
        status: agent!.status,
        capabilities: agent!.capabilities
      };

  const runs = input.snapshot.runs.filter((run) => runBelongsTo({ run, type: input.type, handle }));
  const runIds = new Set(runs.map((run) => run.id));
  const matches = input.snapshot.matches.filter((match) =>
    input.type === "human" ? match.humanUserId === input.participantId : match.agentId === input.participantId
  );
  const suiteRaces = input.snapshot.suiteRaces.filter((race) =>
    input.type === "human" ? race.humanUserId === input.participantId : race.agentId === input.participantId
  );
  const scoreboardRows = input.snapshot.scoreboard.filter((row) => scoreboardRowBelongsTo({ row, type: input.type, handle }));
  const matchResults = matches.map((match) => matchResult({ match, type: input.type }));
  const suiteRaceResults = suiteRaces.map((race) => suiteRaceResult({ race, type: input.type }));
  const proofs = input.snapshot.proofs.filter((proof) => runIds.has(proof.runId));

  return {
    participant,
    registrations: input.snapshot.eventRegistrations.filter(
      (registration) => registration.participantType === input.type && registration.participantId === input.participantId
    ),
    runs: {
      total: runs.length,
      scored: runs.filter((run) => run.status === "scored").length,
      failed: runs.filter((run) => run.status === "failed").length,
      totalScore: runs.reduce((total, run) => total + (run.score ?? 0), 0),
      bestScore: runs.reduce<number | undefined>((best, run) => run.score === undefined ? best : Math.max(best ?? run.score, run.score), undefined),
      recent: [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8)
    },
    matches: {
      total: matches.length,
      scored: matches.filter((match) => match.status === "scored").length,
      wins: matchResults.filter((result) => result === "win").length,
      losses: matchResults.filter((result) => result === "loss").length,
      ties: matchResults.filter((result) => result === "tie").length,
      recent: [...matches].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8)
    },
    suiteRaces: {
      total: suiteRaces.length,
      scored: suiteRaces.filter((race) => race.status === "scored").length,
      wins: suiteRaceResults.filter((result) => result === "win").length,
      losses: suiteRaceResults.filter((result) => result === "loss").length,
      ties: suiteRaceResults.filter((result) => result === "tie").length,
      eventScoped: suiteRaces.filter((race) => race.eventScope !== undefined).length,
      totalScore: suiteRaces.reduce((total, race) => total + (input.type === "human" ? race.humanScore ?? 0 : race.agentScore ?? 0), 0),
      recent: [...suiteRaces].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8)
    },
    evidence: {
      artifacts: input.snapshot.artifacts.filter((artifact) => runIds.has(artifact.runId)).length,
      proofs: proofs.length,
      verifiedProofs: proofs.filter((proof) => proof.status === "verified").length,
      streams: input.snapshot.streams.filter((stream) => runIds.has(stream.runId)).length,
      liveStreams: input.snapshot.streams.filter((stream) => runIds.has(stream.runId) && stream.status === "live").length
    },
    scoreboard: {
      rows: scoreboardRows.length,
      totalScore: scoreboardRows.reduce((total, row) => total + row.score, 0),
      bestScore: scoreboardRows.reduce<number | undefined>((best, row) => Math.max(best ?? row.score, row.score), undefined),
      latestCompletedAt: scoreboardRows.reduce<string | undefined>((latest, row) => latest === undefined || row.completedAt > latest ? row.completedAt : latest, undefined),
      recent: [...scoreboardRows].sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 8)
    },
    campaignComparisons: buildCampaignComparisons({
      type: input.type,
      participantId: input.participantId,
      snapshot: input.snapshot,
      tasks: input.tasks
    })
  };
}
