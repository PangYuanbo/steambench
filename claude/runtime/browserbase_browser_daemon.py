#!/usr/bin/env python3
"""E2B-compatible HTTP bridge for the persistent Browserbase GFN session.

    BROWSERBASE_API_KEY=... python runtime/browserbase_browser_daemon.py

Endpoints:
    GET  /health  session and stream status
    GET  /frame   latest full-resolution PNG
    GET  /stream  multipart JPEG stream for a browser ``<img>``
    POST /pad     standard gamepad state: {"axes": [...], "buttons": [...]}

Playwright owns one thread. HTTP handlers communicate through a queue so frame
capture and controller writes never call the sync Playwright API concurrently.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import queue
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional

from gfn_browser import GAMEPAD_INIT_JS


ROOT = Path(__file__).resolve().parents[1]
STATE_PATH = ROOT / ".browserbase-gfn.json"
API_BASE = "https://api.browserbase.com/v1"


def browserbase_get(path: str) -> dict:
    key = os.environ.get("BROWSERBASE_API_KEY")
    if not key:
        raise SystemExit("BROWSERBASE_API_KEY is required")
    request = urllib.request.Request(API_BASE + path, headers={"X-BB-API-Key": key})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


@dataclass
class Command:
    name: str
    payload: Any = None
    done: threading.Event = field(default_factory=threading.Event)
    result: Any = None
    error: Optional[BaseException] = None


class Bridge:
    def __init__(self, fps: float, jpeg_quality: int):
        state = json.loads(STATE_PATH.read_text())
        self.session_id = state.get("session_id")
        if not self.session_id:
            raise SystemExit("No running Browserbase session")
        self.fps = fps
        self.jpeg_quality = jpeg_quality
        self.commands: queue.Queue[Command] = queue.Queue()
        self.frame_condition = threading.Condition()
        self.latest_jpeg = b""
        self.frame_number = 0
        self.url = ""
        self.error = ""
        self.ready = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self.thread.start()
        if not self.ready.wait(30):
            raise SystemExit("Timed out connecting to Browserbase")
        if self.error:
            raise SystemExit(self.error)

    def call(self, name: str, payload: Any = None, timeout: float = 20) -> Any:
        command = Command(name, payload)
        self.commands.put(command)
        if not command.done.wait(timeout):
            raise TimeoutError(f"Browser command timed out: {name}")
        if command.error:
            raise command.error
        return command.result

    def _run(self) -> None:
        try:
            from playwright.sync_api import sync_playwright

            session = browserbase_get(f"/sessions/{self.session_id}")
            with sync_playwright() as playwright:
                browser = playwright.chromium.connect_over_cdp(session["connectUrl"])
                context = browser.contexts[0]
                context.add_init_script(GAMEPAD_INIT_JS)
                page = next((item for item in context.pages if "/games?" in item.url), None)
                page = page or next((item for item in context.pages if "geforcenow.com" in item.url), None)
                page = page or context.pages[0]
                page.evaluate(GAMEPAD_INIT_JS)
                page.evaluate("window.__gpFireConnected && window.__gpFireConnected()")
                self.url = page.url
                self.ready.set()
                cdp = context.new_cdp_session(page)
                last_frame_at = 0.0

                def on_frame(event):
                    nonlocal last_frame_at
                    cdp.send("Page.screencastFrameAck", {"sessionId": event["sessionId"]})
                    now = time.monotonic()
                    if now - last_frame_at < 1 / max(self.fps, 0.1):
                        return
                    last_frame_at = now
                    with self.frame_condition:
                        self.latest_jpeg = base64.b64decode(event["data"])
                        self.frame_number += 1
                        self.frame_condition.notify_all()

                cdp.on("Page.screencastFrame", on_frame)
                cdp.send("Page.startScreencast", {
                    "format": "jpeg",
                    "quality": self.jpeg_quality,
                    "maxWidth": 1280,
                    "maxHeight": 720,
                    "everyNthFrame": 1,
                })
                while True:
                    try:
                        command = self.commands.get_nowait()
                    except queue.Empty:
                        command = None
                    if command:
                        try:
                            if command.name == "pad":
                                axes = command.payload.get("axes", [0, 0, 0, 0])
                                buttons = command.payload.get("buttons", [0] * 17)
                                page.evaluate(
                                    "([a,b]) => window.__gpSetState(a,b)",
                                    [axes, buttons],
                                )
                                command.result = {"ok": True}
                            elif command.name == "frame":
                                with self.frame_condition:
                                    jpeg = self.latest_jpeg
                                if not jpeg:
                                    raise RuntimeError("No screencast frame available yet")
                                from PIL import Image
                                output = io.BytesIO()
                                Image.open(io.BytesIO(jpeg)).save(output, "PNG")
                                command.result = output.getvalue()
                            elif command.name == "stop":
                                command.result = {"ok": True}
                                command.done.set()
                                browser.close()
                                return
                        except BaseException as error:
                            command.error = error
                        command.done.set()
                    page.wait_for_timeout(10)
        except BaseException as error:
            self.error = str(error)
            self.ready.set()
            with self.frame_condition:
                self.frame_condition.notify_all()


def make_handler(bridge: Bridge):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            return

        def send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path.startswith("/health"):
                body = json.dumps({
                    "ok": not bool(bridge.error),
                    "provider": "browserbase",
                    "session_id": bridge.session_id,
                    "url": bridge.url,
                    "frame_number": bridge.frame_number,
                    "fps_target": bridge.fps,
                    "error": bridge.error or None,
                }).encode()
                return self.send(200, body, "application/json")
            if self.path.startswith("/frame"):
                try:
                    return self.send(200, bridge.call("frame"), "image/png")
                except BaseException as error:
                    return self.send(500, str(error).encode(), "text/plain")
            if self.path.startswith("/stream"):
                self.send_response(200)
                self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                seen = -1
                try:
                    while not bridge.error:
                        with bridge.frame_condition:
                            bridge.frame_condition.wait_for(
                                lambda: bridge.frame_number != seen or bridge.error,
                                timeout=10,
                            )
                            seen = bridge.frame_number
                            frame = bridge.latest_jpeg
                        if not frame:
                            continue
                        self.wfile.write(
                            b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                            + str(len(frame)).encode()
                            + b"\r\n\r\n"
                            + frame
                            + b"\r\n"
                        )
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            self.send(404, b"not found", "text/plain")

        def do_POST(self):
            if not self.path.startswith("/pad"):
                return self.send(404, b"not found", "text/plain")
            try:
                size = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(size) or b"{}")
                body = json.dumps(bridge.call("pad", payload)).encode()
                return self.send(200, body, "application/json")
            except BaseException as error:
                return self.send(500, str(error).encode(), "text/plain")

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--fps", type=float, default=2.0)
    parser.add_argument("--jpeg-quality", type=int, default=70)
    args = parser.parse_args()
    bridge = Bridge(args.fps, args.jpeg_quality)
    bridge.start()
    server = ThreadingHTTPServer((args.host, args.port), make_handler(bridge))
    print(json.dumps({
        "ok": True,
        "frame": f"http://{args.host}:{args.port}/frame",
        "stream": f"http://{args.host}:{args.port}/stream",
        "pad": f"http://{args.host}:{args.port}/pad",
        "session_id": bridge.session_id,
    }), flush=True)
    try:
        server.serve_forever()
    finally:
        bridge.call("stop", timeout=5)


if __name__ == "__main__":
    main()
