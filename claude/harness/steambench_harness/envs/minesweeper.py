"""Minesweeper — a deterministic SteamBench arcade *deduction* env.

A different shape of challenge: a large, variable action space (reveal any of the
R*C cells) and pure logical deduction rather than reflex/search. First click is
always safe — mines are placed (deterministically, from the portable PRNG)
*after* the opening reveal, excluding that cell and its neighbours — so a run is
fully determined by ``(seed, first-action, ...)`` and replays identically.
"""

from __future__ import annotations

from typing import Union

from ..protocol import AchievementSpec, ActionSpace, Env, Observation, VerifyMode
from ..registry import register

R, C, MINES = 9, 9, 10
_NEIGHBORS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


@register
class Minesweeper(Env):
    env_id = "arcade/minesweeper"
    appid = 9000005
    name = "Minesweeper"
    description = (
        f"Clear a {R}x{C} grid with {MINES} hidden mines by deduction. Numbers show "
        "adjacent mine counts; the first reveal is always safe. Reveal every safe "
        "cell to win — hit a mine and it's over."
    )
    verify_mode = VerifyMode.REPLAY
    # Action space = reveal any cell, named "r,c".
    action_space = ActionSpace([f"{r},{c}" for r in range(R) for c in range(C)])
    achievements = [
        AchievementSpec("reveal_1", "First Dig", "Reveal your first cell.", 0.95),
        AchievementSpec("reveal_10", "Digging In", "Reveal 10 safe cells.", 0.7),
        AchievementSpec("reveal_30", "Clearing House", "Reveal 30 safe cells.", 0.4),
        AchievementSpec("reveal_50", "Almost There", "Reveal 50 safe cells.", 0.16),
        AchievementSpec("win", "Minesweeper", f"Reveal all {R * C - MINES} safe cells.", 0.06),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.mines: set[tuple[int, int]] = set()
        self.counts: list[list[int]] = [[0] * C for _ in range(R)]
        self.revealed: list[list[bool]] = [[False] * C for _ in range(R)]
        self.placed = False
        self.exploded: tuple[int, int] | None = None

    # ---- lifecycle -------------------------------------------------------- #

    def reset(self, seed: int = 0) -> Observation:
        self._begin(seed)
        self.mines = set()
        self.counts = [[0] * C for _ in range(R)]
        self.revealed = [[False] * C for _ in range(R)]
        self.placed = False
        self.exploded = None
        return self._observe(0.0)

    def _place_mines(self, safe_r: int, safe_c: int) -> None:
        excluded = {(safe_r, safe_c)}
        for dr, dc in _NEIGHBORS:
            excluded.add((safe_r + dr, safe_c + dc))
        candidates = [(r, c) for r in range(R) for c in range(C) if (r, c) not in excluded]
        mines: set[tuple[int, int]] = set()
        while len(mines) < MINES:
            cell = candidates[self.rng.randrange(len(candidates))]
            mines.add(cell)
        self.mines = mines
        for r in range(R):
            for c in range(C):
                if (r, c) in mines:
                    continue
                self.counts[r][c] = sum(
                    1 for dr, dc in _NEIGHBORS if (r + dr, c + dc) in mines
                )
        self.placed = True

    def _reveal(self, r: int, c: int) -> None:
        # Flood-fill reveal: opening a 0 cell cascades to its neighbours.
        stack = [(r, c)]
        while stack:
            cr, cc = stack.pop()
            if not (0 <= cr < R and 0 <= cc < C) or self.revealed[cr][cc]:
                continue
            if (cr, cc) in self.mines:
                continue
            self.revealed[cr][cc] = True
            if self.counts[cr][cc] == 0:
                for dr, dc in _NEIGHBORS:
                    stack.append((cr + dr, cc + dc))

    @property
    def revealed_count(self) -> int:
        return sum(1 for row in self.revealed for v in row if v)

    def step(self, action: Union[int, str]) -> Observation:
        if self.done:
            return self._observe(0.0)
        name = self.action_space.name(action)
        r, c = (int(x) for x in name.split(","))
        self.steps += 1

        if self.revealed[r][c]:
            return self._observe(0.0)  # no-op on an already-open cell

        if not self.placed:
            self._place_mines(r, c)  # first click is always safe

        before = self.revealed_count
        if (r, c) in self.mines:
            self.exploded = (r, c)
            self.done = True  # boom
            return self._observe(0.0)

        self._reveal(r, c)
        self.score = self.revealed_count
        gained = self.revealed_count - before
        self._check_achievements()
        if self.revealed_count >= R * C - MINES:  # all safe cells -> win
            self._unlock("win")
            self.done = True
        return self._observe(float(gained))

    def _check_achievements(self) -> None:
        n = self.revealed_count
        for k, aid in [(1, "reveal_1"), (10, "reveal_10"), (30, "reveal_30"), (50, "reveal_50")]:
            if n >= k:
                self._unlock(aid)

    # ---- rendering -------------------------------------------------------- #

    def legal_actions(self) -> list[str]:
        return [f"{r},{c}" for r in range(R) for c in range(C) if not self.revealed[r][c]]

    def _cell_char(self, r: int, c: int) -> str:
        if self.exploded == (r, c):
            return "*"
        if not self.revealed[r][c]:
            return "#"
        n = self.counts[r][c]
        return str(n) if n else "."

    def render(self) -> str:
        head = f"revealed={self.revealed_count}/{R * C - MINES} mines={MINES} " + (
            "BOOM" if self.exploded else "ok"
        )
        rows = ["".join(self._cell_char(r, c) for c in range(C)) for r in range(R)]
        return head + "\n" + "\n".join(rows)

    def _view(self) -> list[list[int]]:
        # -1 hidden, -2 exploded mine, 0..8 revealed count
        grid = []
        for r in range(R):
            row = []
            for c in range(C):
                if self.exploded == (r, c):
                    row.append(-2)
                elif not self.revealed[r][c]:
                    row.append(-1)
                else:
                    row.append(self.counts[r][c])
            grid.append(row)
        return grid

    def _observe(self, reward: float) -> Observation:
        return Observation(
            step=self.steps,
            state={
                "view": self._view(),
                "rows": R,
                "cols": C,
                "mines": MINES,
                "revealed": self.revealed_count,
                "safe_total": R * C - MINES,
                "exploded": list(self.exploded) if self.exploded else None,
                "score": self.score,
            },
            text=self.render(),
            legal_actions=self.legal_actions(),
            score=float(self.score),
            done=self.done,
            reward=float(reward),
            info={"revealed": self.revealed_count, "exploded": self.exploded is not None},
        )
