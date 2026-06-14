"""A strong Volley agent: predict the ball's landing x, center the paddle there.

It simulates the ball forward through wall/ceiling bounces (the same integer
physics the env uses) until the ball next descends into the paddle row, then
steers the paddle so its center lands under the ball. The structured twin of the
pixel runtime's temporal CV agent — which infers the same velocity by
differencing consecutive frames instead of reading it from state.
"""

from __future__ import annotations

from typing import Union

from steambench_harness.protocol import Observation


class VolleyPredictAgent:
    name = "predict-volley"

    def __init__(self) -> None:
        self.last_reasoning = ""

    def reset(self) -> None:
        pass

    def act(self, obs: Observation) -> Union[int, str]:
        s = obs.state
        W = s["width"]
        BS = s["ball_size"]
        PW = s["paddle_w"]
        PY = s["paddle_y"]
        px = s["paddle_x"]
        bx, by, vx, vy = s["ball_x"], s["ball_y"], s["ball_vx"], s["ball_vy"]

        # Simulate the ball forward (mirrors env physics) to its next descent into
        # the paddle row; that x is where we must be.
        tx = bx
        for _ in range(400):
            bx += vx
            by += vy
            if bx <= 0:
                bx = 0
                vx = -vx
            elif bx >= W - BS:
                bx = W - BS
                vx = -vx
            if by <= 0:
                by = 0
                vy = -vy
            if vy > 0 and by + BS >= PY:
                tx = bx
                break
        else:
            tx = bx

        target = tx + BS // 2 - PW // 2
        target = max(0, min(W - PW, target))
        self.last_reasoning = f"intercept @x{target}"
        if target < px - 1:
            return "left"
        if target > px + 1:
            return "right"
        return "stay"
