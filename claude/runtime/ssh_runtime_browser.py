#!/usr/bin/env python3
"""Run the minimal browser runtime on an existing Linux host over SSH."""

from __future__ import annotations

import argparse
import json
import secrets
import shlex
import subprocess
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".runtime-browser-vm.json"
REMOTE = "/root/runtime-browser"


def run(*args: str, check: bool = True):
    return subprocess.run(args, check=check, text=True, capture_output=True)


def ssh(host: str, command: str):
    return run("ssh", host, command)


def start(host: str):
    token = secrets.token_urlsafe(24)
    run("scp", str(ROOT / "runtime/runtime_browser_server.py"), f"{host}:/tmp/runtime_browser_server.py")
    run("scp", str(ROOT / "runtime/runtime_browser_check.py"), f"{host}:/tmp/runtime_browser_check.py")
    command = f"""set -e
mkdir -p {REMOTE}/profile {REMOTE}/recordings
for name in server xvfb openbox x11vnc websockify; do
  [ -s {REMOTE}/$name.pid ] && kill $(cat {REMOTE}/$name.pid) 2>/dev/null || true
done
Xvfb :99 -screen 0 1280x720x24 -nolisten tcp >/tmp/runtime-xvfb.log 2>&1 & echo $! >{REMOTE}/xvfb.pid
sleep 1
DISPLAY=:99 openbox >/tmp/runtime-openbox.log 2>&1 & echo $! >{REMOTE}/openbox.pid
x11vnc -display :99 -localhost -forever -shared -nopw -rfbport 5900 >/tmp/runtime-x11vnc.log 2>&1 & echo $! >{REMOTE}/x11vnc.pid
websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 >/tmp/runtime-websockify.log 2>&1 & echo $! >{REMOTE}/websockify.pid
DISPLAY=:99 CHROME_PATH=/snap/bin/chromium nohup {REMOTE}/venv/bin/python /tmp/runtime_browser_server.py --profile {REMOTE}/profile --host 127.0.0.1 --token {token} >/tmp/runtime-browser.log 2>&1 & echo $! >{REMOTE}/server.pid
for i in $(seq 1 100); do
  python3 -c \"import urllib.request; r=urllib.request.Request('http://127.0.0.1:8765/health',headers={{'Authorization':'Bearer {token}'}}); urllib.request.urlopen(r)\" 2>/dev/null && exit 0
  sleep .2
done
cat /tmp/runtime-browser.log
exit 1"""
    ssh(host, command)
    state = {"host": host, "api_token": token, "api_url": "http://127.0.0.1:8765", "live_view_url": "http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale"}
    STATE.write_text(json.dumps(state, indent=2) + "\n")
    STATE.chmod(0o600)
    print(json.dumps(state, indent=2))


def remote_json(path: str, body: dict | None = None):
    state = json.loads(STATE.read_text())
    code = "import json,urllib.request; "
    data = "None" if body is None else repr(json.dumps(body).encode())
    code += f"r=urllib.request.Request('http://127.0.0.1:8765{path}',data={data},headers={{'Authorization':'Bearer {state['api_token']}','Content-Type':'application/json'}}); print(urllib.request.urlopen(r).read().decode())"
    return json.loads(ssh(state["host"], f"python3 -c {shlex.quote(code)}").stdout)


def status():
    print(json.dumps(remote_json("/health"), indent=2))


def stop():
    state = json.loads(STATE.read_text())
    remote_json("/shutdown", {})
    command = f"sleep 1; for name in server xvfb openbox x11vnc websockify; do [ -s {REMOTE}/$name.pid ] && kill $(cat {REMOTE}/$name.pid) 2>/dev/null || true; done"
    ssh(state["host"], command)
    print(json.dumps({"stopped": state["host"]}, indent=2))


def tunnel():
    state = json.loads(STATE.read_text())
    subprocess.run(["ssh", "-N", "-L", "8765:127.0.0.1:8765", "-L", "6080:127.0.0.1:6080", state["host"]], check=True)


def check():
    state = json.loads(STATE.read_text())
    command = f"{REMOTE}/venv/bin/python /tmp/runtime_browser_check.py --token {shlex.quote(state['api_token'])} --record-path {REMOTE}/recordings/check.mp4"
    print(ssh(state["host"], command).stdout)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    start_parser = commands.add_parser("start")
    start_parser.add_argument("host")
    commands.add_parser("status")
    commands.add_parser("stop")
    commands.add_parser("tunnel")
    commands.add_parser("check")
    args = parser.parse_args()
    if args.command == "start":
        start(args.host)
    elif args.command == "status":
        status()
    elif args.command == "stop":
        stop()
    elif args.command == "tunnel":
        tunnel()
    else:
        check()
