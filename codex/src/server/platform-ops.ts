import type { BenchmarkSuite } from "../benchmark/suites";
import { gameCatalog } from "../benchmark/catalog";
import type { SeasonScope } from "../benchmark/standings";
import { buildTaskReviewCatalog } from "../benchmark/task-review-catalog";
import { inferGameCatalogEntry } from "../benchmark/task-generator";
import type { BenchmarkTask } from "../benchmark/types";
import { buildAgentOpsReport } from "./agent-ops";
import { buildAgentTraceOpsReport } from "./agent-trace-ops";
import { buildBroadcastCenter } from "./broadcast-center";
import { buildBroadcastOpsReport } from "./broadcast-ops";
import { buildChallengeOpsReport } from "./challenge-ops";
import type { CompetitionEventEvidenceBundleSummary } from "./competition-event-evidence-bundle";
import { buildControlBridgeOpsReport } from "./control-bridge-ops";
import { buildBenchmarkBlueprint, type BenchmarkBlueprint } from "./benchmark-blueprint";
import { buildGameCompetitionOpsReport, type GameCompetitionOpsReport } from "./game-competition-ops";
import { buildGameCompetitionStandings } from "./game-competition-standings";
import { buildGameCoveragePlan } from "./game-coverage-plan";
import { buildHumanOnboardingOpsReport } from "./human-onboarding-ops";
import { buildHumanProofOpsReport } from "./human-proof-ops";
import { buildHumanAgentComparisonOpsReport } from "./human-agent-comparison-standings";
import { buildMatchArenaOpsReport } from "./match-arena-ops";
import { buildRuntimeActionSpaceCatalog } from "./runtime-action-space-catalog";
import { buildScoreboardOpsReport } from "./scoreboard-ops";
import type { SteamSourceQueue } from "./steam-source-queue";
import type { StoreSnapshot } from "./store";

export type PlatformOpsSubsystemId =
  | "steam-sources"
  | "task-review"
  | "benchmark-blueprints"
  | "game-competition"
  | "human-onboarding"
  | "human-proof"
  | "human-agent-comparisons"
  | "agent-runtime"
  | "action-spaces"
  | "runtime-dispatch"
  | "agent-traces"
  | "control-bridge"
  | "challenges"
  | "match-arena"
  | "scoreboard"
  | "broadcasts"
  | "events";

export type PlatformOpsSubsystemStatus = "ready" | "attention" | "running" | "idle";

export type PlatformOpsAction = {
  id: string;
  subsystem: PlatformOpsSubsystemId;
  label: string;
  priority: "high" | "medium" | "low";
  method: "GET" | "POST" | "CLI";
  endpoint?: string;
  command?: string;
  body?: Record<string, unknown>;
  reason: string;
};

export type PlatformOpsReport = {
  schemaVersion: "steambench.platform-ops-report.v1";
  generatedAt: string;
  status: "needs-attention" | "action-ready" | "running" | "ready-to-share" | "idle";
  filters: {
    scope: SeasonScope;
    limit: number;
  };
  totals: {
    tasks: number;
    activeTasks: number;
    candidateTasks: number;
    rejectedTasks: number;
    rankedReadyTasks: number;
    reviewRequiredTasks: number;
    publicRankBlockedTasks: number;
    blueprintGames: number;
    blueprintRankedReady: number;
    blueprintImportReady: number;
    blueprintReviewRequired: number;
    blueprintNeedsSteamData: number;
    blueprintOutputMp4Contracts: number;
    blueprintStage2Contracts: number;
    competitionGames: number;
    competitionCoverageGaps: number;
    competitionReadyActions: number;
    competitionShareReadyGames: number;
    discoveredApps: number;
    shortlistedApps: number;
    humans: number;
    steamLinkedHumans: number;
    consentedHumans: number;
    humanProofReadyTickets: number;
    humanProofReadyTasks: number;
    humanProofConsentRequired: number;
    humanProofSteamNotLinked: number;
    humanAgentComparisons: number;
    humanAgentCompleteComparisons: number;
    humanAgentIncompleteComparisons: number;
    humanAgentShareReadyComparisons: number;
    humanAgentHumanMissingTasks: number;
    humanAgentAgentMissingTasks: number;
    agents: number;
    activeAgents: number;
    controllerTasks: number;
    virtualControllerTasks: number;
    bridgeableTasks: number;
    runs: number;
    queuedRuns: number;
    activeRuns: number;
    scoredRuns: number;
    dispatches: number;
    pendingDispatches: number;
    activeControlSessions: number;
    agentTraceReady: number;
    agentTraceNeedsRuntime: number;
    controlBridgeReady: number;
    controlBridgeNeedsExecutorReport: number;
    challenges: number;
    openChallenges: number;
    acceptedChallenges: number;
    shareReadyChallenges: number;
    matches: number;
    activeMatches: number;
    scoredMatches: number;
    broadcasts: number;
    liveBroadcasts: number;
    scoreboardRows: number;
    eventRegisteredHumans: number;
    eventRegisteredAgents: number;
  };
  subsystems: Array<{
    id: PlatformOpsSubsystemId;
    label: string;
    status: PlatformOpsSubsystemStatus;
    summary: string;
    metrics: Record<string, number | string | boolean | string[]>;
    links: Record<string, string>;
  }>;
  recommendedActions: PlatformOpsAction[];
  links: {
    state: "/api/state";
    taskReviewCatalog: "/api/tasks/review-catalog";
    benchmarkBlueprintOps: "/api/games/:appid/benchmark-blueprint";
    gameCompetitionOps: "/api/games/:appid/competition/ops-report";
    steamDiscovery: "/api/steam/apps/discovery";
    steamSourceQueue: "/api/steam/source-queue";
    humanOnboarding: "/api/human-onboarding/ops-report";
    humanProofOps: "/api/human-proof/ops-report";
    humanAgentComparisonOps: "/api/comparisons/human-agent/ops-report";
    agentOps: "/api/agents/ops-report";
    actionSpaces: "/api/runtime/action-spaces";
    agentTraceOps: "/api/agent-traces/ops-report";
    dispatchOps: "/api/dispatches/ops-report";
    controlBridgeOps: "/api/control-sessions/ops-report";
    challengeOps: "/api/challenges/ops-report";
    matchArenaOps: "/api/matches/arena-ops-report";
    scoreboardOps: "/api/scoreboard/ops-report";
    broadcastOps: "/api/broadcasts/ops-report";
    eventRegistrations: "/api/competition-events/registrations";
  };
};

type SourceAction = Omit<PlatformOpsAction, "subsystem">;

const activeRunStatuses = new Set(["preparing", "running", "artifact-submitted", "evaluating"]);
const pendingDispatchStatuses = new Set(["planned", "launched", "claimed"]);

function normalizeActions(
  subsystem: PlatformOpsSubsystemId,
  actions: Array<Omit<PlatformOpsAction, "subsystem">>
): PlatformOpsAction[] {
  return actions.map((action) => ({
    ...action,
    id: `${subsystem}:${action.id}`,
    subsystem
  }));
}

function priorityRank(priority: PlatformOpsAction["priority"]): number {
  if (priority === "high") return 0;
  if (priority === "medium") return 1;
  return 2;
}

function reportStatus(input: {
  subsystems: PlatformOpsReport["subsystems"];
  actions: PlatformOpsAction[];
  totals: PlatformOpsReport["totals"];
}): PlatformOpsReport["status"] {
  if (input.subsystems.some((subsystem) => subsystem.status === "attention")) return "needs-attention";
  if (input.actions.some((action) => action.priority === "high" || action.priority === "medium")) return "action-ready";
  if (input.totals.activeRuns > 0 || input.totals.liveBroadcasts > 0 || input.totals.pendingDispatches > 0) return "running";
  if (input.totals.scoreboardRows > 0) return "ready-to-share";
  return "idle";
}

function steamSourceStatus(input: {
  activeTasks: number;
  candidateTasks: number;
  discoveredApps: number;
  shortlistedApps: number;
  queuedSourceActions?: number;
}): PlatformOpsSubsystemStatus {
  if (input.candidateTasks > 0 || input.shortlistedApps > 0 || (input.queuedSourceActions ?? 0) > 0) return "ready";
  if (input.discoveredApps > 0 || input.activeTasks > 0) return "ready";
  return "idle";
}

function taskReviewStatus(catalog: ReturnType<typeof buildTaskReviewCatalog>): PlatformOpsSubsystemStatus {
  if (catalog.totals.blocked > 0) return "attention";
  if (catalog.totals.candidates > 0 || catalog.totals.reviewRequired > 0) return "ready";
  if (catalog.totals.rankedReady > 0) return "ready";
  return "idle";
}

function benchmarkBlueprintStatus(blueprints: BenchmarkBlueprint[]): PlatformOpsSubsystemStatus {
  if (blueprints.some((blueprint) =>
    blueprint.runtimePlan.targetArtifactName !== "output.mp4" ||
    !blueprint.runtimePlan.stage2StartConstraints.some((entry) => entry.includes("Do not call session.run_file"))
  )) return "attention";
  if (blueprints.some((blueprint) => blueprint.status === "review-required" || blueprint.status === "import-ready" || blueprint.status === "ranked-ready")) return "ready";
  if (blueprints.length > 0) return "idle";
  return "idle";
}

function buildBenchmarkBlueprintsForOps(input: {
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
  generatedAt?: string;
}): BenchmarkBlueprint[] {
  const appids = new Set<number>();
  gameCatalog.forEach((game) => appids.add(game.appid));
  input.snapshot.steamAppDiscoveries
    .filter((entry) => entry.status !== "rejected")
    .forEach((entry) => appids.add(entry.appid));
  input.tasks.forEach((task) => appids.add(task.appid));
  input.snapshot.taskRegistry.forEach((entry) => appids.add(entry.appid));

  return [...appids]
    .map((appid) => {
      const discovery = input.snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
      const task = input.tasks.find((entry) => entry.appid === appid);
      const registryTask = input.snapshot.taskRegistry.find((entry) => entry.appid === appid);
      const game = gameCatalog.find((entry) => entry.appid === appid) ?? inferGameCatalogEntry({
        appid,
        name: discovery?.name ?? task?.gameName ?? registryTask?.gameName,
        benchmarkFit: discovery?.benchmarkFit,
        harnessRisk: discovery?.harnessRisk
      });
      return buildBenchmarkBlueprint({
        game,
        tasks: input.tasks,
        taskRegistry: input.snapshot.taskRegistry,
        discovery,
        generatedAt: input.generatedAt
      });
    })
    .sort((a, b) => benchmarkBlueprintRank(a) - benchmarkBlueprintRank(b));
}

function benchmarkBlueprintRank(blueprint: BenchmarkBlueprint): number {
  const statusRank: Record<BenchmarkBlueprint["status"], number> = {
    "review-required": 0,
    "import-ready": 1,
    "needs-steam-data": 2,
    "ranked-ready": 3
  };
  return statusRank[blueprint.status] * 1_000_000
    - blueprint.readinessScore * 1_000
    - blueprint.importPlan.availableAchievementTasks * 10
    + blueprint.appid / 1_000_000;
}

function gameCompetitionStatus(report?: GameCompetitionOpsReport): PlatformOpsSubsystemStatus {
  if (!report) return "idle";
  if (report.status === "blocked") return "attention";
  if (report.status === "needs-coverage" || report.status === "needs-publication" || report.status === "ready-to-race") return "ready";
  return "idle";
}

function buildGameCompetitionReports(input: {
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
  suites: BenchmarkSuite[];
  scope: SeasonScope;
  limit: number;
  generatedAt?: string;
}): GameCompetitionOpsReport[] {
  const selectedHuman = input.snapshot.users.find((user) => user.type === "human" && user.linkedSteamId && user.proofConsentAt)
    ?? input.snapshot.users.find((user) => user.type === "human");
  const selectedAgent = input.snapshot.agents.find((agent) => agent.status === "active")
    ?? input.snapshot.agents[0];
  const appids = new Set<number>();
  input.tasks.forEach((task) => appids.add(task.appid));
  input.snapshot.taskRegistry.forEach((entry) => appids.add(entry.appid));
  input.snapshot.steamAppDiscoveries
    .filter((entry) => entry.status !== "rejected")
    .forEach((entry) => appids.add(entry.appid));

  return [...appids]
    .map((appid) => {
      const discovery = input.snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
      const task = input.tasks.find((entry) => entry.appid === appid);
      const registryTask = input.snapshot.taskRegistry.find((entry) => entry.appid === appid);
      const game = gameCatalog.find((entry) => entry.appid === appid) ?? inferGameCatalogEntry({
        appid,
        name: discovery?.name ?? task?.gameName ?? registryTask?.gameName,
        benchmarkFit: discovery?.benchmarkFit,
        harnessRisk: discovery?.harnessRisk
      });
      const standings = buildGameCompetitionStandings({
        game,
        tasks: input.tasks,
        taskRegistry: input.snapshot.taskRegistry,
        scoreboard: input.snapshot.scoreboard,
        scope: input.scope,
        generatedAt: input.generatedAt
      });
      const coveragePlan = buildGameCoveragePlan({
        game,
        snapshot: input.snapshot,
        tasks: input.tasks,
        taskRegistry: input.snapshot.taskRegistry,
        human: selectedHuman,
        agent: selectedAgent,
        limit: input.limit,
        generatedAt: input.generatedAt
      });
      return buildGameCompetitionOpsReport({
        game,
        standings,
        coveragePlan,
        suites: input.suites.filter((suite) => suite.appid === appid),
        coverageRuns: input.snapshot.gameCoverageRuns.filter((run) => run.appid === appid),
        selectedHumanId: selectedHuman?.id,
        selectedAgentId: selectedAgent?.id,
        generatedAt: input.generatedAt
      });
    })
    .sort((a, b) => gameCompetitionRank(a) - gameCompetitionRank(b));
}

function gameCompetitionRank(report: GameCompetitionOpsReport): number {
  const statusRank: Record<GameCompetitionOpsReport["status"], number> = {
    blocked: 0,
    "needs-coverage": 1,
    "needs-publication": 2,
    "ready-to-race": 3
  };
  return statusRank[report.status] * 1_000_000
    - report.totals.candidateTasks * 10_000
    - (report.totals.humanGaps + report.totals.agentGaps) * 1_000
    - (report.totals.readyHumanActions + report.totals.readyAgentActions) * 100
    - report.totals.scoreboardRows * 10
    - report.game.benchmarkFit;
}

function steamSourceActions(snapshot: StoreSnapshot, sourceQueue?: SteamSourceQueue): SourceAction[] {
  const candidate = snapshot.taskRegistry.find((entry) => entry.status === "candidate");
  if (candidate) {
    return [{
      id: "publish-candidates",
      label: "Publish task candidates",
      priority: "high",
      method: "POST",
      endpoint: `/api/steam/apps/${candidate.appid}/publish-candidates`,
      body: { reviewApproved: false },
      reason: `${candidate.gameName} has imported benchmark task candidates waiting for publication review.`
    }];
  }

  if ((sourceQueue?.recommendedActions.length ?? 0) > 0) {
    const nextAction = sourceQueue?.recommendedActions[0];
    return [{
      id: "run-source-queue-next",
      label: "Run next Steam source queue action",
      priority: sourceQueue?.totals.readyToPublish ? "high" : "medium",
      method: "CLI",
      command: "npm run steam:source-queue -- --fixture=true --execute=next --review-notes=\"platform source queue\"",
      reason: nextAction
        ? `${nextAction.gameName} is next in the Steam source queue: ${nextAction.reason}`
        : "Run the next cross-app Steam source queue recommendation."
    }];
  }

  const shortlisted = snapshot.steamAppDiscoveries.find((entry) => entry.status === "shortlisted");
  if (shortlisted) {
    return [{
      id: "inspect-app-onboarding",
      label: "Inspect app onboarding",
      priority: "medium",
      method: "GET",
      endpoint: `/api/steam/apps/${shortlisted.appid}/onboarding`,
      reason: `${shortlisted.name} is shortlisted and can move through task-source onboarding.`
    }];
  }

  return [{
    id: "inspect-steam-discovery",
    label: "Inspect Steam discovery",
    priority: "low",
    method: "GET",
    endpoint: "/api/steam/apps/discovery",
    reason: "Review discovered Steam app candidates and shortlist the next benchmark source."
  }];
}

function humanStatus(status: ReturnType<typeof buildHumanOnboardingOpsReport>["status"]): PlatformOpsSubsystemStatus {
  if (status === "needs-human-onboarding") return "attention";
  if (status === "ready-to-register" || status === "event-covered") return "ready";
  return "idle";
}

function humanProofStatus(status: ReturnType<typeof buildHumanProofOpsReport>["status"]): PlatformOpsSubsystemStatus {
  if (status === "needs-human-onboarding") return "attention";
  if (status === "ready-to-submit" || status === "scoreboard-covered") return "ready";
  return "idle";
}

function humanAgentComparisonStatus(status: ReturnType<typeof buildHumanAgentComparisonOpsReport>["status"]): PlatformOpsSubsystemStatus {
  if (status === "needs-attention") return "attention";
  if (status === "needs-human-runs" || status === "needs-agent-runs" || status === "ready-to-share") return "ready";
  return "idle";
}

function agentStatus(status: ReturnType<typeof buildAgentOpsReport>["status"]): PlatformOpsSubsystemStatus {
  if (status === "needs-attention") return "attention";
  if (status === "needs-dispatch") return "running";
  if (status === "ready-for-campaign") return "ready";
  return "idle";
}

function actionSpaceStatus(catalog: ReturnType<typeof buildRuntimeActionSpaceCatalog>): PlatformOpsSubsystemStatus {
  if (catalog.totals.bridgeableTasks > 0 || catalog.totals.virtualControllerTasks > 0 || catalog.totals.tasks > 0) return "ready";
  return "idle";
}

function agentTraceStatus(status: ReturnType<typeof buildAgentTraceOpsReport>["status"]): PlatformOpsSubsystemStatus {
  if (status === "needs-attention") return "attention";
  if (status === "needs-runtime" || status === "ready") return "ready";
  return "idle";
}

function scoreboardStatus(status: ReturnType<typeof buildScoreboardOpsReport>["status"]): PlatformOpsSubsystemStatus {
  if (status === "needs-attention") return "attention";
  if (status === "building") return "running";
  if (status === "needs-publication" || status === "ready-to-share") return "ready";
  return "idle";
}

function broadcastStatus(status: ReturnType<typeof buildBroadcastOpsReport>["status"]): PlatformOpsSubsystemStatus {
  if (status === "needs-attention") return "attention";
  if (status === "monitoring") return "running";
  if (status === "ready-to-share") return "ready";
  return "idle";
}

function dispatchStatus(input: { pendingDispatches: number; failedDispatches: number }): PlatformOpsSubsystemStatus {
  if (input.failedDispatches > 0) return "attention";
  if (input.pendingDispatches > 0) return "ready";
  return "idle";
}

function controlBridgeStatus(status: ReturnType<typeof buildControlBridgeOpsReport>["status"]): PlatformOpsSubsystemStatus {
  if (status === "needs-attention") return "attention";
  if (status === "needs-executor-report" || status === "ready-for-bridge") return "ready";
  return "idle";
}

function challengeStatus(status: ReturnType<typeof buildChallengeOpsReport>["status"]): PlatformOpsSubsystemStatus {
  if (status === "needs-attention") return "attention";
  if (status === "needs-acceptance" || status === "needs-execution" || status === "ready-to-share") return "ready";
  return "idle";
}

function matchArenaStatus(status: ReturnType<typeof buildMatchArenaOpsReport>["status"]): PlatformOpsSubsystemStatus {
  if (status === "needs-attention") return "attention";
  if (status === "needs-execution" || status === "ready-to-share") return "ready";
  return "idle";
}

function eventStatus(input: { registeredHumans: number; registeredAgents: number; registeredPairs: number }): PlatformOpsSubsystemStatus {
  if (input.registeredPairs > 0) return "ready";
  if (input.registeredHumans > 0 || input.registeredAgents > 0) return "attention";
  return "idle";
}

export function buildPlatformOpsReport(input: {
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
  suites?: BenchmarkSuite[];
  eventEvidence?: CompetitionEventEvidenceBundleSummary;
  steamSourceQueue?: SteamSourceQueue;
  scope?: SeasonScope;
  limit?: number;
  generatedAt?: string;
}): PlatformOpsReport {
  const scope = input.scope ?? "all";
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
  const activeTasks = input.tasks.length;
  const candidateTasks = input.snapshot.taskRegistry.filter((entry) => entry.status === "candidate").length;
  const rejectedTasks = input.snapshot.taskRegistry.filter((entry) => entry.status === "rejected").length;
  const discoveredApps = input.snapshot.steamAppDiscoveries.filter((entry) => entry.status !== "rejected").length;
  const shortlistedApps = input.snapshot.steamAppDiscoveries.filter((entry) => entry.status === "shortlisted").length;
  const queuedSourceApps = input.steamSourceQueue?.totals.apps ?? 0;
  const sourceQueueNewImports = input.steamSourceQueue?.totals.newImportsAvailable ?? 0;
  const sourceQueuePublishableCandidates = input.steamSourceQueue?.totals.publishableCandidates ?? 0;
  const sourceQueueActions = input.steamSourceQueue?.recommendedActions.length ?? 0;
  const sourceQueueAchievementRecords = input.steamSourceQueue?.totals.achievementRecords ?? 0;
  const sourceQueueStatRecords = input.steamSourceQueue?.totals.statRecords ?? 0;
  const sourceQueueLeaderboardRecords = input.steamSourceQueue?.totals.leaderboardRecords ?? 0;
  const sourceQueueAchievementImports = input.steamSourceQueue?.totals.achievementImportsAvailable ?? 0;
  const sourceQueueStatImports = input.steamSourceQueue?.totals.statImportsAvailable ?? 0;
  const sourceQueueLeaderboardImports = input.steamSourceQueue?.totals.leaderboardImportsAvailable ?? 0;
  const topSourceQueueItem = input.steamSourceQueue?.items[0];
  const activeRuns = input.snapshot.runs.filter((run) => activeRunStatuses.has(run.status)).length;
  const queuedRuns = input.snapshot.runs.filter((run) => run.status === "queued").length;
  const scoredRuns = input.snapshot.runs.filter((run) => run.status === "scored").length;
  const pendingDispatches = input.snapshot.dispatches.filter((dispatch) => pendingDispatchStatuses.has(dispatch.status)).length;
  const failedDispatches = input.snapshot.dispatches.filter((dispatch) => dispatch.status === "failed").length;
  const taskReviewCatalog = buildTaskReviewCatalog({
    tasks: input.tasks,
    taskRegistry: input.snapshot.taskRegistry,
    generatedAt: input.generatedAt
  });
  const benchmarkBlueprints = buildBenchmarkBlueprintsForOps({
    snapshot: input.snapshot,
    tasks: input.tasks,
    generatedAt: input.generatedAt
  });
  const focusedBlueprint = benchmarkBlueprints[0];
  const gameCompetitionReports = buildGameCompetitionReports({
    snapshot: input.snapshot,
    tasks: input.tasks,
    suites: input.suites ?? [],
    scope,
    limit,
    generatedAt: input.generatedAt
  });
  const focusedGameCompetition = gameCompetitionReports[0];
  const activeMatches = input.snapshot.matches.filter((match) => match.status === "scheduled" || match.status === "running").length;
  const scoredMatches = input.snapshot.matches.filter((match) => match.status === "scored").length;
  const scopedRegistrations = input.snapshot.eventRegistrations.filter((registration) => registration.eventScope === scope && registration.status === "registered");
  const registeredHumans = scopedRegistrations.filter((registration) => registration.participantType === "human").length;
  const registeredAgents = scopedRegistrations.filter((registration) => registration.participantType === "agent").length;
  const registeredAgentIds = new Set(scopedRegistrations.filter((registration) => registration.participantType === "agent").map((registration) => registration.participantId));
  const nextRegistrableAgent = input.snapshot.agents.find((agent) => agent.status === "active" && !registeredAgentIds.has(agent.id));
  const registeredPairs = registeredHumans * registeredAgents;
  const eventSuiteRaces = input.snapshot.suiteRaces.filter((race) => race.eventScope === scope);
  const scheduledRaces = eventSuiteRaces.length;
  const scoredEventRaces = eventSuiteRaces.filter((race) => race.status === "scored").length;
  const unscoredEventRaces = eventSuiteRaces.filter((race) => race.status !== "scored");
  const unscoredRaces = unscoredEventRaces.length;
  const unscheduledPairs = Math.max(0, registeredPairs - scheduledRaces);
  const campaignComparisons = input.eventEvidence?.campaignComparisonCount ?? 0;
  const readyCampaignComparisons = input.eventEvidence?.campaignComparisonReadyCount ?? 0;
  const unreadyCampaignComparisons = Math.max(0, campaignComparisons - readyCampaignComparisons);
  const eventReadyForPublicShare = Boolean(
    input.eventEvidence &&
    input.eventEvidence.checklistTotal > 0 &&
    input.eventEvidence.checklistPasses === input.eventEvidence.checklistTotal &&
    (input.eventEvidence.allScheduledRacesScored || input.eventEvidence.allCampaignComparisonsReady)
  );
  const selectedSuite = input.suites?.find((suite) => suite.status === "ranked-ready")
    ?? input.suites?.find((suite) => suite.status === "controlled")
    ?? input.suites?.find((suite) => suite.taskCount > 0);
  const suiteIdToRun = unscoredEventRaces[0]?.suiteId ?? selectedSuite?.id;
  const humanOps = buildHumanOnboardingOpsReport({ snapshot: input.snapshot, scope, limit, generatedAt: input.generatedAt });
  const humanProofOps = buildHumanProofOpsReport({
    snapshot: input.snapshot,
    tasks: input.tasks,
    limit,
    userLimit: limit,
    generatedAt: input.generatedAt
  });
  const humanAgentComparisonOps = buildHumanAgentComparisonOpsReport({
    snapshot: input.snapshot,
    tasks: input.tasks,
    limit,
    generatedAt: input.generatedAt
  });
  const agentOps = buildAgentOpsReport({ agents: input.snapshot.agents, snapshot: input.snapshot, tasks: input.tasks, limit, generatedAt: input.generatedAt });
  const selectedActionSpaceAgent = input.snapshot.agents.find((agent) => agent.status === "active" && agent.capabilities.includes("controller"))
    ?? input.snapshot.agents.find((agent) => agent.status === "active");
  const actionSpaceCatalog = buildRuntimeActionSpaceCatalog({
    tasks: input.tasks,
    agents: input.snapshot.agents,
    agentId: selectedActionSpaceAgent?.id,
    limit,
    generatedAt: input.generatedAt
  });
  const agentTraceOps = buildAgentTraceOpsReport({
    runs: input.snapshot.runs,
    tasks: input.tasks,
    events: input.snapshot.events,
    controlSessions: input.snapshot.controlSessions,
    limit,
    generatedAt: input.generatedAt
  });
  const controlBridgeOps = buildControlBridgeOpsReport({
    sessions: input.snapshot.controlSessions,
    runs: input.snapshot.runs,
    tasks: input.tasks,
    agents: input.snapshot.agents,
    events: input.snapshot.events,
    limit,
    generatedAt: input.generatedAt
  });
  const scoreboardOps = buildScoreboardOpsReport({ snapshot: input.snapshot, tasks: input.tasks, limit, generatedAt: input.generatedAt });
  const broadcastCenter = buildBroadcastCenter({ snapshot: input.snapshot, tasks: input.tasks, limit, generatedAt: input.generatedAt });
  const broadcastOps = buildBroadcastOpsReport({ rows: broadcastCenter.recent, limit, generatedAt: input.generatedAt });
  const challengeOps = buildChallengeOpsReport({
    snapshot: input.snapshot,
    tasks: input.tasks,
    limit,
    generatedAt: input.generatedAt
  });
  const matchArenaOps = buildMatchArenaOpsReport({
    matches: input.snapshot.matches,
    tasks: input.tasks,
    users: input.snapshot.users,
    agents: input.snapshot.agents,
    runs: input.snapshot.runs,
    scoreboard: input.snapshot.scoreboard,
    limit,
    generatedAt: input.generatedAt
  });

  const totals: PlatformOpsReport["totals"] = {
    tasks: activeTasks + input.snapshot.taskRegistry.length,
    activeTasks,
    candidateTasks,
    rejectedTasks,
    rankedReadyTasks: taskReviewCatalog.totals.rankedReady,
    reviewRequiredTasks: taskReviewCatalog.totals.reviewRequired,
    publicRankBlockedTasks: taskReviewCatalog.totals.blocked,
    blueprintGames: benchmarkBlueprints.length,
    blueprintRankedReady: benchmarkBlueprints.filter((blueprint) => blueprint.status === "ranked-ready").length,
    blueprintImportReady: benchmarkBlueprints.filter((blueprint) => blueprint.status === "import-ready").length,
    blueprintReviewRequired: benchmarkBlueprints.filter((blueprint) => blueprint.status === "review-required").length,
    blueprintNeedsSteamData: benchmarkBlueprints.filter((blueprint) => blueprint.status === "needs-steam-data").length,
    blueprintOutputMp4Contracts: benchmarkBlueprints.filter((blueprint) => blueprint.runtimePlan.targetArtifactName === "output.mp4").length,
    blueprintStage2Contracts: benchmarkBlueprints.filter((blueprint) =>
      blueprint.runtimePlan.stage2StartConstraints.some((entry) => entry.includes("Do not call session.run_file"))
    ).length,
    competitionGames: gameCompetitionReports.length,
    competitionCoverageGaps: gameCompetitionReports.reduce((sum, report) => sum + report.totals.humanGaps + report.totals.agentGaps, 0),
    competitionReadyActions: gameCompetitionReports.reduce((sum, report) => sum + report.totals.readyHumanActions + report.totals.readyAgentActions, 0),
    competitionShareReadyGames: gameCompetitionReports.filter((report) => report.totals.publicShareReady).length,
    discoveredApps,
    shortlistedApps,
    humans: input.snapshot.users.filter((user) => user.type === "human").length,
    steamLinkedHumans: input.snapshot.users.filter((user) => user.type === "human" && user.linkedSteamId).length,
    consentedHumans: input.snapshot.users.filter((user) => user.type === "human" && user.proofConsentAt).length,
    humanProofReadyTickets: humanProofOps.totals.readyTickets,
    humanProofReadyTasks: humanProofOps.totals.readyTasks,
    humanProofConsentRequired: humanProofOps.totals.consentRequired,
    humanProofSteamNotLinked: humanProofOps.totals.steamNotLinked,
    humanAgentComparisons: humanAgentComparisonOps.standings.totals.comparisons,
    humanAgentCompleteComparisons: humanAgentComparisonOps.standings.totals.completeComparisons,
    humanAgentIncompleteComparisons: humanAgentComparisonOps.standings.totals.incompleteComparisons,
    humanAgentShareReadyComparisons: humanAgentComparisonOps.standings.totals.readyForPublicShare,
    humanAgentHumanMissingTasks: humanAgentComparisonOps.standings.totals.humanMissing,
    humanAgentAgentMissingTasks: humanAgentComparisonOps.standings.totals.agentMissing,
    agents: input.snapshot.agents.length,
    activeAgents: input.snapshot.agents.filter((agent) => agent.status === "active").length,
    controllerTasks: actionSpaceCatalog.totals.controllerTasks,
    virtualControllerTasks: actionSpaceCatalog.totals.virtualControllerTasks,
    bridgeableTasks: actionSpaceCatalog.totals.bridgeableTasks,
    runs: input.snapshot.runs.length,
    queuedRuns,
    activeRuns,
    scoredRuns,
    dispatches: input.snapshot.dispatches.length,
    pendingDispatches,
    activeControlSessions: input.snapshot.controlSessions.filter((session) => session.status === "active").length,
    agentTraceReady: agentTraceOps.totals.traceReady,
    agentTraceNeedsRuntime: agentTraceOps.totals.needsActions + agentTraceOps.totals.needsControlSession + agentTraceOps.totals.needsExecutorReport,
    controlBridgeReady: controlBridgeOps.totals.readyForBridge + controlBridgeOps.totals.executorValidated,
    controlBridgeNeedsExecutorReport: controlBridgeOps.totals.needsExecutorReport,
    challenges: input.snapshot.challenges.length,
    openChallenges: challengeOps.totals.open,
    acceptedChallenges: challengeOps.totals.accepted + challengeOps.totals.running,
    shareReadyChallenges: challengeOps.totals.scoreboardReady,
    matches: input.snapshot.matches.length,
    activeMatches,
    scoredMatches,
    broadcasts: input.snapshot.streams.length,
    liveBroadcasts: input.snapshot.streams.filter((stream) => stream.status === "live").length,
    scoreboardRows: input.snapshot.scoreboard.length,
    eventRegisteredHumans: registeredHumans,
    eventRegisteredAgents: registeredAgents
  };

  const subsystems: PlatformOpsReport["subsystems"] = [
    {
      id: "steam-sources",
      label: "Steam sources",
      status: steamSourceStatus({ activeTasks, candidateTasks, discoveredApps, shortlistedApps, queuedSourceActions: sourceQueueActions }),
      summary: `${activeTasks} active task(s), ${candidateTasks} candidate task(s), ${shortlistedApps} shortlisted app(s), ${sourceQueueActions} source queue action(s).`,
      metrics: {
        activeTasks,
        candidateTasks,
        rejectedTasks,
        discoveredApps,
        shortlistedApps,
        queuedSourceApps,
        sourceQueueNewImports,
        sourceQueuePublishableCandidates,
        sourceQueueAchievementRecords,
        sourceQueueStatRecords,
        sourceQueueLeaderboardRecords,
        sourceQueueAchievementImports,
        sourceQueueStatImports,
        sourceQueueLeaderboardImports,
        sourceQueueTopAppid: topSourceQueueItem?.appid ?? 0,
        sourceQueueTopGame: topSourceQueueItem?.gameName ?? "",
        sourceQueueTopMissingTracks: topSourceQueueItem?.registryTracks.missingCandidates ?? [],
        sourceQueueActions
      },
      links: {
        discovery: "/api/steam/apps/discovery",
        taskSourceOps: "/api/steam/apps/:appid/task-source-ops",
        sourceQueue: "/api/steam/source-queue"
      }
    },
    {
      id: "task-review",
      label: "Task review",
      status: taskReviewStatus(taskReviewCatalog),
      summary: `${taskReviewCatalog.totals.rankedReady} ranked-ready task(s), ${taskReviewCatalog.totals.reviewRequired} need review, ${taskReviewCatalog.totals.blocked} blocked, ${taskReviewCatalog.totals.candidates} candidate(s).`,
      metrics: {
        ...taskReviewCatalog.totals,
        controlled: taskReviewCatalog.fairness.controlled,
        exclude: taskReviewCatalog.fairness.exclude,
        topRisk: taskReviewCatalog.risks[0]?.flag ?? ""
      },
      links: {
        reviewCatalog: `/api/tasks/review-catalog?limit=${limit}`,
        reviewRequired: `/api/tasks/review-catalog?decision=review-required&limit=${limit}`,
        blocked: `/api/tasks/review-catalog?decision=reject&limit=${limit}`
      }
    },
    {
      id: "benchmark-blueprints",
      label: "Benchmark blueprints",
      status: benchmarkBlueprintStatus(benchmarkBlueprints),
      summary: focusedBlueprint
        ? `${focusedBlueprint.game.name} blueprint focus: ${focusedBlueprint.status}, readiness ${focusedBlueprint.readinessScore}, ${focusedBlueprint.reviewPlan.rankedReadyTasks} ranked-ready task(s), ${focusedBlueprint.reviewPlan.reviewRequiredTasks} review-required task(s).`
        : "No benchmark blueprints are available yet.",
      metrics: focusedBlueprint
        ? {
            blueprintGames: benchmarkBlueprints.length,
            focusedAppid: focusedBlueprint.appid,
            focusedGame: focusedBlueprint.game.name,
            focusedStatus: focusedBlueprint.status,
            focusedReadinessScore: focusedBlueprint.readinessScore,
            rankedReady: totals.blueprintRankedReady,
            importReady: totals.blueprintImportReady,
            reviewRequired: totals.blueprintReviewRequired,
            needsSteamData: totals.blueprintNeedsSteamData,
            focusedCanImportNow: focusedBlueprint.importPlan.canImportNow,
            focusedAvailableAchievementTasks: focusedBlueprint.importPlan.availableAchievementTasks,
            focusedImportedAchievementTasks: focusedBlueprint.importPlan.importedAchievementTasks,
            focusedSourceRecords: focusedBlueprint.sourcePlan.sourceRecords,
            focusedNewSourceImportsAvailable: focusedBlueprint.sourcePlan.newImportsAvailable,
            focusedSourceActiveTracks: focusedBlueprint.sourcePlan.activeTracks,
            focusedSourceCandidateTracks: focusedBlueprint.sourcePlan.candidateTracks,
            focusedSourceMissingCandidateTracks: focusedBlueprint.sourcePlan.missingCandidateTracks,
            focusedAchievementSourceRecords: focusedBlueprint.sourcePlan.achievement.records,
            focusedAchievementNewImports: focusedBlueprint.sourcePlan.achievement.newImports,
            focusedStatSourceRecords: focusedBlueprint.sourcePlan.stat.records,
            focusedStatProposals: focusedBlueprint.sourcePlan.stat.proposed,
            focusedStatNewProposals: focusedBlueprint.sourcePlan.stat.newProposals,
            focusedLeaderboardSourceRecords: focusedBlueprint.sourcePlan.leaderboard.records,
            focusedLeaderboardProposals: focusedBlueprint.sourcePlan.leaderboard.proposed,
            focusedLeaderboardNewProposals: focusedBlueprint.sourcePlan.leaderboard.newProposals,
            focusedSourceActions: focusedBlueprint.sourceActions.length,
            focusedSourceActionIds: focusedBlueprint.sourceActions.map((action) => action.id),
            focusedRankedReadyTasks: focusedBlueprint.reviewPlan.rankedReadyTasks,
            focusedReviewRequiredTasks: focusedBlueprint.reviewPlan.reviewRequiredTasks,
            focusedLadderGaps: focusedBlueprint.taskLadder.reduce((sum, band) => sum + band.gaps.length, 0),
            outputMp4Contracts: totals.blueprintOutputMp4Contracts,
            stage2StartContracts: totals.blueprintStage2Contracts
          }
        : {
            blueprintGames: 0,
            rankedReady: 0,
            importReady: 0,
            reviewRequired: 0,
            needsSteamData: 0,
            outputMp4Contracts: 0,
            stage2StartContracts: 0
          },
      links: focusedBlueprint
        ? {
            blueprint: `/api/games/${focusedBlueprint.appid}/benchmark-blueprint`,
            taskSourceOps: `/api/steam/apps/${focusedBlueprint.appid}/task-source-ops`,
            sourceQueue: "/api/steam/source-queue",
            blueprintOps: "npm run benchmark:blueprint-ops"
          }
        : {
            state: "/api/state",
            steamDiscovery: "/api/steam/apps/discovery",
            blueprintOps: "npm run benchmark:blueprint-ops"
          }
    },
    {
      id: "game-competition",
      label: "Game competition",
      status: gameCompetitionStatus(focusedGameCompetition),
      summary: focusedGameCompetition
        ? `${focusedGameCompetition.game.name} focus: ${focusedGameCompetition.totals.activeTasks} active task(s), ${focusedGameCompetition.totals.humanGaps} human gap(s), ${focusedGameCompetition.totals.agentGaps} agent gap(s), ${focusedGameCompetition.totals.readyHumanActions + focusedGameCompetition.totals.readyAgentActions} ready action(s).`
        : "No Steam games have active, candidate, or discovered competition coverage yet.",
      metrics: focusedGameCompetition
        ? {
            competitionGames: gameCompetitionReports.length,
            focusedAppid: focusedGameCompetition.appid,
            focusedGame: focusedGameCompetition.game.name,
            focusedStatus: focusedGameCompetition.status,
            activeTasks: focusedGameCompetition.totals.activeTasks,
            candidateTasks: focusedGameCompetition.totals.candidateTasks,
            scoredTasks: focusedGameCompetition.totals.scoredTasks,
            humanGaps: focusedGameCompetition.totals.humanGaps,
            agentGaps: focusedGameCompetition.totals.agentGaps,
            readyHumanActions: focusedGameCompetition.totals.readyHumanActions,
            readyAgentActions: focusedGameCompetition.totals.readyAgentActions,
            suites: focusedGameCompetition.totals.suites,
            rankedReadySuites: focusedGameCompetition.totals.rankedReadySuites,
            scoreboardRows: focusedGameCompetition.totals.scoreboardRows,
            publicShareReady: focusedGameCompetition.totals.publicShareReady,
            selectedSuite: focusedGameCompetition.selectedSuite?.id ?? ""
          }
        : {
            competitionGames: 0,
            activeTasks: 0,
            humanGaps: 0,
            agentGaps: 0,
            readyHumanActions: 0,
            readyAgentActions: 0,
            publicShareReady: false
          },
      links: focusedGameCompetition
        ? {
            opsReport: `/api/games/${focusedGameCompetition.appid}/competition/ops-report?season=${scope}&limit=${limit}`,
            coveragePlan: focusedGameCompetition.links.coveragePlan,
            runCompetitionLocal: focusedGameCompetition.links.runCompetitionLocal,
            resultCertificate: focusedGameCompetition.links.resultCertificate
          }
        : {
            steamDiscovery: "/api/steam/apps/discovery",
            sourceQueue: "/api/steam/source-queue"
          }
    },
    {
      id: "human-onboarding",
      label: "Human onboarding",
      status: humanStatus(humanOps.status),
      summary: `${humanOps.totals.linked}/${humanOps.totals.humans} human(s) Steam-linked, ${humanOps.totals.readyForRegistration} ready for ${scope} registration.`,
      metrics: { ...humanOps.totals },
      links: {
        opsReport: `/api/human-onboarding/ops-report?scope=${scope}&limit=${limit}`,
        proofOps: "/api/human-proof/ops-report"
      }
    },
    {
      id: "human-proof",
      label: "Human proof",
      status: humanProofStatus(humanProofOps.status),
      summary: `${humanProofOps.totals.readyTickets} proof-ready human ticket(s), ${humanProofOps.totals.readyTasks} ready task(s), ${humanProofOps.totals.consentRequired} consent gap(s), ${humanProofOps.totals.steamNotLinked} Steam-link gap(s).`,
      metrics: { ...humanProofOps.totals },
      links: {
        opsReport: `/api/human-proof/ops-report?limit=${limit}&userLimit=${limit}`,
        users: "/api/users",
        proofReview: "/api/proofs/review"
      }
    },
    {
      id: "human-agent-comparisons",
      label: "Human-agent comparisons",
      status: humanAgentComparisonStatus(humanAgentComparisonOps.status),
      summary: `${humanAgentComparisonOps.standings.totals.comparisons} campaign comparison(s), ${humanAgentComparisonOps.standings.totals.incompleteComparisons} incomplete, ${humanAgentComparisonOps.standings.totals.readyForPublicShare} share-ready.`,
      metrics: { ...humanAgentComparisonOps.standings.totals },
      links: {
        opsReport: `/api/comparisons/human-agent/ops-report?limit=${limit}`,
        standings: "/api/comparisons/human-agent/standings",
        comparisons: "/api/comparisons/human-agent"
      }
    },
    {
      id: "agent-runtime",
      label: "Agent runtime",
      status: agentStatus(agentOps.status),
      summary: `${agentOps.totals.active} active agent(s), ${agentOps.totals.readyForCampaign} campaign-ready, ${agentOps.totals.queuedRuns} queued run(s).`,
      metrics: { ...agentOps.totals },
      links: {
        opsReport: `/api/agents/ops-report?limit=${limit}`,
        actionSpaces: "/api/runtime/action-spaces"
      }
    },
    {
      id: "action-spaces",
      label: "Action spaces",
      status: actionSpaceStatus(actionSpaceCatalog),
      summary: `${actionSpaceCatalog.totals.tasks} task action space(s), ${actionSpaceCatalog.totals.controllerTasks} controller, ${actionSpaceCatalog.totals.virtualControllerTasks} virtual-controller, ${actionSpaceCatalog.totals.bridgeableTasks} bridgeable, ${actionSpaceCatalog.totals.readyForSelectedAgent} ready for selected agent.`,
      metrics: {
        ...actionSpaceCatalog.totals,
        selectedAgentId: selectedActionSpaceAgent?.id ?? "",
        selectedAgentHandle: selectedActionSpaceAgent?.handle ?? ""
      },
      links: {
        catalog: selectedActionSpaceAgent
          ? `/api/runtime/action-spaces?agentId=${encodeURIComponent(selectedActionSpaceAgent.id)}&limit=${limit}`
          : `/api/runtime/action-spaces?limit=${limit}`,
        virtualController: selectedActionSpaceAgent
          ? `/api/runtime/action-spaces?agentId=${encodeURIComponent(selectedActionSpaceAgent.id)}&inputMode=controller&transport=virtual-controller&limit=${limit}`
          : `/api/runtime/action-spaces?inputMode=controller&transport=virtual-controller&limit=${limit}`,
        bridgeOps: "/api/control-sessions/ops-report?transport=virtual-controller"
      }
    },
    {
      id: "runtime-dispatch",
      label: "Runtime dispatch",
      status: dispatchStatus({ pendingDispatches, failedDispatches }),
      summary: `${pendingDispatches} pending dispatch ticket(s), ${failedDispatches} failed dispatch ticket(s).`,
      metrics: {
        dispatches: input.snapshot.dispatches.length,
        pendingDispatches,
        failedDispatches,
        activeControlSessions: totals.activeControlSessions
      },
      links: {
        opsReport: "/api/dispatches/ops-report",
        workerQueue: "/api/worker/queue",
        bridgeOps: "/api/control-sessions/ops-report"
      }
    },
    {
      id: "agent-traces",
      label: "Agent traces",
      status: agentTraceStatus(agentTraceOps.status),
      summary: `${agentTraceOps.totals.agentRuns} agent run(s), ${agentTraceOps.totals.needsControlSession} need control lease, ${agentTraceOps.totals.needsExecutorReport} need bridge executor report, ${agentTraceOps.totals.traceReady} trace-ready.`,
      metrics: { ...agentTraceOps.totals },
      links: {
        opsReport: `/api/agent-traces/ops-report?limit=${limit}`,
        handoffs: "/api/agent-traces/ops-report",
        bridgeOps: "/api/control-sessions/ops-report"
      }
    },
    {
      id: "control-bridge",
      label: "Control bridge",
      status: controlBridgeStatus(controlBridgeOps.status),
      summary: `${controlBridgeOps.totals.selectedSessions} control lease(s), ${controlBridgeOps.totals.readyForBridge} bridge-ready, ${controlBridgeOps.totals.needsExecutorReport} need executor report, ${controlBridgeOps.totals.executorValidated} executor-validated.`,
      metrics: { ...controlBridgeOps.totals },
      links: {
        opsReport: `/api/control-sessions/ops-report?limit=${limit}`,
        virtualController: `/api/control-sessions/ops-report?transport=virtual-controller&limit=${limit}`,
        bridgeRunner: "npm run bridge:control"
      }
    },
    {
      id: "challenges",
      label: "Challenges",
      status: challengeStatus(challengeOps.status),
      summary: `${challengeOps.totals.challenges} challenge(s), ${challengeOps.totals.open} open, ${challengeOps.totals.accepted + challengeOps.totals.running} need execution, ${challengeOps.totals.scoreboardReady} share-ready.`,
      metrics: { ...challengeOps.totals },
      links: {
        opsReport: `/api/challenges/ops-report?limit=${limit}`,
        challenges: "/api/challenges",
        standings: "/api/standings"
      }
    },
    {
      id: "match-arena",
      label: "Match arena",
      status: matchArenaStatus(matchArenaOps.status),
      summary: `${matchArenaOps.totals.matches} direct match(es), ${matchArenaOps.totals.needsStart} need start, ${matchArenaOps.totals.needsHumanProof} need human proof, ${matchArenaOps.totals.needsAgentEvidence} need agent evidence, ${matchArenaOps.totals.scoreboardReady} share-ready.`,
      metrics: { ...matchArenaOps.totals },
      links: {
        opsReport: `/api/matches/arena-ops-report?limit=${limit}`,
        matches: "/api/matches",
        matchFeed: "/api/matches/feed"
      }
    },
    {
      id: "scoreboard",
      label: "Scoreboard",
      status: scoreboardStatus(scoreboardOps.status),
      summary: `${scoreboardOps.totals.scoreboardRows} public row(s), ${scoreboardOps.totals.scoreboardMissing} scored run(s) missing rows, ${scoreboardOps.totals.proofMissing} proof gap(s).`,
      metrics: { ...scoreboardOps.totals },
      links: {
        opsReport: `/api/scoreboard/ops-report?limit=${limit}`,
        standings: "/api/standings",
        leaderboards: "/api/leaderboards"
      }
    },
    {
      id: "broadcasts",
      label: "Broadcasts",
      status: broadcastStatus(broadcastOps.status),
      summary: `${broadcastOps.totals.live} live, ${broadcastOps.totals.scoreboardReady} scoreboard-ready replay(s), ${broadcastOps.totals.viewers} viewer(s).`,
      metrics: { ...broadcastOps.totals },
      links: {
        opsReport: `/api/broadcasts/ops-report?limit=${limit}`,
        center: "/api/broadcasts/center"
      }
    },
    {
      id: "events",
      label: "Competition events",
      status: eventStatus({ registeredHumans, registeredAgents, registeredPairs }),
      summary: `${registeredHumans} human and ${registeredAgents} agent registration(s) for ${scope}; ${registeredPairs} runnable pair(s), ${unscheduledPairs} unscheduled, ${unscoredRaces} unscored, ${unreadyCampaignComparisons} campaign comparison gap(s).`,
      metrics: {
        scope,
        registeredHumans,
        registeredAgents,
        registeredPairs,
        scheduledRaces,
        scoredEventRaces,
        unscoredRaces,
        unscheduledPairs,
        campaignComparisons,
        readyCampaignComparisons,
        unreadyCampaignComparisons,
        eventReadyForPublicShare
      },
      links: {
        registrations: "/api/competition-events/registrations",
        opsReport: `/api/competition-events/${scope}/ops-report`,
        resultCertificate: `/api/competition-events/${scope}/result-certificate`
      }
    }
  ];

  const dispatchActions: SourceAction[] = pendingDispatches > 0
    ? [{
        id: "drain-dispatches",
        label: "Drain runtime dispatches",
        priority: "high",
        method: "CLI",
        command: "npm run dispatch:ops -- --status=planned,launched --execute=drain-local-dispatches",
        reason: `${pendingDispatches} runtime dispatch ticket(s) are waiting for worker execution.`
      }]
    : [{
        id: "inspect-dispatch-ops",
        label: "Inspect dispatch ops",
        priority: "low",
        method: "GET",
        endpoint: "/api/dispatches/ops-report",
        reason: "Review local and Modal runtime dispatch health."
      }];

  const eventActions: SourceAction[] = [];
  if (registeredAgents === 0 && nextRegistrableAgent) {
    eventActions.push({
      id: "register-agent",
      label: "Register agent for event",
      priority: "high",
      method: "POST",
      endpoint: `/api/competition-events/${scope}/register`,
      body: {
        participantType: "agent",
        participantId: nextRegistrableAgent.id
      },
      reason: `${nextRegistrableAgent.handle} is active and can enter the ${scope} public benchmark event.`
    });
  }
  if (unscheduledPairs > 0 && selectedSuite) {
    eventActions.push({
      id: "schedule-suite",
      label: "Schedule suite races",
      priority: "high",
      method: "POST",
      endpoint: `/api/competition-events/${scope}/schedule-suite`,
      body: {
        suiteId: selectedSuite.id,
        reviewApproved: selectedSuite.status !== "ranked-ready",
        maxPairs: Math.min(100, Math.max(1, unscheduledPairs))
      },
      reason: `${unscheduledPairs} registered pair(s) can be scheduled on ${selectedSuite.title}.`
    });
  }
  if (unscoredRaces > 0) {
    eventActions.push({
      id: "run-suite-local",
      label: "Run scheduled suite races",
      priority: "high",
      method: "POST",
      endpoint: `/api/competition-events/${scope}/run-suite`,
      body: {
        suiteId: suiteIdToRun,
        maxRaces: Math.min(25, Math.max(1, unscoredRaces))
      },
      reason: `${unscoredRaces} scheduled ${scope} suite race(s) need local execution and scoring.`
    });
  }
  if (unreadyCampaignComparisons > 0) {
    eventActions.push({
      id: "run-campaign-comparisons-local",
      label: "Run campaign comparisons",
      priority: "medium",
      method: "POST",
      endpoint: `/api/competition-events/${scope}/run-campaign-comparisons-local`,
      body: {
        maxPairs: Math.min(25, Math.max(1, registeredPairs))
      },
      reason: `${unreadyCampaignComparisons} ${scope} human-agent campaign comparison(s) need complete evidence.`
    });
  }
  if (eventReadyForPublicShare) {
    eventActions.push({
      id: "inspect-event-certificate",
      label: "Inspect event certificate",
      priority: "low",
      method: "GET",
      endpoint: `/api/competition-events/${scope}/result-certificate`,
      reason: `The ${scope} event has a share-ready public result certificate.`
    });
  }
  eventActions.push(registeredPairs === 0
    ? {
        id: "inspect-event-registrations",
        label: "Inspect event registrations",
        priority: registeredHumans === 0 || registeredAgents === 0 ? "medium" : "low",
        method: "GET",
        endpoint: "/api/competition-events/registrations",
        reason: `The ${scope} event does not yet have both human and agent registrations.`
      }
    : {
        id: "inspect-event-ops",
        label: "Inspect event ops",
        priority: "low",
        method: "GET",
        endpoint: `/api/competition-events/${scope}/ops-report`,
        reason: `The ${scope} event has registered pairs ready for scheduling or execution review.`
      });

  const recommendedActions = [
    ...normalizeActions("steam-sources", steamSourceActions(input.snapshot, input.steamSourceQueue)),
    ...normalizeActions("task-review", [{
      id: taskReviewCatalog.totals.reviewRequired > 0 ? "inspect-review-required" : "inspect-review-catalog",
      label: taskReviewCatalog.totals.reviewRequired > 0 ? "Inspect review-required tasks" : "Inspect task review catalog",
      priority: taskReviewCatalog.totals.blocked > 0 || taskReviewCatalog.totals.reviewRequired > 0 ? "medium" : "low",
      method: "GET",
      endpoint: taskReviewCatalog.totals.reviewRequired > 0
        ? `/api/tasks/review-catalog?decision=review-required&limit=${limit}`
        : `/api/tasks/review-catalog?limit=${limit}`,
      reason: taskReviewCatalog.totals.reviewRequired > 0
        ? `${taskReviewCatalog.totals.reviewRequired} benchmark task(s) need review before public ranking.`
        : "Review benchmark suitability, fairness controls, and risk flags across the task catalog."
    }]),
    ...normalizeActions("benchmark-blueprints", focusedBlueprint
      ? [
          ...focusedBlueprint.sourceActions.map((action) => ({
            id: action.id,
            label: action.label,
            priority: action.priority,
            method: action.method,
            endpoint: action.endpoint,
            body: action.body,
            reason: `${focusedBlueprint.game.name}: ${action.reason}`
          })),
          {
            id: "inspect-focused-blueprint",
            label: "Inspect focused benchmark blueprint",
            priority: focusedBlueprint.status === "review-required" || focusedBlueprint.status === "import-ready" ? "medium" : "low",
            method: "GET",
            endpoint: `/api/games/${focusedBlueprint.appid}/benchmark-blueprint`,
            reason: `${focusedBlueprint.game.name} is the current blueprint focus with ${focusedBlueprint.status} readiness.`
          },
          {
            id: focusedBlueprint.status === "review-required"
              ? "inspect-review-required-blueprints"
              : focusedBlueprint.status === "import-ready"
                ? "inspect-import-ready-blueprints"
                : "inspect-blueprint-queue",
            label: focusedBlueprint.status === "review-required"
              ? "Inspect review-required blueprints"
              : focusedBlueprint.status === "import-ready"
                ? "Inspect import-ready blueprints"
                : "Inspect blueprint queue",
            priority: focusedBlueprint.status === "review-required" || focusedBlueprint.status === "import-ready" ? "medium" : "low",
            method: "CLI",
            command: `npm run benchmark:blueprint-ops -- --status=${focusedBlueprint.status} --limit=${Math.min(limit, 50)}`,
            reason: "Review the cross-game benchmark blueprint queue before importing, reviewing, or scheduling game coverage."
          }
        ]
      : [{
          id: "inspect-blueprint-queue",
          label: "Inspect blueprint queue",
          priority: "medium",
          method: "CLI",
          command: `npm run benchmark:blueprint-ops -- --status=all --limit=${Math.min(limit, 50)}`,
          reason: "Create or import Steam game data before benchmark blueprints can be ranked."
        }]),
    ...normalizeActions("game-competition", focusedGameCompetition?.recommendedActions.length
      ? focusedGameCompetition.recommendedActions
      : [{
          id: "inspect-game-competition",
          label: "Inspect game competition coverage",
          priority: focusedGameCompetition ? "low" : "medium",
          method: "GET",
          endpoint: focusedGameCompetition
            ? `/api/games/${focusedGameCompetition.appid}/competition/ops-report?season=${scope}&limit=${limit}`
            : "/api/steam/apps/discovery",
          reason: focusedGameCompetition
            ? `${focusedGameCompetition.game.name} is the current game competition focus.`
            : "Discover or import Steam apps before per-game competition coverage can be scheduled."
        }]),
    ...normalizeActions("human-onboarding", humanOps.recommendedActions),
    ...normalizeActions("human-proof", humanProofOps.recommendedActions),
    ...normalizeActions("human-agent-comparisons", humanAgentComparisonOps.recommendedActions),
    ...normalizeActions("agent-runtime", agentOps.recommendedActions),
    ...normalizeActions("action-spaces", actionSpaceCatalog.recommendedActions),
    ...normalizeActions("runtime-dispatch", dispatchActions),
    ...normalizeActions("agent-traces", agentTraceOps.recommendedActions),
    ...normalizeActions("control-bridge", controlBridgeOps.recommendedActions),
    ...normalizeActions("challenges", challengeOps.recommendedActions),
    ...normalizeActions("match-arena", matchArenaOps.recommendedActions),
    ...normalizeActions("scoreboard", scoreboardOps.recommendedActions),
    ...normalizeActions("broadcasts", broadcastOps.recommendedActions),
    ...normalizeActions("events", eventActions)
  ]
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.subsystem.localeCompare(b.subsystem))
    .slice(0, limit);

  return {
    schemaVersion: "steambench.platform-ops-report.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: reportStatus({ subsystems, actions: recommendedActions, totals }),
    filters: {
      scope,
      limit
    },
    totals,
    subsystems,
    recommendedActions,
    links: {
      state: "/api/state",
      taskReviewCatalog: "/api/tasks/review-catalog",
      benchmarkBlueprintOps: "/api/games/:appid/benchmark-blueprint",
      gameCompetitionOps: "/api/games/:appid/competition/ops-report",
      steamDiscovery: "/api/steam/apps/discovery",
      steamSourceQueue: "/api/steam/source-queue",
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
  };
}
