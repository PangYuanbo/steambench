import type { BenchmarkTrack, GameCatalogEntry, SteamAchievement } from "./types";

export const benchmarkRiskFlags = [
  "grind",
  "multiplayer",
  "dlc",
  "seasonal",
  "antiCheat",
  "longHorizon"
] as const;

export type BenchmarkRiskFlag = (typeof benchmarkRiskFlags)[number];

export type BenchmarkRiskSeverity = "medium" | "high" | "blocker";

export type BenchmarkSuitabilityRating = "recommended" | "usable-with-review" | "poor-fit" | "reject";

export type FairnessVerdict = "good" | "controlled" | "not-comparable" | "exclude";

export type BenchmarkRiskFinding = {
  flag: BenchmarkRiskFlag;
  label: string;
  severity: BenchmarkRiskSeverity;
  penalty: number;
  recommendation: string;
};

export type BenchmarkSuitabilityInput = {
  track: BenchmarkTrack;
  benchmarkFit?: number;
  harnessRisk?: GameCatalogEntry["harnessRisk"];
  achievementPercent?: number;
  estimatedRuntimeMinutes?: number;
  flags?: Partial<Record<BenchmarkRiskFlag, boolean>>;
  notes?: string;
};

export type BenchmarkFairnessRecommendation = {
  verdict: FairnessVerdict;
  controls: string[];
};

export type BenchmarkSuitabilityResult = {
  score: number;
  rating: BenchmarkSuitabilityRating;
  reviewRequired: boolean;
  activeRisks: BenchmarkRiskFinding[];
  fairness: BenchmarkFairnessRecommendation;
  recommendations: string[];
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const riskDefinitions: Record<BenchmarkRiskFlag, Omit<BenchmarkRiskFinding, "flag">> = {
  grind: {
    label: "Grind-heavy progression",
    severity: "high",
    penalty: 12,
    recommendation: "Prefer a bounded sub-goal, checkpointed save, or per-run stat target over total-account progress."
  },
  multiplayer: {
    label: "Requires multiplayer or external coordination",
    severity: "blocker",
    penalty: 26,
    recommendation: "Exclude ranked tasks unless they can be run solo, in a private lobby, or against deterministic bots."
  },
  dlc: {
    label: "Requires DLC or paid add-on content",
    severity: "medium",
    penalty: 10,
    recommendation: "Split DLC tasks into a separate track and require identical entitlement checks for humans and agents."
  },
  seasonal: {
    label: "Seasonal or time-limited availability",
    severity: "blocker",
    penalty: 24,
    recommendation: "Exclude from persistent leaderboards unless the event window and game build are frozen for all attempts."
  },
  antiCheat: {
    label: "Anti-cheat or automation-sensitive surface",
    severity: "blocker",
    penalty: 32,
    recommendation: "Do not run agent automation against anti-cheat-protected modes; use an approved offline/sandbox mode or reject."
  },
  longHorizon: {
    label: "Long-horizon task",
    severity: "high",
    penalty: 12,
    recommendation: "Use time caps, seeded starts, save-state checkpoints, and partial-credit milestones."
  }
};

const trackAdjustment: Record<BenchmarkTrack, number> = {
  achievement: 8,
  stat: 5,
  capture: 0,
  leaderboard: -8
};

const harnessAdjustment: Record<GameCatalogEntry["harnessRisk"], number> = {
  low: 8,
  medium: 0,
  high: -16
};

function rarityAdjustment(percent?: number): number {
  if (percent === undefined) return 0;
  if (percent >= 35) return 6;
  if (percent >= 8) return 10;
  if (percent >= 2) return 2;
  return -10;
}

function runtimeAdjustment(minutes?: number): number {
  if (minutes === undefined) return 0;
  if (minutes <= 45) return 8;
  if (minutes <= 120) return 0;
  if (minutes <= 240) return -8;
  return -10;
}

function activeRiskFindings(input: BenchmarkSuitabilityInput): BenchmarkRiskFinding[] {
  const longHorizonByRuntime = (input.estimatedRuntimeMinutes ?? 0) > 180;

  return benchmarkRiskFlags
    .filter((flag) => Boolean(input.flags?.[flag]) || (flag === "longHorizon" && longHorizonByRuntime))
    .map((flag) => ({
      flag,
      ...riskDefinitions[flag]
    }));
}

function rate(score: number, activeRisks: BenchmarkRiskFinding[]): BenchmarkSuitabilityRating {
  const hasBlocker = activeRisks.some((risk) => risk.severity === "blocker");
  const hasHighRisk = activeRisks.some((risk) => risk.severity === "high");

  if (score < 35 || (hasBlocker && score < 55)) return "reject";
  if (score < 55 || hasBlocker) return "poor-fit";
  if (score < 75 || hasHighRisk) return "usable-with-review";
  return "recommended";
}

function fairnessFor(input: BenchmarkSuitabilityInput, activeRisks: BenchmarkRiskFinding[]): BenchmarkFairnessRecommendation {
  const activeFlags = new Set(activeRisks.map((risk) => risk.flag));
  const controls = [
    "Use the same game build, task text, scoring window, and evidence requirements for human and agent attempts.",
    "Require linked SteamID proof, run metadata, and enough capture/replay evidence to audit the attempt."
  ];

  if (activeFlags.has("dlc")) {
    controls.push("Verify matching DLC ownership before assignment, or keep the task in a DLC-only benchmark track.");
  }

  if (activeFlags.has("grind") || activeFlags.has("longHorizon")) {
    controls.push("Cap wall-clock time and publish checkpoint or partial-credit rules before accepting submissions.");
  }

  if (activeFlags.has("multiplayer")) {
    controls.push("Replace live matchmaking with solo, private-lobby, or deterministic-bot conditions.");
  }

  if (activeFlags.has("seasonal")) {
    controls.push("Freeze the event window and game build, or omit the task from cross-date comparisons.");
  }

  if (activeFlags.has("antiCheat")) {
    controls.push("Avoid anti-cheat-protected modes for agent automation; require an approved offline harness.");
  }

  if (input.track === "leaderboard") {
    controls.push("Snapshot leaderboard rules and reject tasks where live meta, matchmaking, or external opponents decide the score.");
  }

  if (activeFlags.has("antiCheat")) return { verdict: "exclude", controls };
  if (activeFlags.has("multiplayer") || activeFlags.has("seasonal")) return { verdict: "not-comparable", controls };
  if (activeRisks.length > 0 || input.track === "leaderboard") return { verdict: "controlled", controls };
  return { verdict: "good", controls };
}

export function evaluateBenchmarkSuitability(input: BenchmarkSuitabilityInput): BenchmarkSuitabilityResult {
  const activeRisks = activeRiskFindings(input);
  const benchmarkFit = input.benchmarkFit ?? 70;
  const fitAdjustment = (clamp(benchmarkFit, 0, 100) - 70) * 0.35;
  const riskPenalty = activeRisks.reduce((total, risk) => total + risk.penalty, 0);

  const score = Math.round(
    clamp(
      62 +
        fitAdjustment +
        trackAdjustment[input.track] +
        (input.harnessRisk ? harnessAdjustment[input.harnessRisk] : 0) +
        rarityAdjustment(input.achievementPercent) +
        runtimeAdjustment(input.estimatedRuntimeMinutes) -
        riskPenalty,
      0,
      100
    )
  );

  const rating = rate(score, activeRisks);
  const fairness = fairnessFor(input, activeRisks);
  const recommendations = [
    ...activeRisks.map((risk) => risk.recommendation),
    ...(rating === "recommended"
      ? ["Accept as a ranked benchmark candidate after normal proof validation."]
      : ["Send to benchmark review before ranking human and agent submissions together."])
  ];

  return {
    score,
    rating,
    reviewRequired: rating !== "recommended" || activeRisks.length > 0 || input.harnessRisk === "high",
    activeRisks,
    fairness,
    recommendations
  };
}

export function evaluateAchievementSuitability(
  game: Pick<GameCatalogEntry, "benchmarkFit" | "harnessRisk">,
  achievement: Pick<SteamAchievement, "percent">,
  options: Omit<BenchmarkSuitabilityInput, "track" | "benchmarkFit" | "harnessRisk" | "achievementPercent"> = {}
): BenchmarkSuitabilityResult {
  return evaluateBenchmarkSuitability({
    ...options,
    track: "achievement",
    benchmarkFit: game.benchmarkFit,
    harnessRisk: game.harnessRisk,
    achievementPercent: achievement.percent
  });
}
