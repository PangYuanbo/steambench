import { benchmarkRiskFlags, evaluateBenchmarkSuitability, type BenchmarkRiskFinding, type BenchmarkSuitabilityRating } from "./suitability";
import type { BenchmarkTask } from "./types";

export type TaskReviewDecision = "ranked-ready" | "review-required" | "reject";

export type TaskReview = {
  taskId: string;
  score: number;
  rating: BenchmarkSuitabilityRating;
  decision: TaskReviewDecision;
  reviewRequired: boolean;
  fairnessVerdict: BenchmarkTask["fairnessVerdict"];
  controls: string[];
  risks: BenchmarkRiskFinding[];
  recommendations: string[];
};

function flagsFor(task: BenchmarkTask) {
  const active = new Set(task.riskFlags);
  return Object.fromEntries(benchmarkRiskFlags.map((flag) => [flag, active.has(flag)]));
}

function decisionFor(task: BenchmarkTask, rating: BenchmarkSuitabilityRating): TaskReviewDecision {
  if (task.fairnessVerdict === "exclude" || rating === "reject") return "reject";
  if (task.reviewRequired || rating !== "recommended" || task.fairnessVerdict !== "good") return "review-required";
  return "ranked-ready";
}

export function buildTaskReview(task: BenchmarkTask): TaskReview {
  const result = evaluateBenchmarkSuitability({
    track: task.track,
    benchmarkFit: Math.round((task.score - task.level * 650) / 22),
    achievementPercent: task.achievementPercent,
    estimatedRuntimeMinutes: task.estimatedRuntimeMinutes,
    flags: flagsFor(task)
  });
  const rating = task.suitability === "baseline" || task.suitability === "ranked" ? "recommended" : result.rating;
  const reviewRequired = task.reviewRequired || result.reviewRequired;

  return {
    taskId: task.id,
    score: task.suitabilityScore || result.score,
    rating,
    decision: decisionFor({ ...task, reviewRequired }, rating),
    reviewRequired,
    fairnessVerdict: task.fairnessVerdict,
    controls: result.fairness.controls,
    risks: result.activeRisks,
    recommendations: result.recommendations
  };
}

export function buildTaskReviews(tasks: BenchmarkTask[]): TaskReview[] {
  return tasks.map(buildTaskReview).sort((a, b) => b.score - a.score || a.taskId.localeCompare(b.taskId));
}
