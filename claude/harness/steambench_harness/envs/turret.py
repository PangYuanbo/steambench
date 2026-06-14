"""Turret — a deterministic SteamBench arcade *targeting-vision* env.

A new modality: instead of sliding to *avoid* or *catch*, the agent AIMS and
FIRES. A cannon slides along the floor and shoots bullets straight up; targets
descend, and you must destroy each one before it reaches the floor (three leaks
and the run ends). Perception is richer — targets, the cannon, and the bullet in
flight — and the agent acts ON the world (a `fire` action) rather than only
reacting. That is the closest of the pixel games to a real shooter's loop.

Integer positions/velocities (bit-identical Py/TS); the only randomness is each
target's spawn column (one draw per spawn, in order), so ``(seed, actions)``
traces replay exactly.
"""

from __future__ import annotations

from typing import Union

from ..protocol import AchievementSpec, ActionSpace, Env, Observation, VerifyMode
from ..registry import register

# Shared with runtime/pixel_game.py TurretGame — keep in lock-step (parity test).
W, H = 168, 120
CW, CH = 18, 8          # cannon
CANNON_Y = H - CH - 3   # 109
PSPEED = 7
BUW, BUH = 4, 8         # bullet
BULLET_SPEED = 9
TW, TH = 14, 12         # target
TARGET_VY = 3
LEAK_Y = CANNON_Y       # a target reaching the cannon row has leaked
START_LIVES = 3
_ACTIONS = ["left", "stay", "right", "fire"]


@register
class Turret(Env):
    env_id = "arcade/turret"
    appid = 9000013
    name = "Turret"
    description = (
        "Slide the cannon and shoot the descending targets before they reach the "
        "floor — three leaks and you're done. Aim and fire (not just dodge): the "
        "agent must read targets, the cannon, and its bullet in flight, then act."
    )
    verify_mode = VerifyMode.REPLAY
    action_space = ActionSpace(_ACTIONS)
    achievements = [
        AchievementSpec("hit_5", "Bullseye", "Destroy 5 targets.", 0.6),
        AchievementSpec("hit_15", "Sharpshooter", "Destroy 15 targets.", 0.3),
        AchievementSpec("hit_30", "Deadeye", "Destroy 30 targets.", 0.12),
        AchievementSpec("hit_60", "Gunslinger", "Destroy 60 targets.", 0.035),
        AchievementSpec("hit_120", "Annie Oakley", "Destroy 120 targets.", 0.006),
    ]
    _LADDER = [(5, "hit_5"), (15, "hit_15"), (30, "hit_30"), (60, "hit_60"), (120, "hit_120")]

    def __init__(self) -> None:
        super().__init__()
        self.cx = (W - CW) // 2
        self.bullet: list[int] | None = None   # [x, y]
        self.targets: list[list[int]] = []       # [x, y]
        self.hits = 0
        self.lives = START_LIVES
        self.alive = True

    def reset(self, seed: int = 0) -> Observation:
        self._begin(seed)
        self.cx = (W - CW) // 2
        self.bullet = None
        self.targets = []
        self.hits = 0
        self.lives = START_LIVES
        self.alive = True
        return self._observe(0.0)

    def _spawn_every(self) -> int:
        # spawn cadence tightens as you score — eventually targets outpace a
        # single bullet + the cannon's reach, so even a perfect aimer leaks.
        return max(9, 24 - self.hits // 7)

    def step(self, action: Union[int, str]) -> Observation:
        if self.done:
            return self._observe(0.0)
        name = self.action_space.name(action)
        self.steps += 1

        if name == "left":
            self.cx = max(0, self.cx - PSPEED)
        elif name == "right":
            self.cx = min(W - CW, self.cx + PSPEED)
        elif name == "fire" and self.bullet is None:
            self.bullet = [self.cx + CW // 2 - BUW // 2, CANNON_Y - BUH]

        # bullet rises
        if self.bullet is not None:
            self.bullet[1] -= BULLET_SPEED
            if self.bullet[1] + BUH < 0:
                self.bullet = None

        # spawn a target on cadence (one rng draw: column)
        if self.steps % self._spawn_every() == 0:
            x = self.rng.randrange(W - TW + 1)
            self.targets.append([x, -TH])
        for t in self.targets:
            t[1] += TARGET_VY

        reward = 0.0
        # bullet vs targets
        if self.bullet is not None:
            bx, by = self.bullet
            for i, (tx, ty) in enumerate(self.targets):
                if bx < tx + TW and bx + BUW > tx and by < ty + TH and by + BUH > ty:
                    del self.targets[i]
                    self.bullet = None
                    self.hits += 1
                    reward = 1.0
                    for thresh, aid in self._LADDER:
                        if self.hits >= thresh:
                            self._unlock(aid)
                    break

        # leaks: a target reaching the floor costs a life
        leaked = [t for t in self.targets if t[1] + TH >= LEAK_Y]
        if leaked:
            self.targets = [t for t in self.targets if t[1] + TH < LEAK_Y]
            self.lives -= len(leaked)
            reward = -1.0
            if self.lives <= 0:
                self.lives = 0
                self.alive = False
                self.done = True

        self.score = self.hits
        return self._observe(reward)

    def legal_actions(self) -> list[str]:
        return list(_ACTIONS)

    def render(self) -> str:
        return (f"hits={self.hits} lives={self.lives} cx={self.cx} targets={len(self.targets)} "
                f"bullet={'Y' if self.bullet else 'N'} {'ALIVE' if self.alive else 'DEAD'}")

    def _observe(self, reward: float) -> Observation:
        return Observation(
            step=self.steps,
            state={
                "cannon_x": self.cx,
                "cannon_y": CANNON_Y,
                "cannon_w": CW,
                "cannon_h": CH,
                "cannon_speed": PSPEED,
                "bullet": ({"x": self.bullet[0], "y": self.bullet[1]} if self.bullet else None),
                "bullet_w": BUW,
                "bullet_h": BUH,
                "target_w": TW,
                "target_h": TH,
                "targets": [{"x": tx, "y": ty} for tx, ty in self.targets],
                "width": W,
                "height": H,
                "hits": self.hits,
                "lives": self.lives,
                "score": self.hits,
                "alive": self.alive,
            },
            text=self.render(),
            legal_actions=self.legal_actions(),
            score=float(self.hits),
            done=self.done,
            reward=float(reward),
            info={"hits": self.hits, "lives": self.lives, "alive": self.alive},
        )
