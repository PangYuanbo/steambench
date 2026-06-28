"""Run NitroGen locally against a Windows game using DXGI capture + ViGEm."""

from __future__ import annotations

import argparse
import contextlib
import ctypes
import io
import sys
import time
from pathlib import Path


BUTTON_TOKENS = [
    "BACK", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT", "DPAD_UP", "EAST", "GUIDE",
    "LEFT_SHOULDER", "LEFT_THUMB", "LEFT_TRIGGER", "NORTH", "RIGHT_BOTTOM", "RIGHT_LEFT",
    "RIGHT_RIGHT", "RIGHT_SHOULDER", "RIGHT_THUMB", "RIGHT_TRIGGER", "RIGHT_UP", "SOUTH",
    "START", "WEST",
]

XUSB_BUTTONS = {
    "BACK": "XUSB_GAMEPAD_BACK",
    "DPAD_DOWN": "XUSB_GAMEPAD_DPAD_DOWN",
    "DPAD_LEFT": "XUSB_GAMEPAD_DPAD_LEFT",
    "DPAD_RIGHT": "XUSB_GAMEPAD_DPAD_RIGHT",
    "DPAD_UP": "XUSB_GAMEPAD_DPAD_UP",
    "EAST": "XUSB_GAMEPAD_B",
    "GUIDE": "XUSB_GAMEPAD_GUIDE",
    "LEFT_SHOULDER": "XUSB_GAMEPAD_LEFT_SHOULDER",
    "LEFT_THUMB": "XUSB_GAMEPAD_LEFT_THUMB",
    "NORTH": "XUSB_GAMEPAD_Y",
    "RIGHT_SHOULDER": "XUSB_GAMEPAD_RIGHT_SHOULDER",
    "RIGHT_THUMB": "XUSB_GAMEPAD_RIGHT_THUMB",
    "SOUTH": "XUSB_GAMEPAD_A",
    "START": "XUSB_GAMEPAD_START",
    "WEST": "XUSB_GAMEPAD_X",
}

VK_END = 0x23
VK_F8 = 0x77


def pressed_once(key: int, state: dict[int, bool]) -> bool:
    down = bool(ctypes.windll.user32.GetAsyncKeyState(key) & 0x8000)
    fired = down and not state.get(key, False)
    state[key] = down
    return fired


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, float(value)))


def apply_action(pad, vg, left, right, button_values, allow_menu: bool) -> None:
    pad.reset()
    for name, value in zip(BUTTON_TOKENS, button_values):
        if name in {"LEFT_TRIGGER", "RIGHT_TRIGGER", "RIGHT_BOTTOM", "RIGHT_LEFT", "RIGHT_RIGHT", "RIGHT_UP"}:
            continue
        if not allow_menu and name in {"BACK", "GUIDE", "START"}:
            continue
        mapped = XUSB_BUTTONS.get(name)
        if mapped and float(value) >= 0.5:
            pad.press_button(button=getattr(vg.XUSB_BUTTON, mapped))

    pad.left_joystick_float(
        x_value_float=clamp(left[0], -1, 1),
        y_value_float=clamp(-left[1], -1, 1),
    )
    pad.right_joystick_float(
        x_value_float=clamp(right[0], -1, 1),
        y_value_float=clamp(-right[1], -1, 1),
    )
    pad.left_trigger_float(value_float=clamp(button_values[BUTTON_TOKENS.index("LEFT_TRIGGER")], 0, 1))
    pad.right_trigger_float(value_float=clamp(button_values[BUTTON_TOKENS.index("RIGHT_TRIGGER")], 0, 1))
    pad.update()


def _self_check() -> None:
    class Buttons:
        XUSB_GAMEPAD_A = "A"
        XUSB_GAMEPAD_START = "START"

    class VG:
        XUSB_BUTTON = Buttons

    class Pad:
        def __init__(self):
            self.pressed = []

        def reset(self): pass
        def press_button(self, button): self.pressed.append(button)
        def left_joystick_float(self, **values): self.left = values
        def right_joystick_float(self, **values): self.right = values
        def left_trigger_float(self, **values): self.left_trigger = values
        def right_trigger_float(self, **values): self.right_trigger = values
        def update(self): pass

    values = [0.0] * len(BUTTON_TOKENS)
    values[BUTTON_TOKENS.index("SOUTH")] = 1.0
    values[BUTTON_TOKENS.index("START")] = 1.0
    pad = Pad()
    apply_action(pad, VG, [2, 0.25], [-2, -0.5], values, False)
    assert pad.pressed == ["A"]
    assert pad.left == {"x_value_float": 1, "y_value_float": -0.25}
    assert pad.right == {"x_value_float": -1, "y_value_float": 0.5}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, default=Path("models/ng.pt"))
    parser.add_argument("--nitrogen-dir", type=Path, default=Path("external/NitroGen"))
    parser.add_argument("--monitor", type=int, default=0, help="DXGI output index")
    parser.add_argument("--region", type=int, nargs=4, metavar=("LEFT", "TOP", "RIGHT", "BOTTOM"))
    parser.add_argument("--capture-fps", type=int, default=60)
    parser.add_argument("--action-fps", type=float, default=60)
    parser.add_argument("--execute-frames", type=int, default=6, help="Actions used from each predicted 18-frame chunk")
    parser.add_argument("--allow-menu", action="store_true")
    parser.add_argument("--countdown", type=int, default=5)
    parser.add_argument("--dry-run", action="store_true", help="Run inference without creating a virtual controller")
    parser.add_argument("--self-check", action="store_true", help=argparse.SUPPRESS)
    return parser.parse_args()


def main() -> int:
    if "--self-check" in sys.argv:
        _self_check()
        print("self-check passed")
        return 0
    if sys.platform != "win32":
        raise SystemExit("This runner requires Windows.")
    args = parse_args()
    if not args.checkpoint.is_file():
        raise SystemExit(f"Checkpoint not found: {args.checkpoint}")
    if not args.nitrogen_dir.is_dir():
        raise SystemExit(f"NitroGen checkout not found: {args.nitrogen_dir}")

    sys.path.insert(0, str(args.nitrogen_dir.resolve()))
    import dxcam
    import numpy as np
    import torch
    from nitrogen.inference_session import InferenceSession, load_model

    if not torch.cuda.is_available():
        raise SystemExit("CUDA is unavailable. Install the CUDA PyTorch build and NVIDIA driver.")
    print(f"GPU: {torch.cuda.get_device_name(0)}")

    model, tokenizer, image_processor, config, game_mapping, ratio = load_model(str(args.checkpoint.resolve()))
    session = InferenceSession(
        model, str(args.checkpoint.resolve()), tokenizer, image_processor, config,
        game_mapping, None, False, 1.0, ratio, 1,
    )

    camera = dxcam.create(output_idx=args.monitor, output_color="RGB")
    region = tuple(args.region) if args.region else None
    camera.start(region=region, target_fps=args.capture_fps, video_mode=True)

    vg = pad = None
    if not args.dry_run:
        import vgamepad as vg
        pad = vg.VX360Gamepad()
        pad.reset(); pad.update()

    print("F8 = pause/resume controller | End = quit | Ctrl+C = quit")
    for remaining in range(args.countdown, 0, -1):
        print(f"Starting in {remaining}...")
        time.sleep(1)

    keys: dict[int, bool] = {}
    paused = False
    steps = 0
    inference_ms: list[float] = []
    frame_period = 1.0 / args.action_fps
    try:
        while True:
            if pressed_once(VK_END, keys):
                break
            if pressed_once(VK_F8, keys):
                paused = not paused
                if pad:
                    pad.reset(); pad.update()
                print("PAUSED" if paused else "RESUMED")
            if paused:
                time.sleep(0.03)
                continue

            frame = camera.get_latest_frame()
            if frame is None:
                time.sleep(0.01)
                continue

            started = time.perf_counter()
            with contextlib.redirect_stdout(io.StringIO()):
                prediction = session.predict(np.ascontiguousarray(frame))
            inference_ms.append((time.perf_counter() - started) * 1000)
            count = min(args.execute_frames, len(prediction["buttons"]))
            for index in range(count):
                deadline = time.perf_counter() + frame_period
                if pad:
                    apply_action(
                        pad, vg, prediction["j_left"][index], prediction["j_right"][index],
                        prediction["buttons"][index], args.allow_menu,
                    )
                if pressed_once(VK_END, keys):
                    return 0
                while time.perf_counter() < deadline:
                    time.sleep(0.001)
            steps += 1
            if steps % 20 == 0:
                recent = inference_ms[-20:]
                print(f"steps={steps} inference_avg={sum(recent) / len(recent):.1f}ms")
    finally:
        camera.stop()
        if pad:
            pad.reset(); pad.update()
        print("Controller released.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
