"""Player scoring and the Human-vs-AI ranking.

Two questions SteamBench answers, with one consistent yardstick:

1. *How good is this player (human OR agent) at this game / overall?*
   -> sum of difficulty points for objectives they've completed, plus a
   normalized 0..1 "mastery" of each game (earned bits / total bits).

2. *Are humans or AI better -- head to head?*
   -> an Elo rating per player computed from per-game "matches". When a human
   and an agent have both attempted the same game, the one with more earned
   bits in that game wins the match. Elo is the headline Human-vs-AI number;
   raw points are the absolute one. Keeping both avoids the trap where a
   benchmark conflates "tried more games" with "is better".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable, Optional


class PlayerKind(str, Enum):
    HUMAN = "human"
    AGENT = "agent"


# --------------------------------------------------------------------------- #
# Per-game scoring
# --------------------------------------------------------------------------- #


@dataclass
class GameScore:
    """A player's standing on a single game."""

    appid: int
    earned_points: int
    earned_bits: float
    total_bits: float
    completed_tasks: int
    total_tasks: int

    @property
    def mastery(self) -> float:
        """0..1 fraction of the game's total difficulty the player has earned."""
        if self.total_bits <= 0:
            return 0.0
        return min(1.0, self.earned_bits / self.total_bits)

    @property
    def completion(self) -> float:
        """0..1 fraction of tasks completed (count-based, not difficulty-based)."""
        if self.total_tasks <= 0:
            return 0.0
        return self.completed_tasks / self.total_tasks

    def as_dict(self) -> dict:
        return {
            "appid": self.appid,
            "earned_points": self.earned_points,
            "earned_bits": round(self.earned_bits, 3),
            "total_bits": round(self.total_bits, 3),
            "completed_tasks": self.completed_tasks,
            "total_tasks": self.total_tasks,
            "mastery": round(self.mastery, 4),
            "completion": round(self.completion, 4),
        }


def score_game(
    completed_task_ids: Iterable[str],
    all_tasks: list,  # list[Task]
) -> GameScore:
    """Score one player on one game.

    Args:
        completed_task_ids: task_ids the player has completed.
        all_tasks: every Task for this game (from ``Game.tasks()``).
    """
    completed = set(completed_task_ids)
    appid = all_tasks[0].game_appid if all_tasks else 0
    earned_points = 0
    earned_bits = 0.0
    total_bits = 0.0
    done = 0
    for t in all_tasks:
        total_bits += t.bits
        if t.task_id in completed:
            earned_points += t.points
            earned_bits += t.bits
            done += 1
    return GameScore(
        appid=appid,
        earned_points=earned_points,
        earned_bits=earned_bits,
        total_bits=total_bits,
        completed_tasks=done,
        total_tasks=len(all_tasks),
    )


# --------------------------------------------------------------------------- #
# Overall standing
# --------------------------------------------------------------------------- #


@dataclass
class PlayerStanding:
    """A player's aggregate position across all games they've played."""

    player_id: str
    kind: PlayerKind
    total_points: int = 0
    weighted_score: float = 0.0    #: sum of mastery * popularity_weight * 1000
    games_played: int = 0
    tasks_completed: int = 0
    legendary_count: int = 0       #: # of <0.1% objectives obtained (bragging rights)
    elo: float = 1200.0
    per_game: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "player_id": self.player_id,
            "kind": self.kind.value,
            "total_points": self.total_points,
            "weighted_score": round(self.weighted_score, 2),
            "games_played": self.games_played,
            "tasks_completed": self.tasks_completed,
            "legendary_count": self.legendary_count,
            "elo": round(self.elo, 1),
            "per_game": {k: v.as_dict() for k, v in self.per_game.items()},
        }


def aggregate_player(
    player_id: str,
    kind: PlayerKind,
    game_scores: dict,            # {appid: GameScore}
    popularity_weights: Optional[dict] = None,   # {appid: float}
    legendary_counts: Optional[dict] = None,      # {appid: int}
) -> PlayerStanding:
    """Roll per-game scores up into a single standing."""
    popularity_weights = popularity_weights or {}
    legendary_counts = legendary_counts or {}
    st = PlayerStanding(player_id=player_id, kind=kind)
    for appid, gs in game_scores.items():
        if gs.completed_tasks == 0:
            continue
        st.total_points += gs.earned_points
        st.tasks_completed += gs.completed_tasks
        st.games_played += 1
        w = popularity_weights.get(appid, 1.0)
        st.weighted_score += gs.mastery * w * 1000.0
        st.legendary_count += legendary_counts.get(appid, 0)
        st.per_game[appid] = gs
    return st


# --------------------------------------------------------------------------- #
# Human vs AI: Elo
# --------------------------------------------------------------------------- #


def expected_score(rating_a: float, rating_b: float) -> float:
    """Standard logistic Elo expectation that A beats B."""
    return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / 400.0))


def elo_update(
    rating_a: float,
    rating_b: float,
    score_a: float,
    k: float = 32.0,
) -> tuple[float, float]:
    """One Elo match update.

    Args:
        score_a: 1.0 if A won, 0.0 if A lost, 0.5 for a draw.
    Returns:
        (new_rating_a, new_rating_b)
    """
    ea = expected_score(rating_a, rating_b)
    eb = 1.0 - ea
    new_a = rating_a + k * (score_a - ea)
    new_b = rating_b + k * ((1.0 - score_a) - eb)
    return new_a, new_b


def match_outcome(bits_a: float, bits_b: float, eps: float = 1e-9) -> float:
    """Convert two players' earned-bits on a shared game into an Elo result for
    A: 1.0 win / 0.5 draw / 0.0 loss."""
    if abs(bits_a - bits_b) <= eps:
        return 0.5
    return 1.0 if bits_a > bits_b else 0.0


@dataclass
class HumanVsAI:
    """The headline scoreboard: aggregate human vs aggregate AI.

    Tracks Elo for the two *camps* (all humans pooled, all agents pooled) by
    replaying every cross-camp per-game match, plus simple tallies. This is what
    the landing page hero number is built from: "Humans 1243 — 1190 AI".
    """

    human_elo: float = 1200.0
    ai_elo: float = 1200.0
    human_wins: int = 0
    ai_wins: int = 0
    draws: int = 0
    games_contested: int = 0

    def record_match(self, human_bits: float, ai_bits: float, k: float = 24.0) -> None:
        outcome = match_outcome(human_bits, ai_bits)
        self.human_elo, self.ai_elo = elo_update(
            self.human_elo, self.ai_elo, outcome, k=k
        )
        if outcome == 1.0:
            self.human_wins += 1
        elif outcome == 0.0:
            self.ai_wins += 1
        else:
            self.draws += 1
        self.games_contested += 1

    @property
    def leader(self) -> str:
        if self.human_elo > self.ai_elo:
            return "human"
        if self.ai_elo > self.human_elo:
            return "ai"
        return "tie"

    def as_dict(self) -> dict:
        return {
            "human_elo": round(self.human_elo, 1),
            "ai_elo": round(self.ai_elo, 1),
            "human_wins": self.human_wins,
            "ai_wins": self.ai_wins,
            "draws": self.draws,
            "games_contested": self.games_contested,
            "leader": self.leader,
            "gap": round(abs(self.human_elo - self.ai_elo), 1),
        }
