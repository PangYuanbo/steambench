#!/usr/bin/env python3
"""Browser GeForce NOW bridge — an agent drives a CLI-simulated gamepad into
GeForce NOW running in a real browser.

GeForce NOW's web client (play.geforcenow.com) streams the game over WebRTC into
a `<video>` element and reads controller input through the **standard Gamepad
API** (`navigator.getGamepads()`). On macOS there's no ViGEm virtual pad, so the
robust path is browser automation: Playwright drives the real system Chrome and
injects a *virtual gamepad* into the page — we replace `navigator.getGamepads`
with a controllable fake pad, so the game polls our state every frame exactly as
if a physical controller were plugged in.

The agent's `GamepadAction` (buttons + 2 sticks + 2 triggers) maps 1:1 onto the
W3C "standard" mapping and is pushed into the page each step. This implements
:class:`~steambench_harness.realgame.GameSession`, so the existing gamepad agents
(`agents/gamepad_agents.py`) and `RealGameEnv` drive a real streamed game with no
other changes.

Injection technique verified against Chrome 148 (2026): replacing getGamepads
bypasses the Gamepad-API user-gesture gate; `gamepadconnected` must be a plain
`Event` with `.gamepad` attached (the GamepadEvent constructor rejects a plain
object); and `timestamp` must advance (`performance.now()`) on every state change
or cloud-gaming clients treat the input as stale and ignore it.

    # verify the simulated gamepad is seen by the page (no GFN/login needed):
    python runtime/gfn_browser.py --test

    # drive GeForce NOW (headed real Chrome; you log in to NVIDIA once):
    python runtime/gfn_browser.py --play --agent scripted

Run with harness + repo root importable, e.g.:
    PYTHONPATH=harness:. ./engine/.venv/bin/python runtime/gfn_browser.py --test
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
for p in (ROOT, ROOT / "harness", ROOT / "agents"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from steambench_harness.gamepad import STANDARD_GAMEPAD, GamepadAction  # noqa: E402
from steambench_harness.realgame import GameSession  # noqa: E402


# W3C "standard" gamepad button order. Our GamepadAction button names → indices.
_BTN_INDEX = {
    "A": 0, "B": 1, "X": 2, "Y": 3, "LB": 4, "RB": 5,
    "BACK": 8, "START": 9, "LS": 10, "RS": 11,
    "DPAD_UP": 12, "DPAD_DOWN": 13, "DPAD_LEFT": 14, "DPAD_RIGHT": 15, "GUIDE": 16,
}
# Triggers ride buttons 6 (LT) / 7 (RT) as analog values in the standard mapping.

#: Verified virtual-gamepad injection (Chrome 148). Helpers defined first so a
#: throw can't leave them undefined; getGamepads overridden defensively;
#: timestamp bumped on every change.
GAMEPAD_INIT_JS = r"""
(() => {
  const mkButtons = () => Array.from({length: 17}, () => ({pressed: false, touched: false, value: 0}));
  const pad = {
    id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)',
    index: 0, connected: true, mapping: 'standard',
    timestamp: performance.now(),
    axes: [0, 0, 0, 0],
    buttons: mkButtons(),
    vibrationActuator: null,
  };
  const bump = () => { pad.timestamp = performance.now(); };
  window.__gpPad = pad;
  window.__gpSetState = (axes, buttons) => {
    if (axes) for (let i = 0; i < axes.length; i++) pad.axes[i] = axes[i];
    if (buttons) for (let i = 0; i < buttons.length; i++) {
      const v = (typeof buttons[i] === 'number') ? buttons[i] : (buttons[i] ? 1 : 0);
      pad.buttons[i].value = v;
      pad.buttons[i].pressed = v >= 0.5;
      pad.buttons[i].touched = v > 0;
    }
    bump();
  };
  window.__gpFireConnected = () => {
    const e = new Event('gamepadconnected'); e.gamepad = pad; window.dispatchEvent(e);
  };
  const getGamepads = function getGamepads() { return [pad, null, null, null]; };
  try {
    Object.defineProperty(Navigator.prototype, 'getGamepads',
      {value: getGamepads, writable: true, configurable: true});
  } catch (e1) {
    try { Object.defineProperty(navigator, 'getGamepads',
      {value: getGamepads, writable: true, configurable: true}); }
    catch (e2) { try { navigator.getGamepads = getGamepads; } catch (e3) {} }
  }
  try { navigator.webkitGetGamepads = getGamepads; } catch (e) {}
})();
"""

# Stealth flags so NVIDIA's login flow doesn't flag the automated Chrome.
_CHROME_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--use-fake-ui-for-media-stream",
]

GFN_URL = "https://play.geforcenow.com/"


def action_to_state(ga: GamepadAction) -> tuple[list[float], list[float]]:
    """Map a GamepadAction onto W3C standard ``(axes, buttons)`` arrays.

    axes = [lx, ly, rx, ry]; the Gamepad API's Y axes are +down, while our
    GamepadAction uses +up, so the sticks are negated. Triggers become the
    analog values of buttons 6 (LT) and 7 (RT).
    """
    buttons = [0.0] * 17
    for b in ga.buttons:
        i = _BTN_INDEX.get(b)
        if i is not None:
            buttons[i] = 1.0
    buttons[6] = float(max(0.0, min(1.0, ga.lt)))
    buttons[7] = float(max(0.0, min(1.0, ga.rt)))
    axes = [ga.lx, -ga.ly, ga.rx, -ga.ry]
    return axes, buttons


def _is_black(png: bytes, thresh: float = 8.0) -> bool:
    """True if a PNG is (near) all black — the GPU-overlay readback signature
    that means in-page capture failed and we should use OS screen capture."""
    try:
        import io

        from PIL import Image

        img = Image.open(io.BytesIO(png)).convert("L").resize((32, 32))
        px = list(img.getdata())
        return (sum(px) / len(px)) < thresh if px else False
    except Exception:
        return False


class BrowserGamepadSession(GameSession):
    """A :class:`GameSession` that drives a browser game (GeForce NOW) via a
    virtual gamepad injected with Playwright. Frames are captured from the page;
    actions become Gamepad-API state the game polls each frame.
    """

    def __init__(
        self,
        appid: int = 0,
        *,
        url: str = GFN_URL,
        user_data_dir: Optional[str] = None,
        headless: bool = False,
        frame_size: Optional[tuple[int, int]] = None,
        frame_source: str = "auto",   # "auto" | "page" | "screen"
        capture_region: Optional[tuple[int, int, int, int]] = None,  # (x,y,w,h) for screen capture
        steam_key: Optional[str] = None,
        steamid: Optional[str] = None,
    ) -> None:
        self.appid = appid
        self.url = url
        self.user_data_dir = user_data_dir or str(ROOT / ".gfn-profile")
        self.headless = headless
        self.frame_size = frame_size
        self.frame_source = frame_source
        self.capture_region = capture_region
        self.steam_key = steam_key
        self.steamid = steamid
        self._pw = None
        self._ctx = None
        self._page = None
        self._use_screen = (frame_source == "screen")  # auto flips this on black frames

    # ---- lifecycle -------------------------------------------------------- #

    def start(self, *, seed: Optional[int] = None) -> None:
        from playwright.sync_api import sync_playwright

        self._pw = sync_playwright().start()
        # Persistent context so the human's one-time NVIDIA login survives runs.
        self._ctx = self._pw.chromium.launch_persistent_context(
            self.user_data_dir,
            channel="chrome",            # the REAL Chrome (Widevine/codecs for GFN)
            headless=self.headless,
            args=_CHROME_ARGS,
            viewport={"width": 1280, "height": 720},
            ignore_default_args=["--enable-automation"],
        )
        self._ctx.add_init_script(GAMEPAD_INIT_JS)   # every page/navigation gets the pad
        self._page = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
        self._page.goto(self.url, wait_until="domcontentloaded")
        # Announce the pad to any gamepadconnected listener.
        try:
            self._page.evaluate("window.__gpFireConnected && window.__gpFireConnected()")
        except Exception:
            pass

    def close(self) -> None:
        for fn in (lambda: self._ctx and self._ctx.close(), lambda: self._pw and self._pw.stop()):
            try:
                fn()
            except Exception:
                pass

    # ---- gamepad (the action sink) ---------------------------------------- #

    def apply(self, action: GamepadAction) -> None:
        if self._page is None:
            return
        axes, buttons = action_to_state(action)
        try:
            self._page.evaluate("([a, b]) => window.__gpSetState && window.__gpSetState(a, b)", [axes, buttons])
        except Exception:
            pass

    def read_pad(self) -> dict:
        """Read the page's view of the gamepad back — for verification/debug."""
        if self._page is None:
            return {}
        return self._page.evaluate(
            "(() => { const g = navigator.getGamepads()[0]; return g ? "
            "{id:g.id, mapping:g.mapping, ts:g.timestamp, axes:g.axes, "
            "pressed:g.buttons.map(b=>b.pressed)} : null; })()"
        )

    # ---- frame (the observation source) ----------------------------------- #

    def frame(self) -> bytes:
        if self._page is None:
            return b""
        # OS screen capture (robust for the live GFN stream — reads the composited
        # display, immune to the GPU-overlay black-frame trap).
        if self._use_screen:
            return self._resize(self._screen_capture())
        # In-page capture: clip to the streamed <video> (GFN renders WebRTC there).
        try:
            box = self._page.evaluate(
                "(() => { const v = document.querySelector('video'); if (!v) return null; "
                "const r = v.getBoundingClientRect(); return {x:r.x, y:r.y, width:r.width, height:r.height}; })()"
            )
            png = self._page.screenshot(clip=box) if (box and box["width"] > 4 and box["height"] > 4) else self._page.screenshot()
        except Exception:
            png = b""
        # auto: if the in-page frame is black (GPU overlay), switch to OS capture.
        if self.frame_source == "auto" and png and _is_black(png):
            self._use_screen = True
            return self._resize(self._screen_capture())
        return self._resize(png)

    def _screen_capture(self) -> bytes:
        """Capture the headed Chrome via the macOS `screencapture` CLI. Full main
        display by default (play GFN fullscreen), or a configured (x,y,w,h)
        region. Needs Screen-Recording permission granted once."""
        import os
        import subprocess
        import tempfile

        out = os.path.join(tempfile.gettempdir(), "sb_gfn_frame.png")
        cmd = ["screencapture", "-x", "-t", "png"]
        if self.capture_region:
            x, y, w, h = self.capture_region
            cmd.append(f"-R{x},{y},{w},{h}")
        cmd.append(out)
        try:
            subprocess.run(cmd, check=False, timeout=10,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            with open(out, "rb") as f:
                return f.read()
        except Exception:
            return b""

    def _resize(self, png: bytes) -> bytes:
        if not png or not self.frame_size:
            return png
        try:
            import io

            from PIL import Image

            img = Image.open(io.BytesIO(png)).convert("RGB").resize(self.frame_size)
            buf = io.BytesIO(); img.save(buf, format="PNG")
            return buf.getvalue()
        except Exception:
            return png

    def achievements(self) -> set[str]:
        # Real GFN runs verify via the Steam Web API (see runtime/geforce_now.py
        # _poll_steam); the browser bridge handles input + frames.
        return set()

    def status(self) -> dict:
        if self._page is None:
            return {}
        try:
            return {"url": self._page.url, "title": self._page.title()}
        except Exception:
            return {}


# ======================================================================== #
# CLI
# ======================================================================== #


def _self_test() -> int:
    """Prove the CLI-simulated gamepad is seen by a page exactly as a real one:
    inject the pad, run a requestAnimationFrame poll loop (what GFN does), drive
    buttons/sticks from Python, and confirm the page registered them with a
    fresh timestamp. Fully self-contained — no GeForce NOW or login required."""
    from playwright.sync_api import sync_playwright

    # setInterval poll (headless-robust, unlike rAF which Chrome throttles when
    # headless) records what a Gamepad-API consumer sees over time.
    POLLER = """
    window.__seen = {buttons: Array(17).fill(false), maxAxis: 0, ticks: 0, lastTs: 0, freshHits: 0};
    setInterval(() => {
      const g = navigator.getGamepads()[0];
      if (!g) return;
      window.__seen.ticks++;
      if (g.timestamp > window.__seen.lastTs) { window.__seen.freshHits++; window.__seen.lastTs = g.timestamp; }
      g.buttons.forEach((b, i) => { if (b.pressed) window.__seen.buttons[i] = true; });
      window.__seen.maxAxis = Math.max(window.__seen.maxAxis, ...g.axes.map(Math.abs));
    }, 8);
    """
    READBACK = ("(() => { const g = navigator.getGamepads()[0]; return g ? "
                "{ts:g.timestamp, pressed:g.buttons.map(b=>b.pressed), "
                "values:g.buttons.map(b=>b.value), axes:g.axes} : null; })()")
    ok = True
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="chrome", headless=True)
            which = "system chrome"
        except Exception:
            browser = p.chromium.launch(headless=True)
            which = "bundled chromium"
        page = browser.new_page()
        page.add_init_script(GAMEPAD_INIT_JS)
        page.goto("data:text/html,<body>gfn-gamepad-test</body>")  # no network; injection is page-agnostic
        page.evaluate(POLLER)
        page.evaluate("window.__gpFireConnected()")
        print(f"  browser: {which}")

        # Drive GamepadActions through the SAME path the agent uses; after each,
        # read getGamepads() back (deterministic, headless-proof) AND let the
        # interval poller sample it (proves a live consumer catches it).
        seq = [
            ("press A", GamepadAction.press("A"), lambda r: r["pressed"][0]),
            ("DPAD_UP + lx=0.9", GamepadAction.press("DPAD_UP", lx=0.9),
             lambda r: r["pressed"][12] and abs(r["axes"][0] - 0.9) < 0.01),
            ("RB + RT trigger 1.0", GamepadAction(buttons=frozenset({"RB"}), rt=1.0),
             lambda r: r["pressed"][5] and abs(r["values"][7] - 1.0) < 0.01),
            ("stick lx=-1 ly=+1 (→ axisY -1)", GamepadAction.move(lx=-1.0, ly=1.0),
             lambda r: abs(r["axes"][0] + 1.0) < 0.01 and abs(r["axes"][1] + 1.0) < 0.01),
        ]
        last_ts = -1.0
        for label, ga, check in seq:
            axes, buttons = action_to_state(ga)
            page.evaluate("([a,b]) => window.__gpSetState(a,b)", [axes, buttons])
            r = page.evaluate(READBACK)
            passed = bool(r) and check(r) and r["ts"] > last_ts
            last_ts = r["ts"] if r else last_ts
            print(f"  {'✓' if passed else '✗'} round-trip: {label}")
            ok = ok and passed
            page.wait_for_timeout(40)
            page.evaluate("window.__gpSetState([0,0,0,0], Array(17).fill(0))")
            page.wait_for_timeout(20)

        seen = page.evaluate("window.__seen")
        pad = page.evaluate("(() => { const g = navigator.getGamepads()[0]; return {id:g.id, mapping:g.mapping}; })()")
        browser.close()

    pressed = [i for i, v in enumerate(seen["buttons"]) if v]
    live = {
        "pad detected by getGamepads (standard mapping)": pad and pad.get("mapping") == "standard",
        "live poller sampled the pad": seen["ticks"] > 5,
        "timestamp advanced each change (not stale)": seen["freshHits"] >= 3,
        "live poller saw button presses": len(pressed) >= 3,
        "live poller saw stick deflection": seen["maxAxis"] > 0.8,
    }
    print(f"  pad: {pad}")
    print(f"  live poll: ticks={seen['ticks']} freshHits={seen['freshHits']} buttonsSeen={pressed} maxAxis={seen['maxAxis']:.2f}")
    for label, passed in live.items():
        print(f"  {'✓' if passed else '✗'} {label}")
        ok = ok and bool(passed)
    print("\n" + ("PASS — the CLI-simulated gamepad is seen by the browser exactly like a real controller."
                  if ok else "FAIL — see ✗ above."))
    return 0 if ok else 1


def _play(agent_kind: str, url: str, steps: int) -> int:
    """Open GeForce NOW in real Chrome and drive it with a gamepad agent. You log
    in to NVIDIA in the opened window once (persistent profile remembers it)."""
    from gamepad_agents import RandomGamepadAgent, ScriptedGamepadAgent, VisionGamepadAgent

    session = BrowserGamepadSession(url=url, headless=False, frame_size=(512, 288))
    if agent_kind == "vision":
        agent = VisionGamepadAgent(goal="Play the game on screen; make progress.")
    elif agent_kind == "random":
        agent = RandomGamepadAgent(seed=1)
    else:
        agent = ScriptedGamepadAgent([(20, GamepadAction.press("A")), (40, {"lx": 1.0}), (40, "DPAD_UP")])

    print(f"▶ Opening GeForce NOW ({url}) in real Chrome — log into NVIDIA + start a game, then the")
    print(f"  agent drives the virtual gamepad. agent={agent_kind}, up to {steps} steps.\n")
    session.start()
    if hasattr(agent, "reset"):
        agent.reset()
    try:
        input("  Press Enter once your game is streaming to begin driving the gamepad… ")
    except EOFError:
        pass

    from steambench_harness.protocol import Observation
    import base64

    for t in range(steps):
        png = session.frame()
        obs = Observation(step=t, state=session.status(),
                          frame=base64.b64encode(png).decode("ascii") if png else None,
                          legal_actions=[])
        ga = STANDARD_GAMEPAD.coerce(agent.act(obs))
        session.apply(ga)
        reason = getattr(agent, "last_reasoning", "")
        print(f"  t{t:>4} pad={str(ga):<34} {reason}")
        time.sleep(0.1)
    session.close()
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description="Browser GeForce NOW gamepad bridge")
    ap.add_argument("--test", action="store_true", help="verify the simulated gamepad is seen by the browser (no GFN)")
    ap.add_argument("--play", action="store_true", help="open GeForce NOW + drive it with a gamepad agent")
    ap.add_argument("--agent", default="scripted", choices=["scripted", "random", "vision"])
    ap.add_argument("--url", default=GFN_URL)
    ap.add_argument("--steps", type=int, default=200)
    args = ap.parse_args()

    if args.test:
        raise SystemExit(_self_test())
    if args.play:
        raise SystemExit(_play(args.agent, args.url, args.steps))
    ap.print_help()


if __name__ == "__main__":
    main()
