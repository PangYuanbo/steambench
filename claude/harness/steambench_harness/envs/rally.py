"""Rally — a deterministic SteamBench arcade *adversarial vision* env (Pong).

The one structural gap the other vision games leave: an opponent. You drive the
left paddle, a built-in AI drives the right, and a ball volleys between you —
speeding up every hit. Win a point when the opponent can't reach your return;
the run ends the first time YOU miss. It folds three things into one: read the
ball's motion (temporal), position to intercept (vision), and out-place a
reacting adversary (adversarial).

Integer dynamics; the only randomness is each serve's vertical velocity (one
draw per serve), so ``(seed, actions)`` traces replay exactly. The opponent is a
deterministic tracker, so it is part of the reproducible dynamics.
"""

from __future__ import annotations

from typing import Union

from ..protocol import AchievementSpec, ActionSpace, Env, Observation, VerifyMode
from ..registry import register

# Shared with runtime/pixel_game.py RallyGame — keep in lock-step (parity test).
W, H = 168, 120
PADW, PADH = 4, 26
AGENT_X = 4                 # left paddle x (the player)
OPP_X = W - 4 - PADW        # right paddle x (the opponent)
PSPEED = 6                  # agent paddle speed
OPP_SPEED = 7               # opponent always reaches — it ATTACKS, aiming away
BS = 6                      # ball size
BASE_SPEED = 4
MAX_SPEED = 8
_SERVE_VY = [-2, -1, 1, 2]
_ACTIONS = ["up", "down", "stay"]


@register
class Rally(Env):
    env_id = "arcade/rally"
    appid = 9000016
    name = "Rally"
    description = (
        "A Pong-style duel: drive the left paddle, read the ball, and beat the "
        "built-in opponent — score when it can't reach your return, and the run "
        "ends the first time you miss. Adversarial, temporal and visual at once."
    )
    verify_mode = VerifyMode.REPLAY
    action_space = ActionSpace(_ACTIONS)
    achievements = [
        AchievementSpec("rally_5", "Warm-up", "Return 5 of the opponent's shots.", 0.6),
        AchievementSpec("rally_15", "Rally", "Return 15 shots.", 0.3),
        AchievementSpec("rally_30", "Backboard", "Return 30 shots.", 0.12),
        AchievementSpec("rally_60", "Iron Wall", "Return 60 shots.", 0.035),
        AchievementSpec("rally_120", "Untouchable", "Return 120 shots.", 0.006),
    ]
    _LADDER = [(5, "rally_5"), (15, "rally_15"), (30, "rally_30"),
               (60, "rally_60"), (120, "rally_120")]

    def __init__(self) -> None:
        super().__init__()
        self.ay = (H - PADH) // 2
        self.oy = (H - PADH) // 2
        self.bx = W // 2
        self.by = H // 2
        self.vx = -BASE_SPEED
        self.vy = 1
        self.speed = BASE_SPEED
        self.points = 0
        self.alive = True

    def _serve(self) -> None:
        self.bx = W // 2
        self.by = H // 2
        self.speed = BASE_SPEED
        self.vx = -BASE_SPEED                       # serve toward the agent
        self.vy = _SERVE_VY[self.rng.randrange(len(_SERVE_VY))]

    def reset(self, seed: int = 0) -> Observation:
        self._begin(seed)
        self.ay = (H - PADH) // 2
        self.oy = (H - PADH) // 2
        self.points = 0
        self.alive = True
        self._serve()
        return self._observe(0.0)

    def step(self, action: Union[int, str]) -> Observation:
        if self.done:
            return self._observe(0.0)
        name = self.action_space.name(action)
        self.steps += 1

        if name == "up":
            self.ay = max(0, self.ay - PSPEED)
        elif name == "down":
            self.ay = min(H - PADH, self.ay + PSPEED)

        # opponent tracks the ball's center vertically (a touch slower)
        ball_cy = self.by + BS // 2
        opp_cy = self.oy + PADH // 2
        if ball_cy < opp_cy - 1:
            self.oy = max(0, self.oy - OPP_SPEED)
        elif ball_cy > opp_cy + 1:
            self.oy = min(H - PADH, self.oy + OPP_SPEED)

        self.bx += self.vx
        self.by += self.vy
        if self.by <= 0:
            self.by = 0
            self.vy = -self.vy
        elif self.by >= H - BS:
            self.by = H - BS
            self.vy = -self.vy

        reward = 0.0
        # agent paddle hit = a successful RETURN (the score); english from the
        # spot it struck (a centred hit goes straight, an edge hit cuts).
        if self.vx < 0 and self.bx <= AGENT_X + PADW and self.bx > AGENT_X - self.speed:
            if self.by + BS > self.ay and self.by < self.ay + PADH:
                self.bx = AGENT_X + PADW
                self.speed = min(MAX_SPEED, self.speed + 1)
                self.vx = self.speed
                off = (self.by + BS // 2) - (self.ay + PADH // 2)
                self.vy = max(-7, min(7, off // 2))
                self.points += 1
                reward = 1.0
                for thresh, aid in self._LADDER:
                    if self.points >= thresh:
                        self._unlock(aid)
        # opponent ATTACKS: it always reaches (OPP_SPEED ≥ any vy), then aims the
        # ball at the half the agent ISN'T in, harder as the rally speeds up.
        elif self.vx > 0 and self.bx + BS >= OPP_X and self.bx + BS < OPP_X + PADW + self.speed:
            self.bx = OPP_X - BS
            self.speed = min(MAX_SPEED, self.speed + 1)
            self.vx = -self.speed
            agent_cy = self.ay + PADH // 2
            self.vy = (self.speed - 2) if agent_cy < H // 2 else -(self.speed - 2)

        if self.bx + BS < 0:                        # agent missed -> run ends
            self.alive = False
            self.done = True
            reward = -1.0
        elif self.bx > W:                           # opponent let one by -> re-serve
            self._serve()

        self.score = self.points
        return self._observe(reward)

    def legal_actions(self) -> list[str]:
        return list(_ACTIONS)

    def render(self) -> str:
        return (f"points={self.points} ay={self.ay} oy={self.oy} ball=({self.bx},{self.by}) "
                f"v=({self.vx},{self.vy}) {'ALIVE' if self.alive else 'DEAD'}")

    def _observe(self, reward: float) -> Observation:
        return Observation(
            step=self.steps,
            state={
                "agent_x": AGENT_X,
                "agent_y": self.ay,
                "opp_x": OPP_X,
                "opp_y": self.oy,
                "paddle_w": PADW,
                "paddle_h": PADH,
                "paddle_speed": PSPEED,
                "ball_x": self.bx,
                "ball_y": self.by,
                "ball_vx": self.vx,
                "ball_vy": self.vy,
                "ball_size": BS,
                "width": W,
                "height": H,
                "points": self.points,
                "score": self.points,
                "alive": self.alive,
            },
            text=self.render(),
            legal_actions=self.legal_actions(),
            score=float(self.points),
            done=self.done,
            reward=float(reward),
            info={"points": self.points, "alive": self.alive},
        )
