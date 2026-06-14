"""A strong Turret agent: track the most-imminent target, align, fire.

It aims at the lowest descending target (the next to leak), slides the cannon to
line up its centre, and fires the moment it's aligned and the bullet slot is
free. The structured twin of the pixel runtime's targeting CV agent, which
recovers the same target/cannon/bullet geometry from rendered frames.
"""

from __future__ import annotations

from typing import Union

from steambench_harness.protocol import Observation


class TurretAimAgent:
    name = "aim-turret"

    def __init__(self) -> None:
        self.last_reasoning = ""

    def reset(self) -> None:
        pass

    def act(self, obs: Observation) -> Union[int, str]:
        s = obs.state
        W = s["width"]
        CW = s["cannon_w"]
        TW = s["target_w"]
        cx = s["cannon_x"]
        targets = s["targets"]
        bullet = s["bullet"]

        if not targets:
            center = (W - CW) // 2
            self.last_reasoning = "no targets — recenter"
            return "left" if cx > center + 4 else "right" if cx < center - 4 else "stay"

        # the lowest target (largest y) is the next to leak — prioritise it
        tgt = max(targets, key=lambda t: t["y"])
        target_cx = tgt["x"] + TW // 2
        cannon_cx = cx + CW // 2

        if abs(cannon_cx - target_cx) <= 3:  # lined up
            if bullet is None:
                self.last_reasoning = f"aligned @x{target_cx} — fire"
                return "fire"
            self.last_reasoning = "aligned — bullet in flight"
            return "stay"
        self.last_reasoning = f"tracking lowest target @x{target_cx}"
        return "left" if target_cx < cannon_cx else "right"
