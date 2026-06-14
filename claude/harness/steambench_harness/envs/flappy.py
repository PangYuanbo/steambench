"""Flappy — a deterministic SteamBench arcade *timing/physics* env.

Tap to flap against gravity and thread gaps between scrolling pipes. A different
axis again: real-time reaction and rhythm. Physics uses only +/*/comparisons on
IEEE-754 doubles (identical in Python and TypeScript), and pipe gaps come from
the portable Mulberry32 PRNG, so ``(seed, actions)`` traces replay exactly.
"""

from __future__ import annotations

from typing import Union

from ..protocol import AchievementSpec, ActionSpace, Env, Observation, VerifyMode

from ..registry import register

W, H = 120, 80
BIRD_X = 34
GRAVITY = 0.4
FLAP = -2.5
SPEED = 1.0
GAP_HALF = 12.0
PIPE_W = 8
PIPE_SPACING = 44
_MARGIN = GAP_HALF + 6  # keep gap centers away from floor/ceiling
_ACTIONS = ["idle", "flap"]


@register
class Flappy(Env):
    env_id = "arcade/flappy"
    appid = 9000007
    name = "Flappy"
    description = (
        "Flap to stay airborne and thread the gaps between scrolling pipes. "
        "Gravity never quits; one touch of a pipe or the ground ends the run."
    )
    verify_mode = VerifyMode.REPLAY
    action_space = ActionSpace(_ACTIONS)
    achievements = [
        AchievementSpec("pipe_1", "Liftoff", "Pass your first pipe.", 0.8),
        AchievementSpec("pipe_5", "Finding a Rhythm", "Pass 5 pipes.", 0.5),
        AchievementSpec("pipe_10", "In the Zone", "Pass 10 pipes.", 0.28),
        AchievementSpec("pipe_25", "Unflappable", "Pass 25 pipes.", 0.1),
        AchievementSpec("pipe_50", "Iron Wings", "Pass 50 pipes.", 0.03),
        AchievementSpec("pipe_100", "Legend of Flight", "Pass 100 pipes.", 0.004),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.y = 0.0
        self.vy = 0.0
        self.pipes: list[dict] = []
        self.alive = True

    def reset(self, seed: int = 0) -> Observation:
        self._begin(seed)
        self.y = H / 2.0
        self.vy = 0.0
        self.alive = True
        self.pipes = []
        self._spawn_pipe(W)
        return self._observe(0.0)

    def _spawn_pipe(self, x: float) -> None:
        gap = _MARGIN + self.rng.random() * (H - 2 * _MARGIN)
        self.pipes.append({"x": float(x), "gap": gap, "passed": False})

    def step(self, action: Union[int, str]) -> Observation:
        if self.done:
            return self._observe(0.0)
        name = self.action_space.name(action)
        self.steps += 1
        if name == "flap":
            self.vy = FLAP
        self.vy += GRAVITY
        self.y += self.vy

        for p in self.pipes:
            p["x"] -= SPEED
        # spawn a new pipe once the last one is far enough left
        if not self.pipes or self.pipes[-1]["x"] <= W - PIPE_SPACING:
            self._spawn_pipe(W)
        # drop pipes fully off-screen
        self.pipes = [p for p in self.pipes if p["x"] > -PIPE_W]

        reward = 0.0
        for p in self.pipes:
            if not p["passed"] and p["x"] + PIPE_W < BIRD_X:
                p["passed"] = True
                self.score += 1
                reward = 1.0

        if self.y < 0 or self.y > H:
            self.alive = False
        else:
            for p in self.pipes:
                if p["x"] - PIPE_W <= BIRD_X <= p["x"] + PIPE_W:
                    if self.y < p["gap"] - GAP_HALF or self.y > p["gap"] + GAP_HALF:
                        self.alive = False
                        break
        if not self.alive:
            self.done = True
            reward = -1.0

        self._check_achievements()
        return self._observe(reward)

    def _check_achievements(self) -> None:
        for n, aid in [(1, "pipe_1"), (5, "pipe_5"), (10, "pipe_10"),
                       (25, "pipe_25"), (50, "pipe_50"), (100, "pipe_100")]:
            if self.score >= n:
                self._unlock(aid)

    def legal_actions(self) -> list[str]:
        return list(_ACTIONS)

    def _next_pipe(self) -> dict | None:
        ahead = [p for p in self.pipes if p["x"] + PIPE_W >= BIRD_X]
        return min(ahead, key=lambda p: p["x"]) if ahead else None

    def render(self) -> str:
        nxt = self._next_pipe()
        gap = round(nxt["gap"], 1) if nxt else None
        return f"score={self.score} y={self.y:.1f} vy={self.vy:.1f} next_gap={gap} {'ALIVE' if self.alive else 'DEAD'}"

    def _observe(self, reward: float) -> Observation:
        nxt = self._next_pipe()
        return Observation(
            step=self.steps,
            state={
                "bird_y": self.y,
                "bird_vy": self.vy,
                "width": W,
                "height": H,
                "bird_x": BIRD_X,
                "gap_half": GAP_HALF,
                "pipe_w": PIPE_W,
                "pipes": [{"x": p["x"], "gap": p["gap"]} for p in self.pipes],
                "next_pipe": {"x": nxt["x"], "gap": nxt["gap"]} if nxt else None,
                "score": self.score,
                "alive": self.alive,
            },
            text=self.render(),
            legal_actions=self.legal_actions(),
            score=float(self.score),
            done=self.done,
            reward=float(reward),
            info={"score": self.score, "alive": self.alive},
        )
