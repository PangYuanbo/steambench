"""Real games — the GeForce NOW bridge.

The arcade envs are a deterministic stand-in for "AI plays games". The real
thing is a genuine Steam title, streamed through **GeForce NOW**, driven by the
same agent contract — except the action space is a *gamepad* (see
:mod:`steambench_harness.gamepad`) and verification is out-of-band via the Steam
Web API (achievements actually unlocked on the account), since a real game can't
be replayed.

This module is deliberately split so the platform is complete *before* GeForce
NOW is connected:

* :class:`GameSession` — the **adapter contract**. The platform calls four
  methods; you implement them against GeForce NOW. That's the only integration
  surface.
* :class:`RealGameEnv` — a normal :class:`~steambench_harness.protocol.Env`
  (so it flows through ``run_episode``, the catalog, the livestream) whose
  observation is the streamed frame and whose action is a
  :class:`~steambench_harness.gamepad.GamepadAction`.
* :class:`MockGameSession` — a fully working fake session (renders a frame that
  visualizes the live controller state, fires achievements on a schedule) so the
  end-to-end loop is testable today, with no cloud and no real game.

Wiring GeForce NOW later means implementing :class:`GameSession`:

* ``frame()``        → capture the streamed video (one PNG). Screen-grab the GFN
                       window / decode the WebRTC track.
* ``apply(action)``  → inject controller input. A virtual pad (ViGEm /
                       ``vgamepad`` on Windows) maps the :class:`GamepadAction`
                       floats to XInput; GeForce NOW forwards it to the game.
* ``achievements()`` → poll ``ISteamUserStats/GetPlayerAchievements`` for the
                       bound account + appid.
* ``status()``       → optional liveness/score scrape; may return ``{}``.
"""

from __future__ import annotations

import abc
import base64
import io
from dataclasses import dataclass, field
from typing import Optional

from .gamepad import STANDARD_GAMEPAD, GamepadAction, GamepadActionSpace
from .protocol import AchievementSpec, Env, Observation, VerifyMode


@dataclass
class GameSession(abc.ABC):
    """The single integration surface between the platform and a live game.

    A session represents one connected, streaming game. The platform never
    knows whether the bytes came from GeForce NOW, a local capture card, or a
    mock — it only calls these methods.
    """

    appid: int

    @abc.abstractmethod
    def start(self, *, seed: Optional[int] = None) -> None:
        """Connect/launch the game and block until the first frame is ready."""

    @abc.abstractmethod
    def frame(self) -> bytes:
        """Return the current game screen as PNG bytes."""

    @abc.abstractmethod
    def apply(self, action: GamepadAction) -> None:
        """Inject one frame of controller input into the live stream."""

    def achievements(self) -> set[str]:
        """Steam achievement ids unlocked on the bound account so far.
        Override against the Steam Web API; default = none yet."""
        return set()

    def status(self) -> dict:
        """Optional scraped/engine state (score, lives, 'game over'…). May be
        empty. A truthy ``status()["done"]`` ends the episode."""
        return {}

    def close(self) -> None:
        """Tear down the stream/virtual pad. Default no-op."""


class RealGameEnv(Env):
    """A live Steam game as a SteamBench env.

    Same ``reset``/``step`` shape as every arcade env, so ``run_episode`` and the
    livestream work unchanged — but the action is a gamepad frame and the score
    is *achievement points*, verified later via the Steam API rather than replay.
    The action trace + frames are still recorded (audit + stream), they just
    aren't authoritative for scoring.
    """

    verify_mode = VerifyMode.STEAM_API

    def __init__(
        self,
        session: GameSession,
        *,
        name: str,
        achievements: list[AchievementSpec],
        env_id: Optional[str] = None,
        action_space: Optional[GamepadActionSpace] = None,
        description: str = "",
        max_idle_frames: int = 0,
    ) -> None:
        super().__init__()
        self.session = session
        self.appid = session.appid
        self.env_id = env_id or f"steam/{session.appid}"
        self.name = name
        self.description = description
        self.achievements = list(achievements)
        # The gamepad space *is* this env's action space — same `.name()` seam
        # the episode runner uses to canonicalize actions into the trace.
        self.action_space = action_space or STANDARD_GAMEPAD
        self._last_frame: Optional[str] = None
        self._idle = 0
        self._max_idle = max_idle_frames

    # ---- lifecycle -------------------------------------------------------- #

    def reset(self, seed: int = 0) -> Observation:
        self._begin(seed)            # bookkeeping only; a real game isn't seedable
        self._idle = 0
        self.session.start(seed=seed)
        self._sync_achievements()
        return self._observe(0.0)

    def step(self, action) -> Observation:
        if self.done:
            return self._observe(0.0)
        self.steps += 1
        ga = self.action_space.coerce(action)
        self.session.apply(ga)
        reward = self._sync_achievements()

        status = self.session.status()
        if isinstance(status, dict) and status.get("done"):
            self.done = True
        if self._max_idle:
            self._idle = self._idle + 1 if ga.is_idle() else 0
            if self._idle >= self._max_idle:
                self.done = True
        return self._observe(reward, status if isinstance(status, dict) else {})

    # ---- helpers ---------------------------------------------------------- #

    def _sync_achievements(self) -> float:
        """Pull freshly-unlocked achievements from the session; score = sum of
        designed points (rarity → bits) of everything unlocked. Returns the
        reward gained this step."""
        before = set(self.unlocked)
        live = self.session.achievements()
        gained = 0.0
        for aid in live:
            if aid in self.unlocked:
                continue
            try:
                spec = self.achievement(aid)   # ignore ids we don't track
            except KeyError:
                continue
            self.unlocked.add(aid)
            gained += _points(spec.rarity_hint)
        self.score = sum(_points(self.achievement(a).rarity_hint) for a in self.unlocked)
        return gained

    def _observe(self, reward: float, status: Optional[dict] = None) -> Observation:
        png = self.session.frame()
        self._last_frame = base64.b64encode(png).decode("ascii") if png else self._last_frame
        state = {
            "appid": self.appid,
            "unlocked": sorted(self.unlocked),
            "unlocked_count": len(self.unlocked),
            "total_achievements": len(self.achievements),
            **(status or {}),
        }
        return Observation(
            step=self.steps,
            state=state,
            text=self.render(),
            frame=self._last_frame,
            legal_actions=[],   # continuous controller; see action_space.describe()
            score=self.score,
            done=self.done,
            reward=reward,
            info={"verify": "steam_api", "appid": self.appid},
        )

    def render(self) -> str:
        return (f"{self.name} | step={self.steps} "
                f"achievements={len(self.unlocked)}/{len(self.achievements)} "
                f"score={self.score:.0f}")

    def spec(self) -> dict:
        # Built directly (not via super) because the base spec() assumes a
        # discrete ActionSpace with `.names`; ours is a gamepad space.
        return {
            "env_id": self.env_id,
            "appid": self.appid,
            "name": self.name,
            "description": self.description,
            "verify_mode": self.verify_mode.value,
            "action_space": self.action_space.spec(),   # gamepad spec, not names
            "controls": self.action_space.describe(),
            "achievements": [
                {"id": a.id, "name": a.name, "description": a.description,
                 "percent_hint": a.percent_hint()}
                for a in self.achievements
            ],
        }


def _points(rarity: float) -> float:
    """Same information-theoretic scale the arcade catalog uses: rarer unlock →
    more bits → more points. Kept inline to avoid a hard dep on the engine."""
    import math

    r = min(max(float(rarity), 1e-4), 1.0)
    return round(100.0 * -math.log2(r), 1)


# ======================================================================== #
# A working mock session — exercises the whole platform with no cloud.
# ======================================================================== #


@dataclass
class MockGameSession(GameSession):
    """A fake game: renders a frame that *visualizes the live controller state*
    and unlocks its achievements on a fixed step schedule. Lets the gamepad →
    env → run_episode → score loop be tested end-to-end today.
    """

    unlock_schedule: dict[int, str] = field(default_factory=dict)
    total_steps: int = 0
    width: int = 168
    height: int = 120

    def start(self, *, seed: Optional[int] = None) -> None:
        self._n = 0
        self._unlocked: set[str] = set()
        self._last: GamepadAction = GamepadAction()

    def apply(self, action: GamepadAction) -> None:
        self._n += 1
        self._last = action
        if self._n in self.unlock_schedule:
            self._unlocked.add(self.unlock_schedule[self._n])

    def achievements(self) -> set[str]:
        return set(self._unlocked)

    def status(self) -> dict:
        done = bool(self.total_steps and self._n >= self.total_steps)
        return {"frame_index": self._n, "done": done, "controller": str(self._last)}

    def frame(self) -> bytes:
        """A tiny visualization of the held controller — proof the agent's
        gamepad output reaches the 'game'."""
        try:
            from PIL import Image, ImageDraw
        except Exception:
            return b""
        img = Image.new("RGB", (self.width, self.height), (16, 18, 28))
        d = ImageDraw.Draw(img)
        ga = self._last
        # left stick puck
        cx, cy = 40, 70
        d.ellipse([cx - 18, cy - 18, cx + 18, cy + 18], outline=(70, 80, 110))
        d.ellipse([cx + int(ga.lx * 14) - 4, cy - int(ga.ly * 14) - 4,
                   cx + int(ga.lx * 14) + 4, cy - int(ga.ly * 14) + 4], fill=(90, 200, 255))
        # face buttons
        face = {"Y": (128, 30), "X": (114, 44), "B": (142, 44), "A": (128, 58)}
        for label, (bx, by) in face.items():
            on = ga.held(label)
            d.ellipse([bx - 7, by - 7, bx + 7, by + 7],
                      fill=(240, 200, 60) if on else (44, 48, 64))
        # triggers as bars
        d.rectangle([20, 12, 20 + int(60 * ga.lt), 18], fill=(255, 120, 90))
        d.rectangle([88, 12, 88 + int(60 * ga.rt), 18], fill=(255, 120, 90))
        d.text((6, self.height - 12), f"f{self._n} {str(ga)[:30]}", fill=(150, 160, 180))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
