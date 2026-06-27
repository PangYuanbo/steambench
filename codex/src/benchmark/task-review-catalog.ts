import { benchmarkRiskFlags, type BenchmarkRiskFlag, type BenchmarkSuitabilityRating, type FairnessVerdict } from "./suitability";
import { buildTaskReview, type TaskReview, type TaskReviewDecision } from "./task-review";
import type { BenchmarkTask } from "./types";
import type { TaskRegistryEntry } from "../server/store";

export type TaskReviewCatalogEntry = {
  task: BenchmarkTask;
  review: TaskReview;
  registryStatus: TaskRegistryEntry["status"] | "fixture-active";
  rankEligible: boolean;
  needsManualReview: boolean;
  publicRankBlocked: boolean;
};

export type TaskReviewCatalog = {
  generatedAt: string;
  totals: {
    tasks: number;
    active: number;
    candidates: number;
    rejected: number;
    rankedReady: number;
    reviewRequired: number;
    blocked: number;
  };
  decisions: Record<TaskReviewDecision, number>;
  ratings: Record<BenchmarkSuitabilityRating, number>;
  fairness: Record<FairnessVerdict, number>;
  risks: Array<{
    flag: BenchmarkRiskFlag;
    count: number;
  }>;
  reviewQueue: TaskReviewCatalogEntry[];
  entries: TaskReviewCatalogEntry[];
};

export type TaskReviewCatalogFilter = {
  decision?: TaskReviewDecision;
  fairnessVerdict?: FairnessVerdict;
  riskFlag?: BenchmarkRiskFlag;
  registryStatus?: TaskReviewCatalogEntry["registryStatus"];
  limit?: number;
};

const decisionPriority: Record<TaskReviewDecision, number> = {
  reject: 0,
  "review-required": 1,
  "ranked-ready": 2
};

const emptyDecisionCounts = (): Record<TaskReviewDecision, number> => ({
  "ranked-ready": 0,
  "review-required": 0,
  reject: 0
});

const emptyRatingCounts = (): Record<BenchmarkSuitabilityRating, number> => ({
  recommended: 0,
  "usable-with-review": 0,
  "poor-fit": 0,
  reject: 0
});

const emptyFairnessCounts = (): Record<FairnessVerdict, number> => ({
  good: 0,
  controlled: 0,
  "not-comparable": 0,
  exclude: 0
});

function registryStatusFor(task: BenchmarkTask, registryById: Map<string, TaskRegistryEntry>): TaskReviewCatalogEntry["registryStatus"] {
  return registryById.get(task.id)?.status ?? "fixture-active";
}

function sortCatalogEntries(a: TaskReviewCatalogEntry, b: TaskReviewCatalogEntry): number {
  return (
    decisionPriority[a.review.decision] - decisionPriority[b.review.decision] ||
    b.review.score - a.review.score ||
    a.task.gameName.localeCompare(b.task.gameName) ||
    a.task.title.localeCompare(b.task.title)
  );
}

export function buildTaskReviewCatalog(input: {
  tasks: BenchmarkTask[];
  taskRegistry: TaskRegistryEntry[];
  generatedAt?: string;
  filter?: TaskReviewCatalogFilter;
}): TaskReviewCatalog {
  const registryById = new Map(input.taskRegistry.map((task) => [task.id, task]));
  const activeTaskIds = new Set(input.tasks.map((task) => task.id));
  const allTasks = [
    ...input.tasks,
    ...input.taskRegistry.filter((task) => !activeTaskIds.has(task.id))
  ];

  let entries = allTasks.map((task) => {
    const review = buildTaskReview(task);
    return {
      task,
      review,
      registryStatus: registryStatusFor(task, registryById),
      rankEligible: review.decision === "ranked-ready",
      needsManualReview: review.decision === "review-required" || review.reviewRequired,
      publicRankBlocked: review.decision === "reject" || review.fairnessVerdict === "exclude"
    } satisfies TaskReviewCatalogEntry;
  });

  if (input.filter?.decision) {
    entries = entries.filter((entry) => entry.review.decision === input.filter?.decision);
  }
  if (input.filter?.fairnessVerdict) {
    entries = entries.filter((entry) => entry.review.fairnessVerdict === input.filter?.fairnessVerdict);
  }
  if (input.filter?.riskFlag) {
    entries = entries.filter((entry) => entry.review.risks.some((risk) => risk.flag === input.filter?.riskFlag));
  }
  if (input.filter?.registryStatus) {
    entries = entries.filter((entry) => entry.registryStatus === input.filter?.registryStatus);
  }

  entries = entries.sort(sortCatalogEntries);
  if (input.filter?.limit !== undefined) {
    entries = entries.slice(0, input.filter.limit);
  }

  const decisions = emptyDecisionCounts();
  const ratings = emptyRatingCounts();
  const fairness = emptyFairnessCounts();
  const riskCounts = new Map<BenchmarkRiskFlag, number>(benchmarkRiskFlags.map((flag) => [flag, 0]));

  for (const entry of entries) {
    decisions[entry.review.decision] += 1;
    ratings[entry.review.rating] += 1;
    fairness[entry.review.fairnessVerdict] += 1;
    for (const risk of entry.review.risks) {
      riskCounts.set(risk.flag, (riskCounts.get(risk.flag) ?? 0) + 1);
    }
  }

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    totals: {
      tasks: entries.length,
      active: entries.filter((entry) => entry.registryStatus === "fixture-active" || entry.registryStatus === "active").length,
      candidates: entries.filter((entry) => entry.registryStatus === "candidate").length,
      rejected: entries.filter((entry) => entry.registryStatus === "rejected").length,
      rankedReady: decisions["ranked-ready"],
      reviewRequired: decisions["review-required"],
      blocked: decisions.reject
    },
    decisions,
    ratings,
    fairness,
    risks: [...riskCounts.entries()]
      .map(([flag, count]) => ({ flag, count }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count || a.flag.localeCompare(b.flag)),
    reviewQueue: entries
      .filter((entry) => entry.needsManualReview || entry.publicRankBlocked || entry.registryStatus === "candidate")
      .slice(0, 12),
    entries
  };
}
