import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runPublicBenchmarkExport } from "./public-benchmark-export.mjs";

let server;
let tempDir;

function snapshot(scope) {
  return {
    schemaVersion: "steambench.public-benchmark-snapshot.v1",
    generatedAt: "2026-06-14T00:00:00.000Z",
    scope,
    canonicalArtifactName: "output.mp4",
    totals: {
      activeTasks: 37,
      games: 1,
      agents: 1,
      humans: 1
    },
    standings: []
  };
}

function catalog(scope, appid = 620, taskId = "620:ACH.WAKE_UP") {
  return {
    schemaVersion: "steambench.public-catalog.v1",
    generatedAt: "2026-06-14T00:00:00.000Z",
    scope,
    canonicalArtifactName: "output.mp4",
    publicDataPolicy: {
      officialSteamSourcesOnly: true,
      proofConsentRequiredBeforePublicRanking: true
    },
    filters: {
      season: scope,
      appid,
      provider: "external",
      limit: 12
    },
    totals: {
      games: 1,
      tasks: 1,
      activeTasks: 1,
      candidateTasks: 0,
      bridgeableTasks: 0,
      scoreboardRows: 2
    },
    games: [
      {
        appid,
        name: appid === 620 ? "Portal 2" : "Other Game",
        activeTasks: 1,
        bridgeableTasks: 0,
        scoreboardRows: 2
      }
    ],
    tasks: [
      {
        id: taskId,
        appid,
        gameName: appid === 620 ? "Portal 2" : "Other Game",
        title: "Wake Up",
        taskStatus: "active",
        runnable: true,
        actionSpace: {
          transport: "local-desktop",
          bridgeable: false
        },
        evidence: {
          canonicalArtifactName: "output.mp4",
          canonicalArtifact: "output/output.mp4"
        }
      }
    ],
    entrypoints: {
      quickstartTemplate: "http://127.0.0.1/api/public/quickstart?season=weekly&appid={appid}&taskId={taskId}&provider=external",
      bridgeHandoffTemplate: "http://127.0.0.1/api/public/tasks/{taskId}/bridge-handoff?agentId={agentId}&provider=external"
    }
  };
}

function publicStandings(scope, appid = 620, taskId = "620:ACH.WAKE_UP") {
  return {
    schemaVersion: "steambench.public-standings.v1",
    generatedAt: "2026-06-14T00:00:00.000Z",
    scope,
    canonicalArtifactName: "output.mp4",
    filters: {
      season: scope,
      appid,
      limit: 12
    },
    selectedGame: {
      appid,
      name: appid === 620 ? "Portal 2" : "Other Game"
    },
    window: {
      scope,
      label: "Last 7 Days",
      rowCount: 2
    },
    totals: {
      humanRuns: 1,
      agentRuns: 1,
      humanScore: 1000,
      agentScore: 1200,
      humanWins: 0,
      agentWins: 1,
      ties: 0,
      rows: 2,
      games: 1,
      tasks: 1,
      humanRows: 1,
      agentRows: 1
    },
    leaders: {
      competitors: [
        {
          rank: 1,
          competitor: "agent-runner",
          type: "agent",
          runs: 1,
          totalScore: 1200,
          bestScore: 1200,
          averageScore: 1200,
          lastCompletedAt: "2026-06-14"
        }
      ],
      humans: [],
      agents: []
    },
    games: [],
    matchups: [],
    taskLeaderboards: [
      {
        taskKey: taskId,
        taskId,
        appid,
        game: appid === 620 ? "Portal 2" : "Other Game",
        task: "Wake Up",
        track: "achievement",
        leader: {
          rank: 1,
          taskRank: 1,
          taskId,
          appid,
          competitor: "agent-runner",
          type: "agent",
          game: appid === 620 ? "Portal 2" : "Other Game",
          task: "Wake Up",
          track: "achievement",
          level: 1,
          score: 1200,
          evidence: "Steam proof + output.mp4",
          completedAt: "2026-06-14"
        },
        entries: [],
        links: {
          taskScoreboard: `http://127.0.0.1/api/public/tasks/${encodeURIComponent(taskId)}/scoreboard?season=${scope}&limit=12`
        }
      }
    ],
    entrypoints: {
      taskScoreboardTemplate: "http://127.0.0.1/api/public/tasks/{taskId}/scoreboard?season=weekly&limit=12",
      quickstartTemplate: "http://127.0.0.1/api/public/quickstart?season=weekly&appid={appid}&taskId={taskId}&provider=external&limit=12"
    },
    links: {
      catalog: `http://127.0.0.1/api/public/catalog?season=${scope}&appid=${appid}&limit=12`
    }
  };
}

function gamePack(scope, appid = 620) {
  return {
    schemaVersion: "steambench.public-game-benchmark-pack.v1",
    generatedAt: "2026-06-14T00:00:00.000Z",
    appid,
    gameName: "Portal 2",
    scope,
    canonicalArtifactName: "output.mp4",
    tasks: [
      {
        id: "620:ACH.WAKE_UP",
        appid,
        gameName: "Portal 2",
        title: "Wake Up",
        track: "achievement",
        level: 1,
        score: 1000
      }
    ],
    suites: [
      {
        id: "suite_620",
        appid,
        taskCount: 1
      }
    ],
    leaderboard: []
  };
}

function steamIntake(appid = 620) {
  return {
    schemaVersion: "steambench.public-steam-app-intake.v1",
    generatedAt: "2026-06-14T00:00:00.000Z",
    appid,
    canonicalArtifactName: "output.mp4",
    publicReadiness: "publication-ready",
    dataPolicy: {
      officialSteamSourcesOnly: true,
      proofConsentRequiredBeforePublicRanking: true,
      allowedSources: ["ISteamApps/GetAppList/v2"]
    },
    game: {
      appid,
      name: appid === 620 ? "Portal 2" : "Other Game"
    },
    intake: {
      status: "publication-ready",
      readinessScore: 84,
      sourceStatus: "ready-to-publish",
      blueprintStatus: "review-required"
    },
    sourceCoverage: {
      totals: {
        sourceRecords: 12,
        newImportsAvailable: 0,
        publishableCandidates: 4
      },
      sources: {
        achievement: { source: "fixture" }
      },
      recommendedActions: [
        { id: "publish-candidates", method: "POST", endpoint: "/api/steam/apps/620/publish-candidates" }
      ]
    },
    taskPipeline: {
      activeTasks: 1,
      candidateTasks: 4,
      rankedReadyTasks: 1,
      reviewRequiredTasks: 2,
      suites: [{ id: "620:starter", taskCount: 1 }],
      taskLadder: [
        { id: "starter", taskCount: 1 },
        { id: "ranked", taskCount: 0 },
        { id: "expert", taskCount: 0 }
      ]
    },
    onboarding: {
      status: "publication-ready",
      readinessScore: 84,
      stages: [
        { id: "discovery", status: "complete" },
        { id: "achievement-ladder", status: "complete" },
        { id: "task-publication", status: "ready" },
        { id: "coverage", status: "pending" },
        { id: "competition", status: "blocked" }
      ]
    },
    runtimeContract: {
      targetArtifactName: "output.mp4",
      stage2StartConstraints: ["Do not call session.run_file(...) in Stage 2 start()."]
    },
	    publicEntrypoints: {
	      benchmarkPack: "http://127.0.0.1/api/public/games/620/benchmark-pack?season=all&limit=12",
	      agentOnboarding: "http://127.0.0.1/api/public/agents/onboarding?taskId={taskId}&provider=external",
	      taskActionSpaceTemplate: "http://127.0.0.1/api/public/tasks/{taskId}/action-space",
	      raceEntryTemplate: "http://127.0.0.1/api/public/tasks/{taskId}/race-entry",
	      runnerContractTemplate: "http://127.0.0.1/api/public/tasks/{taskId}/runner-contract",
	      publicWatchTemplate: "http://127.0.0.1/api/public/broadcasts/{streamId}/watch"
	    }
  };
	}

	function agentOnboarding(taskId = "620:ACH.WAKE_UP") {
	  return {
	    schemaVersion: "steambench.public-agent-onboarding.v1",
	    generatedAt: "2026-06-14T00:00:00.000Z",
	    status: "ready-to-register",
	    selectedTask: {
	      id: taskId,
	      appid: 620,
	      gameName: "Portal 2",
	      title: "Wake Up",
	      track: "achievement",
	      level: 1,
	      taskStatus: "active",
	      runnable: true
	    },
	    registration: {
	      endpoint: "http://127.0.0.1/api/agents",
	      method: "POST",
	      provider: "external",
	      runtimeProvider: "local-sim",
	      requiredCapabilities: ["keyboard-mouse", "screen-capture", "seeded-save", "output.mp4"],
	      recommendedCapabilities: ["keyboard-mouse", "screen-capture", "seeded-save", "output.mp4"],
	      requestBodyTemplate: {
	        handle: "external-agent",
	        displayName: "External Runtime Agent",
	        provider: "external",
	        runtimeProvider: "local-sim",
	        capabilities: ["keyboard-mouse", "screen-capture", "seeded-save", "output.mp4"]
	      }
	    },
	    readiness: {
	      ready: false,
	      taskId,
	      appid: 620,
	      requiredCapabilities: ["keyboard-mouse", "screen-capture", "seeded-save", "output.mp4"],
	      providedCapabilities: [],
	      missingCapabilities: ["keyboard-mouse", "screen-capture", "seeded-save", "output.mp4"]
	    },
	    actionSpace: {
	      publicPacket: `http://127.0.0.1/api/public/tasks/${encodeURIComponent(taskId)}/action-space`,
	      schemaVersion: "steambench.runtime-action-space.v1",
	      inputMode: "keyboard-mouse",
	      transport: "local-desktop",
	      allowedActionTypes: ["key", "mouse-move", "mouse-click", "scroll", "wait"],
	      bridgeable: false,
	      requiresControlSession: false
	    },
	    runEntry: {
	      runnerContract: `http://127.0.0.1/api/public/tasks/${encodeURIComponent(taskId)}/runner-contract`,
	      runSessionBodyTemplate: {
	        taskId,
	        createControlSession: false,
	        ttlSeconds: 900
	      }
	    },
	    taskRecommendations: [
	      {
	        task: {
	          id: taskId,
	          appid: 620
	        },
	        bridgeable: false
	      }
	    ]
	  };
	}

	function raceEntry(taskId = "620:ACH.WAKE_UP", appid = 620) {
	  return {
	    schemaVersion: "steambench.public-task-race-entry.v1",
	    generatedAt: "2026-06-14T00:00:00.000Z",
	    taskStatus: "active",
	    runnable: true,
	    readyForMatch: false,
	    canonicalArtifactName: "output.mp4",
	    task: {
	      id: taskId,
	      appid,
	      gameName: appid === 620 ? "Portal 2" : "Other Game",
	      title: "Wake Up",
	      track: "achievement",
	      level: 1
	    },
	    human: {
	      status: "missing-human",
	      ready: false,
	      nextActions: ["Create or select a human user."]
	    },
	    agent: {
	      status: "ready-to-register",
	      ready: false,
	      onboarding: agentOnboarding(taskId)
	    },
	    actionSpace: taskActionSpace(taskId, appid),
	    runnerContract: {
	      endpoint: `http://127.0.0.1/api/public/tasks/${encodeURIComponent(taskId)}/runner-contract`,
	      method: "GET"
	    },
	    match: {
	      preflight: {
	        endpoint: "http://127.0.0.1/api/matches/preflight",
	        method: "POST",
	        bodyTemplate: {
	          taskId,
	          humanUserId: "<human_user_id>",
	          agentId: "<agent_id>"
	        }
	      },
	      createMatch: {
	        endpoint: "http://127.0.0.1/api/matches",
	        method: "POST"
	      }
	    }
	  };
	}

	function hub({ taskId = "620:ACH.WAKE_UP", appid = 620, scope = "weekly" } = {}) {
	  return {
	    schemaVersion: "steambench.public-competition-hub.v1",
	    generatedAt: "2026-06-14T00:00:00.000Z",
	    scope,
	    canonicalArtifactName: "output.mp4",
	    publicDataPolicy: {
	      officialSteamSourcesOnly: true,
	      proofConsentRequiredBeforePublicRanking: true
	    },
	    selected: {
	      game: {
	        appid,
	        name: appid === 620 ? "Portal 2" : "Other Game"
	      },
	      task: {
	        id: taskId,
	        appid,
	        title: "Wake Up",
	        runnable: true
	      },
	      gamePack: gamePack(scope, appid),
	      actionSpace: taskActionSpace(taskId, appid),
	      raceEntry: raceEntry(taskId, appid)
	    },
	    platform: {
	      totals: {
	        activeTasks: 37
	      },
	      season: {
	        totals: {}
	      },
	      events: [],
	      certificates: {
	        totals: {
	          readyForPublicShare: 2
	        }
	      }
	    },
	    games: [
	      {
	        appid,
	        name: appid === 620 ? "Portal 2" : "Other Game",
	        activeTasks: 1,
	        scoreboardRows: 2
	      }
	    ],
	    featuredTasks: [
	      {
	        id: taskId,
	        appid
	      }
	    ],
	    broadcasts: {
	      totals: {
	        broadcasts: 0
	      }
	    },
	    entrypoints: {
	      eventEntryTemplate: "http://127.0.0.1/api/public/events/weekly/entry?taskId={taskId}&humanUserId={userId}&agentId={agentId}&provider=external",
	      taskRaceEntryTemplate: "http://127.0.0.1/api/public/tasks/{taskId}/race-entry?humanUserId={userId}&agentId={agentId}&provider=external",
	      quickstartTemplate: "http://127.0.0.1/api/public/quickstart?season=weekly&taskId={taskId}&humanUserId={userId}&agentId={agentId}&provider=external",
	      publicWatchTemplate: "http://127.0.0.1/api/public/broadcasts/{streamId}/watch"
	    }
	  };
	}

	function eventEntry({ taskId = "620:ACH.WAKE_UP", appid = 620, scope = "weekly" } = {}) {
	  return {
	    schemaVersion: "steambench.public-event-entry.v1",
	    generatedAt: "2026-06-14T00:00:00.000Z",
	    scope,
	    canonicalArtifactName: "output.mp4",
	    event: {
	      id: `event:${scope}`,
	      title: "Weekly Human vs Agent Cup",
	      status: "empty"
	    },
	    selected: {
	      task: {
	        id: taskId,
	        appid,
	        title: "Wake Up",
	        runnable: true
	      }
	    },
	    readiness: {
	      human: {
	        status: "missing-human",
	        canRegister: false,
	        blockers: ["human_required"]
	      },
	      agent: {
	        status: "missing-agent",
	        canRegister: false,
	        blockers: ["agent_required"]
	      },
	      pair: {
	        ready: false,
	        registered: false,
	        readyForRaceEntry: false
	      },
	      eventOps: {
	        status: "needs-registration",
	        registeredPairs: 0,
	        scheduledRaces: 0,
	        scoredRaces: 0,
	        readyForPublicShare: false,
	        recommendedActionIds: ["inspect-registrations"]
	      }
	    },
	    registration: {
	      endpoint: `http://127.0.0.1/api/competition-events/${scope}/register`,
	      method: "POST",
	      human: {
	        bodyTemplate: {
	          participantType: "human",
	          participantId: "<human_user_id>"
	        },
	        ready: false,
	        alreadyRegistered: false
	      },
	      agent: {
	        bodyTemplate: {
	          participantType: "agent",
	          participantId: "<agent_id>"
	        },
	        ready: false,
	        alreadyRegistered: false
	      }
	    },
	    packets: {
	      quickstart: {
	        schemaVersion: "steambench.public-quickstart.v1"
	      },
	      raceEntry: {
	        schemaVersion: "steambench.public-task-race-entry.v1",
	        readyForMatch: false
	      },
	      bridgeHandoff: {
	        schemaVersion: "steambench.public-bridge-handoff.v1",
	        status: "not-bridgeable",
	        bridgeable: false
	      },
	      opsReport: {
	        schemaVersion: "steambench.competition-event-ops-report.v1"
	      }
	    },
	    links: {
	      evidenceBundle: `http://127.0.0.1/api/competition-events/${scope}/evidence-bundle`,
	      resultCertificate: `http://127.0.0.1/api/competition-events/${scope}/result-certificate`
	    },
	    nextActions: ["Create a human profile and link Steam with proof consent."]
	  };
	}

	function quickstart({ taskId = "620:ACH.WAKE_UP", appid = 620, scope = "weekly" } = {}) {
	  return {
	    schemaVersion: "steambench.public-quickstart.v1",
	    generatedAt: "2026-06-14T00:00:00.000Z",
	    scope,
	    canonicalArtifactName: "output.mp4",
	    selected: {
	      game: {
	        appid,
	        name: appid === 620 ? "Portal 2" : "Other Game"
	      },
	      task: {
	        id: taskId,
	        appid,
	        title: "Wake Up",
	        runnable: true
	      }
	    },
	    readiness: {
	      human: {
	        status: "missing-human",
	        ready: false,
	        selected: false
	      },
	      agent: {
	        status: "ready-to-register",
	        ready: false,
	        selected: false,
	        missingCapabilities: ["keyboard-mouse"]
	      },
	      actionSpace: {
	        inputMode: "keyboard-mouse",
	        transport: "local-desktop",
	        bridgeable: false,
	        requiresControlSession: false,
	        privilegedSystemInput: false
	      },
	      match: {
	        readyForMatch: false,
	        preflightRequired: true
	      }
	    },
	    packets: {
	      hub: {
	        schemaVersion: "steambench.public-competition-hub.v1",
	        endpoint: "http://127.0.0.1/api/public/competition-hub"
	      },
	      raceEntry: {
	        schemaVersion: "steambench.public-task-race-entry.v1",
	        endpoint: `http://127.0.0.1/api/public/tasks/${encodeURIComponent(taskId)}/race-entry`
	      },
	      actionSpace: {
	        schemaVersion: "steambench.public-task-action-space.v1",
	        endpoint: `http://127.0.0.1/api/public/tasks/${encodeURIComponent(taskId)}/action-space`
	      },
	      agentOnboarding: {
	        schemaVersion: "steambench.public-agent-onboarding.v1",
	        endpoint: `http://127.0.0.1/api/public/agents/onboarding?taskId=${encodeURIComponent(taskId)}`
	      }
	    },
	    commands: {
	      inspectHub: `npm run public:hub -- --task-id=${taskId}`,
	      registerAgent: `npm run public:agent -- --task-id=${taskId} --execute=register`,
	      inspectRaceEntry: `npm run public:race-entry -- --task-id=${taskId}`,
	      runAgentSession: `npm run agent:run-session -- --agent-id=<agent_id> --task-id=${taskId}`
	    },
	    steps: [
	      { id: "inspect-hub" },
	      { id: "create-human" },
	      { id: "link-steam" },
	      { id: "grant-proof-consent" },
	      { id: "inspect-human-proof-plan" },
	      { id: "inspect-agent-onboarding" },
	      { id: "register-agent" },
	      { id: "inspect-action-space" },
	      { id: "inspect-race-entry" },
	      { id: "match-preflight" },
	      { id: "create-match" },
	      { id: "agent-run-session" },
	      { id: "submit-action-batch" },
	      {
	        id: "submit-evidence",
	        bodyTemplate: {
	          artifactPath: "output/output.mp4"
	        }
	      },
	      { id: "watch-broadcast" }
	    ],
	    nextActions: ["Register an agent profile from the onboarding template."]
	  };
	}

	function taskActionSpace(taskId = "620:ACH.WAKE_UP", appid = 620) {
	  return {
	    schemaVersion: "steambench.public-task-action-space.v1",
	    generatedAt: "2026-06-14T00:00:00.000Z",
	    taskStatus: "active",
	    runnable: true,
	    canonicalArtifactName: "output.mp4",
	    task: {
	      id: taskId,
	      appid,
	      gameName: "Portal 2",
	      title: "Wake Up",
	      track: "achievement",
	      level: 1,
	      estimatedRuntimeMinutes: 12
	    },
	    permissions: {
	      schemaVersion: "steambench.runtime-action-space.v1",
	      inputMode: "keyboard-mouse",
	      transport: "local-desktop",
	      allowedActionTypes: ["key", "mouse-move", "mouse-click", "scroll", "wait"],
	      privilegedSystemInput: false,
	      observeBeforeAct: true,
	      constraints: {
	        maxActionsPerBatch: 48,
	        maxBatchDurationMs: 5000,
	        minObserveBeforeAct: true,
	        requireCanonicalCapture: true,
	        forbiddenActions: ["os-hotkey", "process-spawn", "file-write-outside-output"]
	      }
	    },
	    bridge: {
	      provider: "geforce-now",
	      bridgeable: false,
	      required: false,
	      executorRequest: "steambench.controller-executor-request.v1",
	      executorReport: "steambench.controller-executor-report.v1"
	    },
	    exampleActionBatch: {
	      schemaVersion: "steambench.public-agent-action-batch-template.v1",
	      endpoint: "/api/runs/<run_id>/action-batches",
	      requiresControlSessionId: false,
	      acceptedActionLabels: ["key:w:press"],
	      requestBodyTemplate: {
	        observation: "Describe the visible game state before acting.",
	        actions: [{ type: "key", key: "w", action: "press", durationMs: 250 }],
	        confidence: 0.75
	      }
	    },
	    controlSession: {
	      requiredBeforeHostInput: false,
	      ttlSecondsDefault: 900
	    },
	    evidence: {
	      canonicalArtifact: "output/output.mp4",
	      acceptedArtifactName: "output.mp4",
	      forbiddenArtifactNames: ["output-test.mp4"]
	    }
	  };
	}

	function bridgeHandoff(taskId = "620:ACH.WAKE_UP", appid = 620) {
	  return {
	    schemaVersion: "steambench.public-bridge-handoff.v1",
	    generatedAt: "2026-06-14T00:00:00.000Z",
	    status: "not-bridgeable",
	    runnable: true,
	    bridgeable: false,
	    canonicalArtifactName: "output.mp4",
	    task: {
	      id: taskId,
	      appid,
	      gameName: appid === 620 ? "Portal 2" : "Other Game",
	      title: "Wake Up",
	      track: "achievement",
	      level: 1
	    },
	    permissions: {
	      schemaVersion: "steambench.runtime-action-space.v1",
	      inputMode: "keyboard-mouse",
	      transport: "local-desktop",
	      allowedActionTypes: ["key", "mouse-move", "mouse-click", "scroll", "wait"],
	      constraints: {
	        requireCanonicalCapture: true,
	        forbiddenActions: ["os-hotkey", "process-spawn", "file-write-outside-output"]
	      },
	      privilegedSystemInput: false,
	      observeBeforeAct: true
	    },
	    grant: {
	      method: "POST",
	      endpoint: "http://127.0.0.1/api/agents/<agent_id>/run-session",
	      bodyTemplate: {
	        taskId,
	        createControlSession: false,
	        ttlSeconds: 900
	      },
	      responseSchemaVersion: "steambench.agent-run-session.v1",
	      createsRun: true,
	      createsControlSession: false,
	      ttlSeconds: 900
	    },
	    postGrantPackets: {
	      accessPacket: {
	        schemaVersion: "steambench.runtime-control-access-packet.v1",
	        endpoint: "http://127.0.0.1/api/control-sessions/<control_session_id>/access-packet"
	      },
	      bridgeManifest: {
	        schemaVersion: "steambench.control-bridge-manifest.v1",
	        endpoint: "http://127.0.0.1/api/control-sessions/<control_session_id>/bridge-manifest"
	      }
	    },
	    actionBatch: {
	      method: "POST",
	      endpoint: "/api/runs/<run_id>/action-batches",
	      receiptSchemaVersion: "steambench.agent-action-batch-receipt.v1",
	      acceptedActionLabels: ["key:w:press"]
	    },
	    executor: {
	      provider: "geforce-now",
	      command: "npm run executor:geforce-now",
	      requestSchemaVersion: "steambench.controller-executor-request.v1",
	      reportSchemaVersion: "steambench.controller-executor-report.v1",
	      reportEndpoint: "http://127.0.0.1/api/runs/<run_id>/controller-executor-reports",
	      required: false
	    },
	    evidence: {
	      canonicalArtifact: "output/output.mp4",
	      acceptedArtifactName: "output.mp4",
	      forbiddenArtifactNames: ["output-test.mp4"]
	    },
	    nextActions: ["Use this task's declared non-bridge action-space; no GeForce NOW controller lease is required."]
	  };
	}

	function runnerContract({ appid = 620, taskId = "620:ACH.WAKE_UP" } = {}) {
  return {
    schemaVersion: "steambench.public-task-runner-contract.v1",
    generatedAt: "2026-06-14T00:00:00.000Z",
    runnable: true,
    canonicalArtifactName: "output.mp4",
    task: {
      id: taskId,
      appid,
      gameName: appid === 620 ? "Portal 2" : "Other Game",
      title: "Wake Up",
      track: "achievement",
      level: 1,
      score: 1000
    },
    inputMode: "keyboard-mouse",
    proof: {
      required: true,
      requirements: ["steam-achievement", "canonical-artifact"],
      canonicalArtifactPath: "output/output.mp4"
    },
    leaderboard: {
      rows: []
    }
  };
}

function taskScoreboard(scope, taskId = "620:ACH.WAKE_UP") {
  return {
    schemaVersion: "steambench.public-task-scoreboard.v1",
    generatedAt: "2026-06-14T00:00:00.000Z",
    scope,
    canonicalArtifactName: "output.mp4",
    taskStatus: "active",
    runnable: true,
    task: {
      id: taskId,
      appid: 620,
      gameName: "Portal 2",
      title: "Wake Up",
      track: "achievement",
      level: 1,
      score: 1000
    },
    totals: {
      rows: 2,
      humanRows: 1,
      agentRows: 1,
      hasHumanLeader: true,
      hasAgentLeader: true
    },
    matchup: {
      status: "complete",
      winnerType: "agent",
      margin: 200
    },
    entries: []
  };
}

function certificateIndex(limit) {
  return {
    schemaVersion: "steambench.result-certificate-index.v1",
    generatedAt: "2026-06-14T00:00:00.000Z",
    requested: {
      kind: "all",
      limit,
      readyForPublicShare: true
    },
    totals: {
      certificates: 2,
      readyForPublicShare: 2
    },
    certificates: []
  };
}

async function startMockPublicApi({ runnerAppid = 620, runnerTaskId = "620:ACH.WAKE_UP" } = {}) {
  const calls = [];
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    calls.push({ method: request.method, path: url.pathname, search: url.search });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/public/benchmark-snapshot") {
      response.end(JSON.stringify({ snapshot: snapshot(url.searchParams.get("season") ?? "weekly") }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/public/catalog") {
      response.end(JSON.stringify({
        catalog: catalog(url.searchParams.get("season") ?? "weekly", 620, "620:ACH.WAKE_UP")
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/public/standings") {
      response.end(JSON.stringify({
        standings: publicStandings(url.searchParams.get("season") ?? "weekly", 620, "620:ACH.WAKE_UP")
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/public/steam/apps/620/intake") {
      response.end(JSON.stringify({ intake: steamIntake() }));
      return;
    }

	    if (request.method === "GET" && url.pathname === "/api/public/games/620/benchmark-pack") {
	      response.end(JSON.stringify({ pack: gamePack(url.searchParams.get("season") ?? "weekly") }));
	      return;
	    }

	    if (request.method === "GET" && url.pathname === "/api/public/competition-hub") {
	      response.end(JSON.stringify({
	        hub: hub({
	          taskId: runnerTaskId,
	          appid: runnerAppid,
	          scope: url.searchParams.get("season") ?? "weekly"
	        })
	      }));
	      return;
	    }

	    if (request.method === "GET" && url.pathname === "/api/public/events/weekly/entry") {
	      response.end(JSON.stringify({
	        entry: eventEntry({
	          taskId: runnerTaskId,
	          appid: runnerAppid,
	          scope: "weekly"
	        })
	      }));
	      return;
	    }

	    if (request.method === "GET" && url.pathname === "/api/public/quickstart") {
	      response.end(JSON.stringify({
	        quickstart: quickstart({
	          taskId: runnerTaskId,
	          appid: runnerAppid,
	          scope: url.searchParams.get("season") ?? "weekly"
	        })
	      }));
	      return;
	    }

	    if (request.method === "GET" && url.pathname === "/api/public/agents/onboarding") {
	      response.end(JSON.stringify({ onboarding: agentOnboarding(runnerTaskId) }));
	      return;
	    }

	    if (request.method === "GET" && decodeURIComponent(url.pathname) === "/api/public/tasks/620:ACH.WAKE_UP/scoreboard") {
	      response.end(JSON.stringify({ scoreboard: taskScoreboard(url.searchParams.get("season") ?? "weekly") }));
	      return;
	    }

	    if (request.method === "GET" && decodeURIComponent(url.pathname) === "/api/public/tasks/620:ACH.WAKE_UP/action-space") {
	      response.end(JSON.stringify({ actionSpace: taskActionSpace(runnerTaskId, runnerAppid) }));
	      return;
	    }

	    if (request.method === "GET" && decodeURIComponent(url.pathname) === "/api/public/tasks/620:ACH.WAKE_UP/bridge-handoff") {
	      response.end(JSON.stringify({ handoff: bridgeHandoff(runnerTaskId, runnerAppid) }));
	      return;
	    }

	    if (request.method === "GET" && decodeURIComponent(url.pathname) === "/api/public/tasks/620:ACH.WAKE_UP/race-entry") {
	      response.end(JSON.stringify({ raceEntry: raceEntry(runnerTaskId, runnerAppid) }));
	      return;
	    }

	    if (request.method === "GET" && decodeURIComponent(url.pathname) === "/api/public/tasks/620:ACH.WAKE_UP/runner-contract") {
	      response.end(JSON.stringify({ contract: runnerContract({ appid: runnerAppid, taskId: runnerTaskId }) }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/result-certificates") {
      response.end(JSON.stringify({ index: certificateIndex(Number(url.searchParams.get("limit") ?? 50)) }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { baseUrl: `http://127.0.0.1:${address.port}`, calls };
}

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("public benchmark export CLI", () => {
  it("stitches public benchmark endpoints into a static export bundle", async () => {
    const { baseUrl, calls } = await startMockPublicApi();
    tempDir = await mkdtemp(join(tmpdir(), "steambench-public-export-"));
    const out = join(tempDir, "public-export.json");

    const bundle = await runPublicBenchmarkExport({
      baseUrl,
      season: "weekly",
      appid: 620,
      limit: 12,
      includeCertificateIndex: true,
      out
    });

    expect(bundle).toMatchObject({
      schemaVersion: "steambench.public-benchmark-export.v1",
      api: baseUrl,
      request: {
        season: "weekly",
        appid: 620,
        taskId: "620:ACH.WAKE_UP",
        limit: 12,
        intake: true,
        fixture: false,
        refresh: false,
        certificates: true
      },
      summary: {
        valid: true,
        errors: [],
        activeTasks: 37,
        catalogGames: 1,
        catalogTasks: 1,
        catalogBridgeableTasks: 0,
        publicStandingsRows: 2,
        publicStandingsTaskLeaderboards: 1,
        hubGames: 1,
        hubFeaturedTasks: 1,
        hubSelectedTaskId: "620:ACH.WAKE_UP",
        eventEntryScope: "weekly",
        eventEntryHumanStatus: "missing-human",
        eventEntryAgentStatus: "missing-agent",
        eventEntryRegisteredPairs: 0,
        quickstartSteps: 15,
        quickstartHumanStatus: "missing-human",
        quickstartAgentStatus: "ready-to-register",
        intakeReadiness: "publication-ready",
        intakeSourceStatus: "ready-to-publish",
	        intakeSourceRecords: 12,
	        gameTasks: 1,
	        suites: 1,
	        agentOnboardingStatus: "ready-to-register",
	        agentRequiredCapabilities: ["keyboard-mouse", "screen-capture", "seeded-save", "output.mp4"],
	        taskScoreboardRows: 2,
	        taskScoreboardMatchup: "complete",
	        actionSpaceInputMode: "keyboard-mouse",
	        actionSpaceTransport: "local-desktop",
	        actionSpaceBridgeable: false,
	        bridgeHandoffStatus: "not-bridgeable",
	        bridgeHandoffBridgeable: false,
	        bridgeHandoffGrantCreatesControlSession: false,
	        raceEntryHumanStatus: "missing-human",
	        raceEntryAgentStatus: "ready-to-register",
	        raceEntryReadyForMatch: false,
	        runnerTaskId: "620:ACH.WAKE_UP",
	        runnerRunnable: true,
	        certificates: 2
      }
    });
    expect(bundle.sources).toMatchObject({
      catalog: `${baseUrl}/api/public/catalog?season=weekly&appid=620&provider=external&limit=12`,
      publicStandings: `${baseUrl}/api/public/standings?season=weekly&appid=620&limit=12`,
      hub: `${baseUrl}/api/public/competition-hub?season=weekly&appid=620&taskId=620%3AACH.WAKE_UP&provider=external&limit=12`,
      eventEntry: `${baseUrl}/api/public/events/weekly/entry?appid=620&taskId=620%3AACH.WAKE_UP&provider=external&limit=12`,
      quickstart: `${baseUrl}/api/public/quickstart?season=weekly&appid=620&taskId=620%3AACH.WAKE_UP&provider=external&limit=12`,
      snapshot: `${baseUrl}/api/public/benchmark-snapshot?season=weekly&limit=12`,
	      steamIntake: `${baseUrl}/api/public/steam/apps/620/intake?limit=12`,
	      gamePack: `${baseUrl}/api/public/games/620/benchmark-pack?season=weekly&limit=12`,
	      agentOnboarding: `${baseUrl}/api/public/agents/onboarding?taskId=620%3AACH.WAKE_UP&provider=external&limit=12`,
	      taskScoreboard: `${baseUrl}/api/public/tasks/620%3AACH.WAKE_UP/scoreboard?season=weekly&limit=12`,
	      taskActionSpace: `${baseUrl}/api/public/tasks/620%3AACH.WAKE_UP/action-space`,
	      bridgeHandoff: `${baseUrl}/api/public/tasks/620%3AACH.WAKE_UP/bridge-handoff?provider=external&ttlSeconds=900`,
	      raceEntry: `${baseUrl}/api/public/tasks/620%3AACH.WAKE_UP/race-entry?provider=external&limit=12`,
	      runnerContract: `${baseUrl}/api/public/tasks/620%3AACH.WAKE_UP/runner-contract`,
	      certificateIndex: `${baseUrl}/api/result-certificates?kind=all&limit=12`
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
	      "GET /api/public/catalog",
	      "GET /api/public/standings",
	      "GET /api/public/benchmark-snapshot",
	      "GET /api/public/steam/apps/620/intake",
	      "GET /api/public/games/620/benchmark-pack",
	      "GET /api/public/competition-hub",
	      "GET /api/public/events/weekly/entry",
	      "GET /api/public/quickstart",
	      "GET /api/public/tasks/620%3AACH.WAKE_UP/scoreboard",
	      "GET /api/public/agents/onboarding",
	      "GET /api/public/tasks/620%3AACH.WAKE_UP/action-space",
	      "GET /api/public/tasks/620%3AACH.WAKE_UP/bridge-handoff",
	      "GET /api/public/tasks/620%3AACH.WAKE_UP/race-entry",
	      "GET /api/public/tasks/620%3AACH.WAKE_UP/runner-contract",
	      "GET /api/result-certificates"
    ]);

    const written = JSON.parse(await readFile(out, "utf8"));
    expect(written).toMatchObject({
      schemaVersion: "steambench.public-benchmark-export.v1",
      summary: {
        valid: true,
        quickstartSteps: 15,
        intakeReadiness: "publication-ready",
        runnerTaskId: "620:ACH.WAKE_UP"
      }
    });
    expect(written.outputPath).toBeUndefined();
    expect(bundle.outputPath).toBe(out);
  });

  it("marks the export invalid when the runner contract is outside the game pack", async () => {
    const { baseUrl } = await startMockPublicApi({
      runnerAppid: 999,
      runnerTaskId: "999:ACH.OTHER"
    });

    const bundle = await runPublicBenchmarkExport({
      baseUrl,
      season: "weekly",
      appid: 620,
      taskId: "620:ACH.WAKE_UP",
      limit: 12,
      includeIntake: false,
      includeCertificateIndex: false
    });

    expect(bundle.summary).toMatchObject({
      valid: false,
      gameTasks: 1,
      certificates: undefined
    });
    expect(bundle.summary.errors).toEqual(expect.arrayContaining([
	      "hub_appid_mismatch",
	      "hub_task_mismatch",
	      "event_entry_task_mismatch",
	      "quickstart_appid_mismatch",
	      "quickstart_task_mismatch",
	      "agent_onboarding_task_mismatch",
	      "task_action_space_task_mismatch",
	      "task_action_space_appid_mismatch",
	      "bridge_handoff_task_mismatch",
	      "race_entry_task_mismatch",
	      "race_entry_action_space_mismatch",
	      "race_entry_preflight_task_mismatch",
	      "runner_contract_appid_mismatch",
	      "runner_contract_task_not_in_game_pack"
	    ]));
    expect(bundle.sources.steamIntake).toBeUndefined();
    expect(bundle.steamIntake).toBeUndefined();
    expect(bundle.sources.certificateIndex).toBeUndefined();
  });
});
