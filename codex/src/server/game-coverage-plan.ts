import { buildTaskReview, type TaskReview } from "../benchmark/task-review";
import type { BenchmarkTask, CompetitorType, GameCatalogEntry, ScoreboardRow } from "../benchmark/types";
import { buildRuntimeReadiness, type RuntimeReadiness } from "../runtime/readiness";
import type { AgentProfile, BenchmarkRun, StoreSnapshot, TaskRegistryEntry, UserAccount } from "./store";

export type GameCoveragePlanItem = {
  task: BenchmarkTask;
  review: TaskReview;
  scoreboard: {
    rows: number;
    humanRows: number;
    agentRows: number;
    leader?: ScoreboardRow;
    humanLeader?: ScoreboardRow;
    agentLeader?: ScoreboardRow;
  };
  gaps: Array<"human" | "agent">;
  selectedHuman?: {
    userId: string;
    status: "ready" | "select-human" | "steam-not-linked" | "consent-required" | "already-scored";
    existingRun?: BenchmarkRun;
    existingScore?: number;
    reason: string;
    action: {
      method: "POST";
      endpoint?: string;
      body?: Record<string, string>;
    };
  };
  selectedAgent?: {
    agentId: string;
    status: "ready" | "select-agent" | "agent-not-active" | "missing-capabilities" | "already-scored";
    readiness: RuntimeReadiness;
    existingRun?: BenchmarkRun;
    existingScore?: number;
    reason: string;
    action: {
      method: "POST";
      endpoint?: string;
      body?: Record<string, string>;
    };
  };
  priority: "fill-both" | "fill-human" | "fill-agent" | "covered" | "blocked";
  nextActions: string[];
};

export type GameCoveragePlan = {
  schemaVersion: "steambench.game-coverage-plan.v1";
  generatedAt: string;
  game: GameCatalogEntry;
  totals: {
    activeTasks: number;
    candidateTasks: number;
    scoredTasks: number;
    fullyCoveredTasks: number;
    humanCoveredTasks: number;
    agentCoveredTasks: number;
    humanGaps: number;
    agentGaps: number;
    readyHumanActions: number;
    readyAgentActions: number;
    blockedTasks: number;
  };
  selectedHuman?: Pick<UserAccount, "id" | "handle" | "displayName" | "linkedSteamId" | "proofConsentAt">;
  selectedAgent?: Pick<AgentProfile, "id" | "handle" | "displayName" | "status" | "capabilities" | "runtimeProvider">;
  items: GameCoveragePlanItem[];
  links: {
    standings: string;
    evidenceBundle: string;
    resultCertificate: string;
  };
};

function bestByType(rows: ScoreboardRow[], type?: CompetitorType): ScoreboardRow | undefined {
  return rows
    .filter((row) => type === undefined || row.type === type)
    .sort((a, b) => b.score - a.score || a.completedAt.localeCompare(b.completedAt) || a.competitor.localeCompare(b.competitor))[0];
}

function rowMatchesTask(row: ScoreboardRow, task: BenchmarkTask): boolean {
  if (row.taskId) return row.taskId === task.id;
  return (row.appid === task.appid || row.game === task.gameName) && row.task === task.title;
}

function runBelongsToUser(run: BenchmarkRun, user: UserAccount): boolean {
  return run.competitor === `human:${user.handle}` || run.competitor === user.handle || run.competitor === user.displayName;
}

function runBelongsToAgent(run: BenchmarkRun, agent: AgentProfile): boolean {
  return run.competitor === `agent:${agent.handle}` || run.competitor === agent.handle || run.competitor === agent.displayName;
}

function humanStatus(input: {
  user?: UserAccount;
  task: BenchmarkTask;
  existingRun?: BenchmarkRun;
}): GameCoveragePlanItem["selectedHuman"] | undefined {
  if (!input.user) return undefined;
  if (!input.user.linkedSteamId) {
    return {
      userId: input.user.id,
      status: "steam-not-linked",
      reason: "Link Steam before submitting public benchmark proof.",
      action: { method: "POST", endpoint: `/api/users/${input.user.id}/steam` }
    };
  }
  if (!input.user.proofConsentAt) {
    return {
      userId: input.user.id,
      status: "consent-required",
      reason: "Grant Steam proof consent before public ranking.",
      action: { method: "POST", endpoint: `/api/users/${input.user.id}/steam-proof-consent` }
    };
  }
  if (input.existingRun?.status === "scored") {
    return {
      userId: input.user.id,
      status: "already-scored",
      existingRun: input.existingRun,
      existingScore: input.existingRun.score,
      reason: "Selected human already has a scored run for this task.",
      action: { method: "POST" }
    };
  }
  return {
    userId: input.user.id,
    status: "ready",
    existingRun: input.existingRun,
    existingScore: input.existingRun?.score,
    reason: input.task.track === "achievement"
      ? "Submit canonical output.mp4 and Steam achievement proof."
      : "Submit canonical output.mp4 and manual metric proof.",
    action: {
      method: "POST",
      endpoint: `/api/users/${input.user.id}/runs`,
      body: { taskId: input.task.id }
    }
  };
}

function agentStatus(input: {
  agent?: AgentProfile;
  task: BenchmarkTask;
  existingRun?: BenchmarkRun;
}): GameCoveragePlanItem["selectedAgent"] | undefined {
  if (!input.agent) return undefined;
  const readiness = buildRuntimeReadiness(input.task, input.agent);
  if (input.agent.status !== "active") {
    return {
      agentId: input.agent.id,
      status: "agent-not-active",
      readiness,
      existingRun: input.existingRun,
      existingScore: input.existingRun?.score,
      reason: "Agent profile must be active before queueing runs.",
      action: { method: "POST", endpoint: `/api/agents/${input.agent.id}/status`, body: { status: "active" } }
    };
  }
  if (input.existingRun?.status === "scored") {
    return {
      agentId: input.agent.id,
      status: "already-scored",
      readiness,
      existingRun: input.existingRun,
      existingScore: input.existingRun.score,
      reason: "Selected agent already has a scored run for this task.",
      action: { method: "POST" }
    };
  }
  if (!readiness.ready) {
    return {
      agentId: input.agent.id,
      status: "missing-capabilities",
      readiness,
      existingRun: input.existingRun,
      existingScore: input.existingRun?.score,
      reason: `Missing ${readiness.missingCapabilities.slice(0, 4).join(", ") || "runtime capabilities"}.`,
      action: { method: "POST" }
    };
  }
  return {
    agentId: input.agent.id,
    status: "ready",
    readiness,
    existingRun: input.existingRun,
    existingScore: input.existingRun?.score,
    reason: "Agent runtime profile is ready for this game task.",
    action: {
      method: "POST",
      endpoint: `/api/agents/${input.agent.id}/runs`,
      body: { taskId: input.task.id }
    }
  };
}

function priorityFor(input: {
  gaps: Array<"human" | "agent">;
  review: TaskReview;
  human?: GameCoveragePlanItem["selectedHuman"];
  agent?: GameCoveragePlanItem["selectedAgent"];
}): GameCoveragePlanItem["priority"] {
  if (input.review.decision === "reject") return "blocked";
  if (input.gaps.includes("human") && input.gaps.includes("agent")) return "fill-both";
  if (input.gaps.includes("human")) return "fill-human";
  if (input.gaps.includes("agent")) return "fill-agent";
  if (input.human?.status === "ready" || input.agent?.status === "ready") return "covered";
  return "covered";
}

export function buildGameCoveragePlan(input: {
  game: GameCatalogEntry;
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
  taskRegistry: TaskRegistryEntry[];
  human?: UserAccount;
  agent?: AgentProfile;
  limit?: number;
  generatedAt?: string;
}): GameCoveragePlan {
  const limit = input.limit ?? 12;
  const activeTasks = input.tasks.filter((task) => task.appid === input.game.appid);
  const registryTasks = input.taskRegistry.filter((task) => task.appid === input.game.appid);
  const humanRuns = input.human ? input.snapshot.runs.filter((run) => runBelongsToUser(run, input.human!)) : [];
  const agentRuns = input.agent ? input.snapshot.runs.filter((run) => runBelongsToAgent(run, input.agent!)) : [];
  const items = activeTasks.map((task): GameCoveragePlanItem => {
    const rows = input.snapshot.scoreboard.filter((row) => rowMatchesTask(row, task));
    const humanRows = rows.filter((row) => row.type === "human");
    const agentRows = rows.filter((row) => row.type === "agent");
    const gaps: Array<"human" | "agent"> = [
      ...(humanRows.length === 0 ? ["human" as const] : []),
      ...(agentRows.length === 0 ? ["agent" as const] : [])
    ];
    const review = buildTaskReview(task);
    const selectedHuman = humanStatus({
      user: input.human,
      task,
      existingRun: humanRuns.find((run) => run.taskId === task.id)
    });
    const selectedAgent = agentStatus({
      agent: input.agent,
      task,
      existingRun: agentRuns.find((run) => run.taskId === task.id)
    });
    const nextActions = [
      ...(selectedHuman?.status === "ready" ? [`Queue human run through ${selectedHuman.action.endpoint}.`] : []),
      ...(selectedAgent?.status === "ready" ? [`Queue agent run through ${selectedAgent.action.endpoint}.`] : []),
      ...(review.decision !== "ranked-ready" ? [`Review decision is ${review.decision}; require review approval before public races.`] : [])
    ];
    return {
      task,
      review,
      scoreboard: {
        rows: rows.length,
        humanRows: humanRows.length,
        agentRows: agentRows.length,
        leader: bestByType(rows),
        humanLeader: bestByType(rows, "human"),
        agentLeader: bestByType(rows, "agent")
      },
      gaps,
      selectedHuman,
      selectedAgent,
      priority: priorityFor({ gaps, review, human: selectedHuman, agent: selectedAgent }),
      nextActions
    };
  });
  const priorityRank: Record<GameCoveragePlanItem["priority"], number> = {
    "fill-both": 0,
    "fill-human": 1,
    "fill-agent": 2,
    covered: 3,
    blocked: 4
  };
  const sortedItems = items
    .sort((a, b) =>
      priorityRank[a.priority] - priorityRank[b.priority] ||
      b.task.score - a.task.score ||
      a.task.title.localeCompare(b.task.title)
    )
    .slice(0, limit);

  return {
    schemaVersion: "steambench.game-coverage-plan.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    game: input.game,
    totals: {
      activeTasks: activeTasks.length,
      candidateTasks: registryTasks.filter((task) => task.status === "candidate").length,
      scoredTasks: items.filter((item) => item.scoreboard.rows > 0).length,
      fullyCoveredTasks: items.filter((item) => item.scoreboard.humanRows > 0 && item.scoreboard.agentRows > 0).length,
      humanCoveredTasks: items.filter((item) => item.scoreboard.humanRows > 0).length,
      agentCoveredTasks: items.filter((item) => item.scoreboard.agentRows > 0).length,
      humanGaps: items.filter((item) => item.gaps.includes("human")).length,
      agentGaps: items.filter((item) => item.gaps.includes("agent")).length,
      readyHumanActions: items.filter((item) => item.selectedHuman?.status === "ready").length,
      readyAgentActions: items.filter((item) => item.selectedAgent?.status === "ready").length,
      blockedTasks: items.filter((item) => item.priority === "blocked").length
    },
    selectedHuman: input.human
      ? {
          id: input.human.id,
          handle: input.human.handle,
          displayName: input.human.displayName,
          linkedSteamId: input.human.linkedSteamId,
          proofConsentAt: input.human.proofConsentAt
        }
      : undefined,
    selectedAgent: input.agent
      ? {
          id: input.agent.id,
          handle: input.agent.handle,
          displayName: input.agent.displayName,
          status: input.agent.status,
          capabilities: input.agent.capabilities,
          runtimeProvider: input.agent.runtimeProvider
        }
      : undefined,
    items: sortedItems,
    links: {
      standings: `/api/games/${input.game.appid}/standings`,
      evidenceBundle: `/api/games/${input.game.appid}/evidence-bundle`,
      resultCertificate: `/api/games/${input.game.appid}/result-certificate`
    }
  };
}
