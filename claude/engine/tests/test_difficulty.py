import math

import pytest

from steambench.difficulty import (
    Tier,
    rarity_to_bits,
    bits_to_tier,
    score_achievement,
    percentile_to_bits,
    MIN_RARITY,
)


def test_bits_are_surprisal():
    assert rarity_to_bits(0.5) == pytest.approx(1.0)
    assert rarity_to_bits(0.25) == pytest.approx(2.0)
    assert rarity_to_bits(0.01) == pytest.approx(6.6438, abs=1e-3)
    assert rarity_to_bits(1.0) == pytest.approx(0.0)


def test_bits_are_additive():
    # Two independent 10% achievements == one 1% achievement, in bits.
    assert rarity_to_bits(0.1) + rarity_to_bits(0.1) == pytest.approx(
        rarity_to_bits(0.01)
    )


def test_rarity_clamped_and_finite():
    # 0% (no unlocks) must not produce infinite difficulty.
    b = rarity_to_bits(0.0)
    assert math.isfinite(b)
    assert b == pytest.approx(-math.log2(MIN_RARITY))
    # Out-of-range high values clamp to 0 bits.
    assert rarity_to_bits(2.0) == pytest.approx(0.0)


def test_tier_boundaries():
    assert bits_to_tier(0.5) is Tier.TUTORIAL          # 70%-ish
    assert bits_to_tier(1.5) is Tier.EASY              # ~35%
    assert bits_to_tier(3.0) is Tier.MEDIUM            # ~12%
    assert bits_to_tier(5.0) is Tier.HARD              # ~3%
    assert bits_to_tier(8.0) is Tier.ELITE             # ~0.4%
    assert bits_to_tier(11.0) is Tier.LEGENDARY        # ~0.05%


def test_tier_monotonic_with_rarity():
    ranks = [bits_to_tier(rarity_to_bits(p)).rank for p in [0.9, 0.3, 0.1, 0.02, 0.005, 0.0005]]
    assert ranks == sorted(ranks)  # rarer -> higher (or equal) tier


def test_points_scale_with_difficulty():
    easy = score_achievement(50.0)    # 1 bit
    legendary = score_achievement(0.1)  # ~9.97 bits
    assert easy.points == 100
    assert legendary.points > 900
    assert legendary.points > easy.points * 8


def test_points_have_floor():
    trivial = score_achievement(99.9)
    assert trivial.points >= 5


def test_score_achievement_accepts_strings():
    # Steam reports percents as strings like "82.1".
    d = score_achievement("82.1")
    assert d.tier is Tier.TUTORIAL
    assert d.percent == pytest.approx(82.1)


def test_real_hades_values():
    # Real numbers pulled from the public Steam endpoint.
    clear_tartarus = score_achievement(82.1)   # very common
    assert clear_tartarus.tier is Tier.TUTORIAL
    # A sub-1% completionist achievement should be elite/legendary.
    assert score_achievement(0.6).tier in (Tier.ELITE, Tier.LEGENDARY)


def test_leaderboard_percentile_shares_scale():
    # Top 1% of a leaderboard == a 1%-rarity achievement, in bits.
    assert percentile_to_bits(1.0) == pytest.approx(rarity_to_bits(0.01))
