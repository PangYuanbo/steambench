from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


TARGET_VIDEO_NAME = os.environ.get("TARGET_VIDEO_NAME", "output.mp4")


@dataclass(frozen=True)
class TaskStartResult:
    appid: int
    achievement: str
    output_dir: str
    target_video_name: str
    target_video_path: str


def start(session=None, output_dir: str = "output") -> TaskStartResult:
    """Prepare the smallest required output location for Stage 2 evaluation."""
    del session
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    return TaskStartResult(
        appid=620,
        achievement="ACH.PORTAL_CONSERVATION",
        output_dir=str(output_path),
        target_video_name=TARGET_VIDEO_NAME,
        target_video_path=str(output_path / TARGET_VIDEO_NAME),
    )


def evaluate(output_dir: str = "output") -> dict:
    target = Path(output_dir) / TARGET_VIDEO_NAME
    if not target.exists():
        return {
            "passed": False,
            "score": 0,
            "reason": f"Missing canonical capture artifact: {target}",
            "targetVideoName": TARGET_VIDEO_NAME,
        }

    size_bytes = target.stat().st_size
    if size_bytes <= 0:
        return {
            "passed": False,
            "score": 0,
            "reason": f"Capture artifact is empty: {target}",
            "targetVideoName": TARGET_VIDEO_NAME,
        }

    return {
        "passed": True,
        "score": 1,
        "reason": "Canonical capture artifact exists and is non-empty.",
        "targetVideoName": TARGET_VIDEO_NAME,
        "sizeBytes": size_bytes,
    }
