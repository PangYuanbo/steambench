import { buildTaskReview } from "../benchmark/task-review";
import type { BenchmarkTask, ScoreboardRow } from "../benchmark/types";
import { buildRuntimeReadiness, type RuntimeReadiness } from "../runtime/readiness";
import type {
  AgentProfile,
  BenchmarkChallenge,
  BenchmarkMatch,
  BenchmarkRun,
  LiveStreamSession,
  RunProof,
  StoreSnapshot
} from "./store";

export type AgentRuntimeLabTask = {
  task: BenchmarkTask;
  readiness: RuntimeReadiness;
  reviewDecision: ReturnType<typeof buildTaskReview>["decision"];
  fairnessVerdict: ReturnType<typeof buildTaskReview>["fairnessVerdict"];
  priority: "ready" | "review" | "blocked";
  reason: string;
};

export type AgentRuntimeLab = {
  agent: AgentProfile;
  status: "ready" | "paused" | "blocked";
  command: string;
  capabilities: {
    provided: string[];
    missingAcrossRecommended: string[];
  };
  totals: {
    runs: number;
    scoredRuns: number;
    queuedRuns: number;
    activeRuns: number;
    failedRuns: number;
    matches: number;
    scoredMatches: number;
    openChallenges: number;
    broadcasts: number;
    verifiedProofs: number;
    scoreboardRows: number;
    totalScore: number;
  };
  queue: {
    nextRun?: BenchmarkRun;
    activeRuns: BenchmarkRun[];
    queuedRuns: BenchmarkRun[];
    expiredRuns: BenchmarkRun[];
  };
  recommendedTasks: AgentRuntimeLabTask[];
  recentRuns: BenchmarkRun[];
  recentMatches: BenchmarkMatch[];
  challenges: BenchmarkChallenge[];
  broadcasts: LiveStreamSession[];
  proofs: RunProof[];
  scoreboardRows: ScoreboardRow[];
};

function runBelongsToAgent(run: BenchmarkRun, agent: AgentProfile): boolean {
  return run.competitor === `agent:${agent.handle}` || run.competitor === agent.handle || run.competitor === agent.displayName;
}

function statusForLab(agent: AgentProfile, recommendedTasks: AgentRuntimeLabTask[]): AgentRuntimeLab["status"] {
  if (agent.status === "paused") return "paused";
  return recommendedTasks.some((entry) => entry.readiness.ready) ? "ready" : "blocked";
}

function taskReason(entry: {
  readiness: RuntimeReadiness;
  reviewDecision: ReturnType<typeof buildTaskReview>["decision"];
  task: BenchmarkTask;
}): string {
  if (!entry.readiness.ready) {
    return entry.readiness.missingCapabilities.length > 0
      ? `Missing ${entry.readiness.missingCapabilities.slice(0, 3).join(", ")}`
      : "Agent profile is not ready for this runtime adapter.";
  }
  if (entry.reviewDecision !== "ranked-ready") {
    return `${entry.reviewDecision} task; queue only after review approval.`;
  }
  return `${entry.task.gameName} ${entry.task.track} task is ready for runtime dispatch.`;
}

export function buildAgentRuntimeLab(input: {
  agent: AgentProfile;
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
  now?: Date;
  limit?: number;
}): AgentRuntimeLab {
  const limit = input.limit ?? 6;
  const agentRuns = input.snapshot.runs.filter((run) => runBelongsToAgent(run, input.agent));
  const runIds = new Set(agentRuns.map((run) => run.id));
  const activeStatuses: BenchmarkRun["status"][] = ["preparing", "running"];
  const nowMs = (input.now ?? new Date()).getTime();
  const activeRuns = agentRuns.filter((run) => activeStatuses.includes(run.status));
  const queuedRuns = agentRuns.filter((run) => run.status === "queued");
  const expiredRuns = activeRuns.filter((run) => {
    if (!run.leaseExpiresAt) return false;
    const expiryMs = Date.parse(run.leaseExpiresAt);
    return Number.isFinite(expiryMs) && expiryMs <= nowMs;
  });
  const matches = input.snapshot.matches.filter((match) => match.agentId === input.agent.id);
  const challenges = input.snapshot.challenges.filter((challenge) => challenge.agentId === input.agent.id);
  const broadcasts = input.snapshot.streams.filter((stream) => runIds.has(stream.runId));
  const proofs = input.snapshot.proofs.filter((proof) => runIds.has(proof.runId));
  const scoreboardRows = input.snapshot.scoreboard.filter((row) => row.competitor === `agent:${input.agent.handle}` || row.competitor === input.agent.handle);
  const challengedTaskIds = new Set(challenges.filter((challenge) => challenge.status === "open" || challenge.status === "accepted").map((challenge) => challenge.taskId));
  const recentTaskIds = new Set(agentRuns.slice(0, 12).map((run) => run.taskId));

  const recommendedTasks = input.tasks
    .map((task) => {
      const readiness = buildRuntimeReadiness(task, input.agent);
      const review = buildTaskReview(task);
      const priority: AgentRuntimeLabTask["priority"] = readiness.ready
        ? review.decision === "ranked-ready"
          ? "ready"
          : "review"
        : "blocked";
      return {
        task,
        readiness,
        reviewDecision: review.decision,
        fairnessVerdict: review.fairnessVerdict,
        priority,
        reason: taskReason({ readiness, reviewDecision: review.decision, task })
      };
    })
    .sort((a, b) => {
      const priorityRank = { ready: 0, review: 1, blocked: 2 };
      const challengeBoostA = challengedTaskIds.has(a.task.id) ? -1000 : 0;
      const challengeBoostB = challengedTaskIds.has(b.task.id) ? -1000 : 0;
      const recentPenaltyA = recentTaskIds.has(a.task.id) ? 120 : 0;
      const recentPenaltyB = recentTaskIds.has(b.task.id) ? 120 : 0;
      return (
        priorityRank[a.priority] - priorityRank[b.priority] ||
        challengeBoostA - challengeBoostB ||
        recentPenaltyA - recentPenaltyB ||
        b.task.score - a.task.score ||
        a.task.title.localeCompare(b.task.title)
      );
    })
    .slice(0, limit);
  const missingAcrossRecommended = [...new Set(recommendedTasks.flatMap((entry) => entry.readiness.missingCapabilities))].sort((a, b) => a.localeCompare(b));

  return {
    agent: input.agent,
    status: statusForLab(input.agent, recommendedTasks),
    command: input.agent.command,
    capabilities: {
      provided: input.agent.capabilities,
      missingAcrossRecommended
    },
    totals: {
      runs: agentRuns.length,
      scoredRuns: agentRuns.filter((run) => run.status === "scored").length,
      queuedRuns: queuedRuns.length,
      activeRuns: activeRuns.length,
      failedRuns: agentRuns.filter((run) => run.status === "failed").length,
      matches: matches.length,
      scoredMatches: matches.filter((match) => match.status === "scored").length,
      openChallenges: challenges.filter((challenge) => challenge.status === "open" || challenge.status === "accepted").length,
      broadcasts: broadcasts.length,
      verifiedProofs: proofs.filter((proof) => proof.status === "verified").length,
      scoreboardRows: scoreboardRows.length,
      totalScore: scoreboardRows.reduce((total, row) => total + row.score, 0)
    },
    queue: {
      nextRun: queuedRuns[0],
      activeRuns: activeRuns.slice(0, limit),
      queuedRuns: queuedRuns.slice(0, limit),
      expiredRuns: expiredRuns.slice(0, limit)
    },
    recommendedTasks,
    recentRuns: agentRuns.slice(0, limit),
    recentMatches: matches.slice(0, limit),
    challenges: challenges.slice(0, limit),
    broadcasts: broadcasts.slice(0, limit),
    proofs: proofs.slice(0, limit),
    scoreboardRows: scoreboardRows.slice(0, limit)
  };
}

export function buildAgentRuntimeLabs(input: {
  agents: AgentProfile[];
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
  now?: Date;
  limit?: number;
}): AgentRuntimeLab[] {
  return input.agents.map((agent) =>
    buildAgentRuntimeLab({
      agent,
      snapshot: input.snapshot,
      tasks: input.tasks,
      now: input.now,
      limit: input.limit
    })
  );
}
