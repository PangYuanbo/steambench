"""Baseline agents: the floor every real agent should beat."""

from __future__ import annotations

import random
from typing import Union

from steambench_harness.protocol import Observation


class RandomAgent:
    """Uniformly random over the full action space. The absolute floor."""

    name = "random"

    def __init__(self, seed: int = 0) -> None:
        self.rng = random.Random(seed)
        self.last_reasoning = ""

    def reset(self) -> None:
        pass

    def act(self, obs: Observation) -> Union[int, str]:
        actions = obs.legal_actions or ["up", "down", "left", "right"]
        choice = self.rng.choice(actions)
        self.last_reasoning = f"random -> {choice}"
        return choice


class LegalRandomAgent(RandomAgent):
    """Random, but only over legal actions (a slightly less terrible floor)."""

    name = "legal-random"
