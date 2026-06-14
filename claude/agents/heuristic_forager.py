"""A capable Forager agent: greedy 2D navigation with hazard-aware look-ahead.

Each tick it scores all five moves by a potential field — attraction toward the
nearest good drop, strong repulsion from any hazard whose *next* position would
overlap or crowd the player — and takes the best. The structured twin of the
pixel runtime's 2D CV agent, which recovers the same board geometry from frames.
"""

from __future__ import annotations

from typing import Union

from steambench_harness.protocol import Observation

_MOVES = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0), "stay": (0, 0)}


class ForagerAgent:
    name = "forager-nav"

    def __init__(self) -> None:
        self.last_reasoning = ""

    def reset(self) -> None:
        pass

    def act(self, obs: Observation) -> Union[int, str]:
        s = obs.state
        W, H = s["width"], s["height"]
        PS, SPD, GS, HS = s["player_size"], s["player_speed"], s["good_size"], s["hazard_size"]
        px, py = s["player_x"], s["player_y"]
        goods, hazards = s["goods"], s["hazards"]

        pcx, pcy = px + PS / 2.0, py + PS / 2.0
        if goods:
            ng = min(goods, key=lambda g: abs(g["x"] + GS / 2.0 - pcx) + abs(g["y"] + GS / 2.0 - pcy))
            gx, gy = ng["x"] + GS / 2.0, ng["y"] + GS / 2.0
        else:
            gx, gy = pcx, pcy

        def danger(nx: float, ny: float) -> float:
            ncx, ncy = nx + PS / 2.0, ny + PS / 2.0
            total = 0.0
            for h in hazards:
                hx, hy = h["x"] + h["vx"], h["y"] + h["vy"]  # one step ahead
                dx, dy = (hx + HS / 2.0) - ncx, (hy + HS / 2.0) - ncy
                if abs(dx) < (PS + HS) / 2.0 + 1 and abs(dy) < (PS + HS) / 2.0 + 1:
                    total += 1000.0                       # would collide — avoid
                else:
                    dist2 = dx * dx + dy * dy
                    if dist2 < 30 * 30:
                        total += 250.0 / (dist2 / 80.0 + 1.0)   # crowding penalty
            return total

        best, best_score = "stay", -1e18
        for a, (dx, dy) in _MOVES.items():
            nx = max(0, min(W - PS, px + dx * SPD))
            ny = max(0, min(H - PS, py + dy * SPD))
            attract = -(abs(gx - (nx + PS / 2.0)) + abs(gy - (ny + PS / 2.0)))
            score = attract - danger(nx, ny)
            if score > best_score:
                best_score, best = score, a
        self.last_reasoning = f"→ drop @({int(gx)},{int(gy)})"
        return best
