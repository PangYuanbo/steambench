// TS mirror of engine/steambench/difficulty.py. The information-theoretic
// difficulty model: rarity -> bits (surprisal) -> tier + points. Kept in sync
// with the Python engine (the canonical implementation for offline ingest).

import type { Tier } from "./types";

export const MIN_RARITY = 1e-4;
export const POINTS_PER_BIT = 100.0;
export const MIN_POINTS = 5;

const TIER_THRESHOLDS: [number, Tier][] = [
  [9.965784, "legendary"], // < 0.1%
  [6.643856, "elite"], // < 1%
  [4.321928, "hard"], // < 5%
  [2.321928, "medium"], // < 20%
  [1.0, "easy"], // < 50%
  [0.0, "tutorial"], // >= 50%
];

export const TIER_RANK: Record<Tier, number> = {
  tutorial: 0,
  easy: 1,
  medium: 2,
  hard: 3,
  elite: 4,
  legendary: 5,
};

/** Map an unlock fraction in [0,1] to difficulty in bits (-log2 rarity). */
export function rarityToBits(rarity: number): number {
  if (rarity == null || Number.isNaN(rarity)) rarity = MIN_RARITY;
  rarity = Math.min(Math.max(rarity, MIN_RARITY), 1.0);
  return -Math.log2(rarity);
}

export function bitsToTier(bits: number): Tier {
  for (const [threshold, tier] of TIER_THRESHOLDS) {
    if (bits >= threshold) return tier;
  }
  return "tutorial";
}

export function bitsToPoints(bits: number): number {
  return Math.max(MIN_POINTS, Math.round(POINTS_PER_BIT * bits));
}

export interface Difficulty {
  rarity: number;
  percent: number;
  bits: number;
  tier: Tier;
  tier_rank: number;
  points: number;
}

/** Build a Difficulty from a global unlock *percentage* (e.g. 4.2 for 4.2%). */
export function scoreAchievement(percent: number): Difficulty {
  const rarity = Math.min(Math.max(percent / 100.0, MIN_RARITY), 1.0);
  const bits = rarityToBits(rarity);
  const tier = bitsToTier(bits);
  return {
    rarity,
    percent,
    bits,
    tier,
    tier_rank: TIER_RANK[tier],
    points: bitsToPoints(bits),
  };
}

export const TIER_COLOR: Record<Tier, string> = {
  tutorial: "#7dd3fc", // sky
  easy: "#4ade80", // green
  medium: "#facc15", // yellow
  hard: "#fb923c", // orange
  elite: "#f87171", // red
  legendary: "#c084fc", // purple
};
