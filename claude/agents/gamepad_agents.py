"""Reference agents whose action space is a **gamepad** — for real Steam games
streamed via GeForce NOW (see ``steambench_harness.realgame``).

Three references, mirroring the arcade lineup:

* :class:`RandomGamepadAgent` — samples plausible controller frames; the smoke
  test / floor baseline.
* :class:`ScriptedGamepadAgent` — replays a fixed ``[(repeat, action), …]``
  program; deterministic, handy for demos and adapter bring-up.
* :class:`VisionGamepadAgent` — the headline: reads the streamed **frame** and
  asks a vision model for the next :class:`GamepadAction`. The model is
  pluggable (``policy``); the default targets an OpenAI vision model via
  ``OPENAI_API_KEY`` and degrades to a safe neutral frame if no key/quota — so
  the integration is real even where this machine can't call a model.

All three return objects the env's gamepad action space coerces (a
:class:`GamepadAction`, a dict, or a token string), so they drop straight into
``run_episode`` with no special-casing.
"""

from __future__ import annotations

import json
import os
from typing import Callable, Optional, Sequence, Union

from steambench_harness.gamepad import NEUTRAL, STANDARD_GAMEPAD, GamepadAction, GamepadActionSpace
from steambench_harness.protocol import Observation
from steambench_harness.rng import Mulberry32


class RandomGamepadAgent:
    """Samples a plausible controller frame each step (floor baseline)."""

    name = "gamepad-random"

    def __init__(self, seed: int = 0, space: GamepadActionSpace = STANDARD_GAMEPAD) -> None:
        self.space = space
        self._seed = seed
        self.last_reasoning = ""

    def reset(self) -> None:
        self.rng = Mulberry32(self._seed)

    def act(self, obs: Observation) -> GamepadAction:
        if not hasattr(self, "rng"):
            self.reset()
        ga = self.space.sample(self.rng)
        self.last_reasoning = f"random {ga}"
        return ga


class ScriptedGamepadAgent:
    """Replays a fixed program ``[(repeat, action), …]`` then idles. Deterministic
    — ideal for demoing the stream and bringing up the GeForce NOW adapter."""

    name = "gamepad-scripted"

    def __init__(self, program: Sequence[tuple[int, object]]) -> None:
        self.program = list(program)
        self.last_reasoning = ""

    def reset(self) -> None:
        self._flat: list[object] = []
        for repeat, action in self.program:
            self._flat.extend([action] * int(repeat))
        self._i = 0

    def act(self, obs: Observation) -> Union[GamepadAction, dict, str]:
        if not hasattr(self, "_flat"):
            self.reset()
        if self._i < len(self._flat):
            action = self._flat[self._i]
            self._i += 1
            self.last_reasoning = f"scripted step {self._i}/{len(self._flat)}"
            return action
        self.last_reasoning = "program complete — idle"
        return NEUTRAL


class VisionGamepadAgent:
    """Plays a real game from pixels, emitting controller frames.

    Each step: take ``obs.frame`` (base64 PNG of the live screen), hand it to a
    vision ``policy`` along with the controller's :meth:`GamepadActionSpace.describe`
    contract and a short goal, and coerce the returned JSON into a
    :class:`GamepadAction`. Swap in any model by passing ``policy=your_fn``;
    ``policy(frame_b64, obs, controls) -> dict | GamepadAction | str``.
    """

    name = "gamepad-vision"

    def __init__(
        self,
        goal: str = "Make progress and unlock achievements.",
        *,
        space: GamepadActionSpace = STANDARD_GAMEPAD,
        policy: Optional[Callable[[str, Observation, str], object]] = None,
        model: str = "gpt-4o-mini",
        api_key: Optional[str] = None,
    ) -> None:
        self.goal = goal
        self.space = space
        self.model = model
        self.last_reasoning = ""
        self._policy = policy
        self._client = None
        self._api_key = api_key or os.environ.get("OPENAI_API_KEY")

    def reset(self) -> None:
        self.last_reasoning = ""

    # -- default OpenAI vision policy (pluggable) --------------------------- #

    def _openai_policy(self, frame_b64: str, obs: Observation, controls: str) -> object:
        if self._client is None:
            if not self._api_key:
                raise RuntimeError("OPENAI_API_KEY not set")
            from openai import OpenAI  # lazy

            self._client = OpenAI(api_key=self._api_key, max_retries=4, timeout=30)
        prompt = (
            f"You are playing a video game and control it with a gamepad.\n{controls}\n\n"
            f"Goal: {self.goal}\n"
            f"Step {obs.step}. Look at the screenshot and choose the controller frame "
            f"for THIS instant. Respond ONLY as JSON: "
            f'{{"reason": "<=12 words", "buttons": [...], "lx": 0.0, "ly": 0.0, '
            f'"rx": 0.0, "ry": 0.0, "lt": 0.0, "rt": 0.0}}'
        )
        resp = self._client.chat.completions.create(
            model=self.model,
            temperature=0.3,
            max_tokens=120,
            response_format={"type": "json_object"},
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url",
                     "image_url": {"url": f"data:image/png;base64,{frame_b64}"}},
                ],
            }],
        )
        return resp.choices[0].message.content or "{}"

    def act(self, obs: Observation) -> GamepadAction:
        controls = self.space.describe()
        frame = obs.frame
        if not frame:
            self.last_reasoning = "(no frame yet)"
            return NEUTRAL
        policy = self._policy or self._openai_policy
        try:
            raw = policy(frame, obs, controls)
            if isinstance(raw, str):
                data = json.loads(raw)
                self.last_reasoning = str(data.get("reason", ""))[:120]
                action: object = data
            elif isinstance(raw, dict):
                self.last_reasoning = str(raw.get("reason", ""))[:120]
                action = raw
            else:
                action = raw  # already a GamepadAction
                self.last_reasoning = f"policy -> {raw}"
        except Exception as e:  # noqa: BLE001 — any model/parse hiccup -> safe neutral
            self.last_reasoning = f"(fallback: {type(e).__name__})"
            return NEUTRAL
        return self.space.coerce(action)
