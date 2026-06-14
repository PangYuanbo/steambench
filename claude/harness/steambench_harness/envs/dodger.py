"""Dodger — a deterministic SteamBench arcade *vision/reflex* env.

Steer a paddle along the floor to dodge blocks raining from the top. It is the
headless, structured-state twin of the pixel game in ``runtime/pixel_game.py``:
the two share constants, step rules, and the Mulberry32 draw order, so a block
layout for a given seed is identical in both. That is what lets the *vision*
agent (which reads rendered pixels on Modal) submit a ``(seed, actions)`` trace
that replay-verifies on this very engine — the same way a human's browser run
does. One game, three ways to play it: structured state, raw pixels, or by hand.

Everything random comes from ``self.rng`` (block spawn columns), one draw per
spawn in spawn order, so the trace replays bit-for-bit in Python and TypeScript.
"""

from __future__ import annotations

from typing import Union

from ..protocol import AchievementSpec, ActionSpace, Env, Observation, VerifyMode
from ..registry import register

# Shared with runtime/pixel_game.py — keep these in lock-step (parity test guards it).
W, H = 168, 120
PW, PH = 20, 8          # player paddle
HW, HH = 14, 14         # hazard block
PLAYER_Y = H - PH - 3   # 109
PSPEED = 7
FALL = 4
SPAWN_GAP = 26          # vertical spacing between hazard waves
_ACTIONS = ["left", "stay", "right"]


@register
class Dodger(Env):
    env_id = "arcade/dodger"
    appid = 9000009
    name = "Dodger"
    description = (
        "Slide a paddle along the floor to dodge blocks falling from above. "
        "The longer you last, the rarer the achievement — pure reflex and "
        "spatial reading. This is the headless twin of the pixel runtime a "
        "vision agent plays from raw frames."
    )
    verify_mode = VerifyMode.REPLAY
    action_space = ActionSpace(_ACTIONS)
    achievements = [
        AchievementSpec("survive_50", "Reflexes", "Survive 50 ticks.", 0.6),
        AchievementSpec("survive_150", "In the Groove", "Survive 150 ticks.", 0.3),
        AchievementSpec("survive_300", "Untouchable", "Survive 300 ticks.", 0.12),
        AchievementSpec("survive_600", "Bullet Time", "Survive 600 ticks.", 0.035),
        AchievementSpec("survive_1200", "Matrix", "Survive 1200 ticks.", 0.006),
    ]
    _LADDER = [(50, "survive_50"), (150, "survive_150"), (300, "survive_300"),
               (600, "survive_600"), (1200, "survive_1200")]

    def __init__(self) -> None:
        super().__init__()
        self.px = (W - PW) // 2
        self.hazards: list[list[int]] = []  # [x, y]
        self.alive = True
        self._since_spawn = SPAWN_GAP

    def reset(self, seed: int = 0) -> Observation:
        self._begin(seed)
        self.px = (W - PW) // 2
        self.hazards = []
        self.alive = True
        self._since_spawn = SPAWN_GAP
        return self._observe(0.0)

    def step(self, action: Union[int, str]) -> Observation:
        if self.done:
            return self._observe(0.0)
        name = self.action_space.name(action)
        self.steps += 1

        if name == "left":
            self.px = max(0, self.px - PSPEED)
        elif name == "right":
            self.px = min(W - PW, self.px + PSPEED)

        # Spawn a new wave on schedule (one rng draw per spawn), then fall.
        self._since_spawn += FALL
        if self._since_spawn >= SPAWN_GAP:
            self._since_spawn = 0
            x = self.rng.randrange(W - HW + 1)  # inclusive [0, W-HW]
            self.hazards.append([x, -HH])
        for hz in self.hazards:
            hz[1] += FALL
        self.hazards = [h for h in self.hazards if h[1] < H]

        # collision: paddle rect vs any hazard rect
        hit = False
        for hx, hy in self.hazards:
            if (hx < self.px + PW and hx + HW > self.px and
                    hy < PLAYER_Y + PH and hy + HH > PLAYER_Y):
                hit = True
                break

        if hit:
            self.alive = False
            self.done = True
            reward = -1.0
        else:
            self.score += 1
            reward = 1.0
            for thresh, aid in self._LADDER:
                if self.score >= thresh:
                    self._unlock(aid)
        return self._observe(reward)

    def legal_actions(self) -> list[str]:
        return list(_ACTIONS)

    def render(self) -> str:
        return (f"score={int(self.score)} px={self.px} hazards={len(self.hazards)} "
                f"{'ALIVE' if self.alive else 'DEAD'}")

    def _observe(self, reward: float) -> Observation:
        return Observation(
            step=self.steps,
            state={
                "paddle_x": self.px,
                "paddle_y": PLAYER_Y,
                "paddle_w": PW,
                "paddle_h": PH,
                "paddle_speed": PSPEED,
                "hazard_w": HW,
                "hazard_h": HH,
                "width": W,
                "height": H,
                "fall": FALL,
                "hazards": [{"x": hx, "y": hy} for hx, hy in self.hazards],
                "score": int(self.score),
                "alive": self.alive,
            },
            text=self.render(),
            legal_actions=self.legal_actions(),
            score=float(self.score),
            done=self.done,
            reward=float(reward),
            info={"score": int(self.score), "alive": self.alive},
        )
