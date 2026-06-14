"""Volley — a deterministic SteamBench arcade *temporal-vision* env.

Keep a bouncing ball up: it ricochets off the walls and ceiling and falls toward
the floor; slide the paddle under it to bounce it back. Miss once and the run
ends. Unlike Dodger/Catcher (position-only perception), Volley needs *motion*:
to intercept the ball you must know its velocity, which a vision agent can only
get by differencing consecutive frames. That temporal step is the hard part of
real game-playing, and it is what the pixel runtime's CV agent demonstrates here.

All physics is INTEGER (positions + velocities), so it is bit-identical across
Python and TypeScript with no float drift; the only randomness is the ball's
initial launch (one rng draw), so ``(seed, actions)`` traces replay exactly.
"""

from __future__ import annotations

from typing import Union

from ..protocol import AchievementSpec, ActionSpace, Env, Observation, VerifyMode
from ..registry import register

# Shared with runtime/pixel_game.py VolleyGame — keep in lock-step (parity test).
W, H = 168, 120
BS = 8                  # ball size
PW, PH = 26, 6          # paddle
PLAYER_Y = H - PH - 3   # 111
PSPEED = 6              # paddle speed — deliberately SLOWER than the ball's
                        # horizontal speed, so far/fast landings can outrun it.
_LAUNCH_VX = [-8, -7, 7, 8]   # horizontal velocity (one rng draw); |vx| > PSPEED
_VY0 = 4                # initial downward speed
_VY_MAX = 11            # the rally speeds up to here (shorter reaction window)
_ACTIONS = ["left", "stay", "right"]


@register
class Volley(Env):
    env_id = "arcade/volley"
    appid = 9000011
    name = "Volley"
    description = (
        "Keep the bouncing ball up: it caroms off the walls and ceiling and "
        "falls toward the floor — slide under it to bounce it back. One miss "
        "ends the run. A vision agent must read the ball's motion, not just its "
        "position, to know where to be."
    )
    verify_mode = VerifyMode.REPLAY
    action_space = ActionSpace(_ACTIONS)
    achievements = [
        AchievementSpec("bounce_5", "Rally", "Bounce the ball 5 times.", 0.6),
        AchievementSpec("bounce_15", "Keepy-Uppy", "Bounce the ball 15 times.", 0.3),
        AchievementSpec("bounce_30", "Metronome", "Bounce the ball 30 times.", 0.12),
        AchievementSpec("bounce_60", "Wall", "Bounce the ball 60 times.", 0.035),
        AchievementSpec("bounce_120", "Unbreakable", "Bounce the ball 120 times.", 0.006),
    ]
    _LADDER = [(5, "bounce_5"), (15, "bounce_15"), (30, "bounce_30"),
               (60, "bounce_60"), (120, "bounce_120")]

    def __init__(self) -> None:
        super().__init__()
        self.bx = (W - BS) // 2
        self.by = 12
        self.vx = 2
        self.vy = _VY0
        self.px = (W - PW) // 2
        self.bounces = 0
        self.alive = True

    def reset(self, seed: int = 0) -> Observation:
        self._begin(seed)
        self.bx = self.rng.randrange(W - BS + 1)                  # 1st draw: launch column
        self.by = 12
        self.vx = _LAUNCH_VX[self.rng.randrange(len(_LAUNCH_VX))]  # 2nd draw: launch vx
        self.vy = _VY0
        self.px = (W - PW) // 2
        self.bounces = 0
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

        self.bx += self.vx
        self.by += self.vy
        # walls
        if self.bx <= 0:
            self.bx = 0
            self.vx = -self.vx
        elif self.bx >= W - BS:
            self.bx = W - BS
            self.vx = -self.vx
        # ceiling
        if self.by <= 0:
            self.by = 0
            self.vy = -self.vy

        reward = 0.0
        # Descending into the paddle's row: bounce if the paddle is under the ball
        # (ball overlaps the paddle's vertical band), else let it keep falling.
        if self.vy > 0 and self.by + BS >= PLAYER_Y:
            in_band = self.by <= PLAYER_Y + PH
            x_overlap = self.bx + BS > self.px and self.bx < self.px + PW
            if in_band and x_overlap:
                self.bounces += 1
                self.by = PLAYER_Y - BS         # sit on the paddle
                # pure vertical reflection (no english — vx only flips at walls),
                # speeding up as the rally grows (+1 every 10 bounces).
                mag = min(_VY_MAX, _VY0 + self.bounces // 10)
                self.vy = -mag
                reward = 1.0
                for thresh, aid in self._LADDER:
                    if self.bounces >= thresh:
                        self._unlock(aid)
            elif self.by >= H:                  # fell past the paddle → miss
                self.alive = False
                self.done = True
                reward = -1.0
        self.score = self.bounces
        return self._observe(reward)

    def legal_actions(self) -> list[str]:
        return list(_ACTIONS)

    def render(self) -> str:
        return (f"bounces={self.bounces} ball=({self.bx},{self.by}) v=({self.vx},{self.vy}) "
                f"px={self.px} {'ALIVE' if self.alive else 'DEAD'}")

    def _observe(self, reward: float) -> Observation:
        return Observation(
            step=self.steps,
            state={
                "ball_x": self.bx,
                "ball_y": self.by,
                "ball_vx": self.vx,
                "ball_vy": self.vy,
                "ball_size": BS,
                "paddle_x": self.px,
                "paddle_y": PLAYER_Y,
                "paddle_w": PW,
                "paddle_h": PH,
                "paddle_speed": PSPEED,
                "width": W,
                "height": H,
                "bounces": self.bounces,
                "score": self.bounces,
                "alive": self.alive,
            },
            text=self.render(),
            legal_actions=self.legal_actions(),
            score=float(self.bounces),
            done=self.done,
            reward=float(reward),
            info={"bounces": self.bounces, "alive": self.alive},
        )
