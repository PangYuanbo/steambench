"""Tetris — a deterministic SteamBench arcade env (the score/ranking genre).

The closest arcade analogue to a Steam high-score leaderboard: stack tetrominoes,
clear lines, chase a score. Deterministic given ``(seed, actions)``: pieces come
from a 7-bag shuffled with the portable Mulberry32 PRNG, and rotation uses fixed
tables (no wall kicks), so the TS port replays runs identically.

Gravity model: every move except soft/hard-drop is followed by a one-row fall,
giving an agent ~20 ticks to position each piece before it locks.
"""

from __future__ import annotations

from typing import Union

from ..protocol import AchievementSpec, ActionSpace, Env, Observation, VerifyMode
from ..registry import register

W, H = 10, 20
_ACTIONS = ["left", "right", "rotate", "down", "drop"]
_LINE_SCORE = {0: 0, 1: 100, 2: 300, 3: 500, 4: 800}

# Each piece: 4 rotation states, each a list of 4 (x, y) minos in a 4-wide box.
PIECES: dict[str, list[list[tuple[int, int]]]] = {
    "I": [
        [(0, 1), (1, 1), (2, 1), (3, 1)],
        [(2, 0), (2, 1), (2, 2), (2, 3)],
        [(0, 2), (1, 2), (2, 2), (3, 2)],
        [(1, 0), (1, 1), (1, 2), (1, 3)],
    ],
    "O": [[(1, 0), (2, 0), (1, 1), (2, 1)]] * 4,
    "T": [
        [(1, 0), (0, 1), (1, 1), (2, 1)],
        [(1, 0), (1, 1), (2, 1), (1, 2)],
        [(0, 1), (1, 1), (2, 1), (1, 2)],
        [(1, 0), (0, 1), (1, 1), (1, 2)],
    ],
    "S": [
        [(1, 0), (2, 0), (0, 1), (1, 1)],
        [(1, 0), (1, 1), (2, 1), (2, 2)],
        [(1, 1), (2, 1), (0, 2), (1, 2)],
        [(0, 0), (0, 1), (1, 1), (1, 2)],
    ],
    "Z": [
        [(0, 0), (1, 0), (1, 1), (2, 1)],
        [(2, 0), (1, 1), (2, 1), (1, 2)],
        [(0, 1), (1, 1), (1, 2), (2, 2)],
        [(1, 0), (0, 1), (1, 1), (0, 2)],
    ],
    "J": [
        [(0, 0), (0, 1), (1, 1), (2, 1)],
        [(1, 0), (2, 0), (1, 1), (1, 2)],
        [(0, 1), (1, 1), (2, 1), (2, 2)],
        [(1, 0), (1, 1), (0, 2), (1, 2)],
    ],
    "L": [
        [(2, 0), (0, 1), (1, 1), (2, 1)],
        [(1, 0), (1, 1), (1, 2), (2, 2)],
        [(0, 1), (1, 1), (2, 1), (0, 2)],
        [(0, 0), (1, 0), (1, 1), (1, 2)],
    ],
}
ORDER = ["I", "O", "T", "S", "Z", "J", "L"]  # bag index -> piece


@register
class Tetris(Env):
    env_id = "arcade/tetris"
    appid = 9000004
    name = "Tetris"
    description = (
        "Stack falling tetrominoes, clear lines, chase a high score. Move/rotate "
        "with ~20 ticks per piece before gravity locks it; hard-drop to commit."
    )
    verify_mode = VerifyMode.REPLAY
    action_space = ActionSpace(_ACTIONS)
    achievements = [
        AchievementSpec("lines_1", "First Clear", "Clear your first line.", 0.9),
        AchievementSpec("lines_10", "Warmed Up", "Clear 10 lines.", 0.6),
        AchievementSpec("lines_25", "Stacking Up", "Clear 25 lines.", 0.32),
        AchievementSpec("lines_50", "Linesmith", "Clear 50 lines.", 0.14),
        AchievementSpec("lines_100", "Century", "Clear 100 lines.", 0.04),
        AchievementSpec("tetris", "TETRIS!", "Clear 4 lines at once.", 0.16),
        AchievementSpec("score_5k", "High Roller", "Score 5,000 points.", 0.22),
        AchievementSpec("score_20k", "Point Hoarder", "Score 20,000 points.", 0.05),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.board: list[list[int]] = [[0] * W for _ in range(H)]
        self.bag: list[int] = []
        self.lines = 0
        self.piece = 0
        self.rot = 0
        self.px = 0
        self.py = 0

    # ---- lifecycle -------------------------------------------------------- #

    def reset(self, seed: int = 0) -> Observation:
        self._begin(seed)
        self.board = [[0] * W for _ in range(H)]
        self.bag = []
        self.lines = 0
        self._spawn()
        return self._observe(0.0)

    def _refill(self) -> None:
        bag = list(range(7))
        for i in range(6, 0, -1):  # Fisher-Yates with the portable PRNG
            j = self.rng.randrange(i + 1)
            bag[i], bag[j] = bag[j], bag[i]
        self.bag = bag

    def _next_piece(self) -> int:
        if not self.bag:
            self._refill()
        return self.bag.pop(0)

    def _spawn(self) -> None:
        self.piece = self._next_piece()
        self.rot = 0
        self.px = 3
        self.py = 0
        if self._collides(self.px, self.py, self.rot):
            self.done = True  # top-out

    # ---- mechanics -------------------------------------------------------- #

    def _cells(self, x: int, y: int, rot: int) -> list[tuple[int, int]]:
        name = ORDER[self.piece]
        return [(x + mx, y + my) for (mx, my) in PIECES[name][rot]]

    def _collides(self, x: int, y: int, rot: int) -> bool:
        for cx, cy in self._cells(x, y, rot):
            if cx < 0 or cx >= W or cy >= H:
                return True
            if cy >= 0 and self.board[cy][cx]:
                return True
        return False

    def _try_move(self, dx: int, dy: int) -> bool:
        if self._collides(self.px + dx, self.py + dy, self.rot):
            return False
        self.px += dx
        self.py += dy
        return True

    def _try_rotate(self) -> bool:
        nr = (self.rot + 1) % 4
        if self._collides(self.px, self.py, nr):
            return False
        self.rot = nr
        return True

    def _lock_and_spawn(self) -> float:
        pid = self.piece + 1
        for cx, cy in self._cells(self.px, self.py, self.rot):
            if 0 <= cy < H and 0 <= cx < W:
                self.board[cy][cx] = pid
        cleared = self._clear_lines()
        gained = _LINE_SCORE.get(cleared, 0)  # defensive: cleared is always 0..4
        self.score += gained
        self.lines += cleared
        if cleared == 4:
            self._unlock("tetris")
        self._spawn()
        return float(gained)

    def _clear_lines(self) -> int:
        kept = [row for row in self.board if not all(row)]
        cleared = H - len(kept)
        if cleared:
            self.board = [[0] * W for _ in range(cleared)] + kept
        return cleared

    def step(self, action: Union[int, str]) -> Observation:
        if self.done:
            return self._observe(0.0)
        name = self.action_space.name(action)
        self.steps += 1
        reward = 0.0

        if name == "left":
            self._try_move(-1, 0)
        elif name == "right":
            self._try_move(1, 0)
        elif name == "rotate":
            self._try_rotate()
        elif name == "down":
            if not self._try_move(0, 1):
                reward = self._lock_and_spawn()
            self._check_achievements()
            return self._observe(reward)
        elif name == "drop":
            while self._try_move(0, 1):
                pass
            reward = self._lock_and_spawn()
            self._check_achievements()
            return self._observe(reward)

        # gravity after a horizontal/rotate move
        if not self._try_move(0, 1):
            reward = self._lock_and_spawn()
        self._check_achievements()
        return self._observe(reward)

    def _check_achievements(self) -> None:
        for n, aid in [(1, "lines_1"), (10, "lines_10"), (25, "lines_25"),
                       (50, "lines_50"), (100, "lines_100")]:
            if self.lines >= n:
                self._unlock(aid)
        if self.score >= 5000:
            self._unlock("score_5k")
        if self.score >= 20000:
            self._unlock("score_20k")

    # ---- rendering -------------------------------------------------------- #

    def legal_actions(self) -> list[str]:
        return list(_ACTIONS)

    def _grid_with_piece(self) -> list[list[int]]:
        grid = [row[:] for row in self.board]
        if not self.done:
            for cx, cy in self._cells(self.px, self.py, self.rot):
                if 0 <= cy < H and 0 <= cx < W:
                    grid[cy][cx] = self.piece + 1
        return grid

    def render(self) -> str:
        grid = self._grid_with_piece()
        head = f"score={self.score} lines={self.lines} piece={ORDER[self.piece]}"
        rows = ["".join("#" if c else "." for c in row) for row in grid]
        return head + "\n" + "\n".join(rows)

    def _observe(self, reward: float) -> Observation:
        return Observation(
            step=self.steps,
            state={
                "board": [row[:] for row in self.board],
                "grid": self._grid_with_piece(),
                "piece": ORDER[self.piece],
                "piece_id": self.piece + 1,
                "rot": self.rot,
                "px": self.px,
                "py": self.py,
                "score": self.score,
                "lines": self.lines,
                "width": W,
                "height": H,
                "next": ORDER[self.bag[0]] if self.bag else None,
            },
            text=self.render(),
            legal_actions=self.legal_actions(),
            score=float(self.score),
            done=self.done,
            reward=float(reward),
            info={"lines": self.lines},
        )
