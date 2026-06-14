"""A capable Phantom agent: remember the blocks through the blackout, then dodge.

It keeps a memory of block positions. While the blocks are visible it refreshes
the memory from what it sees; while they're hidden it extrapolates (each block
keeps falling) and dodges against that recalled world with a short rollout. The
structured twin of the pixel runtime's memory CV agent — same recall + dodge,
perception from state here and from frames there. (It can't see blocks that
spawn during a blackout, which is exactly the residual risk that makes the game
hard.)
"""

from __future__ import annotations

from typing import Union

from steambench_harness.protocol import Observation

LOOKAHEAD = 60
HORIZON = 16


class PhantomMemoryAgent:
    name = "memory-phantom"

    def __init__(self) -> None:
        self.last_reasoning = ""
        self.memory: list[list[int]] = []

    def reset(self) -> None:
        self.memory = []

    @staticmethod
    def _greedy(px: int, blocks, g) -> str:
        W, PW, PY, PH, BW, BH = g["W"], g["PW"], g["PY"], g["PH"], g["BW"], g["BH"]
        band_top = PY - LOOKAHEAD
        occ = bytearray(W)
        for bx, by in blocks:
            if by + BH > band_top and by < PY + PH:
                for c in range(max(0, bx), min(W, bx + BW)):
                    occ[c] = 1
        if not any(occ):
            center = (W - PW) // 2
            return "left" if px > center + 4 else "right" if px < center - 4 else "stay"
        max_x = W - PW
        safe = [x for x in range(max_x + 1) if not any(occ[x:x + PW])]
        target = (min(safe, key=lambda x: abs(x - px)) if safe
                  else min(range(max_x + 1), key=lambda x: sum(occ[x:x + PW])))
        return "left" if target < px - 1 else "right" if target > px + 1 else "stay"

    @staticmethod
    def _rollout(px: int, blocks, first: str, g) -> int:
        W, PW, PY, PH, BW, BH = g["W"], g["PW"], g["PY"], g["PH"], g["BW"], g["BH"]
        H, FALL, SPD = g["H"], g["FALL"], g["SPD"]

        def advance(p, blks, action):
            if action == "left":
                p = max(0, p - SPD)
            elif action == "right":
                p = min(W - PW, p + SPD)
            blks = [[bx, by + FALL] for bx, by in blks if by + FALL < H]
            for bx, by in blks:
                if bx < p + PW and bx + BW > p and by < PY + PH and by + BH > PY:
                    return p, blks, True
            return p, blks, False

        blks = [[bx, by] for bx, by in blocks]
        p, blks, dead = advance(px, blks, first)
        if dead:
            return 0
        survived = 1
        for _ in range(HORIZON - 1):
            a = PhantomMemoryAgent._greedy(p, blks, g)
            p, blks, dead = advance(p, blks, a)
            if dead:
                break
            survived += 1
        return survived

    def act(self, obs: Observation) -> Union[int, str]:
        s = obs.state
        g = {
            "W": s["width"], "H": s["height"], "PW": s["paddle_w"], "PH": s["paddle_h"],
            "PY": s["paddle_y"], "BW": s["block_w"], "BH": s["block_h"],
            "FALL": s["fall"], "SPD": s.get("paddle_speed", 7),
        }
        px = s["paddle_x"]
        if s["visible"]:
            self.memory = [[b["x"], b["y"]] for b in s["blocks"]]   # refresh from sight
        else:
            for m in self.memory:
                m[1] += g["FALL"]                                   # recall: keep them falling
            self.memory = [m for m in self.memory if m[1] < g["H"]]
        blocks = [(m[0], m[1]) for m in self.memory]

        results = [(self._rollout(px, blocks, a, g), a) for a in ("left", "stay", "right")]
        best = max(v for v, _ in results)
        greedy = self._greedy(px, blocks, g)
        winners = [a for v, a in results if v == best]
        choice = greedy if greedy in winners else winners[0]
        seen = "see" if s["visible"] else "DARK·recall"
        self.last_reasoning = f"{seen} {len(blocks)} → {choice}"
        return choice
