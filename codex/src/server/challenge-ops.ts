import type { BenchmarkTask, ScoreboardRow } from "../benchmark/types";
import type { AgentProfile, BenchmarkChallenge, BenchmarkMatch, StoreSnapshot, UserAccount } from "./store";

export type ChallengeOpsTicketStatus =
  | "open"
  | "accepted"
  | "running"
  | "scoreboard-ready"
  | "evidence-missing"
  | "blocked"
  | "declined"
  | "canceled"
  | "failed";

export type ChallengeOpsTicket = {
  status: ChallengeOpsTicketStatus;
  readiness: "pending" | "public" | "attention";
  challenge: Pick<BenchmarkChallenge, "id" | "taskId" | "humanUserId" | "agentId" | "createdBy" | "status" | "createdAt" | "updatedAt" | "matchId">;
  task?: Pick<BenchmarkTask, "id" | "appid" | "gameName" | "title" | "track" | "level">;
  human?: Pick<UserAccount, "id" | "handle" | "displayName" | "linkedSteamId" | "proofConsentAt">;
  agent?: Pick<AgentProfile, "id" | "handle" | "displayName" | "provider" | "runtimeProvider" | "status">;
  match?: Pick<BenchmarkMatch, "id" | "status" | "humanRunId" | "agentRunId" | "winner" | "margin" | "updatedAt">;
  scoreboardRows: number;
  blockers: string[];
  links: {
    challenge: string;
    accept: string;
    runLocal: string;
    evidenceBundle: string;
    resultCertificate: string;
    match?: string;
    humanRun?: string;
    agentRun?: string;
  };
};

export type ChallengeOpsReport = {
  schemaVersion: "steambench.challenge-ops-report.v1";
  generatedAt: string;
  status: "needs-acceptance" | "needs-execution" | "needs-attention" | "ready-to-share" | "idle";
  filters: {
    status?: ChallengeOpsTicketStatus;
    limit: number;
  };
  totals: {
    challenges: number;
    selectedTickets: number;
    open: number;
    accepted: number;
    running: number;
    scoreboardReady: number;
    evidenceMissing: number;
    blocked: number;
    declined: number;
    canceled: number;
    failed: number;
    scoreboardRows: number;
  };
  tickets: ChallengeOpsTicket[];
  recommendedActions: Array<{
    id: "accept-open-challenge" | "run-challenge-local" | "inspect-challenge-evidence" | "share-challenge-certificate" | "inspect-challenges";
    label: string;
    priority: "high" | "medium" | "low";
    method: "GET" | "POST";
    endpoint: string;
    reason: string;
  }>;
  links: {
    challenges: "/api/challenges";
    standings: "/api/standings";
    scoreboardOps: "/api/scoreboard/ops-report";
  };
};

function taskPick(task: BenchmarkTask): NonNullable<ChallengeOpsTicket["task"]> {
  return {
    id: task.id,
    appid: task.appid,
    gameName: task.gameName,
    title: task.title,
    track: task.track,
    level: task.level
  };
}

function humanPick(human: UserAccount): NonNullable<ChallengeOpsTicket["human"]> {
  return {
    id: human.id,
    handle: human.handle,
    displayName: human.displayName,
    linkedSteamId: human.linkedSteamId,
    proofConsentAt: human.proofConsentAt
  };
}

function agentPick(agent: AgentProfile): NonNullable<ChallengeOpsTicket["agent"]> {
  return {
    id: agent.id,
    handle: agent.handle,
    displayName: agent.displayName,
    provider: agent.provider,
    runtimeProvider: agent.runtimeProvider,
    status: agent.status
  };
}

function matchPick(match: BenchmarkMatch): NonNullable<ChallengeOpsTicket["match"]> {
  return {
    id: match.id,
    status: match.status,
    humanRunId: match.humanRunId,
    agentRunId: match.agentRunId,
    winner: match.winner,
    margin: match.margin,
    updatedAt: match.updatedAt
  };
}

function scoreboardRowsForMatch(match: BenchmarkMatch | undefined, scoreboard: ScoreboardRow[]): number {
  const runIds = new Set([match?.humanRunId, match?.agentRunId].filter((id): id is string => Boolean(id)));
  return scoreboard.filter((row) => row.runId && runIds.has(row.runId)).length;
}

function ticketStatus(input: {
  challenge: BenchmarkChallenge;
  match?: BenchmarkMatch;
  scoreboardRows: number;
}): ChallengeOpsTicketStatus {
  if (input.challenge.status === "declined") return "declined";
  if (input.challenge.status === "canceled" || input.match?.status === "canceled") return "canceled";
  if (input.challenge.status === "blocked") return "blocked";
  if (input.match?.status === "failed") return "failed";
  if (input.challenge.status === "open") return "open";
  if (!input.match) return "evidence-missing";
  if (input.match.status === "scheduled") return "accepted";
  if (input.match.status === "running" || input.challenge.status === "running") return "running";
  if (input.match.status === "scored" && input.scoreboardRows >= 2) return "scoreboard-ready";
  if (input.match.status === "scored") return "evidence-missing";
  return "evidence-missing";
}

function readiness(status: ChallengeOpsTicketStatus): ChallengeOpsTicket["readiness"] {
  if (status === "scoreboard-ready") return "public";
  if (status === "open" || status === "accepted" || status === "running") return "pending";
  return "attention";
}

function blockers(input: {
  status: ChallengeOpsTicketStatus;
  challenge: BenchmarkChallenge;
  task?: BenchmarkTask;
  human?: UserAccount;
  agent?: AgentProfile;
  match?: BenchmarkMatch;
  scoreboardRows: number;
}): string[] {
  const result = new Set<string>();
  if (!input.task) result.add("task_missing");
  if (!input.human) result.add("human_missing");
  if (!input.agent) result.add("agent_missing");
  if (input.human && !input.human.linkedSteamId) result.add("steam_link_missing");
  if (input.human && !input.human.proofConsentAt) result.add("proof_consent_missing");
  if (input.agent && input.agent.status !== "active") result.add("agent_inactive");
  if (input.status === "open") result.add("challenge_not_accepted");
  if ((input.challenge.status === "accepted" || input.challenge.status === "running") && !input.match) result.add("match_missing");
  if (input.status === "accepted") result.add("match_not_run");
  if (input.status === "running") result.add("match_still_running");
  if (input.match?.status === "scored" && input.scoreboardRows < 2) result.add("scoreboard_rows_missing");
  if (input.status === "blocked") result.add("challenge_blocked");
  if (input.status === "failed") result.add("match_failed");
  if (input.status === "declined") result.add("challenge_declined");
  if (input.status === "canceled") result.add("challenge_canceled");
  return [...result].sort();
}

function reportStatus(totals: ChallengeOpsReport["totals"]): ChallengeOpsReport["status"] {
  if (totals.evidenceMissing + totals.blocked + totals.failed > 0) return "needs-attention";
  if (totals.open > 0) return "needs-acceptance";
  if (totals.accepted + totals.running > 0) return "needs-execution";
  if (totals.scoreboardReady > 0) return "ready-to-share";
  return "idle";
}

function actions(tickets: ChallengeOpsTicket[]): ChallengeOpsReport["recommendedActions"] {
  const result: ChallengeOpsReport["recommendedActions"] = [];
  const open = tickets.find((ticket) => ticket.status === "open");
  if (open) {
    result.push({
      id: "accept-open-challenge",
      label: "Accept open challenge",
      priority: "high",
      method: "POST",
      endpoint: open.links.accept,
      reason: `${open.challenge.id} needs a match contract before either side can run.`
    });
  }

  const runnable = tickets.find((ticket) => ticket.status === "accepted" || ticket.status === "running");
  if (runnable) {
    result.push({
      id: "run-challenge-local",
      label: "Run challenge locally",
      priority: result.length === 0 ? "high" : "medium",
      method: "POST",
      endpoint: runnable.links.runLocal,
      reason: `${runnable.challenge.id} has a challenge match that still needs scored human and agent runs.`
    });
  }

  const evidence = tickets.find((ticket) => ticket.status === "evidence-missing" || ticket.status === "blocked" || ticket.status === "failed");
  if (evidence) {
    result.push({
      id: "inspect-challenge-evidence",
      label: "Inspect challenge evidence",
      priority: result.length === 0 ? "high" : "medium",
      method: "GET",
      endpoint: evidence.links.evidenceBundle,
      reason: `${evidence.challenge.id} is not publicly shareable; inspect its challenge evidence bundle.`
    });
  }

  const ready = tickets.find((ticket) => ticket.status === "scoreboard-ready");
  if (ready) {
    result.push({
      id: "share-challenge-certificate",
      label: "Share challenge certificate",
      priority: result.length === 0 ? "high" : "low",
      method: "GET",
      endpoint: ready.links.resultCertificate,
      reason: `${ready.challenge.id} has scored human and agent evidence ready for public sharing.`
    });
  }

  result.push({
    id: "inspect-challenges",
    label: "Inspect challenges",
    priority: "low",
    method: "GET",
    endpoint: "/api/challenges",
    reason: "Review the full human-vs-agent challenge queue."
  });
  return result;
}

export function buildChallengeOpsReport(input: {
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
  status?: ChallengeOpsTicketStatus;
  limit?: number;
  generatedAt?: string;
}): ChallengeOpsReport {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
  const usersById = new Map(input.snapshot.users.map((user) => [user.id, user]));
  const agentsById = new Map(input.snapshot.agents.map((agent) => [agent.id, agent]));
  const matchesById = new Map(input.snapshot.matches.map((match) => [match.id, match]));
  const tickets = input.snapshot.challenges
    .map((challenge): ChallengeOpsTicket => {
      const task = tasksById.get(challenge.taskId);
      const human = usersById.get(challenge.humanUserId);
      const agent = agentsById.get(challenge.agentId);
      const match = challenge.matchId ? matchesById.get(challenge.matchId) : undefined;
      const scoreboardRows = scoreboardRowsForMatch(match, input.snapshot.scoreboard);
      const status = ticketStatus({ challenge, match, scoreboardRows });
      return {
        status,
        readiness: readiness(status),
        challenge: {
          id: challenge.id,
          taskId: challenge.taskId,
          humanUserId: challenge.humanUserId,
          agentId: challenge.agentId,
          createdBy: challenge.createdBy,
          status: challenge.status,
          createdAt: challenge.createdAt,
          updatedAt: challenge.updatedAt,
          matchId: challenge.matchId
        },
        task: task ? taskPick(task) : undefined,
        human: human ? humanPick(human) : undefined,
        agent: agent ? agentPick(agent) : undefined,
        match: match ? matchPick(match) : undefined,
        scoreboardRows,
        blockers: blockers({ status, challenge, task, human, agent, match, scoreboardRows }),
        links: {
          challenge: `/api/challenges/${challenge.id}`,
          accept: `/api/challenges/${challenge.id}/accept`,
          runLocal: `/api/challenges/${challenge.id}/run-local`,
          evidenceBundle: `/api/challenges/${challenge.id}/evidence-bundle`,
          resultCertificate: `/api/challenges/${challenge.id}/result-certificate`,
          ...(match ? { match: `/api/matches/${match.id}` } : {}),
          ...(match?.humanRunId ? { humanRun: `/api/runs/${match.humanRunId}` } : {}),
          ...(match?.agentRunId ? { agentRun: `/api/runs/${match.agentRunId}` } : {})
        }
      };
    })
    .filter((ticket) => !input.status || ticket.status === input.status)
    .sort((a, b) => {
      const priority = (ticket: ChallengeOpsTicket) => {
        if (ticket.status === "evidence-missing" || ticket.status === "blocked" || ticket.status === "failed") return 0;
        if (ticket.status === "open") return 1;
        if (ticket.status === "accepted" || ticket.status === "running") return 2;
        if (ticket.status === "scoreboard-ready") return 3;
        return 4;
      };
      return priority(a) - priority(b) || b.challenge.updatedAt.localeCompare(a.challenge.updatedAt);
    })
    .slice(0, limit);
  const totals: ChallengeOpsReport["totals"] = {
    challenges: input.snapshot.challenges.length,
    selectedTickets: tickets.length,
    open: tickets.filter((ticket) => ticket.status === "open").length,
    accepted: tickets.filter((ticket) => ticket.status === "accepted").length,
    running: tickets.filter((ticket) => ticket.status === "running").length,
    scoreboardReady: tickets.filter((ticket) => ticket.status === "scoreboard-ready").length,
    evidenceMissing: tickets.filter((ticket) => ticket.status === "evidence-missing").length,
    blocked: tickets.filter((ticket) => ticket.status === "blocked").length,
    declined: tickets.filter((ticket) => ticket.status === "declined").length,
    canceled: tickets.filter((ticket) => ticket.status === "canceled").length,
    failed: tickets.filter((ticket) => ticket.status === "failed").length,
    scoreboardRows: tickets.reduce((total, ticket) => total + ticket.scoreboardRows, 0)
  };
  return {
    schemaVersion: "steambench.challenge-ops-report.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: reportStatus(totals),
    filters: {
      status: input.status,
      limit
    },
    totals,
    tickets,
    recommendedActions: actions(tickets),
    links: {
      challenges: "/api/challenges",
      standings: "/api/standings",
      scoreboardOps: "/api/scoreboard/ops-report"
    }
  };
}
