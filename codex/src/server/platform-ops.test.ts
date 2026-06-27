import { describe, expect, it } from "vitest";
import type { BenchmarkTask, ScoreboardRow } from "../benchmark/types";
import { buildRuntimeRunPlan } from "../runtime/events";
import type { AgentProfile, BenchmarkAgentCampaign, BenchmarkChallenge, BenchmarkMatch, BenchmarkRun, RunArtifact, RunProof, RuntimeControlSession, StoreSnapshot, UserAccount } from "./store";
import type { SteamSourceQueue } from "./steam-source-queue";
import { buildPlatformOpsReport } from "./platform-ops";

const task: BenchmarkTask = {
  id: "1145360:ESCAPE_CLEAR",
  appid: 1145360,
  gameName: "Hades",
  title: "Escape Clear",
  track: "achievement",
  level: 1,
  score: 3200,
  objective: "Clear a seeded Hades run.",
  proof: ["Canonical output/output.mp4 video artifact.", "Steam achievement proof."],
  estimatedRuntimeMinutes: 20,
  suitability: "ranked",
  suitabilityScore: 80,
  reviewRequired: false,
  fairnessVerdict: "good",
  riskFlags: [],
  source: "fixture",
  signalSource: "steam-achievement"
};

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

function agent(id = "agent_1", handle = "runtime-agent"): AgentProfile {
  return {
    id,
    userId: `user_${id}`,
    handle,
    displayName: handle,
    provider: "local",
    runtimeProvider: "local-sim",
    command: "node scripts/runtime-worker.mjs",
    capabilities: ["screen-capture", "output.mp4", "controller", "seeded-save"],
    status: "active",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z"
  };
}

function run(id: string, status: BenchmarkRun["status"]): BenchmarkRun {
  return {
    id,
    taskId: task.id,
    competitor: "agent:runtime-agent",
    competitorType: "agent",
    status,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:01:00.000Z",
    runtimeProvider: "local-sim",
    artifactName: "output.mp4",
    artifactPath: status === "scored" ? "output/output.mp4" : undefined,
    eventCount: 1,
    score: status === "scored" ? task.score : undefined
  };
}

function artifact(runId: string): RunArtifact {
  return {
    id: `artifact_${runId}`,
    runId,
    kind: "video",
    name: "output.mp4",
    uri: `local://${runId}/output.mp4`,
    createdAt: "2026-06-14T00:00:00.000Z",
    canonical: true
  };
}

function proof(runId: string, type: RunProof["type"]): RunProof {
  return {
    id: `proof_${runId}_${type}`,
    runId,
    type,
    status: "verified",
    createdAt: "2026-06-14T00:00:00.000Z",
    verifiedAt: "2026-06-14T00:00:01.000Z",
    summary: `${type} verified`
  };
}

function row(run: BenchmarkRun): ScoreboardRow {
  return {
    rank: 1,
    runId: run.id,
    taskId: task.id,
    appid: task.appid,
    competitor: run.competitor,
    type: run.competitorType,
    game: task.gameName,
    task: task.title,
    track: task.track,
    level: task.level,
    score: run.score ?? task.score,
    evidence: "Steam proof + output.mp4",
    completedAt: "2026-06-14"
  };
}

function human(id = "human_1", handle = "human-one"): UserAccount {
  return {
    id,
    handle,
    displayName: handle,
    type: "human",
    createdAt: "2026-06-14T00:00:00.000Z",
    linkedSteamId: "76561198000000000",
    proofConsentAt: "2026-06-14T00:00:00.000Z"
  };
}

function match(id: string, overrides: Partial<BenchmarkMatch> = {}): BenchmarkMatch {
  return {
    id,
    taskId: task.id,
    humanUserId: "human_1",
    agentId: "agent_1",
    status: "scheduled",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    ...overrides
  };
}

function challenge(id: string, overrides: Partial<BenchmarkChallenge> = {}): BenchmarkChallenge {
  return {
    id,
    taskId: task.id,
    humanUserId: "human_1",
    agentId: "agent_1",
    createdBy: "human",
    createdById: "human_1",
    status: "open",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    ...overrides
  };
}

function controlSession(id: string, runId: string, overrides: Partial<RuntimeControlSession> = {}): RuntimeControlSession {
  return {
    id,
    runId,
    taskId: task.id,
    agentId: "agent_1",
    status: "active",
    actionSpace: buildRuntimeRunPlan(task).actionSpace,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    expiresAt: "2026-06-14T00:15:00.000Z",
    ...overrides
  };
}

function campaign(overrides: Partial<BenchmarkAgentCampaign> = {}): BenchmarkAgentCampaign {
  return {
    id: "campaign_1",
    agentId: "agent_1",
    provider: "local",
    status: "scoreboard-ready",
    requestedTaskCount: 1,
    taskIds: [task.id],
    runIds: ["agent_run_comparison"],
    dispatchIds: [],
    reviewApproved: true,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:05:00.000Z",
    ...overrides
  };
}

function sourceQueue(): SteamSourceQueue {
  return {
    schemaVersion: "steambench.steam-source-queue.v1",
    generatedAt: "2026-06-14T00:00:00.000Z",
    limit: 4,
    totals: {
      apps: 1,
      readyToPublish: 0,
      readyToImport: 1,
      catalogReady: 0,
      needsSourceData: 0,
      sourceRecords: 7,
      newImportsAvailable: 3,
      publishableCandidates: 0,
      achievementRecords: 3,
      statRecords: 2,
      leaderboardRecords: 2,
      achievementImportsAvailable: 3,
      statImportsAvailable: 0,
      leaderboardImportsAvailable: 0
    },
    items: [{
      appid: 620,
      gameName: "Portal 2",
      status: "ready-to-import",
      priorityScore: 3000,
      sourceRecords: 7,
      newImportsAvailable: 3,
      publishableCandidates: 0,
      sourceBreakdown: {
        achievement: {
          records: 3,
          recommendedImports: 3,
          active: 0,
          candidates: 0,
          rejected: 0
        },
        stat: {
          records: 2,
          proposed: 2,
          newProposals: 0,
          reviewRequired: 0
        },
        leaderboard: {
          records: 2,
          proposed: 2,
          newProposals: 0,
          reviewRequired: 0
        }
      },
      registryTracks: {
        active: [],
        candidates: [],
        missingCandidates: ["achievement"]
      },
      activeTasks: 0,
      candidateTasks: 0,
      actionIds: ["import-achievement-recommendations", "inspect-benchmark-blueprint"],
      reasons: ["ready"],
      links: {
        taskSourceOps: "/api/steam/apps/620/task-source-ops",
        onboarding: "/api/steam/apps/620/onboarding",
        benchmarkBlueprint: "/api/games/620/benchmark-blueprint",
        coveragePlan: "/api/games/620/coverage-plan"
      }
    }],
    recommendedActions: [{
      id: "steam-source:620:import-achievement-recommendations",
      appid: 620,
      gameName: "Portal 2",
      priority: "high",
      method: "POST",
      endpoint: "/api/steam/apps/620/achievement-ladder/import-recommended",
      reason: "3 achievement recommendation(s) are not in the task registry yet."
    }],
    links: {
      steamDiscovery: "/api/steam/apps/discovery",
      platformOps: "/api/platform/ops-report"
    }
  };
}

describe("platform ops report", () => {
  it("rolls up Steam sources, humans, agents, dispatches, broadcasts, events, and scoreboard health", () => {
    const store = snapshot();
    const scoredRun = run("run_scored", "scored");
    const liveRun = run("run_live", "running");
    store.users.push({
      id: "human_1",
      handle: "human-one",
      displayName: "Human One",
      type: "human",
      createdAt: "2026-06-14T00:00:00.000Z"
    });
    store.agents.push(agent(), agent("agent_2", "ready-agent"));
    store.taskRegistry.push({
      ...task,
      id: "1145360:ESCAPE_FAST_CANDIDATE",
      title: "Escape Fast Candidate",
      status: "candidate",
      importedAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z"
    });
    store.steamAppDiscoveries.push({
      id: "discovery_1",
      appid: 1145360,
      name: "Hades",
      query: "hades",
      source: "fixture",
      status: "shortlisted",
      benchmarkFit: 92,
      harnessRisk: "medium",
      tracks: ["achievement"],
      estimatedAchievementTasks: 3,
      reasons: ["controller benchmark candidate"],
      riskNotes: [],
      discoveredAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z"
    });
    store.runs.push(scoredRun, liveRun);
    store.artifacts.push(artifact(scoredRun.id));
    store.proofs.push(proof(scoredRun.id, "canonical-artifact"), proof(scoredRun.id, "steam-achievement"));
    store.scoreboard.push(row(scoredRun));
    store.dispatches.push({
      id: "dispatch_1",
      runId: liveRun.id,
      taskId: task.id,
      agentId: "agent_1",
      provider: "local",
      status: "planned",
      workerId: "worker_local_1",
      command: "npm run worker:local",
      manifestUrl: `/api/runs/${liveRun.id}/execution-manifest`,
      runtimePackageUrl: `/api/runs/${liveRun.id}/runtime-package`,
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z"
    });
    store.streams.push({
      id: "stream_1",
      runId: liveRun.id,
      status: "live",
      provider: "hls",
      title: "Runtime Agent Live",
      ingestUrl: "rtmp://localhost/steambench/run_live",
      playbackUrl: "/streams/run_live.m3u8",
      thumbnailUrl: "/streams/run_live.jpg",
      viewerCount: 12,
      currentScene: "Gameplay",
      createdAt: "2026-06-14T00:00:00.000Z",
      startedAt: "2026-06-14T00:00:10.000Z"
    });
    store.eventRegistrations.push({
      id: "event_reg_agent",
      eventScope: "weekly",
      participantType: "agent",
      participantId: "agent_1",
      status: "registered",
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z"
    });

    const report = buildPlatformOpsReport({
      snapshot: store,
      tasks: [task],
      steamSourceQueue: sourceQueue(),
      scope: "weekly",
      limit: 20,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report).toMatchObject({
      schemaVersion: "steambench.platform-ops-report.v1",
      status: "needs-attention",
      filters: {
        scope: "weekly",
        limit: 20
      },
      totals: {
        activeTasks: 1,
        candidateTasks: 1,
        rankedReadyTasks: 2,
        reviewRequiredTasks: 0,
        publicRankBlockedTasks: 0,
        blueprintGames: 6,
        blueprintRankedReady: 0,
        blueprintImportReady: 5,
        blueprintReviewRequired: 1,
        blueprintNeedsSteamData: 0,
        blueprintOutputMp4Contracts: 6,
        blueprintStage2Contracts: 6,
        competitionGames: 1,
        competitionCoverageGaps: 1,
        competitionReadyActions: 0,
        competitionShareReadyGames: 1,
        discoveredApps: 1,
        shortlistedApps: 1,
        humans: 1,
        steamLinkedHumans: 0,
        humanProofReadyTickets: 0,
        humanProofReadyTasks: 0,
        humanProofConsentRequired: 0,
        humanProofSteamNotLinked: 1,
        humanAgentComparisons: 0,
        humanAgentCompleteComparisons: 0,
        humanAgentIncompleteComparisons: 0,
        humanAgentShareReadyComparisons: 0,
        humanAgentHumanMissingTasks: 0,
        humanAgentAgentMissingTasks: 0,
        agents: 2,
        activeAgents: 2,
        controllerTasks: 1,
        virtualControllerTasks: 1,
        bridgeableTasks: 1,
        runs: 2,
        activeRuns: 1,
        scoredRuns: 1,
        pendingDispatches: 1,
        agentTraceReady: 0,
        agentTraceNeedsRuntime: 2,
        controlBridgeReady: 0,
        controlBridgeNeedsExecutorReport: 0,
        challenges: 0,
        openChallenges: 0,
        acceptedChallenges: 0,
        shareReadyChallenges: 0,
        matches: 0,
        activeMatches: 0,
        scoredMatches: 0,
        broadcasts: 1,
        liveBroadcasts: 1,
        scoreboardRows: 1,
        eventRegisteredHumans: 0,
        eventRegisteredAgents: 1
      }
    });
    expect(report.subsystems.map((entry) => entry.id)).toEqual([
      "steam-sources",
      "task-review",
      "benchmark-blueprints",
      "game-competition",
      "human-onboarding",
      "human-proof",
      "human-agent-comparisons",
      "agent-runtime",
      "action-spaces",
      "runtime-dispatch",
      "agent-traces",
      "control-bridge",
      "challenges",
      "match-arena",
      "scoreboard",
      "broadcasts",
      "events"
    ]);
    expect(report.subsystems.find((entry) => entry.id === "steam-sources")).toMatchObject({
      status: "ready",
      metrics: {
        sourceQueueAchievementRecords: 3,
        sourceQueueStatRecords: 2,
        sourceQueueLeaderboardRecords: 2,
        sourceQueueAchievementImports: 3,
        sourceQueueStatImports: 0,
        sourceQueueLeaderboardImports: 0,
        sourceQueueTopAppid: 620,
        sourceQueueTopGame: "Portal 2",
        sourceQueueTopMissingTracks: ["achievement"]
      }
    });
    expect(report.subsystems.find((entry) => entry.id === "task-review")?.status).toBe("ready");
    expect(report.subsystems.find((entry) => entry.id === "benchmark-blueprints")).toMatchObject({
      status: "ready",
      metrics: {
        focusedAppid: 1145360,
        focusedStatus: "review-required",
        reviewRequired: 1,
        importReady: 5,
        focusedSourceRecords: expect.any(Number),
        focusedNewSourceImportsAvailable: expect.any(Number),
        focusedSourceMissingCandidateTracks: expect.any(Array),
        focusedAchievementSourceRecords: expect.any(Number),
        focusedStatSourceRecords: expect.any(Number),
        focusedLeaderboardSourceRecords: expect.any(Number),
        focusedSourceActions: expect.any(Number),
        focusedSourceActionIds: expect.any(Array),
        outputMp4Contracts: 6,
        stage2StartContracts: 6
      },
      links: {
        blueprint: "/api/games/1145360/benchmark-blueprint",
        blueprintOps: "npm run benchmark:blueprint-ops"
      }
    });
    expect(report.subsystems.find((entry) => entry.id === "game-competition")).toMatchObject({
      status: "ready",
      metrics: {
        focusedAppid: 1145360,
        focusedStatus: "needs-publication",
        humanGaps: 1,
        agentGaps: 0
      },
      links: {
        coveragePlan: "/api/games/1145360/coverage-plan",
        runCompetitionLocal: "/api/games/1145360/competition/run-local"
      }
    });
    expect(report.subsystems.find((entry) => entry.id === "human-onboarding")?.status).toBe("attention");
    expect(report.subsystems.find((entry) => entry.id === "human-proof")).toMatchObject({
      status: "attention",
      metrics: {
        readyTickets: 0,
        readyTasks: 0,
        steamNotLinked: 1
      },
      links: {
        opsReport: "/api/human-proof/ops-report?limit=20&userLimit=20"
      }
    });
    expect(report.subsystems.find((entry) => entry.id === "human-agent-comparisons")).toMatchObject({
      status: "idle",
      metrics: {
        comparisons: 0,
        completeComparisons: 0,
        incompleteComparisons: 0,
        readyForPublicShare: 0
      },
      links: {
        opsReport: "/api/comparisons/human-agent/ops-report?limit=20"
      }
    });
    expect(report.subsystems.find((entry) => entry.id === "action-spaces")?.status).toBe("ready");
    expect(report.subsystems.find((entry) => entry.id === "runtime-dispatch")?.status).toBe("ready");
    expect(report.subsystems.find((entry) => entry.id === "agent-traces")?.status).toBe("ready");
    expect(report.subsystems.find((entry) => entry.id === "control-bridge")?.status).toBe("idle");
    expect(report.subsystems.find((entry) => entry.id === "challenges")?.status).toBe("idle");
    expect(report.subsystems.find((entry) => entry.id === "match-arena")?.status).toBe("idle");
    expect(report.recommendedActions.map((action) => action.id)).toEqual(expect.arrayContaining([
      "steam-sources:publish-candidates",
      "benchmark-blueprints:import-achievement-recommendations",
      "benchmark-blueprints:publish-candidates",
      "benchmark-blueprints:inspect-focused-blueprint",
      "benchmark-blueprints:inspect-review-required-blueprints",
      "game-competition:publish-candidates",
      "human-onboarding:link-steam",
      "human-proof:link-steam",
      "agent-runtime:open-agent-run-session",
      "runtime-dispatch:drain-dispatches",
      "events:inspect-event-registrations"
    ]));
    expect(report.recommendedActions).toContainEqual(expect.objectContaining({
      id: "benchmark-blueprints:import-achievement-recommendations",
      method: "POST",
      endpoint: "/api/steam/apps/1145360/achievement-ladder/import-recommended",
      body: {
        useFixture: true,
        limit: 2
      }
    }));
    expect(report.recommendedActions[0].priority).toBe("high");
  });

  it("recommends registering an active agent into an event when the bracket lacks agents", () => {
    const store = snapshot();
    store.agents.push(agent("agent_1", "event-ready-agent"));

    const report = buildPlatformOpsReport({
      snapshot: store,
      tasks: [task],
      scope: "daily",
      limit: 20,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.totals).toMatchObject({
      eventRegisteredHumans: 0,
      eventRegisteredAgents: 0,
      activeAgents: 1
    });
    expect(report.recommendedActions).toContainEqual(expect.objectContaining({
      id: "events:register-agent",
      subsystem: "events",
      method: "POST",
      endpoint: "/api/competition-events/daily/register",
      body: {
        participantType: "agent",
        participantId: "agent_1"
      }
    }));
  });

  it("surfaces task review queue health in platform ops", () => {
    const store = snapshot();
    store.taskRegistry.push({
      ...task,
      id: "1145360:LONG_CONTROLLED_CANDIDATE",
      title: "Long Controlled Candidate",
      status: "candidate",
      reviewRequired: true,
      fairnessVerdict: "controlled",
      riskFlags: ["longHorizon"],
      estimatedRuntimeMinutes: 240,
      importedAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z"
    });

    const report = buildPlatformOpsReport({
      snapshot: store,
      tasks: [task],
      scope: "weekly",
      limit: 20,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.totals).toMatchObject({
      rankedReadyTasks: 1,
      reviewRequiredTasks: 1,
      publicRankBlockedTasks: 0
    });
    expect(report.subsystems.find((entry) => entry.id === "task-review")).toMatchObject({
      id: "task-review",
      label: "Task review",
      status: "ready",
      metrics: {
        tasks: 2,
        candidates: 1,
        rankedReady: 1,
        reviewRequired: 1,
        blocked: 0,
        controlled: 1,
        topRisk: "longHorizon"
      },
      links: {
        reviewCatalog: "/api/tasks/review-catalog?limit=20",
        reviewRequired: "/api/tasks/review-catalog?decision=review-required&limit=20",
        blocked: "/api/tasks/review-catalog?decision=reject&limit=20"
      }
    });
    expect(report.recommendedActions).toContainEqual(expect.objectContaining({
      id: "task-review:inspect-review-required",
      subsystem: "task-review",
      method: "GET",
      endpoint: "/api/tasks/review-catalog?decision=review-required&limit=20"
    }));
  });

  it("surfaces runtime action-space and bridgeability coverage in platform ops", () => {
    const store = snapshot();
    store.agents.push(agent("agent_1", "controller-agent"));

    const report = buildPlatformOpsReport({
      snapshot: store,
      tasks: [task],
      scope: "weekly",
      limit: 20,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.totals).toMatchObject({
      controllerTasks: 1,
      virtualControllerTasks: 1,
      bridgeableTasks: 1
    });
    expect(report.subsystems.find((entry) => entry.id === "action-spaces")).toMatchObject({
      id: "action-spaces",
      label: "Action spaces",
      status: "ready",
      metrics: {
        tasks: 1,
        controllerTasks: 1,
        virtualControllerTasks: 1,
        bridgeableTasks: 1,
        readyForSelectedAgent: 1,
        blockedForSelectedAgent: 0,
        selectedAgentId: "agent_1"
      },
      links: {
        catalog: "/api/runtime/action-spaces?agentId=agent_1&limit=20",
        virtualController: "/api/runtime/action-spaces?agentId=agent_1&inputMode=controller&transport=virtual-controller&limit=20",
        bridgeOps: "/api/control-sessions/ops-report?transport=virtual-controller"
      }
    });
    expect(report.recommendedActions).toContainEqual(expect.objectContaining({
      id: "action-spaces:create-control-run-session",
      subsystem: "action-spaces",
      method: "POST",
      endpoint: "/api/agents/agent_1/run-session",
      body: {
        taskId: task.id,
        createControlSession: true,
        ttlSeconds: 900
      }
    }));
    expect(report.recommendedActions).toContainEqual(expect.objectContaining({
      id: "action-spaces:inspect-control-bridge-docs",
      subsystem: "action-spaces",
      method: "GET",
      endpoint: "/api/control-sessions/ops-report?transport=virtual-controller"
    }));
  });

  it("surfaces human-vs-agent challenge queue work in platform ops", () => {
    const store = snapshot();
    store.users.push(human("human_1", "challenge-human"));
    store.agents.push(agent("agent_1", "challenge-agent"));
    store.challenges.push(challenge("challenge_1"));

    const report = buildPlatformOpsReport({
      snapshot: store,
      tasks: [task],
      scope: "weekly",
      limit: 20,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.totals).toMatchObject({
      challenges: 1,
      openChallenges: 1,
      acceptedChallenges: 0,
      shareReadyChallenges: 0
    });
    expect(report.subsystems.find((entry) => entry.id === "challenges")).toMatchObject({
      id: "challenges",
      label: "Challenges",
      status: "ready",
      metrics: {
        challenges: 1,
        selectedTickets: 1,
        open: 1,
        accepted: 0,
        scoreboardReady: 0
      },
      links: {
        opsReport: "/api/challenges/ops-report?limit=20",
        challenges: "/api/challenges",
        standings: "/api/standings"
      }
    });
    expect(report.recommendedActions).toContainEqual(expect.objectContaining({
      id: "challenges:accept-open-challenge",
      subsystem: "challenges",
      method: "POST",
      endpoint: "/api/challenges/challenge_1/accept"
    }));
  });

  it("surfaces human-agent campaign comparison readiness in platform ops", () => {
    const store = snapshot();
    const comparisonHuman = human("human_1", "comparison-human");
    const comparisonAgent = agent("agent_1", "comparison-agent");
    const agentRun = run("agent_run_comparison", "scored");
    const humanRun: BenchmarkRun = {
      ...run("human_run_comparison", "scored"),
      competitor: "human:comparison-human",
      competitorType: "human",
      runtimeProvider: "manual",
      score: task.score + 100
    };
    store.users.push(comparisonHuman);
    store.agents.push(comparisonAgent);
    store.agentCampaigns.push(campaign());
    store.runs.push(agentRun, humanRun);
    store.scoreboard.push(row(agentRun), row(humanRun));

    const report = buildPlatformOpsReport({
      snapshot: store,
      tasks: [task],
      scope: "weekly",
      limit: 20,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.totals).toMatchObject({
      humanAgentComparisons: 1,
      humanAgentCompleteComparisons: 1,
      humanAgentIncompleteComparisons: 0,
      humanAgentShareReadyComparisons: 1,
      humanAgentHumanMissingTasks: 0,
      humanAgentAgentMissingTasks: 0
    });
    expect(report.subsystems.find((entry) => entry.id === "human-agent-comparisons")).toMatchObject({
      id: "human-agent-comparisons",
      label: "Human-agent comparisons",
      status: "ready",
      metrics: {
        comparisons: 1,
        completeComparisons: 1,
        incompleteComparisons: 0,
        readyForPublicShare: 1
      },
      links: {
        opsReport: "/api/comparisons/human-agent/ops-report?limit=20",
        standings: "/api/comparisons/human-agent/standings"
      }
    });
    expect(report.recommendedActions).toContainEqual(expect.objectContaining({
      id: "human-agent-comparisons:share-comparison-certificate",
      subsystem: "human-agent-comparisons",
      method: "GET",
      endpoint: "/api/comparisons/human-agent/result-certificate?humanUserId=human_1&campaignId=campaign_1"
    }));
  });

  it("surfaces agent trace and control bridge runtime gaps in platform ops", () => {
    const store = snapshot();
    store.agents.push(agent("agent_1", "controller-agent"));
    const needsControlRun = run("run_needs_control", "running");
    const bridgeReadyRun = run("run_bridge_ready", "running");
    store.runs.push(needsControlRun, bridgeReadyRun);
    store.controlSessions.push(controlSession("session_bridge_ready", bridgeReadyRun.id));

    const report = buildPlatformOpsReport({
      snapshot: store,
      tasks: [task],
      scope: "weekly",
      limit: 20,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.totals).toMatchObject({
      agentTraceReady: 0,
      agentTraceNeedsRuntime: 2,
      controlBridgeReady: 1,
      controlBridgeNeedsExecutorReport: 0
    });
    expect(report.subsystems.find((entry) => entry.id === "agent-traces")).toMatchObject({
      id: "agent-traces",
      label: "Agent traces",
      status: "ready",
      metrics: {
        agentRuns: 2,
        selectedRuns: 2,
        needsControlSession: 1,
        needsActions: 1,
        needsExecutorReport: 0,
        traceReady: 0
      },
      links: {
        opsReport: "/api/agent-traces/ops-report?limit=20",
        handoffs: "/api/agent-traces/ops-report",
        bridgeOps: "/api/control-sessions/ops-report"
      }
    });
    expect(report.subsystems.find((entry) => entry.id === "control-bridge")).toMatchObject({
      id: "control-bridge",
      label: "Control bridge",
      status: "ready",
      metrics: {
        selectedSessions: 1,
        active: 1,
        virtualController: 1,
        readyForBridge: 1,
        needsExecutorReport: 0
      },
      links: {
        opsReport: "/api/control-sessions/ops-report?limit=20",
        virtualController: "/api/control-sessions/ops-report?transport=virtual-controller&limit=20",
        bridgeRunner: "npm run bridge:control"
      }
    });
    expect(report.recommendedActions).toContainEqual(expect.objectContaining({
      id: "agent-traces:create-control-session",
      subsystem: "agent-traces",
      method: "POST",
      endpoint: "/api/runs/run_needs_control/control-sessions",
      body: { ttlSeconds: 900 }
    }));
    expect(report.recommendedActions).toContainEqual(expect.objectContaining({
      id: "control-bridge:inspect-bridge-manifest",
      subsystem: "control-bridge",
      method: "GET",
      endpoint: "/api/control-sessions/session_bridge_ready/bridge-manifest"
    }));
  });

  it("surfaces direct match arena execution in platform ops", () => {
    const store = snapshot();
    store.users.push(human("human_1", "arena-human"));
    store.agents.push(agent("agent_1", "arena-agent"));
    store.matches.push(match("match_1"));

    const report = buildPlatformOpsReport({
      snapshot: store,
      tasks: [task],
      scope: "weekly",
      limit: 20,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.totals).toMatchObject({
      matches: 1,
      activeMatches: 1,
      scoredMatches: 0
    });
    expect(report.subsystems.find((entry) => entry.id === "match-arena")).toMatchObject({
      id: "match-arena",
      label: "Match arena",
      status: "ready",
      metrics: {
        matches: 1,
        selectedTickets: 1,
        needsStart: 1,
        scoreboardReady: 0
      },
      links: {
        opsReport: "/api/matches/arena-ops-report?limit=20",
        matches: "/api/matches",
        matchFeed: "/api/matches/feed"
      }
    });
    expect(report.recommendedActions).toContainEqual(expect.objectContaining({
      id: "match-arena:run-match-local",
      subsystem: "match-arena",
      method: "POST",
      endpoint: "/api/matches/match_1/run-local"
    }));
  });

  it("surfaces cross-app Steam source queue work in platform ops", () => {
    const store = snapshot();

    const report = buildPlatformOpsReport({
      snapshot: store,
      tasks: [task],
      steamSourceQueue: sourceQueue(),
      scope: "weekly",
      limit: 20,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.subsystems.find((entry) => entry.id === "steam-sources")?.metrics).toMatchObject({
      queuedSourceApps: 1,
      sourceQueueNewImports: 3,
      sourceQueuePublishableCandidates: 0,
      sourceQueueActions: 1
    });
    expect(report.subsystems.find((entry) => entry.id === "steam-sources")?.links).toMatchObject({
      sourceQueue: "/api/steam/source-queue"
    });
    expect(report.recommendedActions).toContainEqual(expect.objectContaining({
      id: "steam-sources:run-source-queue-next",
      subsystem: "steam-sources",
      method: "CLI",
      command: "npm run steam:source-queue -- --fixture=true --execute=next --review-notes=\"platform source queue\""
    }));
  });

  it("recommends scheduling suite races when registered pairs are unscheduled", () => {
    const store = snapshot();
    store.users.push({
      id: "human_1",
      handle: "human-one",
      displayName: "Human One",
      type: "human",
      createdAt: "2026-06-14T00:00:00.000Z",
      linkedSteamId: "76561198000000000",
      proofConsentAt: "2026-06-14T00:00:00.000Z"
    });
    store.agents.push(agent("agent_1", "event-ready-agent"));
    store.eventRegistrations.push(
      {
        id: "event_reg_human",
        eventScope: "weekly",
        participantType: "human",
        participantId: "human_1",
        status: "registered",
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z"
      },
      {
        id: "event_reg_agent",
        eventScope: "weekly",
        participantType: "agent",
        participantId: "agent_1",
        status: "registered",
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z"
      }
    );

    const report = buildPlatformOpsReport({
      snapshot: store,
      tasks: [task],
      suites: [{
        id: "1145360:ranked",
        appid: 1145360,
        gameName: "Hades",
        tier: "ranked",
        title: "Hades Ranked Ladder",
        status: "ranked-ready",
        taskIds: [task.id],
        taskCount: 1,
        tracks: ["achievement"],
        levelRange: { min: 1, max: 6 },
        estimatedRuntimeMinutes: 20,
        benchmarkFit: 90,
        readinessScore: 92,
        rankedReadyTasks: 1,
        controlledTasks: 0,
        reviewRequiredTasks: 0,
        requiredControls: [],
        riskFlags: []
      }],
      scope: "weekly",
      limit: 20,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.subsystems.find((entry) => entry.id === "events")?.metrics).toMatchObject({
      registeredPairs: 1,
      scheduledRaces: 0,
      unscheduledPairs: 1
    });
    expect(report.recommendedActions).toContainEqual(expect.objectContaining({
      id: "events:schedule-suite",
      subsystem: "events",
      method: "POST",
      endpoint: "/api/competition-events/weekly/schedule-suite",
      body: {
        suiteId: "1145360:ranked",
        reviewApproved: false,
        maxPairs: 1
      }
    }));
  });

  it("recommends running scheduled suite races when event races are unscored", () => {
    const store = snapshot();
    store.users.push({
      id: "human_1",
      handle: "human-one",
      displayName: "Human One",
      type: "human",
      createdAt: "2026-06-14T00:00:00.000Z",
      linkedSteamId: "76561198000000000",
      proofConsentAt: "2026-06-14T00:00:00.000Z"
    });
    store.agents.push(agent("agent_1", "event-ready-agent"));
    store.eventRegistrations.push(
      {
        id: "event_reg_human",
        eventScope: "weekly",
        participantType: "human",
        participantId: "human_1",
        status: "registered",
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z"
      },
      {
        id: "event_reg_agent",
        eventScope: "weekly",
        participantType: "agent",
        participantId: "agent_1",
        status: "registered",
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z"
      }
    );
    store.suiteRaces.push({
      id: "race_1",
      suiteId: "1145360:ranked",
      eventScope: "weekly",
      appid: 1145360,
      title: "Hades Ranked Ladder",
      taskIds: [task.id],
      matchIds: [],
      humanUserId: "human_1",
      agentId: "agent_1",
      status: "scheduled",
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z"
    });

    const report = buildPlatformOpsReport({
      snapshot: store,
      tasks: [task],
      scope: "weekly",
      limit: 20,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.subsystems.find((entry) => entry.id === "events")?.metrics).toMatchObject({
      registeredPairs: 1,
      scheduledRaces: 1,
      scoredEventRaces: 0,
      unscoredRaces: 1,
      unscheduledPairs: 0
    });
    expect(report.recommendedActions).toContainEqual(expect.objectContaining({
      id: "events:run-suite-local",
      subsystem: "events",
      method: "POST",
      endpoint: "/api/competition-events/weekly/run-suite",
      body: {
        suiteId: "1145360:ranked",
        maxRaces: 1
      }
    }));
  });

  it("recommends running event campaign comparisons when evidence is incomplete", () => {
    const store = snapshot();
    store.users.push({
      id: "human_1",
      handle: "human-one",
      displayName: "Human One",
      type: "human",
      createdAt: "2026-06-14T00:00:00.000Z",
      linkedSteamId: "76561198000000000",
      proofConsentAt: "2026-06-14T00:00:00.000Z"
    });
    store.agents.push(agent("agent_1", "event-ready-agent"));
    store.eventRegistrations.push(
      {
        id: "event_reg_human",
        eventScope: "weekly",
        participantType: "human",
        participantId: "human_1",
        status: "registered",
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z"
      },
      {
        id: "event_reg_agent",
        eventScope: "weekly",
        participantType: "agent",
        participantId: "agent_1",
        status: "registered",
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z"
      }
    );

    const report = buildPlatformOpsReport({
      snapshot: store,
      tasks: [task],
      eventEvidence: {
        scope: "weekly",
        status: "active",
        registeredPairs: 1,
        scheduledRaces: 1,
        scoredRaces: 1,
        bundleCount: 1,
        readyBundleCount: 1,
        campaignComparisonCount: 1,
        campaignComparisonReadyCount: 0,
        allCampaignComparisonsBundled: true,
        allCampaignComparisonsReady: false,
        allScheduledRacesBundled: true,
        allScheduledRacesScored: true,
        allBundlesScoreboardReady: true,
        checklistPasses: 5,
        checklistTotal: 6,
        generatedAt: "2026-06-14T00:00:00.000Z"
      },
      scope: "weekly",
      limit: 20,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.subsystems.find((entry) => entry.id === "events")?.metrics).toMatchObject({
      campaignComparisons: 1,
      readyCampaignComparisons: 0,
      unreadyCampaignComparisons: 1,
      eventReadyForPublicShare: false
    });
    expect(report.recommendedActions).toContainEqual(expect.objectContaining({
      id: "events:run-campaign-comparisons-local",
      subsystem: "events",
      method: "POST",
      endpoint: "/api/competition-events/weekly/run-campaign-comparisons-local",
      body: {
        maxPairs: 1
      }
    }));
  });

  it("recommends inspecting the event certificate when event evidence is share-ready", () => {
    const store = snapshot();
    store.users.push({
      id: "human_1",
      handle: "human-one",
      displayName: "Human One",
      type: "human",
      createdAt: "2026-06-14T00:00:00.000Z",
      linkedSteamId: "76561198000000000",
      proofConsentAt: "2026-06-14T00:00:00.000Z"
    });
    store.agents.push(agent("agent_1", "event-ready-agent"));
    store.eventRegistrations.push(
      {
        id: "event_reg_human",
        eventScope: "daily",
        participantType: "human",
        participantId: "human_1",
        status: "registered",
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z"
      },
      {
        id: "event_reg_agent",
        eventScope: "daily",
        participantType: "agent",
        participantId: "agent_1",
        status: "registered",
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z"
      }
    );
    store.suiteRaces.push({
      id: "race_scored",
      suiteId: "1145360:ranked",
      eventScope: "daily",
      appid: 1145360,
      title: "Hades Ranked Ladder",
      taskIds: [task.id],
      matchIds: ["match_1"],
      humanUserId: "human_1",
      agentId: "agent_1",
      status: "scored",
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:10:00.000Z",
      winner: "agent",
      humanScore: 100,
      agentScore: 3200
    });

    const report = buildPlatformOpsReport({
      snapshot: store,
      tasks: [task],
      eventEvidence: {
        scope: "daily",
        status: "active",
        registeredPairs: 1,
        scheduledRaces: 1,
        scoredRaces: 1,
        bundleCount: 1,
        readyBundleCount: 1,
        campaignComparisonCount: 0,
        campaignComparisonReadyCount: 0,
        allCampaignComparisonsBundled: false,
        allCampaignComparisonsReady: false,
        allScheduledRacesBundled: true,
        allScheduledRacesScored: true,
        allBundlesScoreboardReady: true,
        checklistPasses: 5,
        checklistTotal: 5,
        generatedAt: "2026-06-14T00:00:00.000Z"
      },
      scope: "daily",
      limit: 20,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.subsystems.find((entry) => entry.id === "events")?.metrics).toMatchObject({
      scheduledRaces: 1,
      scoredEventRaces: 1,
      unscoredRaces: 0,
      eventReadyForPublicShare: true
    });
    expect(report.recommendedActions).toContainEqual(expect.objectContaining({
      id: "events:inspect-event-certificate",
      subsystem: "events",
      method: "GET",
      endpoint: "/api/competition-events/daily/result-certificate"
    }));
  });
});
