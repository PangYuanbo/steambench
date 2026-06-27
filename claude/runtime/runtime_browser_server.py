#!/usr/bin/env python3
"""Minimal persistent browser runtime: one display, one capture loop, one API."""

from __future__ import annotations

import argparse
import hmac
import io
import json
import os
import queue
import subprocess
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

GAMEPAD_INIT_JS = r"""
(() => {
  const mkButtons = () => Array.from({length: 17}, () => ({pressed: false, touched: false, value: 0}));
  const pad = {id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index: 0,
    connected: true, mapping: 'standard', timestamp: performance.now(),
    axes: [0, 0, 0, 0], buttons: mkButtons(), vibrationActuator: null};
  window.__gpPad = pad;
  window.__gpSetState = (axes, buttons) => {
    if (axes) for (let i = 0; i < axes.length; i++) pad.axes[i] = axes[i];
    if (buttons) for (let i = 0; i < buttons.length; i++) {
      const v = typeof buttons[i] === 'number' ? buttons[i] : (buttons[i] ? 1 : 0);
      pad.buttons[i].value = v; pad.buttons[i].pressed = v >= 0.5; pad.buttons[i].touched = v > 0;
    }
    pad.timestamp = performance.now();
  };
  window.__gpFireConnected = () => { const e = new Event('gamepadconnected'); e.gamepad = pad; window.dispatchEvent(e); };
  const getGamepads = () => [pad, null, null, null];
  try { Object.defineProperty(Navigator.prototype, 'getGamepads', {value: getGamepads, configurable: true}); }
  catch (_) { Object.defineProperty(navigator, 'getGamepads', {value: getGamepads, configurable: true}); }
})();
"""


class Runtime:
    def __init__(self, profile: str, width: int, height: int, capture_hz: int, record_hz: int):
        self.width, self.height = width, height
        self.capture_hz, self.record_hz = capture_hz, record_hz
        self.commands: queue.Queue = queue.Queue()
        self.latest: bytes | None = None
        self.frame_id = 0
        self.capture_times: list[float] = []
        self.recorded_frames = 0
        self.captured_frames = 0
        self.running = True
        self.record: subprocess.Popen | None = None
        self.record_path: str | None = None
        self.lock = threading.Lock()
        self.frame_ready = threading.Condition(self.lock)
        self.thread = threading.Thread(target=self._browser, args=(profile,), daemon=True)
        self.thread.start()
        threading.Thread(target=self._capture, daemon=True).start()

    def _browser(self, profile: str):
        state_path = Path(profile) / "storage-state.json"
        previous_state = Path(profile) / "storage-state.previous.json"
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=False,
                executable_path=os.environ.get("CHROME_PATH") or None,
                args=[
                    "--no-sandbox", "--disable-dev-shm-usage",
                    "--disable-blink-features=AutomationControlled",
                    "--disable-features=WebRtcHideLocalIpsWithMdns",
                    "--force-webrtc-ip-handling-policy=default",
                    "--autoplay-policy=no-user-gesture-required",
                    "--window-position=0,0", f"--window-size={self.width},{self.height}",
                ],
            )
            self.context = browser.new_context(
                viewport={"width": self.width, "height": self.height},
                storage_state=str(state_path if state_path.exists() else previous_state) if (state_path.exists() or previous_state.exists()) else None,
            )
            self.context.grant_permissions(["camera", "microphone"], origin="https://play.geforcenow.com")
            self.context.add_init_script(GAMEPAD_INIT_JS)
            if not self.context.pages:
                self.context.new_page()
            for page in self.context.pages:
                self._prepare(page)
            self.context.on("page", self._prepare)
            while self.running:
                try:
                    command, args, reply = self.commands.get(timeout=0.05)
                except queue.Empty:
                    continue
                try:
                    reply.put((True, self._run(command, args)))
                except Exception as error:
                    reply.put((False, str(error)))
            state_path.parent.mkdir(parents=True, exist_ok=True)
            self.context.storage_state(path=str(state_path), indexed_db=True)
            browser.close()

    def _prepare(self, page):
        try:
            page.evaluate(GAMEPAD_INIT_JS)
            page.evaluate("window.__gpFireConnected && window.__gpFireConnected()")
        except Exception:
            pass

    def _page(self):
        pages = self.context.pages
        return next((page for page in reversed(pages) if "play.geforcenow.com" in page.url), pages[-1])

    def _run(self, command: str, args: dict):
        page = self._page()
        if command == "goto":
            page.goto(args["url"], wait_until="domcontentloaded", timeout=120_000)
            self._prepare(page)
        elif command == "pad":
            page.evaluate("([a,b]) => window.__gpSetState(a,b)", [args["axes"], args["buttons"]])
        elif command == "key":
            action = args.get("action", "press")
            getattr(page.keyboard, action)(args["key"])
        elif command == "mouse":
            action = args.get("action", "click")
            if action == "wheel":
                page.mouse.wheel(float(args.get("x", 0)), float(args.get("y", 0)))
            elif action == "move":
                page.mouse.move(float(args["x"]), float(args["y"]))
            elif action in {"down", "up"}:
                getattr(page.mouse, action)(button=args.get("button", "left"))
            else:
                getattr(page.mouse, action)(float(args["x"]), float(args["y"]), button=args.get("button", "left"))
        elif command == "eval":
            return page.evaluate(args["expression"], args.get("argument"))
        elif command == "cookies":
            return self.context.cookies(args.get("urls", []))
        elif command == "set_cookie":
            self.context.add_cookies([args])
            return self.context.cookies([args["url"]])
        elif command == "tab":
            page = self.context.pages[int(args["index"])]
            page.bring_to_front()
            return {"url": page.url, "title": page.title()}
        elif command in {"reload", "back", "forward"}:
            getattr(page, command)(wait_until="domcontentloaded", timeout=120_000)
        elif command == "fullscreen":
            cdp = self.context.new_cdp_session(page)
            result = cdp.send("Runtime.evaluate", {
                "expression": "document.documentElement.requestFullscreen().then(()=>true).catch(()=>false)",
                "awaitPromise": True, "returnByValue": True, "userGesture": True,
            })
            return result.get("result", {}).get("value", False)
        elif command == "tabs":
            return [{"index": index, "title": item.title(), "url": item.url} for index, item in enumerate(self.context.pages)]
        elif command == "shutdown":
            Path("/profile").mkdir(parents=True, exist_ok=True)
            self.context.storage_state(path="/profile/storage-state.json", indexed_db=True)
            self.running = False
        return {"url": page.url, "title": page.title()}

    def call(self, command: str, args: dict | None = None):
        reply: queue.Queue = queue.Queue(maxsize=1)
        self.commands.put((command, args or {}, reply))
        ok, result = reply.get(timeout=130)
        if not ok:
            raise RuntimeError(result)
        return result

    def _capture(self):
        import mss

        period = 1 / self.capture_hz
        monitor = {"left": 0, "top": 0, "width": self.width, "height": self.height}
        next_frame = time.monotonic()
        with mss.mss() as capture:
            while self.running:
                frame = capture.grab(monitor)
                now = time.monotonic()
                raw = bytes(frame.rgb)
                with self.lock:
                    self.latest = raw
                    self.captured_frames += 1
                    self.frame_id += 1
                    self.capture_times.append(now)
                    self.capture_times = self.capture_times[-self.capture_hz * 10:]
                    record = self.record
                    self.frame_ready.notify_all()
                if record and self.captured_frames % max(1, self.capture_hz // self.record_hz) == 0:
                    try:
                        record.stdin.write(raw)
                        self.recorded_frames += 1
                    except Exception:
                        pass
                next_frame += period
                time.sleep(max(0, next_frame - time.monotonic()))

    def jpeg(self, after: int = -1) -> tuple[int, bytes]:
        with self.lock:
            if after >= self.frame_id:
                self.frame_ready.wait_for(lambda: self.frame_id > after or not self.running, timeout=2)
            frame_id = self.frame_id
            raw = self.latest
        if raw is None:
            return frame_id, b""
        output = io.BytesIO()
        Image.frombytes("RGB", (self.width, self.height), raw).save(output, "JPEG", quality=70)
        return frame_id, output.getvalue()

    def start_recording(self, path: str):
        if self.record:
            return self.record_path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.record_path = path
        self.recorded_frames = 0
        self.record = subprocess.Popen([
            "ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
            "-s", f"{self.width}x{self.height}", "-r", str(self.record_hz), "-i", "-", "-an",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", path,
        ], stdin=subprocess.PIPE)
        return path

    def stop_recording(self):
        with self.lock:
            process, self.record = self.record, None
        if process:
            process.stdin.close()
            process.wait(timeout=30)
        return {"path": self.record_path, "frames": self.recorded_frames}

    def health(self):
        now = time.monotonic()
        recent = [stamp for stamp in self.capture_times if now - stamp <= 5]
        span = recent[-1] - recent[0] if len(recent) > 1 else 0
        return {
            "ok": self.running,
            "capture_hz": round((len(recent) - 1) / span, 2) if span else 0,
            "capture_target_hz": self.capture_hz,
            "record_target_hz": self.record_hz,
            "recording": bool(self.record),
            "recorded_frames": self.recorded_frames,
        }


class Handler(BaseHTTPRequestHandler):
    runtime: Runtime
    token: str

    def _authorized(self):
        supplied = self.headers.get("Authorization", "").removeprefix("Bearer ")
        return hmac.compare_digest(supplied, self.token)

    def _json(self, status: int, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._authorized():
            return self._json(401, {"error": "unauthorized"})
        if self.path == "/health":
            return self._json(200, self.runtime.health())
        if self.path.startswith("/frame"):
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            frame_id, body = self.runtime.jpeg(int(query.get("after", [-1])[0]))
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("X-Frame-Id", str(frame_id))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        if self.path == "/tabs":
            return self._json(200, self.runtime.call("tabs"))
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self._authorized():
            return self._json(401, {"error": "unauthorized"})
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        try:
            if self.path == "/record/start":
                return self._json(200, {"path": self.runtime.start_recording(body.get("path", "/recordings/runtime.mp4"))})
            if self.path == "/record/stop":
                return self._json(200, self.runtime.stop_recording())
            command = self.path.removeprefix("/")
            result = self.runtime.call(command, body)
            self._json(200, result)
        except Exception as error:
            self._json(500, {"error": str(error)})

    def log_message(self, *_):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", default="/profile")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--capture-hz", type=int, default=60)
    parser.add_argument("--record-hz", type=int, default=30)
    parser.add_argument("--token", required=True)
    args = parser.parse_args()
    runtime = Runtime(args.profile, args.width, args.height, args.capture_hz, args.record_hz)
    Handler.runtime = runtime
    Handler.token = args.token
    ThreadingHTTPServer(("0.0.0.0", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
