"""A Modal-hosted agent that plays a game running in an E2B browser — the
production shape: agent on Modal, game in an E2B sandbox, control over a clean
HTTP API (the in-sandbox daemon). The agent only ever talks HTTP to the daemon's
public URL; it never touches the sandbox's Chrome/CDP directly.

The agent is honest vision, not a state cheat: it pulls /frame (a PNG of the
canvas), locates the cyan paddle and the lowest yellow target by pixel color,
and steers the left stick toward the target via POST /pad. /state is read only
to *report* the score, never to decide.

    DAEMON=https://8765-<id>.e2b.app STEPS=260 modal run runtime/modal_play_agent.py
"""
import os

import modal

app = modal.App("e2b-play")
image = modal.Image.debian_slim().pip_install("requests", "pillow")


@app.function(image=image, timeout=420)
def play(base: str, steps: int = 260) -> dict:
    import io
    import time

    import requests
    from PIL import Image

    s = requests.Session()
    base = base.rstrip("/")

    def get_frame():
        r = s.get(base + "/frame", timeout=20)
        return Image.open(io.BytesIO(r.content)).convert("RGB")

    def set_lx(lx: float):
        s.post(base + "/pad", json={"axes": [lx, 0, 0, 0], "buttons": [0] * 17}, timeout=20)

    def get_state():
        try:
            return s.get(base + "/state", timeout=15).json()
        except Exception:
            return None

    # locate paddle (cyan ~#22d3ee) and lowest target (yellow ~#facc15) by color.
    def perceive(im):
        W, H = im.size
        px = im.load()
        step = max(1, W // 160)  # downsample columns for speed
        target_x, target_y = None, -1
        paddle_xs = []
        for y in range(0, H, step):
            for x in range(0, W, step):
                r, g, b = px[x, y][:3]
                if r > 200 and g > 150 and b < 110:        # yellow target
                    if y > target_y:
                        target_y, target_x = y, x
                elif r < 110 and g > 150 and b > 180:       # cyan paddle
                    paddle_xs.append(x)
        paddle_x = sum(paddle_xs) / len(paddle_xs) if paddle_xs else W / 2
        return W, target_x, paddle_x

    traj = []
    seen_target = 0
    for t in range(steps):
        try:
            im = get_frame()
        except Exception:
            time.sleep(0.05)
            continue
        W, target_x, paddle_x = perceive(im)
        if target_x is None:
            lx = 0.0  # nothing falling — hold center-ish
        else:
            seen_target += 1
            err = (target_x - paddle_x) / (W * 0.12)       # proportional steer
            lx = max(-1.0, min(1.0, err))
        set_lx(lx)
        if t % 20 == 0:
            st = get_state()
            sc = st.get("score") if st else None
            traj.append({"t": t, "score": sc})
        time.sleep(0.04)

    final = get_state()
    return {"final_state": final, "steps": steps, "frames_with_target": seen_target,
            "score_trajectory": traj}


@app.local_entrypoint()
def main():
    import json

    base = os.environ["DAEMON"]
    steps = int(os.environ.get("STEPS", "260"))
    print(f"agent (Modal) → daemon {base}  steps={steps}")
    print(json.dumps(play.remote(base, steps), indent=2, ensure_ascii=False))
