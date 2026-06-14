"""The SteamBench task catalog data model.

A *Game* (a Steam app) contributes a set of *Achievements* and/or leaderboards.
Each scorable objective becomes a *Task*. Tasks are what both humans and agents
attempt; their difficulty/points come straight from :mod:`difficulty`.

These are plain dataclasses with ``from_*`` adapters for the raw Steam payloads,
so ingestion code stays declarative and the same objects serialize cleanly to
JSON for the web API and to rows for the database.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional

from .difficulty import AchievementDifficulty, score_achievement, Tier


class TaskKind(str, Enum):
    ACHIEVEMENT = "achievement"   #: unlock a boolean Steam achievement
    LEADERBOARD = "leaderboard"   #: reach a score/time on a ranked leaderboard
    STAT = "stat"                 #: drive a numeric Steam stat past a threshold


@dataclass
class Achievement:
    """One Steam achievement plus its derived difficulty."""

    apiname: str                      #: stable internal id, e.g. "AchClearTartarus"
    percent: float                    #: global unlock %, e.g. 82.1
    display_name: str = ""            #: human label (best-effort enrichment)
    description: str = ""             #: human description (often hidden)
    icon: str = ""                    #: unlocked-icon URL
    icon_gray: str = ""               #: locked-icon URL
    hidden: bool = False

    difficulty: AchievementDifficulty = field(init=False)

    def __post_init__(self) -> None:
        self.difficulty = score_achievement(self.percent)

    @property
    def name(self) -> str:
        return self.display_name or self.apiname

    @property
    def tier(self) -> Tier:
        return self.difficulty.tier

    @property
    def points(self) -> int:
        return self.difficulty.points

    @property
    def bits(self) -> float:
        return self.difficulty.bits

    def as_dict(self) -> dict:
        return {
            "apiname": self.apiname,
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "icon": self.icon,
            "icon_gray": self.icon_gray,
            "hidden": self.hidden,
            "percent": self.percent,
            **self.difficulty.as_dict(),
        }


@dataclass
class Task:
    """A scorable objective derived from a game. The benchmark "level"."""

    task_id: str
    game_appid: int
    kind: TaskKind
    name: str
    description: str
    points: int
    bits: float
    tier: Tier
    rarity: float
    source_ref: str = ""   #: apiname / leaderboard id / stat name it came from
    icon: str = ""

    @classmethod
    def from_achievement(cls, appid: int, ach: Achievement) -> "Task":
        return cls(
            task_id=f"{appid}:ach:{ach.apiname}",
            game_appid=appid,
            kind=TaskKind.ACHIEVEMENT,
            name=ach.name,
            description=ach.description,
            points=ach.points,
            bits=ach.bits,
            tier=ach.tier,
            rarity=ach.difficulty.rarity,
            source_ref=ach.apiname,
            icon=ach.icon,
        )

    def as_dict(self) -> dict:
        d = asdict(self)
        d["kind"] = self.kind.value
        d["tier"] = self.tier.value
        d["tier_rank"] = self.tier.rank
        return d


@dataclass
class Game:
    """A Steam app and the tasks derived from it."""

    appid: int
    name: str
    achievements: list[Achievement] = field(default_factory=list)
    genres: list[str] = field(default_factory=list)
    owners_estimate: Optional[int] = None   #: midpoint of SteamSpy owners band
    review_count: Optional[int] = None
    header_image: str = ""
    short_description: str = ""

    # ---- derived ---------------------------------------------------------- #

    @property
    def total_bits(self) -> float:
        """Total information required to 100% the game -- a clean 'how hard is
        full completion' metric, additive across achievements."""
        return sum(a.bits for a in self.achievements)

    @property
    def total_points(self) -> int:
        return sum(a.points for a in self.achievements)

    @property
    def num_achievements(self) -> int:
        return len(self.achievements)

    @property
    def hardest(self) -> Optional[Achievement]:
        return max(self.achievements, key=lambda a: a.bits, default=None)

    @property
    def popularity_weight(self) -> float:
        """A gentle log-scaled weight so a 30M-owner game counts a bit more than
        a 3k-owner indie, without letting blockbusters dominate the board.
        Returns 1.0 when popularity is unknown."""
        import math

        owners = self.owners_estimate or 0
        if owners <= 0:
            return 1.0
        # log10(owners) ranges ~3 (1k) .. ~7.5 (30M); normalize to ~1.0..1.6.
        return 1.0 + max(0.0, (math.log10(owners) - 4.0)) / 6.0

    def tasks(self) -> list[Task]:
        return [Task.from_achievement(self.appid, a) for a in self.achievements]

    def tier_histogram(self) -> dict[str, int]:
        hist = {t.value: 0 for t in Tier}
        for a in self.achievements:
            hist[a.tier.value] += 1
        return hist

    def as_dict(self, include_tasks: bool = False) -> dict:
        d = {
            "appid": self.appid,
            "name": self.name,
            "genres": self.genres,
            "owners_estimate": self.owners_estimate,
            "review_count": self.review_count,
            "header_image": self.header_image,
            "short_description": self.short_description,
            "num_achievements": self.num_achievements,
            "total_bits": round(self.total_bits, 2),
            "total_points": self.total_points,
            "popularity_weight": round(self.popularity_weight, 3),
            "tier_histogram": self.tier_histogram(),
        }
        if self.hardest:
            d["hardest"] = self.hardest.as_dict()
        if include_tasks:
            d["tasks"] = [t.as_dict() for t in self.tasks()]
        return d
