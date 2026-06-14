"""Connect Four — a deterministic SteamBench *adversarial* env.

The one category the other arcade games don't cover: a two-player game. You play
a best-of-6 series against a fixed, rule-based opponent (win-if-you-can,
block-if-you-must, else play center-out). The opponent is deterministic and
there's no RNG, so a run is fully determined by your drops alone — trivially
replay-verifiable. Skill (lookahead) translates straight into wins.
"""

from __future__ import annotations

from typing import Optional, Union

from ..protocol import AchievementSpec, ActionSpace, Env, Observation, VerifyMode
from ..registry import register

COLS, ROWS = 7, 6
GAMES = 6  # best-of series
CENTER_ORDER = [3, 2, 4, 1, 5, 0, 6]  # opponent's tie-break preference


def _drop_row(board: list[list[int]], col: int) -> Optional[int]:
    """Lowest empty row in a column, or None if full."""
    for r in range(ROWS - 1, -1, -1):
        if board[r][col] == 0:
            return r
    return None


def _wins(board: list[list[int]], who: int) -> bool:
    for r in range(ROWS):
        for c in range(COLS):
            if board[r][c] != who:
                continue
            for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
                rr, cc, n = r, c, 0
                while 0 <= rr < ROWS and 0 <= cc < COLS and board[rr][cc] == who:
                    n += 1
                    if n == 4:
                        return True
                    rr += dr
                    cc += dc
    return False


def _legal(board: list[list[int]]) -> list[int]:
    return [c for c in range(COLS) if board[0][c] == 0]


def _winning_move(board: list[list[int]], who: int) -> Optional[int]:
    for c in _legal(board):
        r = _drop_row(board, c)
        board[r][c] = who
        win = _wins(board, who)
        board[r][c] = 0
        if win:
            return c
    return None


@register
class Connect4(Env):
    env_id = "arcade/connect4"
    appid = 9000008
    name = "Connect Four"
    description = (
        "Play a best-of-6 series of Connect Four against a fixed rule-based "
        "opponent. Drop discs to make four in a row; out-think the bot to win."
    )
    verify_mode = VerifyMode.REPLAY
    action_space = ActionSpace([str(c) for c in range(COLS)])
    achievements = [
        AchievementSpec("win_1", "On the Board", "Win a game vs the bot.", 0.7),
        AchievementSpec("win_2", "Got Its Number", "Win 2 games.", 0.45),
        AchievementSpec("win_3", "Majority", "Win 3 games.", 0.28),
        AchievementSpec("win_5", "Dominant", "Win 5 games.", 0.1),
        AchievementSpec("sweep", "Flawless", f"Win all {GAMES} — losing none.", 0.04),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.board: list[list[int]] = [[0] * COLS for _ in range(ROWS)]
        self.game_index = 0
        self.wins = 0
        self.losses = 0
        self.draws = 0

    def reset(self, seed: int = 0) -> Observation:
        self._begin(seed)
        self.game_index = 0
        self.wins = 0
        self.losses = 0
        self.draws = 0
        self._new_game()
        return self._observe(0.0)

    def _new_game(self) -> None:
        self.board = [[0] * COLS for _ in range(ROWS)]
        # Alternate who moves first across the series; opponent-first games open
        # with the opponent's deterministic move.
        if self.game_index % 2 == 1:
            self._opponent_move()

    def _opponent_move(self) -> None:
        win = _winning_move(self.board, 2)
        block = _winning_move(self.board, 1)
        if win is not None:
            col = win
        elif block is not None:
            col = block
        else:
            legal = _legal(self.board)
            col = next((c for c in CENTER_ORDER if c in legal), legal[0] if legal else 0)
        r = _drop_row(self.board, col)
        if r is not None:
            self.board[r][col] = 2

    def _end_game(self, result: str) -> float:
        if result == "win":
            self.wins += 1
        elif result == "loss":
            self.losses += 1
        else:
            self.draws += 1
        self.score = self.wins
        reward = 1.0 if result == "win" else (-1.0 if result == "loss" else 0.0)
        self._check_achievements()
        self.game_index += 1
        if self.game_index >= GAMES:
            self.done = True
        else:
            self._new_game()
        return reward

    def step(self, action: Union[int, str]) -> Observation:
        if self.done:
            return self._observe(0.0)
        col = int(self.action_space.name(action))
        self.steps += 1
        r = _drop_row(self.board, col)
        if r is None:
            return self._observe(0.0)  # illegal (full column) — no-op
        self.board[r][col] = 1
        if _wins(self.board, 1):
            return self._observe(self._end_game("win"))
        if not _legal(self.board):
            return self._observe(self._end_game("draw"))
        # opponent replies
        self._opponent_move()
        if _wins(self.board, 2):
            return self._observe(self._end_game("loss"))
        if not _legal(self.board):
            return self._observe(self._end_game("draw"))
        return self._observe(0.0)

    def _check_achievements(self) -> None:
        for n, aid in [(1, "win_1"), (2, "win_2"), (3, "win_3"), (5, "win_5")]:
            if self.wins >= n:
                self._unlock(aid)
        if self.wins >= GAMES and self.losses == 0:
            self._unlock("sweep")

    def legal_actions(self) -> list[str]:
        return [str(c) for c in _legal(self.board)]

    def render(self) -> str:
        sym = {0: ".", 1: "X", 2: "O"}
        head = f"game {self.game_index + 1}/{GAMES}  W{self.wins}-L{self.losses}-D{self.draws}"
        rows = ["".join(sym[v] for v in row) for row in self.board]
        return head + "\n" + "\n".join(rows)

    def _observe(self, reward: float) -> Observation:
        return Observation(
            step=self.steps,
            state={
                "board": [row[:] for row in self.board],
                "cols": COLS,
                "rows": ROWS,
                "game": self.game_index + 1,
                "games": GAMES,
                "wins": self.wins,
                "losses": self.losses,
                "draws": self.draws,
                "you": 1,
                "opponent": 2,
                "score": self.score,
            },
            text=self.render(),
            legal_actions=self.legal_actions(),
            score=float(self.score),
            done=self.done,
            reward=float(reward),
            info={"wins": self.wins, "losses": self.losses},
        )
