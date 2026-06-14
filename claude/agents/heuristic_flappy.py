"""A capable Flappy agent: aim for the next gap with a one-step look-ahead.

Flaps when its projected position would fall below the next gap's center,
otherwise lets gravity pull it down toward the gap. Plays purely from the
observation; passes far more pipes than a random/always-flap baseline.
"""

from __future__ import annotations

from typing import Union

from steambench_harness.protocol import Observation


class FlappyHeuristicAgent:
    name = "heuristic-flappy"

    def __init__(self) -> None:
        self.last_reasoning = ""

    def reset(self) -> None:
        pass

    def act(self, obs: Observation) -> Union[int, str]:
        s = obs.state
        y = s["bird_y"]
        vy = s["bird_vy"]
        nxt = s["next_pipe"]
        target = nxt["gap"] if nxt else s["height"] / 2.0
        # Aim slightly above the gap center (y grows downward); look one step ahead.
        if y + vy * 1.5 > target - 1.0:
            self.last_reasoning = f"flap toward gap {round(target, 1)}"
            return "flap"
        self.last_reasoning = f"glide toward gap {round(target, 1)}"
        return "idle"
