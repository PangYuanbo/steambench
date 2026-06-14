"""A Sokoban solver agent: BFS over (player, boxes) states per level.

Plays purely from the observation. Plans the current level once (with simple
corner-deadlock pruning), executes the moves, and replans when the env advances
to the next level. The levels are tiny, so BFS is fast and optimal in pushes.
"""

from __future__ import annotations

from collections import deque
from typing import Optional

from steambench_harness.protocol import Observation

_DELTA = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}


class SokobanSolverAgent:
    name = "solver-sokoban"

    def __init__(self, node_cap: int = 200_000) -> None:
        self.node_cap = node_cap
        self.plan: list[str] = []
        self.planned_level: Optional[int] = None
        self.last_reasoning = ""

    def reset(self) -> None:
        self.plan = []
        self.planned_level = None

    def act(self, obs: Observation):
        s = obs.state
        level = s["level_index"]
        if level != self.planned_level or not self.plan:
            self.plan = self._solve(s) or []
            self.planned_level = level
            self.last_reasoning = (
                f"solved level {level + 1} in {len(self.plan)} moves"
                if self.plan else f"level {level + 1}: no plan found"
            )
        if self.plan:
            return self.plan.pop(0)
        # No plan (shouldn't happen for these levels) — restart and hope.
        return "restart"

    def _solve(self, s) -> Optional[list[str]]:
        walls = {tuple(p) for p in s["walls"]}
        goals = frozenset(tuple(p) for p in s["goals"])
        boxes0 = frozenset(tuple(p) for p in s["boxes"])
        player0 = tuple(s["player"])

        if boxes0 == goals:
            return []

        def deadlocked(boxes) -> bool:
            # A box in a non-goal corner can never be moved out → prune.
            for (x, y) in boxes:
                if (x, y) in goals:
                    continue
                up = (x, y - 1) in walls
                down = (x, y + 1) in walls
                left = (x - 1, y) in walls
                right = (x + 1, y) in walls
                if (up or down) and (left or right):
                    return True
            return False

        start = (player0, boxes0)
        prev: dict = {start: (None, None)}
        q = deque([start])
        nodes = 0
        while q and nodes < self.node_cap:
            player, boxes = q.popleft()
            nodes += 1
            for name, (dx, dy) in _DELTA.items():
                nx, ny = player[0] + dx, player[1] + dy
                target = (nx, ny)
                if target in walls:
                    continue
                if target in boxes:
                    beyond = (nx + dx, ny + dy)
                    if beyond in walls or beyond in boxes:
                        continue
                    new_boxes = frozenset((boxes - {target}) | {beyond})
                    new_state = (target, new_boxes)
                    if new_state in prev or deadlocked(new_boxes):
                        continue
                    prev[new_state] = ((player, boxes), name)
                    if new_boxes == goals:
                        return self._reconstruct(prev, new_state)
                    q.append(new_state)
                else:
                    new_state = (target, boxes)
                    if new_state in prev:
                        continue
                    prev[new_state] = ((player, boxes), name)
                    q.append(new_state)
        return None

    @staticmethod
    def _reconstruct(prev, state) -> list[str]:
        moves = []
        while prev[state][0] is not None:
            parent, mv = prev[state]
            moves.append(mv)
            state = parent
        moves.reverse()
        return moves
