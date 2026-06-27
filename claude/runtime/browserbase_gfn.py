#!/usr/bin/env python3
"""Canonical Browserbase + NitroGen runtime for GeForce NOW.

The Browserbase Context survives session shutdown and retains cookies and
browser storage. Sessions are disposable and read-only by default: ``start``
reads the saved Context without writing browser changes back. Use ``--persist``
only for an intentional login refresh.

    BROWSERBASE_API_KEY=... BROWSERBASE_PROJECT_ID=... \
        python runtime/browserbase_gfn.py init --context-id <existing-context>
    BROWSERBASE_API_KEY=... python runtime/browserbase_gfn.py start
    python runtime/browserbase_gfn.py agent-start --seconds 1800
    python runtime/browserbase_gfn.py agent-status
    python runtime/browserbase_gfn.py agent-stop
    BROWSERBASE_API_KEY=... python runtime/browserbase_gfn.py status
    BROWSERBASE_API_KEY=... python runtime/browserbase_gfn.py stop

Playwright is only required by ``start`` to install the virtual gamepad and
open GeForce NOW. API credentials are read from the environment and never
written to disk.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

from gfn_browser import GAMEPAD_INIT_JS


ROOT = Path(__file__).resolve().parents[1]
STATE_PATH = ROOT / ".browserbase-gfn.json"
CONTEXTS_PATH = ROOT / ".browserbase-contexts.json"
AGENT_STATE_PATH = ROOT / ".nitrogen-play.json"
API_BASE = "https://api.browserbase.com/v1"


def api(path: str, method: str = "GET", body: Optional[dict] = None) -> dict:
    key = os.environ.get("BROWSERBASE_API_KEY")
    if not key:
        raise SystemExit("BROWSERBASE_API_KEY is required")
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        API_BASE + path,
        data=data,
        method=method,
        headers={"X-BB-API-Key": key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = response.read()
            return json.loads(payload) if payload else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise SystemExit(f"Browserbase API {error.code}: {detail}") from error


def load_state() -> dict:
    if not STATE_PATH.exists():
        raise SystemExit(f"No runtime state. Run: python {Path(__file__).name} init")
    return json.loads(STATE_PATH.read_text())


def save_state(state: dict) -> None:
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n")
    STATE_PATH.chmod(0o600)


def use(label: str, context_id: str) -> None:
    contexts = json.loads(CONTEXTS_PATH.read_text()) if CONTEXTS_PATH.exists() else {}
    contexts[label] = context_id
    CONTEXTS_PATH.write_text(json.dumps(contexts, indent=2) + "\n")
    CONTEXTS_PATH.chmod(0o600)
    save_state({"context_id": context_id, "session_id": None, "persist": False, "label": label})
    print(json.dumps({"label": label, "context_id": context_id}, indent=2))


def init(context_id: Optional[str]) -> None:
    project_id = os.environ.get("BROWSERBASE_PROJECT_ID")
    if context_id:
        context = api(f"/contexts/{context_id}")
    else:
        context = api("/contexts", "POST", {"projectId": project_id} if project_id else {})
    state = {"context_id": context["id"], "session_id": None}
    save_state(state)
    print(json.dumps(state, indent=2))


def session_body(context_id: str, timeout: int, persist: bool, project_id: Optional[str], label: Optional[str] = None) -> dict:
    body = {
        "keepAlive": True,
        "timeout": timeout,
        "browserSettings": {
            "context": {"id": context_id, "persist": persist},
            "viewport": {"width": 1280, "height": 720},
        },
        "userMetadata": {
            "runtime": "steambench-gfn",
            "contextMode": "write" if persist else "read-only",
            **({"account": re.sub(r"[^a-zA-Z0-9_-]+", "-", label).strip("-")} if label else {}),
        },
    }
    if project_id:
        body["projectId"] = project_id
    return body


def start(timeout: int, persist: bool) -> None:
    state = load_state()
    project_id = os.environ.get("BROWSERBASE_PROJECT_ID")
    current_id = state.get("session_id")
    if current_id and api(f"/sessions/{current_id}").get("status") == "RUNNING":
        raise SystemExit(f"Session {current_id} is already RUNNING; stop it first")
    session = api("/sessions", "POST", session_body(
        state["context_id"], timeout, persist, project_id, state.get("label")
    ))

    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        api(f"/sessions/{session['id']}", "POST", {"status": "REQUEST_RELEASE"})
        raise SystemExit("start requires Playwright: pip install playwright") from error

    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(session["connectUrl"])
        context = browser.contexts[0]
        context.add_init_script(GAMEPAD_INIT_JS)
        page = context.pages[0] if context.pages else context.new_page()
        page.goto("https://play.geforcenow.com/", wait_until="domcontentloaded", timeout=120_000)
        page.evaluate(GAMEPAD_INIT_JS)
        page.evaluate("window.__gpFireConnected && window.__gpFireConnected()")
        browser.close()

    state.update({"session_id": session["id"], "persist": persist})
    save_state(state)
    debug = api(f"/sessions/{session['id']}/debug")
    print(json.dumps({
        "context_id": state["context_id"],
        "session_id": session["id"],
        "persist": persist,
        "live_view_url": debug.get("debuggerFullscreenUrl") or debug.get("debuggerUrl"),
    }, indent=2))


def status() -> None:
    state = load_state()
    session_id = state.get("session_id")
    session = api(f"/sessions/{session_id}") if session_id else None
    output = {
        "context_id": state["context_id"],
        "persist": state.get("persist", False),
        "session": ({
            key: session.get(key)
            for key in ("id", "status", "keepAlive", "region", "startedAt", "expiresAt", "contextId")
        } if session else None),
    }
    if session and session.get("status") == "RUNNING":
        debug = api(f"/sessions/{session_id}/debug")
        output["live_view_url"] = debug.get("debuggerFullscreenUrl") or debug.get("debuggerUrl")
    print(json.dumps(output, indent=2))


def adopt(session_id: str) -> None:
    state = load_state()
    session = api(f"/sessions/{session_id}")
    if session.get("status") != "RUNNING":
        raise SystemExit(f"Session {session_id} is {session.get('status')}, not RUNNING")
    if session.get("contextId") != state["context_id"]:
        raise SystemExit("Session does not use the saved Browserbase Context")
    state["session_id"] = session_id
    save_state(state)
    status()


def stop() -> None:
    state = load_state()
    session_id = state.get("session_id")
    if session_id:
        session = api(f"/sessions/{session_id}")
        if session.get("status") == "RUNNING":
            api(f"/sessions/{session_id}", "POST", {"status": "REQUEST_RELEASE"})
    state["session_id"] = None
    save_state(state)
    print(json.dumps({"context_id": state["context_id"], "stopped": session_id}, indent=2))


def agent_start(seconds: int, exec_frames: int, pace_ms: int) -> None:
    if not 1 <= seconds <= 3500:
        raise SystemExit("--seconds must be between 1 and 3500")
    state = load_state()
    session_id = state.get("session_id")
    if not session_id or api(f"/sessions/{session_id}").get("status") != "RUNNING":
        raise SystemExit("Start a RUNNING Browserbase session first")
    try:
        import modal
    except ImportError as error:
        raise SystemExit("agent-start requires the Modal Python package") from error
    key = os.environ.get("BROWSERBASE_API_KEY")
    if not key:
        raise SystemExit("BROWSERBASE_API_KEY is required")
    call = modal.Cls.from_name("nitrogen", "NitroGen")().play_browserbase.spawn(
        key, session_id, float(seconds), exec_frames, pace_ms,
    )
    agent_state = {"function_call_id": call.object_id, "session_id": session_id, "seconds": seconds}
    AGENT_STATE_PATH.write_text(json.dumps(agent_state, indent=2) + "\n")
    AGENT_STATE_PATH.chmod(0o600)
    print(json.dumps(agent_state, indent=2))


def agent_status() -> None:
    if not AGENT_STATE_PATH.exists():
        raise SystemExit("No agent state; run agent-start")
    import modal
    state = json.loads(AGENT_STATE_PATH.read_text())
    call = modal.functions.FunctionCall.from_id(state["function_call_id"])
    try:
        result = call.get(timeout=0)
        print(json.dumps({**state, "status": "COMPLETED", "result": result}, indent=2))
    except TimeoutError:
        print(json.dumps({**state, "status": "RUNNING"}, indent=2))


def agent_stop() -> None:
    if not AGENT_STATE_PATH.exists():
        print(json.dumps({"stopped": None}, indent=2))
        return
    import modal
    state = json.loads(AGENT_STATE_PATH.read_text())
    modal.functions.FunctionCall.from_id(state["function_call_id"]).cancel()
    AGENT_STATE_PATH.unlink()
    print(json.dumps({"stopped": state["function_call_id"]}, indent=2))


def self_test() -> None:
    body = session_body("ctx", 3600, False, None)
    assert body["browserSettings"]["context"] == {"id": "ctx", "persist": False}
    assert session_body("ctx", 3600, True, "project")["projectId"] == "project"
    assert session_body("ctx", 3600, False, None, "free account")["userMetadata"]["account"] == "free-account"
    print("ok")


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    init_parser = commands.add_parser("init")
    init_parser.add_argument("--context-id")
    start_parser = commands.add_parser("start")
    start_parser.add_argument("--timeout", type=int, default=3600)
    start_parser.add_argument("--persist", action="store_true", help="write session changes back to the Context")
    adopt_parser = commands.add_parser("adopt")
    adopt_parser.add_argument("session_id")
    commands.add_parser("status")
    commands.add_parser("stop")
    use_parser = commands.add_parser("use")
    use_parser.add_argument("label")
    use_parser.add_argument("context_id")
    agent_parser = commands.add_parser("agent-start")
    agent_parser.add_argument("--seconds", type=int, default=1800)
    agent_parser.add_argument("--exec-frames", type=int, default=4)
    agent_parser.add_argument("--pace-ms", type=int, default=55)
    commands.add_parser("agent-status")
    commands.add_parser("agent-stop")
    commands.add_parser("self-test")
    args = parser.parse_args()

    if args.command == "init":
        init(args.context_id)
    elif args.command == "start":
        start(args.timeout, args.persist)
    elif args.command == "adopt":
        adopt(args.session_id)
    elif args.command == "status":
        status()
    elif args.command == "stop":
        stop()
    elif args.command == "use":
        use(args.label, args.context_id)
    elif args.command == "agent-start":
        agent_start(args.seconds, args.exec_frames, args.pace_ms)
    elif args.command == "agent-status":
        agent_status()
    elif args.command == "agent-stop":
        agent_stop()
    else:
        self_test()


if __name__ == "__main__":
    main()
