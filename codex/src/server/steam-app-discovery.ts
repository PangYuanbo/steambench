import { achievementFixtures, gameCatalog } from "../benchmark/catalog";
import type { BenchmarkTask } from "../benchmark/types";
import type { SteamAppSummary } from "../steam/steam-client";
import type { SteamAppDiscoveryCandidate } from "./store";

const highRiskTerms = ["multiplayer", "online", "mmo", "battle royale", "vr", "demo", "server"];
const lowRiskTerms = ["portal", "puzzle", "slay", "balatro", "vampire", "hades", "stardew", "roguelike", "deck", "survivor"];

function inferHarnessRisk(name: string, known?: (typeof gameCatalog)[number]): SteamAppDiscoveryCandidate["harnessRisk"] {
  if (known) return known.harnessRisk;
  const normalized = name.toLowerCase();
  if (highRiskTerms.some((term) => normalized.includes(term))) return "high";
  if (lowRiskTerms.some((term) => normalized.includes(term))) return "low";
  return "medium";
}

function inferBenchmarkFit(name: string, known?: (typeof gameCatalog)[number]): number {
  if (known) return known.benchmarkFit;
  const normalized = name.toLowerCase();
  const lowRiskBonus = lowRiskTerms.some((term) => normalized.includes(term)) ? 12 : 0;
  const highRiskPenalty = highRiskTerms.some((term) => normalized.includes(term)) ? 22 : 0;
  return Math.max(35, Math.min(86, 68 + lowRiskBonus - highRiskPenalty));
}

function inferTracks(known?: (typeof gameCatalog)[number]): BenchmarkTask["track"][] {
  return known?.tracks ?? ["achievement", "capture"];
}

function reasonsFor(input: {
  app: SteamAppSummary;
  known?: (typeof gameCatalog)[number];
  benchmarkFit: number;
  achievementCount: number;
  harnessRisk: SteamAppDiscoveryCandidate["harnessRisk"];
}): string[] {
  return [
    input.known ? "Already has a curated Steam game profile." : "Discovered from Steam app catalog search.",
    `${input.achievementCount} achievement fixture(s) or live achievement candidates can seed levels.`,
    `Benchmark fit estimate ${input.benchmarkFit}/100 with ${input.harnessRisk} harness risk.`
  ];
}

function riskNotesFor(harnessRisk: SteamAppDiscoveryCandidate["harnessRisk"]): string[] {
  if (harnessRisk === "low") return ["Low harness risk; good candidate for early agent runtime testing."];
  if (harnessRisk === "high") return ["High harness risk; require manual review before importing ranked tasks."];
  return ["Medium harness risk; import as reviewable candidates first."];
}

export function buildSteamAppDiscoveryCandidates(input: {
  apps: SteamAppSummary[];
  query: string;
  source: SteamAppDiscoveryCandidate["source"];
}): Array<Omit<SteamAppDiscoveryCandidate, "id" | "status" | "discoveredAt" | "updatedAt">> {
  const seen = new Set<number>();
  return input.apps
    .filter((app) => {
      if (seen.has(app.appid)) return false;
      seen.add(app.appid);
      return app.name.trim().length > 0;
    })
    .map((app) => {
      const known = gameCatalog.find((entry) => entry.appid === app.appid);
      const achievementCount = achievementFixtures[app.appid]?.length ?? 0;
      const harnessRisk = inferHarnessRisk(app.name, known);
      const benchmarkFit = inferBenchmarkFit(app.name, known);
      return {
        appid: app.appid,
        name: known?.name ?? app.name,
        query: input.query,
        source: input.source,
        benchmarkFit,
        harnessRisk,
        tracks: inferTracks(known),
        estimatedAchievementTasks: achievementCount,
        reasons: reasonsFor({ app, known, benchmarkFit, achievementCount, harnessRisk }),
        riskNotes: riskNotesFor(harnessRisk),
        reviewNotes: known ? "Curated catalog match; safe to shortlist for local smoke." : "Steam app search candidate; requires achievement import review."
      };
    })
    .sort((a, b) => b.benchmarkFit - a.benchmarkFit || b.estimatedAchievementTasks - a.estimatedAchievementTasks || a.name.localeCompare(b.name));
}

export function searchFixtureSteamApps(query: string, limit = 20): SteamAppSummary[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return gameCatalog
    .filter((game) => `${game.name} ${game.genres.join(" ")}`.toLowerCase().includes(normalized))
    .map((game) => ({ appid: game.appid, name: game.name }))
    .slice(0, limit);
}
