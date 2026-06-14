"""Forager — a deterministic SteamBench arcade *2D-navigation vision* env.

The first game with free two-dimensional movement: a forager roams a top-down
arena (up/down/left/right), collecting good drops while dodging roaming hazards
that bounce around the walls. Every other game anchors the player to the floor;
this one needs genuine 2D spatial reasoning — read the whole board, plan a path
to food that doesn't cross a hazard. Touch a hazard and the run ends.

Integer positions/velocities (bit-identical Py/TS). Randomness: each good's
spawn cell and each hazard's spawn cell + velocity, drawn in a fixed order, so
``(seed, actions)`` traces replay exactly.
"""

from __future__ import annotations

from typing import Union

from ..protocol import AchievementSpec, ActionSpace, Env, Observation, VerifyMode
from ..registry import register

# Shared with runtime/pixel_game.py ForagerGame — keep in lock-step (parity test).
W, H = 168, 120
PS = 10                 # player size
PSPEED = 5
GS = 8                  # good drop size
HS = 12                 # hazard size
N_GOOD = 3              # good drops on screen at once
START_HAZ = 2
MAX_HAZ = 5
_HAZ_V = [-3, -2, 2, 3]
_ACTIONS = ["up", "down", "left", "right", "stay"]


@register
class Forager(Env):
    env_id = "arcade/forager"
    appid = 9000014
    name = "Forager"
    description = (
        "Roam a 2D arena to collect the good drops while dodging the roaming "
        "hazards — the first game with free up/down/left/right movement, so a "
        "vision agent must reason over the whole board, not just one row."
    )
    verify_mode = VerifyMode.REPLAY
    action_space = ActionSpace(_ACTIONS)
    achievements = [
        AchievementSpec("collect_5", "Scavenger", "Collect 5 drops.", 0.6),
        AchievementSpec("collect_15", "Gatherer", "Collect 15 drops.", 0.3),
        AchievementSpec("collect_30", "Forager", "Collect 30 drops.", 0.12),
        AchievementSpec("collect_60", "Hoarder", "Collect 60 drops.", 0.035),
        AchievementSpec("collect_120", "Cornucopia", "Collect 120 drops.", 0.006),
    ]
    _LADDER = [(5, "collect_5"), (15, "collect_15"), (30, "collect_30"),
               (60, "collect_60"), (120, "collect_120")]

    def __init__(self) -> None:
        super().__init__()
        self.px = (W - PS) // 2
        self.py = (H - PS) // 2
        self.goods: list[list[int]] = []
        self.hazards: list[list[int]] = []   # [x, y, vx, vy]
        self.collected = 0
        self.alive = True

    def _rand_good(self) -> list[int]:
        return [self.rng.randrange(W - GS + 1), self.rng.randrange(H - GS + 1)]

    def _rand_hazard(self) -> list[int]:
        x = self.rng.randrange(W - HS + 1)
        y = self.rng.randrange(max(1, H // 2 - HS))   # spawn in the top half, away from start
        vx = _HAZ_V[self.rng.randrange(len(_HAZ_V))]
        vy = _HAZ_V[self.rng.randrange(len(_HAZ_V))]
        return [x, y, vx, vy]

    def reset(self, seed: int = 0) -> Observation:
        self._begin(seed)
        self.px = (W - PS) // 2
        self.py = (H - PS) // 2
        self.collected = 0
        self.alive = True
        self.goods = [self._rand_good() for _ in range(N_GOOD)]
        self.hazards = [self._rand_hazard() for _ in range(START_HAZ)]
        return self._observe(0.0)

    def step(self, action: Union[int, str]) -> Observation:
        if self.done:
            return self._observe(0.0)
        name = self.action_space.name(action)
        self.steps += 1

        if name == "up":
            self.py = max(0, self.py - PSPEED)
        elif name == "down":
            self.py = min(H - PS, self.py + PSPEED)
        elif name == "left":
            self.px = max(0, self.px - PSPEED)
        elif name == "right":
            self.px = min(W - PS, self.px + PSPEED)

        # hazards roam + bounce off the walls
        for hz in self.hazards:
            hz[0] += hz[2]
            hz[1] += hz[3]
            if hz[0] <= 0:
                hz[0] = 0
                hz[2] = -hz[2]
            elif hz[0] >= W - HS:
                hz[0] = W - HS
                hz[2] = -hz[2]
            if hz[1] <= 0:
                hz[1] = 0
                hz[3] = -hz[3]
            elif hz[1] >= H - HS:
                hz[1] = H - HS
                hz[3] = -hz[3]

        reward = 0.0
        # collect goods (respawn each collected one; add a hazard every 15)
        for i, (gx, gy) in enumerate(self.goods):
            if gx < self.px + PS and gx + GS > self.px and gy < self.py + PS and gy + GS > self.py:
                self.collected += 1
                reward += 1.0
                for thresh, aid in self._LADDER:
                    if self.collected >= thresh:
                        self._unlock(aid)
                self.goods[i] = self._rand_good()
                if self.collected % 18 == 0 and len(self.hazards) < MAX_HAZ:
                    self.hazards.append(self._rand_hazard())

        # hazard collision ends the run
        for hx, hy, _vx, _vy in self.hazards:
            if hx < self.px + PS and hx + HS > self.px and hy < self.py + PS and hy + HS > self.py:
                self.alive = False
                self.done = True
                reward = -1.0
                break

        self.score = self.collected
        return self._observe(reward)

    def legal_actions(self) -> list[str]:
        return list(_ACTIONS)

    def render(self) -> str:
        return (f"collected={self.collected} pos=({self.px},{self.py}) "
                f"hazards={len(self.hazards)} {'ALIVE' if self.alive else 'DEAD'}")

    def _observe(self, reward: float) -> Observation:
        return Observation(
            step=self.steps,
            state={
                "player_x": self.px,
                "player_y": self.py,
                "player_size": PS,
                "player_speed": PSPEED,
                "good_size": GS,
                "hazard_size": HS,
                "goods": [{"x": gx, "y": gy} for gx, gy in self.goods],
                "hazards": [{"x": hx, "y": hy, "vx": vx, "vy": vy} for hx, hy, vx, vy in self.hazards],
                "width": W,
                "height": H,
                "collected": self.collected,
                "score": self.collected,
                "alive": self.alive,
            },
            text=self.render(),
            legal_actions=self.legal_actions(),
            score=float(self.collected),
            done=self.done,
            reward=float(reward),
            info={"collected": self.collected, "alive": self.alive},
        )
