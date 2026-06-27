import { describe, expect, it } from "vitest";
import { buildFixtureTasks } from "../benchmark/task-generator";
import type { ScoreboardRow } from "../benchmark/types";
import { buildChallengeOpsReport } from "./challenge-ops";
import type { AgentProfile, BenchmarkChallenge, BenchmarkMatch, StoreSnapshot, UserAccount } from "./store";

const task = buildFixtureTasks()[0];
const now = "2026-06-14T00:00:00.000Z";

const human: UserAccount = {
  id: "user_human",
  handle: "human",
  displayName: "Human",
  type: "human",
  createdAt: now,
  linkedSteamId: "76561198000000000",
  proofConsentAt: now
};

const agent: AgentProfile = {
  id: "agent_one",
  userId: "user_agent",
  handle: "agent",
  displayName: "Agent",
  provider: "local",
  runtimeProvider: "local-sim",
  command: "node scripts/runtime-worker.mjs",
  capabilities: ["achievement"],
  status: "active",
  createdAt: now,
  updatedAt: now
};

function challenge(id: string, status: BenchmarkChallenge["status"], matchId?: string): BenchmarkChallenge {
  return {
    id,
    taskId: task.id,
    humanUserId: human.id,
    agentId: agent.id,
    createdBy: "human",
    createdById: human.id,
    status,
    createdAt: now,
    updatedAt: `2026-06-14T00:00:0${id.length % 9}.000Z`,
    matchId
  };
}

function match(id: string, status: BenchmarkMatch["status"], humanRunId?: string, agentRunId?: string): BenchmarkMatch {
  return {
    id,
    taskId: task.id,
    humanUserId: human.id,
    agentId: agent.id,
    status,
    humanRunId,
    agentRunId,
    createdAt: now,
    updatedAt: now,
    winner: status === "scored" ? "tie" : undefined,
    margin: status === "scored" ? 0 : undefined
  };
}

function row(runId: string, competitor: string, type: ScoreboardRow["type"]): ScoreboardRow {
  return {
    rank: 1,
    runId,
    taskId: task.id,
    appid: task.appid,
    competitor,
    type,
    game: task.gameName,
    task: task.title,
    track: task.track,
    level: task.level,
    score: task.score,
    evidence: "output/output.mp4",
    completedAt: now
  };
}

function snapshot(overrides: Partial<StoreSnapshot>): StoreSnapshot {
  return {
    users: [human],
    agents: [agent],
    runs: [],
    artifacts: [],
    proofs: [],
    streams: [],
    matches: [],
    challenges: [],
    suiteRaces: [],
    eventRegistrations: [],
    agentCampaigns: [],
    gameCoverageRuns: [],
    dispatches: [],
    controlSessions: [],
    events: [],
    scoreboard: [],
    steamLinks: [],
    taskRegistry: [],
    steamAppDiscoveries: [],
    ...overrides
  };
}

describe("challenge ops report", () => {
  it("summarizes challenge queue readiness", () => {
    const readyMatch = match("match_ready", "scored", "run_human_ready", "run_agent_ready");
    const evidenceMissingMatch = match("match_missing", "scored", "run_human_missing", "run_agent_missing");
    const acceptedMatch = match("match_accepted", "scheduled");
    const report = buildChallengeOpsReport({
      snapshot: snapshot({
        matches: [readyMatch, evidenceMissingMatch, acceptedMatch],
        challenges: [
          challenge("challenge_open", "open"),
          challenge("challenge_accepted", "accepted", acceptedMatch.id),
          challenge("challenge_missing", "scored", evidenceMissingMatch.id),
          challenge("challenge_ready", "scored", readyMatch.id)
        ],
        scoreboard: [
          row("run_human_ready", human.displayName, "human"),
          row("run_agent_ready", agent.displayName, "agent")
        ]
      }),
      tasks: [task],
      limit: 10,
      generatedAt: now
    });

    expect(report).toMatchObject({
      schemaVersion: "steambench.challenge-ops-report.v1",
      status: "needs-attention",
      totals: {
        challenges: 4,
        selectedTickets: 4,
        open: 1,
        accepted: 1,
        scoreboardReady: 1,
        evidenceMissing: 1,
        scoreboardRows: 2
      }
    });
    expect(report.tickets.map((ticket) => ticket.status)).toEqual([
      "evidence-missing",
      "open",
      "accepted",
      "scoreboard-ready"
    ]);
    expect(report.recommendedActions.map((action) => action.id)).toEqual([
      "accept-open-challenge",
      "run-challenge-local",
      "inspect-challenge-evidence",
      "share-challenge-certificate",
      "inspect-challenges"
    ]);
  });

  it("filters by ticket status", () => {
    const readyMatch = match("match_ready", "scored", "run_human_ready", "run_agent_ready");
    const report = buildChallengeOpsReport({
      snapshot: snapshot({
        matches: [readyMatch],
        challenges: [
          challenge("challenge_open", "open"),
          challenge("challenge_ready", "scored", readyMatch.id)
        ],
        scoreboard: [
          row("run_human_ready", human.displayName, "human"),
          row("run_agent_ready", agent.displayName, "agent")
        ]
      }),
      tasks: [task],
      status: "scoreboard-ready",
      generatedAt: now
    });

    expect(report.status).toBe("ready-to-share");
    expect(report.totals.selectedTickets).toBe(1);
    expect(report.tickets[0].status).toBe("scoreboard-ready");
    expect(report.recommendedActions.map((action) => action.id)).toEqual([
      "share-challenge-certificate",
      "inspect-challenges"
    ]);
  });
});
