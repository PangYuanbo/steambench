import type { BenchmarkTask } from "./types";

export type ScoreProofInput = {
  type: string;
  status: string;
  metadata?: Record<string, string | number | boolean>;
};

export type RunScoreMetadata = {
  scoringMode: "achievement" | "metric" | "manual-review";
  metricName?: string;
  metricValue?: number;
  targetValue?: string;
  direction?: "higher-is-better" | "lower-is-better";
  targetNumber?: number;
  thresholdMet?: boolean;
  multiplier?: number;
};

export type RunScoreResult = {
  score: number;
  evidence: string;
  metadata: RunScoreMetadata;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function metricDirection(task: BenchmarkTask): RunScoreMetadata["direction"] {
  const metricName = (task.metricName ?? "").toLowerCase();
  if (metricName.includes("time") || metricName.includes("seconds")) {
    return "lower-is-better";
  }
  if (task.track === "leaderboard") return "higher-is-better";
  const descriptor = `${task.targetValue ?? ""} ${task.scoringRule ?? ""}`.toLowerCase();
  if (descriptor.includes("lower") || descriptor.includes("shorter") || descriptor.includes("seconds")) return "lower-is-better";
  return "higher-is-better";
}

function targetNumberForTask(task: BenchmarkTask): number | undefined {
  const targetValue = task.targetValue?.toLowerCase() ?? "";
  const descriptor = `${task.metricName ?? ""} ${targetValue} ${task.scoringRule ?? ""}`.toLowerCase();
  if (descriptor.includes("highest") || descriptor.includes("maximize")) return undefined;
  return parseNumber(task.targetValue);
}

function metricValueForProof(task: BenchmarkTask, proof?: ScoreProofInput): number | undefined {
  if (!proof?.metadata) return undefined;
  const metricName = task.metricName ?? "";
  const candidates = [
    proof.metadata.metricValue,
    proof.metadata.value,
    metricName ? proof.metadata[metricName] : undefined,
    metricName ? proof.metadata[metricName.replace(/[^a-z0-9]/gi, "_")] : undefined
  ];
  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export function scoreRunAttempt(task: BenchmarkTask, proofs: ScoreProofInput[]): RunScoreResult {
  if (task.track === "achievement") {
    return {
      score: task.score,
      evidence: "Steam achievement proof + output.mp4",
      metadata: {
        scoringMode: "achievement"
      }
    };
  }

  const manualProof = proofs.find((proof) => proof.type === "manual-review" && proof.status === "verified");
  const metricValue = metricValueForProof(task, manualProof);
  if (metricValue === undefined) {
    return {
      score: task.score,
      evidence: `Manual review + output.mp4${task.metricName ? ` (${task.metricName} pending metric)` : ""}`,
      metadata: {
        scoringMode: "manual-review",
        metricName: task.metricName,
        targetValue: task.targetValue
      }
    };
  }

  const direction = metricDirection(task);
  const targetNumber = targetNumberForTask(task);
  const rawRatio =
    targetNumber === undefined
      ? 1 + Math.log10(Math.max(metricValue, 0) + 1) / 10
      : direction === "lower-is-better"
        ? targetNumber / Math.max(metricValue, 1)
        : metricValue / Math.max(targetNumber, 1);
  const multiplier = clamp(rawRatio, 0.25, 2.5);
  const score = Math.max(1, Math.round(task.score * multiplier));
  const thresholdMet =
    targetNumber === undefined ? undefined : direction === "lower-is-better" ? metricValue <= targetNumber : metricValue >= targetNumber;

  return {
    score,
    evidence: `Manual review + output.mp4 (${task.metricName ?? "metric"}=${metricValue})`,
    metadata: {
      scoringMode: "metric",
      metricName: task.metricName,
      metricValue,
      targetValue: task.targetValue,
      direction,
      targetNumber,
      thresholdMet,
      multiplier
    }
  };
}

export function simulatedMetricValue(task: BenchmarkTask): number | undefined {
  const targetNumber = targetNumberForTask(task);
  if (targetNumber === undefined) {
    if (task.track === "leaderboard") return Math.max(1000, Math.round(task.score / 2));
    return undefined;
  }
  return metricDirection(task) === "lower-is-better" ? Math.round(targetNumber * 0.9) : Math.round(targetNumber * 1.12);
}
