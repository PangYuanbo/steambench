"""Pseudo-label whether a controller command visibly affected the game."""

from __future__ import annotations

import io
import math
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image


@dataclass
class Command:
    move: float
    turn: float
    lx: float
    ly: float
    rx: float
    ry: float
    buttons: int


def summarize_command(action: dict | None) -> Command:
    executed = (action or {}).get("executed", [])
    if not executed:
        return Command(0, 0, 0, 0, 0, 0, 0)
    axes = np.asarray([item.get("axes", [0, 0, 0, 0]) for item in executed], dtype=np.float32)
    mean = axes.mean(axis=0)
    buttons = sum(any(float(value) >= 0.5 for value in item.get("buttons", [])) for item in executed)
    return Command(
        move=float(np.linalg.norm(mean[:2])), turn=float(np.linalg.norm(mean[2:])),
        lx=float(mean[0]), ly=float(mean[1]), rx=float(mean[2]), ry=float(mean[3]),
        buttons=buttons,
    )


def decode(jpeg: bytes) -> np.ndarray:
    return np.array(Image.open(io.BytesIO(jpeg)).convert("RGB"))


def visual_motion(previous: np.ndarray, current: np.ndarray) -> dict:
    height, width = previous.shape[:2]
    crop_height = int(height * 0.72)  # ignore player body and most HUD
    first = cv2.cvtColor(previous[:crop_height], cv2.COLOR_RGB2GRAY)
    second = cv2.cvtColor(current[:crop_height], cv2.COLOR_RGB2GRAY)
    first = cv2.resize(first, (320, 180), interpolation=cv2.INTER_AREA)
    second = cv2.resize(second, (320, 180), interpolation=cv2.INTER_AREA)

    orb = cv2.ORB_create(nfeatures=900)
    first_keys, first_desc = orb.detectAndCompute(first, None)
    second_keys, second_desc = orb.detectAndCompute(second, None)
    if first_desc is None or second_desc is None:
        return {"matches": 0, "inlier_ratio": 0.0, "translation": 0.0, "rotation_deg": 0.0, "pixel_change": 0.0}
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(first_desc, second_desc, k=2)
    good = [left for left, right in pairs if left.distance < 0.72 * right.distance]
    pixel_change = float(np.mean(cv2.absdiff(first, second)) / 255.0)
    if len(good) < 10:
        return {"matches": len(good), "inlier_ratio": 0.0, "translation": 0.0,
                "rotation_deg": 0.0, "pixel_change": pixel_change}
    source = np.float32([first_keys[item.queryIdx].pt for item in good])
    target = np.float32([second_keys[item.trainIdx].pt for item in good])
    matrix, mask = cv2.estimateAffinePartial2D(source, target, method=cv2.RANSAC, ransacReprojThreshold=3.0)
    if matrix is None or mask is None:
        return {"matches": len(good), "inlier_ratio": 0.0, "translation": 0.0,
                "rotation_deg": 0.0, "pixel_change": pixel_change}
    translation = math.hypot(float(matrix[0, 2]), float(matrix[1, 2])) / math.hypot(320, 180)
    rotation = math.degrees(math.atan2(float(matrix[1, 0]), float(matrix[0, 0])))
    return {
        "matches": len(good), "inlier_ratio": float(mask.mean()),
        "translation": translation, "rotation_deg": rotation, "pixel_change": pixel_change,
    }


def classify_effect(command: Command, motion: dict) -> str:
    visual_effect = motion["translation"] >= 0.008 or abs(motion["rotation_deg"]) >= 1.0 or motion["pixel_change"] >= 0.045
    if command.move < 0.15 and command.turn < 0.15 and command.buttons == 0:
        return "external_motion" if visual_effect else "idle"
    if command.turn >= 0.25 and abs(motion["rotation_deg"]) >= 1.0:
        return "turn_effective"
    if command.move >= 0.35 and not visual_effect:
        return "blocked_candidate"
    if command.move >= 0.35 and visual_effect:
        return "movement_effective"
    return "action_effective" if visual_effect else "action_uncertain"


class ActionEffectTracker:
    def __init__(self):
        self.previous: np.ndarray | None = None

    def observe(self, jpeg: bytes, action: dict | None) -> dict:
        current = decode(jpeg)
        command = summarize_command(action)
        if self.previous is None:
            self.previous = current
            return {"effect": "initial", "command": command.__dict__, "motion": None}
        motion = visual_motion(self.previous, current)
        self.previous = current
        return {"effect": classify_effect(command, motion), "command": command.__dict__, "motion": motion}
