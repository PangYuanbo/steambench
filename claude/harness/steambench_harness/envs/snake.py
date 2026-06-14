"""Snake — a deterministic SteamBench arcade env.

Real-time-ish control (the snake advances every tick; the action only sets
heading), a long skill ladder, and food placement seeded from ``self.rng`` so
runs replay exactly. A nice contrast to 2048: reflex + planning rather than pure
search.
"""

from __future__ import annotations

from collections import deque
from typing import Union

from ..protocol import AchievementSpec, ActionSpace, Env, Observation, VerifyMode

from ..registry import register

W, H = 12, 12
_ACTIONS = ["up", "down", "left", "right"]
_DELTA = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}
_OPPOSITE = {"up": "down", "down": "up", "left": "right", "right": "left"}


@register
class Snake(Env):
    env_id = "arcade/snake"
    appid = 9000002
    name = "Snake"
    description = (
        f"Steer a growing snake around a {W}x{H} grid, eating food and avoiding "
        "the walls and your own tail. How long can you get?"
    )
    verify_mode = VerifyMode.REPLAY
    action_space = ActionSpace(_ACTIONS)
    achievements = [
        AchievementSpec("len_5", "First Bites", "Grow to length 5.", 0.85),
        AchievementSpec("len_10", "Lengthening", "Grow to length 10.", 0.55),
        AchievementSpec("len_15", "Serpent", "Grow to length 15.", 0.30),
        AchievementSpec("len_20", "Anaconda", "Grow to length 20.", 0.14),
        AchievementSpec("len_30", "Titanoboa", "Grow to length 30.", 0.04),
        AchievementSpec("len_45", "Ouroboros", "Grow to length 45.", 0.007),
        AchievementSpec(
            "fill_half", "Space Filler", f"Fill half of the {W*H}-cell board.", 0.0015
        ),
        AchievementSpec("survive_200", "Marathon", "Survive 200 ticks.", 0.20),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.snake: deque[tuple[int, int]] = deque()
        self.direction = "right"
        self.food: tuple[int, int] = (0, 0)
        self.alive = True

    def reset(self, seed: int = 0) -> Observation:
        self._begin(seed)
        cx, cy = W // 2, H // 2
        # length-3 snake heading right
        self.snake = deque([(cx - 2, cy), (cx - 1, cy), (cx, cy)])
        self.direction = "right"
        self.alive = True
        self._place_food()
        return self._observe(reward=0.0)

    def step(self, action: Union[int, str]) -> Observation:
        if self.done:
            return self._observe(reward=0.0)
        name = self.action_space.name(action)
        # Can't reverse straight into yourself; ignore the illegal 180.
        if name != _OPPOSITE.get(self.direction):
            self.direction = name

        dx, dy = _DELTA[self.direction]
        hx, hy = self.snake[-1]
        nx, ny = hx + dx, hy + dy
        self.steps += 1
        reward = 0.0

        # Wall collision.
        if not (0 <= nx < W and 0 <= ny < H):
            self.alive = False
            self.done = True
            return self._observe(reward=-1.0)

        ate = (nx, ny) == self.food
        body = set(self.snake)
        if not ate:
            body.discard(self.snake[0])  # tail will move unless we grow
        if (nx, ny) in body:
            self.alive = False
            self.done = True
            return self._observe(reward=-1.0)

        self.snake.append((nx, ny))
        if ate:
            self.score += 1
            reward = 1.0
            self._place_food()
        else:
            self.snake.popleft()

        self._check_achievements()
        if len(self.snake) >= W * H:  # perfect game
            self.done = True
        return self._observe(reward=reward)

    # ---- mechanics -------------------------------------------------------- #

    def _place_food(self) -> None:
        occupied = set(self.snake)
        free = [(x, y) for x in range(W) for y in range(H) if (x, y) not in occupied]
        if not free:
            self.done = True
            return
        self.food = self.rng.choice(free)

    @property
    def length(self) -> int:
        return len(self.snake)

    def _check_achievements(self) -> None:
        for n, aid in [(5, "len_5"), (10, "len_10"), (15, "len_15"),
                       (20, "len_20"), (30, "len_30"), (45, "len_45")]:
            if self.length >= n:
                self._unlock(aid)
        if self.length >= (W * H) // 2:
            self._unlock("fill_half")
        if self.steps >= 200:
            self._unlock("survive_200")

    def legal_actions(self) -> list[str]:
        # Everything except the immediate 180.
        return [a for a in _ACTIONS if a != _OPPOSITE.get(self.direction)]

    # ---- rendering -------------------------------------------------------- #

    def render(self) -> str:
        head = self.snake[-1]
        body = set(list(self.snake)[:-1])
        rows = []
        for y in range(H):
            line = []
            for x in range(W):
                if (x, y) == head:
                    line.append("@")
                elif (x, y) in body:
                    line.append("o")
                elif (x, y) == self.food:
                    line.append("*")
                else:
                    line.append(".")
            rows.append("".join(line))
        status = f"len={self.length} score={self.score} dir={self.direction} {'ALIVE' if self.alive else 'DEAD'}"
        return status + "\n" + "\n".join(rows)

    def _observe(self, reward: float) -> Observation:
        return Observation(
            step=self.steps,
            state={
                "snake": list(self.snake),
                "head": list(self.snake[-1]) if self.snake else None,
                "food": list(self.food),
                "direction": self.direction,
                "length": self.length,
                "score": self.score,
                "width": W,
                "height": H,
                "alive": self.alive,
            },
            text=self.render(),
            legal_actions=self.legal_actions(),
            score=float(self.score),
            done=self.done,
            reward=float(reward),
            info={"length": self.length, "alive": self.alive},
        )
