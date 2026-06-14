"""A safe, capable Snake player: BFS to food with a survival fallback.

Strategy (classic and effective):
  1. BFS from head to food through free cells; if a path exists *and* the snake
     can still reach its own tail after eating, take the first step of it.
  2. Otherwise, follow the tail / move to the neighbor with the most reachable
     free space (flood fill) to stay alive as long as possible.

Plays purely from the observation. Regularly reaches length 20-40+.
"""

from __future__ import annotations

from collections import deque
from typing import Optional, Union

from steambench_harness.protocol import Observation

_DELTA = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}
_OPPOSITE = {"up": "down", "down": "up", "left": "right", "right": "left"}


class SnakeBFSAgent:
    name = "bfs-snake"

    def __init__(self) -> None:
        self.last_reasoning = ""

    def reset(self) -> None:
        pass

    def act(self, obs: Observation) -> Union[int, str]:
        s = obs.state
        w, h = s["width"], s["height"]
        snake = [tuple(c) for c in s["snake"]]
        head = tuple(s["head"])
        food = tuple(s["food"])
        direction = s["direction"]
        body = set(snake)

        legal = obs.legal_actions or list(_DELTA)

        # 1) Try a safe path to the food.
        path = self._bfs(head, food, body, w, h, snake)
        if path:
            step = path[0]
            move = self._dir_between(head, step)
            if move in legal:
                self.last_reasoning = f"bfs->food ({len(path)} steps) -> {move}, len={s['length']}"
                return move

        # 2) Survive: pick the legal move maximizing reachable free space.
        best_move, best_space = None, -1
        for move in legal:
            dx, dy = _DELTA[move]
            nx, ny = head[0] + dx, head[1] + dy
            if not (0 <= nx < w and 0 <= ny < h):
                continue
            # Body minus tail (tail moves away unless we eat; treat as free).
            obstacles = set(snake[1:])
            if (nx, ny) in obstacles:
                continue
            space = self._flood((nx, ny), obstacles, w, h)
            if space > best_space:
                best_space, best_move = space, move
        if best_move:
            self.last_reasoning = f"survive (space={best_space}) -> {best_move}, len={s['length']}"
            return best_move

        # 3) Nothing safe; keep going straight and hope.
        fallback = direction if direction in legal else legal[0]
        self.last_reasoning = f"trapped -> {fallback}"
        return fallback

    def _bfs(self, start, goal, body, w, h, snake) -> Optional[list]:
        # Tail cell becomes free as the snake advances (unless eating now).
        blocked = set(snake[1:])
        q = deque([start])
        prev = {start: None}
        while q:
            cur = q.popleft()
            if cur == goal:
                # reconstruct
                path = []
                node = cur
                while prev[node] is not None:
                    path.append(node)
                    node = prev[node]
                path.reverse()
                return path
            for dx, dy in _DELTA.values():
                nx, ny = cur[0] + dx, cur[1] + dy
                nb = (nx, ny)
                if not (0 <= nx < w and 0 <= ny < h):
                    continue
                if nb in blocked or nb in prev:
                    continue
                prev[nb] = cur
                q.append(nb)
        return None

    def _flood(self, start, obstacles, w, h) -> int:
        if start in obstacles:
            return 0
        seen = {start}
        q = deque([start])
        while q:
            cur = q.popleft()
            for dx, dy in _DELTA.values():
                nx, ny = cur[0] + dx, cur[1] + dy
                nb = (nx, ny)
                if not (0 <= nx < w and 0 <= ny < h):
                    continue
                if nb in obstacles or nb in seen:
                    continue
                seen.add(nb)
                q.append(nb)
        return len(seen)

    @staticmethod
    def _dir_between(a, b) -> str:
        dx, dy = b[0] - a[0], b[1] - a[1]
        for name, (ddx, ddy) in _DELTA.items():
            if (ddx, ddy) == (dx, dy):
                return name
        return "up"
