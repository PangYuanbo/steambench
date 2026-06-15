#!/usr/bin/env python3
"""Dual-rate frame buffers — the agent's research链路 runtime.

Open any game's environment ready-to-run, then expose two independent,
thread-safe frame feeds the agent reads from:

* **video buffer @ ~120 Hz** — a rolling window of recent *raw* frames (numpy),
  for motion / temporal perception. This is the "video stream" buffer.
* **screenshot buffer @ ~60 Hz** — a separate rolling window of PNG-encoded
  stills, for discrete vision / LLM frames.

The game runs in its own producer thread at the video rate; the agent reads the
buffers and sets the next action asynchronously, so the **game frame rate is
decoupled from the agent's decision rate** (a 30 Hz agent can watch a 120 Hz
game). The env auto-resets on game-over so frames never stop flowing.

    # open Dodger ready-to-run, watch the buffers fill, report achieved rates:
    PYTHONPATH=harness:. ./engine/.venv/bin/python runtime/frame_buffer.py --game dodger --secs 3

    # let the game's CV agent drive it through the buffer for a few seconds:
    PYTHONPATH=harness:. ./engine/.venv/bin/python runtime/frame_buffer.py --game storm --secs 4 --drive
"""

from __future__ import annotations

import argparse
import io
import sys
import threading
import time
from collections import deque
from pathlib import Path
from typing import Callable, Optional

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
for p in (ROOT, ROOT / "runtime"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

import pixel_game as pg  # noqa: E402  (the rendered games + their CV agents)


# game id -> (GameClass, CVAgentClass, default no-op action). Each game renders
# a 168x120 RGB frame and steps on a string action — a ready FrameSource.
GAMES: dict[str, tuple[type, type, str]] = {
    "dodger": (pg.PixelDodger, pg.CVAgent, "stay"),
    "catcher": (pg.CatcherGame, pg.CatcherCVAgent, "stay"),
    "volley": (pg.VolleyGame, pg.VolleyCVAgent, "stay"),
    "storm": (pg.StormGame, pg.StormCVAgent, "stay"),
    "turret": (pg.TurretGame, pg.TurretCVAgent, "stay"),
    "forager": (pg.ForagerGame, pg.ForagerCVAgent, "stay"),
    "phantom": (pg.PhantomGame, pg.PhantomCVAgent, "stay"),
    "rally": (pg.RallyGame, pg.RallyCVAgent, "stay"),
}


# A self-contained browser game (reads the standard Gamepad API exactly as GFN
# does) for loginless verification that a BROWSER source feeds both buffers.
DEMO_HTML = (
    "<!doctype html><meta charset=utf8><body style='margin:0'>"
    "<canvas id=c width=320 height=180></canvas><script>"
    "let x=160,y=90,a=false;const ctx=document.getElementById('c').getContext('2d');"
    "setInterval(()=>{const g=navigator.getGamepads&&navigator.getGamepads()[0];"
    "if(g){x+=g.axes[0]*6;y+=g.axes[1]*6;a=g.buttons[0].pressed;"
    "x=Math.max(8,Math.min(312,x));y=Math.max(8,Math.min(172,y));}"
    "ctx.fillStyle=a?'#4ade80':'#0b1018';ctx.fillRect(0,0,320,180);"
    "ctx.fillStyle='#66c0f4';ctx.fillRect(x-8,y-8,16,16);},25);"
    "</script></body>"
)


class _Ring:
    """A tiny thread-safe ring buffer of (timestamp, item)."""

    def __init__(self, maxlen: int) -> None:
        self._dq: deque = deque(maxlen=maxlen)
        self._lock = threading.Lock()
        self.pushed = 0

    def push(self, t: float, item) -> None:
        with self._lock:
            self._dq.append((t, item))
            self.pushed += 1

    def latest(self):
        with self._lock:
            return self._dq[-1] if self._dq else None

    def window(self, n: Optional[int] = None) -> list:
        with self._lock:
            items = list(self._dq)
        return items if n is None else items[-n:]

    def __len__(self) -> int:
        with self._lock:
            return len(self._dq)


class GameSource:
    """Adapter over a pixel game: holds the game + a CV agent, applies the latest
    action, steps, and exposes the rendered frame. Auto-resets on game-over."""

    def __init__(self, game_id: str, seed: int = 1) -> None:
        if game_id not in GAMES:
            raise KeyError(f"unknown game {game_id!r}; have {sorted(GAMES)}")
        self.game_id = game_id
        self._cls, self._agent_cls, self.noop = GAMES[game_id]
        self._seed = seed
        self.game = self._cls(seed)
        self.episodes = 0
        self.best_score = 0

    def make_agent(self):
        a = self._agent_cls()
        if hasattr(a, "reset"):
            a.reset()
        return a

    def start(self) -> None:   # game already constructed in __init__
        pass

    def stop(self) -> None:
        pass

    def tick(self, action: str) -> np.ndarray:
        frame = self.game.step(action)
        if frame is None:                       # some steps return None; re-render
            frame = self.game.render_array()
        if getattr(self.game, "done", False):
            self.best_score = max(self.best_score, int(getattr(self.game, "score", 0)))
            self.episodes += 1
            self._seed += 1
            self.game.reset(self._seed)          # keep the env alive for the agent
        return frame


def encode_png(frame: np.ndarray, scale: int = 1) -> bytes:
    from PIL import Image

    img = Image.fromarray(frame)
    if scale != 1:
        img = img.resize((frame.shape[1] * scale, frame.shape[0] * scale), Image.NEAREST)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class DualRateBuffer:
    """Runs a GameSource at `video_hz` in a producer thread, filling a video ring
    (raw frames) every tick and a screenshot ring (PNG) at `shot_hz`. The agent
    reads the rings and calls :meth:`set_action` asynchronously."""

    def __init__(
        self,
        source: GameSource,
        *,
        video_hz: int = 120,
        shot_hz: int = 60,
        video_window_s: float = 1.0,
        shot_window_s: float = 2.0,
        shot_scale: int = 1,
    ) -> None:
        self.source = source
        self.video_hz = video_hz
        self.shot_hz = shot_hz
        self.shot_scale = shot_scale
        self.video = _Ring(maxlen=max(1, int(video_hz * video_window_s)))
        self.shots = _Ring(maxlen=max(1, int(shot_hz * shot_window_s)))
        self._action = source.noop
        self._action_lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._t0 = 0.0
        self._ticks = 0

    # ---- agent-facing API ------------------------------------------------- #

    def set_action(self, action: str) -> None:
        with self._action_lock:
            self._action = action

    def latest_video(self) -> Optional[np.ndarray]:
        v = self.video.latest()
        return v[1] if v else None

    def video_window(self, n: Optional[int] = None) -> list[np.ndarray]:
        return [f for _t, f in self.video.window(n)]

    def latest_shot(self) -> Optional[bytes]:
        v = self.shots.latest()
        return v[1] if v else None

    def shot_window(self, n: Optional[int] = None) -> list[bytes]:
        return [p for _t, p in self.shots.window(n)]

    def stats(self) -> dict:
        elapsed = max(1e-6, time.perf_counter() - self._t0) if self._t0 else 0.0
        return {
            "game": getattr(self.source, "game_id", "browser"),
            "ticks": self._ticks,
            "video_fps": round(self._ticks / elapsed, 1) if elapsed else 0.0,
            "shot_fps": round(self.shots.pushed / elapsed, 1) if elapsed else 0.0,
            "video_buffer": len(self.video),
            "shot_buffer": len(self.shots),
            "episodes": getattr(self.source, "episodes", 0),
            "best_score": getattr(self.source, "best_score", 0),
        }

    # ---- lifecycle -------------------------------------------------------- #

    def start(self) -> "DualRateBuffer":
        self._running = True
        self._t0 = time.perf_counter()
        self._thread = threading.Thread(target=self._produce, name="frame-producer", daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=1.0)

    def _produce(self) -> None:
        # The source is started HERE (in the producer thread) — required for the
        # browser source, whose Playwright objects are thread-affine.
        self.source.start()
        try:
            period = 1.0 / self.video_hz
            shot_every = max(1, round(self.video_hz / self.shot_hz))
            next_tick = time.perf_counter()
            while self._running:
                with self._action_lock:
                    action = self._action
                frame = self.source.tick(action)
                now = time.perf_counter()
                if frame is not None:
                    self.video.push(now, frame)
                    if self._ticks % shot_every == 0:
                        self.shots.push(now, encode_png(frame, self.shot_scale))
                self._ticks += 1
                # pace to the video rate; if we fell behind, resync without spiraling.
                next_tick += period
                slack = next_tick - time.perf_counter()
                if slack > 0:
                    time.sleep(slack)
                else:
                    next_tick = time.perf_counter()
        finally:
            self.source.stop()

    def __enter__(self):
        return self.start()

    def __exit__(self, *exc):
        self.stop()


def open_game(game_id: str, seed: int = 1, **kw) -> DualRateBuffer:
    """Open a game's environment ready-to-run with both buffers live — the agent
    attaches and reads immediately."""
    return DualRateBuffer(GameSource(game_id, seed), **kw).start()


class BrowserFrameSource:
    """Frame source for a BROWSER game (GeForce NOW) — gives an agent the SAME
    dual-rate buffers as a local game. Owns a Playwright page (created in the
    producer thread, for Playwright's thread-affinity), injects a virtual gamepad,
    applies the agent's GamepadAction each tick, and captures the current frame as
    an RGB array. The game runs autonomously on the cloud; we observe + inject.
    Capture rate is browser/stream-limited (not a true 120Hz), but the agent gets
    the identical video-buffer + screenshot-buffer experience.
    """

    def __init__(
        self,
        url: Optional[str] = None,
        *,
        headless: bool = False,
        capture: str = "auto",          # "auto" | "page" | "screen"
        capture_region=None,
        init_html: Optional[str] = None,  # for loginless self-test (a data: game)
        cdp_url: Optional[str] = None,    # attach to a Chrome the user already runs
    ) -> None:
        from steambench_harness.gamepad import STANDARD_GAMEPAD, GamepadAction

        from gfn_browser import GFN_URL

        self.url = url or GFN_URL
        self.headless = headless
        self.capture = capture
        self.capture_region = capture_region
        self.init_html = init_html
        self.cdp_url = cdp_url
        self._space = STANDARD_GAMEPAD
        self._GA = GamepadAction
        self.noop = GamepadAction()
        self._use_screen = capture == "screen"
        self._pw = self._ctx = self._page = None
        self._cdp = None
        self._screencast = False
        self._attached = False
        self._latest = None       # latest decoded screencast frame (np)

    def make_agent(self):
        from gamepad_agents import VisionGamepadAgent

        a = VisionGamepadAgent(goal="Play the game on screen; make progress.")
        a.reset()
        return a

    def start(self) -> None:
        from playwright.sync_api import sync_playwright

        from gfn_browser import GAMEPAD_INIT_JS

        self._pw = sync_playwright().start()
        if self.cdp_url:
            # Attach to a Chrome the USER launched (--remote-debugging-port) and
            # logged into GFN in. We don't own it, so we won't close it.
            self._attached = True
            browser = self._pw.chromium.connect_over_cdp(self.cdp_url)
            page = None
            for ctx in browser.contexts:
                for pg in ctx.pages:
                    if "geforcenow" in (pg.url or ""):
                        page = pg
                        break
                if page:
                    break
            if page is None:
                ctx0 = browser.contexts[0] if browser.contexts else browser.new_context()
                page = ctx0.pages[0] if ctx0.pages else ctx0.new_page()
            self._ctx = page.context
            self._page = page
            try:
                self._ctx.add_init_script(GAMEPAD_INIT_JS)        # future navigations
            except Exception:
                pass
            self._page.evaluate(GAMEPAD_INIT_JS)                  # the already-open page
        else:
            prof = str(ROOT / ".gfn-profile")
            kw = dict(headless=self.headless, viewport={"width": 1280, "height": 720},
                      args=["--disable-blink-features=AutomationControlled"],
                      ignore_default_args=["--enable-automation"])
            try:
                self._ctx = self._pw.chromium.launch_persistent_context(prof, channel="chrome", **kw)
            except Exception:
                self._ctx = self._pw.chromium.launch_persistent_context(prof, **kw)
            self._ctx.add_init_script(GAMEPAD_INIT_JS)
            self._page = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
            if self.init_html is not None:        # loginless self-test game
                import urllib.parse

                self._page.goto("data:text/html;charset=utf-8," + urllib.parse.quote(self.init_html))
            else:
                self._page.goto(self.url, wait_until="domcontentloaded")
        self._page.wait_for_timeout(60)
        try:
            self._page.evaluate("window.__gpFireConnected && window.__gpFireConnected()")
        except Exception:
            pass
        # CDP screencast: Chrome PUSHES frames (~30-60fps) — far faster than a
        # per-tick screenshot. Frames arrive on this (producer) thread while we
        # make page calls; we keep the latest decoded frame.
        if self.capture in ("auto", "page"):
            try:
                self._cdp = self._ctx.new_cdp_session(self._page)
                self._cdp.on("Page.screencastFrame", self._on_cast)
                self._cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 70, "everyNthFrame": 1})
                self._screencast = True
            except Exception:
                self._screencast = False

    def _on_cast(self, params: dict) -> None:
        import base64

        try:
            self._latest = self._png_to_np(base64.b64decode(params["data"]))  # PIL decodes JPEG too
        except Exception:
            pass
        try:
            self._cdp.send("Page.screencastFrameAck", {"sessionId": params["sessionId"]})
        except Exception:
            pass

    def tick(self, action):
        if self._page is None:
            return None
        from gfn_browser import action_to_state

        ga = action if isinstance(action, self._GA) else self._space.coerce(action)
        axes, buttons = action_to_state(ga)
        try:
            # applying the pad also pumps CDP events, so a screencast frame lands
            self._page.evaluate("([a,b]) => window.__gpSetState && window.__gpSetState(a,b)", [axes, buttons])
        except Exception:
            pass
        if self._screencast and self._latest is not None and not self._use_screen:
            f = self._latest
            if self.capture == "auto" and float(f.mean()) < 8.0:   # GPU-overlay black → OS capture
                self._use_screen = True
                return self._screen_np()
            return f
        return self._capture()

    def _png_to_np(self, png: bytes):
        if not png:
            return None
        try:
            from PIL import Image

            return np.asarray(Image.open(io.BytesIO(png)).convert("RGB"))
        except Exception:
            return None

    def _screen_np(self):
        import os
        import subprocess
        import tempfile

        out = os.path.join(tempfile.gettempdir(), "sb_fb_frame.png")
        cmd = ["screencapture", "-x", "-t", "png"]
        if self.capture_region:
            x, y, w, h = self.capture_region
            cmd.append(f"-R{x},{y},{w},{h}")
        cmd.append(out)
        try:
            subprocess.run(cmd, check=False, timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            with open(out, "rb") as f:
                return self._png_to_np(f.read())
        except Exception:
            return None

    def _capture(self):
        if self._use_screen:
            return self._screen_np()
        try:
            box = self._page.evaluate(
                "(() => { const v = document.querySelector('video,canvas'); if (!v) return null; "
                "const r = v.getBoundingClientRect(); return {x:r.x, y:r.y, width:r.width, height:r.height}; })()"
            )
            png = self._page.screenshot(clip=box) if (box and box["width"] > 4 and box["height"] > 4) else self._page.screenshot()
        except Exception:
            return None
        arr = self._png_to_np(png)
        if self.capture == "auto" and arr is not None and float(arr.mean()) < 8.0:
            self._use_screen = True            # GPU-overlay black → OS capture
            return self._screen_np()
        return arr

    def stop(self) -> None:
        try:
            if self._cdp:
                self._cdp.send("Page.stopScreencast")
        except Exception:
            pass
        # When attached to the user's own Chrome, never close it — only disconnect.
        closers = [lambda: self._pw and self._pw.stop()]
        if not self._attached:
            closers.insert(0, lambda: self._ctx and self._ctx.close())
        for fn in closers:
            try:
                fn()
            except Exception:
                pass


def open_browser(url: Optional[str] = None, *, video_hz: int = 120, shot_hz: int = 60, **src_kw) -> DualRateBuffer:
    """Open a browser game (GeForce NOW by default) with the same dual-rate
    buffers a local game gets. The agent reads video + screenshots and sets
    GamepadActions; the GFN game runs on the cloud."""
    return DualRateBuffer(BrowserFrameSource(url, **src_kw), video_hz=video_hz, shot_hz=shot_hz).start()


def drive_in_background(buf: DualRateBuffer, hz: int = 30) -> threading.Thread:
    """Run the game's CV agent off the video buffer at `hz`, in a daemon thread —
    so an opened game window is actually being *played* while you watch."""
    agent = buf.source.make_agent()

    def loop():
        period = 1.0 / hz
        while True:
            f = buf.latest_video()
            if f is not None:
                try:
                    buf.set_action(str(agent.act(f)))
                except Exception:
                    pass
            time.sleep(period)

    t = threading.Thread(target=loop, name="cv-driver", daemon=True)
    t.start()
    return t


def serve(buf: DualRateBuffer, port: int = 8420, fps: int = 60, scale: int = 3) -> None:
    """Open the game as a directly-viewable WINDOW: an MJPEG video stream of the
    live buffer over HTTP (any browser renders it), plus /shot.png and /stats."""
    import json
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    from PIL import Image

    viewer = (
        "<!doctype html><meta charset=utf8><title>SteamBench frame stream</title>"
        "<body style='margin:0;background:#0b1018;color:#8aa0bd;font-family:monospace;text-align:center'>"
        f"<h3 style='color:#66c0f4'>{buf.source.game_id} — live 120Hz video stream</h3>"
        "<img src='/video.mjpeg' style='image-rendering:pixelated;width:min(90vw,720px);border-radius:12px'>"
        "<p>video buffer @120Hz · screenshot buffer @60Hz · <a style='color:#22d3ee' href='/shot.png'>/shot.png</a>"
        " · <a style='color:#22d3ee' href='/stats'>/stats</a></p></body>"
    ).encode()

    def jpeg(frame: np.ndarray) -> bytes:
        img = Image.fromarray(frame)
        if scale != 1:
            img = img.resize((frame.shape[1] * scale, frame.shape[0] * scale), Image.NEAREST)
        b = io.BytesIO(); img.save(b, format="JPEG", quality=80)
        return b.getvalue()

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):  # quiet
            pass

        def do_GET(self):
            if self.path.startswith("/video.mjpeg"):
                self.send_response(200)
                self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
                self.end_headers()
                period = 1.0 / fps
                try:
                    while True:
                        f = buf.latest_video()
                        if f is not None:
                            j = jpeg(f)
                            self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\n")
                            self.wfile.write(f"Content-Length: {len(j)}\r\n\r\n".encode())
                            self.wfile.write(j); self.wfile.write(b"\r\n")
                        time.sleep(period)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            elif self.path.startswith("/shot.png"):
                png = buf.latest_shot() or b""
                self.send_response(200); self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(png))); self.end_headers()
                self.wfile.write(png)
            elif self.path.startswith("/stats"):
                data = json.dumps(buf.stats()).encode()
                self.send_response(200); self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data))); self.end_headers()
                self.wfile.write(data)
            else:
                self.send_response(200); self.send_header("Content-Type", "text/html")
                self.send_header("Content-Length", str(len(viewer))); self.end_headers()
                self.wfile.write(viewer)

    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    print(f"  ▶ stream window: http://127.0.0.1:{port}/  (MJPEG video · /shot.png · /stats) — Ctrl-C to stop")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


# ======================================================================== #
# CLI / demo
# ======================================================================== #


def drive_browser_in_background(buf: DualRateBuffer, hz: int = 8) -> threading.Thread:
    """Drive a browser game with a vision gamepad agent off the screenshot buffer
    (slower cadence — vision decisions are expensive). Daemon thread."""
    import base64

    from steambench_harness.protocol import Observation

    agent = buf.source.make_agent()

    def loop():
        period = 1.0 / hz
        while True:
            shot = buf.latest_shot()
            if shot:
                obs = Observation(step=0, state={}, frame=base64.b64encode(shot).decode("ascii"), legal_actions=[])
                try:
                    buf.set_action(agent.act(obs))
                except Exception:
                    pass
            time.sleep(period)

    t = threading.Thread(target=loop, name="browser-driver", daemon=True)
    t.start()
    return t


def _browser_test(args) -> int:
    """Loginless proof: a GFN-class browser game (reads the Gamepad API) feeds the
    SAME dual-rate buffers — the agent's gamepad moves it and both buffers fill."""
    from steambench_harness.gamepad import GamepadAction

    buf = open_browser(init_html=DEMO_HTML, headless=True, video_hz=args.video_hz, shot_hz=args.shot_hz)
    print("▶ a loginless browser game (standard Gamepad API, GFN-class) feeding the dual-rate buffers…")
    moves = [GamepadAction.move(lx=1.0), GamepadAction.move(ly=1.0), GamepadAction.move(lx=-1.0), GamepadAction.press("A")]
    end = time.perf_counter() + args.secs
    i = 0
    while time.perf_counter() < end:
        buf.set_action(moves[i % len(moves)])   # agent drives via the gamepad
        i += 1
        time.sleep(0.4)
    time.sleep(0.2)
    s = buf.stats()
    vid = buf.video_window()
    shot = buf.latest_shot()
    buf.stop()
    # the only motion in the game is the sprite the gamepad drives, so frame
    # variance across the buffer ⇔ the injected gamepad actually moved it.
    moving = len(vid) >= 2 and any(not np.array_equal(vid[0], f) for f in vid[1:])
    print("\n── browser → dual buffers ──────────────")
    print(f"  video:  {s['video_fps']:>5} fps · buffer holds {s['video_buffer']} frames {'(moving)' if moving else '(static)'}")
    print(f"  shots:  {s['shot_fps']:>5} fps · buffer holds {s['shot_buffer']} PNGs · latest = {len(shot or b'')} bytes")
    path = ("OS screen capture" if buf.source._use_screen
            else "CDP screencast" if buf.source._screencast else "in-page screenshot")
    print(f"  capture path: {path} (browser-limited rate)")
    ok = s["video_buffer"] > 0 and s["shot_buffer"] > 0 and bool(shot) and moving
    print("\n" + ("PASS — an agent on a BROWSER game gets the same two buffers (video + screenshot); "
                  "the gamepad drove it (sprite moved). Point --gfn at GeForce NOW for the real thing."
                  if ok else "FAIL — see numbers above."))
    return 0 if ok else 1


def _gfn(args) -> int:
    """Open GeForce NOW with the dual-rate buffers + a viewable stream window; you
    log into NVIDIA + start a game, the agent gets video + screenshot buffers."""
    buf = open_browser(args.url or None, headless=False, cdp_url=args.cdp or None,
                       video_hz=args.video_hz, shot_hz=args.shot_hz)
    if args.cdp:
        print(f"▶ Attaching to your Chrome at {args.cdp} (already logged into GFN).")
    else:
        print("▶ Opening GeForce NOW — log into NVIDIA + start a game in the window.")
    print("  The agent reads a video buffer + screenshot buffer; watch the captured stream below.")
    drive_browser_in_background(buf, hz=6)
    serve(buf)            # view what the agent sees + /stats
    buf.stop()
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description="Dual-rate game frame buffers (120Hz video + 60Hz screenshots)")
    ap.add_argument("--game", default="dodger", choices=sorted(GAMES))
    ap.add_argument("--secs", type=float, default=3.0)
    ap.add_argument("--video-hz", type=int, default=120)
    ap.add_argument("--shot-hz", type=int, default=60)
    ap.add_argument("--drive", action="store_true", help="let the game's CV agent drive via the buffer (30Hz)")
    ap.add_argument("--serve", action="store_true", help="open the game as a viewable MJPEG stream window (HTTP)")
    ap.add_argument("--port", type=int, default=8420)
    ap.add_argument("--browser-test", action="store_true", help="loginless: a browser game feeds the dual buffers")
    ap.add_argument("--gfn", action="store_true", help="open GeForce NOW with the dual buffers + stream window")
    ap.add_argument("--url", default="", help="override the browser URL (for --gfn)")
    ap.add_argument("--cdp", default="", help="attach to your already-running Chrome, e.g. http://localhost:9222")
    args = ap.parse_args()

    if args.browser_test:
        raise SystemExit(_browser_test(args))
    if args.gfn:
        raise SystemExit(_gfn(args))

    buf = open_game(args.game, video_hz=args.video_hz, shot_hz=args.shot_hz)
    print(f"▶ opened '{args.game}' — video@{args.video_hz}Hz + screenshots@{args.shot_hz}Hz, agent can read now.")

    if args.serve:
        drive_in_background(buf, hz=30)   # the CV agent plays it so the window is live
        serve(buf, port=args.port)
        buf.stop()
        return

    if args.drive:
        # Decoupled control: agent decides at 30Hz off the latest video frame
        # while the game runs at the full video rate.
        agent = buf.source.make_agent()
        decided = 0
        end = time.perf_counter() + args.secs
        while time.perf_counter() < end:
            frame = buf.latest_video()
            if frame is not None:
                try:
                    action = agent.act(frame)
                except Exception:
                    action = buf.source.noop
                buf.set_action(str(action))
                decided += 1
            time.sleep(1 / 30)
        print(f"  agent decided {decided}x at ~30Hz while the game ran at the video rate.")
    else:
        time.sleep(args.secs)

    s = buf.stats()
    buf.stop()
    # one screenshot to prove the buffer holds real frames
    shot = buf.latest_shot()
    vid = buf.video_window()
    moved = ""
    if len(vid) >= 2:
        moved = "moving" if not np.array_equal(vid[-1], vid[-2]) else "static"
    print("\n── buffers ─────────────────────────────")
    print(f"  video:  {s['video_fps']:>6} fps (target {args.video_hz}) · buffer holds {s['video_buffer']} raw frames {f'({moved})' if moved else ''}")
    print(f"  shots:  {s['shot_fps']:>6} fps (target {args.shot_hz}) · buffer holds {s['shot_buffer']} PNGs · latest = {len(shot or b'')} bytes")
    print(f"  game:   {s['ticks']} ticks · {s['episodes']} episodes auto-reset · best score {s['best_score']}")
    ok = s["video_fps"] >= args.video_hz * 0.8 and s["shot_fps"] >= args.shot_hz * 0.8 and bool(shot)
    print("\n" + ("PASS — both buffers live at ~target rate; agent can read video + screenshots."
                  if ok else "NOTE — achieved rate below target (Python timing); see numbers above."))


if __name__ == "__main__":
    main()
