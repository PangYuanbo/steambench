"""An LLM agent that plays arcade games by reasoning over the text board.

This is the headline "watch an AI think while it plays" agent. It sends the
ASCII board + legal actions to an LLM and asks for the next move plus a one-line
rationale, which the livestream surfaces. Uses the OpenAI SDK and the
``OPENAI_API_KEY`` env var; degrades to a clear error if neither is present.

Because the *env* is deterministic, the recorded action trace replay-verifies
exactly even though the agent itself is stochastic.
"""

from __future__ import annotations

import json
import os
import re
from typing import Optional, Union

from steambench_harness.protocol import Observation

_SYSTEM = {
    "arcade/2048": (
        "You are an expert 2048 player. The board is 4x4; '.' is empty. Moves "
        "slide ALL tiles that direction and merge equal adjacent tiles. Strategy: "
        "keep your largest tile pinned in one corner, build a monotonic gradient, "
        "and avoid moves that break it. Pick the single best legal move."
    ),
    "arcade/snake": (
        "You are an expert Snake player on a grid. '@' is your head, 'o' your "
        "body, '*' the food, '.' empty. You move every tick; eating food grows "
        "you. Avoid walls and your own body; plan a safe route toward the food "
        "that doesn't trap you. Pick the single best legal move."
    ),
}


class OpenAILLMAgent:
    """Plays via an OpenAI chat model. One call per step (bound max_steps!)."""

    name = "llm"

    def __init__(
        self,
        model: str = "gpt-4o-mini",
        env_id: str = "arcade/2048",
        api_key: Optional[str] = None,
        temperature: float = 0.2,
    ) -> None:
        self.model = model
        self.env_id = env_id
        self.temperature = temperature
        self.last_reasoning = ""
        self._client = None
        self._api_key = api_key or os.environ.get("OPENAI_API_KEY")

    def reset(self) -> None:
        self.last_reasoning = ""

    def _ensure_client(self):
        if self._client is not None:
            return
        if not self._api_key:
            raise RuntimeError("OPENAI_API_KEY not set; cannot run the LLM agent.")
        try:
            from openai import OpenAI
        except ImportError as e:  # noqa
            raise RuntimeError("pip install openai to use the LLM agent") from e
        # Generous retries so transient 429s back off instead of degrading the
        # agent to a blind fallback move (which would misrepresent its ability).
        self._client = OpenAI(api_key=self._api_key, max_retries=6, timeout=30)

    def act(self, obs: Observation) -> Union[int, str]:
        self._ensure_client()
        legal = obs.legal_actions or ["up", "down", "left", "right"]
        system = _SYSTEM.get(self.env_id, "You are an expert game-playing agent.")
        user = (
            f"Current board (step {obs.step}, score {obs.score}):\n"
            f"{obs.text}\n\n"
            f"Legal moves: {legal}\n"
            'Respond ONLY as JSON: {"reason": "<=12 words", "move": "<one legal move>"}'
        )
        try:
            resp = self._client.chat.completions.create(
                model=self.model,
                temperature=self.temperature,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                max_tokens=80,
                response_format={"type": "json_object"},
            )
            content = resp.choices[0].message.content or "{}"
            data = json.loads(content)
            move = str(data.get("move", "")).strip().lower()
            self.last_reasoning = str(data.get("reason", ""))[:120]
        except Exception as e:  # noqa: BLE001 - any API/parse hiccup -> safe fallback
            self.last_reasoning = f"(fallback: {type(e).__name__})"
            move = ""

        if move not in legal:
            # Salvage a legal token if the model named one anywhere, else fall back.
            m = re.search(r"\b(up|down|left|right)\b", move)
            move = m.group(1) if (m and m.group(1) in legal) else legal[0]
        return move
