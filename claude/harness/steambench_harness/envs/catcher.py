"""Catcher — a deterministic SteamBench arcade *vision* env (richer than Dodger).

Slide a paddle to **catch** the good items (one colour) while **dodging** the bad
ones (another colour). It is the second pixel-runtime game: where Dodger only
asks "is this column dangerous?", Catcher forces a *two-class* perception — tell
good from bad, then approach one and avoid the other — which is exactly the
harder thing a real vision agent must do. Shared bit-for-bit with the pixel
runtime so the CV agent's pixel run replay-verifies on this engine.

Randomness (item spawn column, then item kind) comes from ``self.rng``, two draws
per spawn in a fixed order, so ``(seed, actions)`` traces replay across Py/TS.
"""

from __future__ import annotations

from typing import Union

from ..protocol import AchievementSpec, ActionSpace, Env, Observation, VerifyMode
from ..registry import register

# Shared with runtime/pixel_game.py CatcherGame — keep in lock-step (parity test).
W, H = 168, 120
PW, PH = 24, 8          # paddle (a bit wide — it must catch, not just dodge)
IW, IH = 12, 12         # item block
PLAYER_Y = H - PH - 3   # 109
PSPEED = 7
FALL = 4
SPAWN_GAP = 22
BAD_NUM, BAD_DEN = 37, 100  # ~37% of items are bad; integer compare keeps it portable
_ACTIONS = ["left", "stay", "right"]


@register
class Catcher(Env):
    env_id = "arcade/catcher"
    appid = 9000010
    name = "Catcher"
    description = (
        "Catch the falling green drops, dodge the red ones. A two-class vision "
        "task: tell good from bad, sweep up the good, flinch from the bad — one "
        "red touch ends the run. The second game a vision agent plays from pixels."
    )
    verify_mode = VerifyMode.REPLAY
    action_space = ActionSpace(_ACTIONS)
    achievements = [
        AchievementSpec("catch_5", "First Drops", "Catch 5 good items.", 0.6),
        AchievementSpec("catch_15", "Bucket Hands", "Catch 15 good items.", 0.32),
        AchievementSpec("catch_30", "Sticky Fingers", "Catch 30 good items.", 0.13),
        AchievementSpec("catch_60", "Vacuum", "Catch 60 good items.", 0.04),
        AchievementSpec("catch_120", "Event Horizon", "Catch 120 good items.", 0.006),
    ]
    _LADDER = [(5, "catch_5"), (15, "catch_15"), (30, "catch_30"),
               (60, "catch_60"), (120, "catch_120")]

    def __init__(self) -> None:
        super().__init__()
        self.px = (W - PW) // 2
        self.items: list[list[int]] = []  # [x, y, kind] kind 0=good 1=bad
        self.caught = 0
        self.alive = True
        self._since_spawn = SPAWN_GAP

    def reset(self, seed: int = 0) -> Observation:
        self._begin(seed)
        self.px = (W - PW) // 2
        self.items = []
        self.caught = 0
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

        # Spawn (two draws: column, then kind), then fall.
        self._since_spawn += FALL
        if self._since_spawn >= SPAWN_GAP:
            self._since_spawn = 0
            x = self.rng.randrange(W - IW + 1)
            kind = 1 if self.rng.randrange(BAD_DEN) < BAD_NUM else 0
            self.items.append([x, -IH, kind])
        for it in self.items:
            it[1] += FALL

        reward = 0.0
        survivors: list[list[int]] = []
        for x, y, kind in self.items:
            overlaps = (x < self.px + PW and x + IW > self.px and
                        y < PLAYER_Y + PH and y + IH > PLAYER_Y)
            if overlaps:
                if kind == 1:           # caught a bad one — run ends
                    self.alive = False
                    self.done = True
                    reward = -1.0
                else:                    # caught a good one
                    self.caught += 1
                    reward += 1.0
                continue                 # consumed either way
            if y >= H:
                continue                 # fell past — missed
            survivors.append([x, y, kind])
        self.items = survivors

        self.score = self.caught  # always reflects goods caught, even on a death tick
        if not self.done:
            for thresh, aid in self._LADDER:
                if self.caught >= thresh:
                    self._unlock(aid)
        return self._observe(reward)

    def legal_actions(self) -> list[str]:
        return list(_ACTIONS)

    def render(self) -> str:
        goods = sum(1 for it in self.items if it[2] == 0)
        bads = len(self.items) - goods
        return (f"caught={self.caught} px={self.px} good={goods} bad={bads} "
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
                "item_w": IW,
                "item_h": IH,
                "width": W,
                "height": H,
                "fall": FALL,
                "items": [{"x": x, "y": y, "kind": k} for x, y, k in self.items],
                "caught": self.caught,
                "score": self.caught,
                "alive": self.alive,
            },
            text=self.render(),
            legal_actions=self.legal_actions(),
            score=float(self.caught),
            done=self.done,
            reward=float(reward),
            info={"caught": self.caught, "alive": self.alive},
        )
