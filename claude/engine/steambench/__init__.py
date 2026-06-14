"""SteamBench engine.

The scoring brain of SteamBench. Turns raw Steam data (global achievement
unlock rates, leaderboard distributions) into a principled, information-theoretic
benchmark that humans and AI agents are scored on with the *same* yardstick.

Public surface:
    difficulty  -- rarity -> difficulty (bits) -> tier -> points model
    scoring     -- per-player / per-game scoring + Human-vs-AI Elo
    catalog     -- Task / Game / Achievement data model
"""

from .difficulty import (
    Tier,
    AchievementDifficulty,
    rarity_to_bits,
    bits_to_tier,
    bits_to_points,
    score_achievement,
)
from .catalog import Achievement, Game, Task, TaskKind
from .scoring import (
    PlayerKind,
    GameScore,
    PlayerStanding,
    score_game,
    aggregate_player,
    elo_update,
    HumanVsAI,
)

__version__ = "0.1.0"

__all__ = [
    "Tier",
    "AchievementDifficulty",
    "rarity_to_bits",
    "bits_to_tier",
    "bits_to_points",
    "score_achievement",
    "Achievement",
    "Game",
    "Task",
    "TaskKind",
    "PlayerKind",
    "GameScore",
    "PlayerStanding",
    "score_game",
    "aggregate_player",
    "elo_update",
    "HumanVsAI",
]
