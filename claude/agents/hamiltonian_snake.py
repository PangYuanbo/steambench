"""A near-perfect Snake agent: follow a Hamiltonian cycle of the grid.

A Hamiltonian cycle visits every cell exactly once and returns to the start, so
a snake that follows it can never trap itself — it just grows until it fills the
board. This is the AI ceiling for Snake: it reliably reaches the rare
'Space Filler' (fill-half) achievement that even the BFS agent misses.

Construction (valid because the board height is even): a boustrophedon over
columns 1..W-1 across all rows, then column 0 as the return lane. The env's
snake starts on row 6 heading right, which is aligned with the cycle, so the
body always trails safely behind the head along the cycle.
"""

from __future__ import annotations

from typing import Union

from steambench_harness.protocol import Observation

_DELTA = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}


def hamiltonian_cycle(w: int, h: int) -> list[tuple[int, int]]:
    """Ordered cells forming a Hamiltonian cycle (requires h even)."""
    order: list[tuple[int, int]] = []
    for y in range(h):
        xs = range(1, w) if y % 2 == 0 else range(w - 1, 0, -1)
        for x in xs:
            order.append((x, y))
    for y in range(h - 1, -1, -1):
        order.append((0, y))
    return order


def _dir_between(a: tuple[int, int], b: tuple[int, int]) -> str:
    dx, dy = b[0] - a[0], b[1] - a[1]
    for name, (ddx, ddy) in _DELTA.items():
        if (ddx, ddy) == (dx, dy):
            return name
    return "up"


class SnakeHamiltonianAgent:
    name = "hamiltonian-snake"

    def __init__(self) -> None:
        self.cycle: list[tuple[int, int]] = []
        self.index: dict[tuple[int, int], int] = {}
        self.last_reasoning = ""

    def reset(self) -> None:
        self.cycle = []
        self.index = {}

    def act(self, obs: Observation) -> Union[int, str]:
        s = obs.state
        w, h = s["width"], s["height"]
        head = tuple(s["head"])
        if not self.cycle:
            self.cycle = hamiltonian_cycle(w, h)
            self.index = {c: i for i, c in enumerate(self.cycle)}
        i = self.index.get(head)
        if i is None:  # head off-cycle (shouldn't happen) -> survive on a legal move
            return (obs.legal_actions or ["up"])[0]
        nxt = self.cycle[(i + 1) % len(self.cycle)]
        move = _dir_between(head, nxt)
        if move not in obs.legal_actions:
            move = (obs.legal_actions or ["up"])[0]
        self.last_reasoning = f"hamiltonian cycle ({s['length']}/{w * h} filled)"
        return move
