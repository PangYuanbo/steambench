"""Align captured frames with NitroGen commands and build effect supervision."""

from __future__ import annotations

import argparse
import bisect
import json
from pathlib import Path

from runtime.navigation.action_effect import ActionEffectTracker


def confidence(sample: dict) -> float:
    motion = sample.get("motion") or {}
    command = sample["command"]
    effect = sample["effect"]
    inliers = float(motion.get("inlier_ratio", 0))
    if effect == "blocked_candidate":
        stillness = max(0.0, 1.0 - float(motion.get("pixel_change", 1)) / 0.045)
        return round(min(1.0, command["move"] * stillness * max(0.25, inliers)), 4)
    if effect in {"movement_effective", "turn_effective"}:
        return round(min(1.0, max(command["move"], command["turn"]) * max(0.4, inliers)), 4)
    return round(min(0.5, max(command["move"], command["turn"], inliers) * 0.5), 4)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("frames", type=Path)
    parser.add_argument("actions", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-lag", type=float, default=1.2)
    args = parser.parse_args()

    actions = [json.loads(line) for line in args.actions.open(encoding="utf-8")]
    action_times = [item["time"] for item in actions]
    tracker = ActionEffectTracker()
    previous = None
    args.output.parent.mkdir(parents=True, exist_ok=True)
    review = args.output.with_name(args.output.stem + "-review.jsonl")
    with args.output.open("w", encoding="utf-8") as dataset, review.open("w", encoding="utf-8") as uncertain:
        for frame in sorted(item for item in args.frames.glob("*.jpg") if item.stem.isdigit()):
            timestamp = frame.stat().st_mtime
            index = bisect.bisect_right(action_times, timestamp) - 1
            action = actions[index] if index >= 0 and timestamp - action_times[index] <= args.max_lag else None
            effect = tracker.observe(frame.read_bytes(), action)
            sample = {
                "previous_frame": None if previous is None else str(previous),
                "frame": str(frame), "time": timestamp,
                "action_time": None if action is None else action["time"],
                "action_step": None if action is None else action.get("step"),
                **effect,
            }
            sample["confidence"] = confidence(sample)
            dataset.write(json.dumps(sample, separators=(",", ":")) + "\n")
            if sample["effect"] in {"blocked_candidate", "action_uncertain"} or sample["confidence"] < 0.35:
                uncertain.write(json.dumps(sample, separators=(",", ":")) + "\n")
            previous = frame
    print(json.dumps({"dataset": str(args.output), "review": str(review)}, indent=2))


if __name__ == "__main__":
    main()
