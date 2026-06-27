import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runPlatformOps } from "./platform-ops.mjs";

let server;

async function startMockApi() {
  const calls = [];
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    calls.push({ method: request.method, path: url.pathname, search: url.searchParams.toString(), body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && url.pathname === "/api/platform/ops-report") {
      response.end(JSON.stringify({
        report: {
          schemaVersion: "steambench.platform-ops-report.v1",
          generatedAt: "2026-06-14T00:00:00.000Z",
          status: "action-ready",
          filters: { scope: url.searchParams.get("scope") ?? "all", limit: Number(url.searchParams.get("limit") ?? 50) },
          totals: {
            tasks: 8,
            activeTasks: 6,
            candidateTasks: 2,
            rejectedTasks: 0,
            rankedReadyTasks: 5,
            reviewRequiredTasks: 2,
            publicRankBlockedTasks: 0,
            blueprintGames: 3,
            blueprintRankedReady: 1,
            blueprintImportReady: 1,
            blueprintReviewRequired: 1,
            blueprintNeedsSteamData: 0,
            blueprintOutputMp4Contracts: 3,
            blueprintStage2Contracts: 3,
            competitionGames: 1,
            competitionCoverageGaps: 3,
            competitionReadyActions: 2,
            competitionShareReadyGames: 0,
            discoveredApps: 3,
            shortlistedApps: 1,
            humans: 1,
            steamLinkedHumans: 1,
            consentedHumans: 1,
            humanProofReadyTickets: 1,
            humanProofReadyTasks: 2,
            humanProofConsentRequired: 0,
            humanProofSteamNotLinked: 0,
            humanAgentComparisons: 1,
            humanAgentCompleteComparisons: 0,
            humanAgentIncompleteComparisons: 1,
            humanAgentShareReadyComparisons: 0,
            humanAgentHumanMissingTasks: 2,
            humanAgentAgentMissingTasks: 0,
            agents: 1,
            activeAgents: 1,
            controllerTasks: 2,
            virtualControllerTasks: 1,
            bridgeableTasks: 1,
            runs: 4,
            queuedRuns: 1,
            activeRuns: 0,
            scoredRuns: 2,
            dispatches: 1,
            pendingDispatches: 1,
            activeControlSessions: 0,
            agentTraceReady: 0,
            agentTraceNeedsRuntime: 1,
            controlBridgeReady: 1,
            controlBridgeNeedsExecutorReport: 0,
            challenges: 1,
            openChallenges: 1,
            acceptedChallenges: 0,
            shareReadyChallenges: 0,
            matches: 1,
            activeMatches: 1,
            scoredMatches: 0,
            broadcasts: 1,
            liveBroadcasts: 0,
            scoreboardRows: 2,
            eventRegisteredHumans: 1,
            eventRegisteredAgents: 1
          },
          subsystems: [
            {
              id: "steam-sources",
              label: "Steam sources",
              status: "ready",
              summary: "ready",
              metrics: {
                sourceQueueActions: 1,
                sourceQueueNewImports: 3,
                sourceQueuePublishableCandidates: 0,
                sourceQueueAchievementRecords: 3,
                sourceQueueStatRecords: 2,
                sourceQueueLeaderboardRecords: 2,
                sourceQueueAchievementImports: 3,
                sourceQueueStatImports: 0,
                sourceQueueLeaderboardImports: 0,
                sourceQueueTopAppid: 620,
                sourceQueueTopGame: "Portal 2",
                sourceQueueTopMissingTracks: ["achievement"]
              },
              links: {}
            },
            {
              id: "task-review",
              label: "Task review",
              status: "ready",
              summary: "2 tasks need review",
              metrics: {
                tasks: 7,
                active: 5,
                candidates: 2,
                rejected: 0,
                rankedReady: 5,
                reviewRequired: 2,
                blocked: 0,
                controlled: 2,
                exclude: 0,
                topRisk: "longHorizon"
              },
              links: {}
            },
            {
              id: "benchmark-blueprints",
              label: "Benchmark blueprints",
              status: "ready",
              summary: "Balatro blueprint focus",
              metrics: {
                blueprintGames: 3,
                focusedAppid: 2379780,
                focusedGame: "Balatro",
                focusedStatus: "review-required",
                focusedReadinessScore: 78,
                rankedReady: 1,
                importReady: 1,
                reviewRequired: 1,
                needsSteamData: 0,
                focusedCanImportNow: false,
                focusedAvailableAchievementTasks: 0,
                focusedImportedAchievementTasks: 0,
                focusedSourceRecords: 6,
                focusedNewSourceImportsAvailable: 2,
                focusedSourceActiveTracks: ["achievement"],
                focusedSourceCandidateTracks: ["stat"],
                focusedSourceMissingCandidateTracks: ["leaderboard"],
                focusedAchievementSourceRecords: 0,
                focusedAchievementNewImports: 0,
                focusedStatSourceRecords: 3,
                focusedStatProposals: 2,
                focusedStatNewProposals: 1,
                focusedLeaderboardSourceRecords: 3,
                focusedLeaderboardProposals: 2,
                focusedLeaderboardNewProposals: 1,
                focusedSourceActions: 2,
                focusedSourceActionIds: ["import-stat-proposals", "import-leaderboard-proposals"],
                focusedRankedReadyTasks: 0,
                focusedReviewRequiredTasks: 2,
                focusedLadderGaps: 1,
                outputMp4Contracts: 3,
                stage2StartContracts: 3
              },
              links: {}
            },
            {
              id: "game-competition",
              label: "Game competition",
              status: "ready",
              summary: "Portal 2 focus",
              metrics: {
                competitionGames: 1,
                focusedAppid: 620,
                focusedGame: "Portal 2",
                focusedStatus: "needs-coverage",
                activeTasks: 3,
                candidateTasks: 1,
                scoredTasks: 1,
                humanGaps: 2,
                agentGaps: 1,
                readyHumanActions: 1,
                readyAgentActions: 1,
                suites: 1,
                rankedReadySuites: 1,
                scoreboardRows: 1,
                publicShareReady: false,
                selectedSuite: "620:ranked"
              },
              links: {}
            },
            {
              id: "human-proof",
              label: "Human proof",
              status: "ready",
              summary: "1 proof-ready ticket",
              metrics: {
                humans: 1,
                selectedHumans: 1,
                linked: 1,
                consented: 1,
                readyTickets: 1,
                consentRequired: 0,
                steamNotLinked: 0,
                alreadyScored: 0,
                noHumanTasks: 0,
                readyTasks: 2,
                alreadyScoredTasks: 0
              },
              links: {}
            },
            {
              id: "human-agent-comparisons",
              label: "Human-agent comparisons",
              status: "ready",
              summary: "1 campaign comparison, 1 incomplete",
              metrics: {
                comparisons: 1,
                completeComparisons: 0,
                incompleteComparisons: 1,
                humans: 1,
                agents: 1,
                campaigns: 1,
                humanWins: 0,
                agentWins: 1,
                ties: 0,
                humanScore: 0,
                agentScore: 7300,
                humanMissing: 2,
                agentMissing: 0,
                readyForPublicShare: 0
              },
              links: {}
            },
            { id: "agent-runtime", label: "Agent runtime", status: "ready", summary: "ready", metrics: {}, links: {} },
            {
              id: "broadcasts",
              label: "Broadcasts",
              status: "running",
              summary: "1 scheduled broadcast",
              metrics: {
                broadcasts: 1,
                selectedBroadcasts: 1,
                live: 0,
                scheduled: 1,
                scoreboardReady: 0,
                proofReady: 0,
                proofMissing: 0,
                viewers: 0
              },
              links: {
                opsReport: "/api/broadcasts/ops-report?limit=10",
                center: "/api/broadcasts/center"
              }
            },
            {
              id: "action-spaces",
              label: "Action spaces",
              status: "ready",
              summary: "1 bridgeable controller task",
              metrics: {
                tasks: 3,
                controllerTasks: 2,
                keyboardMouseTasks: 1,
                turnBasedTasks: 0,
                virtualControllerTasks: 1,
                bridgeableTasks: 1,
                readyForSelectedAgent: 1,
                blockedForSelectedAgent: 0,
                selectedAgentId: "agent_1",
                selectedAgentHandle: "runner"
              },
              links: {}
            },
            {
              id: "agent-traces",
              label: "Agent traces",
              status: "ready",
              summary: "1 trace gap",
              metrics: {
                agentRuns: 1,
                selectedRuns: 1,
                traceReady: 0,
                needsActions: 0,
                needsControlSession: 1,
                needsExecutorReport: 0,
                invalid: 0
              },
              links: {}
            },
            {
              id: "control-bridge",
              label: "Control bridge",
              status: "ready",
              summary: "1 bridge-ready lease",
              metrics: {
                selectedSessions: 1,
                active: 1,
                readyForBridge: 1,
                needsExecutorReport: 0,
                executorValidated: 0,
                expired: 0,
                broken: 0
              },
              links: {}
            },
            {
              id: "challenges",
              label: "Challenges",
              status: "ready",
              summary: "1 open challenge",
              metrics: {
                challenges: 1,
                selectedTickets: 1,
                open: 1,
                accepted: 0,
                running: 0,
                scoreboardReady: 0,
                evidenceMissing: 0
              },
              links: {}
            },
            {
              id: "match-arena",
              label: "Match arena",
              status: "ready",
              summary: "1 runnable match",
              metrics: {
                matches: 1,
                selectedTickets: 1,
                needsStart: 1,
                needsHumanProof: 0,
                needsAgentEvidence: 0,
                scoreboardReady: 0
              },
              links: {}
            }
          ],
          recommendedActions: [
            {
              id: "steam-sources:inspect-steam-discovery",
              subsystem: "steam-sources",
              label: "Inspect Steam discovery",
              priority: "low",
              method: "GET",
              endpoint: "/api/steam/apps/discovery",
              reason: "review"
            },
            {
              id: "task-review:inspect-review-required",
              subsystem: "task-review",
              label: "Inspect review-required tasks",
              priority: "medium",
              method: "GET",
              endpoint: "/api/tasks/review-catalog?decision=review-required&limit=10",
              reason: "inspect review"
            },
            {
              id: "benchmark-blueprints:import-stat-proposals",
              subsystem: "benchmark-blueprints",
              label: "Import stat proposals",
              priority: "high",
              method: "POST",
              endpoint: "/api/steam/apps/2379780/stat-proposals/import-recommended",
              body: { useFixture: true, limit: 2, reviewNotes: "platform blueprint import" },
              reason: "import focused blueprint stat source"
            },
            {
              id: "benchmark-blueprints:inspect-focused-blueprint",
              subsystem: "benchmark-blueprints",
              label: "Inspect focused benchmark blueprint",
              priority: "medium",
              method: "GET",
              endpoint: "/api/games/2379780/benchmark-blueprint",
              reason: "inspect blueprint"
            },
            {
              id: "game-competition:schedule-coverage",
              subsystem: "game-competition",
              label: "Queue coverage runs for ready gaps",
              priority: "high",
              method: "POST",
              endpoint: "/api/games/620/coverage-plan/schedule",
              body: { side: "both", humanUserId: "human_1", agentId: "agent_1", limit: 2 },
              reason: "queue coverage"
            },
            {
              id: "human-proof:submit-human-proof",
              subsystem: "human-proof",
              label: "Submit next human proof",
              priority: "high",
              method: "POST",
              endpoint: "/api/users/human_1/steam-proof-submissions",
              body: { taskId: "620:task_1" },
              reason: "submit proof"
            },
            {
              id: "human-agent-comparisons:run-human-campaign-local",
              subsystem: "human-agent-comparisons",
              label: "Run human campaign locally",
              priority: "high",
              method: "POST",
              endpoint: "/api/users/human_1/human-campaigns/run-local",
              body: { campaignId: "campaign_1", limit: 2 },
              reason: "run comparison"
            },
            {
              id: "events:schedule-suite",
              subsystem: "events",
              label: "Schedule suite races",
              priority: "high",
              method: "POST",
              endpoint: "/api/competition-events/weekly/schedule-suite",
              body: { suiteId: "620:ranked", reviewApproved: false, maxPairs: 1 },
              reason: "schedule"
            },
            {
              id: "events:run-suite-local",
              subsystem: "events",
              label: "Run scheduled suite races",
              priority: "high",
              method: "POST",
              endpoint: "/api/competition-events/weekly/run-suite",
              body: { suiteId: "620:ranked", maxRaces: 1 },
              reason: "run"
            },
            {
              id: "action-spaces:create-control-run-session",
              subsystem: "action-spaces",
              label: "Create control run session",
              priority: "high",
              method: "POST",
              endpoint: "/api/agents/agent_1/run-session",
              body: { taskId: "1145360:ESCAPE_TARTARUS", createControlSession: true, ttlSeconds: 900 },
              reason: "create control run session"
            },
            {
              id: "action-spaces:inspect-control-bridge-docs",
              subsystem: "action-spaces",
              label: "Inspect control bridge docs",
              priority: "medium",
              method: "GET",
              endpoint: "/api/control-sessions/ops-report?transport=virtual-controller",
              reason: "inspect bridge docs"
            },
            {
              id: "broadcasts:start-scheduled-broadcast",
              subsystem: "broadcasts",
              label: "Start scheduled broadcast",
              priority: "high",
              method: "POST",
              endpoint: "/api/livestreams/stream_scheduled/status",
              body: { status: "live", currentScene: "Runtime live", viewerCount: 1 },
              reason: "start broadcast"
            },
            {
              id: "agent-traces:create-control-session",
              subsystem: "agent-traces",
              label: "Create control session",
              priority: "high",
              method: "POST",
              endpoint: "/api/runs/run_trace/control-sessions",
              body: { ttlSeconds: 900 },
              reason: "create lease"
            },
            {
              id: "challenges:accept-open-challenge",
              subsystem: "challenges",
              label: "Accept open challenge",
              priority: "high",
              method: "POST",
              endpoint: "/api/challenges/challenge_1/accept",
              reason: "accept"
            },
            {
              id: "match-arena:run-match-local",
              subsystem: "match-arena",
              label: "Run match locally",
              priority: "high",
              method: "POST",
              endpoint: "/api/matches/match_1/run-local",
              reason: "run match"
            }
          ].filter((action) =>
            action.method !== "POST" ||
            !calls.some((call) => call.method === "POST" && call.path === new URL(action.endpoint, "http://127.0.0.1").pathname)
          ),
          links: {
            state: "/api/state",
            taskReviewCatalog: "/api/tasks/review-catalog",
            benchmarkBlueprintOps: "/api/games/:appid/benchmark-blueprint",
            gameCompetitionOps: "/api/games/:appid/competition/ops-report",
            steamDiscovery: "/api/steam/apps/discovery",
            humanOnboarding: "/api/human-onboarding/ops-report",
            humanProofOps: "/api/human-proof/ops-report",
            humanAgentComparisonOps: "/api/comparisons/human-agent/ops-report",
            agentOps: "/api/agents/ops-report",
            actionSpaces: "/api/runtime/action-spaces",
            agentTraceOps: "/api/agent-traces/ops-report",
            dispatchOps: "/api/dispatches/ops-report",
            controlBridgeOps: "/api/control-sessions/ops-report",
            challengeOps: "/api/challenges/ops-report",
            matchArenaOps: "/api/matches/arena-ops-report",
            scoreboardOps: "/api/scoreboard/ops-report",
            broadcastOps: "/api/broadcasts/ops-report",
            eventRegistrations: "/api/competition-events/registrations"
          }
        }
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/steam/apps/discovery") {
      response.end(JSON.stringify({ candidates: [{ id: "discovery_1", appid: 620 }] }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/tasks/review-catalog") {
      response.end(JSON.stringify({
        catalog: {
          totals: {
            tasks: 2,
            active: 0,
            candidates: 2,
            rejected: 0,
            rankedReady: 0,
            reviewRequired: 2,
            blocked: 0
          },
          fairness: {
            good: 0,
            controlled: 2,
            "not-comparable": 0,
            exclude: 0
          },
          risks: [{ flag: "longHorizon", count: 2 }],
          reviewQueue: []
        }
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/games/2379780/benchmark-blueprint") {
      response.end(JSON.stringify({
        blueprint: {
          schemaVersion: "steambench.benchmark-blueprint.v1",
          appid: 2379780,
          status: "review-required",
          readinessScore: 78,
          game: {
            appid: 2379780,
            name: "Balatro"
          },
          runtimePlan: {
            targetArtifactName: "output.mp4",
            stage2StartConstraints: ["Do not call session.run_file(...) in Stage 2 start()."]
          }
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/steam/apps/2379780/stat-proposals/import-recommended") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        importRun: {
          schemaVersion: "steambench.steam-stat-recommended-import.v1",
          appid: 2379780,
          imported: 2,
          proposed: 2
        },
        imported: [
          { id: "2379780:STAT.HAND_VALUE", status: "candidate" },
          { id: "2379780:STAT.MULT", status: "candidate" }
        ]
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/games/620/coverage-plan/schedule") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        schedule: {
          totals: {
            queuedRuns: 2,
            dispatches: 1
          },
          queued: [
            { id: "run_human_1", taskId: "620:task_1" },
            { id: "run_agent_1", taskId: "620:task_1" }
          ],
          skipped: []
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/users/human_1/steam-proof-submissions") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        submission: {
          runId: "run_human_1",
          scoreboardReady: true
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/users/human_1/human-campaigns/run-local") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        schemaVersion: "steambench.human-campaign-run.v1",
        planAfter: {
          status: "complete"
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/competition-events/weekly/schedule-suite") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        schedule: {
          scheduled: [{ id: "race_1", suiteId: body.suiteId }],
          skipped: []
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/competition-events/weekly/run-suite") {
      response.end(JSON.stringify({
        run: {
          executed: [{ race: { id: "race_1", suiteId: body.suiteId, status: "scored" } }],
          incomplete: []
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/matches/match_1/run-local") {
      response.end(JSON.stringify({
        match: {
          id: "match_1",
          status: "scored"
        },
        arenaPacket: {
          schemaVersion: "steambench.match-arena-packet.v1",
          matchId: "match_1",
          status: "scored",
          readyForPublicShare: true
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/challenges/challenge_1/accept") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        challenge: {
          id: "challenge_1",
          status: "accepted"
        },
        match: {
          id: "match_from_challenge_1",
          status: "scheduled"
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runs/run_trace/control-sessions") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        schemaVersion: "steambench.runtime-control-session.v1",
        session: {
          id: "session_trace_1",
          runId: "run_trace",
          status: "active"
        },
        links: {
          actionBatch: "/api/runs/run_trace/action-batches",
          bridgeManifest: "/api/control-sessions/session_trace_1/bridge-manifest"
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/agents/agent_1/run-session") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        schemaVersion: "steambench.agent-run-session.v1",
        run: {
          id: "run_session_1",
          taskId: body.taskId
        },
        handoff: {
          status: "ready-for-actions"
        },
        controlSession: {
          session: {
            id: "session_run_1",
            runId: "run_session_1",
            status: "active"
          }
        },
        accessPacket: {
          audit: {
            readyForActions: true,
            readyForBridge: true
          },
          endpoints: {
            actionBatch: "/api/runs/run_session_1/action-batches",
            bridgeManifest: "/api/control-sessions/session_run_1/bridge-manifest",
            executorReport: "/api/runs/run_session_1/controller-executor-reports"
          }
        },
        links: {
          executorReport: "/api/runs/run_session_1/controller-executor-reports"
        }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/livestreams/stream_scheduled/status") {
      response.end(JSON.stringify({
        stream: {
          id: "stream_scheduled",
          status: "live",
          currentScene: body.currentScene,
          viewerCount: body.viewerCount
        }
      }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found", path: url.pathname }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { baseUrl: `http://127.0.0.1:${address.port}`, calls };
}

afterEach(async () => {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = undefined;
});

describe("platform ops CLI runner", () => {
  it("summarizes the platform-wide ops report", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runPlatformOps({
      baseUrl,
      scope: "weekly",
      limit: 10
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.platform-ops-cli.v1",
      scope: "weekly",
      summary: {
        status: "action-ready",
        tasks: 8,
        humans: 1,
        agents: 1,
        humanProofReadyTickets: 1,
        humanProofReadyTasks: 2,
        humanProofConsentRequired: 0,
        humanProofSteamNotLinked: 0,
        humanProofAlreadyScored: 0,
        humanProofNoHumanTasks: 0,
        humanAgentComparisons: 1,
        humanAgentCompleteComparisons: 0,
        humanAgentIncompleteComparisons: 1,
        humanAgentShareReadyComparisons: 0,
        humanAgentHumanMissingTasks: 2,
        humanAgentAgentMissingTasks: 0,
        humanAgentHumanWins: 0,
        humanAgentAgentWins: 1,
        rankedReadyTasks: 5,
        reviewRequiredTasks: 2,
        publicRankBlockedTasks: 0,
        blueprintGames: 3,
        blueprintRankedReady: 1,
        blueprintImportReady: 1,
        blueprintReviewRequired: 1,
        blueprintNeedsSteamData: 0,
        blueprintOutputMp4Contracts: 3,
        blueprintStage2Contracts: 3,
        focusedBlueprintAppid: 2379780,
        focusedBlueprintGame: "Balatro",
        focusedBlueprintStatus: "review-required",
        focusedBlueprintReadinessScore: 78,
        focusedBlueprintCanImportNow: false,
        focusedBlueprintSourceRecords: 6,
        focusedBlueprintNewSourceImportsAvailable: 2,
        focusedBlueprintSourceMissingCandidateTracks: ["leaderboard"],
        focusedBlueprintStatSourceRecords: 3,
        focusedBlueprintStatNewProposals: 1,
        focusedBlueprintLeaderboardSourceRecords: 3,
        focusedBlueprintLeaderboardNewProposals: 1,
        focusedBlueprintSourceActions: 2,
        focusedBlueprintSourceActionIds: ["import-stat-proposals", "import-leaderboard-proposals"],
        competitionGames: 1,
        competitionCoverageGaps: 3,
        competitionReadyActions: 2,
        competitionShareReadyGames: 0,
        focusedCompetitionAppid: 620,
        focusedCompetitionGame: "Portal 2",
        focusedCompetitionStatus: "needs-coverage",
        focusedCompetitionHumanGaps: 2,
        focusedCompetitionAgentGaps: 1,
        controllerTasks: 2,
        virtualControllerTasks: 1,
        bridgeableTasks: 1,
        keyboardMouseTasks: 1,
        turnBasedTasks: 0,
        actionSpaceSelectedAgentId: "agent_1",
        actionSpaceReadyForSelectedAgent: 1,
        actionSpaceBlockedForSelectedAgent: 0,
        queuedRuns: 1,
        pendingDispatches: 1,
        agentTraceReady: 0,
        agentTraceNeedsRuntime: 1,
        agentTraceNeedsControlSession: 1,
        agentTraceNeedsExecutorReport: 0,
        controlBridgeReady: 1,
        controlBridgeNeedsExecutorReport: 0,
        controlBridgeReadyForBridge: 1,
        controlBridgeExecutorValidated: 0,
        challenges: 1,
        openChallenges: 1,
        acceptedChallenges: 0,
        shareReadyChallenges: 0,
        challengeEvidenceMissing: 0,
        matches: 1,
        activeMatches: 1,
        scoredMatches: 0,
        matchArenaNeedsStart: 1,
        matchArenaNeedsHumanProof: 0,
        matchArenaNeedsAgentEvidence: 0,
        matchArenaScoreboardReady: 0,
        scoreboardRows: 2,
        sourceQueueActions: 1,
        sourceQueueNewImports: 3,
        sourceQueuePublishableCandidates: 0,
        sourceQueueAchievementRecords: 3,
        sourceQueueStatRecords: 2,
        sourceQueueLeaderboardRecords: 2,
        sourceQueueAchievementImports: 3,
        sourceQueueStatImports: 0,
        sourceQueueLeaderboardImports: 0,
        sourceQueueTopAppid: 620,
        sourceQueueTopGame: "Portal 2",
        sourceQueueTopMissingTracks: ["achievement"],
        subsystems: ["steam-sources:ready", "task-review:ready", "benchmark-blueprints:ready", "game-competition:ready", "human-proof:ready", "human-agent-comparisons:ready", "agent-runtime:ready", "broadcasts:running", "action-spaces:ready", "agent-traces:ready", "control-bridge:ready", "challenges:ready", "match-arena:ready"],
        actions: ["steam-sources:inspect-steam-discovery", "task-review:inspect-review-required", "benchmark-blueprints:import-stat-proposals", "benchmark-blueprints:inspect-focused-blueprint", "game-competition:schedule-coverage", "human-proof:submit-human-proof", "human-agent-comparisons:run-human-campaign-local", "events:schedule-suite", "events:run-suite-local", "action-spaces:create-control-run-session", "action-spaces:inspect-control-bridge-docs", "broadcasts:start-scheduled-broadcast", "agent-traces:create-control-session", "challenges:accept-open-challenge", "match-arena:run-match-local"]
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/platform/ops-report"
    ]);
    expect(calls[0].search).toContain("scope=weekly");
    expect(calls[0].search).toContain("limit=10");
  });

  it("executes a platform scheduled broadcast start recommendation", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runPlatformOps({
      baseUrl,
      scope: "weekly",
      limit: 10,
      execute: "broadcasts:start-scheduled-broadcast"
    });

    expect(summary).toMatchObject({
      executedAction: {
        action: { id: "broadcasts:start-scheduled-broadcast" },
        result: {
          stream: {
            id: "stream_scheduled",
            status: "live"
          }
        }
      },
      summary: {
        executedActionId: "broadcasts:start-scheduled-broadcast",
        executedActionIds: ["broadcasts:start-scheduled-broadcast"],
        executedActionCount: 1,
        streamId: "stream_scheduled",
        streamStatus: "live"
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/platform/ops-report",
      "POST /api/livestreams/stream_scheduled/status",
      "GET /api/platform/ops-report"
    ]);
    expect(calls[1].body).toEqual({
      status: "live",
      currentScene: "Runtime live",
      viewerCount: 1
    });
  });

  it("advances writable platform actions and skips inspection recommendations", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runPlatformOps({
      baseUrl,
      scope: "weekly",
      limit: 10,
      execute: "advance-platform-actions",
      maxSteps: 2
    });

    expect(summary).toMatchObject({
      schemaVersion: "steambench.platform-ops-cli.v1",
      scope: "weekly",
      summary: {
        status: "action-ready",
        executedActionId: "benchmark-blueprints:import-stat-proposals",
        executedActionIds: ["benchmark-blueprints:import-stat-proposals", "game-competition:schedule-coverage"],
        executedActionCount: 2,
        coverageQueuedRuns: 2,
        coverageDispatches: 1
      }
    });
    expect(summary.executedActions.map((entry) => entry.action.id)).toEqual([
      "benchmark-blueprints:import-stat-proposals",
      "game-competition:schedule-coverage"
    ]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/platform/ops-report",
      "POST /api/steam/apps/2379780/stat-proposals/import-recommended",
      "GET /api/platform/ops-report",
      "POST /api/games/620/coverage-plan/schedule",
      "GET /api/platform/ops-report"
    ]);
    expect(calls[1].body).toEqual({
      useFixture: true,
      limit: 2,
      reviewNotes: "platform blueprint import"
    });
    expect(calls[3].body).toEqual({
      side: "both",
      humanUserId: "human_1",
      agentId: "agent_1",
      limit: 2
    });
  });

  it("executes a named platform API recommendation", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runPlatformOps({
      baseUrl,
      scope: "weekly",
      limit: 10,
      execute: "steam-sources:inspect-steam-discovery"
    });

    expect(summary).toMatchObject({
      executedAction: {
        action: { id: "steam-sources:inspect-steam-discovery" },
        result: {
          candidates: [{ id: "discovery_1", appid: 620 }]
        }
      },
      summary: {
        executedActionId: "steam-sources:inspect-steam-discovery"
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/platform/ops-report",
      "GET /api/steam/apps/discovery",
      "GET /api/platform/ops-report"
    ]);
  });

  it("executes a platform task review catalog recommendation", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runPlatformOps({
      baseUrl,
      scope: "weekly",
      limit: 10,
      execute: "task-review:inspect-review-required"
    });

    expect(summary).toMatchObject({
      executedAction: {
        action: { id: "task-review:inspect-review-required" },
        result: {
          catalog: {
            totals: {
              reviewRequired: 2
            }
          }
        }
      },
      summary: {
        executedActionId: "task-review:inspect-review-required"
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/platform/ops-report",
      "GET /api/tasks/review-catalog",
      "GET /api/platform/ops-report"
    ]);
    expect(calls[1].search).toContain("decision=review-required");
  });

  it("executes a platform benchmark blueprint inspection recommendation", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runPlatformOps({
      baseUrl,
      scope: "weekly",
      limit: 10,
      execute: "benchmark-blueprints:inspect-focused-blueprint"
    });

    expect(summary).toMatchObject({
      executedAction: {
        action: { id: "benchmark-blueprints:inspect-focused-blueprint" },
        result: {
          blueprint: {
            schemaVersion: "steambench.benchmark-blueprint.v1",
            appid: 2379780,
            status: "review-required",
            runtimePlan: {
              targetArtifactName: "output.mp4"
            }
          }
        }
      },
      summary: {
        executedActionId: "benchmark-blueprints:inspect-focused-blueprint"
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/platform/ops-report",
      "GET /api/games/2379780/benchmark-blueprint",
      "GET /api/platform/ops-report"
    ]);
  });

  it("executes a platform benchmark blueprint source action", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runPlatformOps({
      baseUrl,
      scope: "weekly",
      limit: 10,
      execute: "benchmark-blueprints:import-stat-proposals"
    });

    expect(summary).toMatchObject({
      executedAction: {
        action: { id: "benchmark-blueprints:import-stat-proposals" },
        result: {
          importRun: {
            imported: 2
          }
        }
      },
      summary: {
        executedActionId: "benchmark-blueprints:import-stat-proposals"
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/platform/ops-report",
      "POST /api/steam/apps/2379780/stat-proposals/import-recommended",
      "GET /api/platform/ops-report"
    ]);
  });

  it("executes a platform game competition coverage recommendation", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runPlatformOps({
      baseUrl,
      scope: "weekly",
      limit: 10,
      execute: "game-competition:schedule-coverage"
    });

    expect(summary).toMatchObject({
      executedAction: {
        action: { id: "game-competition:schedule-coverage" },
        result: {
          schedule: {
            totals: {
              queuedRuns: 2,
              dispatches: 1
            }
          }
        }
      },
      summary: {
        executedActionId: "game-competition:schedule-coverage",
        coverageQueuedRuns: 2,
        coverageDispatches: 1
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/platform/ops-report",
      "POST /api/games/620/coverage-plan/schedule",
      "GET /api/platform/ops-report"
    ]);
    expect(calls[1].body).toEqual({
      side: "both",
      humanUserId: "human_1",
      agentId: "agent_1",
      limit: 2
    });
  });

  it("executes a platform human proof submission recommendation", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runPlatformOps({
      baseUrl,
      scope: "weekly",
      limit: 10,
      execute: "human-proof:submit-human-proof"
    });

    expect(summary).toMatchObject({
      executedAction: {
        action: { id: "human-proof:submit-human-proof" },
        result: {
          submission: {
            runId: "run_human_1",
            scoreboardReady: true
          }
        }
      },
      summary: {
        executedActionId: "human-proof:submit-human-proof",
        submissionRunId: "run_human_1",
        submissionScoreboardReady: true
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/platform/ops-report",
      "POST /api/users/human_1/steam-proof-submissions",
      "GET /api/platform/ops-report"
    ]);
    expect(calls[1].body).toEqual({ taskId: "620:task_1" });
  });

  it("executes a platform human-agent comparison local campaign recommendation", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runPlatformOps({
      baseUrl,
      scope: "weekly",
      limit: 10,
      execute: "human-agent-comparisons:run-human-campaign-local"
    });

    expect(summary).toMatchObject({
      executedAction: {
        action: { id: "human-agent-comparisons:run-human-campaign-local" },
        result: {
          schemaVersion: "steambench.human-campaign-run.v1",
          planAfter: {
            status: "complete"
          }
        }
      },
      summary: {
        executedActionId: "human-agent-comparisons:run-human-campaign-local",
        humanCampaignRunStatus: "complete"
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/platform/ops-report",
      "POST /api/users/human_1/human-campaigns/run-local",
      "GET /api/platform/ops-report"
    ]);
    expect(calls[1].body).toEqual({ campaignId: "campaign_1", limit: 2 });
  });

  it("executes a platform event scheduling recommendation", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runPlatformOps({
      baseUrl,
      scope: "weekly",
      limit: 10,
      execute: "events:schedule-suite"
    });

    expect(summary).toMatchObject({
      executedAction: {
        action: { id: "events:schedule-suite" },
        result: {
          schedule: {
            scheduled: [{ id: "race_1", suiteId: "620:ranked" }]
          }
        }
      },
      summary: {
        executedActionId: "events:schedule-suite",
        scheduledCount: 1,
        skippedCount: 0
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/platform/ops-report",
      "POST /api/competition-events/weekly/schedule-suite",
      "GET /api/platform/ops-report"
    ]);
    expect(calls[1].body).toEqual({
      suiteId: "620:ranked",
      reviewApproved: false,
      maxPairs: 1
    });
  });

  it("executes a platform event suite run recommendation", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runPlatformOps({
      baseUrl,
      scope: "weekly",
      limit: 10,
      execute: "events:run-suite-local"
    });

    expect(summary).toMatchObject({
      executedAction: {
        action: { id: "events:run-suite-local" },
        result: {
          run: {
            executed: [{ race: { id: "race_1", suiteId: "620:ranked", status: "scored" } }],
            incomplete: []
          }
        }
      },
      summary: {
        executedActionId: "events:run-suite-local",
        executedRaces: 1,
        incompleteRaces: 0
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/platform/ops-report",
      "POST /api/competition-events/weekly/run-suite",
      "GET /api/platform/ops-report"
    ]);
    expect(calls[1].body).toEqual({
      suiteId: "620:ranked",
      maxRaces: 1
    });
  });

  it("executes a platform challenge acceptance recommendation", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runPlatformOps({
      baseUrl,
      scope: "weekly",
      limit: 10,
      execute: "challenges:accept-open-challenge"
    });

    expect(summary).toMatchObject({
      executedAction: {
        action: { id: "challenges:accept-open-challenge" },
        result: {
          challenge: {
            id: "challenge_1",
            status: "accepted"
          },
          match: {
            id: "match_from_challenge_1",
            status: "scheduled"
          }
        }
      },
      summary: {
        executedActionId: "challenges:accept-open-challenge",
        challengeId: "challenge_1",
        challengeStatus: "accepted",
        matchId: "match_from_challenge_1",
        matchStatus: "scheduled"
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/platform/ops-report",
      "POST /api/challenges/challenge_1/accept",
      "GET /api/platform/ops-report"
    ]);
  });

  it("executes a platform agent trace control-session recommendation", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runPlatformOps({
      baseUrl,
      scope: "weekly",
      limit: 10,
      execute: "agent-traces:create-control-session"
    });

    expect(summary).toMatchObject({
      executedAction: {
        action: { id: "agent-traces:create-control-session" },
        result: {
          schemaVersion: "steambench.runtime-control-session.v1",
          session: {
            id: "session_trace_1",
            runId: "run_trace",
            status: "active"
          }
        }
      },
      summary: {
        executedActionId: "agent-traces:create-control-session",
        controlSessionId: "session_trace_1",
        controlSessionRunId: "run_trace",
        controlSessionStatus: "active"
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/platform/ops-report",
      "POST /api/runs/run_trace/control-sessions",
      "GET /api/platform/ops-report"
    ]);
    expect(calls[1].body).toEqual({ ttlSeconds: 900 });
  });

  it("executes a platform action-space control run-session recommendation", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runPlatformOps({
      baseUrl,
      scope: "weekly",
      limit: 10,
      execute: "action-spaces:create-control-run-session"
    });

    expect(summary).toMatchObject({
      executedAction: {
        action: { id: "action-spaces:create-control-run-session" },
        result: {
          schemaVersion: "steambench.agent-run-session.v1",
          run: {
            id: "run_session_1",
            taskId: "1145360:ESCAPE_TARTARUS"
          },
          controlSession: {
            session: {
              id: "session_run_1",
              status: "active"
            }
          }
        }
      },
      summary: {
        executedActionId: "action-spaces:create-control-run-session",
        runSessionId: "run_session_1",
        runSessionStatus: "ready-for-actions",
        runSessionControlId: "session_run_1",
        runSessionAccessPacketReady: true,
        runSessionBridgeReady: true,
        runSessionActionBatchEndpoint: "/api/runs/run_session_1/action-batches",
        runSessionBridgeManifestEndpoint: "/api/control-sessions/session_run_1/bridge-manifest",
        runSessionExecutorReportEndpoint: "/api/runs/run_session_1/controller-executor-reports"
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/platform/ops-report",
      "POST /api/agents/agent_1/run-session",
      "GET /api/platform/ops-report"
    ]);
    expect(calls[1].body).toEqual({
      taskId: "1145360:ESCAPE_TARTARUS",
      createControlSession: true,
      ttlSeconds: 900
    });
  });

  it("executes a platform match arena run recommendation", async () => {
    const { baseUrl, calls } = await startMockApi();

    const summary = await runPlatformOps({
      baseUrl,
      scope: "weekly",
      limit: 10,
      execute: "match-arena:run-match-local"
    });

    expect(summary).toMatchObject({
      executedAction: {
        action: { id: "match-arena:run-match-local" },
        result: {
          match: {
            id: "match_1",
            status: "scored"
          },
          arenaPacket: {
            schemaVersion: "steambench.match-arena-packet.v1",
            readyForPublicShare: true
          }
        }
      },
      summary: {
        executedActionId: "match-arena:run-match-local",
        matchId: "match_1",
        matchStatus: "scored",
        matchReadyForPublicShare: true
      }
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/platform/ops-report",
      "POST /api/matches/match_1/run-local",
      "GET /api/platform/ops-report"
    ]);
  });
});
