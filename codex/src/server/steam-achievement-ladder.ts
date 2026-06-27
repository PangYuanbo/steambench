import { buildTaskReview, type TaskReview } from "../benchmark/task-review";
import { buildAchievementTask } from "../benchmark/task-generator";
import type { BenchmarkTask, GameCatalogEntry, SteamAchievement } from "../benchmark/types";
import type { TaskRegistryEntry } from "./store";

export type SteamAchievementBenchmarkLadderBandId = "starter" | "ranked" | "expert" | "review";

export type SteamAchievementBenchmarkLadderItem = {
  task: BenchmarkTask;
  review: TaskReview;
  importStatus: "active" | "candidate" | "rejected" | "new";
  recommendation: "keep-active" | "publish-candidate" | "import-candidate" | "reject-or-redesign";
  reasons: string[];
};

export type SteamAchievementBenchmarkLadderBand = {
  id: SteamAchievementBenchmarkLadderBandId;
  label: string;
  levelRange: string;
  percentRange: string;
  taskCount: number;
  rankedReady: number;
  reviewRequired: number;
  items: SteamAchievementBenchmarkLadderItem[];
};

export type SteamAchievementBenchmarkLadder = {
  schemaVersion: "steambench.steam-achievement-benchmark-ladder.v1";
  generatedAt: string;
  appid: number;
  game: GameCatalogEntry;
  source: BenchmarkTask["source"];
  canonicalArtifactName: "output.mp4";
  selectionRules: string[];
  totals: {
    achievements: number;
    active: number;
    candidates: number;
    rejected: number;
    new: number;
    rankedReady: number;
    reviewRequired: number;
    recommendedImports: number;
  };
  bands: SteamAchievementBenchmarkLadderBand[];
  recommendedImports: SteamAchievementBenchmarkLadderItem[];
  nextActions: string[];
  links: {
    achievementTasks: string;
    importAchievements: string;
    importRecommended: string;
    publishCandidates: string;
    coveragePlan: string;
    benchmarkBlueprint: string;
  };
};

const bandTemplates: Array<Omit<SteamAchievementBenchmarkLadderBand, "taskCount" | "rankedReady" | "reviewRequired" | "items">> = [
  {
    id: "starter",
    label: "Starter proof tasks",
    levelRange: "1-3",
    percentRange: "Common achievements, usually >= 35% global unlock",
  },
  {
    id: "ranked",
    label: "Ranked benchmark tasks",
    levelRange: "4-7",
    percentRange: "Mid-rarity achievements, usually 8-35% global unlock",
  },
  {
    id: "expert",
    label: "Expert stretch tasks",
    levelRange: "8-10",
    percentRange: "Rare achievements, usually 2-8% global unlock",
  },
  {
    id: "review",
    label: "Needs redesign or manual review",
    levelRange: "Any",
    percentRange: "Ultra-rare, exclusion-risk, grindy, or not comparable",
  },
];

function ladderBandFor(task: BenchmarkTask, review: TaskReview): SteamAchievementBenchmarkLadderBandId {
  if (review.decision === "reject" || task.suitability === "needs-review") return "review";
  if (task.suitability === "expert") return "expert";
  if (task.suitability === "ranked") return "ranked";
  return "starter";
}

function importStatusFor(input: {
  task: BenchmarkTask;
  activeTaskIds: Set<string>;
  registryById: Map<string, TaskRegistryEntry>;
}): SteamAchievementBenchmarkLadderItem["importStatus"] {
  if (input.activeTaskIds.has(input.task.id)) return "active";
  const registry = input.registryById.get(input.task.id);
  if (registry?.status === "active") return "active";
  if (registry?.status === "candidate") return "candidate";
  if (registry?.status === "rejected") return "rejected";
  return "new";
}

function recommendationFor(
  importStatus: SteamAchievementBenchmarkLadderItem["importStatus"],
  review: TaskReview
): SteamAchievementBenchmarkLadderItem["recommendation"] {
  if (review.decision === "reject" || importStatus === "rejected") return "reject-or-redesign";
  if (importStatus === "active") return "keep-active";
  if (importStatus === "candidate") return "publish-candidate";
  return "import-candidate";
}

function reasonsFor(item: {
  task: BenchmarkTask;
  review: TaskReview;
  importStatus: SteamAchievementBenchmarkLadderItem["importStatus"];
}): string[] {
  const reasons = [
    `${item.task.achievementPercent?.toFixed(2) ?? "unknown"}% global unlock maps to level ${item.task.level}.`,
    `${item.review.decision} review decision with fairness verdict ${item.review.fairnessVerdict}.`,
    item.importStatus === "active"
      ? "Already active in the benchmark catalog."
      : item.importStatus === "candidate"
        ? "Already imported as a review candidate."
        : item.importStatus === "rejected"
          ? "Previously rejected; redesign before use."
          : "Not imported yet; safe to add only as a review candidate."
  ];
  if (item.review.risks.length > 0) {
    reasons.push(`Risk flags: ${item.review.risks.map((risk) => risk.flag).join(", ")}.`);
  }
  return reasons;
}

function sortItems(a: SteamAchievementBenchmarkLadderItem, b: SteamAchievementBenchmarkLadderItem): number {
  return (
    a.task.level - b.task.level ||
    (b.task.achievementPercent ?? 0) - (a.task.achievementPercent ?? 0) ||
    b.review.score - a.review.score ||
    a.task.id.localeCompare(b.task.id)
  );
}

export function buildSteamAchievementBenchmarkLadder(input: {
  game: GameCatalogEntry;
  achievements: SteamAchievement[];
  activeTasks: BenchmarkTask[];
  taskRegistry: TaskRegistryEntry[];
  source: BenchmarkTask["source"];
  generatedAt?: string;
}): SteamAchievementBenchmarkLadder {
  const activeTaskIds = new Set(input.activeTasks.map((task) => task.id));
  const registryById = new Map(input.taskRegistry.map((entry) => [entry.id, entry]));
  const items = input.achievements.map((achievement) => {
    const task = buildAchievementTask(input.game, achievement, input.source);
    const review = buildTaskReview(task);
    const importStatus = importStatusFor({ task, activeTaskIds, registryById });
    return {
      task,
      review,
      importStatus,
      recommendation: recommendationFor(importStatus, review),
      reasons: reasonsFor({ task, review, importStatus })
    };
  });
  const recommendedImports = items
    .filter((item) => item.recommendation === "import-candidate" || item.recommendation === "publish-candidate")
    .sort((a, b) => {
      const rankA = a.review.decision === "ranked-ready" ? 0 : 1;
      const rankB = b.review.decision === "ranked-ready" ? 0 : 1;
      return rankA - rankB || b.review.score - a.review.score || sortItems(a, b);
    })
    .slice(0, 12);
  const bandItems = new Map<SteamAchievementBenchmarkLadderBandId, SteamAchievementBenchmarkLadderItem[]>();
  for (const template of bandTemplates) bandItems.set(template.id, []);
  for (const item of items) {
    bandItems.get(ladderBandFor(item.task, item.review))?.push(item);
  }

  return {
    schemaVersion: "steambench.steam-achievement-benchmark-ladder.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    appid: input.game.appid,
    game: input.game,
    source: input.source,
    canonicalArtifactName: "output.mp4",
    selectionRules: [
      "Prefer achievements with bounded single-player objectives and stable Steam achievement proof.",
      "Treat imported achievements as candidates until task review confirms fairness and runtime feasibility.",
      "Avoid duplicate imports when the same task is already active, candidate, or rejected.",
      "Require the canonical output.mp4 artifact for scored human and agent attempts."
    ],
    totals: {
      achievements: items.length,
      active: items.filter((item) => item.importStatus === "active").length,
      candidates: items.filter((item) => item.importStatus === "candidate").length,
      rejected: items.filter((item) => item.importStatus === "rejected").length,
      new: items.filter((item) => item.importStatus === "new").length,
      rankedReady: items.filter((item) => item.review.decision === "ranked-ready").length,
      reviewRequired: items.filter((item) => item.review.decision === "review-required").length,
      recommendedImports: recommendedImports.length
    },
    bands: bandTemplates.map((template) => {
      const band = [...(bandItems.get(template.id) ?? [])].sort(sortItems);
      return {
        ...template,
        taskCount: band.length,
        rankedReady: band.filter((item) => item.review.decision === "ranked-ready").length,
        reviewRequired: band.filter((item) => item.review.decision === "review-required").length,
        items: band
      };
    }),
    recommendedImports,
    nextActions: [
      `Preview generated task contracts at /api/steam/apps/${input.game.appid}/achievement-tasks.`,
      `Import recommended new achievements through /api/steam/apps/${input.game.appid}/achievement-ladder/import-recommended.`,
      `Publish review-cleared candidates through /api/steam/apps/${input.game.appid}/publish-candidates.`,
      `Run /api/games/${input.game.appid}/coverage-plan after publication to schedule human and agent attempts.`
    ],
    links: {
      achievementTasks: `/api/steam/apps/${input.game.appid}/achievement-tasks`,
      importAchievements: `/api/steam/apps/${input.game.appid}/import-achievements`,
      importRecommended: `/api/steam/apps/${input.game.appid}/achievement-ladder/import-recommended`,
      publishCandidates: `/api/steam/apps/${input.game.appid}/publish-candidates`,
      coveragePlan: `/api/games/${input.game.appid}/coverage-plan`,
      benchmarkBlueprint: `/api/games/${input.game.appid}/benchmark-blueprint`
    }
  };
}
