import type { BenchmarkTask, ScoreboardRow } from "../benchmark/types";
import { buildMatchArenaPacket, type MatchArenaPacket } from "./match-arena-packet";
import type { AgentProfile, BenchmarkMatch, BenchmarkRun, UserAccount } from "./store";

export type MatchArenaOpsStatus =
  | "needs-start"
  | "needs-human-proof"
  | "needs-agent-evidence"
  | "ready-to-evaluate"
  | "scoreboard-ready"
  | "evidence-missing"
  | "failed"
  | "canceled";

export type MatchArenaOpsTicket = {
  status: MatchArenaOpsStatus;
  readiness: "pending" | "attention" | "public";
  match: Pick<BenchmarkMatch, "id" | "taskId" | "humanUserId" | "agentId" | "humanRunId" | "agentRunId" | "status" | "winner" | "margin" | "updatedAt">;
  task?: Pick<BenchmarkTask, "id" | "appid" | "gameName" | "title" | "track" | "level">;
  human?: Pick<UserAccount, "id" | "handle" | "displayName" | "linkedSteamId" | "proofConsentAt">;
  agent?: Pick<AgentProfile, "id" | "handle" | "displayName" | "provider" | "runtimeProvider" | "status">;
  humanRun?: Pick<BenchmarkRun, "id" | "status" | "score" | "updatedAt">;
  agentRun?: Pick<BenchmarkRun, "id" | "status" | "score" | "updatedAt">;
  scoreboardRows: number;
  blockers: string[];
  arenaPacket: MatchArenaPacket;
  links: {
    arenaPacket: string;
    match: string;
    start: string;
    runLocal: string;
    evaluate: string;
    resultCertificate: string;
    humanSubmission: string;
    agentHandoff?: string;
  };
};

export type MatchArenaOpsReport = {
  schemaVersion: "steambench.match-arena-ops-report.v1";
  generatedAt: string;
  status: "idle" | "needs-execution" | "needs-attention" | "ready-to-share";
  filters: {
    status?: MatchArenaOpsStatus;
    limit: number;
  };
  totals: {
    matches: number;
    selectedTickets: number;
    needsStart: number;
    needsHumanProof: number;
    needsAgentEvidence: number;
    readyToEvaluate: number;
    scoreboardReady: number;
    evidenceMissing: number;
    failed: number;
    canceled: number;
    scoreboardRows: number;
  };
  tickets: MatchArenaOpsTicket[];
  recommendedActions: Array<{
    id: "run-match-local" | "start-match" | "submit-human-proof" | "inspect-agent-handoff" | "evaluate-match" | "share-match-certificate" | "inspect-arena-packet";
    label: string;
    priority: "high" | "medium" | "low";
    method: "GET" | "POST";
    endpoint: string;
    body?: Record<string, unknown>;
    reason: string;
  }>;
  links: {
    matches: "/api/matches";
    matchFeed: "/api/matches/feed";
    standings: "/api/standings";
  };
};

function taskPick(task?: BenchmarkTask): MatchArenaOpsTicket["task"] {
  return task
    ? {
        id: task.id,
        appid: task.appid,
        gameName: task.gameName,
        title: task.title,
        track: task.track,
        level: task.level
      }
    : undefined;
}

function humanPick(human?: UserAccount): MatchArenaOpsTicket["human"] {
  return human
    ? {
        id: human.id,
        handle: human.handle,
        displayName: human.displayName,
        linkedSteamId: human.linkedSteamId,
        proofConsentAt: human.proofConsentAt
      }
    : undefined;
}

function agentPick(agent?: AgentProfile): MatchArenaOpsTicket["agent"] {
  return agent
    ? {
        id: agent.id,
        handle: agent.handle,
        displayName: agent.displayName,
        provider: agent.provider,
        runtimeProvider: agent.runtimeProvider,
        status: agent.status
      }
    : undefined;
}

function runPick(run?: BenchmarkRun): MatchArenaOpsTicket["humanRun"] {
  return run
    ? {
        id: run.id,
        status: run.status,
        score: run.score,
        updatedAt: run.updatedAt
      }
    : undefined;
}

function scoreboardRowsForMatch(match: BenchmarkMatch, rows: ScoreboardRow[]): number {
  const runIds = new Set([match.humanRunId, match.agentRunId].filter((id): id is string => Boolean(id)));
  return rows.filter((row) => row.runId && runIds.has(row.runId)).length;
}

function ticketStatus(input: {
  match: BenchmarkMatch;
  humanRun?: BenchmarkRun;
  agentRun?: BenchmarkRun;
  scoreboardRows: number;
}): MatchArenaOpsStatus {
  if (input.match.status === "canceled") return "canceled";
  if (input.match.status === "failed" || input.humanRun?.status === "failed" || input.agentRun?.status === "failed") return "failed";
  if (input.match.status === "scored") return input.scoreboardRows >= 2 ? "scoreboard-ready" : "evidence-missing";
  if (!input.match.humanRunId || !input.match.agentRunId) return "needs-start";
  if (input.humanRun?.status !== "scored") return "needs-human-proof";
  if (input.agentRun?.status !== "scored") return "needs-agent-evidence";
  return "ready-to-evaluate";
}

function readiness(status: MatchArenaOpsStatus): MatchArenaOpsTicket["readiness"] {
  if (status === "scoreboard-ready") return "public";
  if (status === "evidence-missing" || status === "failed" || status === "canceled") return "attention";
  return "pending";
}

function blockers(input: {
  status: MatchArenaOpsStatus;
  task?: BenchmarkTask;
  human?: UserAccount;
  agent?: AgentProfile;
  humanRun?: BenchmarkRun;
  agentRun?: BenchmarkRun;
  scoreboardRows: number;
}): string[] {
  const result = new Set<string>();
  if (!input.task) result.add("task_missing");
  if (!input.human) result.add("human_missing");
  if (!input.agent) result.add("agent_missing");
  if (input.human && !input.human.linkedSteamId) result.add("steam_link_missing");
  if (input.human && !input.human.proofConsentAt) result.add("proof_consent_missing");
  if (input.agent && input.agent.status !== "active") result.add("agent_inactive");
  if (input.status === "needs-start") result.add("match_not_started");
  if (input.status === "needs-human-proof") result.add("human_proof_missing");
  if (input.status === "needs-agent-evidence") result.add("agent_evidence_missing");
  if (input.status === "ready-to-evaluate") result.add("match_not_evaluated");
  if (input.status === "evidence-missing" && input.scoreboardRows < 2) result.add("scoreboard_rows_missing");
  if (input.status === "failed") result.add("match_failed");
  if (input.status === "canceled") result.add("match_canceled");
  if (input.humanRun?.status === "failed") result.add("human_run_failed");
  if (input.agentRun?.status === "failed") result.add("agent_run_failed");
  return [...result].sort();
}

function reportStatus(totals: MatchArenaOpsReport["totals"]): MatchArenaOpsReport["status"] {
  if (totals.evidenceMissing + totals.failed > 0) return "needs-attention";
  if (totals.needsStart + totals.needsHumanProof + totals.needsAgentEvidence + totals.readyToEvaluate > 0) return "needs-execution";
  if (totals.scoreboardReady > 0) return "ready-to-share";
  return "idle";
}

function actions(tickets: MatchArenaOpsTicket[]): MatchArenaOpsReport["recommendedActions"] {
  const result: MatchArenaOpsReport["recommendedActions"] = [];
  const runnable = tickets.find((ticket) =>
    ticket.status === "needs-start" ||
    ticket.status === "needs-human-proof" ||
    ticket.status === "needs-agent-evidence"
  );
  if (runnable) {
    result.push({
      id: "run-match-local",
      label: "Run match locally",
      priority: "high",
      method: "POST",
      endpoint: runnable.links.runLocal,
      reason: `${runnable.match.id} needs paired human/agent scoring.`
    });
  }

  const start = tickets.find((ticket) => ticket.status === "needs-start");
  if (start) {
    result.push({
      id: "start-match",
      label: "Start match runs",
      priority: result.length === 0 ? "high" : "medium",
      method: "POST",
      endpoint: start.links.start,
      reason: `${start.match.id} has no paired human and agent run ids yet.`
    });
  }

  const human = tickets.find((ticket) => ticket.status === "needs-human-proof");
  if (human) {
    result.push({
      id: "submit-human-proof",
      label: "Submit human proof",
      priority: result.length === 0 ? "high" : "medium",
      method: "POST",
      endpoint: human.links.humanSubmission,
      body: { taskId: human.match.taskId },
      reason: `${human.match.id} needs the human canonical proof path.`
    });
  }

  const agent = tickets.find((ticket) => ticket.status === "needs-agent-evidence" && ticket.links.agentHandoff);
  if (agent && agent.links.agentHandoff) {
    result.push({
      id: "inspect-agent-handoff",
      label: "Inspect agent handoff",
      priority: result.length === 0 ? "high" : "medium",
      method: "GET",
      endpoint: agent.links.agentHandoff,
      reason: `${agent.match.id} needs agent action/proof evidence.`
    });
  }

  const ready = tickets.find((ticket) => ticket.status === "ready-to-evaluate");
  if (ready) {
    result.push({
      id: "evaluate-match",
      label: "Evaluate match",
      priority: result.length === 0 ? "high" : "medium",
      method: "POST",
      endpoint: ready.links.evaluate,
      reason: `${ready.match.id} has scored child runs and needs a published winner.`
    });
  }

  const publicReady = tickets.find((ticket) => ticket.status === "scoreboard-ready");
  if (publicReady) {
    result.push({
      id: "share-match-certificate",
      label: "Share match certificate",
      priority: result.length === 0 ? "high" : "low",
      method: "GET",
      endpoint: publicReady.links.resultCertificate,
      reason: `${publicReady.match.id} is scoreboard-ready for public sharing.`
    });
  }

  const inspect = tickets[0];
  if (inspect) {
    result.push({
      id: "inspect-arena-packet",
      label: "Inspect arena packet",
      priority: "low",
      method: "GET",
      endpoint: inspect.links.arenaPacket,
      reason: "Review the full human and agent arena handoff."
    });
  }
  return result;
}

export function buildMatchArenaOpsReport(input: {
  matches: BenchmarkMatch[];
  tasks: BenchmarkTask[];
  users: UserAccount[];
  agents: AgentProfile[];
  runs: BenchmarkRun[];
  scoreboard: ScoreboardRow[];
  status?: MatchArenaOpsStatus;
  limit?: number;
  generatedAt?: string;
}): MatchArenaOpsReport {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
  const usersById = new Map(input.users.map((user) => [user.id, user]));
  const agentsById = new Map(input.agents.map((agent) => [agent.id, agent]));
  const runsById = new Map(input.runs.map((run) => [run.id, run]));
  const tickets = input.matches
    .map((match): MatchArenaOpsTicket | null => {
      const task = tasksById.get(match.taskId);
      if (!task) return null;
      const human = usersById.get(match.humanUserId);
      const agent = agentsById.get(match.agentId);
      const humanRun = match.humanRunId ? runsById.get(match.humanRunId) : undefined;
      const agentRun = match.agentRunId ? runsById.get(match.agentRunId) : undefined;
      const scoreboardRows = scoreboardRowsForMatch(match, input.scoreboard);
      const status = ticketStatus({ match, humanRun, agentRun, scoreboardRows });
      const arenaPacket = buildMatchArenaPacket({ match, task, human, agent, humanRun, agentRun });
      return {
        status,
        readiness: readiness(status),
        match: {
          id: match.id,
          taskId: match.taskId,
          humanUserId: match.humanUserId,
          agentId: match.agentId,
          humanRunId: match.humanRunId,
          agentRunId: match.agentRunId,
          status: match.status,
          winner: match.winner,
          margin: match.margin,
          updatedAt: match.updatedAt
        },
        task: taskPick(task),
        human: humanPick(human),
        agent: agentPick(agent),
        humanRun: runPick(humanRun),
        agentRun: runPick(agentRun),
        scoreboardRows,
        blockers: blockers({ status, task, human, agent, humanRun, agentRun, scoreboardRows }),
        arenaPacket,
        links: {
          arenaPacket: `/api/matches/${match.id}/arena-packet`,
          match: `/api/matches/${match.id}`,
          start: `/api/matches/${match.id}/start`,
          runLocal: `/api/matches/${match.id}/run-local`,
          evaluate: `/api/matches/${match.id}/evaluate`,
          resultCertificate: `/api/matches/${match.id}/result-certificate`,
          humanSubmission: `/api/users/${match.humanUserId}/steam-proof-submissions`,
          agentHandoff: match.agentRunId ? `/api/runs/${match.agentRunId}/agent-handoff?agentId=${encodeURIComponent(match.agentId)}` : undefined
        }
      };
    })
    .filter((ticket): ticket is MatchArenaOpsTicket => Boolean(ticket))
    .filter((ticket) => !input.status || ticket.status === input.status)
    .sort((a, b) => {
      const priority = (ticket: MatchArenaOpsTicket) => {
        if (ticket.status === "evidence-missing" || ticket.status === "failed") return 0;
        if (ticket.status === "needs-start") return 1;
        if (ticket.status === "needs-human-proof" || ticket.status === "needs-agent-evidence") return 2;
        if (ticket.status === "ready-to-evaluate") return 3;
        if (ticket.status === "scoreboard-ready") return 4;
        return 5;
      };
      return priority(a) - priority(b) || b.match.updatedAt.localeCompare(a.match.updatedAt);
    })
    .slice(0, limit);
  const totals: MatchArenaOpsReport["totals"] = {
    matches: input.matches.length,
    selectedTickets: tickets.length,
    needsStart: tickets.filter((ticket) => ticket.status === "needs-start").length,
    needsHumanProof: tickets.filter((ticket) => ticket.status === "needs-human-proof").length,
    needsAgentEvidence: tickets.filter((ticket) => ticket.status === "needs-agent-evidence").length,
    readyToEvaluate: tickets.filter((ticket) => ticket.status === "ready-to-evaluate").length,
    scoreboardReady: tickets.filter((ticket) => ticket.status === "scoreboard-ready").length,
    evidenceMissing: tickets.filter((ticket) => ticket.status === "evidence-missing").length,
    failed: tickets.filter((ticket) => ticket.status === "failed").length,
    canceled: tickets.filter((ticket) => ticket.status === "canceled").length,
    scoreboardRows: tickets.reduce((total, ticket) => total + ticket.scoreboardRows, 0)
  };
  return {
    schemaVersion: "steambench.match-arena-ops-report.v1",
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
      matches: "/api/matches",
      matchFeed: "/api/matches/feed",
      standings: "/api/standings"
    }
  };
}
