import type { TaskReview } from "./task-review";
import type { BenchmarkTask, BenchmarkTrack, GameCatalogEntry } from "./types";

export type BenchmarkSuiteTier = "starter" | "ranked" | "expert" | "marathon";

export type BenchmarkSuiteStatus = "ranked-ready" | "controlled" | "review-required" | "insufficient";

export type BenchmarkSuite = {
  id: string;
  appid: number;
  gameName: string;
  tier: BenchmarkSuiteTier;
  title: string;
  status: BenchmarkSuiteStatus;
  taskIds: string[];
  taskCount: number;
  tracks: BenchmarkTrack[];
  levelRange: {
    min: number;
    max: number;
  };
  estimatedRuntimeMinutes: number;
  benchmarkFit: number;
  readinessScore: number;
  rankedReadyTasks: number;
  controlledTasks: number;
  reviewRequiredTasks: number;
  requiredControls: string[];
  riskFlags: string[];
};

type TierRule = {
  tier: BenchmarkSuiteTier;
  title: string;
  minLevel: number;
  maxLevel: number;
};

const tierRules: TierRule[] = [
  {
    tier: "starter",
    title: "Starter Ladder",
    minLevel: 1,
    maxLevel: 3
  },
  {
    tier: "ranked",
    title: "Ranked Ladder",
    minLevel: 4,
    maxLevel: 6
  },
  {
    tier: "expert",
    title: "Expert Ladder",
    minLevel: 7,
    maxLevel: 10
  },
  {
    tier: "marathon",
    title: "Full Game Suite",
    minLevel: 1,
    maxLevel: 10
  }
];

const uniqueSorted = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

function statusFor(input: {
  taskCount: number;
  rankedReadyTasks: number;
  controlledTasks: number;
  reviewRequiredTasks: number;
  hasExcludedTask: boolean;
}): BenchmarkSuiteStatus {
  if (input.taskCount === 0) return "insufficient";
  if (input.hasExcludedTask || input.reviewRequiredTasks > input.rankedReadyTasks) return "review-required";
  if (input.controlledTasks > 0) return "controlled";
  return input.rankedReadyTasks > 0 ? "ranked-ready" : "insufficient";
}

function readinessScoreFor(input: {
  game: GameCatalogEntry;
  taskCount: number;
  rankedReadyTasks: number;
  controlledTasks: number;
  reviewRequiredTasks: number;
}): number {
  if (input.taskCount === 0) return 0;
  const rankedCoverage = input.rankedReadyTasks / input.taskCount;
  const controlledCoverage = input.controlledTasks / input.taskCount;
  const reviewPenalty = input.reviewRequiredTasks / input.taskCount;
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(input.game.benchmarkFit * 0.45 + rankedCoverage * 35 + controlledCoverage * 15 - reviewPenalty * 20)
    )
  );
}

export function buildBenchmarkSuites(input: {
  games: GameCatalogEntry[];
  tasks: BenchmarkTask[];
  reviews: TaskReview[];
}): BenchmarkSuite[] {
  const reviewsByTask = new Map(input.reviews.map((review) => [review.taskId, review]));

  return input.games.flatMap((game) => {
    const gameTasks = input.tasks
      .filter((task) => task.appid === game.appid && task.fairnessVerdict !== "exclude")
      .sort((a, b) => a.level - b.level || b.score - a.score || a.id.localeCompare(b.id));

    return tierRules
      .map((rule): BenchmarkSuite => {
        const suiteTasks = gameTasks.filter((task) => task.level >= rule.minLevel && task.level <= rule.maxLevel);
        const reviews = suiteTasks.map((task) => reviewsByTask.get(task.id)).filter((review): review is TaskReview => Boolean(review));
        const rankedReadyTasks = reviews.filter((review) => review.decision === "ranked-ready").length;
        const controlledTasks = suiteTasks.filter((task) => task.fairnessVerdict === "controlled").length;
        const reviewRequiredTasks = reviews.filter((review) => review.decision === "review-required").length;
        const hasExcludedTask = reviews.some((review) => review.decision === "reject");
        const tracks = uniqueSorted(suiteTasks.map((task) => task.track)) as BenchmarkTrack[];
        const status = statusFor({
          taskCount: suiteTasks.length,
          rankedReadyTasks,
          controlledTasks,
          reviewRequiredTasks,
          hasExcludedTask
        });

        return {
          id: `${game.appid}:${rule.tier}`,
          appid: game.appid,
          gameName: game.name,
          tier: rule.tier,
          title: `${game.name} ${rule.title}`,
          status,
          taskIds: suiteTasks.map((task) => task.id),
          taskCount: suiteTasks.length,
          tracks,
          levelRange: {
            min: rule.minLevel,
            max: rule.maxLevel
          },
          estimatedRuntimeMinutes: suiteTasks.reduce((total, task) => total + task.estimatedRuntimeMinutes, 0),
          benchmarkFit: game.benchmarkFit,
          readinessScore: readinessScoreFor({
            game,
            taskCount: suiteTasks.length,
            rankedReadyTasks,
            controlledTasks,
            reviewRequiredTasks
          }),
          rankedReadyTasks,
          controlledTasks,
          reviewRequiredTasks,
          requiredControls: uniqueSorted(reviews.flatMap((review) => review.controls)).slice(0, 5),
          riskFlags: uniqueSorted(suiteTasks.flatMap((task) => task.riskFlags))
        };
      })
      .filter((suite) => suite.taskCount > 0);
  }).sort((a, b) => b.readinessScore - a.readinessScore || b.taskCount - a.taskCount || a.id.localeCompare(b.id));
}
