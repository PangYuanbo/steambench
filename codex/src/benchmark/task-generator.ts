import { achievementFixtures, benchmarkTaskSeeds, gameCatalog } from "./catalog";
import { evaluateAchievementSuitability, evaluateBenchmarkSuitability } from "./suitability";
import type { BenchmarkSignalSource, BenchmarkTask, BenchmarkTaskSeed, BenchmarkTrack, GameCatalogEntry, SteamAchievement, SteamLeaderboardDefinition, SteamStatDefinition } from "./types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function levelFromAchievementPercent(percent: number): number {
  const rarity = clamp(100 - percent, 1, 99);
  return clamp(Math.ceil(rarity / 10), 1, 10);
}

export function suitabilityForAchievement(percent: number): BenchmarkTask["suitability"] {
  if (percent >= 35) return "baseline";
  if (percent >= 8) return "ranked";
  if (percent >= 2) return "expert";
  return "needs-review";
}

export function taskScore(level: number, benchmarkFit: number, percent: number): number {
  const rarityBonus = clamp(100 - percent, 0, 100) * 18;
  return Math.round(level * 650 + benchmarkFit * 22 + rarityBonus);
}

export function buildAchievementTask(
  game: GameCatalogEntry,
  achievement: SteamAchievement,
  source: BenchmarkTask["source"] = "fixture"
): BenchmarkTask {
  const level = levelFromAchievementPercent(achievement.percent);
  const estimatedRuntimeMinutes = clamp(Math.round(level * 8 + (100 - achievement.percent) / 2), 10, 180);
  const suitabilityReport = evaluateAchievementSuitability(game, achievement, {
    estimatedRuntimeMinutes,
    flags: {
      longHorizon: estimatedRuntimeMinutes > 150
    }
  });
  return {
    id: `${game.appid}:${achievement.apiName}`,
    appid: game.appid,
    gameName: game.name,
    title: achievement.displayName,
    track: "achievement",
    level,
    score: taskScore(level, game.benchmarkFit, achievement.percent),
    objective: `Unlock "${achievement.displayName}" in ${game.name}.`,
    proof: [
      "Steam achievement state for the linked SteamID",
      "Run metadata with appid, agent/human identity, and timestamp",
      "Video capture artifact when the task is attempted by an agent runtime"
    ],
    estimatedRuntimeMinutes,
    suitability: suitabilityForAchievement(achievement.percent),
    suitabilityScore: suitabilityReport.score,
    reviewRequired: suitabilityReport.reviewRequired,
    fairnessVerdict: suitabilityReport.fairness.verdict,
    riskFlags: suitabilityReport.activeRisks.map((risk) => risk.flag),
    achievementPercent: achievement.percent,
    source
  };
}

export function suitabilityForRating(rating: ReturnType<typeof evaluateBenchmarkSuitability>["rating"]): BenchmarkTask["suitability"] {
  if (rating === "recommended") return "ranked";
  if (rating === "usable-with-review") return "expert";
  return "needs-review";
}

export function buildSeededBenchmarkTask(seed: BenchmarkTaskSeed, source: BenchmarkTask["source"] = "manual"): BenchmarkTask {
  const game = gameCatalog.find((entry) => entry.appid === seed.appid);
  if (!game) {
    throw new Error(`No game catalog entry for seeded benchmark task ${seed.appid}:${seed.key}`);
  }
  const suitabilityReport = evaluateBenchmarkSuitability({
    track: seed.track,
    benchmarkFit: game.benchmarkFit,
    harnessRisk: game.harnessRisk,
    estimatedRuntimeMinutes: seed.estimatedRuntimeMinutes,
    flags: Object.fromEntries((seed.riskFlags ?? []).map((flag) => [flag, true]))
  });

  const score = Math.round(seed.level * 650 + game.benchmarkFit * 18 + suitabilityReport.score * 16);

  return {
    id: `${seed.appid}:${seed.key}`,
    appid: seed.appid,
    gameName: game.name,
    title: seed.title,
    track: seed.track,
    level: seed.level,
    score,
    objective: seed.objective,
    proof: seed.proof,
    estimatedRuntimeMinutes: seed.estimatedRuntimeMinutes,
    suitability: suitabilityForRating(suitabilityReport.rating),
    suitabilityScore: suitabilityReport.score,
    reviewRequired: suitabilityReport.reviewRequired,
    fairnessVerdict: suitabilityReport.fairness.verdict,
    riskFlags: suitabilityReport.activeRisks.map((risk) => risk.flag),
    source,
    signalSource: seed.signalSource,
    metricName: seed.metricName,
    targetValue: seed.targetValue,
    scoringRule: seed.scoringRule
  };
}

export type ManualBenchmarkTaskInput = {
  key?: string;
  title: string;
  track: Exclude<BenchmarkTrack, "achievement">;
  level: number;
  targetValue: string;
  metricName: string;
  objective: string;
  proof?: string[];
  estimatedRuntimeMinutes: number;
  scoringRule: string;
  signalSource?: BenchmarkSignalSource;
  riskFlags?: string[];
};

const manualTrackPrefixes: Record<ManualBenchmarkTaskInput["track"], string> = {
  capture: "CAP",
  leaderboard: "LDRB",
  stat: "STAT"
};

const manualSignalSources: Record<ManualBenchmarkTaskInput["track"], BenchmarkSignalSource> = {
  capture: "run-capture",
  leaderboard: "steam-leaderboard",
  stat: "steam-stat"
};

function manualTaskKey(input: Pick<ManualBenchmarkTaskInput, "key" | "title" | "track">): string {
  if (input.key?.trim()) return input.key.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, "_").slice(0, 80);
  const titleKey = input.title
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `${manualTrackPrefixes[input.track]}.${titleKey || "PROPOSED_TASK"}`;
}

function statApiKey(apiName: string): string {
  const key = apiName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  return `STAT.${key || "STEAM_STAT"}`;
}

function metricNameFromStat(apiName: string): string {
  return apiName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "steam_stat";
}

function titleFromStat(stat: SteamStatDefinition): string {
  const displayName = stat.displayName?.trim();
  if (displayName) return displayName;
  return stat.apiName
    .trim()
    .replace(/[_./-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) || "Steam Stat";
}

function riskFlagsForStat(stat: SteamStatDefinition): string[] {
  const text = `${stat.apiName} ${stat.displayName ?? ""}`.toLowerCase();
  const flags = new Set<string>();
  if (/(total|lifetime|career|all[_\s-]?time|unlocked|collected|completed|shipped)/.test(text)) {
    flags.add("longHorizon");
    flags.add("grind");
  }
  return [...flags];
}

function levelForStat(stat: SteamStatDefinition, index: number): number {
  const text = `${stat.apiName} ${stat.displayName ?? ""}`.toLowerCase();
  const base = /(best|score|highest|kills|survival|clear|time)/.test(text) ? 5 : 4;
  const longHorizonPenalty = riskFlagsForStat(stat).length > 0 ? 1 : 0;
  return clamp(base + Math.min(3, Math.floor(index / 4)) + longHorizonPenalty, 3, 8);
}

function leaderboardApiKey(leaderboard: SteamLeaderboardDefinition): string {
  const base = (leaderboard.name || leaderboard.id)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  return `LDRB.${base || "STEAM_LEADERBOARD"}`;
}

function metricNameFromLeaderboard(leaderboard: SteamLeaderboardDefinition): string {
  return (leaderboard.name || leaderboard.id)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "steam_leaderboard_score";
}

function titleFromLeaderboard(leaderboard: SteamLeaderboardDefinition): string {
  const displayName = leaderboard.displayName?.trim();
  if (displayName) return displayName;
  return leaderboard.name
    .trim()
    .replace(/[_./-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) || `Leaderboard ${leaderboard.id}`;
}

function leaderboardLowerIsBetter(leaderboard: SteamLeaderboardDefinition): boolean {
  const sort = leaderboard.sortMethod?.toLowerCase();
  const display = leaderboard.displayType?.toLowerCase();
  const name = `${leaderboard.name} ${leaderboard.displayName ?? ""}`.toLowerCase();
  return sort === "ascending" || display?.includes("time") === true || /(time|speedrun|fast|least|low)/.test(name);
}

function riskFlagsForLeaderboard(leaderboard: SteamLeaderboardDefinition): string[] {
  const text = `${leaderboard.name} ${leaderboard.displayName ?? ""}`.toLowerCase();
  const flags = new Set<string>(["leaderboardSnapshot"]);
  if (leaderboard.onlyFriendsReads) flags.add("limitedVisibility");
  if (/(daily|weekly|season|event|festival)/.test(text)) flags.add("seasonal");
  if (/(global|lifetime|total|all[_\s-]?time)/.test(text)) flags.add("longHorizon");
  return [...flags];
}

function levelForLeaderboard(leaderboard: SteamLeaderboardDefinition, index: number): number {
  const text = `${leaderboard.name} ${leaderboard.displayName ?? ""}`.toLowerCase();
  const base = /(challenge|seed|ranked|ascension|heat|speedrun)/.test(text) ? 6 : 5;
  return clamp(base + Math.min(3, Math.floor(index / 3)), 4, 9);
}

export function buildSteamStatMetricProposals(
  game: GameCatalogEntry,
  stats: SteamStatDefinition[],
  options: { limit?: number } = {}
): ManualBenchmarkTaskInput[] {
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(50, Math.floor(options.limit ?? 12))) : 12;
  const seen = new Set<string>();
  return stats
    .map((stat) => ({
      ...stat,
      apiName: stat.apiName.trim()
    }))
    .filter((stat) => stat.apiName.length > 0)
    .filter((stat) => {
      const key = statApiKey(stat.apiName);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((stat, index) => {
      const title = titleFromStat(stat);
      const metricName = metricNameFromStat(stat.apiName);
      const riskFlags = riskFlagsForStat(stat);
      return {
        key: statApiKey(stat.apiName),
        title,
        track: "stat",
        level: levelForStat(stat, index),
        targetValue: `best verified ${title.toLowerCase()}`,
        metricName,
        objective: `Maximize verified ${title} in ${game.name} during a controlled benchmark run.`,
        proof: [
          "Steam stat schema field mapped to the benchmark metric contract.",
          "Score, stat, save, replay, or capture evidence proving the final metric value.",
          "Canonical output.mp4 artifact for benchmark review."
        ],
        estimatedRuntimeMinutes: clamp(12 + levelForStat(stat, index) * 4 + (riskFlags.length > 0 ? 12 : 0), 12, 60),
        scoringRule: `Rank higher verified ${metricName} higher; ties break by shorter wall-clock time.`,
        signalSource: "steam-stat",
        riskFlags
      };
    });
}

export function buildSteamLeaderboardMetricProposals(
  game: GameCatalogEntry,
  leaderboards: SteamLeaderboardDefinition[],
  options: { limit?: number } = {}
): ManualBenchmarkTaskInput[] {
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(50, Math.floor(options.limit ?? 12))) : 12;
  const seen = new Set<string>();
  return leaderboards
    .map((leaderboard) => ({
      ...leaderboard,
      id: String(leaderboard.id).trim(),
      name: leaderboard.name.trim()
    }))
    .filter((leaderboard) => leaderboard.id.length > 0 && leaderboard.name.length > 0)
    .filter((leaderboard) => {
      const key = leaderboardApiKey(leaderboard);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((leaderboard, index) => {
      const title = titleFromLeaderboard(leaderboard);
      const metricName = metricNameFromLeaderboard(leaderboard);
      const lowerIsBetter = leaderboardLowerIsBetter(leaderboard);
      const riskFlags = riskFlagsForLeaderboard(leaderboard);
      const rankingPhrase = lowerIsBetter ? "lower verified value" : "higher verified score";
      return {
        key: leaderboardApiKey(leaderboard),
        title,
        track: "leaderboard",
        level: levelForLeaderboard(leaderboard, index),
        targetValue: `${rankingPhrase} on a frozen ${title.toLowerCase()} ruleset`,
        metricName,
        objective: `Compete on ${game.name} leaderboard "${title}" using a frozen build, seed, ruleset, and evidence window.`,
        proof: [
          "Steam leaderboard metadata mapped to a frozen benchmark contract.",
          "Scoreboard, replay, save, or capture evidence proving the final leaderboard metric.",
          "Canonical output.mp4 artifact for benchmark review."
        ],
        estimatedRuntimeMinutes: clamp(18 + levelForLeaderboard(leaderboard, index) * 5 + (riskFlags.includes("seasonal") ? 8 : 0), 18, 90),
        scoringRule: lowerIsBetter
          ? `Rank lower verified ${metricName} higher; ties break by earlier completion timestamp.`
          : `Rank higher verified ${metricName} higher; ties break by shorter wall-clock time.`,
        signalSource: "steam-leaderboard",
        riskFlags
      };
    });
}

export function buildManualBenchmarkTask(
  game: GameCatalogEntry,
  input: ManualBenchmarkTaskInput,
  source: BenchmarkTask["source"] = "manual"
): BenchmarkTask {
  const level = clamp(Math.floor(input.level), 1, 10);
  const estimatedRuntimeMinutes = clamp(Math.round(input.estimatedRuntimeMinutes), 5, 360);
  const activeRiskFlags = new Set(input.riskFlags ?? []);
  const suitabilityReport = evaluateBenchmarkSuitability({
    track: input.track,
    benchmarkFit: game.benchmarkFit,
    harnessRisk: game.harnessRisk,
    estimatedRuntimeMinutes,
    flags: {
      grind: activeRiskFlags.has("grind"),
      multiplayer: activeRiskFlags.has("multiplayer"),
      dlc: activeRiskFlags.has("dlc"),
      seasonal: activeRiskFlags.has("seasonal"),
      antiCheat: activeRiskFlags.has("antiCheat"),
      longHorizon: activeRiskFlags.has("longHorizon")
    }
  });
  const score = Math.round(level * 650 + game.benchmarkFit * 18 + suitabilityReport.score * 16);

  return {
    id: `${game.appid}:${manualTaskKey(input)}`,
    appid: game.appid,
    gameName: game.name,
    title: input.title.trim(),
    track: input.track,
    level,
    score,
    objective: input.objective.trim(),
    proof: input.proof?.length
      ? input.proof
      : [
          "Score screen, stat screen, replay, save state, or capture segment that proves the metric.",
          "Run metadata with appid, build, competitor identity, and timestamp.",
          "Canonical output.mp4 artifact for benchmark review."
        ],
    estimatedRuntimeMinutes,
    suitability: suitabilityForRating(suitabilityReport.rating),
    suitabilityScore: suitabilityReport.score,
    reviewRequired: suitabilityReport.reviewRequired,
    fairnessVerdict: suitabilityReport.fairness.verdict,
    riskFlags: suitabilityReport.activeRisks.map((risk) => risk.flag),
    source,
    signalSource: input.signalSource ?? manualSignalSources[input.track],
    metricName: input.metricName.trim(),
    targetValue: input.targetValue.trim(),
    scoringRule: input.scoringRule.trim()
  };
}

export function buildFixtureTasks(): BenchmarkTask[] {
  const achievementTasks = gameCatalog.flatMap((game) =>
    (achievementFixtures[game.appid] ?? []).map((achievement) => buildAchievementTask(game, achievement))
  );
  return [...achievementTasks, ...benchmarkTaskSeeds.map((seed) => buildSeededBenchmarkTask(seed))];
}

export function buildTasksForGame(
  appid: number,
  achievements: SteamAchievement[],
  source: BenchmarkTask["source"] = "steam-live"
): BenchmarkTask[] {
  const game = gameCatalog.find((entry) => entry.appid === appid);
  if (!game) return [];
  return buildTasksForGameEntry(game, achievements, source);
}

export function buildTasksForGameEntry(
  game: GameCatalogEntry,
  achievements: SteamAchievement[],
  source: BenchmarkTask["source"] = "steam-live"
): BenchmarkTask[] {
  return achievements.map((achievement) => buildAchievementTask(game, achievement, source));
}

export function inferGameCatalogEntry(input: {
  appid: number;
  name?: string;
  benchmarkFit?: number;
  harnessRisk?: GameCatalogEntry["harnessRisk"];
}): GameCatalogEntry {
  const known = gameCatalog.find((entry) => entry.appid === input.appid);
  if (known) return known;

  return {
    appid: input.appid,
    name: input.name?.trim() || `Steam App ${input.appid}`,
    capsuleUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${input.appid}/capsule_616x353.jpg`,
    headerUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${input.appid}/header.jpg`,
    tracks: ["achievement", "capture"],
    genres: ["Imported"],
    harnessRisk: input.harnessRisk ?? "medium",
    benchmarkFit: input.benchmarkFit ?? 70,
    notes: "Imported from Steam achievement metadata; requires benchmark review before ranked publication."
  };
}
