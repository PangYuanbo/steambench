import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();

const statusOrder = {
  "review-required": 0,
  "import-ready": 1,
  "needs-steam-data": 2,
  "ranked-ready": 3
};

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function boolArg(name, fallback = false) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function configFromArgs() {
  const status = args.get("status") ?? "all";
  if (!["all", "ranked-ready", "import-ready", "review-required", "needs-steam-data"].includes(status)) {
    throw new Error("Provide --status=all|ranked-ready|import-ready|review-required|needs-steam-data.");
  }
  const appidValue = args.get("appid");
  const appid = appidValue === undefined ? undefined : Number(appidValue);
  if (appidValue !== undefined && !Number.isFinite(appid)) {
    throw new Error("Provide --appid=<steam_appid>.");
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    appid,
    status,
    limit: intArg("limit", 12, { min: 1, max: 50 }),
    includeSourcePlan: args.get("include-source-plan") === "true" || args.get("includeSourcePlan") === "true" || args.get("fixture") === "true",
    useFixture: args.get("fixture") === "true" || args.get("useFixture") === "true",
    refresh: boolArg("refresh", false),
    execute: args.get("execute") ?? "",
    maxSteps: intArg("max-steps", 3, { min: 1, max: 10 }),
    reviewApproved: boolArg("review-approved", false),
    forceReviewOverride: boolArg("force-review-override", false),
    reviewNotes: args.get("review-notes")
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

function actionRequest(action, config) {
  if (!action) throw new Error("Missing source action to execute.");
  const body = {
    ...(action.body ?? {}),
    useFixture: config.useFixture,
    refresh: config.refresh,
    limit: config.limit,
    reviewNotes: config.reviewNotes ?? `Benchmark blueprint source action ${action.id}.`
  };
  if (action.id === "publish-candidates") {
    body.reviewApproved = config.reviewApproved;
    body.forceReviewOverride = config.forceReviewOverride;
  }
  return {
    method: action.method,
    body: JSON.stringify(body)
  };
}

function selectSourceAction(blueprint, execute) {
  if (!execute) return undefined;
  if (execute === "next") return blueprint?.sourceActions?.[0];
  return blueprint?.sourceActions?.find((entry) => entry.id === execute);
}

async function executeSourceAction(config, action) {
  return {
    action,
    result: await readJson(config.baseUrl, action?.endpoint, actionRequest(action, config))
  };
}

async function advanceSourceActions(config) {
  const executedActions = [];
  let refreshedBlueprints = [];

  for (let step = 0; step < config.maxSteps; step += 1) {
    const blueprints = await loadBlueprints(config);
    const action = blueprints[0]?.sourceActions?.[0];
    if (!action) {
      refreshedBlueprints = blueprints;
      break;
    }
    executedActions.push(await executeSourceAction(config, action));
  }

  if (refreshedBlueprints.length === 0) {
    refreshedBlueprints = await loadBlueprints(config);
  }

  return { executedActions, refreshedBlueprints };
}

function sumExecutedImportCount(executedActions) {
  return executedActions.reduce((total, entry) => {
    const imported = entry.result?.importRun?.imported ?? entry.result?.importRun?.totals?.imported ?? 0;
    return total + Number(imported ?? 0);
  }, 0);
}

function sumExecutedPublicationCount(executedActions, key) {
  return executedActions.reduce((total, entry) => {
    const count = entry.result?.publication?.[key]?.length ?? 0;
    return total + count;
  }, 0);
}

function blueprintRank(blueprint) {
  return (statusOrder[blueprint.status] ?? 99) * 1_000_000
    - Number(blueprint.readinessScore ?? 0) * 1_000
    - Number(blueprint.sourcePlan?.newImportsAvailable ?? blueprint.importPlan?.availableAchievementTasks ?? 0) * 20
    - Number(blueprint.sourcePlan?.sourceRecords ?? blueprint.importPlan?.availableAchievementTasks ?? 0)
    + Number(blueprint.appid ?? 0) / 1_000_000;
}

function summarizeBlueprint(blueprint) {
  const ladderGaps = blueprint.taskLadder?.reduce((total, band) => total + (band.gaps?.length ?? 0), 0) ?? 0;
  return {
    appid: blueprint.appid,
    game: blueprint.game?.name,
    status: blueprint.status,
    readinessScore: blueprint.readinessScore,
    canImportNow: Boolean(blueprint.sourcePlan?.newImportsAvailable > 0 || blueprint.importPlan?.canImportNow),
    availableAchievementTasks: blueprint.importPlan?.availableAchievementTasks ?? 0,
    importedAchievementTasks: blueprint.importPlan?.importedAchievementTasks ?? 0,
    sourceRecords: blueprint.sourcePlan?.sourceRecords ?? blueprint.importPlan?.availableAchievementTasks ?? 0,
    newSourceImportsAvailable: blueprint.sourcePlan?.newImportsAvailable ?? (blueprint.importPlan?.canImportNow ? blueprint.importPlan?.availableAchievementTasks ?? 0 : 0),
    sourceActiveTracks: blueprint.sourcePlan?.activeTracks ?? [],
    sourceCandidateTracks: blueprint.sourcePlan?.candidateTracks ?? [],
    sourceMissingCandidateTracks: blueprint.sourcePlan?.missingCandidateTracks ?? [],
    achievementSourceRecords: blueprint.sourcePlan?.achievement?.records ?? blueprint.importPlan?.availableAchievementTasks ?? 0,
    achievementNewImports: blueprint.sourcePlan?.achievement?.newImports ?? 0,
    statSourceRecords: blueprint.sourcePlan?.stat?.records ?? 0,
    statProposals: blueprint.sourcePlan?.stat?.proposed ?? 0,
    statNewProposals: blueprint.sourcePlan?.stat?.newProposals ?? 0,
    leaderboardSourceRecords: blueprint.sourcePlan?.leaderboard?.records ?? 0,
    leaderboardProposals: blueprint.sourcePlan?.leaderboard?.proposed ?? 0,
    leaderboardNewProposals: blueprint.sourcePlan?.leaderboard?.newProposals ?? 0,
    sourceActionIds: blueprint.sourceActions?.map((action) => action.id) ?? [],
    sourceActionCount: blueprint.sourceActions?.length ?? 0,
    rankedReadyTasks: blueprint.reviewPlan?.rankedReadyTasks ?? 0,
    reviewRequiredTasks: blueprint.reviewPlan?.reviewRequiredTasks ?? 0,
    rejectedTasks: blueprint.reviewPlan?.rejectedTasks ?? 0,
    suiteIds: blueprint.competitionPlan?.suiteIds ?? [],
    humanAgentRaceReady: Boolean(blueprint.competitionPlan?.humanAgentRaceReady),
    ladderGaps,
    importEndpoint: blueprint.importPlan?.endpoint,
    blueprintEndpoint: `/api/games/${blueprint.appid}/benchmark-blueprint`,
    targetArtifactName: blueprint.runtimePlan?.targetArtifactName,
    stage2StartConstraints: blueprint.runtimePlan?.stage2StartConstraints ?? [],
    nextActions: blueprint.nextActions ?? []
  };
}

function filterBlueprints(blueprints, config) {
  return blueprints
    .filter((blueprint) => config.status === "all" || blueprint.status === config.status)
    .sort((a, b) => blueprintRank(a) - blueprintRank(b))
    .slice(0, config.limit);
}

async function loadBlueprints(config) {
  if (config.appid !== undefined) {
    const query = new URLSearchParams();
    if (config.includeSourcePlan) query.set("includeSourcePlan", "true");
    if (config.useFixture) query.set("useFixture", "true");
    if (config.refresh) query.set("refresh", "true");
    query.set("limit", String(config.limit));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const payload = await readJson(config.baseUrl, `/api/games/${encodeURIComponent(config.appid)}/benchmark-blueprint${suffix}`);
    return [payload.blueprint].filter(Boolean);
  }
  const payload = await readJson(config.baseUrl, "/api/state");
  return Array.isArray(payload.benchmarkBlueprints) ? payload.benchmarkBlueprints : [];
}

async function runBenchmarkBlueprintOps(config = configFromArgs()) {
  if (config.execute && config.appid === undefined) {
    throw new Error("Provide --appid=<steam_appid> when using --execute=<source_action_id>.");
  }
  const focusedConfig = config.execute ? { ...config, includeSourcePlan: true } : config;
  let blueprints = [];
  let refreshedBlueprints = [];
  let executedActions = [];

  if (config.execute === "advance-source-actions") {
    ({ executedActions, refreshedBlueprints } = await advanceSourceActions(focusedConfig));
  } else {
    blueprints = await loadBlueprints(focusedConfig);
    const action = selectSourceAction(blueprints[0], config.execute);
    executedActions = config.execute ? [await executeSourceAction(focusedConfig, action)] : [];
    refreshedBlueprints = executedActions.length > 0 ? await loadBlueprints(focusedConfig) : blueprints;
  }

  const executedAction = executedActions[0];
  const selected = filterBlueprints(refreshedBlueprints, focusedConfig);
  const items = selected.map(summarizeBlueprint);
  const counts = items.reduce((totals, item) => {
    totals[item.status] = (totals[item.status] ?? 0) + 1;
    if (item.canImportNow) totals.canImportNow += 1;
    totals.sourceRecords += item.sourceRecords;
    totals.newSourceImportsAvailable += item.newSourceImportsAvailable;
    totals.achievementSourceRecords += item.achievementSourceRecords;
    totals.achievementNewImports += item.achievementNewImports;
    totals.statSourceRecords += item.statSourceRecords;
    totals.statProposals += item.statProposals;
    totals.statNewProposals += item.statNewProposals;
    totals.leaderboardSourceRecords += item.leaderboardSourceRecords;
    totals.leaderboardProposals += item.leaderboardProposals;
    totals.leaderboardNewProposals += item.leaderboardNewProposals;
    totals.sourceActions += item.sourceActionCount;
    totals.reviewRequiredTasks += item.reviewRequiredTasks;
    totals.rankedReadyTasks += item.rankedReadyTasks;
    totals.ladderGaps += item.ladderGaps;
    if (item.targetArtifactName === "output.mp4") totals.outputMp4Contracts += 1;
    if (item.stage2StartConstraints.some((entry) => entry.includes("Do not call session.run_file"))) {
      totals.stage2StartContracts += 1;
    }
    return totals;
  }, {
    "ranked-ready": 0,
    "import-ready": 0,
    "review-required": 0,
    "needs-steam-data": 0,
    canImportNow: 0,
    sourceRecords: 0,
    newSourceImportsAvailable: 0,
    achievementSourceRecords: 0,
    achievementNewImports: 0,
    statSourceRecords: 0,
    statProposals: 0,
    statNewProposals: 0,
    leaderboardSourceRecords: 0,
    leaderboardProposals: 0,
    leaderboardNewProposals: 0,
    sourceActions: 0,
    reviewRequiredTasks: 0,
    rankedReadyTasks: 0,
    ladderGaps: 0,
    outputMp4Contracts: 0,
    stage2StartContracts: 0
  });
  return {
    schemaVersion: "steambench.benchmark-blueprint-ops-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    filters: {
      appid: config.appid,
      status: config.status,
      limit: config.limit,
      includeSourcePlan: focusedConfig.includeSourcePlan,
      useFixture: focusedConfig.useFixture,
      execute: config.execute,
      maxSteps: config.maxSteps
    },
    blueprints: selected,
    executedAction,
    executedActions,
    items,
    summary: {
      blueprints: items.length,
      rankedReady: counts["ranked-ready"],
      importReady: counts["import-ready"],
      reviewRequired: counts["review-required"],
      needsSteamData: counts["needs-steam-data"],
      canImportNow: counts.canImportNow,
      sourceRecords: counts.sourceRecords,
      newSourceImportsAvailable: counts.newSourceImportsAvailable,
      achievementSourceRecords: counts.achievementSourceRecords,
      achievementNewImports: counts.achievementNewImports,
      statSourceRecords: counts.statSourceRecords,
      statProposals: counts.statProposals,
      statNewProposals: counts.statNewProposals,
      leaderboardSourceRecords: counts.leaderboardSourceRecords,
      leaderboardProposals: counts.leaderboardProposals,
      leaderboardNewProposals: counts.leaderboardNewProposals,
      sourceActions: counts.sourceActions,
      reviewRequiredTasks: counts.reviewRequiredTasks,
      rankedReadyTasks: counts.rankedReadyTasks,
      ladderGaps: counts.ladderGaps,
      outputMp4Contracts: counts.outputMp4Contracts,
      stage2StartContracts: counts.stage2StartContracts,
      topAppid: items[0]?.appid,
      topGame: items[0]?.game,
      topStatus: items[0]?.status,
      topReadinessScore: items[0]?.readinessScore,
      topImportEndpoint: items[0]?.importEndpoint,
      topSourceRecords: items[0]?.sourceRecords,
      topNewSourceImportsAvailable: items[0]?.newSourceImportsAvailable,
      topSourceMissingCandidateTracks: items[0]?.sourceMissingCandidateTracks,
      topSourceActionIds: items[0]?.sourceActionIds,
      executedActionId: executedAction?.action?.id,
      executedActionIds: executedActions.map((entry) => entry.action?.id).filter(Boolean),
      executedSteps: executedActions.length,
      imported: executedActions.length > 0 ? sumExecutedImportCount(executedActions) : undefined,
      published: executedActions.length > 0 ? sumExecutedPublicationCount(executedActions, "published") : undefined,
      blocked: executedActions.length > 0 ? sumExecutedPublicationCount(executedActions, "blocked") : undefined,
      actions: [
        ...items.flatMap((item) => item.sourceActionIds.map((action) => `${item.appid}:${action}`)),
        ...items.flatMap((item) => item.nextActions.slice(0, 2).map((action) => `${item.appid}:${action}`))
      ]
    }
  };
}

export { runBenchmarkBlueprintOps };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBenchmarkBlueprintOps()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
