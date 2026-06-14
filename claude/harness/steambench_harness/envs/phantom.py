"""Phantom — a deterministic SteamBench arcade *memory / occlusion vision* env.

Dodge falling blocks, but every so often the lights go out: on a fixed blink
cycle ALL blocks vanish from view for a few ticks, then reappear. The blocks
keep falling (and still kill you) while hidden — so to survive you must
*remember* where they were and extrapolate, the one capability the six
fully-observable vision games never test. Both the structured state and the
rendered frame expose blocks ONLY while visible, so a state agent faces the same
partial-observability problem the pixel agent does.

Integer dynamics + Mulberry32 spawns (one draw per spawn) → bit-identical and
fully replayable across Python and TypeScript.
"""

from __future__ import annotations

from typing import Union

from ..protocol import AchievementSpec, ActionSpace, Env, Observation, VerifyMode
from ..registry import register

# Shared with runtime/pixel_game.py PhantomGame — keep in lock-step (parity test).
W, H = 168, 120
PW, PH = 20, 8
BW, BH = 14, 14
PLAYER_Y = H - PH - 3   # 109
PSPEED = 7
FALL = 4
SPAWN_GAP = 26
BLINK_PERIOD = 14       # blocks are visible for VISIBLE_TICKS of every BLINK_PERIOD
VISIBLE_TICKS = 9
_ACTIONS = ["left", "stay", "right"]


@register
class Phantom(Env):
    env_id = "arcade/phantom"
    appid = 9000015
    name = "Phantom"
    description = (
        "Dodge the falling blocks — but the lights blink out and the blocks "
        "vanish for a few ticks at a time while still falling. You must remember "
        "where they were and where they're going. Memory under partial "
        "observability: the frontier the fully-visible games never test."
    )
    verify_mode = VerifyMode.REPLAY
    action_space = ActionSpace(_ACTIONS)
    achievements = [
        AchievementSpec("survive_50", "Blink", "Survive 50 ticks.", 0.6),
        AchievementSpec("survive_150", "Afterimage", "Survive 150 ticks.", 0.3),
        AchievementSpec("survive_300", "Sixth Sense", "Survive 300 ticks.", 0.12),
        AchievementSpec("survive_600", "Echolocation", "Survive 600 ticks.", 0.035),
        AchievementSpec("survive_1200", "Mind's Eye", "Survive 1200 ticks.", 0.006),
    ]
    _LADDER = [(50, "survive_50"), (150, "survive_150"), (300, "survive_300"),
               (600, "survive_600"), (1200, "survive_1200")]

    def __init__(self) -> None:
        super().__init__()
        self.px = (W - PW) // 2
        self.blocks: list[list[int]] = []   # [x, y]
        self.alive = True
        self._since_spawn = SPAWN_GAP

    def reset(self, seed: int = 0) -> Observation:
        self._begin(seed)
        self.px = (W - PW) // 2
        self.blocks = []
        self.alive = True
        self._since_spawn = SPAWN_GAP
        return self._observe(0.0)

    def _visible(self) -> bool:
        return (self.steps % BLINK_PERIOD) < VISIBLE_TICKS

    def step(self, action: Union[int, str]) -> Observation:
        if self.done:
            return self._observe(0.0)
        name = self.action_space.name(action)
        self.steps += 1

        if name == "left":
            self.px = max(0, self.px - PSPEED)
        elif name == "right":
            self.px = min(W - PW, self.px + PSPEED)

        self._since_spawn += FALL
        if self._since_spawn >= SPAWN_GAP:
            self._since_spawn = 0
            x = self.rng.randrange(W - BW + 1)
            self.blocks.append([x, -BH])
        for blk in self.blocks:
            blk[1] += FALL
        self.blocks = [b for b in self.blocks if b[1] < H]

        # collision uses the REAL blocks, visible or not
        hit = False
        for bx, by in self.blocks:
            if (bx < self.px + PW and bx + BW > self.px and
                    by < PLAYER_Y + PH and by + BH > PLAYER_Y):
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
        vis = "VIS" if self._visible() else "DARK"
        return (f"score={int(self.score)} px={self.px} blocks={len(self.blocks)} "
                f"{vis} {'ALIVE' if self.alive else 'DEAD'}")

    def _observe(self, reward: float) -> Observation:
        visible = self._visible()
        # blocks are exposed ONLY while visible — the agent must remember the rest
        shown = [{"x": bx, "y": by} for bx, by in self.blocks] if visible else []
        return Observation(
            step=self.steps,
            state={
                "paddle_x": self.px,
                "paddle_y": PLAYER_Y,
                "paddle_w": PW,
                "paddle_h": PH,
                "paddle_speed": PSPEED,
                "block_w": BW,
                "block_h": BH,
                "fall": FALL,
                "width": W,
                "height": H,
                "visible": visible,
                "blocks": shown,
                "score": int(self.score),
                "alive": self.alive,
            },
            text=self.render(),
            legal_actions=self.legal_actions(),
            score=float(self.score),
            done=self.done,
            reward=float(reward),
            info={"score": int(self.score), "alive": self.alive, "visible": visible},
        )
