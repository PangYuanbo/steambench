"""A Minesweeper agent: single-cell constraint propagation + a safe-ish guess.

From the visible board it deduces mines (a number equal to its hidden-neighbour
count => all hidden are mines) and safe cells (a number equal to its already-
known mine count => all other hidden neighbours are safe), iterating to a
fixpoint. It reveals a deduced-safe cell when one exists; otherwise it guesses a
hidden cell, preferring the fewest-revealed-neighbour (least-constrained) one.
Reveals far more than random and often wins beginner boards.
"""

from __future__ import annotations

from steambench_harness.envs.minesweeper import R, C, _NEIGHBORS
from steambench_harness.protocol import Observation


def _neighbors(r, c):
    for dr, dc in _NEIGHBORS:
        nr, nc = r + dr, c + dc
        if 0 <= nr < R and 0 <= nc < C:
            yield nr, nc


class MinesweeperSolverAgent:
    name = "solver-minesweeper"

    def __init__(self) -> None:
        self.last_reasoning = ""

    def reset(self) -> None:
        pass

    def act(self, obs: Observation):
        view = obs.state["view"]  # -1 hidden, -2 exploded, 0..8 revealed count

        # Opening move: reveal the center (first click is always safe).
        if all(v < 0 for row in view for v in row):
            self.last_reasoning = "open center"
            return f"{R // 2},{C // 2}"

        flags: set[tuple[int, int]] = set()
        safes: set[tuple[int, int]] = set()
        changed = True
        while changed:
            changed = False
            for r in range(R):
                for c in range(C):
                    n = view[r][c]
                    if n < 0:
                        continue
                    hidden = [(nr, nc) for nr, nc in _neighbors(r, c) if view[nr][nc] == -1 and (nr, nc) not in flags]
                    flagged = [(nr, nc) for nr, nc in _neighbors(r, c) if (nr, nc) in flags]
                    if not hidden:
                        continue
                    if n - len(flagged) == len(hidden):  # all hidden are mines
                        for h in hidden:
                            flags.add(h)
                            changed = True
                    elif n == len(flagged):  # all hidden are safe
                        for h in hidden:
                            if h not in safes:
                                safes.add(h)
                                changed = True

        for (hr, hc) in sorted(safes):
            if view[hr][hc] == -1:
                self.last_reasoning = f"deduced safe ({hr},{hc})"
                return f"{hr},{hc}"

        # No certain move — guess the hidden, unflagged cell with the fewest
        # revealed neighbours (least likely to be forced into a mine).
        best, best_key = None, (99,)
        for r in range(R):
            for c in range(C):
                if view[r][c] != -1 or (r, c) in flags:
                    continue
                revealed_nb = sum(1 for nr, nc in _neighbors(r, c) if view[nr][nc] >= 0)
                if (revealed_nb,) < best_key:
                    best_key, best = (revealed_nb,), (r, c)
        if best:
            self.last_reasoning = f"guess ({best[0]},{best[1]})"
            return f"{best[0]},{best[1]}"
        return obs.legal_actions[0] if obs.legal_actions else "0,0"
