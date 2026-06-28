import io

import cv2
import numpy as np
from PIL import Image

from runtime.navigation.action_effect import ActionEffectTracker


def encode(image):
    output = io.BytesIO()
    Image.fromarray(image).save(output, "JPEG", quality=95)
    return output.getvalue()


def action(forward=0, turn=0):
    return {"executed": [{"axes": [0, forward, turn, 0], "buttons": [0] * 17}] * 6}


def test_labels_blocked_and_visible_effect():
    rng = np.random.default_rng(7)
    first = rng.integers(0, 255, (720, 1280, 3), dtype=np.uint8)
    shifted = cv2.warpAffine(first, np.float32([[1, 0, 30], [0, 1, 0]]), (1280, 720))
    tracker = ActionEffectTracker()
    tracker.observe(encode(first), action(forward=1))
    blocked = tracker.observe(encode(first), action(forward=1))
    assert blocked["effect"] == "blocked_candidate"
    moved = tracker.observe(encode(shifted), action(forward=1))
    assert moved["effect"] == "movement_effective"
