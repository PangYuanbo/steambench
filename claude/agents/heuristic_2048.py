"""A strong programmatic 2048 player: depth-limited expectimax.

Operates purely on the observed ``board`` (never the env internals), re-deriving
the game's move logic so it's a fair, independent player. Reliably reaches the
512/1024 tile and often 2048 — a meaningful 'AI' baseline for humans to chase.
"""

from __future__ import annotations

import math
from typing import Union

from steambench_harness.protocol import Observation

SIZE = 4
_DIRS = ["up", "down", "left", "right"]


def _slide_left(row):
    nz = [v for v in row if v]
    out, gained, i = [], 0, 0
    while i < len(nz):
        if i + 1 < len(nz) and nz[i] == nz[i + 1]:
            out.append(nz[i] * 2)
            gained += nz[i] * 2
            i += 2
        else:
            out.append(nz[i])
            i += 1
    out += [0] * (len(row) - len(out))
    return out, gained


def _transpose(b):
    return [list(c) for c in zip(*b)]


def _move(board, direction):
    """Pure move. Returns (new_board, gained, changed)."""
    if direction == "left":
        rows = [_slide_left(r) for r in board]
        nb = [r for r, _ in rows]
    elif direction == "right":
        rows = [_slide_left(list(reversed(r))) for r in board]
        nb = [list(reversed(r)) for r, _ in rows]
    elif direction == "up":
        t = _transpose(board)
        rows = [_slide_left(r) for r in t]
        nb = _transpose([r for r, _ in rows])
    elif direction == "down":
        t = _transpose(board)
        rows = [_slide_left(list(reversed(r))) for r in t]
        nb = _transpose([list(reversed(r)) for r, _ in rows])
    else:
        return board, 0, False
    gained = sum(g for _, g in rows)
    return nb, gained, nb != board


def _empties(board):
    return [(r, c) for r in range(SIZE) for c in range(SIZE) if board[r][c] == 0]


# Heuristic weights, hand-tuned for the classic snake/corner strategy.
_W_EMPTY = 2.7
_W_MONO = 1.0
_W_SMOOTH = 0.1
_W_MAXCORNER = 1.5


def _evaluate(board) -> float:
    empties = len(_empties(board))
    flat = [v for row in board for v in row]
    max_tile = max(flat)

    # Monotonicity: reward rows/cols that are ordered (log space).
    def log2(v):
        return math.log2(v) if v else 0.0

    mono = 0.0
    for row in board:
        vals = [log2(v) for v in row]
        inc = sum(max(0.0, vals[i + 1] - vals[i]) for i in range(SIZE - 1))
        dec = sum(max(0.0, vals[i] - vals[i + 1]) for i in range(SIZE - 1))
        mono -= min(inc, dec)
    for col in _transpose(board):
        vals = [log2(v) for v in col]
        inc = sum(max(0.0, vals[i + 1] - vals[i]) for i in range(SIZE - 1))
        dec = sum(max(0.0, vals[i] - vals[i + 1]) for i in range(SIZE - 1))
        mono -= min(inc, dec)

    # Smoothness: neighbors with similar log-values are good.
    smooth = 0.0
    for r in range(SIZE):
        for c in range(SIZE):
            if board[r][c]:
                if c + 1 < SIZE and board[r][c + 1]:
                    smooth -= abs(log2(board[r][c]) - log2(board[r][c + 1]))
                if r + 1 < SIZE and board[r + 1][c]:
                    smooth -= abs(log2(board[r][c]) - log2(board[r + 1][c]))

    corners = [board[0][0], board[0][SIZE - 1], board[SIZE - 1][0], board[SIZE - 1][SIZE - 1]]
    max_corner = log2(max_tile) if max_tile in corners else 0.0

    return (
        _W_EMPTY * empties
        + _W_MONO * mono
        + _W_SMOOTH * smooth
        + _W_MAXCORNER * max_corner
    )


class Expectimax2048Agent:
    """Depth-limited expectimax with chance nodes for tile spawns."""

    name = "expectimax-2048"

    def __init__(self, depth: int = 2, chance_sample: int = 5) -> None:
        self.depth = depth
        self.chance_sample = chance_sample
        self.last_reasoning = ""

    def reset(self) -> None:
        pass

    def act(self, obs: Observation) -> Union[int, str]:
        board = obs.state["board"]
        best_dir, best_val = None, -1e18
        for d in _DIRS:
            nb, _, changed = _move(board, d)
            if not changed:
                continue
            val = self._chance(nb, self.depth - 1)
            if val > best_val:
                best_val, best_dir = val, d
        if best_dir is None:
            best_dir = (obs.legal_actions or _DIRS)[0]
        self.last_reasoning = f"expectimax d{self.depth} -> {best_dir} (eval={best_val:.1f}, max={max(max(r) for r in board)})"
        return best_dir

    def _max_node(self, board, depth) -> float:
        if depth <= 0:
            return _evaluate(board)
        best = -1e18
        any_move = False
        for d in _DIRS:
            nb, _, changed = _move(board, d)
            if not changed:
                continue
            any_move = True
            best = max(best, self._chance(nb, depth - 1))
        return best if any_move else _evaluate(board)

    def _chance(self, board, depth) -> float:
        empties = _empties(board)
        if not empties or depth <= 0:
            return _evaluate(board)
        # Sample the most "central" few empties to bound branching.
        cells = empties[: self.chance_sample] if len(empties) > self.chance_sample else empties
        total = 0.0
        for (r, c) in cells:
            for val, prob in ((2, 0.9), (4, 0.1)):
                board[r][c] = val
                total += prob * self._max_node(board, depth)
                board[r][c] = 0
        return total / len(cells)
