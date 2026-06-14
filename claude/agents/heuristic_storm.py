"""A strong Storm agent: freeze-rollout that respects each block's own speed.

Each tick it tries left/stay/right, then simulates ~16 ticks forward — every
block falling at ITS velocity, the paddle playing a greedy "flee the columns a
block will arrive in soon" continuation — and commits to the longest-surviving
move. The greedy uses time-to-arrival (fast far blocks are urgent; slow near
ones less so), which is exactly the multi-object temporal reasoning the pixel
runtime's CV agent must recover from frames.
"""

from __future__ import annotations

from typing import Union

from steambench_harness.protocol import Observation

LOOKAHEAD_T = 13   # danger horizon, in ticks-to-arrival
HORIZON = 16       # rollout depth (ticks)


def _toward(px: int, target: int) -> str:
    return "left" if target < px - 1 else "right" if target > px + 1 else "stay"


class StormRolloutAgent:
    name = "rollout-storm"

    def __init__(self) -> None:
        self.last_reasoning = ""

    def reset(self) -> None:
        pass

    @staticmethod
    def _greedy(px: int, blocks, g) -> str:
        W, PW, PY, PH, BW, BH = g["W"], g["PW"], g["PY"], g["PH"], g["BW"], g["BH"]
        occ = bytearray(W)
        for bx, by, vy in blocks:
            if vy <= 0:
                continue
            t = (PY - (by + BH)) / vy   # ticks until this block reaches the paddle row
            if t <= LOOKAHEAD_T:        # arriving soon (or already overlapping)
                for c in range(max(0, bx), min(W, bx + BW)):
                    occ[c] = 1
        if not any(occ):
            center = (W - PW) // 2
            if px > center + 4:
                return "left"
            if px < center - 4:
                return "right"
            return "stay"
        max_x = W - PW
        safe = [x for x in range(max_x + 1) if not any(occ[x:x + PW])]
        target = (min(safe, key=lambda x: abs(x - px)) if safe
                  else min(range(max_x + 1), key=lambda x: sum(occ[x:x + PW])))
        return _toward(px, target)

    @staticmethod
    def _rollout(px: int, blocks, first: str, g) -> int:
        W, PW, PY, PH, BW, BH = g["W"], g["PW"], g["PY"], g["PH"], g["BW"], g["BH"]
        H, SPD = g["H"], g["SPD"]

        def advance(p, blks, action):
            if action == "left":
                p = max(0, p - SPD)
            elif action == "right":
                p = min(W - PW, p + SPD)
            for b in blks:
                b[1] += b[2]
            blks = [b for b in blks if b[1] < H]
            for bx, by, _vy in blks:
                if bx < p + PW and bx + BW > p and by < PY + PH and by + BH > PY:
                    return p, blks, True
            return p, blks, False

        blks = [list(b) for b in blocks]
        p, blks, dead = advance(px, blks, first)
        if dead:
            return 0
        survived = 1
        for _ in range(HORIZON - 1):
            a = StormRolloutAgent._greedy(p, [(b[0], b[1], b[2]) for b in blks], g)
            p, blks, dead = advance(p, blks, a)
            if dead:
                break
            survived += 1
        return survived

    def act(self, obs: Observation) -> Union[int, str]:
        s = obs.state
        g = {
            "W": s["width"], "H": s["height"], "PW": s["paddle_w"], "PH": s["paddle_h"],
            "PY": s["paddle_y"], "BW": s["block_w"], "BH": s["block_h"], "SPD": s.get("paddle_speed", 7),
        }
        px = s["paddle_x"]
        blocks = [(b["x"], b["y"], b["vy"]) for b in s["blocks"]]
        results = [(self._rollout(px, blocks, a, g), a) for a in ("left", "stay", "right")]
        best = max(v for v, _ in results)
        greedy = self._greedy(px, blocks, g)
        winners = [a for v, a in results if v == best]
        choice = greedy if greedy in winners else winners[0]
        self.last_reasoning = f"rollout {best}t → {choice}"
        return choice
