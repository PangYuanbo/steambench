import { describe, expect, it } from "vitest";
import type { BenchmarkTask, ScoreboardRow } from "../benchmark/types";
import type { BenchmarkAgentCampaign, BenchmarkRun, StoreSnapshot, UserAccount } from "./store";
import { buildHumanAgentComparisonOpsReport, buildHumanAgentComparisonStandings } from "./human-agent-comparison-standings";

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
  },
  {
    id: "620:ACH.BRIDGE",
    appid: 620,
    gameName: "Portal 2",
    title: "Bridge Over Troubling Water",
    track: "achievement",
    level: 3,
    score: 4100,
    objective: "Unlock the benchmark achievement.",
    proof: ["Canonical output/output.mp4 video artifact.", "Steam achievement proof."],
    estimatedRuntimeMinutes: 10,
    suitability: "ranked",
    suitabilityScore: 84,
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

function human(id: string, handle: string): UserAccount {
  return {
    id,
    handle,
    displayName: handle,
    type: "human",
    linkedSteamId: "76561198000000000",
    proofConsentAt: "2026-06-14T00:00:00.000Z",
    createdAt: "2026-06-14T00:00:00.000Z"
  };
}

function run(id: string, taskId: string, competitor: string, competitorType: "human" | "agent", score: number): BenchmarkRun {
  return {
    id,
    taskId,
    competitor,
    competitorType,
    status: "scored",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:01:00.000Z",
    runtimeProvider: competitorType === "human" ? "manual" : "local-sim",
    artifactName: "output.mp4",
    artifactPath: "output/output.mp4",
    eventCount: 2,
    score
  };
}

function row(input: { rank: number; run: BenchmarkRun; task: BenchmarkTask; score?: number }): ScoreboardRow {
  return {
    rank: input.rank,
    runId: input.run.id,
    taskId: input.task.id,
    appid: input.task.appid,
    competitor: input.run.competitor,
    type: input.run.competitorType,
    game: input.task.gameName,
    task: input.task.title,
    track: input.task.track,
    level: input.task.level,
    score: input.score ?? input.run.score ?? input.task.score,
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
    requestedTaskCount: 2,
    taskIds: tasks.map((task) => task.id),
    runIds: ["agent_run_1", "agent_run_2"],
    dispatchIds: [],
    reviewApproved: true,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:05:00.000Z"
  };
}

function completeComparisonSnapshot(): StoreSnapshot {
  const store = snapshot();
  store.users.push(human("human_a", "astra"), human("human_b", "blake"));
  store.agents.push({
    id: "agent_a",
    userId: "agent_user_a",
    handle: "codex-runner",
    displayName: "Codex Runner",
    provider: "local",
    runtimeProvider: "local-sim",
    command: "npm run worker:local",
    capabilities: ["gamepad"],
    status: "active",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z"
  });
  store.agentCampaigns.push(campaign());
  const runs = [
    run("agent_run_1", tasks[0].id, "agent:codex-runner", "agent", 3200),
    run("agent_run_2", tasks[1].id, "agent:codex-runner", "agent", 4100),
    run("human_run_1", tasks[0].id, "human:astra", "human", 3300),
    run("human_run_2", tasks[1].id, "human:astra", "human", 3900),
    run("human_run_3", tasks[0].id, "human:blake", "human", 3000)
  ];
  store.runs.push(...runs);
  store.scoreboard.push(
    row({ rank: 1, run: runs[0], task: tasks[0] }),
    row({ rank: 1, run: runs[1], task: tasks[1] }),
    row({ rank: 1, run: runs[2], task: tasks[0] }),
    row({ rank: 2, run: runs[3], task: tasks[1] }),
    row({ rank: 3, run: runs[4], task: tasks[0] })
  );
  return store;
}

describe("human-agent comparison standings", () => {
  it("ranks completed comparisons and aggregates humans, agents, and matchups", () => {
    const standings = buildHumanAgentComparisonStandings({
      snapshot: completeComparisonSnapshot(),
      tasks,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(standings).toMatchObject({
      schemaVersion: "steambench.human-agent-comparison-standings.v1",
      totals: {
        comparisons: 2,
        completeComparisons: 1,
        incompleteComparisons: 1,
        humans: 2,
        agents: 1,
        campaigns: 1,
        humanWins: 0,
        agentWins: 1,
        readyForPublicShare: 1
      }
    });
    expect(standings.leaderboard[0]).toMatchObject({
      comparisonId: "human_a:campaign_a",
      status: "complete",
      winner: "agent",
      humanScore: 7200,
      agentScore: 7300,
      humanWins: 1,
      agentWins: 1,
      readyForPublicShare: true,
      links: {
        resultCertificate: "/api/comparisons/human-agent/result-certificate?humanUserId=human_a&campaignId=campaign_a"
      }
    });
    expect(standings.humans[0]).toMatchObject({
      participantId: "human_a",
      completeComparisons: 1,
      losses: 1,
      totalScore: 7200,
      taskWins: 1,
      taskLosses: 1
    });
    expect(standings.agents[0]).toMatchObject({
      participantId: "agent_a",
      wins: 1,
      totalScore: 14600,
      missingTasks: 0
    });
    expect(standings.matchups[0]).toMatchObject({
      humanUserId: "human_a",
      agentId: "agent_a",
      completeComparisons: 1,
      leader: "agent"
    });
  });

  it("produces ops actions for human gaps and share-ready comparisons", () => {
    const report = buildHumanAgentComparisonOpsReport({
      snapshot: completeComparisonSnapshot(),
      tasks,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report).toMatchObject({
      schemaVersion: "steambench.human-agent-comparison-ops-report.v1",
      status: "needs-human-runs",
      standings: {
        totals: {
          humanMissing: 1,
          readyForPublicShare: 1
        }
      }
    });
    expect(report.recommendedActions.map((action) => action.id)).toEqual([
      "run-human-campaign-local",
      "share-comparison-certificate",
      "inspect-comparison-standings"
    ]);
    expect(report.recommendedActions[0]).toMatchObject({
      method: "POST",
      endpoint: "/api/users/human_b/human-campaigns/run-local",
      body: {
        campaignId: "campaign_a",
        limit: 2
      }
    });
  });

  it("filters comparisons by human, campaign, agent, and status", () => {
    const standings = buildHumanAgentComparisonStandings({
      snapshot: completeComparisonSnapshot(),
      tasks,
      humanUserId: "human_a",
      agentId: "agent_a",
      campaignId: "campaign_a",
      status: "complete",
      limit: 1
    });

    expect(standings.totals.comparisons).toBe(1);
    expect(standings.leaderboard).toHaveLength(1);
    expect(standings.leaderboard[0]).toMatchObject({
      humanUserId: "human_a",
      campaignId: "campaign_a",
      status: "complete"
    });
  });
});
