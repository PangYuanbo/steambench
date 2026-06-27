import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function configFromArgs() {
  const scope = args.get("scope") ?? "all";
  if (scope !== "all" && scope !== "daily" && scope !== "weekly") {
    throw new Error("Provide --scope=all|daily|weekly.");
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    scope,
    limit: intArg("limit", 50, { min: 1, max: 200 }),
    execute: args.get("execute") ?? "",
    maxSteps: intArg("max-steps", 3, { min: 1, max: 10 })
  };
}

async function readJson(baseUrl, path, options) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`${path} failed with ${response.status}: ${text}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function queryString(config) {
  const query = new URLSearchParams();
  query.set("scope", config.scope);
  query.set("limit", String(config.limit));
  return query.toString();
}

function reportPath(config) {
  return `/api/platform/ops-report?${queryString(config)}`;
}

function actionRequest(action) {
  if (!action) throw new Error("Missing action to execute.");
  if (action.method === "CLI") {
    throw new Error(`Action ${action.id} is a CLI handoff; run: ${action.command}`);
  }
  if (action.method === "GET") return { method: "GET" };
  return {
    method: action.method,
    body: JSON.stringify(action.body ?? {})
  };
}

function actionSignature(action) {
  return `${action.id}:${action.method}:${action.endpoint}`;
}

function isAutomationAction(action) {
  if (!action || action.method !== "POST") return false;
  if (action.id.includes(":inspect-")) return false;
  if (action.id.endsWith(":link-steam")) return false;
  if (action.id.endsWith(":create-human")) return false;
  if (action.id.endsWith(":submit-action-batch")) return false;
  return Boolean(action.endpoint);
}

function nextAutomationAction(report) {
  return report.recommendedActions?.find(isAutomationAction);
}

async function executePlatformAction(config, action) {
  return {
    action,
    result: await readJson(config.baseUrl, action?.endpoint, actionRequest(action))
  };
}

async function advancePlatformActions(config) {
  const executedActions = [];
  const seen = new Set();
  let refreshed = null;

  for (let step = 0; step < config.maxSteps; step += 1) {
    const payload = await readJson(config.baseUrl, reportPath(config));
    const action = nextAutomationAction(payload.report);
    if (!action) {
      refreshed = payload.report;
      break;
    }
    const signature = actionSignature(action);
    if (seen.has(signature)) {
      refreshed = payload.report;
      break;
    }
    seen.add(signature);
    executedActions.push(await executePlatformAction(config, action));
  }

  if (!refreshed) {
    refreshed = (await readJson(config.baseUrl, reportPath(config))).report;
  }

  return { executedActions, refreshed };
}

async function runPlatformOps(config = configFromArgs()) {
  let executedActions = [];
  let refreshed;
  if (config.execute === "advance-platform-actions") {
    ({ executedActions, refreshed } = await advancePlatformActions(config));
  } else {
    const payload = await readJson(config.baseUrl, reportPath(config));
    const report = payload.report;
    const action = config.execute
      ? report.recommendedActions?.find((entry) => entry.id === config.execute)
      : undefined;
    executedActions = config.execute ? [await executePlatformAction(config, action)] : [];
    refreshed = executedActions.length > 0 ? (await readJson(config.baseUrl, reportPath(config))).report : report;
  }
  const executedAction = executedActions[0];
  const scheduleAction = executedActions.find((entry) => entry.result?.schedule);
  const runAction = executedActions.find((entry) => entry.result?.run);
  const registrationAction = executedActions.find((entry) => entry.result?.registration);
  const submissionAction = executedActions.find((entry) => entry.result?.submission);
  const humanCampaignAction = executedActions.find((entry) => entry.result?.schemaVersion === "steambench.human-campaign-run.v1");
  const controlAction = executedActions.find((entry) => entry.result?.session);
  const runSessionAction = executedActions.find((entry) => entry.result?.handoff);
  const streamAction = executedActions.find((entry) => entry.result?.stream);
  const challengeAction = executedActions.find((entry) => entry.result?.challenge);
  const matchAction = executedActions.find((entry) => entry.result?.match || entry.result?.arenaPacket);
  const certificateAction = executedActions.find((entry) => entry.result?.certificate);
  const steamSourceMetrics = refreshed.subsystems.find((entry) => entry.id === "steam-sources")?.metrics ?? {};
  const benchmarkBlueprintMetrics = refreshed.subsystems.find((entry) => entry.id === "benchmark-blueprints")?.metrics ?? {};
  const humanProofMetrics = refreshed.subsystems.find((entry) => entry.id === "human-proof")?.metrics ?? {};
  const humanAgentComparisonMetrics = refreshed.subsystems.find((entry) => entry.id === "human-agent-comparisons")?.metrics ?? {};
  const actionSpaceMetrics = refreshed.subsystems.find((entry) => entry.id === "action-spaces")?.metrics ?? {};
  const agentTraceMetrics = refreshed.subsystems.find((entry) => entry.id === "agent-traces")?.metrics ?? {};
  const controlBridgeMetrics = refreshed.subsystems.find((entry) => entry.id === "control-bridge")?.metrics ?? {};
  const gameCompetitionMetrics = refreshed.subsystems.find((entry) => entry.id === "game-competition")?.metrics ?? {};
  const challengeMetrics = refreshed.subsystems.find((entry) => entry.id === "challenges")?.metrics ?? {};
  const matchArenaMetrics = refreshed.subsystems.find((entry) => entry.id === "match-arena")?.metrics ?? {};
  return {
    schemaVersion: "steambench.platform-ops-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    scope: config.scope,
    report: refreshed,
    executedAction,
    executedActions,
    summary: {
      status: refreshed.status,
      tasks: refreshed.totals.tasks,
      humans: refreshed.totals.humans,
      agents: refreshed.totals.agents,
      humanProofReadyTickets: refreshed.totals.humanProofReadyTickets,
      humanProofReadyTasks: refreshed.totals.humanProofReadyTasks,
      humanProofConsentRequired: refreshed.totals.humanProofConsentRequired,
      humanProofSteamNotLinked: refreshed.totals.humanProofSteamNotLinked,
      humanProofAlreadyScored: humanProofMetrics.alreadyScored,
      humanProofNoHumanTasks: humanProofMetrics.noHumanTasks,
      humanAgentComparisons: refreshed.totals.humanAgentComparisons,
      humanAgentCompleteComparisons: refreshed.totals.humanAgentCompleteComparisons,
      humanAgentIncompleteComparisons: refreshed.totals.humanAgentIncompleteComparisons,
      humanAgentShareReadyComparisons: refreshed.totals.humanAgentShareReadyComparisons,
      humanAgentHumanMissingTasks: refreshed.totals.humanAgentHumanMissingTasks,
      humanAgentAgentMissingTasks: refreshed.totals.humanAgentAgentMissingTasks,
      humanAgentHumanWins: humanAgentComparisonMetrics.humanWins,
      humanAgentAgentWins: humanAgentComparisonMetrics.agentWins,
      rankedReadyTasks: refreshed.totals.rankedReadyTasks,
      reviewRequiredTasks: refreshed.totals.reviewRequiredTasks,
      publicRankBlockedTasks: refreshed.totals.publicRankBlockedTasks,
      blueprintGames: refreshed.totals.blueprintGames,
      blueprintRankedReady: refreshed.totals.blueprintRankedReady,
      blueprintImportReady: refreshed.totals.blueprintImportReady,
      blueprintReviewRequired: refreshed.totals.blueprintReviewRequired,
      blueprintNeedsSteamData: refreshed.totals.blueprintNeedsSteamData,
      blueprintOutputMp4Contracts: refreshed.totals.blueprintOutputMp4Contracts,
      blueprintStage2Contracts: refreshed.totals.blueprintStage2Contracts,
      focusedBlueprintAppid: benchmarkBlueprintMetrics.focusedAppid,
      focusedBlueprintGame: benchmarkBlueprintMetrics.focusedGame,
      focusedBlueprintStatus: benchmarkBlueprintMetrics.focusedStatus,
      focusedBlueprintReadinessScore: benchmarkBlueprintMetrics.focusedReadinessScore,
      focusedBlueprintCanImportNow: benchmarkBlueprintMetrics.focusedCanImportNow,
      focusedBlueprintSourceRecords: benchmarkBlueprintMetrics.focusedSourceRecords,
      focusedBlueprintNewSourceImportsAvailable: benchmarkBlueprintMetrics.focusedNewSourceImportsAvailable,
      focusedBlueprintSourceMissingCandidateTracks: benchmarkBlueprintMetrics.focusedSourceMissingCandidateTracks,
      focusedBlueprintAchievementSourceRecords: benchmarkBlueprintMetrics.focusedAchievementSourceRecords,
      focusedBlueprintAchievementNewImports: benchmarkBlueprintMetrics.focusedAchievementNewImports,
      focusedBlueprintStatSourceRecords: benchmarkBlueprintMetrics.focusedStatSourceRecords,
      focusedBlueprintStatProposals: benchmarkBlueprintMetrics.focusedStatProposals,
      focusedBlueprintStatNewProposals: benchmarkBlueprintMetrics.focusedStatNewProposals,
      focusedBlueprintLeaderboardSourceRecords: benchmarkBlueprintMetrics.focusedLeaderboardSourceRecords,
      focusedBlueprintLeaderboardProposals: benchmarkBlueprintMetrics.focusedLeaderboardProposals,
      focusedBlueprintLeaderboardNewProposals: benchmarkBlueprintMetrics.focusedLeaderboardNewProposals,
      focusedBlueprintSourceActions: benchmarkBlueprintMetrics.focusedSourceActions,
      focusedBlueprintSourceActionIds: benchmarkBlueprintMetrics.focusedSourceActionIds,
      competitionGames: refreshed.totals.competitionGames,
      competitionCoverageGaps: refreshed.totals.competitionCoverageGaps,
      competitionReadyActions: refreshed.totals.competitionReadyActions,
      competitionShareReadyGames: refreshed.totals.competitionShareReadyGames,
      focusedCompetitionAppid: gameCompetitionMetrics.focusedAppid,
      focusedCompetitionGame: gameCompetitionMetrics.focusedGame,
      focusedCompetitionStatus: gameCompetitionMetrics.focusedStatus,
      focusedCompetitionHumanGaps: gameCompetitionMetrics.humanGaps,
      focusedCompetitionAgentGaps: gameCompetitionMetrics.agentGaps,
      controllerTasks: refreshed.totals.controllerTasks,
      virtualControllerTasks: refreshed.totals.virtualControllerTasks,
      bridgeableTasks: refreshed.totals.bridgeableTasks,
      keyboardMouseTasks: actionSpaceMetrics.keyboardMouseTasks,
      turnBasedTasks: actionSpaceMetrics.turnBasedTasks,
      actionSpaceSelectedAgentId: actionSpaceMetrics.selectedAgentId,
      actionSpaceReadyForSelectedAgent: actionSpaceMetrics.readyForSelectedAgent,
      actionSpaceBlockedForSelectedAgent: actionSpaceMetrics.blockedForSelectedAgent,
      queuedRuns: refreshed.totals.queuedRuns,
      activeRuns: refreshed.totals.activeRuns,
      pendingDispatches: refreshed.totals.pendingDispatches,
      agentTraceReady: refreshed.totals.agentTraceReady,
      agentTraceNeedsRuntime: refreshed.totals.agentTraceNeedsRuntime,
      agentTraceNeedsControlSession: agentTraceMetrics.needsControlSession,
      agentTraceNeedsExecutorReport: agentTraceMetrics.needsExecutorReport,
      controlBridgeReady: refreshed.totals.controlBridgeReady,
      controlBridgeNeedsExecutorReport: refreshed.totals.controlBridgeNeedsExecutorReport,
      controlBridgeReadyForBridge: controlBridgeMetrics.readyForBridge,
      controlBridgeExecutorValidated: controlBridgeMetrics.executorValidated,
      challenges: refreshed.totals.challenges,
      openChallenges: refreshed.totals.openChallenges,
      acceptedChallenges: refreshed.totals.acceptedChallenges,
      shareReadyChallenges: refreshed.totals.shareReadyChallenges,
      challengeEvidenceMissing: challengeMetrics.evidenceMissing,
      matches: refreshed.totals.matches,
      activeMatches: refreshed.totals.activeMatches,
      scoredMatches: refreshed.totals.scoredMatches,
      matchArenaNeedsStart: matchArenaMetrics.needsStart,
      matchArenaNeedsHumanProof: matchArenaMetrics.needsHumanProof,
      matchArenaNeedsAgentEvidence: matchArenaMetrics.needsAgentEvidence,
      matchArenaScoreboardReady: matchArenaMetrics.scoreboardReady,
      liveBroadcasts: refreshed.totals.liveBroadcasts,
      scoreboardRows: refreshed.totals.scoreboardRows,
      sourceQueueActions: steamSourceMetrics.sourceQueueActions,
      sourceQueueNewImports: steamSourceMetrics.sourceQueueNewImports,
      sourceQueuePublishableCandidates: steamSourceMetrics.sourceQueuePublishableCandidates,
      sourceQueueAchievementRecords: steamSourceMetrics.sourceQueueAchievementRecords,
      sourceQueueStatRecords: steamSourceMetrics.sourceQueueStatRecords,
      sourceQueueLeaderboardRecords: steamSourceMetrics.sourceQueueLeaderboardRecords,
      sourceQueueAchievementImports: steamSourceMetrics.sourceQueueAchievementImports,
      sourceQueueStatImports: steamSourceMetrics.sourceQueueStatImports,
      sourceQueueLeaderboardImports: steamSourceMetrics.sourceQueueLeaderboardImports,
      sourceQueueTopAppid: steamSourceMetrics.sourceQueueTopAppid,
      sourceQueueTopGame: steamSourceMetrics.sourceQueueTopGame,
      sourceQueueTopMissingTracks: steamSourceMetrics.sourceQueueTopMissingTracks,
      subsystems: refreshed.subsystems.map((entry) => `${entry.id}:${entry.status}`),
      actions: refreshed.recommendedActions.map((entry) => entry.id),
      executedActionId: executedAction?.action?.id,
      executedActionIds: executedActions.map((entry) => entry.action?.id),
      executedActionCount: executedActions.length,
      scheduledCount: scheduleAction?.result?.schedule?.scheduled?.length,
      skippedCount: scheduleAction?.result?.schedule?.skipped?.length,
      executedRaces: runAction?.result?.run?.executed?.length,
      incompleteRaces: runAction?.result?.run?.incomplete?.length,
      registeredParticipantId: registrationAction?.result?.registration?.participantId,
      coverageQueuedRuns: scheduleAction?.result?.schedule?.totals?.queuedRuns,
      coverageDispatches: scheduleAction?.result?.schedule?.totals?.dispatches,
      submissionRunId: submissionAction?.result?.submission?.runId,
      submissionScoreboardReady: submissionAction?.result?.submission?.scoreboardReady,
      humanCampaignRunStatus: humanCampaignAction?.result?.planAfter?.status,
      controlSessionId: controlAction?.result?.session?.id,
      controlSessionRunId: controlAction?.result?.session?.runId,
      controlSessionStatus: controlAction?.result?.session?.status,
      runSessionId: runSessionAction?.result?.run?.id,
      runSessionStatus: runSessionAction?.result?.handoff?.status,
      runSessionControlId: runSessionAction?.result?.controlSession?.session?.id,
      runSessionAccessPacketReady: runSessionAction?.result?.accessPacket?.audit?.readyForActions,
      runSessionBridgeReady: runSessionAction?.result?.accessPacket?.audit?.readyForBridge,
      runSessionActionBatchEndpoint: runSessionAction?.result?.accessPacket?.endpoints?.actionBatch,
      runSessionBridgeManifestEndpoint: runSessionAction?.result?.accessPacket?.endpoints?.bridgeManifest,
      runSessionExecutorReportEndpoint: runSessionAction?.result?.accessPacket?.endpoints?.executorReport ?? runSessionAction?.result?.links?.executorReport,
      streamId: streamAction?.result?.stream?.id,
      streamStatus: streamAction?.result?.stream?.status,
      challengeId: challengeAction?.result?.challenge?.id,
      challengeStatus: challengeAction?.result?.challenge?.status,
      matchId: matchAction?.result?.match?.id ?? matchAction?.result?.arenaPacket?.matchId,
      matchStatus: matchAction?.result?.match?.status ?? matchAction?.result?.arenaPacket?.status,
      matchReadyForPublicShare: matchAction?.result?.arenaPacket?.readyForPublicShare,
      certificateKind: certificateAction?.result?.certificate?.kind,
      readyForPublicShare: certificateAction?.result?.certificate?.integrity?.readyForPublicShare
    }
  };
}

export { runPlatformOps };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPlatformOps()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
