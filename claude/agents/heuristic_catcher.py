"""A strong Catcher agent: rollout that maximizes catches while staying alive.

Each tick it tries left/stay/right, simulates ~16 ticks of a greedy "go to the
nearest safely-catchable good, else dodge the bad" continuation, and scores the
result: surviving dominates, then goods caught, then time alive. The structured
twin of the pixel runtime's two-class CV agent — same plan, perception from
state here and from pixels there.
"""

from __future__ import annotations

from typing import Union

from steambench_harness.protocol import Observation

LOOKAHEAD = 70   # how far up to consider items (px above the paddle)
HORIZON = 16     # rollout depth (ticks)


def _toward(px: int, target: int) -> str:
    if target < px - 1:
        return "left"
    if target > px + 1:
        return "right"
    return "stay"


class CatcherHeuristicAgent:
    name = "heuristic-catcher"

    def __init__(self) -> None:
        self.last_reasoning = ""

    def reset(self) -> None:
        pass

    @staticmethod
    def _danger(items, g) -> bytearray:
        W, PY, PH, IW, IH = g["W"], g["PY"], g["PH"], g["IW"], g["IH"]
        band_top = PY - g["LOOK"]
        occ = bytearray(W)
        for x, y, k in items:
            if k == 1 and y + IH > band_top and y < PY + PH:
                for c in range(max(0, x), min(W, x + IW)):
                    occ[c] = 1
        return occ

    @staticmethod
    def _greedy(px: int, items, g) -> str:
        W, PW, PY, PH, IW, IH = g["W"], g["PW"], g["PY"], g["PH"], g["IW"], g["IH"]
        occ = CatcherHeuristicAgent._danger(items, g)
        max_x = W - PW

        def span_bad(x: int) -> int:
            return sum(occ[x:x + PW])

        # 1) Survival first: if the paddle is standing in a bad's path, flee to the
        #    nearest fully-safe column (never chase a good into a red).
        if span_bad(px) > 0:
            safe = [x for x in range(max_x + 1) if span_bad(x) == 0]
            target = (min(safe, key=lambda x: abs(x - px)) if safe
                      else min(range(max_x + 1), key=span_bad))
            return _toward(px, target)

        # 2) Safe: go catch the most imminent good whose catch-spot is also safe.
        greens = [(x, y) for x, y, k in items if k == 0 and y < PY + PH and y + IH > PY - g["LOOK"]]
        greens.sort(key=lambda t: -t[1])
        for gx, _gy in greens:
            desired = min(max_x, max(0, gx + IW // 2 - PW // 2))
            if span_bad(desired) == 0:
                return _toward(px, desired)

        # 3) Nothing safely catchable: hold position (already safe).
        return "stay"

    @staticmethod
    def _rollout(px: int, items, first: str, g) -> float:
        W, PW, PY, PH, IW, IH = g["W"], g["PW"], g["PY"], g["PH"], g["IW"], g["IH"]
        H, FALL, SPD = g["H"], g["FALL"], g["SPD"]

        def advance(p, its, action):
            if action == "left":
                p = max(0, p - SPD)
            elif action == "right":
                p = min(W - PW, p + SPD)
            for it in its:
                it[1] += FALL
            gained, dead, surv = 0, False, []
            for x, y, k in its:
                if x < p + PW and x + IW > p and y < PY + PH and y + IH > PY:
                    if k == 1:
                        dead = True
                    else:
                        gained += 1
                    continue
                if y >= H:
                    continue
                surv.append([x, y, k])
            return p, surv, gained, dead

        its = [list(it) for it in items]
        p, its, gained, dead = advance(px, its, first)
        total, tick = gained, 1
        if dead:
            return total * 1000 + tick  # died now — worst class, but prefer catches
        for _ in range(HORIZON - 1):
            a = CatcherHeuristicAgent._greedy(p, its, g)
            p, its, gN, dead = advance(p, its, a)
            total += gN
            tick += 1
            if dead:
                return total * 1000 + tick  # died later — still the "died" class
        return 1_000_000 + total * 1000 + tick  # survived the horizon — dominant class

    def act(self, obs: Observation) -> Union[int, str]:
        s = obs.state
        g = {
            "W": s["width"], "H": s["height"], "PW": s["paddle_w"], "PH": s["paddle_h"],
            "PY": s["paddle_y"], "IW": s["item_w"], "IH": s["item_h"],
            "FALL": s["fall"], "SPD": s.get("paddle_speed", 7), "LOOK": LOOKAHEAD,
        }
        px = s["paddle_x"]
        items = [(it["x"], it["y"], it["kind"]) for it in s["items"]]
        results = [(self._rollout(px, items, a, g), a) for a in ("left", "stay", "right")]
        best = max(v for v, _ in results)
        greedy = self._greedy(px, items, g)
        winners = [a for v, a in results if v == best]
        choice = greedy if greedy in winners else winners[0]
        self.last_reasoning = f"catch rollout {int(best % 1000)} → {choice}"
        return choice
