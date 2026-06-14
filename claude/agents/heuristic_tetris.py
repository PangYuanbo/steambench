"""A strong Tetris agent: evaluate every placement, then execute the best.

For the current piece it tries all (rotation, column) landing spots, scores the
resulting board with the well-known El-Tetris weights (aggregate height, lines
cleared, holes, bumpiness), picks the best, and emits the move sequence
(rotate*, shift*, hard-drop). Clears many lines and reaches Tetrises.

Operates only on the observed locked board + current piece (plus the public
piece-shape tables, which are game rules, not env internals).
"""

from __future__ import annotations

from typing import Optional

from steambench_harness.envs.tetris import PIECES, W, H
from steambench_harness.protocol import Observation

# El-Tetris weights (Islam et al.) — a known strong linear policy.
_W_AGG, _W_LINES, _W_HOLES, _W_BUMP = -0.510066, 0.760666, -0.35663, -0.184483


def _collides(board, piece, rot, px, py) -> bool:
    for mx, my in PIECES[piece][rot]:
        cx, cy = px + mx, py + my
        if cx < 0 or cx >= W or cy >= H:
            return True
        if cy >= 0 and board[cy][cx]:
            return True
    return False


def _drop_y(board, piece, rot, px) -> Optional[int]:
    if _collides(board, piece, rot, px, 0):
        return None
    y = 0
    while not _collides(board, piece, rot, px, y + 1):
        y += 1
    return y


def _place(board, piece, rot, px):
    y = _drop_y(board, piece, rot, px)
    if y is None:
        return None
    nb = [row[:] for row in board]
    for mx, my in PIECES[piece][rot]:
        cy, cx = y + my, px + mx
        if 0 <= cy < H and 0 <= cx < W:
            nb[cy][cx] = 1
    return nb


def _clear(board):
    kept = [r for r in board if not all(r)]
    cleared = H - len(kept)
    return [[0] * W for _ in range(cleared)] + kept, cleared


def _heights(board):
    hs = [0] * W
    for x in range(W):
        for y in range(H):
            if board[y][x]:
                hs[x] = H - y
                break
    return hs


def _holes(board):
    h = 0
    for x in range(W):
        seen = False
        for y in range(H):
            if board[y][x]:
                seen = True
            elif seen:
                h += 1
    return h


def _evaluate(board) -> float:
    cleared_board, cleared = _clear(board)
    hs = _heights(cleared_board)
    agg = sum(hs)
    bump = sum(abs(hs[i] - hs[i + 1]) for i in range(W - 1))
    holes = _holes(cleared_board)
    return _W_AGG * agg + _W_LINES * cleared + _W_HOLES * holes + _W_BUMP * bump


class TetrisHeuristicAgent:
    name = "heuristic-tetris"

    def __init__(self) -> None:
        self.plan: list[str] = []
        self.last_reasoning = ""

    def reset(self) -> None:
        self.plan = []

    def act(self, obs: Observation):
        if not self.plan:
            self.plan = self._plan(obs.state)
        return self.plan.pop(0) if self.plan else "drop"

    def _plan(self, s) -> list[str]:
        board, piece, cur_px = s["board"], s["piece"], s["px"]
        best, best_score = None, -1e18
        for rot in range(4):
            for px in range(-2, W):
                nb = _place(board, piece, rot, px)
                if nb is None:
                    continue
                sc = _evaluate(nb)
                if sc > best_score:
                    best_score, best = sc, (rot, px)
        if best is None:
            return ["drop"]
        rot, px = best
        seq = ["rotate"] * rot
        dx = px - cur_px
        seq += (["right"] * dx) if dx > 0 else (["left"] * (-dx))
        seq.append("drop")
        self.last_reasoning = f"place {piece} rot{rot} col{px} (eval {best_score:.1f})"
        return seq
