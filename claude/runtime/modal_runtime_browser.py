#!/usr/bin/env python3
"""Launch a persistent Modal browser runtime in AWS Oregon."""

from __future__ import annotations

import argparse
import json
import secrets
import urllib.request
from pathlib import Path

import modal


ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".runtime-browser.json"
app = modal.App.lookup("steambench-runtime-browser", create_if_missing=True)
profile = modal.Volume.from_name("steambench-browser-profile", create_if_missing=True)
recordings = modal.Volume.from_name("steambench-browser-recordings", create_if_missing=True)
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "xvfb", "openbox", "x11vnc", "novnc", "websockify", "chromium")
    .pip_install("playwright==1.60.0", "pillow", "mss")
    .run_commands("playwright install-deps chromium", "playwright install chromium")
    .add_local_file(ROOT / "runtime/runtime_browser_server.py", "/app/runtime_browser_server.py")
)


def start(timeout: int):
    api_token = secrets.token_urlsafe(24)
    vnc_password = secrets.token_urlsafe(12)
    sandbox = modal.Sandbox.create(
        "bash", "-lc",
        "Xvfb :0 -screen 0 1280x720x24 -nolisten tcp & "
        "openbox >/tmp/openbox.log 2>&1 & "
        f"x11vnc -display :0 -forever -shared -passwd {vnc_password} -rfbport 5900 >/tmp/x11vnc.log 2>&1 & "
        "websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/novnc.log 2>&1 & "
        f"DISPLAY=:0 CHROME_PATH=/usr/bin/chromium PYTHONPATH=/app python /app/runtime_browser_server.py --profile /profile --token {api_token}",
        app=app, image=image, cloud="aws", region="us-west-2",
        cpu=8, memory=16384, timeout=timeout, idle_timeout=timeout,
        encrypted_ports=[8765, 6080], volumes={"/profile": profile, "/recordings": recordings},
    )
    tunnels = sandbox.tunnels(timeout=180)
    state = {
        "sandbox_id": sandbox.object_id,
        "api_url": tunnels[8765].url,
        "live_view_url": tunnels[6080].url + "/vnc.html?autoconnect=true&resize=scale",
        "api_token": api_token,
        "vnc_password": vnc_password,
    }
    STATE.write_text(json.dumps(state, indent=2) + "\n")
    print(json.dumps(state, indent=2))


def stop():
    state = json.loads(STATE.read_text())
    sandbox = modal.Sandbox.from_id(state["sandbox_id"])
    command = (
        "mv /profile/storage-state.json /profile/storage-state.previous.json 2>/dev/null || true; "
        f"curl -fsS -X POST -H 'Authorization: Bearer {state['api_token']}' http://127.0.0.1:8765/shutdown >/dev/null; "
        "for i in $(seq 1 100); do [ -s /profile/storage-state.json ] && break; sleep 0.1; done; "
        "test -s /profile/storage-state.json; sync /profile; sync /recordings"
    )
    process = sandbox.exec("bash", "-lc", command, timeout=120)
    process.wait()
    if process.returncode != 0:
        raise RuntimeError(process.stderr.read())
    sandbox.terminate(wait=True)
    print(json.dumps({"stopped": state["sandbox_id"]}, indent=2))


def status():
    state = json.loads(STATE.read_text())
    request = urllib.request.Request(
        state["api_url"] + "/health",
        headers={"Authorization": f"Bearer {state['api_token']}"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        state["health"] = json.load(response)
    print(json.dumps(state, indent=2))


def download(remote: str, local: str):
    state = json.loads(STATE.read_text())
    sandbox = modal.Sandbox.from_id(state["sandbox_id"])
    process = sandbox.exec("cat", remote, timeout=120, text=False)
    Path(local).write_bytes(process.stdout.read())
    if process.wait() != 0:
        raise RuntimeError(process.stderr.read().decode(errors="replace"))
    print(json.dumps({"remote": remote, "local": str(Path(local).resolve())}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    start_parser = commands.add_parser("start")
    start_parser.add_argument("--timeout", type=int, default=21600)
    commands.add_parser("status")
    commands.add_parser("stop")
    download_parser = commands.add_parser("download")
    download_parser.add_argument("remote")
    download_parser.add_argument("local")
    args = parser.parse_args()
    if args.command == "start":
        start(args.timeout)
    elif args.command == "status":
        status()
    elif args.command == "stop":
        stop()
    else:
        download(args.remote, args.local)
