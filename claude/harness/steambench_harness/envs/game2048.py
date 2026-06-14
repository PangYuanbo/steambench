"""2048 — a deterministic SteamBench arcade env.

Why it's a good benchmark game: trivial rules, enormous skill ceiling, and a
clean achievement ladder (reach-the-N-tile) whose designed rarities mirror a
real Steam game's distribution. Fully deterministic given ``(seed, actions)``:
all tile spawns come from ``self.rng``, so the server can replay-verify any run.
"""

from __future__ import annotations

from typing import Union

from ..protocol import AchievementSpec, ActionSpace, Env, Observation, VerifyMode
from ..registry import register

SIZE = 4
_DIRS = ["up", "down", "left", "right"]


def _slide_left(row: list[int]) -> tuple[list[int], int, bool]:
    """Slide+merge one row to the left. Returns (new_row, gained, changed)."""
    nonzero = [v for v in row if v]
    merged: list[int] = []
    gained = 0
    i = 0
    while i < len(nonzero):
        if i + 1 < len(nonzero) and nonzero[i] == nonzero[i + 1]:
            v = nonzero[i] * 2
            merged.append(v)
            gained += v
            i += 2
        else:
            merged.append(nonzero[i])
            i += 1
    merged += [0] * (len(row) - len(merged))
    return merged, gained, merged != row


@register
class Game2048(Env):
    env_id = "arcade/2048"
    appid = 9000001
    name = "2048"
    description = (
        "Slide numbered tiles on a 4x4 grid; equal tiles merge and double. "
        "Reach the highest tile you can before the board jams."
    )
    verify_mode = VerifyMode.REPLAY
    action_space = ActionSpace(_DIRS)
    achievements = [
        AchievementSpec("tile_64", "Getting Started", "Reach the 64 tile.", 0.80),
        AchievementSpec("tile_128", "Warmed Up", "Reach the 128 tile.", 0.62),
        AchievementSpec("tile_256", "Climbing", "Reach the 256 tile.", 0.40),
        AchievementSpec("tile_512", "Halfway There", "Reach the 512 tile.", 0.24),
        AchievementSpec("tile_1024", "Big Numbers", "Reach the 1024 tile.", 0.11),
        AchievementSpec("tile_2048", "2048!", "Reach the fabled 2048 tile.", 0.045),
        AchievementSpec("tile_4096", "Beyond", "Reach the 4096 tile.", 0.009),
        AchievementSpec("tile_8192", "Grandmaster", "Reach the 8192 tile.", 0.0009),
        AchievementSpec("score_10k", "High Roller", "Score 10,000 points.", 0.16),
        AchievementSpec("score_20k", "Point Hoarder", "Score 20,000 points.", 0.05),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.board: list[list[int]] = [[0] * SIZE for _ in range(SIZE)]

    # ---- lifecycle -------------------------------------------------------- #

    def reset(self, seed: int = 0) -> Observation:
        self._begin(seed)
        self.board = [[0] * SIZE for _ in range(SIZE)]
        self._spawn()
        self._spawn()
        return self._observe(reward=0.0)

    def step(self, action: Union[int, str]) -> Observation:
        if self.done:
            return self._observe(reward=0.0)
        name = self.action_space.name(action)
        before_score = self.score
        moved = self._move(name)
        if moved:
            self._spawn()
        self.steps += 1
        self._check_achievements()
        if not self._has_moves():
            self.done = True
        return self._observe(reward=self.score - before_score)

    # ---- mechanics -------------------------------------------------------- #

    def _move(self, direction: str) -> bool:
        b = self.board
        if direction == "left":
            rows = b
            new, gained, changed = self._apply_rows(rows)
            self.board = new
        elif direction == "right":
            rows = [list(reversed(r)) for r in b]
            new, gained, changed = self._apply_rows(rows)
            self.board = [list(reversed(r)) for r in new]
        elif direction == "up":
            rows = self._transpose(b)
            new, gained, changed = self._apply_rows(rows)
            self.board = self._transpose(new)
        elif direction == "down":
            rows = [list(reversed(r)) for r in self._transpose(b)]
            new, gained, changed = self._apply_rows(rows)
            self.board = self._transpose([list(reversed(r)) for r in new])
        else:
            return False
        self.score += gained
        return changed

    def _apply_rows(self, rows: list[list[int]]) -> tuple[list[list[int]], int, bool]:
        out = []
        total_gained = 0
        changed = False
        for r in rows:
            nr, gained, ch = _slide_left(r)
            out.append(nr)
            total_gained += gained
            changed = changed or ch
        return out, total_gained, changed

    @staticmethod
    def _transpose(b: list[list[int]]) -> list[list[int]]:
        return [list(col) for col in zip(*b)]

    def _empty_cells(self) -> list[tuple[int, int]]:
        return [(r, c) for r in range(SIZE) for c in range(SIZE) if self.board[r][c] == 0]

    def _spawn(self) -> None:
        empties = self._empty_cells()
        if not empties:
            return
        r, c = self.rng.choice(empties)
        self.board[r][c] = 4 if self.rng.random() < 0.1 else 2

    def _has_moves(self) -> bool:
        if self._empty_cells():
            return True
        for r in range(SIZE):
            for c in range(SIZE):
                v = self.board[r][c]
                if c + 1 < SIZE and self.board[r][c + 1] == v:
                    return True
                if r + 1 < SIZE and self.board[r + 1][c] == v:
                    return True
        return False

    def legal_actions(self) -> list[str]:
        legal = []
        snapshot = [row[:] for row in self.board]
        saved_score = self.score
        for d in _DIRS:
            if self._move(d):
                legal.append(d)
            self.board = [row[:] for row in snapshot]
            self.score = saved_score
        return legal

    @property
    def max_tile(self) -> int:
        return max(max(row) for row in self.board)

    def _check_achievements(self) -> None:
        mt = self.max_tile
        for n, aid in [
            (64, "tile_64"),
            (128, "tile_128"),
            (256, "tile_256"),
            (512, "tile_512"),
            (1024, "tile_1024"),
            (2048, "tile_2048"),
            (4096, "tile_4096"),
            (8192, "tile_8192"),
        ]:
            if mt >= n:
                self._unlock(aid)
        if self.score >= 10_000:
            self._unlock("score_10k")
        if self.score >= 20_000:
            self._unlock("score_20k")

    # ---- rendering -------------------------------------------------------- #

    def render(self) -> str:
        width = max(5, len(str(self.max_tile)) + 1)
        lines = []
        for row in self.board:
            lines.append("".join((str(v) if v else ".").center(width) for v in row))
        return f"score={self.score} max={self.max_tile}\n" + "\n".join(lines)

    def _observe(self, reward: float) -> Observation:
        legal = self.legal_actions()
        return Observation(
            step=self.steps,
            state={
                "board": [row[:] for row in self.board],
                "score": self.score,
                "max_tile": self.max_tile,
                "moves": self.steps,
            },
            text=self.render(),
            legal_actions=legal,
            score=float(self.score),
            done=self.done,
            reward=float(reward),
            info={"max_tile": self.max_tile, "newly": []},
        )
