import { describe, expect, it } from "vitest";
import type { BenchmarkTask, ScoreboardRow } from "../benchmark/types";
import { buildCompetitorProfile } from "./competitor-profile";
import type { BenchmarkAgentCampaign, BenchmarkRun, StoreSnapshot, UserAccount } from "./store";

const tasks: BenchmarkTask[] = [
  {
    id: "620:ACH.WAKE_UP",
    appid: 620,
    gameName: "Portal 2",
    title: "Wake Up Call",
    track: "achievement",
    level: 2,
    score: 3200,
    objective: "Unlock the benchmark achievement.",
    proof: ["Canonical output/output.mp4 video artifact.", "Steam achievement proof."],
    estimatedRuntimeMinutes: 8,
    suitability: "baseline",
    suitabilityScore: 80,
    reviewRequired: false,
    fairnessVerdict: "good",
    riskFlags: [],
    source: "fixture",
    signalSource: "steam-achievement"
  }
];

function snapshot(): StoreSnapshot {
  return {
    users: [],
    agents: [],
    matches: [],
    challenges: [],
    suiteRaces: [],
    agentCampaigns: [],
    gameCoverageRuns: [],
    eventRegistrations: [],
    steamLinks: [],
    runs: [],
    dispatches: [],
    controlSessions: [],
    events: [],
    artifacts: [],
    streams: [],
    proofs: [],
    taskRegistry: [],
    steamAppDiscoveries: [],
    scoreboard: []
  };
}

function human(): UserAccount {
  return {
    id: "human_a",
    handle: "astra",
    displayName: "Astra",
    type: "human",
    linkedSteamId: "76561198000000000",
    proofConsentAt: "2026-06-14T00:00:00.000Z",
    createdAt: "2026-06-14T00:00:00.000Z"
  };
}

function run(id: string, competitor: string, competitorType: "human" | "agent", score: number): BenchmarkRun {
  return {
    id,
    taskId: tasks[0].id,
    competitor,
    competitorType,
    status: "scored",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:01:00.000Z",
    runtimeProvider: competitorType === "human" ? "manual" : "local-sim",
    artifactName: "output.mp4",
    artifactPath: "output/output.mp4",
    eventCount: 1,
    score
  };
}

function row(input: { run: BenchmarkRun; rank: number }): ScoreboardRow {
  return {
    rank: input.rank,
    runId: input.run.id,
    taskId: tasks[0].id,
    appid: 620,
    competitor: input.run.competitor,
    type: input.run.competitorType,
    game: "Portal 2",
    task: "Wake Up Call",
    track: "achievement",
    level: 2,
    score: input.run.score ?? 0,
    evidence: "Steam proof + output.mp4",
    completedAt: "2026-06-14"
  };
}

function campaign(): BenchmarkAgentCampaign {
  return {
    id: "campaign_a",
    agentId: "agent_a",
    provider: "local",
    status: "scoreboard-ready",
    requestedTaskCount: 1,
    taskIds: [tasks[0].id],
    runIds: ["agent_run"],
    dispatchIds: [],
    reviewApproved: true,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:05:00.000Z"
  };
}

function comparisonSnapshot() {
  const store = snapshot();
  store.users.push(human());
  store.agents.push({
    id: "agent_a",
    userId: "agent_user_a",
    handle: "codex-runner",
    displayName: "Codex Runner",
    provider: "local",
    runtimeProvider: "local-sim",
    command: "npm run worker:local",
    capabilities: ["keyboard-mouse", "controller", "screen-capture", "output.mp4"],
    status: "active",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z"
  });
  store.agentCampaigns.push(campaign());
  const humanRun = run("human_run", "human:astra", "human", 3500);
  const agentRun = run("agent_run", "agent:codex-runner", "agent", 3200);
  store.runs.push(humanRun, agentRun);
  store.scoreboard.push(row({ run: humanRun, rank: 1 }), row({ run: agentRun, rank: 2 }));
  return store;
}

describe("competitor profile campaign comparisons", () => {
  it("adds compact human-vs-agent campaign comparison summaries to human and agent profiles", () => {
    const store = comparisonSnapshot();
    const humanProfile = buildCompetitorProfile({
      type: "human",
      participantId: "human_a",
      snapshot: store,
      tasks
    });
    const agentProfile = buildCompetitorProfile({
      type: "agent",
      participantId: "agent_a",
      snapshot: store,
      tasks
    });

    expect(humanProfile?.campaignComparisons).toMatchObject({
      total: 1,
      complete: 1,
      wins: 1,
      losses: 0,
      readyForPublicShare: 1,
      totalHumanScore: 3500,
      totalAgentScore: 3200,
      recent: [
        {
          comparisonId: "human_a:campaign_a",
          status: "complete",
          winner: "human",
          humanUserId: "human_a",
          agentId: "agent_a",
          campaignId: "campaign_a",
          readyForPublicShare: true,
          links: {
            resultCertificate: "/api/comparisons/human-agent/result-certificate?humanUserId=human_a&campaignId=campaign_a"
          }
        }
      ]
    });
    expect(agentProfile?.campaignComparisons).toMatchObject({
      total: 1,
      complete: 1,
      wins: 0,
      losses: 1,
      readyForPublicShare: 1,
      recent: [
        {
          winner: "human",
          humanHandle: "astra",
          agentHandle: "codex-runner"
        }
      ]
    });
  });
});
