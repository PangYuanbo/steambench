"""Storm — a deterministic SteamBench arcade *multi-object temporal-vision* env.

Blocks rain down, but unlike Dodger every block falls at its OWN speed — fast
ones reach you sooner than slow ones spawned earlier. To survive you must track
*several* objects at once and know each one's velocity, not just its position.
That multi-object temporal tracking (match blocks across frames, infer each
one's speed) is the next vision capability after Volley's single ball, and it is
what the pixel runtime's CV agent demonstrates here.

Integer positions/velocities → bit-identical across Python and TypeScript; the
only randomness is each block's spawn column and fall speed (two draws per
spawn, in order), so ``(seed, actions)`` traces replay exactly.
"""

from __future__ import annotations

from typing import Union

from ..protocol import AchievementSpec, ActionSpace, Env, Observation, VerifyMode
from ..registry import register

# Shared with runtime/pixel_game.py StormGame — keep in lock-step (parity test).
W, H = 168, 120
PW, PH = 22, 8
BW, BH = 12, 12
PLAYER_Y = H - PH - 3   # 109
PSPEED = 7
SPAWN_EVERY = 8         # spawn a block every N ticks
_VY_MIN, _VY_SPAN = 3, 5   # fall speed in [3, 7] (one rng draw: 3 + randrange(5))
_ACTIONS = ["left", "stay", "right"]


@register
class Storm(Env):
    env_id = "arcade/storm"
    appid = 9000012
    name = "Storm"
    description = (
        "Dodge the falling blocks — but every block falls at its own speed, so "
        "you must track several at once and read each one's velocity to survive. "
        "Multi-object temporal perception: the frontier a vision agent plays from "
        "raw frames."
    )
    verify_mode = VerifyMode.REPLAY
    action_space = ActionSpace(_ACTIONS)
    achievements = [
        AchievementSpec("survive_50", "Drizzle", "Survive 50 ticks.", 0.6),
        AchievementSpec("survive_150", "Downpour", "Survive 150 ticks.", 0.3),
        AchievementSpec("survive_300", "Squall", "Survive 300 ticks.", 0.12),
        AchievementSpec("survive_600", "Tempest", "Survive 600 ticks.", 0.035),
        AchievementSpec("survive_1200", "Eye of the Storm", "Survive 1200 ticks.", 0.006),
    ]
    _LADDER = [(50, "survive_50"), (150, "survive_150"), (300, "survive_300"),
               (600, "survive_600"), (1200, "survive_1200")]

    def __init__(self) -> None:
        super().__init__()
        self.px = (W - PW) // 2
        self.blocks: list[list[int]] = []   # [x, y, vy]
        self.alive = True

    def reset(self, seed: int = 0) -> Observation:
        self._begin(seed)
        self.px = (W - PW) // 2
        self.blocks = []
        self.alive = True
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

        # Spawn on a fixed tick cadence (two draws: column, then fall speed).
        if self.steps % SPAWN_EVERY == 0:
            x = self.rng.randrange(W - BW + 1)
            vy = _VY_MIN + self.rng.randrange(_VY_SPAN)
            self.blocks.append([x, -BH, vy])
        for blk in self.blocks:
            blk[1] += blk[2]
        self.blocks = [b for b in self.blocks if b[1] < H]

        hit = False
        for bx, by, _vy in self.blocks:
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
        return (f"score={int(self.score)} px={self.px} blocks={len(self.blocks)} "
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
                "block_w": BW,
                "block_h": BH,
                "width": W,
                "height": H,
                "blocks": [{"x": bx, "y": by, "vy": vy} for bx, by, vy in self.blocks],
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
