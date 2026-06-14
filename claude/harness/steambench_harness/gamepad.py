"""The gamepad action space — the controller an agent drives a REAL game with.

Arcade envs take a tiny discrete action (``"up"``/``"left"``/…). A real Steam
game streamed through **GeForce NOW** takes *controller input*: button presses,
two analog sticks, two triggers. This module is the agent's action space for
that world. The contract is unchanged — an :class:`~steambench_harness.protocol.Agent`
still implements ``act(obs) -> action`` — but here the action is a
:class:`GamepadAction` (or anything :meth:`GamepadActionSpace.coerce` accepts)
instead of a discrete string.

Why a virtual Xbox/XInput pad? It is the lowest common denominator every PC
game and every cloud-gaming backend already understands. The benchmark hands the
agent *exactly the same affordance a human has* — a controller — and nothing
more. The session adapter (see :mod:`steambench_harness.realgame`) is responsible
for turning a :class:`GamepadAction` into real input on the GeForce NOW stream
(e.g. via a ViGEm/``vgamepad`` virtual device).

Conventions (match XInput so the session adapter is a thin mapping):

* Sticks: ``lx``/``rx`` in ``[-1, 1]`` (−1 = left, +1 = right); ``ly``/``ry`` in
  ``[-1, 1]`` (**+1 = up**, −1 = down). Magnitude is the deflection.
* Triggers: ``lt``/``rt`` in ``[0, 1]`` (0 = released, 1 = fully pulled).
* Buttons: a *set* held this frame, named with the canonical face/shoulder/dpad
  labels below. Holding across frames = press-and-hold; absence = release.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from typing import Iterable, Mapping, Union

from .rng import Mulberry32

#: The canonical Xbox-style button vocabulary (a superset every PC game maps to).
BUTTONS: tuple[str, ...] = (
    "A", "B", "X", "Y",                              # face
    "LB", "RB",                                      # shoulders
    "LS", "RS",                                      # stick clicks
    "START", "BACK", "GUIDE",                        # system
    "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT",  # d-pad
)

#: Forgiving aliases so LLM agents that say "UP" or "MENU" still hit the mark.
_ALIASES: dict[str, str] = {
    "UP": "DPAD_UP", "DOWN": "DPAD_DOWN", "LEFT": "DPAD_LEFT", "RIGHT": "DPAD_RIGHT",
    "DUP": "DPAD_UP", "DDOWN": "DPAD_DOWN", "DLEFT": "DPAD_LEFT", "DRIGHT": "DPAD_RIGHT",
    "DPADUP": "DPAD_UP", "DPADDOWN": "DPAD_DOWN", "DPADLEFT": "DPAD_LEFT", "DPADRIGHT": "DPAD_RIGHT",
    "MENU": "START", "VIEW": "BACK", "SELECT": "BACK", "HOME": "GUIDE",
    "L1": "LB", "R1": "RB", "L3": "LS", "R3": "RS",
    "CROSS": "A", "CIRCLE": "B", "SQUARE": "X", "TRIANGLE": "Y",  # DualShock muscle-memory
}


def _clamp(v: float, lo: float, hi: float) -> float:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return 0.0
    if v != v:  # NaN
        return 0.0
    return lo if v < lo else hi if v > hi else v


@dataclass(frozen=True)
class GamepadAction:
    """One frame of controller state: buttons held + analog deflections.

    Immutable so it is safe to log, hash, and replay. Construct directly, via the
    ergonomic helpers (:meth:`press` / :meth:`move`), or let
    :meth:`GamepadActionSpace.coerce` accept a dict / token / button-string from
    an agent.
    """

    buttons: frozenset[str] = frozenset()
    lx: float = 0.0
    ly: float = 0.0
    rx: float = 0.0
    ry: float = 0.0
    lt: float = 0.0
    rt: float = 0.0

    # ---- ergonomic constructors ------------------------------------------ #

    @classmethod
    def press(cls, *buttons: str, **analog: float) -> "GamepadAction":
        """``GamepadAction.press("A", "DPAD_UP", lt=1.0)``."""
        return cls(buttons=frozenset(buttons), **analog)

    @classmethod
    def move(cls, lx: float = 0.0, ly: float = 0.0, **rest: float) -> "GamepadAction":
        """``GamepadAction.move(lx=1.0)`` — walk right, no buttons."""
        return cls(lx=lx, ly=ly, **rest)

    # ---- queries ---------------------------------------------------------- #

    def held(self, button: str) -> bool:
        return button.upper() in self.buttons

    def is_idle(self) -> bool:
        return (not self.buttons and self.lx == 0 and self.ly == 0
                and self.rx == 0 and self.ry == 0 and self.lt == 0 and self.rt == 0)

    def with_(self, **changes) -> "GamepadAction":
        return replace(self, **changes)

    # ---- (de)serialization ------------------------------------------------ #

    def as_dict(self) -> dict:
        return {
            "buttons": sorted(self.buttons),
            "lx": self.lx, "ly": self.ly,
            "rx": self.rx, "ry": self.ry,
            "lt": self.lt, "rt": self.rt,
        }

    def to_token(self) -> str:
        """Compact, canonical string — what the episode trace records.

        Identical controller states always serialize to the identical token
        (buttons sorted, analog rounded to 3 dp), so a trace is diff-able and the
        livestream can show exactly what the agent pressed.
        """
        d = {
            "b": sorted(self.buttons),
            "ls": [round(self.lx, 3), round(self.ly, 3)],
            "rs": [round(self.rx, 3), round(self.ry, 3)],
            "t": [round(self.lt, 3), round(self.rt, 3)],
        }
        return json.dumps(d, separators=(",", ":"))

    def __str__(self) -> str:  # friendly for logs / the stream overlay
        parts = []
        if self.buttons:
            parts.append("+".join(sorted(self.buttons)))
        if self.lx or self.ly:
            parts.append(f"L({self.lx:+.2f},{self.ly:+.2f})")
        if self.rx or self.ry:
            parts.append(f"R({self.rx:+.2f},{self.ry:+.2f})")
        if self.lt:
            parts.append(f"LT{self.lt:.2f}")
        if self.rt:
            parts.append(f"RT{self.rt:.2f}")
        return " ".join(parts) if parts else "idle"


#: A released controller — the safe default each frame.
NEUTRAL = GamepadAction()


@dataclass
class GamepadActionSpace:
    """Describes a virtual controller and coerces agent output into a clean
    :class:`GamepadAction`. Plays the same role :class:`ActionSpace` plays for
    arcade envs, including :meth:`name` so the episode runner can canonicalize a
    gamepad action into the run's action trace with zero special-casing.
    """

    buttons: tuple[str, ...] = BUTTONS
    left_stick: bool = True
    right_stick: bool = True
    triggers: bool = True

    def __post_init__(self) -> None:
        self._valid = {b.upper() for b in self.buttons}

    # ---- coercion / validation ------------------------------------------- #

    def _filter_buttons(self, names: Iterable[str]) -> frozenset[str]:
        out: set[str] = set()
        for raw in names:
            if not isinstance(raw, str):
                continue
            b = raw.strip().upper().replace(" ", "_").replace("-", "_")
            b = _ALIASES.get(b, b)
            if b in self._valid:
                out.add(b)
        return frozenset(out)

    def coerce(self, action: Union["GamepadAction", Mapping, str, Iterable]) -> GamepadAction:
        """Turn whatever an agent returned into a validated :class:`GamepadAction`.

        Accepts a :class:`GamepadAction`, a dict (``{"buttons": [...], "lx": .5}``),
        a canonical token, a free-form button string (``"A DPAD_UP"``), or an
        iterable of button names. Analog values are clamped to range; unknown
        buttons are dropped (a live run should never crash on a fat-fingered
        agent). Triggers/sticks the space disables are forced to zero.
        """
        if isinstance(action, GamepadAction):
            ga = action
        elif isinstance(action, Mapping):
            ga = self._from_mapping(action)
        elif isinstance(action, str):
            ga = self._from_string(action)
        elif isinstance(action, Iterable):
            ga = GamepadAction(buttons=self._filter_buttons(action))
        else:
            ga = NEUTRAL
        return self._sanitize(ga)

    def _from_mapping(self, m: Mapping) -> GamepadAction:
        btn = m.get("buttons", m.get("b", []))
        if isinstance(btn, str):
            btn = [btn]
        ls = m.get("ls") or [m.get("lx", 0.0), m.get("ly", 0.0)]
        rs = m.get("rs") or [m.get("rx", 0.0), m.get("ry", 0.0)]
        tr = m.get("t") or [m.get("lt", 0.0), m.get("rt", 0.0)]
        return GamepadAction(
            buttons=self._filter_buttons(btn or []),
            lx=ls[0] if len(ls) > 0 else 0.0, ly=ls[1] if len(ls) > 1 else 0.0,
            rx=rs[0] if len(rs) > 0 else 0.0, ry=rs[1] if len(rs) > 1 else 0.0,
            lt=tr[0] if len(tr) > 0 else 0.0, rt=tr[1] if len(tr) > 1 else 0.0,
        )

    def _from_string(self, s: str) -> GamepadAction:
        s = s.strip()
        if s.startswith("{"):
            try:
                return self._from_mapping(json.loads(s))
            except (ValueError, TypeError):
                return NEUTRAL
        # otherwise: free-form button names, e.g. "A DPAD_UP" or "a,b"
        names = [p for p in s.replace(",", " ").split() if p]
        return GamepadAction(buttons=self._filter_buttons(names))

    def _sanitize(self, ga: GamepadAction) -> GamepadAction:
        return GamepadAction(
            buttons=self._filter_buttons(ga.buttons),
            lx=_clamp(ga.lx, -1.0, 1.0) if self.left_stick else 0.0,
            ly=_clamp(ga.ly, -1.0, 1.0) if self.left_stick else 0.0,
            rx=_clamp(ga.rx, -1.0, 1.0) if self.right_stick else 0.0,
            ry=_clamp(ga.ry, -1.0, 1.0) if self.right_stick else 0.0,
            lt=_clamp(ga.lt, 0.0, 1.0) if self.triggers else 0.0,
            rt=_clamp(ga.rt, 0.0, 1.0) if self.triggers else 0.0,
        )

    # ---- episode-runner / catalog hooks ----------------------------------- #

    def name(self, action: Union["GamepadAction", Mapping, str, Iterable]) -> str:
        """Canonical trace token. Mirrors :meth:`ActionSpace.name` so
        :func:`run_episode` records gamepad actions with no special-casing."""
        return self.coerce(action).to_token()

    def parse(self, token: str) -> GamepadAction:
        """Inverse of :meth:`name` — rebuild a :class:`GamepadAction` from a
        recorded trace token (used by the live env's ``step``)."""
        return self.coerce(token)

    def sample(self, rng: "Mulberry32") -> GamepadAction:
        """A random-but-plausible controller frame (for smoke tests / baselines):
        maybe one face/dpad button, a stick deflection, an occasional trigger."""
        btns: set[str] = set()
        if rng.random() < 0.6:
            btns.add(rng.choice(list(self.buttons)))
        lx = round(rng.random() * 2 - 1, 2) if (self.left_stick and rng.random() < 0.7) else 0.0
        ly = round(rng.random() * 2 - 1, 2) if (self.left_stick and rng.random() < 0.7) else 0.0
        rt = round(rng.random(), 2) if (self.triggers and rng.random() < 0.3) else 0.0
        return self._sanitize(GamepadAction(buttons=frozenset(btns), lx=lx, ly=ly, rt=rt))

    def describe(self) -> str:
        """A short, model-readable description of the controls — drop this into an
        LLM agent's system prompt so it knows precisely what it may emit."""
        lines = [
            "You drive a virtual Xbox controller. Each step, return a JSON object:",
            '  {"buttons": ["A", "DPAD_UP"], "lx": 0.0, "ly": 1.0, "rx": 0.0, "ry": 0.0, "lt": 0.0, "rt": 1.0}',
            f"buttons (held this frame, any subset): {', '.join(self.buttons)}",
        ]
        if self.left_stick:
            lines.append("lx,ly = left stick in [-1,1]  (lx: -1 left .. +1 right ; ly: -1 down .. +1 up)")
        if self.right_stick:
            lines.append("rx,ry = right stick in [-1,1] (usually camera/aim)")
        if self.triggers:
            lines.append("lt,rt = triggers in [0,1] (0 released .. 1 fully pulled)")
        lines.append("Omit a field to leave it neutral. Hold a button across steps to keep it pressed.")
        return "\n".join(lines)

    def spec(self) -> dict:
        return {
            "kind": "gamepad",
            "buttons": list(self.buttons),
            "axes": (
                (["lx", "ly"] if self.left_stick else [])
                + (["rx", "ry"] if self.right_stick else [])
                + (["lt", "rt"] if self.triggers else [])
            ),
            "ranges": {"stick": [-1.0, 1.0], "trigger": [0.0, 1.0]},
        }


#: A full Xbox-style pad — the default action space for real GeForce NOW games.
STANDARD_GAMEPAD = GamepadActionSpace()
