"""A strong Rally agent: predict where the ball reaches your paddle, be there.

When the ball is coming toward it, the agent simulates the ball forward through
its wall bounces (the same integer physics the env uses) to its paddle plane and
moves to intercept; when the ball is heading to the opponent it recenters to
cover the return. The structured twin of the pixel runtime's adversarial CV
agent, which recovers the ball + paddles from frames.
"""

from __future__ import annotations

from typing import Union

from steambench_harness.protocol import Observation


class RallyPredictAgent:
    name = "predict-rally"

    def __init__(self) -> None:
        self.last_reasoning = ""

    def reset(self) -> None:
        pass

    def act(self, obs: Observation) -> Union[int, str]:
        s = obs.state
        H = s["height"]
        PADH = s["paddle_h"]
        AGENT_X = s["agent_x"]
        PADW = s["paddle_w"]
        BS = s["ball_size"]
        ay = s["agent_y"]
        bx, by, vx, vy = s["ball_x"], s["ball_y"], s["ball_vx"], s["ball_vy"]

        if vx < 0:
            sx, sy, svy = bx, by, vy
            ty = by
            for _ in range(400):
                sx += vx
                sy += svy
                if sy <= 0:
                    sy = 0
                    svy = -svy
                elif sy >= H - BS:
                    sy = H - BS
                    svy = -svy
                if sx <= AGENT_X + PADW:
                    ty = sy
                    break
            else:
                ty = sy
            desired = (ty + BS // 2) - PADH // 2   # center the paddle on the predicted ball
            self.last_reasoning = f"intercept @y{int(ty + BS // 2)}"
        else:
            desired = H // 2 - PADH // 2  # ball heading away — recenter to cover the return
            self.last_reasoning = "recenter"

        desired = max(0, min(H - PADH, desired))
        if desired < ay - 1:
            return "up"
        if desired > ay + 1:
            return "down"
        return "stay"
