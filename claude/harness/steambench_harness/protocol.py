"""The SteamBench harness protocol.

One protocol, two worlds:

* **Arcade envs** (this repo) are fully deterministic given ``(seed, actions)``.
  That lets the server *verify* a submitted run by replaying the action trace
  and recomputing the score — cheating is impossible without actually solving
  the game.
* **Real Steam games** can't be replayed, so they verify out-of-band via the
  Steam Web API (did this account actually unlock the achievement?). The agent
  still talks to the same ``Env`` interface; only the verification backend
  differs.

The interface is intentionally gym-shaped (``reset`` / ``step``) so existing RL
tooling and LLM agents both feel at home. An ``Observation`` carries three views
of the same state so any agent style works:

* ``state``  -- structured dict, for heuristic / programmatic agents
* ``text``   -- a compact ASCII render, for LLM agents reasoning over a prompt
* ``frame``  -- optional base64 PNG, for vision agents and the livestream
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Protocol, Union, runtime_checkable

from .rng import Mulberry32


class VerifyMode(str, Enum):
    """How a run on this env is verified to be legitimate."""

    REPLAY = "replay"        #: deterministic; server re-simulates (seed, actions)
    STEAM_API = "steam_api"  #: real game; confirmed via Steam Web API
    TRUSTED = "trusted"      #: dev/local only; result taken at face value


@dataclass(frozen=True)
class AchievementSpec:
    """One unlockable objective on an env.

    ``rarity_hint`` is the *designed* global-unlock fraction (0..1). New arcade
    achievements start at their designed rarity and, exactly like a freshly
    released Steam game, converge to a crowd-measured rarity as humans and
    agents actually play. Difficulty/points are derived from rarity by the
    engine, so arcade and real-Steam tasks live on one common scale.
    """

    id: str
    name: str
    description: str
    rarity_hint: float = 0.5  #: 0..1 designed unlock fraction

    def percent_hint(self) -> float:
        return round(self.rarity_hint * 100.0, 3)


@dataclass
class ActionSpace:
    """A small discrete, named action space (the arcade case)."""

    names: list[str]

    def __len__(self) -> int:
        return len(self.names)

    def index(self, action: Union[int, str]) -> int:
        if isinstance(action, int):
            if not 0 <= action < len(self.names):
                raise ValueError(f"action index {action} out of range")
            return action
        try:
            return self.names.index(action)
        except ValueError:
            raise ValueError(f"unknown action {action!r}; valid: {self.names}")

    def name(self, action: Union[int, str]) -> str:
        return self.names[self.index(action)]

    def sample(self, rng: "Mulberry32") -> str:
        return rng.choice(self.names)


@dataclass
class Observation:
    """What an agent sees each step. Three coordinated views of one state."""

    step: int
    state: dict                      #: structured, machine-friendly
    text: str = ""                   #: ASCII render for LLM agents
    frame: Optional[str] = None      #: base64 PNG for vision agents / stream
    legal_actions: list[str] = field(default_factory=list)
    score: float = 0.0
    done: bool = False
    reward: float = 0.0
    info: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "step": self.step,
            "state": self.state,
            "text": self.text,
            "frame": self.frame,
            "legal_actions": self.legal_actions,
            "score": self.score,
            "done": self.done,
            "reward": self.reward,
            "info": self.info,
        }


@runtime_checkable
class Agent(Protocol):
    """Anything that can play. Implement ``act``; ``reset`` is optional."""

    def act(self, obs: Observation) -> Union[int, str]:
        ...


class Env(abc.ABC):
    """Base class for all SteamBench environments.

    Subclasses must be **deterministic**: identical ``(seed, action sequence)``
    must always yield identical ``score`` and ``unlocked`` sets. All randomness
    must come from ``self.rng`` (seeded in :meth:`reset`). This determinism is
    what makes replay-verification possible.
    """

    #: stable id, e.g. "arcade/2048". Mirrors a Steam appid for real games.
    env_id: str = "env/base"
    name: str = "Base Env"
    description: str = ""
    action_space: ActionSpace
    achievements: list[AchievementSpec] = []
    verify_mode: VerifyMode = VerifyMode.REPLAY
    #: synthetic Steam appid so arcade games slot into the same catalog/DB.
    appid: int = 0

    def __init__(self) -> None:
        self.rng = Mulberry32(0)
        self.seed: int = 0
        self.score: float = 0.0
        self.steps: int = 0
        self.done: bool = False
        self.unlocked: set[str] = set()

    # ---- lifecycle -------------------------------------------------------- #

    @abc.abstractmethod
    def reset(self, seed: int = 0) -> Observation:
        """Start a new episode. Must seed ``self.rng`` from ``seed``."""

    @abc.abstractmethod
    def step(self, action: Union[int, str]) -> Observation:
        """Apply one action; advance the world by one tick."""

    # ---- helpers for subclasses ------------------------------------------ #

    def _begin(self, seed: int) -> None:
        """Common reset bookkeeping. Subclasses call this first."""
        self.seed = int(seed)
        self.rng = Mulberry32(self.seed)
        self.score = 0.0
        self.steps = 0
        self.done = False
        self.unlocked = set()

    def _unlock(self, ach_id: str) -> bool:
        """Mark an achievement unlocked. Returns True if newly unlocked."""
        if ach_id in self.unlocked:
            return False
        if ach_id not in {a.id for a in self.achievements}:
            raise KeyError(f"{ach_id!r} is not a declared achievement of {self.env_id}")
        self.unlocked.add(ach_id)
        return True

    def newly_unlocked(self, before: set[str]) -> list[str]:
        return [a for a in self.unlocked if a not in before]

    # ---- introspection ---------------------------------------------------- #

    def achievement(self, ach_id: str) -> AchievementSpec:
        for a in self.achievements:
            if a.id == ach_id:
                return a
        raise KeyError(ach_id)

    def spec(self) -> dict:
        """Machine-readable description of this env (for the catalog/docs)."""
        return {
            "env_id": self.env_id,
            "appid": self.appid,
            "name": self.name,
            "description": self.description,
            "verify_mode": self.verify_mode.value,
            "action_space": self.action_space.names,
            "achievements": [
                {
                    "id": a.id,
                    "name": a.name,
                    "description": a.description,
                    "percent_hint": a.percent_hint(),
                }
                for a in self.achievements
            ],
        }

    def render(self) -> str:
        """Default text render; subclasses usually override."""
        return f"{self.name} | step={self.steps} score={self.score}"
