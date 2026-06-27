import { spawnSync } from "node:child_process";

const baseUrl = process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787";

async function readJson(path, options) {
  if (process.env.STEAMBENCH_SMOKE_TRACE) {
    console.error(`[smoke] ${options?.method ?? "GET"} ${path}`);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json" },
    ...options
  });
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

const health = await readJson("/api/health");
if (health.canonicalCaptureArtifact !== "output.mp4") {
  throw new Error("API health must advertise output.mp4 as the canonical capture artifact");
}

const state = await readJson("/api/state");
if (!Array.isArray(state.tasks) || state.tasks.length < 10) {
  throw new Error("Expected seeded benchmark tasks");
}
if (!state.tasks.some((task) => task.track === "leaderboard") || !state.tasks.some((task) => task.track === "stat")) {
  throw new Error("Expected fixture task catalog to include leaderboard and stat benchmark tasks");
}
if (!Array.isArray(state.adapters) || !state.adapters.some((adapter) => adapter.launchUri === "steam://run/620")) {
  throw new Error("Expected dashboard state to expose Steam runtime game adapters");
}
if (!Array.isArray(state.taskReviews) || !state.taskReviews.some((review) => review.decision === "ranked-ready")) {
  throw new Error("Expected dashboard state to expose explainable benchmark task reviews");
}
if (!state.taskReviewCatalog?.totals || state.taskReviewCatalog.totals.tasks < state.tasks.length) {
  throw new Error("Expected dashboard state to expose the task review catalog");
}
if (!Array.isArray(state.taskReviewCatalog.reviewQueue)) {
  throw new Error("Expected dashboard state to expose a benchmark review queue");
}
if (!Array.isArray(state.seasons) || !state.seasons.some((season) => season.window?.scope === "weekly")) {
  throw new Error("Expected dashboard state to expose season leaderboard windows");
}
if (!Array.isArray(state.auditSummaries)) {
  throw new Error("Expected dashboard state to expose run audit summaries");
}
if (!Array.isArray(state.suiteRaceAuditSummaries)) {
  throw new Error("Expected dashboard state to expose suite race audit summaries");
}
if (!Array.isArray(state.runtimeReadiness)) {
  throw new Error("Expected dashboard state to expose runtime readiness matrix");
}
if (!Array.isArray(state.manifestSummaries)) {
  throw new Error("Expected dashboard state to expose execution manifest summaries");
}
if (!Array.isArray(state.benchmarkSuites) || !state.benchmarkSuites.some((suite) => suite.id === "620:ranked" && suite.status === "ranked-ready")) {
  throw new Error("Expected dashboard state to expose generated benchmark suites");
}
if (!Array.isArray(state.benchmarkBlueprints) || !state.benchmarkBlueprints.some((blueprint) => blueprint.schemaVersion === "steambench.benchmark-blueprint.v1" && blueprint.appid === 620)) {
  throw new Error("Expected dashboard state to expose benchmark blueprints");
}
if (!Array.isArray(state.competitionEvents) || !state.competitionEvents.some((event) => event.scope === "weekly")) {
  throw new Error("Expected dashboard state to expose competition event summaries");
}
if (!Array.isArray(state.competitionEventBundleSummaries) || !state.competitionEventBundleSummaries.some((summary) => summary.scope === "weekly")) {
  throw new Error("Expected dashboard state to expose competition event bundle summaries");
}
if (!Array.isArray(state.competitorProfiles)) {
  throw new Error("Expected dashboard state to expose competitor profile summaries");
}
if (!Array.isArray(state.challenges)) {
  throw new Error("Expected dashboard state to expose challenge queue summaries");
}
if (!Array.isArray(state.runtimeDispatches)) {
  throw new Error("Expected dashboard state to expose runtime dispatch tickets");
}
if (state.controlBridgeOps?.schemaVersion !== "steambench.control-bridge-ops-report.v1") {
  throw new Error("Expected dashboard state to expose control bridge operations status");
}
if (!Array.isArray(state.agentCampaigns)) {
  throw new Error("Expected dashboard state to expose agent benchmark campaign reports");
}
if (!Array.isArray(state.gameCoverageRuns)) {
  throw new Error("Expected dashboard state to expose recent game coverage run records");
}
if (state.agentCampaignStandings?.schemaVersion !== "steambench.agent-campaign-standings.v1") {
  throw new Error("Expected dashboard state to expose agent campaign standings");
}
if (!state.broadcastCenter?.totals || !Array.isArray(state.broadcastCenter.recent)) {
  throw new Error("Expected dashboard state to expose broadcast center summaries");
}
if (!Array.isArray(state.gameProfiles) || !state.gameProfiles.some((profile) => profile.game?.appid === 620 && profile.totals?.activeTasks > 0)) {
  throw new Error("Expected dashboard state to expose per-game benchmark profiles");
}
if (!state.gameProfiles.some((profile) =>
  profile.game?.appid === 620 &&
  profile.competition?.activeTasks > 0 &&
  typeof profile.competition?.coveragePercent === "number"
)) {
  throw new Error("Expected per-game profiles to expose game competition summaries");
}
if (!Array.isArray(state.steamAppDiscoveries)) {
  throw new Error("Expected dashboard state to expose Steam app discovery candidates");
}
if (!state.steamDataPolicy?.userData?.steamWebApiKeyServerSideOnly || !Array.isArray(state.steamDataPolicy?.cache?.entries)) {
  throw new Error("Expected dashboard state to expose Steam data policy and cache status");
}

const platformOps = await readJson("/api/platform/ops-report?scope=weekly&limit=20");
if (
  platformOps.report?.schemaVersion !== "steambench.platform-ops-report.v1" ||
  platformOps.report?.filters?.scope !== "weekly" ||
  !Array.isArray(platformOps.report?.subsystems) ||
  !platformOps.report.subsystems.some((entry) => entry.id === "agent-runtime") ||
  !platformOps.report.subsystems.some((entry) => entry.id === "task-review") ||
  !platformOps.report.subsystems.some((entry) => entry.id === "benchmark-blueprints") ||
  !platformOps.report.subsystems.some((entry) => entry.id === "game-competition") ||
  !platformOps.report.subsystems.some((entry) => entry.id === "human-onboarding") ||
  !platformOps.report.subsystems.some((entry) => entry.id === "human-proof") ||
  !platformOps.report.subsystems.some((entry) => entry.id === "human-agent-comparisons") ||
  !platformOps.report.subsystems.some((entry) => entry.id === "action-spaces") ||
  !platformOps.report.subsystems.some((entry) => entry.id === "agent-traces") ||
  !platformOps.report.subsystems.some((entry) => entry.id === "control-bridge") ||
  !platformOps.report.subsystems.some((entry) => entry.id === "challenges") ||
  !platformOps.report.subsystems.some((entry) => entry.id === "match-arena") ||
  !Array.isArray(platformOps.report?.recommendedActions) ||
  platformOps.report?.links?.taskReviewCatalog !== "/api/tasks/review-catalog" ||
  platformOps.report?.links?.benchmarkBlueprintOps !== "/api/games/:appid/benchmark-blueprint" ||
  platformOps.report?.links?.gameCompetitionOps !== "/api/games/:appid/competition/ops-report" ||
  platformOps.report?.links?.humanProofOps !== "/api/human-proof/ops-report" ||
  platformOps.report?.links?.humanAgentComparisonOps !== "/api/comparisons/human-agent/ops-report" ||
  platformOps.report?.links?.steamSourceQueue !== "/api/steam/source-queue" ||
  platformOps.report?.links?.actionSpaces !== "/api/runtime/action-spaces" ||
  platformOps.report?.links?.agentTraceOps !== "/api/agent-traces/ops-report" ||
  platformOps.report?.links?.dispatchOps !== "/api/dispatches/ops-report" ||
  platformOps.report?.links?.controlBridgeOps !== "/api/control-sessions/ops-report" ||
  platformOps.report?.links?.challengeOps !== "/api/challenges/ops-report" ||
  platformOps.report?.links?.matchArenaOps !== "/api/matches/arena-ops-report"
) {
  throw new Error("Platform ops report did not expose cross-system benchmark operations readiness");
}
const platformSteamSourceMetrics = platformOps.report.subsystems.find((entry) => entry.id === "steam-sources")?.metrics;
if (
  typeof platformSteamSourceMetrics?.sourceQueueActions !== "number" ||
  typeof platformSteamSourceMetrics?.sourceQueueAchievementRecords !== "number" ||
  typeof platformSteamSourceMetrics?.sourceQueueStatRecords !== "number" ||
  typeof platformSteamSourceMetrics?.sourceQueueLeaderboardRecords !== "number" ||
  !Array.isArray(platformSteamSourceMetrics?.sourceQueueTopMissingTracks) ||
  !platformOps.report.recommendedActions.some((entry) => entry.id === "steam-sources:run-source-queue-next")
) {
  throw new Error("Platform ops report did not surface Steam source queue readiness with source breakdowns");
}
const platformBlueprintMetrics = platformOps.report.subsystems.find((entry) => entry.id === "benchmark-blueprints")?.metrics;
if (
  typeof platformOps.report?.totals?.blueprintGames !== "number" ||
  typeof platformOps.report?.totals?.blueprintOutputMp4Contracts !== "number" ||
  typeof platformOps.report?.totals?.blueprintStage2Contracts !== "number" ||
  typeof platformBlueprintMetrics?.focusedAppid !== "number" ||
  typeof platformBlueprintMetrics?.focusedStatus !== "string" ||
  typeof platformBlueprintMetrics?.outputMp4Contracts !== "number" ||
  typeof platformBlueprintMetrics?.stage2StartContracts !== "number"
) {
  throw new Error("Platform ops report did not surface benchmark blueprint readiness contracts");
}
const platformGameCompetitionMetrics = platformOps.report.subsystems.find((entry) => entry.id === "game-competition")?.metrics;
if (
  typeof platformOps.report?.totals?.competitionGames !== "number" ||
  typeof platformOps.report?.totals?.competitionCoverageGaps !== "number" ||
  typeof platformGameCompetitionMetrics?.focusedAppid !== "number" ||
  typeof platformGameCompetitionMetrics?.focusedGame !== "string" ||
  typeof platformGameCompetitionMetrics?.humanGaps !== "number" ||
  typeof platformGameCompetitionMetrics?.agentGaps !== "number"
) {
  throw new Error("Platform ops report did not surface focused game competition coverage readiness");
}
const platformHumanProofMetrics = platformOps.report.subsystems.find((entry) => entry.id === "human-proof")?.metrics;
if (
  typeof platformOps.report?.totals?.humanProofReadyTickets !== "number" ||
  typeof platformOps.report?.totals?.humanProofReadyTasks !== "number" ||
  typeof platformOps.report?.totals?.humanProofConsentRequired !== "number" ||
  typeof platformOps.report?.totals?.humanProofSteamNotLinked !== "number" ||
  typeof platformHumanProofMetrics?.readyTickets !== "number" ||
  typeof platformHumanProofMetrics?.readyTasks !== "number"
) {
  throw new Error("Platform ops report did not surface human Steam proof readiness");
}
const platformHumanAgentComparisonMetrics = platformOps.report.subsystems.find((entry) => entry.id === "human-agent-comparisons")?.metrics;
if (
  typeof platformOps.report?.totals?.humanAgentComparisons !== "number" ||
  typeof platformOps.report?.totals?.humanAgentCompleteComparisons !== "number" ||
  typeof platformOps.report?.totals?.humanAgentIncompleteComparisons !== "number" ||
  typeof platformOps.report?.totals?.humanAgentShareReadyComparisons !== "number" ||
  typeof platformOps.report?.totals?.humanAgentHumanMissingTasks !== "number" ||
  typeof platformOps.report?.totals?.humanAgentAgentMissingTasks !== "number" ||
  typeof platformHumanAgentComparisonMetrics?.comparisons !== "number" ||
  typeof platformHumanAgentComparisonMetrics?.readyForPublicShare !== "number"
) {
  throw new Error("Platform ops report did not surface human-agent comparison readiness");
}
const platformOpsCli = spawnSync(
  process.execPath,
  [
    "scripts/platform-ops.mjs",
    `--api=${baseUrl}`,
    "--scope=weekly",
    "--limit=20"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (platformOpsCli.status !== 0) {
  throw new Error(`Platform ops CLI failed:\n${platformOpsCli.stdout}\n${platformOpsCli.stderr}`);
}
const platformOpsCliResult = JSON.parse(platformOpsCli.stdout);
if (
  platformOpsCliResult.schemaVersion !== "steambench.platform-ops-cli.v1" ||
  platformOpsCliResult.scope !== "weekly" ||
  !platformOpsCliResult.summary?.subsystems?.some((entry) => entry.startsWith("task-review:")) ||
  !platformOpsCliResult.summary?.subsystems?.some((entry) => entry.startsWith("benchmark-blueprints:")) ||
  !platformOpsCliResult.summary?.subsystems?.some((entry) => entry.startsWith("game-competition:")) ||
  !platformOpsCliResult.summary?.subsystems?.some((entry) => entry.startsWith("human-proof:")) ||
  !platformOpsCliResult.summary?.subsystems?.some((entry) => entry.startsWith("human-agent-comparisons:")) ||
  !platformOpsCliResult.summary?.subsystems?.some((entry) => entry.startsWith("agent-runtime:")) ||
  !platformOpsCliResult.summary?.subsystems?.some((entry) => entry.startsWith("action-spaces:")) ||
  !platformOpsCliResult.summary?.subsystems?.some((entry) => entry.startsWith("agent-traces:")) ||
  !platformOpsCliResult.summary?.subsystems?.some((entry) => entry.startsWith("control-bridge:")) ||
  !platformOpsCliResult.summary?.subsystems?.some((entry) => entry.startsWith("challenges:")) ||
  !platformOpsCliResult.summary?.subsystems?.some((entry) => entry.startsWith("match-arena:")) ||
  typeof platformOpsCliResult.summary?.blueprintGames !== "number" ||
  typeof platformOpsCliResult.summary?.focusedBlueprintAppid !== "number" ||
  typeof platformOpsCliResult.summary?.focusedBlueprintSourceRecords !== "number" ||
  typeof platformOpsCliResult.summary?.focusedBlueprintNewSourceImportsAvailable !== "number" ||
  !Array.isArray(platformOpsCliResult.summary?.focusedBlueprintSourceMissingCandidateTracks) ||
  typeof platformOpsCliResult.summary?.focusedBlueprintSourceActions !== "number" ||
  !Array.isArray(platformOpsCliResult.summary?.focusedBlueprintSourceActionIds) ||
  typeof platformOpsCliResult.summary?.competitionGames !== "number" ||
  typeof platformOpsCliResult.summary?.focusedCompetitionAppid !== "number" ||
  typeof platformOpsCliResult.summary?.humanProofReadyTickets !== "number" ||
  typeof platformOpsCliResult.summary?.humanProofReadyTasks !== "number" ||
  typeof platformOpsCliResult.summary?.humanAgentComparisons !== "number" ||
  typeof platformOpsCliResult.summary?.humanAgentShareReadyComparisons !== "number" ||
  !Array.isArray(platformOpsCliResult.summary?.actions)
) {
  throw new Error("Platform ops CLI did not summarize cross-system operations readiness");
}

const steamPolicy = await readJson("/api/steam/data-policy");
if (!steamPolicy.policy?.allowedSources?.includes("ISteamApps/GetAppList/v2")) {
  throw new Error("Steam data policy did not expose the official app list source");
}
const steamCache = await readJson("/api/steam/cache");
if (!Array.isArray(steamCache.entries)) {
  throw new Error("Steam cache endpoint did not expose cache entries");
}
const steamSourceQueue = await readJson("/api/steam/source-queue?useFixture=true&limit=4&proposalLimit=2");
if (
  steamSourceQueue.queue?.schemaVersion !== "steambench.steam-source-queue.v1" ||
  steamSourceQueue.queue?.totals?.apps < 1 ||
  steamSourceQueue.queue?.totals?.sourceRecords < 1 ||
  typeof steamSourceQueue.queue?.totals?.achievementRecords !== "number" ||
  typeof steamSourceQueue.queue?.totals?.statRecords !== "number" ||
  typeof steamSourceQueue.queue?.totals?.leaderboardRecords !== "number" ||
  !Array.isArray(steamSourceQueue.queue?.items) ||
  !steamSourceQueue.queue.items.some((entry) =>
    typeof entry.sourceBreakdown?.achievement?.records === "number" &&
    typeof entry.sourceBreakdown?.stat?.records === "number" &&
    typeof entry.sourceBreakdown?.leaderboard?.records === "number" &&
    Array.isArray(entry.registryTracks?.missingCandidates)
  ) ||
  !steamSourceQueue.queue.items.some((entry) => entry.links?.taskSourceOps?.includes("/api/steam/apps/")) ||
  !Array.isArray(steamSourceQueue.queue?.recommendedActions)
) {
  throw new Error("Steam source queue did not rank app-level benchmark source readiness with track breakdowns");
}
const steamSourceQueueCli = spawnSync(
  process.execPath,
  [
    "scripts/steam-source-queue.mjs",
    `--api=${baseUrl}`,
    "--fixture=true",
    "--limit=4",
    "--proposal-limit=2"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  }
);
if (steamSourceQueueCli.status !== 0) {
  throw new Error(`Steam source queue CLI failed:\n${steamSourceQueueCli.stdout}\n${steamSourceQueueCli.stderr}`);
}
const steamSourceQueueCliResult = JSON.parse(steamSourceQueueCli.stdout);
if (
  steamSourceQueueCliResult.schemaVersion !== "steambench.steam-source-queue-cli.v1" ||
  steamSourceQueueCliResult.summary?.apps < 1 ||
  typeof steamSourceQueueCliResult.summary?.catalogReady !== "number" ||
  typeof steamSourceQueueCliResult.summary?.achievementRecords !== "number" ||
  typeof steamSourceQueueCliResult.summary?.statRecords !== "number" ||
  typeof steamSourceQueueCliResult.summary?.leaderboardRecords !== "number" ||
  typeof steamSourceQueueCliResult.summary?.topSourceBreakdown?.achievement?.records !== "number" ||
  !Array.isArray(steamSourceQueueCliResult.summary?.topMissingCandidateTracks) ||
  typeof steamSourceQueueCliResult.summary?.nextActionId !== "string" ||
  !Array.isArray(steamSourceQueueCliResult.summary?.actions)
) {
  throw new Error("Steam source queue CLI did not summarize cross-app source readiness with track breakdowns");
}
const portalStandings = await readJson("/api/games/620/standings");
if (
  portalStandings.standings?.schemaVersion !== "steambench.game-competition-standings.v1" ||
  portalStandings.standings?.game?.appid !== 620 ||
  portalStandings.standings?.season?.scope !== "all" ||
  portalStandings.standings?.totals?.activeTasks < 1 ||
  typeof portalStandings.standings?.summary?.coveragePercent !== "number" ||
  !Array.isArray(portalStandings.standings?.taskCoverage)
) {
  throw new Error("Game competition standings did not expose Portal 2 human-vs-agent game standings");
}
const scoreboardOps = await readJson("/api/scoreboard/ops-report?appid=620&limit=10");
if (
  scoreboardOps.report?.schemaVersion !== "steambench.scoreboard-ops-report.v1" ||
  scoreboardOps.report?.filters?.appid !== 620 ||
  typeof scoreboardOps.report?.totals?.scoreboardRows !== "number" ||
  !Array.isArray(scoreboardOps.report?.tickets) ||
  !Array.isArray(scoreboardOps.report?.recommendedActions) ||
  scoreboardOps.report?.links?.standings !== "/api/standings"
) {
  throw new Error("Scoreboard ops report did not expose Portal 2 leaderboard integrity readiness");
}
const portalCoveragePlan = await readJson("/api/games/620/coverage-plan?limit=6");
if (
  portalCoveragePlan.plan?.schemaVersion !== "steambench.game-coverage-plan.v1" ||
  portalCoveragePlan.plan?.game?.appid !== 620 ||
  portalCoveragePlan.plan?.totals?.activeTasks < 1 ||
  !Array.isArray(portalCoveragePlan.plan?.items) ||
  !portalCoveragePlan.plan.items.some((entry) => entry.task?.appid === 620 && Array.isArray(entry.gaps) && entry.scoreboard?.rows >= 0) ||
  portalCoveragePlan.plan?.links?.standings !== "/api/games/620/standings"
) {
  throw new Error("Game coverage plan did not expose Portal 2 coverage gaps and next actions");
}
const portalGameBundle = await readJson("/api/games/620/evidence-bundle");
if (
  portalGameBundle.bundle?.schemaVersion !== "steambench.game-competition-evidence-bundle.v1" ||
  portalGameBundle.bundle?.appid !== 620 ||
  portalGameBundle.bundle?.standings?.schemaVersion !== "steambench.game-competition-standings.v1" ||
  portalGameBundle.bundle?.integrity?.coverageWithinBounds !== true ||
  portalGameBundle.bundle?.integrity?.verdict !== "scoreboard-ready" ||
  !portalGameBundle.bundle?.integrity?.checklist?.every((entry) => entry.status === "pass")
) {
  throw new Error("Game competition evidence bundle did not expose share-ready Portal 2 standings evidence");
}
const portalGameCertificate = await readJson("/api/games/620/result-certificate");
if (
  portalGameCertificate.certificate?.schemaVersion !== "steambench.result-certificate.v1" ||
  portalGameCertificate.certificate?.kind !== "game-competition" ||
  portalGameCertificate.certificate?.id !== "game:620:all" ||
  portalGameCertificate.certificate?.links?.evidenceBundle?.endsWith("/api/games/620/evidence-bundle?season=all") !== true ||
  portalGameCertificate.certificate?.integrity?.readyForPublicShare !== true
) {
  throw new Error("Game competition result certificate did not expose a share-ready Portal 2 certificate");
}

const suites = await readJson("/api/benchmark-suites");
if (!suites.suites?.some((suite) => suite.id === "646570:expert" && suite.taskIds.includes("646570:LDRB.SEED_A20_SCORE"))) {
  throw new Error("Global benchmark suite API did not expose the Slay the Spire expert suite");
}
const portalSuites = await readJson("/api/games/620/benchmark-suites");
if (portalSuites.game?.name !== "Portal 2" || !portalSuites.suites?.every((suite) => suite.appid === 620)) {
  throw new Error("Per-game benchmark suite API did not return Portal 2 suites");
}
if (!portalSuites.suites?.some((suite) => suite.id === "620:ranked" && suite.status === "ranked-ready")) {
  throw new Error("Per-game benchmark suite API did not expose a ranked-ready Portal 2 suite");
}
const portalBlueprint = await readJson("/api/games/620/benchmark-blueprint");
if (
  portalBlueprint.blueprint?.schemaVersion !== "steambench.benchmark-blueprint.v1" ||
  portalBlueprint.blueprint?.runtimePlan?.targetArtifactName !== "output.mp4" ||
  !portalBlueprint.blueprint?.runtimePlan?.stage2StartConstraints?.some((entry) => entry.includes("Do not call session.run_file")) ||
  portalBlueprint.blueprint?.sourcePlan?.achievement?.importEndpoint !== "/api/steam/apps/620/achievement-ladder/import-recommended" ||
  portalBlueprint.blueprint?.sourcePlan?.stat?.importEndpoint !== "/api/steam/apps/620/stat-proposals/import-recommended" ||
  portalBlueprint.blueprint?.sourcePlan?.leaderboard?.importEndpoint !== "/api/steam/apps/620/leaderboard-proposals/import-recommended"
) {
  throw new Error("Per-game benchmark blueprint did not expose the runtime and Stage 2 contract");
}
const portalSourceBlueprint = await readJson("/api/games/620/benchmark-blueprint?useFixture=true&limit=2");
if (
  portalSourceBlueprint.blueprint?.sourcePlan?.stat?.source !== "fixture" ||
  portalSourceBlueprint.blueprint?.sourcePlan?.stat?.proposed !== 2 ||
  portalSourceBlueprint.blueprint?.sourcePlan?.leaderboard?.source !== "fixture" ||
  portalSourceBlueprint.blueprint?.sourcePlan?.leaderboard?.proposed !== 2 ||
  portalSourceBlueprint.blueprint?.sourcePlan?.newImportsAvailable < 4 ||
  !portalSourceBlueprint.blueprint?.sourceActions?.some((entry) => entry.id === "import-stat-proposals") ||
  !portalSourceBlueprint.blueprint?.sourceActions?.some((entry) => entry.id === "import-leaderboard-proposals")
) {
  throw new Error("Per-game benchmark blueprint did not expose fixture-backed Steam source import opportunities");
}
const benchmarkBlueprintOpsCli = spawnSync(
  process.execPath,
  [
    "scripts/benchmark-blueprint-ops.mjs",
    `--api=${baseUrl}`,
    "--status=all",
    "--limit=6"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (benchmarkBlueprintOpsCli.status !== 0) {
  throw new Error(`Benchmark blueprint ops CLI failed:\n${benchmarkBlueprintOpsCli.stdout}\n${benchmarkBlueprintOpsCli.stderr}`);
}
const benchmarkBlueprintOpsResult = JSON.parse(benchmarkBlueprintOpsCli.stdout);
if (
  benchmarkBlueprintOpsResult.schemaVersion !== "steambench.benchmark-blueprint-ops-cli.v1" ||
  benchmarkBlueprintOpsResult.summary?.blueprints < 1 ||
  typeof benchmarkBlueprintOpsResult.summary?.sourceRecords !== "number" ||
  typeof benchmarkBlueprintOpsResult.summary?.newSourceImportsAvailable !== "number" ||
  typeof benchmarkBlueprintOpsResult.summary?.statSourceRecords !== "number" ||
  typeof benchmarkBlueprintOpsResult.summary?.leaderboardSourceRecords !== "number" ||
  typeof benchmarkBlueprintOpsResult.summary?.sourceActions !== "number" ||
  benchmarkBlueprintOpsResult.summary?.outputMp4Contracts < 1 ||
  benchmarkBlueprintOpsResult.summary?.stage2StartContracts < 1 ||
  !benchmarkBlueprintOpsResult.items?.some((entry) => entry.appid === 620 && entry.targetArtifactName === "output.mp4")
) {
  throw new Error("Benchmark blueprint ops CLI did not summarize game blueprint readiness contracts");
}
const portalAchievementLadder = await readJson("/api/steam/apps/620/achievement-ladder?useFixture=true");
if (
  portalAchievementLadder.ladder?.schemaVersion !== "steambench.steam-achievement-benchmark-ladder.v1" ||
  portalAchievementLadder.ladder?.appid !== 620 ||
  portalAchievementLadder.ladder?.canonicalArtifactName !== "output.mp4" ||
  portalAchievementLadder.ladder?.links?.importRecommended !== "/api/steam/apps/620/achievement-ladder/import-recommended" ||
  portalAchievementLadder.ladder?.links?.importAchievements !== "/api/steam/apps/620/import-achievements" ||
  !portalAchievementLadder.ladder?.bands?.some((band) => band.taskCount > 0) ||
  portalAchievementLadder.ladder?.totals?.active < 1 ||
  !portalAchievementLadder.ladder?.recommendedImports?.every((entry) => entry.importStatus !== "active")
) {
  throw new Error("Steam achievement benchmark ladder did not expose import-safe Portal 2 task suitability");
}
const recommendedAchievementImport = await readJson("/api/steam/apps/620/achievement-ladder/import-recommended", {
  method: "POST",
  body: JSON.stringify({
    useFixture: true,
    limit: 4,
    reviewNotes: "smoke recommended import"
  })
});
if (
  recommendedAchievementImport.importRun?.schemaVersion !== "steambench.steam-achievement-recommended-import.v1" ||
  recommendedAchievementImport.importRun?.appid !== 620 ||
  recommendedAchievementImport.importRun?.source !== "fixture" ||
  recommendedAchievementImport.importRun?.totals?.imported !== 0 ||
  recommendedAchievementImport.importRun?.totals?.active !== portalAchievementLadder.ladder.totals.active ||
  !recommendedAchievementImport.importRun?.skipped?.every((entry) => entry.importStatus === "active")
) {
  throw new Error("Recommended achievement import did not skip already-active Portal 2 tasks");
}
const portalOnboarding = await readJson("/api/steam/apps/620/onboarding?useFixture=true");
if (
  portalOnboarding.onboarding?.schemaVersion !== "steambench.steam-app-onboarding.v1" ||
  portalOnboarding.onboarding?.appid !== 620 ||
  portalOnboarding.onboarding?.links?.importRecommended !== "/api/steam/apps/620/achievement-ladder/import-recommended" ||
  portalOnboarding.onboarding?.links?.coveragePlan !== "/api/games/620/coverage-plan" ||
  portalOnboarding.onboarding?.links?.runOnboardingLocal !== "/api/steam/apps/620/onboarding/run-local" ||
  portalOnboarding.onboarding?.stages?.map((stage) => stage.id).join(",") !== "discovery,achievement-ladder,task-publication,coverage,competition" ||
  !portalOnboarding.onboarding?.stages?.some((stage) => stage.status === "complete")
) {
  throw new Error("Steam app onboarding pipeline did not expose the expected Portal 2 stages");
}
const portalOnboardingAdvance = await readJson("/api/steam/apps/620/onboarding/advance", {
  method: "POST",
  body: JSON.stringify({
    useFixture: true,
    reviewApproved: true,
    reviewNotes: "smoke onboarding advance"
  })
});
if (
  portalOnboardingAdvance.advance?.schemaVersion !== "steambench.steam-app-onboarding-advance.v1" ||
  portalOnboardingAdvance.advance?.appid !== 620 ||
  portalOnboardingAdvance.advance?.links?.runCoverageLocal !== "/api/games/620/coverage-plan/run-local" ||
  portalOnboardingAdvance.advance?.links?.runOnboardingLocal !== "/api/steam/apps/620/onboarding/run-local" ||
  portalOnboardingAdvance.advance?.steps?.map((step) => step.id).join(",") !== "import-recommended,publish-candidates,coverage-plan" ||
  portalOnboardingAdvance.onboarding?.schemaVersion !== "steambench.steam-app-onboarding.v1"
) {
  throw new Error("Steam app onboarding advance did not return the expected safe progression result");
}
const steamOnboardInspect = spawnSync(
  process.execPath,
  [
    "scripts/steam-onboard.mjs",
    `--api=${baseUrl}`,
    "--appid=620",
    "--fixture=true",
    "--limit=3"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (steamOnboardInspect.status !== 0) {
  throw new Error(`Steam onboard CLI inspect failed:\n${steamOnboardInspect.stdout}\n${steamOnboardInspect.stderr}`);
}
const steamOnboardInspectResult = JSON.parse(steamOnboardInspect.stdout);
if (
  steamOnboardInspectResult.schemaVersion !== "steambench.steam-onboard-cli.v1" ||
  steamOnboardInspectResult.appid !== 620 ||
  steamOnboardInspectResult.execute !== "inspect" ||
  typeof steamOnboardInspectResult.summary?.status !== "string" ||
  !Array.isArray(steamOnboardInspectResult.summary?.completeStages)
) {
  throw new Error("Steam onboard CLI inspect did not summarize onboarding state");
}
const steamOnboardAdvance = spawnSync(
  process.execPath,
  [
    "scripts/steam-onboard.mjs",
    `--api=${baseUrl}`,
    "--appid=620",
    "--fixture=true",
    "--execute=advance",
    "--review-approved=true",
    "--limit=3"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (steamOnboardAdvance.status !== 0) {
  throw new Error(`Steam onboard CLI advance failed:\n${steamOnboardAdvance.stdout}\n${steamOnboardAdvance.stderr}`);
}
const steamOnboardAdvanceResult = JSON.parse(steamOnboardAdvance.stdout);
if (
  steamOnboardAdvanceResult.schemaVersion !== "steambench.steam-onboard-cli.v1" ||
  steamOnboardAdvanceResult.execute !== "advance" ||
  steamOnboardAdvanceResult.executedAction?.id !== "advance" ||
  steamOnboardAdvanceResult.executedAction?.advance?.schemaVersion !== "steambench.steam-app-onboarding-advance.v1" ||
  steamOnboardAdvanceResult.executedAction?.advance?.steps?.map((step) => step.id).join(",") !== "import-recommended,publish-candidates,coverage-plan"
) {
  throw new Error("Steam onboard CLI advance did not execute the safe onboarding progression");
}

const reviewCatalog = await readJson("/api/tasks/review-catalog?decision=review-required&limit=10");
if (!reviewCatalog.catalog?.entries?.every((entry) => entry.review.decision === "review-required")) {
  throw new Error("Task review catalog endpoint did not apply the decision filter");
}
const taskReviewOpsCli = spawnSync(
  process.execPath,
  [
    "scripts/task-review-ops.mjs",
    `--api=${baseUrl}`,
    "--decision=review-required",
    "--limit=10"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (taskReviewOpsCli.status !== 0) {
  throw new Error(`Task review ops CLI failed:\n${taskReviewOpsCli.stdout}\n${taskReviewOpsCli.stderr}`);
}
const taskReviewOpsCliResult = JSON.parse(taskReviewOpsCli.stdout);
if (
  taskReviewOpsCliResult.schemaVersion !== "steambench.task-review-ops-cli.v1" ||
  taskReviewOpsCliResult.filters?.decision !== "review-required" ||
  taskReviewOpsCliResult.summary?.reviewRequired !== reviewCatalog.catalog.totals.reviewRequired ||
  !Array.isArray(taskReviewOpsCliResult.summary?.queue)
) {
  throw new Error("Task review ops CLI did not summarize review-required benchmark tasks");
}
const invalidReviewCatalog = await fetch(`${baseUrl}/api/tasks/review-catalog?riskFlag=not-real`);
if (invalidReviewCatalog.status !== 400) {
  throw new Error("Task review catalog endpoint did not reject invalid filters");
}

const discoveredSteamApps = await readJson("/api/steam/apps/discover", {
  method: "POST",
  body: JSON.stringify({
    query: "Portal",
    useFixture: true,
    limit: 3
  })
});
const portalDiscovery = discoveredSteamApps.discoveries?.find((entry) => entry.appid === 620);
if (!portalDiscovery) {
  throw new Error("Steam app discovery did not persist the Portal fixture candidate");
}

const shortlistedDiscovery = await readJson(`/api/steam/apps/discovery/${portalDiscovery.id}/status`, {
  method: "POST",
  body: JSON.stringify({
    status: "shortlisted",
    reviewNotes: "smoke shortlisted"
  })
});
if (shortlistedDiscovery.discovery?.status !== "shortlisted") {
  throw new Error("Steam app discovery status endpoint did not shortlist the candidate");
}

const discoveryImport = await readJson(`/api/steam/apps/discovery/${portalDiscovery.id}/import-achievements`, {
  method: "POST",
  body: JSON.stringify({
    useFixture: true,
    limit: 1,
    reviewNotes: "smoke discovery import"
  })
});
if (discoveryImport.discovery?.status !== "imported" || !Array.isArray(discoveryImport.imported) || discoveryImport.imported.length !== 1) {
  throw new Error("Steam app discovery import did not create a task candidate and mark the app imported");
}
const discoveryBlueprint = await readJson(`/api/steam/apps/discovery/${portalDiscovery.id}/benchmark-blueprint`);
if (
  discoveryBlueprint.blueprint?.appid !== 620 ||
  discoveryBlueprint.blueprint?.importPlan?.endpoint !== `/api/steam/apps/discovery/${portalDiscovery.id}/import-achievements`
) {
  throw new Error("Steam app discovery blueprint did not preserve the discovery import path");
}

const importedDiscoveries = await readJson("/api/steam/apps/discovery?status=imported");
if (!importedDiscoveries.discoveries?.some((entry) => entry.appid === 620)) {
  throw new Error("Steam app discovery listing did not expose imported candidates");
}

const proposalKey = `CAP.SMOKE_${Date.now().toString(36).toUpperCase()}`;
const proposedTask = await readJson("/api/steam/apps/620/task-proposals", {
  method: "POST",
  body: JSON.stringify({
    key: proposalKey,
    title: "Smoke Capture Proposal",
    track: "capture",
    level: 5,
    targetValue: "120 seconds",
    metricName: "completion_time_seconds",
    objective: "Complete a controlled Portal 2 smoke route within 120 seconds.",
    estimatedRuntimeMinutes: 18,
    scoringRule: "Pass at <= 120 seconds; rank lower verified time higher.",
    reviewNotes: "smoke proposal"
  })
});
if (
  proposedTask.task?.id !== `620:${proposalKey}` ||
  proposedTask.task?.source !== "manual" ||
  proposedTask.review?.taskId !== proposedTask.task.id ||
  proposedTask.blueprint?.schemaVersion !== "steambench.benchmark-blueprint.v1"
) {
  throw new Error("Manual task proposal endpoint did not create a reviewable benchmark candidate");
}

const metricProposalKey = Date.now().toString(36).toUpperCase();
const metricProposalRun = await readJson("/api/steam/apps/620/metric-proposals", {
  method: "POST",
  body: JSON.stringify({
    reviewNotes: "smoke metric manifest",
    proposals: [
      {
        key: `STAT.SMOKE_${metricProposalKey}`,
        title: "Smoke Stat Proposal",
        track: "stat",
        level: 4,
        targetValue: "25 portals",
        metricName: "portal_count",
        objective: "Place at least 25 portals in a controlled benchmark route.",
        estimatedRuntimeMinutes: 12,
        scoringRule: "Pass at >= 25 portals; rank higher verified count higher.",
        signalSource: "steam-stat"
      },
      {
        key: `LDRB.SMOKE_${metricProposalKey}`,
        title: "Smoke Leaderboard Proposal",
        track: "leaderboard",
        level: 6,
        targetValue: "highest score",
        metricName: "score",
        objective: "Maximize score on a snapshotted benchmark leaderboard ruleset.",
        estimatedRuntimeMinutes: 24,
        scoringRule: "Rank higher verified score higher.",
        signalSource: "steam-leaderboard"
      }
    ]
  })
});
if (
  metricProposalRun.proposalRun?.schemaVersion !== "steambench.steam-metric-proposal-run.v1" ||
  metricProposalRun.proposalRun?.candidates !== 2 ||
  metricProposalRun.candidates?.some((entry) => entry.status !== "candidate") ||
  metricProposalRun.blueprint?.schemaVersion !== "steambench.benchmark-blueprint.v1"
) {
  throw new Error("Metric proposal manifest endpoint did not create reviewable benchmark candidates");
}

const statProposalPreview = await readJson("/api/steam/apps/620/stat-proposals?useFixture=true&limit=2");
if (
  statProposalPreview.proposalRun?.schemaVersion !== "steambench.steam-stat-proposal-run.v1" ||
  statProposalPreview.proposalRun?.source !== "fixture" ||
  statProposalPreview.proposalRun?.proposed !== 2 ||
  statProposalPreview.proposalRun?.links?.importRecommended !== "/api/steam/apps/620/stat-proposals/import-recommended" ||
  statProposalPreview.tasks?.some((entry) => entry.track !== "stat" || entry.signalSource !== "steam-stat")
) {
  throw new Error("Steam stat proposal preview did not generate fixture-backed stat benchmark contracts");
}

const statProposalImport = await readJson("/api/steam/apps/620/stat-proposals/import-recommended", {
  method: "POST",
  body: JSON.stringify({
    useFixture: true,
    limit: 2,
    reviewNotes: "smoke stat schema import"
  })
});
if (
  statProposalImport.importRun?.schemaVersion !== "steambench.steam-stat-recommended-import.v1" ||
  statProposalImport.importRun?.source !== "fixture" ||
  statProposalImport.importRun?.imported !== 2 ||
  statProposalImport.imported?.some((entry) => !["candidate", "active"].includes(entry.status)) ||
  statProposalImport.blueprint?.schemaVersion !== "steambench.benchmark-blueprint.v1"
) {
  throw new Error("Steam stat proposal import did not create reviewable fixture-backed candidates");
}

const leaderboardProposalPreview = await readJson("/api/steam/apps/620/leaderboard-proposals?useFixture=true&limit=2");
if (
  leaderboardProposalPreview.proposalRun?.schemaVersion !== "steambench.steam-leaderboard-proposal-run.v1" ||
  leaderboardProposalPreview.proposalRun?.source !== "fixture" ||
  leaderboardProposalPreview.proposalRun?.proposed !== 2 ||
  leaderboardProposalPreview.proposalRun?.links?.importRecommended !== "/api/steam/apps/620/leaderboard-proposals/import-recommended" ||
  leaderboardProposalPreview.tasks?.some((entry) => entry.track !== "leaderboard" || entry.signalSource !== "steam-leaderboard")
) {
  throw new Error("Steam leaderboard proposal preview did not generate fixture-backed leaderboard benchmark contracts");
}

const leaderboardProposalImport = await readJson("/api/steam/apps/620/leaderboard-proposals/import-recommended", {
  method: "POST",
  body: JSON.stringify({
    useFixture: true,
    limit: 2,
    reviewNotes: "smoke leaderboard metadata import"
  })
});
if (
  leaderboardProposalImport.importRun?.schemaVersion !== "steambench.steam-leaderboard-recommended-import.v1" ||
  leaderboardProposalImport.importRun?.source !== "fixture" ||
  leaderboardProposalImport.importRun?.imported !== 2 ||
  leaderboardProposalImport.imported?.some((entry) => !["candidate", "active"].includes(entry.status)) ||
  leaderboardProposalImport.reviews?.some((entry) => entry.decision !== "review-required") ||
  leaderboardProposalImport.blueprint?.schemaVersion !== "steambench.benchmark-blueprint.v1"
) {
  throw new Error("Steam leaderboard proposal import did not create reviewable fixture-backed candidates");
}

const taskSourceOps = await readJson("/api/steam/apps/620/task-source-ops?useFixture=true&limit=2");
if (
  taskSourceOps.ops?.schemaVersion !== "steambench.steam-task-source-ops-report.v1" ||
  taskSourceOps.ops?.appid !== 620 ||
  taskSourceOps.ops?.status !== "ready-to-publish" ||
  taskSourceOps.ops?.sources?.stat?.newProposals !== 0 ||
  taskSourceOps.ops?.sources?.leaderboard?.newProposals !== 0 ||
  !taskSourceOps.ops?.recommendedActions?.some((entry) => entry.id === "publish-candidates") ||
  taskSourceOps.statProposalRun?.schemaVersion !== "steambench.steam-stat-proposal-run.v1" ||
  taskSourceOps.leaderboardProposalRun?.schemaVersion !== "steambench.steam-leaderboard-proposal-run.v1"
) {
  throw new Error("Steam task source ops report did not summarize imported source candidates");
}
const taskSourceOpsCli = spawnSync(
  process.execPath,
  [
    "scripts/steam-task-source-ops.mjs",
    `--api=${baseUrl}`,
    "--appid=2379780",
    "--fixture=true",
    "--limit=1",
    "--execute=advance-source-actions",
    "--max-steps=1",
    "--review-notes=smoke task source ops import"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (taskSourceOpsCli.status !== 0) {
  throw new Error(`Steam task source ops CLI execute failed:\n${taskSourceOpsCli.stdout}\n${taskSourceOpsCli.stderr}`);
}
const taskSourceOpsCliResult = JSON.parse(taskSourceOpsCli.stdout);
if (
  taskSourceOpsCliResult.schemaVersion !== "steambench.steam-task-source-ops-cli.v1" ||
  taskSourceOpsCliResult.appid !== 2379780 ||
  taskSourceOpsCliResult.summary?.executedActionId !== "import-stat-proposals" ||
  taskSourceOpsCliResult.summary?.executedActionCount !== 1 ||
  taskSourceOpsCliResult.summary?.executedActionIds?.[0] !== "import-stat-proposals" ||
  taskSourceOpsCliResult.summary?.imported !== 1 ||
  taskSourceOpsCliResult.executedAction?.result?.importRun?.schemaVersion !== "steambench.steam-stat-recommended-import.v1" ||
  !taskSourceOpsCliResult.ops?.recommendedActions?.some((entry) => entry.id === "publish-candidates")
) {
  throw new Error("Steam task source ops CLI did not import fixture stat recommendations");
}

const imported = await readJson("/api/steam/apps/620/import-achievements", {
  method: "POST",
  body: JSON.stringify({
    useFixture: true,
    limit: 1,
    reviewNotes: "smoke import"
  })
});

if (!Array.isArray(imported.imported) || !["candidate", "active"].includes(imported.imported[0]?.status)) {
  throw new Error("Steam fixture import did not create task candidates");
}
if (imported.steamMeta !== null || !imported.policy?.userData?.proofConsentRequiredBeforePublicRanking) {
  throw new Error("Steam fixture import did not expose policy metadata");
}

const bulkPublished = await readJson("/api/steam/apps/620/publish-candidates", {
  method: "POST",
  body: JSON.stringify({
    reviewApproved: true,
    reviewNotes: "smoke bulk approval"
  })
});
if (
  bulkPublished.publication?.schemaVersion !== "steambench.task-publication.v1" ||
  bulkPublished.publication?.appid !== 620 ||
  bulkPublished.publication?.totals?.blocked !== 0 ||
  bulkPublished.publication?.totals?.published + bulkPublished.publication?.totals?.alreadyActive < 1 ||
  !(
    bulkPublished.publication?.published?.some((entry) => entry.task?.id === imported.imported[0].id && entry.task?.status === "active") ||
    bulkPublished.publication?.alreadyActive?.some((entry) => entry.id === imported.imported[0].id && entry.status === "active")
  ) ||
  bulkPublished.blueprint?.schemaVersion !== "steambench.benchmark-blueprint.v1" ||
  bulkPublished.blueprint?.taskLadder?.reduce((total, band) => total + (band.activeTasks ?? 0), 0) < bulkPublished.publication.totals.published
) {
  throw new Error("Bulk Steam task publication did not publish review-cleared app candidates");
}

const published = await readJson(`/api/tasks/${encodeURIComponent(imported.imported[0].id)}/status`, {
  method: "POST",
  body: JSON.stringify({
    status: "active",
    reviewApproved: true,
    reviewNotes: "smoke approved"
  })
});

if (published.task.status !== "active") {
  throw new Error("Imported task was not published as active");
}

const user = await readJson("/api/users", {
  method: "POST",
  body: JSON.stringify({
    handle: "smoke-human",
    displayName: "Smoke Human",
    type: "human"
  })
});

await readJson(`/api/users/${user.user.id}/steam`, {
  method: "POST",
  body: JSON.stringify({
    steamid: "76561198000000000",
    proofConsent: true
  })
});

const link = await readJson("/api/steam/link-intents", {
  method: "POST",
  body: JSON.stringify({
    returnUrl: "http://127.0.0.1:5173",
    userId: user.user.id
  })
});
if (!link.openIdUrl.includes("steamcommunity.com/openid/login")) {
  throw new Error("Steam link intent did not generate an OpenID URL");
}

const onboardingOpsUser = await readJson("/api/users", {
  method: "POST",
  body: JSON.stringify({
    handle: `smoke-onboarding-${Date.now().toString(36)}`,
    displayName: "Smoke Onboarding Human",
    type: "human"
  })
});
const onboardingOpsInitial = await readJson("/api/human-onboarding/ops-report?scope=daily&limit=1");
if (
  onboardingOpsInitial.report?.schemaVersion !== "steambench.human-onboarding-ops-report.v1" ||
  onboardingOpsInitial.report?.filters?.scope !== "daily" ||
  onboardingOpsInitial.report?.tickets?.[0]?.user?.id !== onboardingOpsUser.user.id ||
  onboardingOpsInitial.report?.recommendedActions?.[0]?.id !== "link-steam"
) {
  throw new Error("Human onboarding ops report did not expose Steam link as the next onboarding action");
}
const onboardingAdvanceCli = spawnSync(
  process.execPath,
  [
    "scripts/human-onboarding-ops.mjs",
    `--api=${baseUrl}`,
    "--scope=daily",
    "--limit=1",
    "--execute=advance-onboarding-actions",
    "--max-steps=2",
    "--steamid=76561198000000065",
    "--notes=smoke onboarding registration"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (onboardingAdvanceCli.status !== 0) {
  throw new Error(`Human onboarding ops CLI advance failed:\n${onboardingAdvanceCli.stdout}\n${onboardingAdvanceCli.stderr}`);
}
const onboardingAdvanceResult = JSON.parse(onboardingAdvanceCli.stdout);
if (
  onboardingAdvanceResult.schemaVersion !== "steambench.human-onboarding-ops-cli.v1" ||
  onboardingAdvanceResult.summary?.executedActionId !== "link-steam" ||
  onboardingAdvanceResult.summary?.executedActionCount !== 2 ||
  onboardingAdvanceResult.summary?.executedActionIds?.join(",") !== "link-steam,register-event" ||
  onboardingAdvanceResult.summary?.linked !== 1 ||
  onboardingAdvanceResult.summary?.consented !== 1 ||
  onboardingAdvanceResult.summary?.registeredHumans !== 1 ||
  onboardingAdvanceResult.summary?.registeredParticipantId !== onboardingOpsUser.user.id ||
  onboardingAdvanceResult.report?.tickets?.[0]?.status !== "event-registered"
) {
  throw new Error("Human onboarding ops CLI did not link, consent, and register the selected human");
}

const agent = await readJson("/api/agents", {
  method: "POST",
  body: JSON.stringify({
    handle: `smoke-agent-${Date.now().toString(36)}`,
    displayName: "Smoke Agent",
    provider: "local",
    command: "node scripts/runtime-worker.mjs --agent=smoke-agent",
    capabilities: ["keyboard-mouse", "controller", "turn-based-actions", "screen-capture", "stats-screen", "action-log", "seeded-save", "manual-review", "output.mp4"]
  })
});

if (agent.agent.status !== "active" || agent.agent.runtimeProvider !== "local-sim") {
  throw new Error("Agent registration did not create an active local runtime profile");
}

const platformAgentEventRegisterCli = spawnSync(
  process.execPath,
  [
    "scripts/platform-ops.mjs",
    `--api=${baseUrl}`,
    "--scope=daily",
    "--limit=20",
    "--execute=events:register-agent"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (platformAgentEventRegisterCli.status !== 0) {
  throw new Error(`Platform ops agent event registration failed:\n${platformAgentEventRegisterCli.stdout}\n${platformAgentEventRegisterCli.stderr}`);
}
const platformAgentEventRegisterResult = JSON.parse(platformAgentEventRegisterCli.stdout);
if (
  platformAgentEventRegisterResult.summary?.executedActionId !== "events:register-agent" ||
  platformAgentEventRegisterResult.executedAction?.result?.registration?.participantId !== agent.agent.id ||
  platformAgentEventRegisterResult.executedAction?.result?.registration?.eventScope !== "daily"
) {
  throw new Error("Platform ops CLI did not register the active agent for the daily event");
}
const platformEventScheduleCli = spawnSync(
  process.execPath,
  [
    "scripts/platform-ops.mjs",
    `--api=${baseUrl}`,
    "--scope=daily",
    "--limit=20",
    "--execute=events:schedule-suite"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (platformEventScheduleCli.status !== 0) {
  throw new Error(`Platform ops event scheduling failed:\n${platformEventScheduleCli.stdout}\n${platformEventScheduleCli.stderr}`);
}
const platformEventScheduleResult = JSON.parse(platformEventScheduleCli.stdout);
if (
  platformEventScheduleResult.summary?.executedActionId !== "events:schedule-suite" ||
  platformEventScheduleResult.summary?.scheduledCount < 1 ||
  platformEventScheduleResult.executedAction?.result?.schedule?.scheduled?.length < 1
) {
  throw new Error("Platform ops CLI did not schedule a registered daily human-agent pair");
}
const platformEventRunSuiteCli = spawnSync(
  process.execPath,
  [
    "scripts/platform-ops.mjs",
    `--api=${baseUrl}`,
    "--scope=daily",
    "--limit=20",
    "--execute=events:run-suite-local"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (platformEventRunSuiteCli.status !== 0) {
  throw new Error(`Platform ops event suite run failed:\n${platformEventRunSuiteCli.stdout}\n${platformEventRunSuiteCli.stderr}`);
}
const platformEventRunSuiteResult = JSON.parse(platformEventRunSuiteCli.stdout);
if (
  platformEventRunSuiteResult.summary?.executedActionId !== "events:run-suite-local" ||
  platformEventRunSuiteResult.summary?.executedRaces < 1 ||
  platformEventRunSuiteResult.executedAction?.result?.run?.executed?.length < 1
) {
  throw new Error("Platform ops CLI did not run a scheduled daily suite race");
}
const platformOpsAfterDailyRun = await readJson("/api/platform/ops-report?scope=daily&limit=50");
const platformDailyEventMetrics = platformOpsAfterDailyRun.report?.subsystems?.find((entry) => entry.id === "events")?.metrics;
if (
  platformDailyEventMetrics?.eventReadyForPublicShare !== true ||
  !platformOpsAfterDailyRun.report?.recommendedActions?.some((entry) => entry.id === "events:inspect-event-certificate")
) {
  throw new Error("Platform ops report did not surface the share-ready daily event certificate");
}

const runtimeActionSpaceCatalog = await readJson(`/api/runtime/action-spaces?agentId=${agent.agent.id}&appid=1145360&inputMode=controller&transport=virtual-controller&limit=4`);
if (
  runtimeActionSpaceCatalog.catalog?.schemaVersion !== "steambench.runtime-action-space-catalog.v1" ||
  runtimeActionSpaceCatalog.catalog?.totals?.controllerTasks < 1 ||
  runtimeActionSpaceCatalog.catalog?.totals?.virtualControllerTasks !== runtimeActionSpaceCatalog.catalog?.totals?.controllerTasks ||
  runtimeActionSpaceCatalog.catalog?.totals?.bridgeableTasks !== runtimeActionSpaceCatalog.catalog?.totals?.controllerTasks ||
  runtimeActionSpaceCatalog.catalog?.totals?.readyForSelectedAgent < 1 ||
  runtimeActionSpaceCatalog.catalog?.entries?.some((entry) =>
    entry.actionSpace?.transport === "virtual-controller" &&
    entry.actionSpace?.permissions?.controller === true &&
    entry.actionSpace?.permissions?.privilegedSystemInput === false &&
    entry.bridge?.manifestRequired === "steambench.control-bridge-manifest.v1"
  ) !== true ||
  runtimeActionSpaceCatalog.catalog?.recommendedActions?.some((action) => action.id === "create-control-run-session") !== true ||
  runtimeActionSpaceCatalog.catalog?.recommendedActions?.some((action) => action.id === "create-agent-run") !== true
) {
  throw new Error("Runtime action-space catalog did not expose bridgeable controller tasks for the agent");
}
const runtimeControlRunSessionCli = spawnSync(
  process.execPath,
  [
    "scripts/runtime-action-spaces.mjs",
    `--api=${baseUrl}`,
    `--agent-id=${agent.agent.id}`,
    "--appid=1145360",
    "--input-mode=controller",
    "--transport=virtual-controller",
    "--limit=4",
    "--execute=advance-action-space-actions",
    "--max-steps=1"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (runtimeControlRunSessionCli.status !== 0) {
  throw new Error(`Runtime action-spaces control run-session execute failed:\n${runtimeControlRunSessionCli.stdout}\n${runtimeControlRunSessionCli.stderr}`);
}
const runtimeControlRunSessionResult = JSON.parse(runtimeControlRunSessionCli.stdout);
if (
  runtimeControlRunSessionResult.schemaVersion !== "steambench.runtime-action-spaces-cli.v1" ||
  runtimeControlRunSessionResult.summary?.executedActionId !== "create-control-run-session" ||
  runtimeControlRunSessionResult.summary?.executedActionIds?.[0] !== "create-control-run-session" ||
  runtimeControlRunSessionResult.summary?.executedActionCount !== 1 ||
  typeof runtimeControlRunSessionResult.summary?.createdRunId !== "string" ||
  typeof runtimeControlRunSessionResult.summary?.controlSessionId !== "string" ||
  runtimeControlRunSessionResult.summary?.accessPacketReady !== true ||
  runtimeControlRunSessionResult.summary?.bridgeReady !== true ||
  !String(runtimeControlRunSessionResult.summary?.actionBatchEndpoint ?? "").includes(`/api/runs/${runtimeControlRunSessionResult.summary.createdRunId}/action-batches`) ||
  !String(runtimeControlRunSessionResult.summary?.bridgeManifestEndpoint ?? "").includes(`/api/control-sessions/${runtimeControlRunSessionResult.summary.controlSessionId}/bridge-manifest`)
) {
  throw new Error("Runtime action-spaces CLI did not create a bridge-ready control run session");
}
const runtimeActionSpacesCli = spawnSync(
  process.execPath,
  [
    "scripts/runtime-action-spaces.mjs",
    `--api=${baseUrl}`,
    `--agent-id=${agent.agent.id}`,
    "--appid=1145360",
    "--input-mode=controller",
    "--transport=virtual-controller",
    "--limit=4",
    "--execute=create-agent-run"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (runtimeActionSpacesCli.status !== 0) {
  throw new Error(`Runtime action-spaces CLI execute failed:\n${runtimeActionSpacesCli.stdout}\n${runtimeActionSpacesCli.stderr}`);
}
const runtimeActionSpacesCliResult = JSON.parse(runtimeActionSpacesCli.stdout);
if (
  runtimeActionSpacesCliResult.schemaVersion !== "steambench.runtime-action-spaces-cli.v1" ||
  runtimeActionSpacesCliResult.summary?.executedActionId !== "create-agent-run" ||
  typeof runtimeActionSpacesCliResult.summary?.createdRunId !== "string" ||
  !String(runtimeActionSpacesCliResult.summary?.createdTaskId ?? "").startsWith("1145360:")
) {
  throw new Error("Runtime action-spaces CLI did not create a controller-ready agent run");
}
const agentRunSessionCli = spawnSync(
  process.execPath,
  [
    "scripts/agent-run-session.mjs",
    `--api=${baseUrl}`,
    `--agent-id=${agent.agent.id}`,
    `--task-id=${runtimeActionSpacesCliResult.summary.createdTaskId}`,
    "--ttl-seconds=120",
    "--create-livestream=true",
    "--livestream-status=scheduled",
    "--livestream-title=Smoke agent bridge stream"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (agentRunSessionCli.status !== 0) {
  throw new Error(`Agent run-session CLI failed:\n${agentRunSessionCli.stdout}\n${agentRunSessionCli.stderr}`);
}
const agentRunSessionCliResult = JSON.parse(agentRunSessionCli.stdout);
if (
  agentRunSessionCliResult.schemaVersion !== "steambench.agent-run-session-cli.v1" ||
  typeof agentRunSessionCliResult.summary?.runId !== "string" ||
  agentRunSessionCliResult.summary?.agentId !== agent.agent.id ||
  agentRunSessionCliResult.summary?.status !== "ready-for-actions" ||
  agentRunSessionCliResult.summary?.transport !== "virtual-controller" ||
  typeof agentRunSessionCliResult.summary?.controlSessionId !== "string" ||
  typeof agentRunSessionCliResult.summary?.livestreamId !== "string" ||
  agentRunSessionCliResult.summary?.livestreamStatus !== "scheduled" ||
  agentRunSessionCliResult.summary?.broadcastEndpoint !== `/api/broadcasts/${agentRunSessionCliResult.summary.livestreamId}` ||
  agentRunSessionCliResult.summary?.broadcastEvidenceBundleEndpoint !== `/api/broadcasts/${agentRunSessionCliResult.summary.livestreamId}/evidence-bundle` ||
  agentRunSessionCliResult.summary?.accessPacketReady !== true ||
  agentRunSessionCliResult.summary?.bridgeReady !== true ||
  agentRunSessionCliResult.summary?.executorReportEndpoint !== `/api/runs/${agentRunSessionCliResult.summary.runId}/controller-executor-reports` ||
  agentRunSessionCliResult.controlGrant?.schemaVersion !== "steambench.agent-control-grant.v1" ||
  agentRunSessionCliResult.controlGrant?.readyForBridge !== true ||
  !agentRunSessionCliResult.controlGrant?.allowedActionTypes?.includes("button") ||
  !agentRunSessionCliResult.controlGrant?.allowedActionTypes?.includes("stick") ||
  agentRunSessionCliResult.controlGrant?.endpoints?.actionBatch !== `/api/runs/${agentRunSessionCliResult.summary.runId}/action-batches` ||
  agentRunSessionCliResult.controlGrant?.endpoints?.executorReport !== `/api/runs/${agentRunSessionCliResult.summary.runId}/controller-executor-reports` ||
  agentRunSessionCliResult.controlGrant?.acceptedArtifactName !== "output.mp4" ||
  agentRunSessionCliResult.session?.accessPacket?.schemaVersion !== "steambench.runtime-control-access-packet.v1" ||
  agentRunSessionCliResult.session?.links?.executorReport !== `/api/runs/${agentRunSessionCliResult.summary.runId}/controller-executor-reports` ||
  agentRunSessionCliResult.session?.bridgeManifest?.schemaVersion !== "steambench.control-bridge-manifest.v1"
) {
  throw new Error("Agent run-session CLI did not return a bridge-ready runtime handoff");
}
const publicSteamIntake = await readJson("/api/public/steam/apps/620/intake?useFixture=true&limit=4");
if (
  publicSteamIntake.intake?.schemaVersion !== "steambench.public-steam-app-intake.v1" ||
  publicSteamIntake.intake?.appid !== 620 ||
  publicSteamIntake.intake?.canonicalArtifactName !== "output.mp4" ||
  publicSteamIntake.intake?.dataPolicy?.officialSteamSourcesOnly !== true ||
  !publicSteamIntake.intake?.dataPolicy?.allowedSources?.includes("ISteamApps/GetAppList/v2") ||
  publicSteamIntake.intake?.sourceCoverage?.sources?.achievement?.source !== "fixture" ||
	  !Array.isArray(publicSteamIntake.intake?.taskPipeline?.taskLadder) ||
	  publicSteamIntake.intake.taskPipeline.taskLadder.length !== 3 ||
	  !publicSteamIntake.intake?.runtimeContract?.stage2StartConstraints?.some((entry) => entry.includes("Do not call session.run_file")) ||
	  publicSteamIntake.intake?.publicEntrypoints?.taskActionSpaceTemplate !== `${baseUrl}/api/public/tasks/{taskId}/action-space` ||
	  publicSteamIntake.intake?.publicEntrypoints?.runnerContractTemplate !== `${baseUrl}/api/public/tasks/{taskId}/runner-contract` ||
	  publicSteamIntake.intake?.publicEntrypoints?.publicWatchTemplate !== `${baseUrl}/api/public/broadcasts/{streamId}/watch`
	) {
	  throw new Error("Public Steam app intake packet did not expose source-to-benchmark readiness");
	}
	const publicCatalog = await readJson(`/api/public/catalog?season=weekly&appid=${encodeURIComponent(String(1145360))}&transport=virtual-controller&bridgeable=true&provider=external&limit=4`);
	if (
	  publicCatalog.catalog?.schemaVersion !== "steambench.public-catalog.v1" ||
	  publicCatalog.catalog?.scope !== "weekly" ||
	  publicCatalog.catalog?.canonicalArtifactName !== "output.mp4" ||
	  publicCatalog.catalog?.filters?.appid !== 1145360 ||
	  publicCatalog.catalog?.filters?.transport !== "virtual-controller" ||
	  publicCatalog.catalog?.filters?.bridgeable !== true ||
	  publicCatalog.catalog?.totals?.bridgeableTasks < 1 ||
	  !publicCatalog.catalog?.games?.some((entry) => entry.appid === 1145360 && entry.bridgeableTasks >= 1) ||
	  !publicCatalog.catalog?.tasks?.some((entry) =>
	    entry.appid === 1145360 &&
	    entry.actionSpace?.transport === "virtual-controller" &&
	    entry.actionSpace?.bridgeable === true &&
	    entry.actionSpace?.requiresControlSession === true &&
	    entry.evidence?.canonicalArtifact === "output/output.mp4"
	  ) ||
	  !String(publicCatalog.catalog?.entrypoints?.quickstartTemplate ?? "").includes("/api/public/quickstart") ||
	  !String(publicCatalog.catalog?.entrypoints?.bridgeHandoffTemplate ?? "").includes("/api/public/tasks/{taskId}/bridge-handoff")
	) {
	  throw new Error("Public catalog did not expose bridgeable game/task discovery");
	}
	const publicCatalogCli = spawnSync(
	  process.execPath,
	  [
	    "scripts/public-catalog.mjs",
	    `--api=${baseUrl}`,
	    "--season=weekly",
	    "--appid=1145360",
	    "--transport=virtual-controller",
	    "--bridgeable=true",
	    "--provider=external",
	    "--limit=4"
	  ],
	  {
	    cwd: process.cwd(),
	    encoding: "utf8"
	  }
	);
	if (publicCatalogCli.status !== 0) {
	  throw new Error(`Public catalog CLI failed:\n${publicCatalogCli.stdout}\n${publicCatalogCli.stderr}`);
	}
	const publicCatalogCliResult = JSON.parse(publicCatalogCli.stdout);
	if (
	  publicCatalogCliResult.schemaVersion !== "steambench.public-catalog-cli.v1" ||
	  publicCatalogCliResult.summary?.valid !== true ||
	  publicCatalogCliResult.summary?.scope !== "weekly" ||
	  publicCatalogCliResult.summary?.games < 1 ||
	  publicCatalogCliResult.summary?.tasks < 1 ||
	  publicCatalogCliResult.summary?.bridgeableTasks < 1 ||
	  publicCatalogCliResult.summary?.firstTaskTransport !== "virtual-controller" ||
	  publicCatalogCliResult.summary?.firstTaskBridgeable !== true ||
	  publicCatalogCliResult.summary?.canonicalArtifact !== "output/output.mp4"
	) {
	  throw new Error("Public catalog CLI did not validate bridgeable discovery");
	}
	const publicStandings = await readJson(`/api/public/standings?season=all&appid=${encodeURIComponent(String(620))}&track=achievement&limit=4`);
	if (
	  publicStandings.standings?.schemaVersion !== "steambench.public-standings.v1" ||
	  publicStandings.standings?.scope !== "all" ||
	  publicStandings.standings?.canonicalArtifactName !== "output.mp4" ||
	  publicStandings.standings?.filters?.appid !== 620 ||
	  publicStandings.standings?.filters?.track !== "achievement" ||
	  publicStandings.standings?.totals?.rows < 1 ||
	  publicStandings.standings?.taskLeaderboards?.length < 1 ||
	  !publicStandings.standings?.taskLeaderboards?.every((entry) =>
	    entry.appid === 620 &&
	    entry.track === "achievement" &&
	    String(entry.links?.taskScoreboard ?? "").includes("/api/public/tasks/") &&
	    String(entry.links?.quickstart ?? "").includes("/api/public/quickstart")
	  ) ||
	  !String(publicStandings.standings?.entrypoints?.taskScoreboardTemplate ?? "").includes("/api/public/tasks/{taskId}/scoreboard") ||
	  !String(publicStandings.standings?.links?.catalog ?? "").includes("/api/public/catalog")
	) {
	  throw new Error("Public standings did not expose season leaderboard entrypoints");
	}
	const publicStandingsCli = spawnSync(
	  process.execPath,
	  [
	    "scripts/public-standings.mjs",
	    `--api=${baseUrl}`,
	    "--season=all",
	    "--appid=620",
	    "--track=achievement",
	    "--limit=4"
	  ],
	  {
	    cwd: process.cwd(),
	    encoding: "utf8"
	  }
	);
	if (publicStandingsCli.status !== 0) {
	  throw new Error(`Public standings CLI failed:\n${publicStandingsCli.stdout}\n${publicStandingsCli.stderr}`);
	}
	const publicStandingsCliResult = JSON.parse(publicStandingsCli.stdout);
	if (
	  publicStandingsCliResult.schemaVersion !== "steambench.public-standings-cli.v1" ||
	  publicStandingsCliResult.summary?.valid !== true ||
	  publicStandingsCliResult.summary?.scope !== "all" ||
	  publicStandingsCliResult.summary?.rows < 1 ||
	  publicStandingsCliResult.summary?.taskLeaderboards < 1
	) {
	  throw new Error("Public standings CLI did not validate season leaderboards");
	}
	const publicHub = await readJson(`/api/public/competition-hub?season=weekly&appid=${encodeURIComponent(String(1145360))}&taskId=${encodeURIComponent(runtimeActionSpacesCliResult.summary.createdTaskId)}&provider=external&limit=4`);
	if (
	  publicHub.hub?.schemaVersion !== "steambench.public-competition-hub.v1" ||
	  publicHub.hub?.scope !== "weekly" ||
	  publicHub.hub?.canonicalArtifactName !== "output.mp4" ||
	  publicHub.hub?.selected?.game?.appid !== 1145360 ||
	  publicHub.hub?.selected?.task?.id !== runtimeActionSpacesCliResult.summary.createdTaskId ||
	  publicHub.hub?.selected?.gamePack?.schemaVersion !== "steambench.public-game-benchmark-pack.v1" ||
	  publicHub.hub?.selected?.actionSpace?.schemaVersion !== "steambench.public-task-action-space.v1" ||
	  publicHub.hub?.selected?.raceEntry?.schemaVersion !== "steambench.public-task-race-entry.v1" ||
	  !String(publicHub.hub?.entrypoints?.eventEntryTemplate ?? "").includes("/api/public/events/weekly/entry") ||
	  !String(publicHub.hub?.entrypoints?.taskRaceEntryTemplate ?? "").includes("/api/public/tasks/{taskId}/race-entry") ||
	  !String(publicHub.hub?.entrypoints?.publicWatchTemplate ?? "").includes("/api/public/broadcasts/{streamId}/watch") ||
	  publicHub.hub?.featuredTasks?.length < 1
	) {
	  throw new Error("Public competition hub did not expose the selected Steam task race surface");
	}
	const publicHubCli = spawnSync(
	  process.execPath,
	  [
	    "scripts/public-hub.mjs",
	    `--api=${baseUrl}`,
	    "--season=weekly",
	    "--appid=1145360",
	    `--task-id=${runtimeActionSpacesCliResult.summary.createdTaskId}`,
	    "--provider=external",
	    "--limit=4"
	  ],
	  {
	    cwd: process.cwd(),
	    encoding: "utf8"
	  }
	);
	if (publicHubCli.status !== 0) {
	  throw new Error(`Public hub CLI failed:\n${publicHubCli.stdout}\n${publicHubCli.stderr}`);
	}
	const publicHubCliResult = JSON.parse(publicHubCli.stdout);
	if (
	  publicHubCliResult.schemaVersion !== "steambench.public-hub-cli.v1" ||
	  publicHubCliResult.summary?.valid !== true ||
	  publicHubCliResult.summary?.scope !== "weekly" ||
	  publicHubCliResult.summary?.selectedAppid !== 1145360 ||
	  publicHubCliResult.summary?.selectedTaskId !== runtimeActionSpacesCliResult.summary.createdTaskId ||
	  publicHubCliResult.summary?.featuredTasks < 1
	) {
	  throw new Error("Public hub CLI did not validate the public competition hub packet");
	}
	const publicEventEntry = await readJson(`/api/public/events/weekly/entry?appid=${encodeURIComponent(String(1145360))}&taskId=${encodeURIComponent(runtimeActionSpacesCliResult.summary.createdTaskId)}&humanUserId=${user.user.id}&agentId=${agent.agent.id}&provider=external&limit=4`);
	if (
	  publicEventEntry.entry?.schemaVersion !== "steambench.public-event-entry.v1" ||
	  publicEventEntry.entry?.scope !== "weekly" ||
	  publicEventEntry.entry?.canonicalArtifactName !== "output.mp4" ||
	  publicEventEntry.entry?.event?.id !== "event:weekly" ||
	  publicEventEntry.entry?.selected?.task?.id !== runtimeActionSpacesCliResult.summary.createdTaskId ||
	  publicEventEntry.entry?.selected?.task?.appid !== 1145360 ||
	  publicEventEntry.entry?.selected?.human?.id !== user.user.id ||
	  publicEventEntry.entry?.selected?.agent?.id !== agent.agent.id ||
	  publicEventEntry.entry?.readiness?.human?.status !== "ready-to-register" ||
	  publicEventEntry.entry?.readiness?.human?.canRegister !== true ||
	  publicEventEntry.entry?.readiness?.agent?.status !== "ready-to-register" ||
	  publicEventEntry.entry?.readiness?.agent?.canRegister !== true ||
	  publicEventEntry.entry?.readiness?.pair?.ready !== true ||
	  publicEventEntry.entry?.readiness?.pair?.registered !== false ||
	  publicEventEntry.entry?.registration?.endpoint !== `${baseUrl}/api/competition-events/weekly/register` ||
	  publicEventEntry.entry?.registration?.human?.bodyTemplate?.participantId !== user.user.id ||
	  publicEventEntry.entry?.registration?.agent?.bodyTemplate?.participantId !== agent.agent.id ||
	  publicEventEntry.entry?.packets?.quickstart?.schemaVersion !== "steambench.public-quickstart.v1" ||
	  publicEventEntry.entry?.packets?.raceEntry?.schemaVersion !== "steambench.public-task-race-entry.v1" ||
	  publicEventEntry.entry?.packets?.bridgeHandoff?.schemaVersion !== "steambench.public-bridge-handoff.v1" ||
	  publicEventEntry.entry?.packets?.opsReport?.schemaVersion !== "steambench.competition-event-ops-report.v1" ||
	  publicEventEntry.entry?.links?.resultCertificate !== `${baseUrl}/api/competition-events/weekly/result-certificate`
	) {
	  throw new Error("Public event entry packet did not expose event registration and race readiness");
	}
	const publicEventEntryCli = spawnSync(
	  process.execPath,
	  [
	    "scripts/public-event-entry.mjs",
	    `--api=${baseUrl}`,
	    "--scope=weekly",
	    "--appid=1145360",
	    `--task-id=${runtimeActionSpacesCliResult.summary.createdTaskId}`,
	    `--human-user-id=${user.user.id}`,
	    `--agent-id=${agent.agent.id}`,
	    "--provider=external",
	    "--limit=4"
	  ],
	  {
	    cwd: process.cwd(),
	    encoding: "utf8"
	  }
	);
	if (publicEventEntryCli.status !== 0) {
	  throw new Error(`Public event entry CLI failed:\n${publicEventEntryCli.stdout}\n${publicEventEntryCli.stderr}`);
	}
	const publicEventEntryCliResult = JSON.parse(publicEventEntryCli.stdout);
	if (
	  publicEventEntryCliResult.schemaVersion !== "steambench.public-event-entry-cli.v1" ||
	  publicEventEntryCliResult.summary?.valid !== true ||
	  publicEventEntryCliResult.summary?.scope !== "weekly" ||
	  publicEventEntryCliResult.summary?.selectedTaskId !== runtimeActionSpacesCliResult.summary.createdTaskId ||
	  publicEventEntryCliResult.summary?.selectedAppid !== 1145360 ||
	  publicEventEntryCliResult.summary?.humanStatus !== "ready-to-register" ||
	  publicEventEntryCliResult.summary?.agentStatus !== "ready-to-register" ||
	  publicEventEntryCliResult.summary?.pairReady !== true ||
	  publicEventEntryCliResult.summary?.pairRegistered !== false ||
	  publicEventEntryCliResult.summary?.bridgeHandoffStatus !== "ready-to-grant"
	) {
	  throw new Error("Public event entry CLI did not validate the public event entry packet");
	}
	const publicQuickstart = await readJson(`/api/public/quickstart?season=weekly&appid=${encodeURIComponent(String(1145360))}&taskId=${encodeURIComponent(runtimeActionSpacesCliResult.summary.createdTaskId)}&provider=external&limit=4`);
	const publicQuickstartStepIds = publicQuickstart.quickstart?.steps?.map((entry) => entry.id) ?? [];
	if (
	  publicQuickstart.quickstart?.schemaVersion !== "steambench.public-quickstart.v1" ||
	  publicQuickstart.quickstart?.scope !== "weekly" ||
	  publicQuickstart.quickstart?.canonicalArtifactName !== "output.mp4" ||
	  publicQuickstart.quickstart?.selected?.game?.appid !== 1145360 ||
	  publicQuickstart.quickstart?.selected?.task?.id !== runtimeActionSpacesCliResult.summary.createdTaskId ||
	  publicQuickstart.quickstart?.packets?.hub?.schemaVersion !== "steambench.public-competition-hub.v1" ||
	  publicQuickstart.quickstart?.packets?.actionSpace?.schemaVersion !== "steambench.public-task-action-space.v1" ||
	  publicQuickstart.quickstart?.packets?.agentOnboarding?.schemaVersion !== "steambench.public-agent-onboarding.v1" ||
	  publicQuickstart.quickstart?.readiness?.actionSpace?.bridgeable !== true ||
	  publicQuickstart.quickstart?.readiness?.actionSpace?.requiresControlSession !== true ||
	  publicQuickstart.quickstart?.readiness?.actionSpace?.privilegedSystemInput !== false ||
	  publicQuickstart.quickstart?.steps?.length < 12 ||
	  !["inspect-hub", "create-human", "link-steam", "inspect-agent-onboarding", "register-agent", "inspect-action-space", "inspect-race-entry", "match-preflight", "agent-run-session", "submit-action-batch", "submit-evidence", "watch-broadcast"].every((stepId) => publicQuickstartStepIds.includes(stepId)) ||
	  publicQuickstart.quickstart?.steps?.find((entry) => entry.id === "submit-evidence")?.bodyTemplate?.artifactPath !== "output/output.mp4" ||
	  !String(publicQuickstart.quickstart?.commands?.registerAgent ?? "").includes("public:agent") ||
	  !String(publicQuickstart.quickstart?.commands?.runAgentSession ?? "").includes("agent:run-session")
	) {
	  throw new Error("Public quickstart packet did not expose the public onboarding-to-run-session flow");
	}
	const publicQuickstartCli = spawnSync(
	  process.execPath,
	  [
	    "scripts/public-quickstart.mjs",
	    `--api=${baseUrl}`,
	    "--season=weekly",
	    "--appid=1145360",
	    `--task-id=${runtimeActionSpacesCliResult.summary.createdTaskId}`,
	    "--provider=external",
	    "--limit=4"
	  ],
	  {
	    cwd: process.cwd(),
	    encoding: "utf8"
	  }
	);
	if (publicQuickstartCli.status !== 0) {
	  throw new Error(`Public quickstart CLI failed:\n${publicQuickstartCli.stdout}\n${publicQuickstartCli.stderr}`);
	}
	const publicQuickstartCliResult = JSON.parse(publicQuickstartCli.stdout);
	if (
	  publicQuickstartCliResult.schemaVersion !== "steambench.public-quickstart-cli.v1" ||
	  publicQuickstartCliResult.summary?.valid !== true ||
	  publicQuickstartCliResult.summary?.scope !== "weekly" ||
	  publicQuickstartCliResult.summary?.selectedAppid !== 1145360 ||
	  publicQuickstartCliResult.summary?.selectedTaskId !== runtimeActionSpacesCliResult.summary.createdTaskId ||
	  publicQuickstartCliResult.summary?.bridgeable !== true ||
	  publicQuickstartCliResult.summary?.requiresControlSession !== true ||
	  publicQuickstartCliResult.summary?.canonicalArtifact !== "output/output.mp4" ||
	  publicQuickstartCliResult.summary?.steps < 12
	) {
	  throw new Error("Public quickstart CLI did not validate the public quickstart packet");
	}
	const publicControllerActionSpace = await readJson(`/api/public/tasks/${encodeURIComponent(runtimeActionSpacesCliResult.summary.createdTaskId)}/action-space?agentId=${agent.agent.id}`);
	if (
	  publicControllerActionSpace.actionSpace?.schemaVersion !== "steambench.public-task-action-space.v1" ||
	  publicControllerActionSpace.actionSpace?.task?.id !== runtimeActionSpacesCliResult.summary.createdTaskId ||
	  publicControllerActionSpace.actionSpace?.permissions?.inputMode !== "controller" ||
	  publicControllerActionSpace.actionSpace?.permissions?.transport !== "virtual-controller" ||
	  publicControllerActionSpace.actionSpace?.permissions?.privilegedSystemInput !== false ||
	  publicControllerActionSpace.actionSpace?.bridge?.bridgeable !== true ||
	  publicControllerActionSpace.actionSpace?.controlSession?.requiredBeforeHostInput !== true ||
	  publicControllerActionSpace.actionSpace?.exampleActionBatch?.executionPlanPreview?.schemaVersion !== "steambench.controller-execution-plan.v1" ||
	  publicControllerActionSpace.actionSpace?.evidence?.canonicalArtifact !== "output/output.mp4"
	) {
	  throw new Error("Public task action-space packet did not expose controller bridge permissions");
	}
	const publicAgentOnboarding = await readJson(`/api/public/agents/onboarding?taskId=${encodeURIComponent(runtimeActionSpacesCliResult.summary.createdTaskId)}&agentId=${agent.agent.id}&provider=external&limit=4`);
	if (
	  publicAgentOnboarding.onboarding?.schemaVersion !== "steambench.public-agent-onboarding.v1" ||
	  publicAgentOnboarding.onboarding?.status !== "ready-to-run" ||
	  publicAgentOnboarding.onboarding?.selectedTask?.id !== runtimeActionSpacesCliResult.summary.createdTaskId ||
	  publicAgentOnboarding.onboarding?.selectedAgent?.id !== agent.agent.id ||
	  publicAgentOnboarding.onboarding?.registration?.endpoint !== `${baseUrl}/api/agents` ||
	  !publicAgentOnboarding.onboarding?.registration?.requiredCapabilities?.includes("controller") ||
	  !publicAgentOnboarding.onboarding?.registration?.recommendedCapabilities?.includes("geforce-now-bridge") ||
	  publicAgentOnboarding.onboarding?.actionSpace?.transport !== "virtual-controller" ||
	  publicAgentOnboarding.onboarding?.runEntry?.runSession !== `${baseUrl}/api/agents/${agent.agent.id}/run-session`
	) {
	  throw new Error("Public agent onboarding packet did not expose agent registration and run-session readiness");
	}
	const publicAgentCli = spawnSync(
	  process.execPath,
	  [
	    "scripts/public-agent.mjs",
	    `--api=${baseUrl}`,
	    `--task-id=${runtimeActionSpacesCliResult.summary.createdTaskId}`,
	    "--provider=external",
	    "--execute=register",
	    `--handle=smoke-public-agent-${Date.now().toString(36)}`,
	    "--limit=4"
	  ],
	  {
	    cwd: process.cwd(),
	    encoding: "utf8"
	  }
	);
	if (publicAgentCli.status !== 0) {
	  throw new Error(`Public agent CLI failed:\n${publicAgentCli.stdout}\n${publicAgentCli.stderr}`);
	}
	const publicAgentCliResult = JSON.parse(publicAgentCli.stdout);
	if (
	  publicAgentCliResult.schemaVersion !== "steambench.public-agent-cli.v1" ||
	  publicAgentCliResult.validation?.valid !== true ||
	  publicAgentCliResult.summary?.registered !== true ||
	  publicAgentCliResult.summary?.status !== "ready-to-run" ||
	  publicAgentCliResult.summary?.selectedTaskId !== runtimeActionSpacesCliResult.summary.createdTaskId ||
	  publicAgentCliResult.summary?.ready !== true ||
	  publicAgentCliResult.summary?.actionSpaceTransport !== "virtual-controller" ||
	  publicAgentCliResult.summary?.bridgeable !== true ||
	  !String(publicAgentCliResult.summary?.runSession ?? "").includes("/api/agents/")
	) {
	  throw new Error("Public agent CLI did not register and refresh a ready agent onboarding packet");
	}
	const publicActionSpaceCli = spawnSync(
	  process.execPath,
	  [
	    "scripts/public-action-space.mjs",
	    `--api=${baseUrl}`,
	    `--task-id=${runtimeActionSpacesCliResult.summary.createdTaskId}`,
	    `--agent-id=${agent.agent.id}`
	  ],
	  {
	    cwd: process.cwd(),
	    encoding: "utf8"
	  }
	);
	if (publicActionSpaceCli.status !== 0) {
	  throw new Error(`Public action-space CLI failed:\n${publicActionSpaceCli.stdout}\n${publicActionSpaceCli.stderr}`);
	}
	const publicActionSpaceCliResult = JSON.parse(publicActionSpaceCli.stdout);
	if (
	  publicActionSpaceCliResult.schemaVersion !== "steambench.public-action-space-cli.v1" ||
	  publicActionSpaceCliResult.validation?.valid !== true ||
	  publicActionSpaceCliResult.summary?.taskId !== runtimeActionSpacesCliResult.summary.createdTaskId ||
	  publicActionSpaceCliResult.summary?.inputMode !== "controller" ||
	  publicActionSpaceCliResult.summary?.transport !== "virtual-controller" ||
	  publicActionSpaceCliResult.summary?.bridgeable !== true ||
	  publicActionSpaceCliResult.summary?.requiresControlSession !== true ||
	  publicActionSpaceCliResult.summary?.canonicalArtifact !== "output/output.mp4" ||
	  !publicActionSpaceCliResult.summary?.allowedActionTypes?.includes("button")
	) {
	  throw new Error("Public action-space CLI did not validate controller bridge permissions");
	}
	const publicBridgeHandoff = await readJson(`/api/public/tasks/${encodeURIComponent(runtimeActionSpacesCliResult.summary.createdTaskId)}/bridge-handoff?agentId=${agent.agent.id}&provider=external&ttlSeconds=900`);
	if (
	  publicBridgeHandoff.handoff?.schemaVersion !== "steambench.public-bridge-handoff.v1" ||
	  publicBridgeHandoff.handoff?.status !== "ready-to-grant" ||
	  publicBridgeHandoff.handoff?.task?.id !== runtimeActionSpacesCliResult.summary.createdTaskId ||
	  publicBridgeHandoff.handoff?.selectedAgent?.id !== agent.agent.id ||
	  publicBridgeHandoff.handoff?.bridgeable !== true ||
	  publicBridgeHandoff.handoff?.permissions?.inputMode !== "controller" ||
	  publicBridgeHandoff.handoff?.permissions?.transport !== "virtual-controller" ||
	  publicBridgeHandoff.handoff?.permissions?.privilegedSystemInput !== false ||
	  publicBridgeHandoff.handoff?.grant?.endpoint !== `${baseUrl}/api/agents/${agent.agent.id}/run-session` ||
	  publicBridgeHandoff.handoff?.grant?.bodyTemplate?.createControlSession !== true ||
	  publicBridgeHandoff.handoff?.postGrantPackets?.accessPacket?.schemaVersion !== "steambench.runtime-control-access-packet.v1" ||
	  publicBridgeHandoff.handoff?.postGrantPackets?.bridgeManifest?.schemaVersion !== "steambench.control-bridge-manifest.v1" ||
	  publicBridgeHandoff.handoff?.executor?.requestSchemaVersion !== "steambench.controller-executor-request.v1" ||
	  publicBridgeHandoff.handoff?.executor?.reportSchemaVersion !== "steambench.controller-executor-report.v1" ||
	  publicBridgeHandoff.handoff?.actionBatch?.executionPlanPreview?.schemaVersion !== "steambench.controller-execution-plan.v1" ||
	  publicBridgeHandoff.handoff?.evidence?.canonicalArtifact !== "output/output.mp4"
	) {
	  throw new Error("Public bridge handoff packet did not expose GeForce NOW grant and executor requirements");
	}
	const publicBridgeHandoffCli = spawnSync(
	  process.execPath,
	  [
	    "scripts/public-bridge-handoff.mjs",
	    `--api=${baseUrl}`,
	    `--task-id=${runtimeActionSpacesCliResult.summary.createdTaskId}`,
	    `--agent-id=${agent.agent.id}`,
	    "--provider=external",
	    "--ttl-seconds=900"
	  ],
	  {
	    cwd: process.cwd(),
	    encoding: "utf8"
	  }
	);
	if (publicBridgeHandoffCli.status !== 0) {
	  throw new Error(`Public bridge handoff CLI failed:\n${publicBridgeHandoffCli.stdout}\n${publicBridgeHandoffCli.stderr}`);
	}
	const publicBridgeHandoffCliResult = JSON.parse(publicBridgeHandoffCli.stdout);
	if (
	  publicBridgeHandoffCliResult.schemaVersion !== "steambench.public-bridge-handoff-cli.v1" ||
	  publicBridgeHandoffCliResult.summary?.valid !== true ||
	  publicBridgeHandoffCliResult.summary?.status !== "ready-to-grant" ||
	  publicBridgeHandoffCliResult.summary?.taskId !== runtimeActionSpacesCliResult.summary.createdTaskId ||
	  publicBridgeHandoffCliResult.summary?.agentId !== agent.agent.id ||
	  publicBridgeHandoffCliResult.summary?.bridgeable !== true ||
	  publicBridgeHandoffCliResult.summary?.createsControlSession !== true ||
	  publicBridgeHandoffCliResult.summary?.accessPacket !== "steambench.runtime-control-access-packet.v1" ||
	  publicBridgeHandoffCliResult.summary?.bridgeManifest !== "steambench.control-bridge-manifest.v1" ||
	  publicBridgeHandoffCliResult.summary?.executorRequest !== "steambench.controller-executor-request.v1" ||
	  publicBridgeHandoffCliResult.summary?.executorReport !== "steambench.controller-executor-report.v1" ||
	  publicBridgeHandoffCliResult.summary?.canonicalArtifact !== "output/output.mp4"
	) {
	  throw new Error("Public bridge handoff CLI did not validate the bridge handoff packet");
	}
	const publicSteamIntakeCli = spawnSync(
  process.execPath,
  [
    "scripts/public-steam-intake.mjs",
    `--api=${baseUrl}`,
    "--appid=620",
    "--fixture=true",
    "--limit=4"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (publicSteamIntakeCli.status !== 0) {
  throw new Error(`Public Steam intake CLI failed:\n${publicSteamIntakeCli.stdout}\n${publicSteamIntakeCli.stderr}`);
}
const publicSteamIntakeCliResult = JSON.parse(publicSteamIntakeCli.stdout);
if (
  publicSteamIntakeCliResult.schemaVersion !== "steambench.public-steam-intake-cli.v1" ||
  publicSteamIntakeCliResult.validation?.valid !== true ||
  publicSteamIntakeCliResult.summary?.appid !== 620 ||
  publicSteamIntakeCliResult.summary?.game !== "Portal 2" ||
  typeof publicSteamIntakeCliResult.summary?.publicReadiness !== "string" ||
  publicSteamIntakeCliResult.summary?.sourceRecords < 1 ||
  !publicSteamIntakeCliResult.summary?.onboardingStages?.some((entry) => entry.startsWith("achievement-ladder:")) ||
  !Array.isArray(publicSteamIntakeCliResult.summary?.actions)
) {
  throw new Error("Public Steam intake CLI did not validate the app intake packet");
}
const publicExportCli = spawnSync(
  process.execPath,
  [
    "scripts/public-benchmark-export.mjs",
    `--api=${baseUrl}`,
    "--season=weekly",
    "--appid=620",
    "--task-id=620:ACH.WAKE_UP",
    "--limit=12",
    "--fixture=true"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (publicExportCli.status !== 0) {
  throw new Error(`Public benchmark export CLI failed:\n${publicExportCli.stdout}\n${publicExportCli.stderr}`);
}
const publicExportCliResult = JSON.parse(publicExportCli.stdout);
if (
  publicExportCliResult.schemaVersion !== "steambench.public-benchmark-export.v1" ||
  publicExportCliResult.summary?.valid !== true ||
	  publicExportCliResult.catalog?.schemaVersion !== "steambench.public-catalog.v1" ||
	  publicExportCliResult.summary?.catalogGames < 1 ||
	  publicExportCliResult.summary?.catalogTasks < 1 ||
	  publicExportCliResult.sources?.catalog !== `${baseUrl}/api/public/catalog?season=weekly&appid=620&provider=external&limit=12` ||
	  publicExportCliResult.publicStandings?.schemaVersion !== "steambench.public-standings.v1" ||
	  publicExportCliResult.summary?.publicStandingsRows < 1 ||
	  publicExportCliResult.summary?.publicStandingsTaskLeaderboards < 1 ||
	  publicExportCliResult.sources?.publicStandings !== `${baseUrl}/api/public/standings?season=weekly&appid=620&limit=12` ||
	  publicExportCliResult.summary?.intakeReadiness !== publicExportCliResult.steamIntake?.publicReadiness ||
	  publicExportCliResult.summary?.intakeSourceRecords < 1 ||
	  publicExportCliResult.hub?.schemaVersion !== "steambench.public-competition-hub.v1" ||
	  publicExportCliResult.summary?.hubSelectedTaskId !== "620:ACH.WAKE_UP" ||
	  publicExportCliResult.sources?.hub !== `${baseUrl}/api/public/competition-hub?season=weekly&appid=620&taskId=620%3AACH.WAKE_UP&provider=external&limit=12` ||
	  publicExportCliResult.eventEntry?.schemaVersion !== "steambench.public-event-entry.v1" ||
	  publicExportCliResult.summary?.eventEntryScope !== "weekly" ||
	  publicExportCliResult.sources?.eventEntry !== `${baseUrl}/api/public/events/weekly/entry?appid=620&taskId=620%3AACH.WAKE_UP&provider=external&limit=12` ||
	  publicExportCliResult.quickstart?.schemaVersion !== "steambench.public-quickstart.v1" ||
	  publicExportCliResult.summary?.quickstartSteps < 12 ||
	  publicExportCliResult.sources?.quickstart !== `${baseUrl}/api/public/quickstart?season=weekly&appid=620&taskId=620%3AACH.WAKE_UP&provider=external&limit=12` ||
	  publicExportCliResult.sources?.steamIntake !== `${baseUrl}/api/public/steam/apps/620/intake?limit=12&useFixture=true` ||
	  publicExportCliResult.steamIntake?.schemaVersion !== "steambench.public-steam-app-intake.v1" ||
	  publicExportCliResult.agentOnboarding?.schemaVersion !== "steambench.public-agent-onboarding.v1" ||
	  publicExportCliResult.summary?.agentOnboardingStatus !== publicExportCliResult.agentOnboarding?.status ||
	  publicExportCliResult.sources?.agentOnboarding !== `${baseUrl}/api/public/agents/onboarding?taskId=620%3AACH.WAKE_UP&provider=external&limit=12` ||
	  publicExportCliResult.gamePack?.schemaVersion !== "steambench.public-game-benchmark-pack.v1" ||
	  publicExportCliResult.taskScoreboard?.schemaVersion !== "steambench.public-task-scoreboard.v1" ||
	  publicExportCliResult.taskActionSpace?.schemaVersion !== "steambench.public-task-action-space.v1" ||
	  publicExportCliResult.summary?.actionSpaceInputMode !== publicExportCliResult.taskActionSpace?.permissions?.inputMode ||
	  publicExportCliResult.sources?.taskActionSpace !== `${baseUrl}/api/public/tasks/620%3AACH.WAKE_UP/action-space` ||
	  publicExportCliResult.bridgeHandoff?.schemaVersion !== "steambench.public-bridge-handoff.v1" ||
	  publicExportCliResult.summary?.bridgeHandoffStatus !== publicExportCliResult.bridgeHandoff?.status ||
	  publicExportCliResult.sources?.bridgeHandoff !== `${baseUrl}/api/public/tasks/620%3AACH.WAKE_UP/bridge-handoff?provider=external&ttlSeconds=900` ||
	  publicExportCliResult.raceEntry?.schemaVersion !== "steambench.public-task-race-entry.v1" ||
	  publicExportCliResult.summary?.raceEntryHumanStatus !== publicExportCliResult.raceEntry?.human?.status ||
	  publicExportCliResult.sources?.raceEntry !== `${baseUrl}/api/public/tasks/620%3AACH.WAKE_UP/race-entry?provider=external&limit=12` ||
	  publicExportCliResult.runnerContract?.schemaVersion !== "steambench.public-task-runner-contract.v1"
	) {
  throw new Error("Public benchmark export did not include the Steam intake-to-runner bundle");
}
const publicRunnerCli = spawnSync(
  process.execPath,
  [
    "scripts/public-runner.mjs",
    `--api=${baseUrl}`,
    `--task-id=${runtimeActionSpacesCliResult.summary.createdTaskId}`,
    `--agent-id=${agent.agent.id}`,
    "--execute=advance-public-runner",
    `--idempotency-key=smoke-public-runner-${Date.now().toString(36)}`
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (publicRunnerCli.status !== 0) {
  throw new Error(`Public runner CLI failed:\n${publicRunnerCli.stdout}\n${publicRunnerCli.stderr}`);
}
const publicRunnerCliResult = JSON.parse(publicRunnerCli.stdout);
if (
  publicRunnerCliResult.schemaVersion !== "steambench.public-runner-cli.v1" ||
  publicRunnerCliResult.validation?.valid !== true ||
  publicRunnerCliResult.contract?.taskId !== runtimeActionSpacesCliResult.summary.createdTaskId ||
  publicRunnerCliResult.contract?.bridgeRequired !== true ||
  publicRunnerCliResult.contract?.executorRequest !== "steambench.controller-executor-request.v1" ||
  publicRunnerCliResult.summary?.acceptedActions < 1 ||
  publicRunnerCliResult.summary?.executorReported !== true ||
  publicRunnerCliResult.summary?.bridgeReady !== true ||
  publicRunnerCliResult.executor?.sideEffects !== false ||
  publicRunnerCliResult.executor?.traceExecutorReports < 1 ||
  publicRunnerCliResult.actionBatch?.executionPlan?.schemaVersion !== "steambench.controller-execution-plan.v1" ||
  publicRunnerCliResult.actionBatch?.executorRequest?.schemaVersion !== "steambench.controller-executor-request.v1"
) {
  throw new Error("Public runner CLI did not advance a public runner contract through controller executor audit");
}
const publicSubmitCli = spawnSync(
  process.execPath,
  [
    "scripts/public-submit.mjs",
    `--api=${baseUrl}`,
    `--run-id=${publicRunnerCliResult.summary.runId}`,
    "--artifact-path=output/output.mp4",
    "--allow-mock=true",
    "--steam-achieved=true",
    "--remote-verify=true",
    `--idempotency-key=smoke-public-submit-${Date.now().toString(36)}`
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (publicSubmitCli.status !== 0) {
  throw new Error(`Public submit CLI failed:\n${publicSubmitCli.stdout}\n${publicSubmitCli.stderr}`);
}
const publicSubmitCliResult = JSON.parse(publicSubmitCli.stdout);
if (
  publicSubmitCliResult.schemaVersion !== "steambench.public-submit-cli.v1" ||
  publicSubmitCliResult.summary?.valid !== true ||
  publicSubmitCliResult.summary?.runId !== publicRunnerCliResult.summary.runId ||
  publicSubmitCliResult.summary?.scoreboardReady !== true ||
  publicSubmitCliResult.summary?.evaluationPassed !== true ||
  publicSubmitCliResult.summary?.auditVerdict !== "scoreboard-ready" ||
  publicSubmitCliResult.summary?.certificateReady !== true ||
  publicSubmitCliResult.summary?.localCertificateValid !== true ||
  publicSubmitCliResult.summary?.remoteCertificateValid !== true ||
  publicSubmitCliResult.receipt?.schemaVersion !== "steambench.run-submission-receipt.v1" ||
  publicSubmitCliResult.bundle?.schemaVersion !== "steambench.evidence-bundle.v1" ||
  publicSubmitCliResult.bundle?.executorReportCount < 1 ||
  publicSubmitCliResult.certificate?.schemaVersion !== "steambench.result-certificate.v1" ||
  !/^[a-f0-9]{64}$/.test(String(publicSubmitCliResult.summary?.fingerprint ?? ""))
) {
  throw new Error("Public submit CLI did not produce a verified scoreboard-ready result certificate");
}
const publicTaskScoreboard = await readJson(
  `/api/public/tasks/${encodeURIComponent(runtimeActionSpacesCliResult.summary.createdTaskId)}/scoreboard?season=all&limit=10`
);
if (
  publicTaskScoreboard.scoreboard?.schemaVersion !== "steambench.public-task-scoreboard.v1" ||
  publicTaskScoreboard.scoreboard?.canonicalArtifactName !== "output.mp4" ||
  publicTaskScoreboard.scoreboard?.task?.id !== runtimeActionSpacesCliResult.summary.createdTaskId ||
  publicTaskScoreboard.scoreboard?.totals?.agentRows < 1 ||
  publicTaskScoreboard.scoreboard?.matchup?.agentLeader?.runId !== publicRunnerCliResult.summary.runId ||
  publicTaskScoreboard.scoreboard?.matchup?.agentLeader?.links?.resultCertificate !== `${baseUrl}/api/runs/${publicRunnerCliResult.summary.runId}/result-certificate` ||
  !publicTaskScoreboard.scoreboard?.agentEntries?.some((entry) =>
    entry.runId === publicRunnerCliResult.summary.runId &&
    entry.canonicalArtifactName === "output.mp4" &&
    entry.links?.evidenceBundle === `${baseUrl}/api/runs/${publicRunnerCliResult.summary.runId}/evidence-bundle`
  )
) {
  throw new Error("Public task scoreboard did not expose the verified public runner submission");
}
const publicHumanCli = spawnSync(
  process.execPath,
  [
    "scripts/public-human.mjs",
    `--api=${baseUrl}`,
    `--task-id=${runtimeActionSpacesCliResult.summary.createdTaskId}`,
    "--execute=advance-public-human",
    `--handle=smoke-public-human-${Date.now().toString(36)}`,
    "--steamid=76561198000000999",
    "--proof-consent=true",
    "--remote-verify=true"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (publicHumanCli.status !== 0) {
  throw new Error(`Public human CLI failed:\n${publicHumanCli.stdout}\n${publicHumanCli.stderr}`);
}
const publicHumanCliResult = JSON.parse(publicHumanCli.stdout);
if (
  publicHumanCliResult.schemaVersion !== "steambench.public-human-cli.v1" ||
  publicHumanCliResult.summary?.valid !== true ||
  publicHumanCliResult.summary?.taskId !== runtimeActionSpacesCliResult.summary.createdTaskId ||
  publicHumanCliResult.summary?.createdHuman !== true ||
  publicHumanCliResult.summary?.linkedSteam !== true ||
  publicHumanCliResult.summary?.proofConsented !== true ||
  publicHumanCliResult.summary?.scoreboardReady !== true ||
  publicHumanCliResult.summary?.certificateReady !== true ||
  publicHumanCliResult.summary?.localCertificateValid !== true ||
  publicHumanCliResult.summary?.remoteCertificateValid !== true ||
  publicHumanCliResult.summary?.publicScoreboardHasRun !== true ||
  !/^[a-f0-9]{64}$/.test(String(publicHumanCliResult.summary?.fingerprint ?? ""))
) {
  throw new Error("Public human CLI did not create a verified scoreboard-ready human task submission");
}
const publicTaskScoreboardAfterHuman = await readJson(
  `/api/public/tasks/${encodeURIComponent(runtimeActionSpacesCliResult.summary.createdTaskId)}/scoreboard?season=all&limit=20`
);
if (
  publicTaskScoreboardAfterHuman.scoreboard?.totals?.humanRows < 1 ||
  publicTaskScoreboardAfterHuman.scoreboard?.totals?.agentRows < 1 ||
  !publicTaskScoreboardAfterHuman.scoreboard?.humanEntries?.some((entry) => entry.runId === publicHumanCliResult.summary.runId) ||
  !publicTaskScoreboardAfterHuman.scoreboard?.agentEntries?.some((entry) => entry.runId === publicRunnerCliResult.summary.runId)
) {
  throw new Error("Public task scoreboard did not contain both human and agent public submissions");
}
const publicRaceEntry = await readJson(
  `/api/public/tasks/${encodeURIComponent(runtimeActionSpacesCliResult.summary.createdTaskId)}/race-entry?humanUserId=${user.user.id}&agentId=${agent.agent.id}&provider=external&limit=4`
);
if (
  publicRaceEntry.raceEntry?.schemaVersion !== "steambench.public-task-race-entry.v1" ||
  publicRaceEntry.raceEntry?.task?.id !== runtimeActionSpacesCliResult.summary.createdTaskId ||
  publicRaceEntry.raceEntry?.human?.status !== "ready" ||
  publicRaceEntry.raceEntry?.human?.ready !== true ||
  publicRaceEntry.raceEntry?.human?.entryPacket?.schemaVersion !== "steambench.human-benchmark-entry-packet.v1" ||
  publicRaceEntry.raceEntry?.human?.entryPacket?.evidence?.canonicalArtifact !== "output/output.mp4" ||
  publicRaceEntry.raceEntry?.agent?.status !== "ready-to-run" ||
  publicRaceEntry.raceEntry?.agent?.ready !== true ||
  publicRaceEntry.raceEntry?.actionSpace?.bridge?.bridgeable !== true ||
  publicRaceEntry.raceEntry?.match?.preflight?.bodyTemplate?.humanUserId !== user.user.id ||
  publicRaceEntry.raceEntry?.match?.preflight?.bodyTemplate?.agentId !== agent.agent.id ||
  publicRaceEntry.raceEntry?.runnerContract?.endpoint !== `${baseUrl}/api/public/tasks/${encodeURIComponent(runtimeActionSpacesCliResult.summary.createdTaskId)}/runner-contract?agentId=${agent.agent.id}`
) {
  throw new Error("Public race-entry packet did not expose human proof, agent action-space, and match preflight readiness");
}
const publicRaceEntryCli = spawnSync(
  process.execPath,
  [
    "scripts/public-race-entry.mjs",
    `--api=${baseUrl}`,
    `--task-id=${runtimeActionSpacesCliResult.summary.createdTaskId}`,
    `--human-user-id=${user.user.id}`,
    `--agent-id=${agent.agent.id}`,
    "--provider=external",
    "--limit=4"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (publicRaceEntryCli.status !== 0) {
  throw new Error(`Public race-entry CLI failed:\n${publicRaceEntryCli.stdout}\n${publicRaceEntryCli.stderr}`);
}
const publicRaceEntryCliResult = JSON.parse(publicRaceEntryCli.stdout);
if (
  publicRaceEntryCliResult.schemaVersion !== "steambench.public-race-entry-cli.v1" ||
  publicRaceEntryCliResult.summary?.valid !== true ||
  publicRaceEntryCliResult.summary?.taskId !== runtimeActionSpacesCliResult.summary.createdTaskId ||
  publicRaceEntryCliResult.summary?.humanReady !== true ||
  publicRaceEntryCliResult.summary?.agentReady !== true ||
  publicRaceEntryCliResult.summary?.bridgeable !== true ||
  publicRaceEntryCliResult.summary?.canonicalArtifact !== "output/output.mp4"
) {
  throw new Error("Public race-entry CLI did not validate a ready public race packet");
}
const publicMatchCli = spawnSync(
  process.execPath,
  [
    "scripts/public-match.mjs",
    `--api=${baseUrl}`,
    `--task-id=${runtimeActionSpacesCliResult.summary.createdTaskId}`,
    `--human-user-id=${publicHumanCliResult.summary.userId}`,
    `--agent-id=${agent.agent.id}`,
    "--execute=advance-public-match",
    "--review-approved=true",
    "--remote-verify=true"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (publicMatchCli.status !== 0) {
  throw new Error(`Public match CLI failed:\n${publicMatchCli.stdout}\n${publicMatchCli.stderr}`);
}
const publicMatchCliResult = JSON.parse(publicMatchCli.stdout);
if (
  publicMatchCliResult.schemaVersion !== "steambench.public-match-cli.v1" ||
  publicMatchCliResult.summary?.valid !== true ||
  publicMatchCliResult.summary?.taskId !== runtimeActionSpacesCliResult.summary.createdTaskId ||
  publicMatchCliResult.summary?.matchStatus !== "scored" ||
  typeof publicMatchCliResult.summary?.matchId !== "string" ||
  typeof publicMatchCliResult.summary?.humanRunId !== "string" ||
  typeof publicMatchCliResult.summary?.agentRunId !== "string" ||
  publicMatchCliResult.summary?.arenaReadyForPublicShare !== true ||
  publicMatchCliResult.summary?.certificateReady !== true ||
  publicMatchCliResult.summary?.localCertificateValid !== true ||
  publicMatchCliResult.summary?.remoteCertificateValid !== true ||
  publicMatchCliResult.summary?.publicScoreboardHasHumanRun !== true ||
  publicMatchCliResult.summary?.publicScoreboardHasAgentRun !== true ||
  !/^[a-f0-9]{64}$/.test(String(publicMatchCliResult.summary?.fingerprint ?? ""))
) {
  throw new Error("Public match CLI did not create a verified human-vs-agent match certificate");
}
const agentRunSessionStartBroadcastCli = spawnSync(
  process.execPath,
  [
    "scripts/platform-ops.mjs",
    `--api=${baseUrl}`,
    "--limit=10",
    "--execute=broadcasts:start-scheduled-broadcast"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (agentRunSessionStartBroadcastCli.status !== 0) {
  throw new Error(`Broadcast ops start scheduled CLI failed:\n${agentRunSessionStartBroadcastCli.stdout}\n${agentRunSessionStartBroadcastCli.stderr}`);
}
const agentRunSessionStartBroadcastResult = JSON.parse(agentRunSessionStartBroadcastCli.stdout);
if (
  agentRunSessionStartBroadcastResult.schemaVersion !== "steambench.platform-ops-cli.v1" ||
  agentRunSessionStartBroadcastResult.summary?.executedActionId !== "broadcasts:start-scheduled-broadcast" ||
  agentRunSessionStartBroadcastResult.summary?.streamId !== agentRunSessionCliResult.summary.livestreamId ||
  agentRunSessionStartBroadcastResult.summary?.streamStatus !== "live"
) {
  throw new Error("Platform ops CLI did not start the scheduled agent run-session broadcast");
}
const agentRunSessionBroadcast = await readJson(agentRunSessionCliResult.summary.broadcastEndpoint);
if (
  agentRunSessionBroadcast.broadcast?.stream?.id !== agentRunSessionCliResult.summary.livestreamId ||
  agentRunSessionBroadcast.broadcast?.stream?.status !== "live" ||
  agentRunSessionBroadcast.broadcast?.run?.id !== agentRunSessionCliResult.summary.runId
) {
  throw new Error("Agent run-session CLI did not create a live broadcast handoff");
}
const agentRunSessionHandoff = await readJson(`/api/runs/${agentRunSessionCliResult.summary.runId}/agent-handoff?agentId=${agent.agent.id}`);
if (
  agentRunSessionHandoff.handoff?.broadcast?.activeStream?.id !== agentRunSessionCliResult.summary.livestreamId ||
  agentRunSessionHandoff.handoff?.control?.activeSession?.executorReport !==
    `/api/runs/${agentRunSessionCliResult.summary.runId}/controller-executor-reports` ||
  agentRunSessionHandoff.handoff?.endpoints?.activeExecutorReport !==
    `/api/runs/${agentRunSessionCliResult.summary.runId}/controller-executor-reports` ||
  agentRunSessionHandoff.handoff?.endpoints?.activeBroadcast !== agentRunSessionCliResult.summary.broadcastEndpoint ||
  agentRunSessionHandoff.handoff?.recommendedActions?.some((action) => action.id === "inspect-broadcast") !== true
) {
  throw new Error("Agent handoff did not preserve the live broadcast and executor report context from run-session");
}

const coverageSchedule = await readJson("/api/games/620/coverage-plan/schedule", {
  method: "POST",
  body: JSON.stringify({
    humanUserId: user.user.id,
    agentId: agent.agent.id,
    limit: 2,
    provider: "local",
    dispatch: true
  })
});
if (
  coverageSchedule.schedule?.schemaVersion !== "steambench.game-coverage-schedule.v1" ||
  coverageSchedule.schedule?.appid !== 620 ||
  coverageSchedule.schedule?.selectedHuman?.id !== user.user.id ||
  coverageSchedule.schedule?.selectedAgent?.id !== agent.agent.id ||
  coverageSchedule.schedule?.totals?.queuedRuns < 1 ||
  coverageSchedule.schedule?.totals?.dispatches !== coverageSchedule.schedule?.totals?.agentRuns ||
  !coverageSchedule.schedule?.items?.every((entry) => entry.run?.status === "queued" && entry.run?.artifactName === "output.mp4")
) {
  throw new Error("Game coverage scheduler did not queue ready Portal 2 coverage runs");
}
const coverageLocalRun = await readJson("/api/games/620/coverage-plan/run-local", {
  method: "POST",
  body: JSON.stringify({
    humanUserId: user.user.id,
    agentId: agent.agent.id,
    limit: 2
  })
});
if (
  coverageLocalRun.result?.schemaVersion !== "steambench.game-coverage-local-run.v1" ||
  !coverageLocalRun.result?.record?.id ||
  coverageLocalRun.result?.appid !== 620 ||
  coverageLocalRun.result?.selectedHuman?.id !== user.user.id ||
  coverageLocalRun.result?.selectedAgent?.id !== agent.agent.id ||
  coverageLocalRun.result?.totals?.completedRuns < 1 ||
  coverageLocalRun.result?.totals?.scoreboardReady !== coverageLocalRun.result?.totals?.completedRuns ||
  ![...coverageLocalRun.result.submissions, ...coverageLocalRun.result.simulations].every((entry) =>
    entry.run?.status === "scored" &&
    entry.run?.artifactName === "output.mp4" &&
    entry.bundle?.schemaVersion === "steambench.evidence-bundle.v1" &&
    entry.certificate?.schemaVersion === "steambench.result-certificate.v1"
  )
) {
  throw new Error("Game coverage local runner did not complete ready Portal 2 coverage runs");
}
const coverageRuns = await readJson("/api/games/620/coverage-runs?limit=4");
if (
  coverageRuns.schemaVersion !== "steambench.game-coverage-runs.v1" ||
  coverageRuns.game?.appid !== 620 ||
  !coverageRuns.coverageRuns?.some((entry) =>
    entry.record?.id === coverageLocalRun.result.record.id &&
    entry.record?.status === "scoreboard-ready" &&
    entry.runs?.every((runEntry) => runEntry.links?.evidenceBundle?.includes("/api/runs/"))
  )
) {
  throw new Error("Game coverage run listing did not expose persisted scored coverage run records");
}
const coverageRunDetail = await readJson(`/api/game-coverage-runs/${coverageLocalRun.result.record.id}`);
if (
  coverageRunDetail.schemaVersion !== "steambench.game-coverage-run-detail.v1" ||
  coverageRunDetail.coverageRun?.record?.id !== coverageLocalRun.result.record.id ||
  coverageRunDetail.coverageRun?.record?.scoreboardReady !== coverageLocalRun.result.totals.scoreboardReady ||
  coverageRunDetail.coverageRun?.runs?.length !== coverageLocalRun.result.totals.completedRuns
) {
  throw new Error("Game coverage run detail did not resolve persisted coverage run evidence links");
}
const coverageRunBundle = await readJson(`/api/game-coverage-runs/${coverageLocalRun.result.record.id}/evidence-bundle`);
if (
  coverageRunBundle.bundle?.schemaVersion !== "steambench.game-coverage-run-evidence-bundle.v1" ||
  coverageRunBundle.bundle?.coverageRunId !== coverageLocalRun.result.record.id ||
  coverageRunBundle.bundle?.integrity?.verdict !== "scoreboard-ready" ||
  coverageRunBundle.bundle?.integrity?.allRunBundlesReady !== true ||
  coverageRunBundle.bundle?.integrity?.scoreboardRows !== coverageLocalRun.result.totals.completedRuns ||
  !coverageRunBundle.bundle?.runBundles?.every((entry) => entry.bundle?.schemaVersion === "steambench.evidence-bundle.v1")
) {
  throw new Error("Game coverage run evidence bundle did not roll up scored run evidence");
}
const coverageRunCertificate = await readJson(`/api/game-coverage-runs/${coverageLocalRun.result.record.id}/result-certificate`);
if (
  coverageRunCertificate.certificate?.schemaVersion !== "steambench.result-certificate.v1" ||
  coverageRunCertificate.certificate?.kind !== "game-coverage-run" ||
  coverageRunCertificate.certificate?.id !== coverageLocalRun.result.record.id ||
  coverageRunCertificate.certificate?.integrity?.readyForPublicShare !== true ||
  coverageRunCertificate.certificate?.links?.evidenceBundle?.endsWith(`/api/game-coverage-runs/${coverageLocalRun.result.record.id}/evidence-bundle`) !== true
) {
  throw new Error("Game coverage run result certificate did not expose a share-ready certificate");
}
const onboardingLocalRun = await readJson("/api/steam/apps/620/onboarding/run-local", {
  method: "POST",
  body: JSON.stringify({
    useFixture: true,
    reviewApproved: true,
    reviewNotes: "smoke onboarding local run",
    humanUserId: user.user.id,
    agentId: agent.agent.id,
    limit: 2
  })
});
if (
  onboardingLocalRun.run?.schemaVersion !== "steambench.steam-app-onboarding-local-run.v1" ||
  onboardingLocalRun.run?.appid !== 620 ||
  onboardingLocalRun.run?.links?.coveragePlan !== "/api/games/620/coverage-plan" ||
  !onboardingLocalRun.run?.steps?.some((step) => step.id === "coverage-local-run") ||
  onboardingLocalRun.coverage?.schemaVersion !== "steambench.game-coverage-local-run.v1" ||
  onboardingLocalRun.coverage?.selectedHuman?.id !== user.user.id ||
  onboardingLocalRun.coverage?.selectedAgent?.id !== agent.agent.id ||
  onboardingLocalRun.onboarding?.schemaVersion !== "steambench.steam-app-onboarding.v1"
) {
  throw new Error("Steam app onboarding local run did not expose the coverage run and refreshed onboarding state");
}
const appCompetitionOpsCli = spawnSync(
  process.execPath,
  [
    "scripts/app-competition-ops.mjs",
    `--api=${baseUrl}`,
    "--appid=620",
    `--human-user-id=${user.user.id}`,
    `--agent-id=${agent.agent.id}`,
    "--suite-tier=ranked",
    "--execute=advance-competition-actions",
    "--max-steps=1",
    "--compact=true"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (appCompetitionOpsCli.status !== 0) {
  throw new Error(`App competition ops CLI execute failed:\n${appCompetitionOpsCli.stdout}\n${appCompetitionOpsCli.stderr}`);
}
const appCompetitionOpsCliResult = JSON.parse(appCompetitionOpsCli.stdout);
if (
  appCompetitionOpsCliResult.schemaVersion !== "steambench.app-competition-ops-cli.v1" ||
  appCompetitionOpsCliResult.summary?.executedActionId !== "run-suite-race" ||
  appCompetitionOpsCliResult.summary?.executedActionCount !== 1 ||
  appCompetitionOpsCliResult.summary?.executedActionIds?.[0] !== "run-suite-race"
) {
  throw new Error("App competition ops CLI did not execute the suite race recommendation");
}
const appCompetitionRun = await readJson("/api/games/620/competition/run-local", {
  method: "POST",
  body: JSON.stringify({
    humanUserId: user.user.id,
    agentId: agent.agent.id,
    suiteTier: "ranked",
    reviewApproved: true
  })
});
if (
  appCompetitionRun.competitionRun?.schemaVersion !== "steambench.game-competition-local-run.v1" ||
  appCompetitionRun.competitionRun?.appid !== 620 ||
  appCompetitionRun.competitionRun?.suiteId !== "620:ranked" ||
  appCompetitionRun.competitionRun?.status !== "scored" ||
  appCompetitionRun.competitionRun?.complete !== true ||
  appCompetitionRun.race?.status !== "scored" ||
  appCompetitionRun.audit?.verdict !== "scoreboard-ready" ||
  appCompetitionRun.bundle?.integrity?.allChildRunsScoreboardReady !== true ||
  appCompetitionRun.certificate?.kind !== "suite-race" ||
  appCompetitionRun.certificate?.integrity?.readyForPublicShare !== true ||
  appCompetitionRun.standings?.schemaVersion !== "steambench.game-competition-standings.v1"
) {
  throw new Error("Per-game app competition local run did not execute a ranked Portal 2 suite race");
}
const appCompetitionRaceDetail = await readJson(appCompetitionRun.competitionRun.links.suiteRace);
if (
  appCompetitionRaceDetail.race?.id !== appCompetitionRun.race.id ||
  appCompetitionRaceDetail.matches?.length !== appCompetitionRun.matches.length
) {
  throw new Error("Suite race detail link did not resolve the app competition race");
}

const agentCampaignPlan = await readJson(`/api/agents/${agent.agent.id}/campaign-plan?limit=2&provider=local`);
if (
  agentCampaignPlan.plan?.schemaVersion !== "steambench.agent-campaign.v1" ||
  agentCampaignPlan.plan?.requestedTaskCount !== 2 ||
  agentCampaignPlan.plan?.selectedTaskCount !== 2 ||
  agentCampaignPlan.plan?.provider !== "local"
) {
  throw new Error("Agent campaign plan did not expose two local ready benchmark tasks");
}
const agentCampaign = await readJson(`/api/agents/${agent.agent.id}/campaigns`, {
  method: "POST",
  body: JSON.stringify({
    limit: 2,
    provider: "local",
    dispatch: true
  })
});
if (
  agentCampaign.campaign?.schemaVersion !== "steambench.agent-campaign.v1" ||
  agentCampaign.campaign?.report?.schemaVersion !== "steambench.agent-campaign-report.v1" ||
  agentCampaign.campaign?.runCount !== 2 ||
  agentCampaign.campaign?.dispatchCount !== 2 ||
  !agentCampaign.campaign?.items?.every((entry) =>
    entry.run?.competitor === `agent:${agent.agent.handle}` &&
    entry.dispatch?.provider === "local" &&
    entry.dispatch?.command?.includes("scripts/runtime-worker.mjs") &&
    entry.links?.playbookUrl?.includes("/agent-playbook") &&
    entry.links?.traceUrl?.includes("/agent-trace") &&
    entry.links?.submissionUrl?.endsWith("/submission")
  )
) {
  throw new Error("Agent campaign did not queue runs with local dispatch tickets and handoff links");
}
const agentCampaigns = await readJson(`/api/agents/${agent.agent.id}/campaigns`);
if (!agentCampaigns.campaigns?.some((entry) =>
  entry.campaign?.id === agentCampaign.campaign.id &&
  entry.schemaVersion === "steambench.agent-campaign-report.v1" &&
  entry.totals?.runs === 2 &&
  entry.totals?.dispatches === 2
)) {
  throw new Error("Agent campaign list did not expose the persisted campaign report");
}
const agentOps = await readJson("/api/agents/ops-report?provider=local&limit=20");
if (
  agentOps.report?.schemaVersion !== "steambench.agent-ops-report.v1" ||
  agentOps.report?.totals?.agents < 1 ||
  agentOps.report?.totals?.queuedRuns < 1 ||
  !agentOps.report?.tickets?.some((ticket) => ticket.agent?.id === agent.agent.id && ["queued", "ready-for-campaign", "running"].includes(ticket.status)) ||
  !agentOps.report?.recommendedActions?.some((entry) => entry.id === "drain-dispatches" || entry.id === "create-agent-campaign" || entry.id === "open-agent-run-session")
) {
  throw new Error("Agent ops report did not expose queued campaign and runtime readiness");
}
const agentOpsRunSessionAgent = await readJson("/api/agents", {
  method: "POST",
  body: JSON.stringify({
    handle: `smoke-agent-ops-session-${Date.now().toString(36)}`,
    displayName: "Smoke Agent Ops Session",
    provider: "local",
    command: "node scripts/runtime-worker.mjs --agent=smoke-agent-ops-session",
    capabilities: ["keyboard-mouse", "controller", "turn-based-actions", "screen-capture", "stats-screen", "action-log", "seeded-save", "manual-review", "output.mp4"]
  })
});
const agentOpsRunSessionCli = spawnSync(
  process.execPath,
  [
    "scripts/agent-ops.mjs",
    `--api=${baseUrl}`,
    "--provider=local",
    "--limit=1",
    "--execute=advance-agent-actions",
    "--max-steps=1",
    "--ttl-seconds=120",
    `--idempotency-key=smoke-agent-ops-session-${Date.now().toString(36)}`
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (agentOpsRunSessionCli.status !== 0) {
  throw new Error(`Agent ops run-session CLI execute failed:\n${agentOpsRunSessionCli.stdout}\n${agentOpsRunSessionCli.stderr}`);
}
const agentOpsRunSessionCliResult = JSON.parse(agentOpsRunSessionCli.stdout);
if (
  agentOpsRunSessionAgent.agent?.status !== "active" ||
  agentOpsRunSessionCliResult.schemaVersion !== "steambench.agent-ops-cli.v1" ||
  agentOpsRunSessionCliResult.summary?.executedActionId !== "open-agent-run-session" ||
  agentOpsRunSessionCliResult.summary?.executedActionIds?.[0] !== "open-agent-run-session" ||
  agentOpsRunSessionCliResult.summary?.executedActionCount !== 1 ||
  typeof agentOpsRunSessionCliResult.summary?.runSessionId !== "string" ||
  agentOpsRunSessionCliResult.summary?.runSessionStatus !== "ready-for-actions" ||
  typeof agentOpsRunSessionCliResult.summary?.runSessionControlId !== "string" ||
  agentOpsRunSessionCliResult.summary?.runSessionAccessPacketReady !== true ||
  agentOpsRunSessionCliResult.summary?.runSessionBridgeReady !== true ||
  agentOpsRunSessionCliResult.executedAction?.result?.schemaVersion !== "steambench.agent-run-session.v1"
) {
  throw new Error("Agent ops CLI did not open a bridge-ready agent run session");
}
const agentOpsCliAgent = await readJson("/api/agents", {
  method: "POST",
  body: JSON.stringify({
    handle: `smoke-agent-ops-cli-${Date.now().toString(36)}`,
    displayName: "Smoke Agent Ops CLI",
    provider: "local",
    command: "node scripts/runtime-worker.mjs --agent=smoke-agent-ops-cli",
    capabilities: ["keyboard-mouse", "controller", "turn-based-actions", "screen-capture", "stats-screen", "action-log", "seeded-save", "manual-review", "output.mp4"]
  })
});
const agentOpsCli = spawnSync(
  process.execPath,
  [
    "scripts/agent-ops.mjs",
    `--api=${baseUrl}`,
    "--provider=local",
    "--limit=20",
    "--execute=create-agent-campaign",
    "--campaign-limit=2"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (agentOpsCli.status !== 0) {
  throw new Error(`Agent ops CLI execute failed:\n${agentOpsCli.stdout}\n${agentOpsCli.stderr}`);
}
const agentOpsCliResult = JSON.parse(agentOpsCli.stdout);
if (
  agentOpsCliAgent.agent?.status !== "active" ||
  agentOpsCliResult.schemaVersion !== "steambench.agent-ops-cli.v1" ||
  agentOpsCliResult.summary?.executedActionId !== "create-agent-campaign" ||
  agentOpsCliResult.summary?.campaignRunCount !== 2 ||
  agentOpsCliResult.summary?.campaignDispatchCount !== 2 ||
  agentOpsCliResult.executedAction?.result?.campaign?.schemaVersion !== "steambench.agent-campaign.v1" ||
  agentOpsCliResult.executedAction?.result?.campaign?.report?.schemaVersion !== "steambench.agent-campaign-report.v1"
) {
  throw new Error("Agent ops CLI did not execute a local dispatched campaign recommendation");
}
const agentCampaignDetail = await readJson(`/api/campaigns/${agentCampaign.campaign.id}`);
if (
  agentCampaignDetail.campaign?.schemaVersion !== "steambench.agent-campaign-report.v1" ||
  agentCampaignDetail.campaign?.campaign?.id !== agentCampaign.campaign.id ||
  agentCampaignDetail.campaign?.totals?.tasks !== 2
) {
  throw new Error("Agent campaign detail did not expose the campaign report");
}
const agentCampaignRun = await readJson(`/api/campaigns/${agentCampaign.campaign.id}/run-local`, {
  method: "POST"
});
if (
  agentCampaignRun.report?.schemaVersion !== "steambench.agent-campaign-report.v1" ||
  agentCampaignRun.report?.status !== "scoreboard-ready" ||
  agentCampaignRun.report?.totals?.scored !== 2 ||
  agentCampaignRun.report?.totals?.scoreboardRows !== 2 ||
  agentCampaignRun.report?.totals?.canonicalArtifacts !== 2 ||
  !agentCampaignRun.results?.every((entry) => entry.evaluation?.passed === true && entry.run?.status === "scored")
) {
  throw new Error("Agent campaign local runner did not score the full campaign");
}
if (
  agentCampaignRun.bundle?.schemaVersion !== "steambench.agent-campaign-evidence-bundle.v1" ||
  agentCampaignRun.bundle?.integrity?.verdict !== "scoreboard-ready" ||
  agentCampaignRun.bundle?.integrity?.allRunBundlesScoreboardReady !== true ||
  agentCampaignRun.bundle?.integrity?.allDispatchesCompleted !== true ||
  agentCampaignRun.bundle?.integrity?.standingsPublished !== true ||
  agentCampaignRun.bundle?.runBundles?.length !== 2 ||
  !agentCampaignRun.bundle?.integrity?.checklist?.every((entry) => entry.status === "pass")
) {
  throw new Error("Agent campaign local runner did not return a passing evidence bundle");
}
const agentCampaignBundle = await readJson(`/api/campaigns/${agentCampaign.campaign.id}/evidence-bundle`);
if (
  agentCampaignBundle.bundle?.schemaVersion !== "steambench.agent-campaign-evidence-bundle.v1" ||
  agentCampaignBundle.bundle?.campaignId !== agentCampaign.campaign.id ||
  agentCampaignBundle.bundle?.standingsEntry?.campaignId !== agentCampaign.campaign.id ||
  agentCampaignBundle.bundle?.integrity?.allRunBundlesPresent !== true
) {
  throw new Error("Agent campaign evidence bundle endpoint did not expose the scored campaign evidence");
}
const agentCampaignCertificate = await readJson(`/api/campaigns/${agentCampaign.campaign.id}/result-certificate`);
if (
  agentCampaignCertificate.certificate?.schemaVersion !== "steambench.result-certificate.v1" ||
  agentCampaignCertificate.certificate?.kind !== "agent-campaign" ||
  agentCampaignCertificate.certificate?.id !== agentCampaign.campaign.id ||
  agentCampaignCertificate.certificate?.integrity?.readyForPublicShare !== true ||
  agentCampaignCertificate.certificate?.result?.scoreboardRows !== 2 ||
  !agentCampaignCertificate.certificate?.links?.evidenceBundle?.endsWith(`/api/campaigns/${agentCampaign.campaign.id}/evidence-bundle`)
) {
  throw new Error("Agent campaign result certificate did not expose a public share-ready certificate");
}
const agentCampaignStandings = await readJson("/api/campaign-standings");
if (
  agentCampaignStandings.standings?.schemaVersion !== "steambench.agent-campaign-standings.v1" ||
  !agentCampaignStandings.standings?.leaderboard?.some((entry) =>
    entry.campaignId === agentCampaign.campaign.id &&
    entry.status === "scoreboard-ready" &&
    entry.completionRate === 100 &&
    entry.scoreboardRows === 2
  ) ||
  !agentCampaignStandings.standings?.competitors?.some((entry) =>
    entry.agentId === agent.agent.id &&
    entry.scoreboardReadyCampaigns >= 1
  )
) {
  throw new Error("Agent campaign standings did not rank the scored campaign");
}
const runtimeDispatchOpsCli = spawnSync(
  process.execPath,
  [
    "scripts/runtime-dispatch-ops.mjs",
    `--api=${baseUrl}`,
    "--provider=local",
    "--status=planned,launched",
    "--limit=1",
    "--execute=advance-dispatch-actions",
    "--max-steps=1"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (runtimeDispatchOpsCli.status !== 0) {
  throw new Error(`Runtime dispatch ops CLI execute failed:\n${runtimeDispatchOpsCli.stdout}\n${runtimeDispatchOpsCli.stderr}`);
}
const runtimeDispatchOpsCliResult = JSON.parse(runtimeDispatchOpsCli.stdout);
if (
  runtimeDispatchOpsCliResult.schemaVersion !== "steambench.runtime-dispatch-ops-cli.v1" ||
  runtimeDispatchOpsCliResult.summary?.executedActionId !== "drain-local-dispatches" ||
  runtimeDispatchOpsCliResult.summary?.executedActionIds?.[0] !== "drain-local-dispatches" ||
  runtimeDispatchOpsCliResult.summary?.executedActionCount !== 1 ||
  runtimeDispatchOpsCliResult.summary?.drainSelected !== 1 ||
  runtimeDispatchOpsCliResult.summary?.drainCompleted !== 1 ||
  runtimeDispatchOpsCliResult.executedAction?.result?.schemaVersion !== "steambench.runtime-dispatch-drain.v1" ||
  runtimeDispatchOpsCliResult.executedAction?.result?.results?.[0]?.terminalStatus !== "completed"
) {
  throw new Error("Runtime dispatch ops CLI did not execute the pending local worker handoff");
}

const humanEventRegistration = await readJson("/api/competition-events/weekly/register", {
  method: "POST",
  body: JSON.stringify({
    participantType: "human",
    participantId: user.user.id
  })
});
if (humanEventRegistration.registration?.status !== "registered") {
  throw new Error("Human event registration did not enter registered state");
}
const agentEventRegistration = await readJson("/api/competition-events/weekly/register", {
  method: "POST",
  body: JSON.stringify({
    participantType: "agent",
    participantId: agent.agent.id
  })
});
if (agentEventRegistration.registration?.status !== "registered") {
  throw new Error("Agent event registration did not enter registered state");
}
const eventRegistrations = await readJson("/api/competition-events/registrations");
if (!eventRegistrations.registrations?.some((entry) => entry.registration?.id === humanEventRegistration.registration.id)) {
  throw new Error("Competition event registration list did not include the smoke human registration");
}
const eventOpsBeforeSchedule = await readJson("/api/competition-events/weekly/ops-report?suiteId=620:ranked");
if (
  eventOpsBeforeSchedule.report?.schemaVersion !== "steambench.competition-event-ops-report.v1" ||
  eventOpsBeforeSchedule.report?.status !== "needs-scheduling" ||
  eventOpsBeforeSchedule.report?.totals?.registeredPairs === 0 ||
  !eventOpsBeforeSchedule.report?.recommendedActions?.some((entry) => entry.id === "schedule-suite")
) {
  throw new Error("Competition event ops report did not recommend suite scheduling for registered pairs");
}
const eventScheduleCli = spawnSync(
  process.execPath,
  [
    "scripts/competition-event-ops.mjs",
    `--api=${baseUrl}`,
    "--scope=weekly",
    "--suite-id=620:ranked",
    "--execute=advance-event-actions",
    "--max-steps=1",
    "--max-pairs=10"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (eventScheduleCli.status !== 0) {
  throw new Error(`Competition event ops schedule execute failed:\n${eventScheduleCli.stdout}\n${eventScheduleCli.stderr}`);
}
const eventScheduleCliResult = JSON.parse(eventScheduleCli.stdout);
const eventSchedule = eventScheduleCliResult.executedAction?.result;
if (
  eventScheduleCliResult.schemaVersion !== "steambench.competition-event-ops-cli.v1" ||
  eventScheduleCliResult.summary?.executedActionId !== "schedule-suite" ||
  eventScheduleCliResult.summary?.executedActionCount !== 1 ||
  eventScheduleCliResult.summary?.executedActionIds?.[0] !== "schedule-suite" ||
  eventScheduleCliResult.summary?.scheduledRaces < 1 ||
  eventScheduleCliResult.summary?.scheduledCount === undefined ||
  eventSchedule.schedule?.scope !== "weekly" ||
  eventSchedule.schedule?.entrants?.eligiblePairs === 0 ||
  eventSchedule.schedule?.scheduled?.length + eventSchedule.schedule?.skipped?.length === 0 ||
  (
    eventSchedule.schedule?.scheduled?.length > 0 &&
    !eventSchedule.schedule.scheduled.some((entry) => entry.race?.eventScope === "weekly")
  )
) {
  throw new Error("Competition event schedule did not create or find weekly suite races from registered entrants");
}
const duplicateEventSchedule = await readJson("/api/competition-events/weekly/schedule-suite", {
  method: "POST",
  body: JSON.stringify({
    suiteId: "620:ranked",
    reviewApproved: true
  })
});
if (duplicateEventSchedule.schedule?.scheduled?.length !== 0 || duplicateEventSchedule.schedule?.skipped?.length === 0) {
  throw new Error("Competition event schedule did not skip duplicate registered pair schedules");
}
const eventRun = await readJson("/api/competition-events/weekly/run-suite", {
  method: "POST",
  body: JSON.stringify({
    suiteId: "620:ranked",
    maxRaces: 1
  })
});
if (
  eventRun.run?.scope !== "weekly" ||
  eventRun.run?.candidateCount > 0 && eventRun.run?.executed?.length === 0 ||
  eventRun.run?.incomplete?.length > 0 ||
  (
    eventRun.run?.executed?.length > 0 &&
    eventRun.run.executed[0]?.bundle?.integrity?.allChildRunsScoreboardReady !== true
  )
) {
  throw new Error("Competition event run did not execute scheduled weekly suite races cleanly");
}
const eventBundle = await readJson("/api/competition-events/weekly/evidence-bundle");
if (
  eventBundle.bundle?.schemaVersion !== "steambench.competition-event-evidence-bundle.v1" ||
  eventBundle.bundle?.scope !== "weekly" ||
  eventBundle.bundle?.integrity?.scheduledRaces === 0 ||
  eventBundle.bundle?.integrity?.bundleCount === 0 ||
  eventBundle.bundle?.integrity?.allScheduledRacesBundled !== true ||
  eventBundle.bundle?.standings?.totals?.scoredRaces === 0 ||
  !eventBundle.bundle?.suiteRaces?.some((entry) => entry.bundle?.integrity?.verdict === "scoreboard-ready")
) {
  throw new Error("Competition event evidence bundle did not assemble event-level race evidence");
}
const eventCertificate = await readJson("/api/competition-events/weekly/result-certificate");
if (
  eventCertificate.certificate?.schemaVersion !== "steambench.result-certificate.v1" ||
  eventCertificate.certificate?.kind !== "competition-event" ||
  eventCertificate.certificate?.id !== "event:weekly" ||
  eventCertificate.certificate?.verdict !== "scoreboard-ready" ||
  eventCertificate.certificate?.integrity?.readyForPublicShare !== true ||
  eventCertificate.certificate?.links?.evidenceBundle?.endsWith("/api/competition-events/weekly/evidence-bundle") !== true ||
  !Array.isArray(eventCertificate.certificate?.participants) ||
  eventCertificate.certificate.participants.length < 2
) {
  throw new Error("Competition event result certificate did not expose the share-ready event certificate");
}
const eventOpsAfterRun = await readJson("/api/competition-events/weekly/ops-report?suiteId=620:ranked");
if (
  eventOpsAfterRun.report?.schemaVersion !== "steambench.competition-event-ops-report.v1" ||
  !["ready-to-share", "needs-campaign-comparison"].includes(eventOpsAfterRun.report?.status) ||
  eventOpsAfterRun.report?.totals?.readyRaceBundles < 1 ||
  !eventOpsAfterRun.report?.recommendedActions?.some((entry) =>
    entry.id === "inspect-event-certificate" || entry.id === "run-campaign-comparisons-local"
  )
) {
  throw new Error("Competition event ops report did not recognize the scored suite race state");
}
const humanProfile = await readJson(`/api/competitors/human/${user.user.id}/profile`);
if (
  humanProfile.profile?.participant?.type !== "human" ||
  humanProfile.profile?.participant?.linkedSteamId !== "76561198000000000" ||
  humanProfile.profile?.registrations?.some((registration) => registration.eventScope === "weekly" && registration.status === "registered") !== true
) {
  throw new Error("Human competitor profile did not expose Steam proof and event registration state");
}
const agentProfile = await readJson(`/api/competitors/agent/${agent.agent.id}/profile`);
if (
  agentProfile.profile?.participant?.type !== "agent" ||
  agentProfile.profile?.participant?.status !== "active" ||
  agentProfile.profile?.suiteRaces?.total === 0
) {
  throw new Error("Agent competitor profile did not expose active runtime and suite race state");
}

const readyEligibility = await readJson(
  `/api/tasks/${encodeURIComponent(state.tasks[0].id)}/eligibility?humanUserId=${user.user.id}&agentId=${agent.agent.id}`
);
if (readyEligibility.eligibility?.status !== "ready" || readyEligibility.eligibility?.ready !== true) {
  throw new Error("Race eligibility did not mark the smoke human and agent ready for a ranked task");
}
const controlledTaskForPreflight = state.tasks.find((task) => task.id === "646570:LDRB.SEED_A20_SCORE");
if (controlledTaskForPreflight) {
  const controlledPreflight = await readJson("/api/matches/preflight", {
    method: "POST",
    body: JSON.stringify({
      taskId: controlledTaskForPreflight.id,
      humanUserId: user.user.id,
      agentId: agent.agent.id
    })
  });
  if (controlledPreflight.eligibility?.status !== "controlled") {
    throw new Error("Race preflight did not flag controlled leaderboard tasks before match creation");
  }
}
const suitePreflight = await readJson("/api/benchmark-suites/620:ranked/preflight", {
  method: "POST",
  body: JSON.stringify({
    humanUserId: user.user.id,
    agentId: agent.agent.id
  })
});
if (
  !["ready", "controlled"].includes(suitePreflight.preflight?.status) ||
  !suitePreflight.preflight?.eligibility?.every((entry) => entry.status === "ready" || entry.status === "controlled")
) {
  throw new Error("Suite race preflight did not mark Portal 2 ranked suite as ready or controlled");
}
const suiteRace = await readJson("/api/benchmark-suites/620:ranked/races", {
  method: "POST",
  body: JSON.stringify({
    humanUserId: user.user.id,
    agentId: agent.agent.id,
    reviewApproved: true
  })
});
if (suiteRace.race?.suiteId !== "620:ranked" || suiteRace.matches?.length !== suiteRace.race?.taskIds?.length) {
  throw new Error("Suite race creation did not schedule one match per suite task");
}
const suiteRaceList = await readJson("/api/suite-races");
if (!suiteRaceList.suiteRaces?.some((entry) => entry.race.id === suiteRace.race.id)) {
  throw new Error("Suite race list did not include the scheduled suite race");
}
const pendingSuiteEvaluationResponse = await fetch(`${baseUrl}/api/suite-races/${suiteRace.race.id}/evaluate`, {
  method: "POST"
});
const pendingSuiteEvaluation = await pendingSuiteEvaluationResponse.json();
if (pendingSuiteEvaluationResponse.status !== 422) {
  throw new Error("Suite race evaluation should stay non-2xx until child matches score");
}
if (pendingSuiteEvaluation.race?.status !== "running") {
  throw new Error("Suite race evaluation did not stay running before child matches scored");
}
const pendingSuiteAudit = await readJson(`/api/suite-races/${suiteRace.race.id}/audit`);
if (pendingSuiteAudit.audit?.verdict !== "match-incomplete" || pendingSuiteAudit.audit?.evidenceCounts?.scoredMatches !== 0) {
  throw new Error("Suite race audit did not explain pending child match evidence before scoring");
}
const scoredSuiteRace = await readJson(`/api/suite-races/${suiteRace.race.id}/run-local`, {
  method: "POST"
});
if (
  scoredSuiteRace.race?.status !== "scored" ||
  !["human", "agent", "tie"].includes(scoredSuiteRace.race?.winner) ||
  scoredSuiteRace.race?.humanScore === undefined ||
  scoredSuiteRace.race?.agentScore === undefined ||
  scoredSuiteRace.childResults?.length !== suiteRace.matches.length ||
  scoredSuiteRace.incompleteMatches?.length !== 0 ||
  scoredSuiteRace.audit?.verdict !== "scoreboard-ready" ||
  scoredSuiteRace.bundle?.integrity?.allChildRunsScoreboardReady !== true
) {
  throw new Error("Suite race local orchestration did not publish scored child matches, audit, and aggregate totals");
}
const scoredSuiteAudit = await readJson(`/api/suite-races/${suiteRace.race.id}/audit`);
if (
  scoredSuiteAudit.audit?.verdict !== "scoreboard-ready" ||
  scoredSuiteAudit.audit?.evidenceCounts?.matches !== suiteRace.matches.length ||
  scoredSuiteAudit.audit?.evidenceCounts?.scoredMatches !== suiteRace.matches.length ||
  scoredSuiteAudit.audit?.aggregate?.winner !== scoredSuiteRace.race.winner
) {
  throw new Error("Suite race audit did not publish aggregate scoreboard-ready evidence");
}
const scoredSuiteBundle = await readJson(`/api/suite-races/${suiteRace.race.id}/evidence-bundle`);
if (
  scoredSuiteBundle.bundle?.schemaVersion !== "steambench.suite-race-evidence-bundle.v1" ||
  scoredSuiteBundle.bundle?.integrity?.verdict !== "scoreboard-ready" ||
  scoredSuiteBundle.bundle?.integrity?.allChildRunsScoreboardReady !== true ||
  scoredSuiteBundle.bundle?.integrity?.checklist?.some((entry) => entry.status !== "pass")
) {
  throw new Error("Suite race evidence bundle did not expose a passing integrity checklist");
}
const suiteRaceStandings = await readJson("/api/suite-races/standings");
if (
  suiteRaceStandings.standings?.totals?.scoredRaces === 0 ||
  !suiteRaceStandings.leaderboards?.some((leaderboard) => leaderboard.suiteId === "620:ranked")
) {
  throw new Error("Suite race standings did not include the scored Portal 2 ranked suite race");
}
const weeklyEvent = await readJson("/api/competition-events/weekly");
if (
  weeklyEvent.event?.scope !== "weekly" ||
  weeklyEvent.event?.entrants?.runnablePairs === 0 ||
  weeklyEvent.event?.entrants?.registeredPairs === 0 ||
  weeklyEvent.event?.suiteRaces?.scored === 0
) {
  throw new Error("Weekly competition event did not include scored suite race and registered runnable entrants");
}

const match = await readJson("/api/matches", {
  method: "POST",
  body: JSON.stringify({
    taskId: state.tasks[0].id,
    humanUserId: user.user.id,
    agentId: agent.agent.id
  })
});
if (match.match.status !== "scheduled") {
  throw new Error("Head-to-head match did not start in scheduled state");
}
if (match.eligibility?.status !== "ready") {
  throw new Error("Head-to-head match did not return a ready race eligibility verdict");
}
if (
  match.arenaPacket?.schemaVersion !== "steambench.match-arena-packet.v1" ||
  match.arenaPacket?.readyForStart !== true ||
  match.arenaPacket?.human?.entryPacket?.schemaVersion !== "steambench.human-benchmark-entry-packet.v1" ||
  match.arenaPacket?.agent?.actionSpace?.schemaVersion !== "steambench.runtime-action-space.v1" ||
  match.arenaPacket?.evidence?.canonicalArtifact !== "output/output.mp4" ||
  match.arenaPacket?.evidence?.forbiddenArtifactNames?.includes("output-test.mp4") !== true ||
  match.arenaPacket?.endpoints?.runLocal !== `/api/matches/${match.match.id}/run-local`
) {
  throw new Error("Head-to-head match did not return a runnable arena packet");
}
const arenaOpsBeforeRun = await readJson("/api/matches/arena-ops-report?status=needs-start&limit=10");
if (
  arenaOpsBeforeRun.report?.schemaVersion !== "steambench.match-arena-ops-report.v1" ||
  arenaOpsBeforeRun.report?.status !== "needs-execution" ||
  arenaOpsBeforeRun.report?.totals?.needsStart < 1 ||
  arenaOpsBeforeRun.report?.tickets?.some((ticket) => ticket.match?.id === match.match.id && ticket.status === "needs-start") !== true ||
  arenaOpsBeforeRun.report?.recommendedActions?.some((action) => action.id === "run-match-local") !== true
) {
  throw new Error("Match arena ops report did not expose the scheduled match as runnable");
}
const evaluatedMatch = await readJson(`/api/matches/${match.match.id}/run-local`, {
  method: "POST"
});
if (
  evaluatedMatch.match.status !== "scored" ||
  !["human", "agent", "tie"].includes(evaluatedMatch.match.winner) ||
  evaluatedMatch.humanRun.status !== "scored" ||
  evaluatedMatch.agentRun.status !== "scored" ||
  evaluatedMatch.arenaPacket?.schemaVersion !== "steambench.match-arena-packet.v1" ||
  evaluatedMatch.arenaPacket?.readyForPublicShare !== true ||
  evaluatedMatch.arenaPacket?.human?.runId !== evaluatedMatch.humanRun.id ||
  evaluatedMatch.arenaPacket?.agent?.runId !== evaluatedMatch.agentRun.id ||
  evaluatedMatch.arenaPacket?.endpoints?.agentTraceAudit !== `/api/runs/${evaluatedMatch.agentRun.id}/agent-trace/audit` ||
  evaluatedMatch.arenaPacket?.nextActions?.some((action) => action.id === "share-certificate") !== true
) {
  throw new Error("Local arena match orchestration did not publish a scored winner and arena packet");
}
const arenaPacket = await readJson(`/api/matches/${match.match.id}/arena-packet`);
if (
  arenaPacket.arenaPacket?.schemaVersion !== "steambench.match-arena-packet.v1" ||
  arenaPacket.arenaPacket?.matchId !== match.match.id ||
  arenaPacket.arenaPacket?.readyForPublicShare !== true
) {
  throw new Error("Match arena packet endpoint did not expose the scored arena handoff");
}
const arenaOpsAfterRun = await readJson("/api/matches/arena-ops-report?status=scoreboard-ready&limit=10");
if (
  arenaOpsAfterRun.report?.schemaVersion !== "steambench.match-arena-ops-report.v1" ||
  arenaOpsAfterRun.report?.status !== "ready-to-share" ||
  arenaOpsAfterRun.report?.totals?.scoreboardReady < 1 ||
  arenaOpsAfterRun.report?.tickets?.some((ticket) => ticket.match?.id === match.match.id && ticket.status === "scoreboard-ready") !== true ||
  arenaOpsAfterRun.report?.recommendedActions?.some((action) => action.id === "share-match-certificate") !== true
) {
  throw new Error("Match arena ops report did not expose the scored match as share-ready");
}
const arenaOpsCliMatch = await readJson("/api/matches", {
  method: "POST",
  body: JSON.stringify({
    taskId: state.tasks[0].id,
    humanUserId: user.user.id,
    agentId: agent.agent.id
  })
});
const arenaOpsCli = spawnSync(
  process.execPath,
  [
    "scripts/match-arena-ops.mjs",
    `--api=${baseUrl}`,
    "--limit=20",
    "--execute=advance-match-actions",
    "--max-steps=2"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (arenaOpsCli.status !== 0) {
  throw new Error(`Match arena ops CLI execute failed:\n${arenaOpsCli.stdout}\n${arenaOpsCli.stderr}`);
}
const arenaOpsCliResult = JSON.parse(arenaOpsCli.stdout);
if (
  arenaOpsCliMatch.match?.status !== "scheduled" ||
  arenaOpsCliResult.schemaVersion !== "steambench.match-arena-ops-cli.v1" ||
  arenaOpsCliResult.summary?.executedActionId !== "run-match-local" ||
  arenaOpsCliResult.summary?.executedActionCount !== 2 ||
  arenaOpsCliResult.summary?.executedActionIds?.join(",") !== "run-match-local,share-match-certificate" ||
  arenaOpsCliResult.summary?.matchStatus !== "scored" ||
  arenaOpsCliResult.executedAction?.result?.arenaPacket?.schemaVersion !== "steambench.match-arena-packet.v1" ||
  arenaOpsCliResult.executedAction?.result?.arenaPacket?.readyForPublicShare !== true
) {
  throw new Error("Match arena ops CLI did not advance a local match run through certificate sharing");
}
const platformArenaMatch = await readJson("/api/matches", {
  method: "POST",
  body: JSON.stringify({
    taskId: state.tasks[0].id,
    humanUserId: user.user.id,
    agentId: agent.agent.id
  })
});
const platformArenaOpsCli = spawnSync(
  process.execPath,
  [
    "scripts/platform-ops.mjs",
    `--api=${baseUrl}`,
    "--scope=weekly",
    "--limit=200",
    "--execute=match-arena:run-match-local"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (platformArenaOpsCli.status !== 0) {
  throw new Error(`Platform ops match arena execute failed:\n${platformArenaOpsCli.stdout}\n${platformArenaOpsCli.stderr}`);
}
const platformArenaOpsCliResult = JSON.parse(platformArenaOpsCli.stdout);
if (
  platformArenaMatch.match?.status !== "scheduled" ||
  platformArenaOpsCliResult.schemaVersion !== "steambench.platform-ops-cli.v1" ||
  platformArenaOpsCliResult.summary?.executedActionId !== "match-arena:run-match-local" ||
  platformArenaOpsCliResult.summary?.matchStatus !== "scored" ||
  platformArenaOpsCliResult.summary?.matchReadyForPublicShare !== true ||
  platformArenaOpsCliResult.executedAction?.result?.arenaPacket?.schemaVersion !== "steambench.match-arena-packet.v1" ||
  platformArenaOpsCliResult.executedAction?.result?.arenaPacket?.readyForPublicShare !== true
) {
  throw new Error("Platform ops CLI did not execute a match arena recommendation");
}
const matchFeed = await readJson("/api/matches/feed?season=daily");
if (
  matchFeed.matchFeed?.season?.scope !== "daily" ||
  !matchFeed.matchFeed.matches?.some((entry) => entry.matchId === match.match.id && entry.status === "scored")
) {
  throw new Error("Daily match feed did not include the scored local arena match");
}

const challenge = await readJson("/api/challenges", {
  method: "POST",
  body: JSON.stringify({
    taskId: state.tasks[0].id,
    humanUserId: user.user.id,
    agentId: agent.agent.id,
    createdBy: "human",
    createdById: user.user.id
  })
});
if (challenge.challenge?.status !== "open" || challenge.eligibility?.status !== "ready") {
  throw new Error("Challenge queue did not create an open eligible challenge");
}
const openChallengeOps = await readJson("/api/challenges/ops-report?status=open&limit=10");
if (
  openChallengeOps.report?.schemaVersion !== "steambench.challenge-ops-report.v1" ||
  openChallengeOps.report?.status !== "needs-acceptance" ||
  openChallengeOps.report?.tickets?.some((ticket) =>
    ticket.challenge?.id === challenge.challenge.id &&
    ticket.status === "open"
  ) !== true ||
  openChallengeOps.report?.recommendedActions?.some((action) => action.id === "accept-open-challenge") !== true
) {
  throw new Error("Challenge ops report did not queue the open challenge for acceptance");
}
const platformChallenge = await readJson("/api/challenges", {
  method: "POST",
  body: JSON.stringify({
    taskId: state.tasks[0].id,
    humanUserId: user.user.id,
    agentId: agent.agent.id,
    createdBy: "human",
    createdById: user.user.id
  })
});
const platformChallengeOpsCli = spawnSync(
  process.execPath,
  [
    "scripts/platform-ops.mjs",
    `--api=${baseUrl}`,
    "--scope=weekly",
    "--limit=200",
    "--execute=challenges:accept-open-challenge"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (platformChallengeOpsCli.status !== 0) {
  throw new Error(`Platform ops challenge execute failed:\n${platformChallengeOpsCli.stdout}\n${platformChallengeOpsCli.stderr}`);
}
const platformChallengeOpsCliResult = JSON.parse(platformChallengeOpsCli.stdout);
if (
  platformChallenge.challenge?.status !== "open" ||
  platformChallengeOpsCliResult.schemaVersion !== "steambench.platform-ops-cli.v1" ||
  platformChallengeOpsCliResult.summary?.executedActionId !== "challenges:accept-open-challenge" ||
  platformChallengeOpsCliResult.summary?.challengeId !== platformChallenge.challenge.id ||
  platformChallengeOpsCliResult.summary?.challengeStatus !== "accepted" ||
  platformChallengeOpsCliResult.summary?.matchStatus !== "scheduled"
) {
  throw new Error("Platform ops CLI did not execute a challenge acceptance recommendation");
}
const platformChallengeRunCli = spawnSync(
  process.execPath,
  [
    "scripts/platform-ops.mjs",
    `--api=${baseUrl}`,
    "--scope=weekly",
    "--limit=200",
    "--execute=challenges:run-challenge-local"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (platformChallengeRunCli.status !== 0) {
  throw new Error(`Platform ops challenge run failed:\n${platformChallengeRunCli.stdout}\n${platformChallengeRunCli.stderr}`);
}
const platformChallengeRunCliResult = JSON.parse(platformChallengeRunCli.stdout);
if (
  platformChallengeRunCliResult.schemaVersion !== "steambench.platform-ops-cli.v1" ||
  platformChallengeRunCliResult.summary?.executedActionId !== "challenges:run-challenge-local" ||
  platformChallengeRunCliResult.summary?.challengeId !== platformChallenge.challenge.id ||
  platformChallengeRunCliResult.summary?.challengeStatus !== "scored" ||
  platformChallengeRunCliResult.summary?.matchStatus !== "scored" ||
  platformChallengeRunCliResult.executedAction?.result?.run?.evaluated?.match?.status !== "scored"
) {
  throw new Error("Platform ops CLI did not execute a challenge local run recommendation");
}
const platformChallengeShareCli = spawnSync(
  process.execPath,
  [
    "scripts/platform-ops.mjs",
    `--api=${baseUrl}`,
    "--scope=weekly",
    "--limit=200",
    "--execute=challenges:share-challenge-certificate"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (platformChallengeShareCli.status !== 0) {
  throw new Error(`Platform ops challenge share failed:\n${platformChallengeShareCli.stdout}\n${platformChallengeShareCli.stderr}`);
}
const platformChallengeShareCliResult = JSON.parse(platformChallengeShareCli.stdout);
if (
  platformChallengeShareCliResult.schemaVersion !== "steambench.platform-ops-cli.v1" ||
  platformChallengeShareCliResult.summary?.executedActionId !== "challenges:share-challenge-certificate" ||
  platformChallengeShareCliResult.summary?.certificateKind !== "challenge" ||
  platformChallengeShareCliResult.summary?.readyForPublicShare !== true
) {
  throw new Error("Platform ops CLI did not execute a challenge certificate share recommendation");
}
const acceptedChallenge = await readJson(`/api/challenges/${challenge.challenge.id}/accept`, {
  method: "POST"
});
if (acceptedChallenge.challenge?.status !== "accepted" || acceptedChallenge.match?.status !== "scheduled") {
  throw new Error("Challenge acceptance did not create a scheduled match");
}
const acceptedChallengeOps = await readJson("/api/challenges/ops-report?status=accepted&limit=10");
if (
  acceptedChallengeOps.report?.schemaVersion !== "steambench.challenge-ops-report.v1" ||
  acceptedChallengeOps.report?.status !== "needs-execution" ||
  acceptedChallengeOps.report?.tickets?.some((ticket) =>
    ticket.challenge?.id === challenge.challenge.id &&
    ticket.status === "accepted" &&
    ticket.match?.id === acceptedChallenge.match.id
  ) !== true ||
  acceptedChallengeOps.report?.recommendedActions?.some((action) => action.id === "run-challenge-local") !== true
) {
  throw new Error("Challenge ops report did not queue the accepted challenge for execution");
}
const scoredChallenge = await readJson(`/api/challenges/${challenge.challenge.id}/run-local`, {
  method: "POST"
});
if (scoredChallenge.challenge?.status !== "scored" || scoredChallenge.match?.status !== "scored") {
  throw new Error("Challenge local run did not publish a scored match");
}
const readyChallengeOps = await readJson("/api/challenges/ops-report?status=scoreboard-ready&limit=10");
if (
  readyChallengeOps.report?.schemaVersion !== "steambench.challenge-ops-report.v1" ||
  readyChallengeOps.report?.status !== "ready-to-share" ||
  readyChallengeOps.report?.tickets?.some((ticket) =>
    ticket.challenge?.id === challenge.challenge.id &&
    ticket.status === "scoreboard-ready" &&
    ticket.scoreboardRows === 2
  ) !== true ||
  readyChallengeOps.report?.recommendedActions?.some((action) => action.id === "share-challenge-certificate") !== true
) {
  throw new Error("Challenge ops report did not mark the scored challenge ready to share");
}
const challengeList = await readJson("/api/challenges");
if (!challengeList.challenges?.some((entry) => entry.challenge.id === challenge.challenge.id && entry.match?.status === "scored")) {
  throw new Error("Challenge list did not include the scored challenge");
}
const challengeBundle = await readJson(`/api/challenges/${challenge.challenge.id}/evidence-bundle`);
if (
  challengeBundle.bundle?.schemaVersion !== "steambench.challenge-evidence-bundle.v1" ||
  challengeBundle.bundle?.challengeId !== challenge.challenge.id ||
  challengeBundle.bundle?.match?.status !== "scored" ||
  challengeBundle.bundle?.integrity?.verdict !== "scoreboard-ready" ||
  challengeBundle.bundle?.integrity?.allRunBundlesScoreboardReady !== true ||
  challengeBundle.bundle?.integrity?.scoreboardRows !== 2 ||
  challengeBundle.bundle?.runBundles?.human?.schemaVersion !== "steambench.evidence-bundle.v1" ||
  challengeBundle.bundle?.runBundles?.agent?.schemaVersion !== "steambench.evidence-bundle.v1" ||
  !challengeBundle.bundle?.integrity?.checklist?.every((entry) => entry.status === "pass")
) {
  throw new Error("Challenge evidence bundle did not roll up scored human and agent run evidence");
}
const challengeCertificate = await readJson(`/api/challenges/${challenge.challenge.id}/result-certificate`);
if (
  challengeCertificate.certificate?.schemaVersion !== "steambench.result-certificate.v1" ||
  challengeCertificate.certificate?.kind !== "challenge" ||
  challengeCertificate.certificate?.links?.evidenceBundle?.endsWith(`/api/challenges/${challenge.challenge.id}/evidence-bundle`) !== true ||
  challengeCertificate.certificate?.integrity?.readyForPublicShare !== true
) {
  throw new Error("Challenge result certificate did not link the challenge evidence bundle");
}
const challengeOpsCliChallenge = await readJson("/api/challenges", {
  method: "POST",
  body: JSON.stringify({
    taskId: state.tasks[1].id,
    humanUserId: user.user.id,
    agentId: agent.agent.id,
    createdBy: "human",
    createdById: user.user.id,
    summary: "smoke challenge ops cli"
  })
});
const challengeAdvanceCli = spawnSync(
  process.execPath,
  [
    "scripts/challenge-ops.mjs",
    `--api=${baseUrl}`,
    "--limit=20",
    "--execute=advance-challenge-actions",
    "--max-steps=3"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (challengeAdvanceCli.status !== 0) {
  throw new Error(`Challenge ops advance CLI failed:\n${challengeAdvanceCli.stdout}\n${challengeAdvanceCli.stderr}`);
}
const challengeAdvanceCliResult = JSON.parse(challengeAdvanceCli.stdout);
if (
  challengeOpsCliChallenge.challenge?.status !== "open" ||
  challengeAdvanceCliResult.schemaVersion !== "steambench.challenge-ops-cli.v1" ||
  challengeAdvanceCliResult.summary?.executedActionId !== "accept-open-challenge" ||
  challengeAdvanceCliResult.summary?.executedActionCount !== 3 ||
  challengeAdvanceCliResult.summary?.executedActionIds?.join(",") !== "accept-open-challenge,run-challenge-local,share-challenge-certificate" ||
  challengeAdvanceCliResult.executedActions?.[0]?.result?.challenge?.status !== "accepted" ||
  challengeAdvanceCliResult.executedActions?.[1]?.result?.challenge?.status !== "scored" ||
  challengeAdvanceCliResult.executedActions?.[1]?.result?.match?.status !== "scored" ||
  challengeAdvanceCliResult.executedActions?.[1]?.result?.run?.evaluated?.match?.status !== "scored" ||
  challengeAdvanceCliResult.executedActions?.[2]?.result?.certificate?.kind !== "challenge" ||
  challengeAdvanceCliResult.executedActions?.[2]?.result?.certificate?.integrity?.readyForPublicShare !== true
) {
  throw new Error("Challenge ops CLI did not advance an open challenge through local run and certificate sharing");
}

const humanRun = await readJson(`/api/users/${user.user.id}/runs`, {
  method: "POST",
  body: JSON.stringify({
    taskId: state.tasks[0].id
  })
});

if (humanRun.run.competitorType !== "human" || humanRun.run.runtimeProvider !== "manual") {
  throw new Error("Human submission did not create a manual human run");
}

const humanSubmission = await readJson(`/api/runs/${humanRun.run.id}/submission`, {
  method: "POST",
  body: JSON.stringify({
    artifactPath: "output/output.mp4",
    userId: user.user.id,
    allowMock: true,
    steamProof: {
      achieved: true,
      source: "smoke-mock"
    }
  })
});

if (
  humanSubmission.receipt?.schemaVersion !== "steambench.run-submission-receipt.v1" ||
  !humanSubmission.receipt?.scoreboardReady ||
  !humanSubmission.evaluation?.passed ||
  humanSubmission.bundle?.schemaVersion !== "steambench.evidence-bundle.v1" ||
  humanSubmission.certificate?.schemaVersion !== "steambench.result-certificate.v1"
) {
  throw new Error("Human submission receipt did not pass evaluator scoring and evidence bundling");
}
const humanSteamProofPlan = await readJson(`/api/users/${user.user.id}/steam-proof-plan?limit=4`);
if (
  humanSteamProofPlan.plan?.schemaVersion !== "steambench.human-steam-proof-plan.v1" ||
  humanSteamProofPlan.plan?.ready !== true ||
  humanSteamProofPlan.plan?.steamid !== "76561198000000000" ||
  !humanSteamProofPlan.plan?.items?.some((entry) =>
    entry.status === "already-scored" &&
    entry.entryPacket?.schemaVersion === "steambench.human-benchmark-entry-packet.v1" &&
    entry.entryPacket?.readyForSubmission === false &&
    entry.entryPacket?.evidence?.canonicalArtifact === "output/output.mp4" &&
    entry.entryPacket?.evidence?.forbiddenArtifactNames?.includes("output-test.mp4") === true &&
    entry.entryPacket?.endpoints?.submitProof === `/api/users/${user.user.id}/steam-proof-submissions` &&
    entry.entryPacket?.submission?.body?.artifactPath === "output/output.mp4"
  )
) {
  throw new Error("Human Steam proof plan did not expose linked proof readiness and entry packet state");
}
const humanProofOps = await readJson(`/api/human-proof/ops-report?appid=${state.tasks[0].appid}&limit=4&userLimit=20`);
if (
  humanProofOps.report?.schemaVersion !== "steambench.human-proof-ops-report.v1" ||
  humanProofOps.report?.filters?.appid !== state.tasks[0].appid ||
  humanProofOps.report?.totals?.humans < 1 ||
  humanProofOps.report?.totals?.linked < 1 ||
  humanProofOps.report?.totals?.consented < 1 ||
  !humanProofOps.report?.tickets?.some((entry) => entry.user?.id === user.user.id) ||
  !humanProofOps.report?.recommendedActions?.some((entry) => entry.id === "inspect-human-proof-plan")
) {
  throw new Error("Human proof ops report did not expose linked human proof readiness");
}
const humanProofCliUser = await readJson("/api/users", {
  method: "POST",
  body: JSON.stringify({
    handle: `smoke-human-proof-cli-${Date.now().toString(36)}`,
    displayName: "Smoke Human Proof CLI",
    type: "human"
  })
});
await readJson(`/api/users/${humanProofCliUser.user.id}/steam`, {
  method: "POST",
  body: JSON.stringify({
    steamid: "76561198000000064",
    proofConsent: true
  })
});
const humanProofCli = spawnSync(
  process.execPath,
  [
    "scripts/human-proof-ops.mjs",
    `--api=${baseUrl}`,
    `--appid=${state.tasks[0].appid}`,
    "--limit=4",
    "--user-limit=20",
    "--execute=advance-human-proof-actions",
    "--max-steps=1"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (humanProofCli.status !== 0) {
  throw new Error(`Human proof ops CLI execute failed:\n${humanProofCli.stdout}\n${humanProofCli.stderr}`);
}
const humanProofCliResult = JSON.parse(humanProofCli.stdout);
if (
  humanProofCliResult.schemaVersion !== "steambench.human-proof-ops-cli.v1" ||
  humanProofCliResult.summary?.executedActionId !== "submit-human-proof" ||
  humanProofCliResult.summary?.executedActionIds?.[0] !== "submit-human-proof" ||
  humanProofCliResult.summary?.executedActionCount !== 1 ||
  humanProofCliResult.summary?.submissionScoreboardReady !== true ||
  typeof humanProofCliResult.summary?.submissionRunId !== "string" ||
  humanProofCliResult.executedAction?.result?.submission?.schemaVersion !== "steambench.human-steam-proof-submission.v1"
) {
  throw new Error("Human proof ops CLI did not execute a scoreboard-ready proof submission");
}
const humanSteamProofReport = await readJson(`/api/users/${user.user.id}/steam-proof-report?appid=${state.tasks[0].appid}&live=true`);
if (
  humanSteamProofReport.report?.schemaVersion !== "steambench.steam-proof-fetch-report.v1" ||
  humanSteamProofReport.report?.user?.id !== user.user.id ||
  humanSteamProofReport.report?.steamid !== "76561198000000000" ||
  humanSteamProofReport.report?.totals?.verifiedProofs < 1 ||
  humanSteamProofReport.report?.totals?.mockProofs < 1 ||
  humanSteamProofReport.report?.liveProofEnabled !== false ||
  humanSteamProofReport.report?.status !== "live-fetch-blocked" ||
  !humanSteamProofReport.report?.fetch?.error?.includes("STEAM_WEB_API_KEY")
) {
  throw new Error("Human Steam proof fetch report did not expose proof source and live fetch blocker state");
}
const humanCampaignPlan = await readJson(`/api/users/${user.user.id}/human-campaign-plan?campaignId=${agentCampaign.campaign.id}`);
if (
  humanCampaignPlan.plan?.schemaVersion !== "steambench.human-campaign-plan.v1" ||
  humanCampaignPlan.plan?.user?.id !== user.user.id ||
  humanCampaignPlan.plan?.source?.campaignId !== agentCampaign.campaign.id ||
  humanCampaignPlan.plan?.source?.type !== "agent-campaign" ||
  humanCampaignPlan.plan?.totals?.tasks !== 2 ||
  humanCampaignPlan.plan?.links?.comparisonResultCertificate?.includes(`/api/comparisons/human-agent/result-certificate?humanUserId=${user.user.id}&campaignId=${agentCampaign.campaign.id}`) !== true ||
  !humanCampaignPlan.plan?.items?.every((entry) => entry.agentRunId && typeof entry.agentScore === "number")
) {
  throw new Error("Human campaign plan did not align a Steam-linked human to the agent campaign task set");
}
const plannedSubmissionUser = await readJson("/api/users", {
  method: "POST",
  body: JSON.stringify({
    handle: `smoke-planned-${Date.now().toString(36)}`,
    displayName: "Smoke Planned Human",
    type: "human"
  })
});
await readJson(`/api/users/${plannedSubmissionUser.user.id}/steam`, {
  method: "POST",
  body: JSON.stringify({
    steamid: "76561198000000000",
    proofConsent: true
  })
});
const humanPlannedSubmission = await readJson(`/api/users/${plannedSubmissionUser.user.id}/steam-proof-submissions`, {
  method: "POST",
  body: JSON.stringify({})
});
if (
  humanPlannedSubmission.submission?.schemaVersion !== "steambench.human-steam-proof-submission.v1" ||
  humanPlannedSubmission.submission?.entryPacket?.schemaVersion !== "steambench.human-benchmark-entry-packet.v1" ||
  humanPlannedSubmission.submission?.entryPacket?.readyForSubmission !== true ||
  humanPlannedSubmission.submission?.entryPacket?.submission?.endpoint !== `/api/users/${plannedSubmissionUser.user.id}/steam-proof-submissions` ||
  humanPlannedSubmission.submission?.entryPacket?.evidence?.canonicalArtifact !== "output/output.mp4" ||
  humanPlannedSubmission.submission?.entryPacket?.evidence?.forbiddenArtifactNames?.includes("output-test.mp4") !== true ||
  humanPlannedSubmission.submission?.scoreboardReady !== true ||
  humanPlannedSubmission.run?.competitorType !== "human" ||
  humanPlannedSubmission.bundle?.schemaVersion !== "steambench.evidence-bundle.v1" ||
  humanPlannedSubmission.certificate?.integrity?.readyForPublicShare !== true
) {
  throw new Error("Human planned Steam proof submission did not create a scoreboard-ready run");
}
const humanCampaignOpsCli = spawnSync(
  process.execPath,
  [
    "scripts/human-campaign-ops.mjs",
    `--api=${baseUrl}`,
    `--user-id=${user.user.id}`,
    `--campaign-id=${agentCampaign.campaign.id}`,
    "--limit=8",
    "--execute=run-local"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (humanCampaignOpsCli.status !== 0) {
  throw new Error(`Human campaign ops CLI execute failed:\n${humanCampaignOpsCli.stdout}\n${humanCampaignOpsCli.stderr}`);
}
const humanCampaignOpsCliResult = JSON.parse(humanCampaignOpsCli.stdout);
const humanCampaignRun = humanCampaignOpsCliResult.executedAction?.result;
if (
  humanCampaignOpsCliResult.schemaVersion !== "steambench.human-campaign-ops-cli.v1" ||
  humanCampaignOpsCliResult.summary?.executedActionId !== "run-local" ||
  humanCampaignOpsCliResult.summary?.status !== "complete" ||
  humanCampaignOpsCliResult.summary?.comparisonStatus !== "complete" ||
  humanCampaignOpsCliResult.summary?.certificateKind !== "human-agent-comparison" ||
  humanCampaignOpsCliResult.summary?.certificateReady !== true
) {
  throw new Error("Human campaign ops CLI did not complete the local human campaign comparison");
}
if (
  humanCampaignRun.schemaVersion !== "steambench.human-campaign-run.v1" ||
  humanCampaignRun.userId !== user.user.id ||
  humanCampaignRun.campaignId !== agentCampaign.campaign.id ||
  humanCampaignRun.submissions?.length !== humanCampaignRun.planBefore?.totals?.ready ||
  humanCampaignRun.planAfter?.schemaVersion !== "steambench.human-campaign-plan.v1" ||
  humanCampaignRun.planAfter?.status !== "complete" ||
  humanCampaignRun.comparison?.schemaVersion !== "steambench.human-agent-comparison.v1" ||
  humanCampaignRun.comparison?.status !== "complete" ||
  humanCampaignRun.bundle?.schemaVersion !== "steambench.human-agent-comparison-evidence-bundle.v1" ||
  humanCampaignRun.bundle?.integrity?.comparisonComplete !== true ||
  humanCampaignRun.certificate?.kind !== "human-agent-comparison" ||
  humanCampaignRun.certificate?.integrity?.readyForPublicShare !== true
) {
  throw new Error("Human campaign local runner did not complete the human side of the campaign comparison");
}
const humanAgentComparison = await readJson(`/api/comparisons/human-agent?humanUserId=${user.user.id}&campaignId=${agentCampaign.campaign.id}`);
if (
  humanAgentComparison.comparison?.schemaVersion !== "steambench.human-agent-comparison.v1" ||
  humanAgentComparison.comparison?.human?.id !== user.user.id ||
  humanAgentComparison.comparison?.campaign?.id !== agentCampaign.campaign.id ||
  humanAgentComparison.comparison?.totals?.tasks !== 2 ||
  humanAgentComparison.comparison?.totals?.agentMissing !== 0 ||
  !Array.isArray(humanAgentComparison.comparison?.items)
) {
  throw new Error("Human-vs-agent comparison did not compare the human proof state against the agent campaign");
}
const humanAgentComparisonBundle = await readJson(`/api/comparisons/human-agent/evidence-bundle?humanUserId=${user.user.id}&campaignId=${agentCampaign.campaign.id}`);
if (
  humanAgentComparisonBundle.bundle?.schemaVersion !== "steambench.human-agent-comparison-evidence-bundle.v1" ||
  humanAgentComparisonBundle.bundle?.humanUserId !== user.user.id ||
  humanAgentComparisonBundle.bundle?.campaignId !== agentCampaign.campaign.id ||
  humanAgentComparisonBundle.bundle?.campaignBundle?.schemaVersion !== "steambench.agent-campaign-evidence-bundle.v1" ||
  humanAgentComparisonBundle.bundle?.integrity?.taskCount !== 2 ||
  humanAgentComparisonBundle.bundle?.integrity?.agentMissing !== 0 ||
  !humanAgentComparisonBundle.bundle?.runBundles?.some((entry) =>
    entry.humanBundle?.schemaVersion === "steambench.evidence-bundle.v1" &&
    entry.agentBundle?.schemaVersion === "steambench.evidence-bundle.v1"
  )
) {
  throw new Error("Human-vs-agent comparison evidence bundle did not expose campaign and run evidence");
}
const humanAgentComparisonCertificate = await readJson(`/api/comparisons/human-agent/result-certificate?humanUserId=${user.user.id}&campaignId=${agentCampaign.campaign.id}`);
if (
  humanAgentComparisonCertificate.certificate?.schemaVersion !== "steambench.result-certificate.v1" ||
  humanAgentComparisonCertificate.certificate?.kind !== "human-agent-comparison" ||
  humanAgentComparisonCertificate.certificate?.id !== `${user.user.id}:${agentCampaign.campaign.id}` ||
  humanAgentComparisonCertificate.certificate?.links?.evidenceBundle?.endsWith(`/api/comparisons/human-agent/evidence-bundle?humanUserId=${user.user.id}&campaignId=${agentCampaign.campaign.id}`) !== true ||
  humanAgentComparisonCertificate.certificate?.result?.scoreboardRows !== humanAgentComparisonBundle.bundle.integrity.scoreboardRows ||
  humanAgentComparisonCertificate.certificate?.verification?.method !== "sha256" ||
  /^[a-f0-9]{64}$/.test(humanAgentComparisonCertificate.certificate?.verification?.fingerprint ?? "") !== true ||
  humanAgentComparisonCertificate.certificate?.verification?.signedFields?.includes("integrity") !== true
) {
  throw new Error("Human-vs-agent comparison result certificate did not expose the comparison certificate");
}
const humanAgentComparisonCertificateAgain = await readJson(`/api/comparisons/human-agent/result-certificate?humanUserId=${user.user.id}&campaignId=${agentCampaign.campaign.id}`);
if (
  humanAgentComparisonCertificateAgain.certificate?.verification?.fingerprint !== humanAgentComparisonCertificate.certificate.verification.fingerprint
) {
  throw new Error("Human-vs-agent comparison certificate verification fingerprint was not stable across reads");
}
const humanAgentComparisonCertificateVerification = await readJson("/api/result-certificates/verify", {
  method: "POST",
  body: JSON.stringify({ certificate: humanAgentComparisonCertificate.certificate })
});
if (
  humanAgentComparisonCertificateVerification.verification?.schemaVersion !== "steambench.result-certificate-verification.v1" ||
  humanAgentComparisonCertificateVerification.verification?.valid !== true ||
  humanAgentComparisonCertificateVerification.verification?.expectedFingerprint !== humanAgentComparisonCertificate.certificate.verification.fingerprint ||
  humanAgentComparisonCertificateVerification.verification?.actualFingerprint !== humanAgentComparisonCertificate.certificate.verification.fingerprint ||
  humanAgentComparisonCertificateVerification.verification?.certificate?.kind !== "human-agent-comparison" ||
  humanAgentComparisonCertificateVerification.verification?.certificate?.readyForPublicShare !== true
) {
  throw new Error("Human-vs-agent comparison certificate verification API did not validate the public certificate");
}
const humanAgentCertificateIndex = await readJson("/api/result-certificates?kind=human-agent-comparison&limit=20");
if (
  humanAgentCertificateIndex.index?.schemaVersion !== "steambench.result-certificate-index.v1" ||
  humanAgentCertificateIndex.index?.requested?.kind !== "human-agent-comparison" ||
  humanAgentCertificateIndex.index?.requested?.readyForPublicShare !== true ||
  humanAgentCertificateIndex.index?.links?.verify !== `${baseUrl}/api/result-certificates/verify` ||
  !humanAgentCertificateIndex.index?.certificates?.some((entry) =>
    entry.kind === "human-agent-comparison" &&
    entry.id === `${user.user.id}:${agentCampaign.campaign.id}` &&
    entry.readyForPublicShare === true &&
    entry.fingerprint === humanAgentComparisonCertificate.certificate.verification.fingerprint &&
    entry.links?.resultCertificate?.endsWith(`/api/comparisons/human-agent/result-certificate?humanUserId=${user.user.id}&campaignId=${agentCampaign.campaign.id}`)
  )
) {
  throw new Error("Human-vs-agent certificate index did not expose the share-ready comparison fingerprint");
}
const publicCertificateIndex = await readJson("/api/result-certificates?kind=all&limit=50");
const publicCertificateKinds = new Set(publicCertificateIndex.index?.certificates?.map((entry) => entry.kind));
if (
  publicCertificateIndex.index?.schemaVersion !== "steambench.result-certificate-index.v1" ||
  publicCertificateIndex.index?.requested?.kind !== "all" ||
  publicCertificateIndex.index?.links?.verify !== `${baseUrl}/api/result-certificates/verify` ||
  publicCertificateIndex.index?.certificates?.every((entry) =>
    entry.readyForPublicShare === true &&
    entry.verificationMethod === "sha256" &&
    /^[a-f0-9]{64}$/.test(entry.fingerprint ?? "") &&
    typeof entry.links?.resultCertificate === "string"
  ) !== true ||
  !publicCertificateKinds.has("human-agent-comparison") ||
  !publicCertificateKinds.has("game-coverage-run") ||
  publicCertificateIndex.index?.certificates?.some((entry) =>
    entry.kind === "human-agent-comparison" &&
    entry.id === `${user.user.id}:${agentCampaign.campaign.id}` &&
    entry.fingerprint === humanAgentComparisonCertificate.certificate.verification.fingerprint
  ) !== true ||
  publicCertificateIndex.index?.certificates?.some((entry) =>
    entry.kind === "game-coverage-run" &&
    entry.id === coverageLocalRun.result.record.id &&
    entry.links?.resultCertificate?.endsWith(`/api/game-coverage-runs/${coverageLocalRun.result.record.id}/result-certificate`)
  ) !== true
) {
  throw new Error("Public result certificate index did not expose multiple share-ready certificate kinds");
}
const publicCertificateIndexCli = spawnSync(
  process.execPath,
  [
    "scripts/result-certificate-index.mjs",
    `--api=${baseUrl}`,
    "--kind=all",
    "--limit=50",
    "--verify=true",
    "--remote=true"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (publicCertificateIndexCli.status !== 0) {
  throw new Error(`Public certificate index CLI failed:\n${publicCertificateIndexCli.stdout}\n${publicCertificateIndexCli.stderr}`);
}
const publicCertificateIndexCliResult = JSON.parse(publicCertificateIndexCli.stdout);
if (
  publicCertificateIndexCliResult.schemaVersion !== "steambench.result-certificate-index-audit-cli.v1" ||
  publicCertificateIndexCliResult.summary?.valid !== true ||
  publicCertificateIndexCliResult.summary?.certificates < 2 ||
  publicCertificateIndexCliResult.summary?.failed !== 0 ||
  publicCertificateIndexCliResult.summary?.byKind?.["human-agent-comparison"] < 1 ||
  publicCertificateIndexCliResult.summary?.byKind?.["game-coverage-run"] < 1
) {
  throw new Error("Public certificate index CLI did not audit the share-ready certificate directory");
}
const humanAgentComparisonCertificateVerifyCli = spawnSync(
  process.execPath,
  [
    "scripts/result-certificate-verify.mjs",
    `--api=${baseUrl}`,
    `--url=/api/comparisons/human-agent/result-certificate?humanUserId=${user.user.id}&campaignId=${agentCampaign.campaign.id}`,
    "--remote=true"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (humanAgentComparisonCertificateVerifyCli.status !== 0) {
  throw new Error(`Human-vs-agent certificate verify CLI failed:\n${humanAgentComparisonCertificateVerifyCli.stdout}\n${humanAgentComparisonCertificateVerifyCli.stderr}`);
}
const humanAgentComparisonCertificateVerifyCliResult = JSON.parse(humanAgentComparisonCertificateVerifyCli.stdout);
if (
  humanAgentComparisonCertificateVerifyCliResult.schemaVersion !== "steambench.result-certificate-verify-cli.v1" ||
  humanAgentComparisonCertificateVerifyCliResult.summary?.valid !== true ||
  humanAgentComparisonCertificateVerifyCliResult.summary?.remoteValid !== true ||
  humanAgentComparisonCertificateVerifyCliResult.summary?.remoteMatches !== true ||
  humanAgentComparisonCertificateVerifyCliResult.summary?.expectedFingerprint !== humanAgentComparisonCertificate.certificate.verification.fingerprint ||
  humanAgentComparisonCertificateVerifyCliResult.summary?.kind !== "human-agent-comparison"
) {
  throw new Error("Human-vs-agent certificate verify CLI did not validate local and remote fingerprints");
}
const tamperedHumanAgentCertificate = {
  ...humanAgentComparisonCertificate.certificate,
  result: {
    ...humanAgentComparisonCertificate.certificate.result,
    humanScore: humanAgentComparisonCertificate.certificate.result.humanScore + 1
  }
};
const tamperedHumanAgentCertificateResponse = await fetch(`${baseUrl}/api/result-certificates/verify`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ certificate: tamperedHumanAgentCertificate })
});
const tamperedHumanAgentCertificateVerification = await tamperedHumanAgentCertificateResponse.json();
if (
  tamperedHumanAgentCertificateResponse.status !== 422 ||
  tamperedHumanAgentCertificateVerification.verification?.valid !== false ||
  tamperedHumanAgentCertificateVerification.verification?.errors?.includes("fingerprint_mismatch") !== true ||
  tamperedHumanAgentCertificateVerification.verification?.actualFingerprint === tamperedHumanAgentCertificateVerification.verification?.expectedFingerprint
) {
  throw new Error("Human-vs-agent comparison certificate verification API did not reject a tampered certificate");
}
const humanAgentComparisonStandings = await readJson(`/api/comparisons/human-agent/standings?humanUserId=${user.user.id}&campaignId=${agentCampaign.campaign.id}`);
if (
  humanAgentComparisonStandings.standings?.schemaVersion !== "steambench.human-agent-comparison-standings.v1" ||
  humanAgentComparisonStandings.standings?.totals?.comparisons !== 1 ||
  humanAgentComparisonStandings.standings?.totals?.completeComparisons !== 1 ||
  humanAgentComparisonStandings.standings?.totals?.readyForPublicShare !== 1 ||
  humanAgentComparisonStandings.standings?.leaderboard?.[0]?.comparisonId !== `${user.user.id}:${agentCampaign.campaign.id}` ||
  humanAgentComparisonStandings.standings?.leaderboard?.[0]?.links?.resultCertificate?.includes(`/api/comparisons/human-agent/result-certificate?humanUserId=${user.user.id}&campaignId=${agentCampaign.campaign.id}`) !== true
) {
  throw new Error("Human-vs-agent comparison standings did not expose the completed comparison leaderboard");
}
const humanComparisonOpsCli = spawnSync(
  process.execPath,
  [
    "scripts/human-comparison-ops.mjs",
    `--api=${baseUrl}`,
    `--human-user-id=${user.user.id}`,
    `--campaign-id=${agentCampaign.campaign.id}`,
    "--execute=advance-comparison-actions",
    "--max-steps=2"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (humanComparisonOpsCli.status !== 0) {
  throw new Error(`Human comparison ops CLI execute failed:\n${humanComparisonOpsCli.stdout}\n${humanComparisonOpsCli.stderr}`);
}
const humanComparisonOpsCliResult = JSON.parse(humanComparisonOpsCli.stdout);
if (
  humanComparisonOpsCliResult.schemaVersion !== "steambench.human-comparison-ops-cli.v1" ||
  humanComparisonOpsCliResult.summary?.status !== "ready-to-share" ||
  humanComparisonOpsCliResult.summary?.completeComparisons !== 1 ||
  humanComparisonOpsCliResult.summary?.readyForPublicShare !== 1 ||
  humanComparisonOpsCliResult.summary?.executedActionId !== "share-comparison-certificate" ||
  humanComparisonOpsCliResult.summary?.executedActionCount !== 1 ||
  humanComparisonOpsCliResult.summary?.executedActionIds?.[0] !== "share-comparison-certificate" ||
  humanComparisonOpsCliResult.summary?.certificateKind !== "human-agent-comparison" ||
  humanComparisonOpsCliResult.summary?.certificateReady !== true
) {
  throw new Error("Human comparison ops CLI did not expose the share-ready comparison certificate");
}
const completedHumanProfile = await readJson(`/api/competitors/human/${user.user.id}/profile`);
const completedAgentProfile = await readJson(`/api/competitors/agent/${agent.agent.id}/profile`);
if (
  completedHumanProfile.profile?.campaignComparisons?.total < 1 ||
  completedHumanProfile.profile?.campaignComparisons?.readyForPublicShare < 1 ||
  !completedHumanProfile.profile?.campaignComparisons?.recent?.some((entry) =>
    entry.comparisonId === `${user.user.id}:${agentCampaign.campaign.id}` &&
    entry.status === "complete" &&
    entry.readyForPublicShare === true &&
    entry.links?.resultCertificate?.includes(`/api/comparisons/human-agent/result-certificate?humanUserId=${user.user.id}&campaignId=${agentCampaign.campaign.id}`)
  ) ||
  completedAgentProfile.profile?.campaignComparisons?.total < 1 ||
  completedAgentProfile.profile?.campaignComparisons?.readyForPublicShare < 1 ||
  !completedAgentProfile.profile?.campaignComparisons?.recent?.some((entry) =>
    entry.comparisonId === `${user.user.id}:${agentCampaign.campaign.id}` &&
    entry.agentId === agent.agent.id
  )
) {
  throw new Error("Competitor profiles did not expose share-ready human-vs-agent campaign comparison history");
}
const allEventBundleWithCampaign = await readJson("/api/competition-events/all/evidence-bundle");
if (
  allEventBundleWithCampaign.bundle?.schemaVersion !== "steambench.competition-event-evidence-bundle.v1" ||
  !Array.isArray(allEventBundleWithCampaign.bundle?.campaignComparisons) ||
  allEventBundleWithCampaign.bundle?.integrity?.campaignComparisonCount !== allEventBundleWithCampaign.bundle.campaignComparisons.length ||
  allEventBundleWithCampaign.bundle?.campaignComparisons?.some((entry) =>
    entry.bundle !== undefined &&
    entry.bundle.schemaVersion !== "steambench.human-agent-comparison-evidence-bundle.v1"
  )
) {
  throw new Error("Competition event evidence did not expose campaign comparison rollups consistently");
}
const weeklyEventCampaignRun = await readJson("/api/competition-events/weekly/run-campaign-comparisons-local", {
  method: "POST",
  body: JSON.stringify({
    maxPairs: 2
  })
});
if (
  weeklyEventCampaignRun.run?.schemaVersion !== "steambench.event-campaign-comparison-run.v1" ||
  weeklyEventCampaignRun.run?.scope !== "weekly" ||
  weeklyEventCampaignRun.run?.candidatePairs < 1 ||
  !weeklyEventCampaignRun.run?.executed?.some((entry) =>
    entry.humanUserId === user.user.id &&
    entry.agentId === agent.agent.id &&
    entry.campaignId === agentCampaign.campaign.id &&
    entry.certificate?.kind === "human-agent-comparison" &&
    entry.certificate?.integrity?.readyForPublicShare === true
  ) ||
  weeklyEventCampaignRun.run?.bundle?.schemaVersion !== "steambench.competition-event-evidence-bundle.v1" ||
  weeklyEventCampaignRun.run?.certificate?.kind !== "competition-event"
) {
  throw new Error("Weekly event campaign comparison runner did not execute a share-ready registered human-agent campaign pair");
}

const run = await readJson("/api/runs", {
  method: "POST",
  body: JSON.stringify({
    taskId: state.tasks[0].id,
    competitor: "smoke-agent",
    competitorType: "agent"
  })
});

const traceRun = await readJson("/api/runs", {
  method: "POST",
  body: JSON.stringify({
    taskId: state.tasks[0].id,
    competitor: "smoke-trace-agent",
    competitorType: "agent"
  })
});
const playbook = await readJson(`/api/runs/${traceRun.run.id}/agent-playbook`);
if (
  playbook.playbook?.schemaVersion !== "steambench.agent-playbook.v1" ||
  playbook.playbook?.eventContract?.actionBatchEndpoint !== `/api/runs/${traceRun.run.id}/action-batches` ||
  playbook.playbook?.control?.actionSpace?.schemaVersion !== "steambench.runtime-action-space.v1" ||
  playbook.playbook?.control?.actionSpace?.constraints?.requireCanonicalCapture !== true
) {
  throw new Error("Agent playbook did not expose the action batch contract");
}
const actionTrace = await readJson(`/api/runs/${traceRun.run.id}/action-batches`, {
  method: "POST",
  body: JSON.stringify({
    step: 1,
    observation: "Smoke trace observed the first playable state.",
    actions: ["key:w", "mouse-click:left", "key:e"],
    checkpoint: "Smoke trace checkpoint",
    confidence: 0.8,
    idempotencyKey: `smoke-trace-${Date.now().toString(36)}`
  })
});
if (
  actionTrace.receipt?.schemaVersion !== "steambench.agent-action-batch-receipt.v1" ||
  actionTrace.receipt?.runId !== traceRun.run.id ||
  actionTrace.receipt?.acceptedActions !== 3 ||
  actionTrace.receipt?.rejectedActions !== 0 ||
  actionTrace.receipt?.audit?.canonicalArtifact !== "output/output.mp4" ||
  actionTrace.receipt?.audit?.executorReportRequired !== false ||
  actionTrace.receipt?.endpoints?.traceAudit !== `/api/runs/${traceRun.run.id}/agent-trace/audit` ||
  actionTrace.trace?.schemaVersion !== "steambench.agent-action-trace.v1" ||
  actionTrace.trace?.totals?.actions !== 3 ||
  actionTrace.trace?.coverage?.readyForSubmission !== true
) {
  throw new Error("Agent action batch did not produce a replayable action trace");
}
const controllerTask = state.tasks.find((task) => task.appid === 1145360 || task.appid === 1794680);
if (!controllerTask) {
  throw new Error("Expected fixture catalog to include a controller-input task");
}
const controllerTraceRun = await readJson("/api/runs", {
  method: "POST",
  body: JSON.stringify({
    taskId: controllerTask.id,
    competitor: "smoke-controller-agent",
    competitorType: "agent"
  })
});
const controllerPlaybook = await readJson(`/api/runs/${controllerTraceRun.run.id}/agent-playbook`);
if (
  controllerPlaybook.playbook?.control?.actionSpace?.inputMode !== "controller" ||
  controllerPlaybook.playbook?.control?.actionSpace?.transport !== "virtual-controller" ||
  controllerPlaybook.playbook?.control?.actionSpace?.permissions?.controller !== true ||
  !controllerPlaybook.playbook?.control?.actionSpace?.controller?.buttons?.includes("a")
) {
  throw new Error("Controller task playbook did not expose the virtual-controller action space");
}
const controllerHandoffBeforeControl = await readJson(`/api/runs/${controllerTraceRun.run.id}/agent-handoff`);
if (
  controllerHandoffBeforeControl.handoff?.schemaVersion !== "steambench.agent-runtime-handoff.v1" ||
  controllerHandoffBeforeControl.handoff?.status !== "needs-control-session" ||
  controllerHandoffBeforeControl.handoff?.control?.requiresControlSession !== true ||
  controllerHandoffBeforeControl.handoff?.recommendedActions?.some((action) => action.id === "create-control-session") !== true ||
  controllerHandoffBeforeControl.handoff?.recommendedActions?.find((action) => action.id === "run-agent-probe")?.command?.includes("--execute=advance-probe") !== true
) {
  throw new Error("Controller agent handoff did not require a control session before bridge actions");
}
const controllerProbeInspectCli = spawnSync(
  process.execPath,
  [
    "scripts/agent-runner-probe.mjs",
    `--api=${baseUrl}`,
    `--run=${controllerTraceRun.run.id}`
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (controllerProbeInspectCli.status !== 0) {
  throw new Error(`Agent runner probe inspect smoke failed:\n${controllerProbeInspectCli.stdout}\n${controllerProbeInspectCli.stderr}`);
}
const controllerProbeInspectResult = JSON.parse(controllerProbeInspectCli.stdout);
if (
  controllerProbeInspectResult.schemaVersion !== "steambench.agent-runner-probe-result.v1" ||
  controllerProbeInspectResult.execute !== "inspect" ||
  controllerProbeInspectResult.createdRun !== false ||
  controllerProbeInspectResult.playbook?.transport !== "virtual-controller" ||
  controllerProbeInspectResult.controlSession !== undefined ||
  controllerProbeInspectResult.actionBatch !== undefined ||
  controllerProbeInspectResult.trace?.totals?.actionBatches !== 0
) {
  throw new Error("Agent runner probe inspect should be read-only before explicit controller actions");
}
const platformControllerTraceRun = await readJson("/api/runs", {
  method: "POST",
  body: JSON.stringify({
    taskId: controllerTask.id,
    competitor: "smoke-platform-controller-agent",
    competitorType: "agent"
  })
});
const platformTraceControlCli = spawnSync(
  process.execPath,
  [
    "scripts/platform-ops.mjs",
    `--api=${baseUrl}`,
    "--scope=weekly",
    "--limit=200",
    "--execute=agent-traces:create-control-session"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (platformTraceControlCli.status !== 0) {
  throw new Error(`Platform ops agent trace control-session smoke failed:\n${platformTraceControlCli.stdout}\n${platformTraceControlCli.stderr}`);
}
const platformTraceControlCliResult = JSON.parse(platformTraceControlCli.stdout);
if (
  platformTraceControlCliResult.schemaVersion !== "steambench.platform-ops-cli.v1" ||
  platformTraceControlCliResult.summary?.executedActionId !== "agent-traces:create-control-session" ||
  platformTraceControlCliResult.summary?.controlSessionRunId !== platformControllerTraceRun.run.id ||
  platformTraceControlCliResult.summary?.controlSessionStatus !== "active" ||
  platformTraceControlCliResult.executedAction?.result?.schemaVersion !== "steambench.runtime-control-session.v1" ||
  platformTraceControlCliResult.executedAction?.result?.session?.actionSpace?.transport !== "virtual-controller" ||
  platformTraceControlCliResult.executedAction?.result?.links?.bridgeManifest?.includes("/api/control-sessions/") !== true
) {
  throw new Error("Platform ops CLI did not execute an agent trace control-session recommendation");
}
const controllerTraceOpsControlCli = spawnSync(
  process.execPath,
  [
    "scripts/agent-trace-ops.mjs",
    `--api=${baseUrl}`,
    "--verdict=needs-control-session",
    "--limit=10",
    "--execute=advance-trace-actions",
    "--max-steps=1",
    "--ttl-seconds=120",
    `--idempotency-key=smoke-control-cli-${Date.now().toString(36)}`
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (controllerTraceOpsControlCli.status !== 0) {
  throw new Error(`Agent trace ops control-session smoke failed:\n${controllerTraceOpsControlCli.stdout}\n${controllerTraceOpsControlCli.stderr}`);
}
const controllerTraceOpsControlCliResult = JSON.parse(controllerTraceOpsControlCli.stdout);
const controllerControlSession = controllerTraceOpsControlCliResult.executedAction?.result;
if (
  controllerTraceOpsControlCliResult.schemaVersion !== "steambench.agent-trace-ops-cli.v1" ||
  controllerTraceOpsControlCliResult.summary?.executedActionId !== "create-control-session" ||
  controllerTraceOpsControlCliResult.summary?.executedActionIds?.[0] !== "create-control-session" ||
  controllerTraceOpsControlCliResult.summary?.executedActionCount !== 1 ||
  controllerTraceOpsControlCliResult.summary?.controlSessionRunId !== controllerTraceRun.run.id ||
  controllerControlSession.schemaVersion !== "steambench.runtime-control-session.v1" ||
  controllerControlSession.session?.runId !== controllerTraceRun.run.id ||
  controllerControlSession.session?.status !== "active" ||
  controllerControlSession.session?.actionSpace?.transport !== "virtual-controller" ||
  controllerControlSession.links?.actionBatch !== `/api/runs/${controllerTraceRun.run.id}/action-batches` ||
  controllerControlSession.links?.accessPacket !== `/api/control-sessions/${controllerControlSession.session.id}/access-packet` ||
  controllerControlSession.links?.bridgeManifest !== `/api/control-sessions/${controllerControlSession.session.id}/bridge-manifest`
) {
  throw new Error("Controller control session did not grant a bounded virtual-controller lease");
}
const controllerAccessPacket = await readJson(`/api/control-sessions/${controllerControlSession.session.id}/access-packet`);
if (
  controllerAccessPacket.packet?.schemaVersion !== "steambench.runtime-control-access-packet.v1" ||
  controllerAccessPacket.packet?.purpose !== "bounded-agent-game-control" ||
  controllerAccessPacket.packet?.lease?.id !== controllerControlSession.session.id ||
  controllerAccessPacket.packet?.lease?.runId !== controllerTraceRun.run.id ||
  controllerAccessPacket.packet?.lease?.ttlRemainingSeconds <= 0 ||
  controllerAccessPacket.packet?.permissions?.inputMode !== "controller" ||
  controllerAccessPacket.packet?.permissions?.transport !== "virtual-controller" ||
  controllerAccessPacket.packet?.permissions?.privilegedSystemInput !== false ||
  controllerAccessPacket.packet?.permissions?.canonicalCaptureRequired !== true ||
  controllerAccessPacket.packet?.endpoints?.actionBatch !== `/api/runs/${controllerTraceRun.run.id}/action-batches` ||
  controllerAccessPacket.packet?.endpoints?.bridgeManifest !== `/api/control-sessions/${controllerControlSession.session.id}/bridge-manifest` ||
  controllerAccessPacket.packet?.endpoints?.executorReport !== `/api/runs/${controllerTraceRun.run.id}/controller-executor-reports` ||
  controllerAccessPacket.packet?.bridge?.provider !== "geforce-now" ||
  controllerAccessPacket.packet?.bridge?.ready !== true ||
  controllerAccessPacket.packet?.bridge?.manifestSchemaVersion !== "steambench.control-bridge-manifest.v1" ||
  controllerAccessPacket.packet?.bridge?.executor?.command !== "npm run executor:geforce-now" ||
  controllerAccessPacket.packet?.bridge?.executor?.requestSchemaVersion !== "steambench.controller-executor-request.v1" ||
  controllerAccessPacket.packet?.bridge?.executor?.reportSchemaVersion !== "steambench.controller-executor-report.v1" ||
  controllerAccessPacket.packet?.bridge?.handoff?.readManifest !== `/api/control-sessions/${controllerControlSession.session.id}/bridge-manifest` ||
  controllerAccessPacket.packet?.bridge?.handoff?.submitActions !== `/api/runs/${controllerTraceRun.run.id}/action-batches` ||
  controllerAccessPacket.packet?.bridge?.handoff?.reportBack !== `/api/runs/${controllerTraceRun.run.id}/controller-executor-reports` ||
  controllerAccessPacket.packet?.bridge?.handoff?.reportBackMode !== "typed-controller-executor-report-submission" ||
  controllerAccessPacket.packet?.audit?.readyForActions !== true ||
  controllerAccessPacket.packet?.audit?.readyForBridge !== true ||
  controllerAccessPacket.packet?.audit?.canonicalArtifact !== "output/output.mp4" ||
  controllerAccessPacket.packet?.audit?.forbiddenArtifactNames?.includes("output-test.mp4") !== true
) {
  throw new Error("Controller access packet did not expose the bounded agent action permissions");
}
const controllerActionTrace = await readJson(`/api/runs/${controllerTraceRun.run.id}/action-batches`, {
  method: "POST",
  body: JSON.stringify({
    controlSessionId: controllerControlSession.session.id,
    observation: "Smoke controller trace observed a playable state.",
    actions: [
      { type: "stick", stick: "left", x: 0.75, y: 0.1, durationMs: 250 },
      { type: "button", button: "a", action: "tap" },
      { type: "trigger", trigger: "rt", value: 1, durationMs: 120 }
    ],
    confidence: 0.8,
    idempotencyKey: `smoke-controller-${Date.now().toString(36)}`
  })
});
if (
  controllerActionTrace.receipt?.schemaVersion !== "steambench.agent-action-batch-receipt.v1" ||
  controllerActionTrace.receipt?.runId !== controllerTraceRun.run.id ||
  controllerActionTrace.receipt?.controlSessionId !== controllerControlSession.session.id ||
  controllerActionTrace.receipt?.transport !== "virtual-controller" ||
  controllerActionTrace.receipt?.acceptedActions !== 3 ||
  controllerActionTrace.receipt?.rejectedActions !== 0 ||
  controllerActionTrace.receipt?.actionTypes?.includes("button") !== true ||
  controllerActionTrace.receipt?.executionPlan?.schemaVersion !== "steambench.controller-execution-plan.v1" ||
  controllerActionTrace.receipt?.executionPlan?.stepCount <= 0 ||
  controllerActionTrace.receipt?.controllerExecutorRequest?.schemaVersion !== "steambench.controller-executor-request.v1" ||
  controllerActionTrace.receipt?.controllerExecutorRequest?.command !== "npm run executor:geforce-now" ||
  controllerActionTrace.receipt?.controllerExecutorRequest?.stepCount !== controllerActionTrace.receipt?.executionPlan?.stepCount ||
  controllerActionTrace.controllerExecutorRequest?.schemaVersion !== "steambench.controller-executor-request.v1" ||
  controllerActionTrace.controllerExecutorRequest?.executor !== "geforce-now" ||
  controllerActionTrace.controllerExecutorRequest?.provider !== "geforce-now-external" ||
  controllerActionTrace.controllerExecutorRequest?.sessionId !== controllerControlSession.session.id ||
  controllerActionTrace.controllerExecutorRequest?.runId !== controllerTraceRun.run.id ||
  controllerActionTrace.controllerExecutorRequest?.plan?.schemaVersion !== "steambench.controller-execution-plan.v1" ||
  controllerActionTrace.controllerExecutorRequest?.plan?.steps?.length !== controllerActionTrace.receipt?.executionPlan?.stepCount ||
  controllerActionTrace.receipt?.audit?.executorReportRequired !== true ||
  controllerActionTrace.receipt?.audit?.canonicalArtifact !== "output/output.mp4" ||
  controllerActionTrace.receipt?.audit?.forbiddenArtifactNames?.includes("output-test.mp4") !== true ||
  controllerActionTrace.receipt?.endpoints?.traceAudit !== `/api/runs/${controllerTraceRun.run.id}/agent-trace/audit` ||
  controllerActionTrace.receipt?.endpoints?.bridgeManifest !== `/api/control-sessions/${controllerControlSession.session.id}/bridge-manifest` ||
  controllerActionTrace.actionSpace?.inputMode !== "controller" ||
  controllerActionTrace.controlSession?.id !== controllerControlSession.session.id ||
  controllerActionTrace.normalizedActions?.length !== 3 ||
  controllerActionTrace.normalizedActionLabels?.[0] !== "stick:left:0.75,0.10" ||
  controllerActionTrace.executionPlan?.schemaVersion !== "steambench.controller-execution-plan.v1" ||
  controllerActionTrace.executionPlan?.target !== "xinput-standard" ||
  controllerActionTrace.executionPlan?.steps?.some((step) => step.kind === "button-down") !== true ||
  controllerActionTrace.normalizedActions?.[0]?.type !== "stick" ||
  controllerActionTrace.trace?.totals?.actions !== 3
) {
  throw new Error("Controller action batch did not normalize into replayable virtual-controller actions");
}
const controllerHandoffAfterActions = await readJson(`/api/runs/${controllerTraceRun.run.id}/agent-handoff`);
if (
  controllerHandoffAfterActions.handoff?.status !== "ready-for-submission" ||
  controllerHandoffAfterActions.handoff?.control?.activeSession?.id !== controllerControlSession.session.id ||
  controllerHandoffAfterActions.handoff?.control?.activeSession?.executorReport !==
    `/api/runs/${controllerTraceRun.run.id}/controller-executor-reports` ||
  controllerHandoffAfterActions.handoff?.endpoints?.activeExecutorReport !==
    `/api/runs/${controllerTraceRun.run.id}/controller-executor-reports` ||
  controllerHandoffAfterActions.handoff?.trace?.coverage?.readyForSubmission !== true ||
  controllerHandoffAfterActions.handoff?.recommendedActions?.some((action) => action.id === "submit-run") !== true
) {
  throw new Error("Controller agent handoff did not advance to submission readiness with executor report handoff after action coverage");
}
const controllerTraceAuditBeforeExecutor = await readJson(`/api/runs/${controllerTraceRun.run.id}/agent-trace/audit`);
if (
  controllerTraceAuditBeforeExecutor.audit?.schemaVersion !== "steambench.agent-trace-audit.v1" ||
  controllerTraceAuditBeforeExecutor.audit?.verdict !== "needs-executor-report" ||
  controllerTraceAuditBeforeExecutor.audit?.totals?.actions !== 3 ||
  controllerTraceAuditBeforeExecutor.audit?.integrity?.executorReportRequired !== true ||
  controllerTraceAuditBeforeExecutor.audit?.integrity?.executorReportPresent !== false
) {
  throw new Error("Controller trace audit did not require an executor report before bridge execution");
}
const controllerTraceOpsBeforeExecutor = await readJson("/api/agent-traces/ops-report?verdict=needs-executor-report&limit=10");
if (
  controllerTraceOpsBeforeExecutor.report?.schemaVersion !== "steambench.agent-trace-ops-report.v1" ||
  controllerTraceOpsBeforeExecutor.report?.status !== "needs-runtime" ||
  controllerTraceOpsBeforeExecutor.report?.tickets?.some((ticket) =>
    ticket.run?.id === controllerTraceRun.run.id &&
    ticket.verdict === "needs-executor-report" &&
    ticket.audit?.activeControlSessionId === controllerControlSession.session.id
  ) !== true ||
  controllerTraceOpsBeforeExecutor.report?.recommendedActions?.some((action) =>
    action.id === "run-bridge-executor" &&
    action.command?.includes(`--session=${controllerControlSession.session.id}`)
  ) !== true
) {
  throw new Error("Agent trace ops report did not queue the controller run for bridge execution");
}
const controllerBridgeManifest = await readJson(`/api/control-sessions/${controllerControlSession.session.id}/bridge-manifest`);
if (
  controllerBridgeManifest.manifest?.schemaVersion !== "steambench.control-bridge-manifest.v1" ||
  controllerBridgeManifest.manifest?.bridge?.provider !== "geforce-now" ||
  controllerBridgeManifest.manifest?.bridge?.transport !== "virtual-controller" ||
  controllerBridgeManifest.manifest?.bridge?.executor?.planSchemaVersion !== "steambench.controller-execution-plan.v1" ||
  controllerBridgeManifest.manifest?.lease?.status !== "active" ||
  controllerBridgeManifest.manifest?.endpoints?.accessPacket !== `/api/control-sessions/${controllerControlSession.session.id}/access-packet` ||
  controllerBridgeManifest.manifest?.endpoints?.executorReport !== `/api/runs/${controllerTraceRun.run.id}/controller-executor-reports` ||
  controllerBridgeManifest.manifest?.evidence?.canonicalArtifact !== "output/output.mp4" ||
  controllerBridgeManifest.manifest?.audit?.readyForBridge !== true ||
  controllerBridgeManifest.manifest?.audit?.acceptedActions !== 3
) {
  throw new Error("Controller bridge manifest did not expose a bridge-ready virtual-controller lease");
}
const controlBridgeOpsCli = spawnSync(
  process.execPath,
  [
    "scripts/control-bridge-ops.mjs",
    `--api=${baseUrl}`,
    "--status=active",
    "--transport=virtual-controller",
    "--limit=10",
    "--execute=advance-control-bridge-actions",
    "--max-steps=1",
    "--executor=audit",
    "--observation=Smoke bridge runner observed a playable state."
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (controlBridgeOpsCli.status !== 0) {
  throw new Error(`Control bridge ops execute smoke failed:\n${controlBridgeOpsCli.stdout}\n${controlBridgeOpsCli.stderr}`);
}
const controlBridgeOpsCliResult = JSON.parse(controlBridgeOpsCli.stdout);
const controlBridgeRunnerResult = controlBridgeOpsCliResult.executedAction?.result;
if (
  controlBridgeOpsCliResult.schemaVersion !== "steambench.control-bridge-ops-cli.v1" ||
  controlBridgeOpsCliResult.summary?.executedActionId !== "run-control-bridge" ||
  controlBridgeOpsCliResult.summary?.executedActionIds?.[0] !== "run-control-bridge" ||
  controlBridgeOpsCliResult.summary?.executedActionCount !== 1 ||
  controlBridgeOpsCliResult.summary?.bridgeSessionId !== controllerControlSession.session.id ||
  controlBridgeOpsCliResult.summary?.bridgeExecutorStatus !== "validated" ||
  controlBridgeOpsCliResult.summary?.bridgeExecutorSideEffects !== false ||
  controlBridgeRunnerResult.schemaVersion !== "steambench.control-bridge-runner-result.v1" ||
  controlBridgeRunnerResult.sessionId !== controllerControlSession.session.id ||
  controlBridgeRunnerResult.provider !== "geforce-now" ||
  controlBridgeRunnerResult.transport !== "virtual-controller" ||
  controlBridgeRunnerResult.inputMode !== "controller" ||
  controlBridgeRunnerResult.executor !== "audit" ||
  controlBridgeRunnerResult.dryRun !== false ||
  controlBridgeRunnerResult.actionCount < 1 ||
  controlBridgeRunnerResult.acceptedActionLabels?.length !== controlBridgeRunnerResult.actionCount ||
  controlBridgeRunnerResult.executionPlan?.schemaVersion !== "steambench.controller-execution-plan.v1" ||
  controlBridgeRunnerResult.executionPlan?.stepCount < controlBridgeRunnerResult.actionCount ||
  controlBridgeRunnerResult.executorReport?.schemaVersion !== "steambench.controller-executor-report.v1" ||
  controlBridgeRunnerResult.executorRequest?.schemaVersion !== "steambench.controller-executor-request.v1" ||
  controlBridgeRunnerResult.executorRequest?.provider !== "geforce-now-external" ||
  controlBridgeRunnerResult.executorRequest?.stepCount !== controlBridgeRunnerResult.executionPlan?.stepCount ||
  controlBridgeRunnerResult.executorReport?.status !== "validated" ||
  controlBridgeRunnerResult.executorReport?.sideEffects !== false ||
  controlBridgeRunnerResult.executorReport?.plannedStepCount !== controlBridgeRunnerResult.executionPlan.stepCount ||
  controlBridgeRunnerResult.executorSubmission?.schemaVersion !== "steambench.controller-executor-report-submission.v1" ||
  controlBridgeRunnerResult.executorSubmission?.traceExecutorReports < 1 ||
  controlBridgeRunnerResult.executorSubmission?.traceAudit !== `/api/runs/${controllerTraceRun.run.id}/agent-trace/audit` ||
  controlBridgeRunnerResult.executorEvent?.type !== "checkpoint" ||
  controlBridgeRunnerResult.executorEvent?.executorStatus !== "validated" ||
  controlBridgeRunnerResult.executorEvent?.sideEffects !== false ||
  controlBridgeRunnerResult.after?.readyForBridge !== true ||
  controlBridgeRunnerResult.after?.executorReports < 1 ||
  controlBridgeRunnerResult.after?.lastExecutorStatus !== "validated" ||
  controlBridgeRunnerResult.after?.lastExecutorSideEffects !== false ||
  controlBridgeRunnerResult.after?.acceptedActions < 4
) {
  throw new Error("Control bridge runner did not submit a manifest-driven controller action batch");
}
const controllerTraceAuditAfterExecutor = await readJson(`/api/runs/${controllerTraceRun.run.id}/agent-trace/audit`);
if (
  controllerTraceAuditAfterExecutor.audit?.verdict !== "trace-ready" ||
  controllerTraceAuditAfterExecutor.audit?.totals?.executorReports < 1 ||
  controllerTraceAuditAfterExecutor.audit?.integrity?.executorReportsSideEffectFree !== true
) {
  throw new Error("Controller trace audit did not become ready after a side-effect-free executor report");
}
const controllerTraceOpsAfterExecutor = await readJson("/api/agent-traces/ops-report?verdict=trace-ready&limit=10");
if (
  controllerTraceOpsAfterExecutor.report?.schemaVersion !== "steambench.agent-trace-ops-report.v1" ||
  controllerTraceOpsAfterExecutor.report?.status !== "ready" ||
  controllerTraceOpsAfterExecutor.report?.tickets?.some((ticket) =>
    ticket.run?.id === controllerTraceRun.run.id &&
    ticket.verdict === "trace-ready"
  ) !== true
) {
  throw new Error("Agent trace ops report did not mark the controller run trace-ready after bridge execution");
}
const geForceNowFixtureRunner = spawnSync(
  process.execPath,
  [
    "scripts/control-bridge-runner.mjs",
    `--api=${baseUrl}`,
    `--session=${controllerControlSession.session.id}`,
    "--executor=geforce-now",
    `--executor-command=${process.execPath}`,
    `--executor-args=${JSON.stringify(["scripts/fixtures/geforce-now-executor-fixture.mjs"])}`,
    "--observation=Smoke GeForce NOW fixture runner observed a playable state."
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (geForceNowFixtureRunner.status !== 0) {
  throw new Error(`GeForce NOW fixture runner smoke failed:\n${geForceNowFixtureRunner.stdout}\n${geForceNowFixtureRunner.stderr}`);
}
const geForceNowFixtureRunnerResult = JSON.parse(geForceNowFixtureRunner.stdout);
if (
  geForceNowFixtureRunnerResult.executor !== "geforce-now" ||
  geForceNowFixtureRunnerResult.executorReport?.schemaVersion !== "steambench.controller-executor-report.v1" ||
  geForceNowFixtureRunnerResult.executorReport?.executor !== "geforce-now" ||
  geForceNowFixtureRunnerResult.executorReport?.provider !== "geforce-now-fixture" ||
  geForceNowFixtureRunnerResult.executorReport?.adapterProtocol !== "steambench.controller-executor-request.v1" ||
  geForceNowFixtureRunnerResult.executorReport?.plannedStepCount !== geForceNowFixtureRunnerResult.executionPlan?.stepCount ||
  geForceNowFixtureRunnerResult.executorReport?.sideEffects !== false ||
  geForceNowFixtureRunnerResult.executorEvent?.type !== "checkpoint" ||
  geForceNowFixtureRunnerResult.executorEvent?.executor !== "geforce-now" ||
  geForceNowFixtureRunnerResult.after?.executorReports < 2 ||
  geForceNowFixtureRunnerResult.after?.lastExecutor !== "geforce-now" ||
  geForceNowFixtureRunnerResult.after?.lastExecutorProvider !== "geforce-now-fixture"
) {
  throw new Error("GeForce NOW fixture executor did not consume the controller execution plan");
}
const geForceNowGamepadRunner = spawnSync(
  process.execPath,
  [
    "scripts/control-bridge-runner.mjs",
    `--api=${baseUrl}`,
    `--session=${controllerControlSession.session.id}`,
    "--executor=geforce-now",
    `--executor-command=${process.execPath}`,
    `--executor-args=${JSON.stringify([
      "scripts/geforce-now-gamepad-executor.mjs",
      "--backend=command",
      `--backend-command=${process.execPath}`,
      `--backend-args=${JSON.stringify(["scripts/fixtures/geforce-now-gamepad-backend-fixture.mjs"])}`
    ])}`,
    "--observation=Smoke GeForce NOW gamepad adapter observed a playable state."
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (geForceNowGamepadRunner.status !== 0) {
  throw new Error(`GeForce NOW gamepad adapter runner smoke failed:\n${geForceNowGamepadRunner.stdout}\n${geForceNowGamepadRunner.stderr}`);
}
const geForceNowGamepadRunnerResult = JSON.parse(geForceNowGamepadRunner.stdout);
if (
  geForceNowGamepadRunnerResult.executor !== "geforce-now" ||
  geForceNowGamepadRunnerResult.executorReport?.schemaVersion !== "steambench.controller-executor-report.v1" ||
  geForceNowGamepadRunnerResult.executorReport?.status !== "executed" ||
  geForceNowGamepadRunnerResult.executorReport?.executor !== "geforce-now" ||
  geForceNowGamepadRunnerResult.executorReport?.provider !== "geforce-now-backend-fixture" ||
  geForceNowGamepadRunnerResult.executorReport?.adapterProtocol !== "steambench.controller-executor-request.v1" ||
  geForceNowGamepadRunnerResult.executorReport?.backendProtocol !== "steambench.geforce-now-gamepad-backend-request.v1" ||
  geForceNowGamepadRunnerResult.executorReport?.backend !== "command" ||
  geForceNowGamepadRunnerResult.executorReport?.plannedStepCount !== geForceNowGamepadRunnerResult.executionPlan?.stepCount ||
  geForceNowGamepadRunnerResult.executorReport?.executedStepCount !== geForceNowGamepadRunnerResult.executionPlan?.stepCount ||
  geForceNowGamepadRunnerResult.executorReport?.sideEffects !== false ||
  geForceNowGamepadRunnerResult.executorEvent?.type !== "checkpoint" ||
  geForceNowGamepadRunnerResult.executorEvent?.executor !== "geforce-now" ||
  geForceNowGamepadRunnerResult.executorEvent?.executorStatus !== "executed" ||
  geForceNowGamepadRunnerResult.after?.executorReports < 3 ||
  geForceNowGamepadRunnerResult.after?.lastExecutor !== "geforce-now" ||
  geForceNowGamepadRunnerResult.after?.lastExecutorProvider !== "geforce-now-backend-fixture" ||
  geForceNowGamepadRunnerResult.after?.lastExecutorStatus !== "executed" ||
  geForceNowGamepadRunnerResult.after?.lastExecutorSideEffects !== false
) {
  throw new Error("GeForce NOW gamepad adapter did not execute and persist the bridge executor report");
}
const controllerRunAudit = await readJson(`/api/runs/${controllerTraceRun.run.id}/audit`);
if (
  !controllerRunAudit.audit?.controllerExecutorReports?.some((entry) =>
    entry.executor === "geforce-now" &&
    entry.provider === "geforce-now-fixture" &&
    entry.status === "validated" &&
    entry.sideEffects === false &&
    entry.adapterProtocol === "steambench.controller-executor-request.v1"
  )
) {
  throw new Error("Controller run audit did not persist the GeForce NOW executor report");
}
if (
  !controllerRunAudit.audit?.controllerExecutorReports?.some((entry) =>
    entry.executor === "geforce-now" &&
    entry.provider === "geforce-now-backend-fixture" &&
    entry.status === "executed" &&
    entry.executedStepCount === entry.plannedStepCount &&
    entry.sideEffects === false &&
    entry.backendProtocol === "steambench.geforce-now-gamepad-backend-request.v1"
  )
) {
  throw new Error("Controller run audit did not persist the GeForce NOW gamepad backend executor report");
}
const controllerRunEvidenceBundle = await readJson(`/api/runs/${controllerTraceRun.run.id}/evidence-bundle`);
if (
  controllerRunEvidenceBundle.bundle?.integrity?.executorReportCount < 3 ||
  controllerRunEvidenceBundle.bundle?.integrity?.latestExecutorReport?.executor !== "geforce-now" ||
  controllerRunEvidenceBundle.bundle?.integrity?.latestExecutorReport?.provider !== "geforce-now-backend-fixture" ||
  controllerRunEvidenceBundle.bundle?.integrity?.latestExecutorReport?.status !== "executed" ||
  controllerRunEvidenceBundle.bundle?.integrity?.latestExecutorReport?.sideEffects !== false ||
  !controllerRunEvidenceBundle.bundle?.integrity?.checklist?.some((entry) =>
    entry.id === "controller-executor-report" &&
    entry.status === "pass"
  )
) {
  throw new Error("Controller run evidence bundle did not expose executor report evidence");
}
const controllerStream = await readJson(`/api/runs/${controllerTraceRun.run.id}/livestreams`, {
  method: "POST",
  body: JSON.stringify({
    title: "Smoke controller executor broadcast"
  })
});
await readJson(`/api/livestreams/${controllerStream.stream.id}/status`, {
  method: "POST",
  body: JSON.stringify({
    status: "ended",
    viewerCount: 11
  })
});
const controllerBroadcastBundle = await readJson(`/api/broadcasts/${controllerStream.stream.id}/evidence-bundle`);
if (
  controllerBroadcastBundle.bundle?.integrity?.executorReportCount < 3 ||
  controllerBroadcastBundle.bundle?.integrity?.latestExecutorReport?.executor !== "geforce-now" ||
  controllerBroadcastBundle.bundle?.integrity?.latestExecutorReport?.provider !== "geforce-now-backend-fixture" ||
  controllerBroadcastBundle.bundle?.integrity?.latestExecutorReport?.status !== "executed" ||
  controllerBroadcastBundle.bundle?.integrity?.latestExecutorReport?.sideEffects !== false ||
  !controllerBroadcastBundle.bundle?.integrity?.checklist?.some((entry) =>
    entry.id === "controller-executor-report" &&
    entry.status === "pass"
  )
) {
  throw new Error("Controller broadcast evidence bundle did not expose executor report evidence");
}
const controllerBroadcastCertificate = await readJson(`/api/broadcasts/${controllerStream.stream.id}/result-certificate`);
if (controllerBroadcastCertificate.certificate?.evidence?.executorReportCount < 3) {
  throw new Error("Controller broadcast certificate did not expose executor report count");
}
const controllerRunCertificate = await readJson(`/api/runs/${controllerTraceRun.run.id}/result-certificate`);
if (controllerRunCertificate.certificate?.evidence?.executorReportCount < 3) {
  throw new Error("Controller run result certificate did not expose executor report count");
}
const controllerControlHeartbeat = await readJson(`/api/control-sessions/${controllerControlSession.session.id}/heartbeat`, {
  method: "POST"
});
if (controllerControlHeartbeat.session?.status !== "active" || !controllerControlHeartbeat.session?.heartbeatAt) {
  throw new Error("Controller control session heartbeat did not keep the session active");
}
const controllerControlRevoke = await readJson(`/api/control-sessions/${controllerControlSession.session.id}/revoke`, {
  method: "POST",
  body: JSON.stringify({
    summary: "smoke revoke"
  })
});
if (controllerControlRevoke.session?.status !== "revoked") {
  throw new Error("Controller control session revoke did not close the lease");
}

const simulated = await readJson(`/api/runs/${run.run.id}/simulate-agent`, {
  method: "POST",
  body: JSON.stringify({})
});

if (simulated.run.status !== "scored" || simulated.run.artifactName !== "output.mp4") {
  throw new Error("Run lifecycle did not reach scored state with the canonical artifact");
}

if (!simulated.evaluation?.passed) {
  throw new Error("Run evaluator did not pass after verified proof submission");
}

if (!Array.isArray(simulated.events) || simulated.events.length < 5) {
  throw new Error("Simulated agent run did not produce an auditable event chain");
}

const runDetail = await readJson(`/api/runs/${run.run.id}`);
if (!Array.isArray(runDetail.artifacts) || !runDetail.artifacts.some((artifact) => artifact.name === "output.mp4")) {
  throw new Error("Simulated agent run did not persist the canonical output.mp4 artifact");
}

if (!Array.isArray(runDetail.proofs) || !runDetail.proofs.some((proof) => proof.type === "steam-achievement" && proof.status === "verified")) {
  throw new Error("Simulated agent run did not persist verified Steam achievement proof");
}

if (!Array.isArray(runDetail.streams) || !runDetail.streams.some((stream) => stream.status === "ended")) {
  throw new Error("Simulated agent run did not persist a livestream session");
}
if (!runDetail.proofs.some((proof) => proof.type === "livestream" && proof.status === "verified")) {
  throw new Error("Simulated agent run did not persist verified livestream proof");
}
const runAudit = await readJson(`/api/runs/${run.run.id}/audit`);
if (
  runAudit.audit?.verdict !== "scoreboard-ready" ||
  runAudit.audit?.canonicalArtifact?.name !== "output.mp4" ||
  !runAudit.audit?.scoreboardRow ||
  !runAudit.audit?.requiredProofs?.every((proof) => proof.verified)
) {
  throw new Error("Run audit report did not prove the scored run is scoreboard-ready");
}
const scoreboardShareCli = spawnSync(
  process.execPath,
  [
    "scripts/scoreboard-ops.mjs",
    `--api=${baseUrl}`,
    `--appid=${simulated.task.appid}`,
    "--status=scoreboard-ready",
    "--limit=10",
    "--execute=advance-scoreboard-actions",
    "--max-steps=2"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (scoreboardShareCli.status !== 0) {
  throw new Error(`Scoreboard ops CLI execute failed:\n${scoreboardShareCli.stdout}\n${scoreboardShareCli.stderr}`);
}
const scoreboardShareCliResult = JSON.parse(scoreboardShareCli.stdout);
if (
  scoreboardShareCliResult.schemaVersion !== "steambench.scoreboard-ops-cli.v1" ||
  scoreboardShareCliResult.summary?.executedActionId !== "share-standings" ||
  scoreboardShareCliResult.summary?.executedActionCount !== 1 ||
  scoreboardShareCliResult.summary?.executedActionIds?.[0] !== "share-standings" ||
  scoreboardShareCliResult.summary?.sharedStandings !== true ||
  scoreboardShareCliResult.summary?.scoreboardReady < 1 ||
  !scoreboardShareCliResult.executedAction?.result?.standings?.competitors?.some((entry) => entry.competitor === simulated.run.competitor)
) {
  throw new Error("Scoreboard ops CLI did not execute the share-ready standings recommendation");
}
const evidenceBundle = await readJson(`/api/runs/${run.run.id}/evidence-bundle`);
if (
  evidenceBundle.bundle?.schemaVersion !== "steambench.evidence-bundle.v1" ||
  evidenceBundle.bundle?.manifest?.schemaVersion !== "steambench.execution-manifest.v1" ||
  evidenceBundle.bundle?.integrity?.canonicalArtifactPresent !== true ||
  evidenceBundle.bundle?.integrity?.requiredProofsVerified !== true ||
  evidenceBundle.bundle?.integrity?.executorReportCount !== 0 ||
  !evidenceBundle.bundle?.integrity?.checklist?.every((item) => item.status === "pass")
) {
  throw new Error("Run evidence bundle did not assemble reproducible scored-run evidence");
}

const broadcasts = await readJson("/api/broadcasts");
const broadcastRow = broadcasts.broadcasts?.find((entry) => entry.stream?.runId === run.run.id);
if (!broadcastRow) {
  throw new Error("Broadcast list did not include the simulated run stream");
}
if (
  broadcasts.center?.totals?.scoreboardReady < 1 ||
  !broadcasts.center?.scoreboardReady?.some((entry) => entry.stream?.runId === run.run.id && entry.proofReady)
) {
  throw new Error("Broadcast list did not expose the scored run through the broadcast center");
}
const broadcastCenter = await readJson("/api/broadcasts/center");
if (!broadcastCenter.center?.scoreboardReady?.some((entry) => entry.stream.runId === run.run.id && entry.proofReady)) {
  throw new Error("Broadcast center did not expose the scored run as proof-ready replay");
}
const broadcastOps = await readJson("/api/broadcasts/ops-report?limit=10");
if (
  broadcastOps.report?.schemaVersion !== "steambench.broadcast-ops-report.v1" ||
  broadcastOps.report?.totals?.scoreboardReady < 1 ||
  !broadcastOps.report?.tickets?.some((ticket) => ticket.stream?.runId === run.run.id && ticket.status === "scoreboard-ready" && ticket.readiness === "public") ||
  !broadcastOps.report?.recommendedActions?.some((entry) => entry.id === "share-broadcast-certificate")
) {
  throw new Error("Broadcast ops report did not expose the proof-ready replay for public sharing");
}
const broadcastShareCli = spawnSync(
  process.execPath,
  [
    "scripts/broadcast-ops.mjs",
    `--api=${baseUrl}`,
    "--status=scoreboard-ready",
    "--limit=10",
    "--execute=advance-broadcast-actions",
    "--max-steps=2"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (broadcastShareCli.status !== 0) {
  throw new Error(`Broadcast ops CLI execute failed:\n${broadcastShareCli.stdout}\n${broadcastShareCli.stderr}`);
}
const broadcastShareCliResult = JSON.parse(broadcastShareCli.stdout);
if (
  broadcastShareCliResult.schemaVersion !== "steambench.broadcast-ops-cli.v1" ||
  broadcastShareCliResult.summary?.executedActionId !== "share-broadcast-certificate" ||
  broadcastShareCliResult.summary?.executedActionCount !== 1 ||
  broadcastShareCliResult.summary?.executedActionIds?.[0] !== "share-broadcast-certificate" ||
  broadcastShareCliResult.summary?.certificateKind !== "broadcast" ||
  broadcastShareCliResult.summary?.readyForPublicShare !== true
) {
  throw new Error("Broadcast ops CLI did not resolve a share-ready broadcast certificate");
}
const gameProfile = await readJson(`/api/games/${simulated.task.appid}/profile`);
if (
  gameProfile.profile?.game?.appid !== simulated.task.appid ||
  gameProfile.profile?.totals?.scoreboardRows < 1 ||
  gameProfile.profile?.totals?.activeTasks < 1
) {
  throw new Error("Game benchmark profile did not expose scored rows for the simulated game");
}
if (!gameProfile.profile?.broadcasts?.some((entry) => entry.stream.runId === run.run.id && entry.scoreboardReady)) {
  throw new Error("Game benchmark profile did not expose the scored broadcast replay");
}
const broadcastDetail = await readJson(`/api/broadcasts/${broadcastRow.stream.id}`);
if (!broadcastDetail.broadcast?.timeline?.some((entry) => entry.eventType === "checkpoint")) {
  throw new Error("Broadcast detail did not expose runtime event timeline checkpoints");
}
if (!broadcastDetail.broadcast?.scoreboardReady) {
  throw new Error("Broadcast detail did not mark a scored run as scoreboard-ready");
}
const broadcastBundle = await readJson(`/api/broadcasts/${broadcastRow.stream.id}/evidence-bundle`);
if (
  broadcastBundle.bundle?.schemaVersion !== "steambench.broadcast-evidence-bundle.v1" ||
  broadcastBundle.bundle?.streamId !== broadcastRow.stream.id ||
  broadcastBundle.bundle?.runId !== run.run.id ||
  broadcastBundle.bundle?.integrity?.verdict !== "scoreboard-ready" ||
  broadcastBundle.bundle?.integrity?.executorReportCount !== 0 ||
  !broadcastBundle.bundle?.integrity?.checklist?.every((entry) => entry.status === "pass")
) {
  throw new Error("Broadcast evidence bundle did not expose proof-ready replay evidence");
}
const broadcastCertificate = await readJson(`/api/broadcasts/${broadcastRow.stream.id}/result-certificate`);
if (
  broadcastCertificate.certificate?.schemaVersion !== "steambench.result-certificate.v1" ||
  broadcastCertificate.certificate?.kind !== "broadcast" ||
  broadcastCertificate.certificate?.id !== broadcastRow.stream.id ||
  broadcastCertificate.certificate?.verdict !== "scoreboard-ready" ||
  broadcastCertificate.certificate?.evidence?.executorReportCount !== 0 ||
  broadcastCertificate.certificate?.integrity?.readyForPublicShare !== true ||
  broadcastCertificate.certificate?.links?.evidenceBundle?.endsWith(`/api/broadcasts/${broadcastRow.stream.id}/evidence-bundle`) !== true
) {
  throw new Error("Broadcast result certificate did not expose a public proof-ready replay certificate");
}
const publicBroadcastWatch = await readJson(`/api/public/broadcasts/${broadcastRow.stream.id}/watch?timelineLimit=4`);
if (
  publicBroadcastWatch.watch?.schemaVersion !== "steambench.public-broadcast-watch.v1" ||
  publicBroadcastWatch.watch?.stream?.id !== broadcastRow.stream.id ||
  publicBroadcastWatch.watch?.run?.id !== run.run.id ||
  publicBroadcastWatch.watch?.canonicalArtifactName !== "output.mp4" ||
  publicBroadcastWatch.watch?.watch?.playable !== true ||
  publicBroadcastWatch.watch?.watch?.publicShareReady !== true ||
  publicBroadcastWatch.watch?.watch?.scoreboardReady !== true ||
  publicBroadcastWatch.watch?.evidence?.checkpointCount < 1 ||
  publicBroadcastWatch.watch?.certificate?.kind !== "broadcast" ||
  publicBroadcastWatch.watch?.certificate?.fingerprint !== broadcastCertificate.certificate.verification?.fingerprint ||
  publicBroadcastWatch.watch?.certificatePayload?.verification?.fingerprint !== broadcastCertificate.certificate.verification?.fingerprint ||
  publicBroadcastWatch.watch?.verification?.endpoint !== `${baseUrl}/api/result-certificates/verify`
) {
  throw new Error("Public broadcast watch packet did not expose verifiable replay evidence");
}
const publicBroadcastWatchVerification = await readJson("/api/result-certificates/verify", {
  method: "POST",
  body: JSON.stringify({ certificate: publicBroadcastWatch.watch.certificatePayload })
});
if (publicBroadcastWatchVerification.verification?.valid !== true) {
  throw new Error("Public broadcast watch certificate payload failed verification");
}
const publicWatchCli = spawnSync(
  process.execPath,
  [
    "scripts/public-watch.mjs",
    `--api=${baseUrl}`,
    `--stream-id=${broadcastRow.stream.id}`,
    "--execute=verify-public-watch",
    "--timeline-limit=4",
    "--remote-verify=true"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (publicWatchCli.status !== 0) {
  throw new Error(`Public watch CLI failed:\n${publicWatchCli.stdout}\n${publicWatchCli.stderr}`);
}
const publicWatchCliResult = JSON.parse(publicWatchCli.stdout);
if (
  publicWatchCliResult.schemaVersion !== "steambench.public-watch-cli.v1" ||
  publicWatchCliResult.validation?.valid !== true ||
  publicWatchCliResult.summary?.streamId !== broadcastRow.stream.id ||
  publicWatchCliResult.summary?.runId !== run.run.id ||
  publicWatchCliResult.summary?.publicShareReady !== true ||
  publicWatchCliResult.summary?.scoreboardReady !== true ||
  publicWatchCliResult.summary?.proofReady !== true ||
  publicWatchCliResult.summary?.localCertificateValid !== true ||
  publicWatchCliResult.summary?.remoteCertificateValid !== true ||
  publicWatchCliResult.summary?.fingerprint !== broadcastCertificate.certificate.verification?.fingerprint
) {
  throw new Error("Public watch CLI did not validate the broadcast replay packet");
}

const agentTask = state.tasks.find((task) => task.track === "capture") ?? state.tasks[0];
const agentRun = await readJson(`/api/agents/${agent.agent.id}/runs`, {
  method: "POST",
  body: JSON.stringify({
    taskId: agentTask.id
  })
});
const runtimePackage = await readJson(`/api/runs/${agentRun.run.id}/runtime-package?agentId=${agent.agent.id}`);
if (runtimePackage.agent?.id !== agent.agent.id) {
  throw new Error("Runtime package did not resolve the requested agent profile");
}
if (runtimePackage.manifestUrl !== `/api/runs/${agentRun.run.id}/execution-manifest`) {
  throw new Error("Runtime package did not link to the execution manifest");
}
if (runtimePackage.artifactContract?.name !== "output.mp4") {
  throw new Error("Runtime package did not preserve the canonical output.mp4 artifact contract");
}
if (!runtimePackage.stage2Contract?.forbiddenStartActions?.includes("session.run_file")) {
  throw new Error("Runtime package did not expose the Stage 2 forbidden start actions");
}
if (!runtimePackage.readiness?.ready || runtimePackage.readiness.missingCapabilities.length !== 0) {
  throw new Error("Runtime package did not mark the smoke agent as ready for the selected task");
}
if (!runtimePackage.plan?.adapter?.launchUri?.startsWith("steam://run/")) {
  throw new Error("Runtime package did not expose a Steam launch URI in the game adapter");
}
if (!Array.isArray(runtimePackage.plan.adapter.readinessChecks) || runtimePackage.plan.adapter.readinessChecks.length === 0) {
  throw new Error("Runtime package did not expose game readiness checks in the adapter");
}
if (!runtimePackage.proofRequirements?.some((proof) => proof.type === (agentTask.track === "achievement" ? "steam-achievement" : "manual-review"))) {
  throw new Error("Runtime package did not expose the required primary proof type for the selected task");
}
const executionManifest = await readJson(`/api/runs/${agentRun.run.id}/execution-manifest?agentId=${agent.agent.id}`);
if (executionManifest.manifest?.schemaVersion !== "steambench.execution-manifest.v1") {
  throw new Error("Execution manifest did not expose the expected schema version");
}
if (executionManifest.manifest.artifactContract?.name !== "output.mp4") {
  throw new Error("Execution manifest did not preserve the canonical output.mp4 artifact contract");
}
if (executionManifest.manifest.artifactContract?.forbiddenAlternates?.includes("output-test.mp4") !== true) {
  throw new Error("Execution manifest did not forbid legacy output-test.mp4 artifacts");
}
if (!executionManifest.manifest.stage2Contract?.forbiddenStartActions?.includes("gcs_sync")) {
  throw new Error("Execution manifest did not forbid GCS sync inside Stage 2 start()");
}
if (executionManifest.manifest.stage2Contract?.preserveExistingOutputs !== true) {
  throw new Error("Execution manifest did not preserve existing outputs by default");
}
if (executionManifest.manifest.readiness?.ready !== true) {
  throw new Error("Execution manifest did not include a ready runtime verdict for the smoke agent");
}

const dispatch = await readJson(`/api/runs/${agentRun.run.id}/dispatch`, {
  method: "POST",
  body: JSON.stringify({
    provider: "local",
    agentId: agent.agent.id,
    workerId: "smoke-dispatch-worker"
  })
});
if (
  dispatch.dispatch?.runId !== agentRun.run.id ||
  dispatch.dispatch?.provider !== "local" ||
  dispatch.dispatch?.workerId !== "smoke-dispatch-worker" ||
  !dispatch.dispatch?.command?.includes(`--run='${agentRun.run.id}'`) ||
  !dispatch.dispatch?.command?.includes(`--agent='${agent.agent.id}'`)
) {
  throw new Error("Runtime dispatch did not create a local worker command for the queued run");
}
if (dispatch.dispatch.manifestUrl !== `/api/runs/${agentRun.run.id}/execution-manifest?agentId=${agent.agent.id}`) {
  throw new Error("Runtime dispatch did not link the requested execution manifest");
}
const dispatchList = await readJson("/api/dispatches");
if (!dispatchList.dispatches?.some((entry) => entry.dispatch.id === dispatch.dispatch.id && entry.run?.id === agentRun.run.id)) {
  throw new Error("Runtime dispatch list did not include the planned dispatch");
}
const launchedDispatch = await readJson(`/api/dispatches/${dispatch.dispatch.id}/status`, {
  method: "POST",
  body: JSON.stringify({
    status: "launched",
    summary: "Smoke scheduler launched dispatch command"
  })
});
if (launchedDispatch.dispatch?.status !== "launched" || !launchedDispatch.dispatch?.launchedAt) {
  throw new Error("Runtime dispatch status update did not mark the ticket launched");
}
const modalDispatch = await readJson(`/api/runs/${agentRun.run.id}/dispatch`, {
  method: "POST",
  body: JSON.stringify({
    provider: "modal",
    agentId: agent.agent.id,
    workerId: "smoke-modal-worker"
  })
});
if (
  modalDispatch.dispatch?.provider !== "modal" ||
  modalDispatch.dispatch?.workerId !== "smoke-modal-worker" ||
  !modalDispatch.dispatch?.command?.includes("modal run modal/steambench_runtime.py")
) {
  throw new Error("Runtime dispatch did not create a Modal worker command");
}
const modalPackage = await readJson(`/api/dispatches/${modalDispatch.dispatch.id}/modal-package`);
if (
  modalPackage.modalPackage?.schemaVersion !== "steambench.modal-runtime-package.v1" ||
  modalPackage.modalPackage?.entrypoint?.file !== "modal/steambench_runtime.py" ||
  modalPackage.modalPackage?.runtime?.targetArtifactName !== "output.mp4" ||
  !modalPackage.modalPackage?.runtime?.stage2StartPolicy?.forbiddenStartActions?.includes("session.run_file") ||
  modalPackage.modalPackage?.modal?.volumes?.[0]?.name !== "steambench-steam-state"
) {
  throw new Error("Modal runtime package did not expose the expected worker handoff contract");
}

const firstClaim = await readJson(`/api/runs/${agentRun.run.id}/claim`, {
  method: "POST",
  body: JSON.stringify({
    workerId: "smoke-expiring-worker",
    leaseMinutes: -1
  })
});
if (firstClaim.run.status !== "preparing" || firstClaim.run.workerId !== "smoke-expiring-worker") {
  throw new Error("Worker claim did not lease the queued run");
}
const queueBeforeRecovery = await readJson("/api/worker/queue");
if (!queueBeforeRecovery.queue?.expired?.some((queuedRun) => queuedRun.id === agentRun.run.id)) {
  throw new Error("Worker queue did not expose the expired leased run");
}
const recoveredLeases = await readJson("/api/worker/requeue-expired", {
  method: "POST",
  body: JSON.stringify({
    reason: "smoke recovered expired lease"
  })
});
if (!recoveredLeases.requeued?.some((queuedRun) => queuedRun.id === agentRun.run.id)) {
  throw new Error("Expired worker lease was not requeued");
}
const secondClaim = await readJson(`/api/runs/${agentRun.run.id}/claim`, {
  method: "POST",
  body: JSON.stringify({
    workerId: "smoke-reclaimed-worker",
    leaseMinutes: 5
  })
});
if (secondClaim.run.workerId !== "smoke-reclaimed-worker") {
  throw new Error("Recovered queued run could not be claimed by a new worker");
}

const nonAchievementTask = state.tasks.find((task) => task.track === "leaderboard" || task.track === "stat" || task.track === "capture");
if (!nonAchievementTask) {
  throw new Error("Expected at least one non-achievement benchmark task");
}
const nonAchievementRun = await readJson("/api/runs", {
  method: "POST",
  body: JSON.stringify({
    taskId: nonAchievementTask.id,
    competitor: "smoke-non-achievement-agent",
    competitorType: "agent"
  })
});
const nonAchievementSimulated = await readJson(`/api/runs/${nonAchievementRun.run.id}/simulate-agent`, {
  method: "POST",
  body: JSON.stringify({})
});
if (!nonAchievementSimulated.evaluation?.passed || nonAchievementSimulated.run.status !== "scored") {
  throw new Error("Non-achievement benchmark task did not score through manual-review proof");
}
if (nonAchievementSimulated.run.scoreMetadata?.scoringMode !== "metric") {
  throw new Error("Non-achievement benchmark task did not compute a metric-aware score");
}
const nonAchievementDetail = await readJson(`/api/runs/${nonAchievementRun.run.id}`);
if (!nonAchievementDetail.proofs.some((proof) => proof.type === "manual-review" && proof.status === "verified")) {
  throw new Error("Non-achievement run did not persist verified manual-review proof");
}
const leaderboardList = await readJson("/api/leaderboards");
const nonAchievementLeaderboard = leaderboardList.leaderboards?.find((entry) => entry.taskId === nonAchievementTask.id);
if (!nonAchievementLeaderboard?.entries?.some((entry) => entry.runId === nonAchievementRun.run.id && entry.metricValue !== undefined)) {
  throw new Error("Task leaderboard did not include the metric-aware non-achievement run");
}
const singleLeaderboard = await readJson(`/api/tasks/${encodeURIComponent(nonAchievementTask.id)}/leaderboard`);
if (singleLeaderboard.leaderboard?.taskId !== nonAchievementTask.id || singleLeaderboard.leaderboard.entries.length === 0) {
  throw new Error("Single task leaderboard did not return entries for the scored task");
}
const taskReview = await readJson(`/api/tasks/${encodeURIComponent(nonAchievementTask.id)}/review`);
if (taskReview.review?.taskId !== nonAchievementTask.id || !Array.isArray(taskReview.review.controls)) {
  throw new Error("Task review endpoint did not return review controls for the selected task");
}
const pendingReviewRun = await readJson("/api/runs", {
  method: "POST",
  body: JSON.stringify({
    taskId: nonAchievementTask.id,
    competitor: "smoke-proof-review-agent",
    competitorType: "agent"
  })
});
const pendingProof = await readJson(`/api/runs/${pendingReviewRun.run.id}/proofs`, {
  method: "POST",
  body: JSON.stringify({
    type: "manual-review",
    summary: "Smoke pending manual review proof.",
    metadata: {
      metricName: nonAchievementTask.metricName,
      metricValue: 123
    }
  })
});
const proofReviewQueue = await readJson("/api/proofs/review");
if (!proofReviewQueue.proofs?.some((entry) => entry.proof.id === pendingProof.proof.id && entry.run.id === pendingReviewRun.run.id)) {
  throw new Error("Proof review queue did not include the pending proof");
}
const auditedProof = await readJson(`/api/proofs/${pendingProof.proof.id}/status`, {
  method: "POST",
  body: JSON.stringify({
    status: "verified",
    reviewer: "smoke-reviewer",
    reviewNotes: "Smoke reviewer accepted this proof."
  })
});
if (auditedProof.proof.status !== "verified" || auditedProof.proof.reviewer !== "smoke-reviewer" || auditedProof.event?.type !== "proof") {
  throw new Error("Proof audit endpoint did not persist reviewer metadata and event evidence");
}
await readJson(`/api/runs/${nonAchievementRun.run.id}/evaluate`, {
  method: "POST"
});
const repeatedSingleLeaderboard = await readJson(`/api/tasks/${encodeURIComponent(nonAchievementTask.id)}/leaderboard`);
const repeatedEntries = repeatedSingleLeaderboard.leaderboard.entries.filter((entry) => entry.runId === nonAchievementRun.run.id);
if (repeatedEntries.length !== 1) {
  throw new Error("Repeated evaluation duplicated a task leaderboard entry");
}

const standings = await readJson("/api/standings");
if (!standings.standings?.competitors?.some((entry) => entry.competitor === humanRun.run.competitor)) {
  throw new Error("Standings did not include the scored human submission");
}
const seasons = await readJson("/api/seasons");
if (!seasons.seasons?.some((season) => season.window.scope === "daily" && season.window.rowCount > 0)) {
  throw new Error("Season endpoint did not expose a daily scored window");
}
const dailyStandings = await readJson("/api/standings?season=daily");
if (
  dailyStandings.season?.scope !== "daily" ||
  dailyStandings.standings.totals.humanRuns + dailyStandings.standings.totals.agentRuns === 0
) {
  throw new Error("Daily standings did not return scoped scored runs");
}
const weeklyLeaderboards = await readJson("/api/leaderboards?season=weekly");
if (weeklyLeaderboards.season?.scope !== "weekly" || !Array.isArray(weeklyLeaderboards.leaderboards)) {
  throw new Error("Weekly leaderboards did not return season metadata and leaderboard rows");
}
const dailyTaskLeaderboard = await readJson(`/api/tasks/${encodeURIComponent(nonAchievementTask.id)}/leaderboard?season=daily`);
if (dailyTaskLeaderboard.season?.scope !== "daily") {
  throw new Error("Scoped task leaderboard did not return daily season metadata");
}

const platformAdvanceCli = spawnSync(
  process.execPath,
  [
    "scripts/platform-ops.mjs",
    `--api=${baseUrl}`,
    "--scope=weekly",
    "--limit=20",
    "--execute=advance-platform-actions",
    "--max-steps=1"
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8"
  }
);
if (platformAdvanceCli.status !== 0) {
  throw new Error(`Platform ops advance CLI failed:\n${platformAdvanceCli.stdout}\n${platformAdvanceCli.stderr}`);
}
const platformAdvanceCliResult = JSON.parse(platformAdvanceCli.stdout);
if (
  platformAdvanceCliResult.schemaVersion !== "steambench.platform-ops-cli.v1" ||
  !Array.isArray(platformAdvanceCliResult.executedActions) ||
  platformAdvanceCliResult.summary?.executedActionCount !== platformAdvanceCliResult.executedActions.length ||
  platformAdvanceCliResult.summary?.executedActionIds?.length !== platformAdvanceCliResult.executedActions.length
) {
  throw new Error("Platform ops advance CLI did not return a bounded action audit summary");
}

console.log("steambench api smoke passed");
