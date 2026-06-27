import { achievementFixtures } from "../benchmark/catalog";
import { buildBenchmarkSuites, type BenchmarkSuite } from "../benchmark/suites";
import { buildTaskReview, buildTaskReviews, type TaskReview } from "../benchmark/task-review";
import type { BenchmarkTask, BenchmarkTrack, GameCatalogEntry } from "../benchmark/types";
import { adapterForGame, type RuntimeGameAdapter } from "../runtime/game-adapters";
import type { SteamAppDiscoveryCandidate, TaskRegistryEntry } from "./store";
import type { SteamTaskSourceOpsReport } from "./steam-task-source-ops";

export type BenchmarkBlueprintStatus = "ranked-ready" | "import-ready" | "review-required" | "needs-steam-data";

export type BenchmarkBlueprintLevelBand = {
  id: "starter" | "ranked" | "expert";
  label: string;
  levelRange: {
    min: number;
    max: number;
  };
  taskCount: number;
  activeTasks: number;
  candidateTasks: number;
  rankedReadyTasks: number;
  reviewRequiredTasks: number;
  recommendedTaskIds: string[];
  gaps: string[];
};

export type BenchmarkBlueprintSourcePlan = {
  sourceRecords: number;
  newImportsAvailable: number;
  activeTracks: BenchmarkTrack[];
  candidateTracks: BenchmarkTrack[];
  missingCandidateTracks: BenchmarkTrack[];
  achievement: {
    source: "fixture" | "steam-live" | "none";
    records: number;
    imported: number;
    newImports: number;
    canImportNow: boolean;
    endpoint: string;
    importEndpoint: string;
    warning?: string;
  };
  stat: {
    source: "fixture" | "steam-live" | "none";
    records: number;
    proposed: number;
    newProposals: number;
    reviewRequired: number;
    canImportNow: boolean;
    endpoint: string;
    importEndpoint: string;
    warning?: string;
  };
  leaderboard: {
    source: "fixture" | "steam-live" | "none";
    records: number;
    proposed: number;
    newProposals: number;
    reviewRequired: number;
    canImportNow: boolean;
    endpoint: string;
    importEndpoint: string;
    warning?: string;
  };
};

export type BenchmarkBlueprintSourceAction = {
  id:
    | "import-achievement-recommendations"
    | "import-stat-proposals"
    | "import-leaderboard-proposals"
    | "publish-candidates";
  label: string;
  priority: "high" | "medium" | "low";
  method: "POST";
  endpoint: string;
  body?: Record<string, unknown>;
  reason: string;
};

export type BenchmarkBlueprint = {
  schemaVersion: "steambench.benchmark-blueprint.v1";
  generatedAt: string;
  appid: number;
  game: GameCatalogEntry;
  discovery?: SteamAppDiscoveryCandidate;
  status: BenchmarkBlueprintStatus;
  readinessScore: number;
  reasons: string[];
  nextActions: string[];
  importPlan: {
    endpoint: string;
    source: "fixture" | "steam-live" | "none";
    availableAchievementTasks: number;
    importedAchievementTasks: number;
    recommendedImportLimit: number;
    canImportNow: boolean;
  };
  sourcePlan: BenchmarkBlueprintSourcePlan;
  sourceActions: BenchmarkBlueprintSourceAction[];
  taskLadder: BenchmarkBlueprintLevelBand[];
  suites: BenchmarkSuite[];
  runtimePlan: {
    adapter: RuntimeGameAdapter;
    targetArtifactName: "output.mp4";
    stage2StartConstraints: string[];
    proofRequirements: string[];
    readinessChecks: string[];
    agentLoopHints: string[];
    evidenceHints: string[];
  };
  reviewPlan: {
    rankedReadyTasks: number;
    reviewRequiredTasks: number;
    rejectedTasks: number;
    controls: string[];
    risks: string[];
  };
  competitionPlan: {
    humanAgentRaceReady: boolean;
    suiteIds: string[];
    publicEndpoints: string[];
    proofGates: string[];
  };
};

const bands: Array<Omit<BenchmarkBlueprintLevelBand, "taskCount" | "activeTasks" | "candidateTasks" | "rankedReadyTasks" | "reviewRequiredTasks" | "recommendedTaskIds" | "gaps">> = [
  {
    id: "starter",
    label: "Starter ladder",
    levelRange: { min: 1, max: 3 }
  },
  {
    id: "ranked",
    label: "Ranked ladder",
    levelRange: { min: 4, max: 6 }
  },
  {
    id: "expert",
    label: "Expert ladder",
    levelRange: { min: 7, max: 10 }
  }
];

const uniqueSorted = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));

function tracksFor(tasks: BenchmarkTask[]): BenchmarkTrack[] {
  return uniqueSorted(tasks.map((task) => task.track)) as BenchmarkTrack[];
}

function trackUnion(...trackGroups: BenchmarkTrack[][]): BenchmarkTrack[] {
  return uniqueSorted(trackGroups.flat()) as BenchmarkTrack[];
}

function statusFor(input: {
  activeTasks: number;
  candidateTasks: number;
  rankedReadyTasks: number;
  reviewRequiredTasks: number;
  availableAchievementTasks: number;
  newSourceImportsAvailable: number;
}): BenchmarkBlueprintStatus {
  if (input.rankedReadyTasks >= 3 && input.activeTasks >= 3) return "ranked-ready";
  if (input.candidateTasks > 0 || input.reviewRequiredTasks > 0) return "review-required";
  if (input.newSourceImportsAvailable > 0 || input.availableAchievementTasks > 0) return "import-ready";
  return "needs-steam-data";
}

function readinessScoreFor(input: {
  game: GameCatalogEntry;
  activeTasks: number;
  candidateTasks: number;
  rankedReadyTasks: number;
  reviewRequiredTasks: number;
  availableAchievementTasks: number;
  statRecords: number;
  leaderboardRecords: number;
  suiteCount: number;
}): number {
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        input.game.benchmarkFit * 0.35 +
          Math.min(input.activeTasks, 8) * 4 +
          Math.min(input.rankedReadyTasks, 8) * 4 +
          Math.min(input.candidateTasks, 6) * 2 +
          Math.min(input.availableAchievementTasks, 8) * 1.5 +
          Math.min(input.statRecords, 8) +
          Math.min(input.leaderboardRecords, 8) +
          Math.min(input.suiteCount, 3) * 5 -
          Math.min(input.reviewRequiredTasks, 8) * 2
      )
    )
  );
}

function buildTaskLadder(input: {
  tasks: BenchmarkTask[];
  registryById: Map<string, TaskRegistryEntry>;
  reviewsByTask: Map<string, TaskReview>;
}): BenchmarkBlueprintLevelBand[] {
  return bands.map((band) => {
    const bandTasks = input.tasks.filter((task) => task.level >= band.levelRange.min && task.level <= band.levelRange.max);
    const rankedReady = bandTasks.filter((task) => input.reviewsByTask.get(task.id)?.decision === "ranked-ready");
    const candidateTasks = bandTasks.filter((task) => input.registryById.get(task.id)?.status === "candidate");
    const reviewRequired = bandTasks.filter((task) => input.reviewsByTask.get(task.id)?.decision === "review-required");
    const gaps = [];
    if (bandTasks.length === 0) gaps.push("No tasks in this level band yet.");
    if (rankedReady.length === 0) gaps.push("No ranked-ready task in this level band.");
    if (!tracksFor(bandTasks).includes("achievement")) gaps.push("No achievement task coverage.");
    if (band.id !== "starter" && bandTasks.every((task) => task.estimatedRuntimeMinutes > 120)) {
      gaps.push("Needs a bounded short-run task for repeatable agent attempts.");
    }

    return {
      ...band,
      taskCount: bandTasks.length,
      activeTasks: bandTasks.filter((task) => !input.registryById.has(task.id) || input.registryById.get(task.id)?.status === "active").length,
      candidateTasks: candidateTasks.length,
      rankedReadyTasks: rankedReady.length,
      reviewRequiredTasks: reviewRequired.length,
      recommendedTaskIds: bandTasks
        .slice()
        .sort((a, b) => {
          const reviewDelta = (input.reviewsByTask.get(b.id)?.score ?? 0) - (input.reviewsByTask.get(a.id)?.score ?? 0);
          return reviewDelta || b.score - a.score || a.id.localeCompare(b.id);
        })
        .slice(0, 3)
        .map((task) => task.id),
      gaps
    };
  });
}

function reasonsFor(input: {
  status: BenchmarkBlueprintStatus;
  game: GameCatalogEntry;
  activeTasks: number;
  candidateTasks: number;
  availableAchievementTasks: number;
  sourcePlan: BenchmarkBlueprintSourcePlan;
  tracks: BenchmarkTrack[];
}): string[] {
  const reasons = [
    `${input.game.name} has benchmark fit ${input.game.benchmarkFit}/100 with ${input.game.harnessRisk} harness risk.`,
    `${input.activeTasks} active task(s), ${input.candidateTasks} imported candidate task(s), and ${input.sourcePlan.sourceRecords} Steam source record(s) are available across achievement, stat, and leaderboard inputs.`,
    `Current task coverage spans ${input.tracks.length > 0 ? input.tracks.join(", ") : "no"} track(s).`
  ];
  if (input.status === "ranked-ready") reasons.push("The game has enough ranked-ready active tasks for immediate human-agent competition.");
  if (input.status === "import-ready") reasons.push("Steam source metadata exists but needs to be imported into the reviewable task registry.");
  if (input.status === "review-required") reasons.push("Imported or controlled tasks need review before public ranking.");
  if (input.status === "needs-steam-data") reasons.push("No local achievement source exists yet; live Steam metadata or manual seeds are needed.");
  return reasons;
}

function nextActionsFor(input: {
  status: BenchmarkBlueprintStatus;
  appid: number;
  activeTasks: number;
  candidateTasks: number;
  rankedReadyTasks: number;
  availableAchievementTasks: number;
  sourcePlan: BenchmarkBlueprintSourcePlan;
  discovery?: SteamAppDiscoveryCandidate;
}): string[] {
  if (input.status === "ranked-ready") {
    return [
      "Schedule a ranked suite race for one linked human and one active runtime agent.",
      "Run the suite locally or dispatch it through Modal, then publish the result certificate.",
      "Add stat or capture tasks only when their proof contract is bounded and reviewable."
    ];
  }
  if (input.status === "review-required") {
    return [
      "Review candidate tasks for fairness controls, time caps, and proof requirements.",
      "Publish ranked-ready candidates through the task status endpoint.",
      "Reject tasks that require multiplayer, seasonal availability, or automation-sensitive modes."
    ];
  }
  if (input.status === "import-ready") {
    return [
      input.sourcePlan.newImportsAvailable > 0
        ? "Inspect the source plan and import recommended achievement, stat, or leaderboard candidates."
        : "Inspect the source plan before importing benchmark candidates.",
      input.discovery
        ? `Import achievements through /api/steam/apps/discovery/${input.discovery.id}/import-achievements.`
        : `Import achievements through /api/steam/apps/${input.appid}/import-achievements.`,
      "Keep imported tasks as candidates until the review catalog marks them ranked-ready.",
      "Add a short capture or stat seed if the achievement ladder lacks repeatable low-level attempts."
    ];
  }
  return [
    "Fetch live Steam achievement metadata or add a fixture before creating benchmark tasks.",
    "Create a discovery candidate so fit, harness risk, and import source are reviewable.",
    "Draft manual stat/capture seeds only when the game exposes a reliable score screen or replay."
  ];
}

function buildSourcePlan(input: {
  appid: number;
  importPlan: BenchmarkBlueprint["importPlan"];
  importedAchievementTasks: number;
  allTasks: BenchmarkTask[];
  registryTasks: TaskRegistryEntry[];
  taskSourceOps?: SteamTaskSourceOpsReport;
}): BenchmarkBlueprintSourcePlan {
  const activeTracks = input.taskSourceOps?.registry.activeTracks ?? tracksFor(input.allTasks);
  const candidateTracks = input.taskSourceOps?.registry.candidateTracks ?? tracksFor(input.registryTasks.filter((task) => task.status === "candidate"));
  const achievementNewImports = input.taskSourceOps?.sources.achievement.recommendedImports
    ?? Math.max(0, input.importPlan.availableAchievementTasks - input.importedAchievementTasks);
  const statNewProposals = input.taskSourceOps?.sources.stat.newProposals ?? 0;
  const leaderboardNewProposals = input.taskSourceOps?.sources.leaderboard.newProposals ?? 0;
  const sourceTracks = trackUnion(
    achievementNewImports > 0 ? ["achievement"] : [],
    statNewProposals > 0 ? ["stat"] : [],
    leaderboardNewProposals > 0 ? ["leaderboard"] : []
  );
  const missingCandidateTracks = input.taskSourceOps?.registry.missingCandidateTracks
    ?? sourceTracks.filter((track) => !activeTracks.includes(track) && !candidateTracks.includes(track));

  return {
    sourceRecords: input.taskSourceOps?.totals.sourceRecords ?? input.importPlan.availableAchievementTasks,
    newImportsAvailable: input.taskSourceOps?.totals.newImportsAvailable ?? achievementNewImports,
    activeTracks,
    candidateTracks,
    missingCandidateTracks,
    achievement: {
      source: input.taskSourceOps?.sources.achievement.source ?? input.importPlan.source,
      records: input.taskSourceOps?.sources.achievement.achievements ?? input.importPlan.availableAchievementTasks,
      imported: input.importedAchievementTasks,
      newImports: achievementNewImports,
      canImportNow: achievementNewImports > 0,
      endpoint: `/api/steam/apps/${input.appid}/achievement-ladder`,
      importEndpoint: `/api/steam/apps/${input.appid}/achievement-ladder/import-recommended`,
      warning: input.taskSourceOps?.sources.achievement.warning
    },
    stat: {
      source: input.taskSourceOps?.sources.stat.source ?? "none",
      records: input.taskSourceOps?.sources.stat.stats ?? 0,
      proposed: input.taskSourceOps?.sources.stat.proposed ?? 0,
      newProposals: statNewProposals,
      reviewRequired: input.taskSourceOps?.sources.stat.reviewRequired ?? 0,
      canImportNow: statNewProposals > 0,
      endpoint: `/api/steam/apps/${input.appid}/stat-proposals`,
      importEndpoint: `/api/steam/apps/${input.appid}/stat-proposals/import-recommended`,
      warning: input.taskSourceOps?.sources.stat.warning
    },
    leaderboard: {
      source: input.taskSourceOps?.sources.leaderboard.source ?? "none",
      records: input.taskSourceOps?.sources.leaderboard.leaderboards ?? 0,
      proposed: input.taskSourceOps?.sources.leaderboard.proposed ?? 0,
      newProposals: leaderboardNewProposals,
      reviewRequired: input.taskSourceOps?.sources.leaderboard.reviewRequired ?? 0,
      canImportNow: leaderboardNewProposals > 0,
      endpoint: `/api/steam/apps/${input.appid}/leaderboard-proposals`,
      importEndpoint: `/api/steam/apps/${input.appid}/leaderboard-proposals/import-recommended`,
      warning: input.taskSourceOps?.sources.leaderboard.warning
    }
  };
}

function buildSourceActions(input: {
  appid: number;
  sourcePlan: BenchmarkBlueprintSourcePlan;
  candidateTasks: number;
  candidateReviewRequired: number;
}): BenchmarkBlueprintSourceAction[] {
  const actions: BenchmarkBlueprintSourceAction[] = [];
  if (input.sourcePlan.achievement.newImports > 0) {
    actions.push({
      id: "import-achievement-recommendations",
      label: "Import achievement recommendations",
      priority: "high",
      method: "POST",
      endpoint: input.sourcePlan.achievement.importEndpoint,
      body: {
        useFixture: input.sourcePlan.achievement.source === "fixture",
        limit: Math.max(1, Math.min(50, input.sourcePlan.achievement.newImports))
      },
      reason: `${input.sourcePlan.achievement.newImports} achievement recommendation(s) can become benchmark candidates.`
    });
  }
  if (input.sourcePlan.stat.newProposals > 0) {
    actions.push({
      id: "import-stat-proposals",
      label: "Import stat proposals",
      priority: actions.length === 0 ? "high" : "medium",
      method: "POST",
      endpoint: input.sourcePlan.stat.importEndpoint,
      body: {
        useFixture: input.sourcePlan.stat.source === "fixture",
        limit: Math.max(1, Math.min(50, input.sourcePlan.stat.newProposals))
      },
      reason: `${input.sourcePlan.stat.newProposals} Steam stat proposal(s) can become review candidates.`
    });
  }
  if (input.sourcePlan.leaderboard.newProposals > 0) {
    actions.push({
      id: "import-leaderboard-proposals",
      label: "Import leaderboard proposals",
      priority: actions.length === 0 ? "high" : "medium",
      method: "POST",
      endpoint: input.sourcePlan.leaderboard.importEndpoint,
      body: {
        useFixture: input.sourcePlan.leaderboard.source === "fixture",
        limit: Math.max(1, Math.min(50, input.sourcePlan.leaderboard.newProposals))
      },
      reason: `${input.sourcePlan.leaderboard.newProposals} Steam leaderboard proposal(s) can become controlled review candidates.`
    });
  }
  if (input.candidateTasks > 0) {
    actions.push({
      id: "publish-candidates",
      label: "Publish review-cleared candidates",
      priority: actions.length === 0 ? "high" : "medium",
      method: "POST",
      endpoint: `/api/steam/apps/${input.appid}/publish-candidates`,
      body: { reviewApproved: input.candidateReviewRequired === 0 },
      reason: `${input.candidateTasks} candidate task(s) are waiting in the registry.`
    });
  }
  return actions;
}

export function buildBenchmarkBlueprint(input: {
  game: GameCatalogEntry;
  tasks: BenchmarkTask[];
  taskRegistry: TaskRegistryEntry[];
  discovery?: SteamAppDiscoveryCandidate;
  taskSourceOps?: SteamTaskSourceOpsReport;
  generatedAt?: string;
}): BenchmarkBlueprint {
  const activeTasks = input.tasks.filter((task) => task.appid === input.game.appid);
  const registryTasks = input.taskRegistry.filter((task) => task.appid === input.game.appid);
  const activeTaskIds = new Set(activeTasks.map((task) => task.id));
  const allTasks = [
    ...activeTasks,
    ...registryTasks.filter((task) => !activeTaskIds.has(task.id))
  ];
  const registryById = new Map(registryTasks.map((task) => [task.id, task]));
  const reviews = buildTaskReviews(allTasks);
  const reviewsByTask = new Map(reviews.map((review) => [review.taskId, review]));
  const suites = buildBenchmarkSuites({ games: [input.game], tasks: allTasks, reviews });
  const availableAchievementTasks = achievementFixtures[input.game.appid]?.length ?? input.discovery?.estimatedAchievementTasks ?? 0;
  const importedAchievementTasks = allTasks.filter((task) => task.track === "achievement" && (task.source === "fixture" || task.source === "steam-live")).length;
  const rankedReadyTasks = reviews.filter((review) => review.decision === "ranked-ready").length;
  const reviewRequiredTasks = reviews.filter((review) => review.decision === "review-required").length;
  const rejectedTasks = reviews.filter((review) => review.decision === "reject").length;
  const candidateTasks = registryTasks.filter((task) => task.status === "candidate").length;
  const candidateReviewRequired = registryTasks.filter((task) => task.status === "candidate" && task.reviewRequired).length;
  const importPlan = {
    endpoint: input.discovery
      ? `/api/steam/apps/discovery/${input.discovery.id}/import-achievements`
      : `/api/steam/apps/${input.game.appid}/import-achievements`,
    source: (availableAchievementTasks > 0 ? input.discovery?.source ?? "fixture" : "none") as "fixture" | "steam-live" | "none",
    availableAchievementTasks,
    importedAchievementTasks,
    recommendedImportLimit: Math.min(25, Math.max(1, availableAchievementTasks || 1)),
    canImportNow: availableAchievementTasks > importedAchievementTasks
  };
  const sourcePlan = buildSourcePlan({
    appid: input.game.appid,
    importPlan,
    importedAchievementTasks,
    allTasks,
    registryTasks,
    taskSourceOps: input.taskSourceOps
  });
  const status = statusFor({
    activeTasks: activeTasks.length,
    candidateTasks,
    rankedReadyTasks,
    reviewRequiredTasks,
    availableAchievementTasks,
    newSourceImportsAvailable: sourcePlan.newImportsAvailable
  });
  const trackCoverage = tracksFor(allTasks);
  const adapter = adapterForGame({
    appid: input.game.appid,
    gameName: input.game.name,
    track: trackCoverage[0] ?? input.game.tracks[0] ?? "achievement"
  });

  return {
    schemaVersion: "steambench.benchmark-blueprint.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    appid: input.game.appid,
    game: input.game,
    discovery: input.discovery,
    status,
    readinessScore: readinessScoreFor({
      game: input.game,
      activeTasks: activeTasks.length,
      candidateTasks,
      rankedReadyTasks,
      reviewRequiredTasks,
      availableAchievementTasks,
      statRecords: sourcePlan.stat.records,
      leaderboardRecords: sourcePlan.leaderboard.records,
      suiteCount: suites.length
    }),
    reasons: reasonsFor({
      status,
      game: input.game,
      activeTasks: activeTasks.length,
      candidateTasks,
      availableAchievementTasks,
      sourcePlan,
      tracks: trackCoverage
    }),
    nextActions: nextActionsFor({
      status,
      appid: input.game.appid,
      activeTasks: activeTasks.length,
      candidateTasks,
      rankedReadyTasks,
      availableAchievementTasks,
      sourcePlan,
      discovery: input.discovery
    }),
    importPlan,
    sourcePlan,
    sourceActions: buildSourceActions({
      appid: input.game.appid,
      sourcePlan,
      candidateTasks,
      candidateReviewRequired
    }),
    taskLadder: buildTaskLadder({
      tasks: allTasks,
      registryById,
      reviewsByTask
    }),
    suites,
    runtimePlan: {
      adapter,
      targetArtifactName: "output.mp4",
      stage2StartConstraints: [
        "Keep start() minimal: create directories and perform only small eval-required installs.",
        "Do not call session.run_file(...) in Stage 2 start().",
        "Do not copy task inputs or software project files into output/.",
        "Do not sync GCS or clear existing output directories by default."
      ],
      proofRequirements: [
        "Canonical capture artifact output/output.mp4.",
        "Run metadata with task, appid, competitor identity, timestamps, and runtime provider.",
        "Steam achievement proof for achievement tasks, or verified manual-review proof for stat, leaderboard, and capture tasks."
      ],
      readinessChecks: adapter.readinessChecks,
      agentLoopHints: adapter.agentLoopHints,
      evidenceHints: adapter.evidenceHints
    },
    reviewPlan: {
      rankedReadyTasks,
      reviewRequiredTasks,
      rejectedTasks,
      controls: uniqueSorted(reviews.flatMap((review) => review.controls)).slice(0, 8),
      risks: uniqueSorted(allTasks.flatMap((task) => task.riskFlags))
    },
    competitionPlan: {
      humanAgentRaceReady: status === "ranked-ready" && suites.some((suite) => suite.status === "ranked-ready"),
      suiteIds: suites.filter((suite) => suite.status === "ranked-ready" || suite.status === "controlled").map((suite) => suite.id),
      publicEndpoints: [
        `/api/games/${input.game.appid}/profile`,
        `/api/games/${input.game.appid}/benchmark-suites`,
        `/api/games/${input.game.appid}/benchmark-blueprint`
      ],
      proofGates: [
        "Humans must link Steam and grant proof consent before public ranking.",
        "Agents must satisfy runtime readiness checks before dispatch.",
        "Scoring requires verified proof records and the canonical output.mp4 artifact."
      ]
    }
  };
}
