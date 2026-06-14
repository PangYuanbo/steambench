"""A strong Dodger agent: short freeze-rollout look-ahead over the three moves.

Each tick it tries every immediate move (left / stay / right), then *simulates*
the next ~18 ticks forward — blocks keep falling, the paddle keeps playing the
greedy "steer for the nearest clear gap" continuation — and counts how long it
survives. It commits to the move with the longest projected survival, breaking
ties toward the greedy choice and the center. Re-planning every tick absorbs
the new blocks the rollout doesn't model. This reliably tops out the survival
ladder (it is the "AI to beat"); it is the structured-state twin of the pixel
runtime's CV agent, which does the same reasoning from raw frames.
"""

from __future__ import annotations

from typing import Union

from steambench_harness.protocol import Observation

LOOKAHEAD = 60   # danger-band depth (px) for the greedy continuation
HORIZON = 18     # rollout depth (ticks)


class DodgerHeuristicAgent:
    name = "heuristic-dodger"

    def __init__(self) -> None:
        self.last_reasoning = ""

    def reset(self) -> None:
        pass

    # ---- the greedy continuation (also the standalone fallback) ----------- #

    @staticmethod
    def _greedy(px: int, hazards: list[tuple[int, int]], g: dict) -> str:
        W, PW, PY, PH = g["W"], g["PW"], g["PY"], g["PH"]
        HW, HH = g["HW"], g["HH"]
        band_top = PY - LOOKAHEAD
        occ = bytearray(W)
        for hx, hy in hazards:
            if hy + HH > band_top and hy < PY + PH:
                for x in range(max(0, hx), min(W, hx + HW)):
                    occ[x] = 1
        if not any(occ):
            center = (W - PW) // 2
            if px > center + 4:
                return "left"
            if px < center - 4:
                return "right"
            return "stay"
        max_x = W - PW
        safe = [x for x in range(max_x + 1) if not any(occ[x:x + PW])]
        if safe:
            target = min(safe, key=lambda x: abs(x - px))
        else:
            target = min(range(max_x + 1), key=lambda x: sum(occ[x:x + PW]))
        if target < px - 1:
            return "left"
        if target > px + 1:
            return "right"
        return "stay"

    # ---- one freeze-rollout (mirrors env.step physics, ignores new spawns) - #

    @staticmethod
    def _rollout(px: int, hazards: list[tuple[int, int]], first: str, g: dict) -> int:
        W, PW, PY, PH = g["W"], g["PW"], g["PY"], g["PH"]
        HW, HH, H, FALL, SPD = g["HW"], g["HH"], g["H"], g["FALL"], g["SPD"]
        haz = [list(h) for h in hazards]

        def advance(p: int, haz: list, action: str):
            if action == "left":
                p = max(0, p - SPD)
            elif action == "right":
                p = min(W - PW, p + SPD)
            for hz in haz:
                hz[1] += FALL
            haz = [h for h in haz if h[1] < H]
            for hx, hy in haz:
                if hx < p + PW and hx + HW > p and hy < PY + PH and hy + HH > PY:
                    return p, haz, True
            return p, haz, False

        p, haz, dead = advance(px, haz, first)
        if dead:
            return 0
        survived = 1
        for _ in range(HORIZON - 1):
            a = DodgerHeuristicAgent._greedy(p, [(h[0], h[1]) for h in haz], g)
            p, haz, dead = advance(p, haz, a)
            if dead:
                break
            survived += 1
        return survived

    def act(self, obs: Observation) -> Union[int, str]:
        s = obs.state
        g = {
            "W": s["width"], "H": s["height"], "PW": s["paddle_w"], "PH": s["paddle_h"],
            "PY": s["paddle_y"], "HW": s["hazard_w"], "HH": s["hazard_h"],
            "FALL": s["fall"], "SPD": s.get("paddle_speed", 7),
        }
        px = s["paddle_x"]
        hazards = [(h["x"], h["y"]) for h in s["hazards"]]

        results = [(self._rollout(px, hazards, a, g), a) for a in ("left", "stay", "right")]
        best = max(r[0] for r in results)
        greedy = self._greedy(px, hazards, g)
        # among the longest-surviving first moves, prefer the greedy pick, else center-ward.
        winners = [a for v, a in results if v == best]
        if greedy in winners:
            choice = greedy
        else:
            center = (g["W"] - g["PW"]) // 2
            choice = min(winners, key=lambda a: abs((px - g["SPD"] if a == "left" else px + g["SPD"] if a == "right" else px) - center))
        self.last_reasoning = f"rollout {best}t → {choice}"
        return choice
