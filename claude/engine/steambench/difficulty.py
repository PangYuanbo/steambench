"""Rarity -> difficulty -> points.

The core idea of SteamBench
===========================
Steam publishes, for almost every game, the *global unlock percentage* of each
achievement: what fraction of all owners have ever unlocked it. That number is a
crowd-sourced difficulty signal collected from tens of millions of players. An
achievement only 0.4% of players have is, empirically, ~200x "harder" to obtain
than one 80% of players have.

We turn that into a calibrated benchmark difficulty using **information theory**.
If a fraction ``p`` of players unlock an achievement, observing a given player
unlock it carries

    bits = -log2(p)      (Shannon self-information / "surprisal")

bits of surprise. This has properties that make it an excellent difficulty unit:

* It is monotonic in rarity (rarer -> harder) and unbounded above.
* It is *additive* for independent objectives: completing two unrelated
  achievements that each 10% of players get is "as surprising" as one that
  1% get (-log2(0.1) + -log2(0.1) = -log2(0.01)). So summing bits across a
  game gives a meaningful "total information required to 100% this game".
* It maps cleanly to human-legible tiers (each tier ~ a halving of the
  population), and to a points economy that rewards rarity linearly in bits.

This module is pure, deterministic, dependency-free and unit-tested. It is the
one piece of SteamBench that must never be "vibes": every downstream number
(task points, leaderboard, Human-vs-AI Elo seeding) flows from here.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum

# --------------------------------------------------------------------------- #
# Tunable constants. These are the only "policy" knobs in the difficulty model.
# --------------------------------------------------------------------------- #

#: Rarity floor. Steam reports 0.0% for achievements no one (or almost no one)
#: has unlocked, and for brand-new games. We clamp to 0.01% so a single
#: ultra-rare achievement can't produce infinite bits/points. 0.01% -> ~13.3 bits.
MIN_RARITY = 1e-4

#: Points awarded per bit of difficulty. A 50%-unlock achievement (1 bit) is
#: worth 100 points; a 0.1% achievement (~9.97 bits) is worth ~997 points.
POINTS_PER_BIT = 100.0

#: Floor so that even a trivial "press start" achievement is worth something,
#: which keeps tutorial tasks from being literally zero-value.
MIN_POINTS = 5


class Tier(str, Enum):
    """Human-legible difficulty bands.

    Each step up is roughly a halving (or more) of the player population that
    reaches it. The string values double as stable API/DB identifiers and as
    CSS class hooks on the frontend.
    """

    TUTORIAL = "tutorial"      # >50% of players      (<1 bit)
    EASY = "easy"              # 20%-50%              (1 - 2.322 bits)
    MEDIUM = "medium"          # 5%-20%               (2.322 - 4.322 bits)
    HARD = "hard"              # 1%-5%                (4.322 - 6.644 bits)
    ELITE = "elite"            # 0.1%-1%              (6.644 - 9.966 bits)
    LEGENDARY = "legendary"    # <0.1%                (>=9.966 bits)

    @property
    def rank(self) -> int:
        """0..5 ordinal, handy for sorting and color ramps."""
        return _TIER_ORDER[self]

    @property
    def label(self) -> str:
        return {
            Tier.TUTORIAL: "Tutorial",
            Tier.EASY: "Easy",
            Tier.MEDIUM: "Medium",
            Tier.HARD: "Hard",
            Tier.ELITE: "Elite",
            Tier.LEGENDARY: "Legendary",
        }[self]


_TIER_ORDER = {
    Tier.TUTORIAL: 0,
    Tier.EASY: 1,
    Tier.MEDIUM: 2,
    Tier.HARD: 3,
    Tier.ELITE: 4,
    Tier.LEGENDARY: 5,
}

# Lower bound (inclusive) in bits for each tier, walked high -> low.
_TIER_BITS_THRESHOLDS = [
    (9.965784, Tier.LEGENDARY),   # rarity < 0.1%
    (6.643856, Tier.ELITE),       # rarity < 1%
    (4.321928, Tier.HARD),        # rarity < 5%
    (2.321928, Tier.MEDIUM),      # rarity < 20%
    (1.0, Tier.EASY),             # rarity < 50%
    (0.0, Tier.TUTORIAL),         # rarity >= 50%
]


@dataclass(frozen=True)
class AchievementDifficulty:
    """Everything the rest of the system needs to know about how hard one
    achievement is. Immutable so it can be safely cached and shared."""

    rarity: float          #: fraction in (0, 1] of players who unlocked it
    bits: float            #: -log2(clamped rarity), the difficulty unit
    tier: Tier             #: human-legible band
    points: int            #: benchmark points awarded for obtaining it

    @property
    def percent(self) -> float:
        """Global unlock percentage, e.g. 4.2 for a 4.2% achievement."""
        return self.rarity * 100.0

    def as_dict(self) -> dict:
        return {
            "rarity": self.rarity,
            "percent": round(self.percent, 4),
            "bits": round(self.bits, 4),
            "tier": self.tier.value,
            "tier_rank": self.tier.rank,
            "points": self.points,
        }


def rarity_to_bits(rarity: float) -> float:
    """Map an unlock fraction in [0, 1] to difficulty in bits.

    ``rarity`` is a *fraction* (0.05 == 5% of players). Values <= 0 or absurd
    are clamped to ``MIN_RARITY``; values > 1 (shouldn't happen) clamp to 1.
    """
    if rarity is None or math.isnan(rarity):
        rarity = MIN_RARITY
    rarity = min(max(rarity, MIN_RARITY), 1.0)
    return -math.log2(rarity)


def bits_to_tier(bits: float) -> Tier:
    """Bucket a difficulty (in bits) into a :class:`Tier`."""
    for threshold, tier in _TIER_BITS_THRESHOLDS:
        if bits >= threshold:
            return tier
    return Tier.TUTORIAL


def bits_to_points(bits: float) -> int:
    """Convert difficulty in bits to integer benchmark points."""
    return max(MIN_POINTS, round(POINTS_PER_BIT * bits))


def score_achievement(percent: float) -> AchievementDifficulty:
    """Build an :class:`AchievementDifficulty` from a global unlock *percentage*.

    Args:
        percent: global unlock percentage as Steam reports it (e.g. ``4.2`` for
            an achievement 4.2% of owners have). Accepts ints, floats, or
            numeric strings.

    This is the single entry point ingestion uses per achievement.
    """
    p = float(percent)
    rarity = p / 100.0
    bits = rarity_to_bits(rarity)
    return AchievementDifficulty(
        rarity=min(max(rarity, MIN_RARITY), 1.0),
        bits=bits,
        tier=bits_to_tier(bits),
        points=bits_to_points(bits),
    )


def percentile_to_bits(percentile: float) -> float:
    """Difficulty (bits) for a *leaderboard* result expressed as a top-percentile.

    Many Steam games rank players on numeric leaderboards (fastest time, highest
    score) rather than boolean achievements. We treat "being in the top X% of
    the leaderboard" exactly like "an achievement X% of players reach": the
    surprisal is identical, so the two task kinds live on one common bits scale.

    Args:
        percentile: where the result lands, in (0, 100]. ``1.0`` means "top 1%".
    """
    return rarity_to_bits(percentile / 100.0)
