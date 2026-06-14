"""GeForceNowSession — the concrete bridge from the SteamBench platform to a
real game streamed through **GeForce NOW**.

This is the one file you configure to go live. It implements the three real
backends the platform needs, each behind a soft import so the module loads
anywhere (CI, this Mac) and only *requires* a dependency when you actually use
that backend:

* **frame()**       — screen-capture the GeForce NOW window via ``mss`` (or
                      ``PIL.ImageGrab``). Point ``region`` at the GFN client.
* **apply(action)** — inject a virtual Xbox pad via ``vgamepad`` (ViGEm on
                      Windows). The :class:`GamepadAction` floats map 1:1 to
                      XInput, and GeForce NOW forwards the pad to the cloud game.
* **achievements()**— poll the Steam Web API ``GetPlayerAchievements`` for the
                      bound ``steamid`` + ``appid`` (stdlib only).

Usage::

    from steambench_harness import RealGameEnv, AchievementSpec, run_episode
    from agents.gamepad_agents import VisionGamepadAgent
    from runtime.geforce_now import GeForceNowSession

    session = GeForceNowSession(
        appid=1245620,                       # Elden Ring, say
        region=(0, 0, 1920, 1080),           # the GFN client window
        steam_key=os.environ["STEAM_WEB_API_KEY"],
        steamid="7656119…",
        achievement_map={"ELDEN_FIRST_RUNE": "first_rune"},  # steam apiname -> our id
    )
    env = RealGameEnv(session, name="Elden Ring",
                      achievements=[AchievementSpec("first_rune","First Rune","…",0.5)])
    run_episode(env, VisionGamepadAgent(goal="Defeat the first boss."),
                max_steps=2000, record_frames=True)

Nothing here is GeForce-NOW-specific beyond the capture region — the same
adapter drives a local game, a capture card, or any cloud stream. Swap a backend
by overriding the matching method.
"""

from __future__ import annotations

import io
import json
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Optional

from steambench_harness.gamepad import GamepadAction
from steambench_harness.realgame import GameSession


@dataclass
class GeForceNowSession(GameSession):
    """A live game over GeForce NOW. See module docstring for wiring."""

    region: Optional[tuple[int, int, int, int]] = None   # (left, top, width, height)
    steam_key: Optional[str] = None
    steamid: Optional[str] = None
    achievement_map: dict[str, str] = field(default_factory=dict)  # steam apiname -> our id
    poll_every: int = 10                                  # poll Steam every N frames (it's rate-limited)
    launch_wait_s: float = 0.0                            # let the stream settle after start()
    frame_size: Optional[tuple[int, int]] = None          # downscale captured frames to (w,h) for the model

    # ---- lifecycle -------------------------------------------------------- #

    def start(self, *, seed: Optional[int] = None) -> None:
        self._grab = None         # lazy screen-capture handle
        self._pad = None          # lazy virtual gamepad
        self._frame_i = 0
        self._ach_cache: set[str] = set()
        self._ach_checked_at = -10_000
        if self.launch_wait_s:
            time.sleep(self.launch_wait_s)

    def close(self) -> None:
        if self._pad is not None:
            try:
                self._pad.reset(); self._pad.update()
            except Exception:
                pass
        if self._grab is not None:
            try:
                self._grab.close()
            except Exception:
                pass

    # ---- frame source: screen capture ------------------------------------ #

    def frame(self) -> bytes:
        self._frame_i += 1
        png = self._capture_mss() or self._capture_pil()
        return png or b""

    def _capture_mss(self) -> Optional[bytes]:
        try:
            import mss  # type: ignore
            from PIL import Image
        except Exception:
            return None
        if self._grab is None:
            self._grab = mss.mss()
        left, top, w, h = self.region or (0, 0, 1280, 720)
        shot = self._grab.grab({"left": left, "top": top, "width": w, "height": h})
        img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
        return self._encode(img)

    def _capture_pil(self) -> Optional[bytes]:
        try:
            from PIL import ImageGrab  # macOS/Windows
        except Exception:
            return None
        bbox = None
        if self.region:
            left, top, w, h = self.region
            bbox = (left, top, left + w, top + h)
        img = ImageGrab.grab(bbox=bbox).convert("RGB")
        return self._encode(img)

    def _encode(self, img) -> bytes:
        """Optionally downscale to ``frame_size`` (vision models want small,
        cheap frames), then PNG-encode."""
        if self.frame_size:
            try:
                from PIL import Image
                img = img.resize(self.frame_size, Image.BILINEAR)
            except Exception:
                pass
        buf = io.BytesIO(); img.save(buf, format="PNG")
        return buf.getvalue()

    # ---- input sink: virtual Xbox pad (ViGEm via vgamepad) ---------------- #

    def apply(self, action: GamepadAction) -> None:
        pad = self._ensure_pad()
        if pad is None:
            return  # no virtual-pad backend here; frame/achievement paths still work
        import vgamepad as vg  # type: ignore

        pad.reset()
        for name in action.buttons:
            btn = _XUSB.get(name)
            if btn is not None:
                pad.press_button(button=getattr(vg.XUSB_BUTTON, btn))
        # vgamepad float convention matches ours: x right +, y up +, triggers 0..1.
        pad.left_joystick_float(x_value_float=action.lx, y_value_float=action.ly)
        pad.right_joystick_float(x_value_float=action.rx, y_value_float=action.ry)
        pad.left_trigger_float(value_float=action.lt)
        pad.right_trigger_float(value_float=action.rt)
        pad.update()

    def _ensure_pad(self):
        if self._pad is not None:
            return self._pad
        try:
            import vgamepad as vg  # type: ignore
        except Exception:
            return None
        self._pad = vg.VX360Gamepad()
        return self._pad

    # ---- verification: Steam Web API ------------------------------------- #

    def achievements(self) -> set[str]:
        if not (self.steam_key and self.steamid):
            return set(self._ach_cache)
        # Steam's API is rate-limited; only poll every `poll_every` frames.
        if self._frame_i - self._ach_checked_at < self.poll_every:
            return set(self._ach_cache)
        self._ach_checked_at = self._frame_i
        try:
            unlocked = self._poll_steam()
        except Exception:
            return set(self._ach_cache)  # transient: keep what we had
        # Map Steam apinames -> our achievement ids (identity if unmapped).
        mapped = {self.achievement_map.get(a, a) for a in unlocked}
        self._ach_cache |= mapped
        return set(self._ach_cache)

    def _poll_steam(self) -> set[str]:
        q = urllib.parse.urlencode({"appid": self.appid, "key": self.steam_key,
                                    "steamid": self.steamid, "l": "en"})
        url = f"https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?{q}"
        with urllib.request.urlopen(url, timeout=10) as r:
            data = json.loads(r.read().decode("utf-8"))
        stats = (data.get("playerstats") or {})
        if not stats.get("success"):
            return set()
        return {a["apiname"] for a in stats.get("achievements", []) if a.get("achieved") == 1}

    def status(self) -> dict:
        return {"frame_index": self._frame_i}

    # ---- readiness diagnostic -------------------------------------------- #

    def selftest(self, *, capture: bool = True) -> dict:
        """Check the three backends without playing a game. Returns a report
        ``{gamepad, capture, steam, ready, ...}`` — run it before going live so
        you know exactly what (if anything) is missing. See
        ``runtime/geforce_now_check.py`` for a CLI wrapper. ``capture=False``
        skips the actual screen grab (headless/CI)."""
        report: dict = {}

        # 1) virtual gamepad
        try:
            import vgamepad as vg  # type: ignore

            pad = vg.VX360Gamepad()
            pad.reset(); pad.update()
            report["gamepad"] = {"ok": True, "detail": "vgamepad VX360 ready"}
        except Exception as e:  # noqa: BLE001
            report["gamepad"] = {"ok": False, "detail": f"{type(e).__name__}: install 'vgamepad' (ViGEm, Windows)"}

        # 2) screen capture
        self._grab = getattr(self, "_grab", None)
        self._frame_i = getattr(self, "_frame_i", 0)
        if not capture:
            report["capture"] = {"ok": False, "detail": "skipped (capture=False)", "skipped": True}
        else:
            png = self._capture_mss() or self._capture_pil()
            if png:
                kb = round(len(png) / 1024, 1)
                report["capture"] = {"ok": True, "detail": f"captured {kb} KB PNG"
                                     + (f" → resized {self.frame_size}" if self.frame_size else "")}
            else:
                report["capture"] = {"ok": False, "detail": "no backend: pip install mss (or pillow) and grant screen-recording permission"}

        # 3) Steam achievements
        if self.steam_key and self.steamid:
            try:
                unlocked = self._poll_steam()
                report["steam"] = {"ok": True, "detail": f"read {len(unlocked)} unlocked on appid {self.appid}"}
            except Exception as e:  # noqa: BLE001
                report["steam"] = {"ok": False, "detail": f"{type(e).__name__}: check STEAM key/steamid/appid + public profile"}
        else:
            report["steam"] = {"ok": False, "detail": "set steam_key + steamid (keyless XML scrape also works at submit time)"}

        report["region"] = self.region or "full screen (set region=(left,top,w,h))"
        # Capture is the only hard requirement to feed the agent frames; the pad
        # is required to actually drive the game; steam can be done at submit.
        report["ready"] = bool(report["capture"]["ok"] and report["gamepad"]["ok"])
        return report


# Xbox button name -> vgamepad XUSB_BUTTON enum member name.
_XUSB = {
    "A": "XUSB_GAMEPAD_A", "B": "XUSB_GAMEPAD_B", "X": "XUSB_GAMEPAD_X", "Y": "XUSB_GAMEPAD_Y",
    "LB": "XUSB_GAMEPAD_LEFT_SHOULDER", "RB": "XUSB_GAMEPAD_RIGHT_SHOULDER",
    "LS": "XUSB_GAMEPAD_LEFT_THUMB", "RS": "XUSB_GAMEPAD_RIGHT_THUMB",
    "START": "XUSB_GAMEPAD_START", "BACK": "XUSB_GAMEPAD_BACK", "GUIDE": "XUSB_GAMEPAD_GUIDE",
    "DPAD_UP": "XUSB_GAMEPAD_DPAD_UP", "DPAD_DOWN": "XUSB_GAMEPAD_DPAD_DOWN",
    "DPAD_LEFT": "XUSB_GAMEPAD_DPAD_LEFT", "DPAD_RIGHT": "XUSB_GAMEPAD_DPAD_RIGHT",
}
