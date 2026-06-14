"""A Connect Four agent: depth-limited alpha-beta minimax.

Searches a few plies assuming an optimal adversary (which the env's rule-based
opponent is not), with a standard window-counting evaluation. Reliably beats the
bot — sweeps most series. Plays purely from the observed board.
"""

from __future__ import annotations

from steambench_harness.envs.connect4 import COLS, ROWS, _drop_row, _legal, _wins
from steambench_harness.protocol import Observation

ORDER = [3, 2, 4, 1, 5, 0, 6]  # search center-out for better pruning


def _windows(board):
    lines = []
    for r in range(ROWS):
        for c in range(COLS):
            for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
                cells = []
                rr, cc = r, c
                ok = True
                for _ in range(4):
                    if 0 <= rr < ROWS and 0 <= cc < COLS:
                        cells.append((rr, cc))
                        rr += dr
                        cc += dc
                    else:
                        ok = False
                        break
                if ok:
                    lines.append(cells)
    return lines


_LINES = _windows(None)


def _evaluate(board) -> int:
    score = 0
    for cells in _LINES:
        me = sum(1 for (r, c) in cells if board[r][c] == 1)
        opp = sum(1 for (r, c) in cells if board[r][c] == 2)
        if me and opp:
            continue
        if me == 3:
            score += 50
        elif me == 2:
            score += 10
        elif me == 1:
            score += 1
        elif opp == 3:
            score -= 50
        elif opp == 2:
            score -= 10
        elif opp == 1:
            score -= 1
    for r in range(ROWS):  # center-column bonus
        if board[r][3] == 1:
            score += 4
        elif board[r][3] == 2:
            score -= 4
    return score


class Connect4MinimaxAgent:
    name = "minimax-connect4"

    def __init__(self, depth: int = 5) -> None:
        self.depth = depth
        self.last_reasoning = ""

    def reset(self) -> None:
        pass

    def act(self, obs: Observation):
        board = [row[:] for row in obs.state["board"]]
        legal = _legal(board)
        best, best_val = (legal[0] if legal else 3), -1 << 60
        for c in [x for x in ORDER if x in legal]:
            r = _drop_row(board, c)
            board[r][c] = 1
            val = self._mm(board, self.depth - 1, -(1 << 60), 1 << 60, False)
            board[r][c] = 0
            if val > best_val:
                best_val, best = val, c
        self.last_reasoning = f"minimax d{self.depth} -> col {best} (val {best_val})"
        return str(best)

    def _mm(self, board, depth, alpha, beta, maximizing) -> int:
        if _wins(board, 1):
            return 100000 + depth
        if _wins(board, 2):
            return -100000 - depth
        legal = _legal(board)
        if depth == 0 or not legal:
            return _evaluate(board)
        ordered = [x for x in ORDER if x in legal]
        if maximizing:
            val = -(1 << 60)
            for c in ordered:
                r = _drop_row(board, c)
                board[r][c] = 1
                val = max(val, self._mm(board, depth - 1, alpha, beta, False))
                board[r][c] = 0
                alpha = max(alpha, val)
                if alpha >= beta:
                    break
            return val
        val = 1 << 60
        for c in ordered:
            r = _drop_row(board, c)
            board[r][c] = 2
            val = min(val, self._mm(board, depth - 1, alpha, beta, True))
            board[r][c] = 0
            beta = min(beta, val)
            if alpha >= beta:
                break
        return val
