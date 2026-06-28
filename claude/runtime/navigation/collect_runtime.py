"""Collect a live Runtime Browser into a visual topology map."""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
from pathlib import Path

from runtime.navigation.action_effect import ActionEffectTracker
from runtime.navigation.visual_topology import VisualTopology


def latest_jsonl(path: Path, timestamp: float) -> dict | None:
    if not path.exists():
        return None
    latest = None
    with path.open(encoding="utf-8") as source:
        for line in source:
            item = json.loads(line)
            if item.get("time", 0) <= timestamp:
                latest = item
            else:
                break
    return latest


def get(url: str, token: str) -> bytes:
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    return urllib.request.urlopen(request, timeout=20).read()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", type=Path, default=Path(".runtime-browser-cropped.json"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seconds", type=float, default=300)
    parser.add_argument("--sample-seconds", type=float, default=1)
    parser.add_argument("--actions", type=Path)
    args = parser.parse_args()

    state = json.loads(args.state.read_text())
    topology = VisualTopology(args.output)
    effects = ActionEffectTracker()
    deadline = time.time() + args.seconds
    while time.time() < deadline:
        started = time.time()
        frame = get(state["api_url"] + "/frame", state["api_token"])
        action_record = latest_jsonl(args.actions, started) if args.actions else None
        action = None if action_record is None else {
                "inference_time": action_record.get("time"),
                "executed": action_record.get("executed", []),
            }
        effect = effects.observe(frame, action)
        result = topology.observe(frame, timestamp=started, action=action, label={"action_effect": effect})
        print(json.dumps(result), flush=True)
        time.sleep(max(0, args.sample_seconds - (time.time() - started)))
    topology.export_hindsight(args.output / "hindsight.jsonl")


if __name__ == "__main__":
    main()
