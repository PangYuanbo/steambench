/**
 * Achievement taxonomy — *which* achievements make good benchmark tasks.
 *
 * Rarity tells you how hard an achievement is to get; it does NOT tell you
 * *why* it's rare. A benchmark wants achievements whose difficulty comes from
 * **skill** — the kind a better player (or agent) is meaningfully more likely to
 * earn — not from time invested, collection grind, multiplayer luck, or simply
 * finishing the story. This module classifies each achievement from its name +
 * description + global rarity and derives a `benchmarkGrade` (0–1).
 *
 * It is deliberately a transparent *signal*, not authoritative scoring: the
 * leaderboard still scores by −log₂(rarity) bits. This lens just answers "of all
 * these achievements, which ones actually test ability?" — surfaced on the atlas
 * so the benchmark's task design is legible.
 */

export type TaskType = "skill" | "progression" | "grind" | "social" | "misc";

export interface TaskClass {
  type: TaskType;
  benchmarkGrade: number; // 0..1 — how well this achievement discriminates skill
  reason: string;
}

export const TYPE_LABEL: Record<TaskType, string> = {
  skill: "Skill",
  progression: "Progression",
  grind: "Grind",
  social: "Social / luck",
  misc: "Misc",
};

export const TYPE_COLOR: Record<TaskType, string> = {
  skill: "var(--color-ai)",
  progression: "var(--color-faint)",
  grind: "var(--color-warn)",
  social: "var(--color-accent)",
  misc: "var(--color-muted)",
};

// --- signal lexicons (lowercased substring / word tests) ------------------- //

// Difficulty constraints + mastery: the hallmark of a skill challenge.
const SKILL = [
  "without", "no damage", "no-hit", "without taking", "deathless", "no death",
  "flawless", "perfect", "perfectly", "hardcore", "permadeath", "ironman",
  "speedrun", "speed run", "under ", "less than ", "in under", "within ",
  "only ", "solo", "no upgrades", "no items", "pacifist", "highest difficulty",
  "hardest difficulty", "on nightmare", "nightmare difficulty", "on hard",
  "without dying", "don't get hit", "do not get hit", "no continues",
  "one life", "single life", "combo", "no healing", "untouchable", "master ",
  "s rank", "s-rank", "rank s", "gold medal", "all bosses", "boss rush",
];

// Time-gated / collection / repetition: persistence, not skill.
const GRIND = [
  "collect", "collection", "gather", "find all", "unlock all", "complete all",
  "every ", "all of", "100%", "1000", "10000", "100,000", "grind", "hours",
  "days", "earn ", "accumulate", "total of", "reach level", "max level",
  "level 50", "level 99", "level 100", "craft ", "harvest", "mine ",
  "play for", "log in", "daily",
];

// Multiplayer / online / chance: confounded by other players or luck.
const SOCIAL = [
  "multiplayer", "online", "co-op", "co op", "cooperative", "versus", "pvp",
  "vs.", "win a match", "win a game online", "defeat a player", "defeat another",
  "trade", "friend", "party", "lucky", "by chance", "random", "gamble",
  "ranked match", "matchmaking", "leaderboard",
];

// Story / campaign progression: most engaged players reach these.
const PROGRESSION = [
  "complete chapter", "finish chapter", "chapter ", "episode ", "act ",
  "prologue", "epilogue", "tutorial", "the story", "main story", "campaign",
  "beat the game", "finish the game", "complete the game", "reach the end",
  "credits", "ending", "first ", "begin", "start ", "reach ", "arrive",
  "discover", "meet ", "unlock the", "complete the first",
];

function hits(text: string, lex: string[]): boolean {
  return lex.some((k) => text.includes(k));
}

/**
 * Classify one achievement. `rarity` is the global unlock fraction (0..1).
 */
export function classifyAchievement(
  name: string,
  description: string,
  rarity: number
): TaskClass {
  const t = `${name} ${description}`.toLowerCase();
  const r = Math.min(Math.max(rarity, 0), 1);

  // Precedence: skill > social > grind > progression > misc. Skill constraints
  // are the strongest signal; a "win online without taking damage" is still a
  // skill task even though it's also social.
  let type: TaskType = "misc";
  if (hits(t, SKILL)) type = "skill";
  else if (hits(t, SOCIAL)) type = "social";
  else if (hits(t, GRIND)) type = "grind";
  else if (hits(t, PROGRESSION)) type = "progression";
  else {
    // No lexical signal: lean on rarity. Very rare + no grind/story words often
    // means an implicit skill feat; very common means trivial progression.
    if (r > 0 && r < 0.05) type = "skill";
    else if (r >= 0.4) type = "progression";
    else type = "misc";
  }

  // Discrimination band: a skill task is most useful when it's hard but humanly
  // achievable (~0.5%–25%). Sub-0.1% often tips into luck/grind; >40% is easy.
  const band = bandScore(r);
  const base: Record<TaskType, number> = {
    skill: 0.82,
    misc: 0.45,
    progression: 0.22,
    grind: 0.18,
    social: 0.15,
  };
  let grade = base[type];
  if (type === "skill" || type === "misc") {
    grade = grade * 0.55 + band * 0.45; // reward the discriminating band
  } else {
    grade = grade * 0.85 + band * 0.15; // band matters less for non-skill
  }
  grade = Math.round(Math.min(1, Math.max(0, grade)) * 1000) / 1000;

  return { type, benchmarkGrade: grade, reason: reasonFor(type, r) };
}

// Peaks (~1.0) in the 0.5%–25% "discriminates ability" window; falls off for
// trivial (common) and lottery-rare (often luck/grind) achievements.
function bandScore(r: number): number {
  if (r <= 0) return 0.4; // unknown / 0% measured yet
  const p = r * 100; // percent
  if (p >= 0.5 && p <= 25) return 1;
  if (p < 0.5) return Math.max(0.35, p / 0.5); // 0..0.5% ramps up
  if (p <= 50) return Math.max(0.2, 1 - (p - 25) / 25); // 25..50% ramps down
  return 0.12; // >50% trivial
}

function reasonFor(type: TaskType, r: number): string {
  const pct = r > 0 ? `${(r * 100).toFixed(r < 1 ? 2 : 0)}% unlock` : "no rarity yet";
  switch (type) {
    case "skill":
      return `Skill constraint — difficulty is the challenge, not time (${pct}).`;
    case "grind":
      return `Collection/time-gated — measures persistence over ability (${pct}).`;
    case "social":
      return `Multiplayer/luck — confounded by other players (${pct}).`;
    case "progression":
      return `Story progression — most engaged players reach it (${pct}).`;
    default:
      return `Uncategorised — rarity is the only signal (${pct}).`;
  }
}
