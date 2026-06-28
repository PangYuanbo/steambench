"""Deploy NitroGen (NVIDIA's generalist gaming foundation model) on a Modal GPU.

NitroGen takes a single RGB frame and predicts a chunk of gamepad actions
(j_left/j_right joysticks in [-1,1] + Xbox buttons). That is exactly our CUA
harness's I/O: /frame in, /pad out. The official repo's play.py is Windows-only
(it screen-captures + injects a virtual pad locally) — we DON'T use it: the game
runs on GeForce NOW's cloud Windows and our E2B daemon does the capture/inject,
so we only need NitroGen's inference server. Here we wrap InferenceSession in a
Modal GPU class (bypassing its interactive game picker) and expose predict().

    modal run runtime/modal_nitrogen.py            # build + smoke-test
    modal deploy runtime/modal_nitrogen.py         # persistent service for the glue
"""
import io
import json
import os
import time
from pathlib import Path

import modal

app = modal.App(os.environ.get("NITROGEN_APP", "nitrogen-pro6000"))

# NitroGen's 21-button output order (nitrogen/shared.py BUTTON_ACTION_TOKENS)
BUTTON_TOKENS = [
    'BACK', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'DPAD_UP', 'EAST', 'GUIDE',
    'LEFT_SHOULDER', 'LEFT_THUMB', 'LEFT_TRIGGER', 'NORTH', 'RIGHT_BOTTOM', 'RIGHT_LEFT',
    'RIGHT_RIGHT', 'RIGHT_SHOULDER', 'RIGHT_THUMB', 'RIGHT_TRIGGER', 'RIGHT_UP', 'SOUTH',
    'START', 'WEST',
]
# token -> W3C standard /pad button index (RIGHT_* right-stick dirs handled as axes)
TOK2PAD = {
    'SOUTH': 0, 'EAST': 1, 'WEST': 2, 'NORTH': 3, 'LEFT_SHOULDER': 4, 'RIGHT_SHOULDER': 5,
    'LEFT_TRIGGER': 6, 'RIGHT_TRIGGER': 7, 'BACK': 8, 'START': 9, 'LEFT_THUMB': 10,
    'RIGHT_THUMB': 11, 'DPAD_UP': 12, 'DPAD_DOWN': 13, 'DPAD_LEFT': 14, 'DPAD_RIGHT': 15, 'GUIDE': 16,
}
MENU_MASK = {"START", "BACK", "GUIDE"}
LOCK_CAMERA_PITCH = os.environ.get("LOCK_CAMERA_PITCH", "1") != "0"


def runtime_action(left, right, button_values):
    """Map one NitroGen action to W3C; optionally lock camera pitch."""
    axes = [float(left[0]), -float(left[1]), float(right[0]),
            0.0 if LOCK_CAMERA_PITCH else -float(right[1])]
    buttons = [0.0] * 17
    for index, token in enumerate(BUTTON_TOKENS):
        if index < len(button_values) and button_values[index] > 0.5 and token in TOK2PAD and token not in MENU_MASK:
            buttons[TOK2PAD[token]] = 1.0
    return axes, buttons


def append_action_log(path: str, payload: dict):
    with open(path, "a", encoding="utf-8") as log:
        log.write(json.dumps(payload, separators=(",", ":")) + "\n")
        log.flush()
        os.fsync(log.fileno())

GAMEPAD_INIT_JS = r"""
(() => {
  const mkButtons = () => Array.from({length: 17}, () => ({pressed: false, touched: false, value: 0}));
  const pad = {id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index: 0,
    connected: true, mapping: 'standard', timestamp: performance.now(),
    axes: [0, 0, 0, 0], buttons: mkButtons(), vibrationActuator: null};
  window.__gpPad = pad;
  window.__gpSetState = (axes, buttons) => {
    if (axes) for (let i = 0; i < axes.length; i++) pad.axes[i] = axes[i];
    if (buttons) for (let i = 0; i < buttons.length; i++) {
      const v = typeof buttons[i] === 'number' ? buttons[i] : (buttons[i] ? 1 : 0);
      pad.buttons[i].value = v; pad.buttons[i].pressed = v >= 0.5; pad.buttons[i].touched = v > 0;
    }
    pad.timestamp = performance.now();
  };
  window.__gpFireConnected = () => { const e = new Event('gamepadconnected'); e.gamepad = pad; window.dispatchEvent(e); };
  const getGamepads = () => [pad, null, null, null];
  try { Object.defineProperty(Navigator.prototype, 'getGamepads', {value: getGamepads, configurable: true}); }
  catch (_) { Object.defineProperty(navigator, 'getGamepads', {value: getGamepads, configurable: true}); }
})();
"""

# Persist the HF cache (SigLip2 vision encoder) across cold starts.
hf_cache = modal.Volume.from_name("nitrogen-hf-cache", create_if_missing=True)
action_logs = modal.Volume.from_name("nitrogen-action-logs", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch", "numpy", "pyzmq", "pyyaml", "einops", "transformers",
        "pydantic", "diffusers", "polars", "pillow", "opencv-python-headless",
        "av", "huggingface_hub",
    )
    # install just the nitrogen package (skip Windows-only play deps via --no-deps)
    .run_commands(
        "git clone --depth 1 https://github.com/MineDojo/NitroGen.git /opt/NitroGen",
        "cd /opt/NitroGen && pip install -e . --no-deps",
    )
    # bake the 1.97GB checkpoint into the image (cached layer)
    .run_commands(
        "python -c \"from huggingface_hub import hf_hub_download; "
        "hf_hub_download(repo_id='nvidia/NitroGen', filename='ng.pt', local_dir='/model')\""
    )
    # torchvision (AutoImageProcessor needs it) + pin transformers to a 4.x that
    # still has SiglipVisionModel.vision_model (newer transformers refactored it).
    # Appended AFTER the checkpoint layer so the 1.97GB download stays cached.
    .pip_install("torchvision", "transformers==4.53.0", "requests", "playwright")
    # safety patch: fall back to the model itself if .vision_model is absent
    .run_commands(
        "sed -i 's/self.vision_encoder = model.vision_model/"
        "self.vision_encoder = getattr(model, \"vision_model\", model)/' "
        "/opt/NitroGen/nitrogen/flow_matching_transformer/nitrogen.py"
    )
    .env({"HF_HOME": "/cache/hf"})
)


@app.cls(gpu=os.environ.get("NITROGEN_GPU", "RTX-PRO-6000"), cloud="aws", region="us-west-2", image=image,
         volumes={"/cache/hf": hf_cache, "/logs": action_logs},
         timeout=3600, scaledown_window=300)
class NitroGen:
    @modal.enter()
    def load(self):
        import sys
        sys.path.insert(0, "/opt/NitroGen")
        from nitrogen.inference_session import load_model, InferenceSession

        model, tokenizer, img_proc, ckpt_config, game_mapping, adr = load_model("/model/ng.pt")
        self.games = sorted(game_mapping.keys()) if game_mapping else []

        # pick game conditioning from env (substring match), else unconditional
        sel = None
        want = os.environ.get("NITROGEN_GAME", "").strip()
        if game_mapping and want:
            for k in game_mapping:
                if want.lower() in k.lower():
                    sel = k
                    break
        # InferenceSession(model, ckpt_path, tokenizer, img_proc, ckpt_config,
        #                  game_mapping, selected_game, old_layout, cfg_scale,
        #                  action_downsample_ratio, context_length)
        self.session = InferenceSession(
            model, "/model/ng.pt", tokenizer, img_proc, ckpt_config,
            game_mapping, sel, False, 1.0, adr, 1,
        )
        print(f"[NitroGen] loaded; selected_game={sel!r}; {len(self.games)} games available")

    @modal.method()
    def list_games(self):
        return self.games

    @modal.method()
    def gpu_name(self):
        import subprocess
        return subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], text=True
        ).strip()

    @modal.method()
    def predict(self, image_bytes: bytes) -> dict:
        import numpy as np
        from PIL import Image
        img = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
        t0 = time.time()
        out = self.session.predict(img)
        dt = (time.time() - t0) * 1000
        return {
            "j_left": np.asarray(out["j_left"]).tolist(),
            "j_right": np.asarray(out["j_right"]).tolist(),
            "buttons": np.asarray(out["buttons"]).tolist(),
            "infer_ms": round(dt, 1),
        }

    @modal.method()
    def reset(self):
        self.session.reset()
        return {"ok": True}

    @modal.method()
    def play_runtime(self, daemon_url: str, seconds: float = 30.0, exec_frames: int = 6,
                     pace_ms: int = 55, token: str = "") -> dict:
        """The glue loop, run ON the GPU container (predict is a local call =
        no inter-function hop): GET /frame from the E2B daemon -> NitroGen
        predict -> map the action chunk to /pad -> POST. Receding horizon:
        execute the first `exec_frames` of each 18-frame chunk, then re-observe."""
        import io
        import numpy as np
        import requests
        from PIL import Image

        base = daemon_url.rstrip("/")
        s = requests.Session()
        if token:
            s.headers["Authorization"] = f"Bearer {token}"
        self.session.reset()
        Path("/logs").mkdir(parents=True, exist_ok=True)
        log_path = f"/logs/runtime-{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}.jsonl"
        end = time.time() + seconds
        steps, pads, infers = 0, 0, []
        while time.time() < end:
            try:
                fr = s.get(base + "/frame", timeout=20).content
                img = np.array(Image.open(io.BytesIO(fr)).convert("RGB"))
            except Exception as e:
                print("frame err", str(e)[:60]); continue
            t0 = time.time()
            out = self.session.predict(img)
            infers.append((time.time() - t0) * 1000)
            jl = np.asarray(out["j_left"]).reshape(-1, 2)
            jr = np.asarray(out["j_right"]).reshape(-1, 2)
            bt = np.asarray(out["buttons"]).reshape(len(jl), -1)
            executed = [runtime_action(jl[i], jr[i], bt[i]) for i in range(min(exec_frames, len(jl)))]
            append_action_log(log_path, {
                "time": time.time(), "step": steps, "infer_ms": round(infers[-1], 1),
                "raw": {"j_left": jl.tolist(), "j_right": jr.tolist(), "buttons": bt.tolist()},
                "executed": [{"axes": axes, "buttons": buttons} for axes, buttons in executed],
                "right_stick_y_locked": LOCK_CAMERA_PITCH,
            })
            for axes, buttons in executed:
                try:
                    s.post(base + "/pad", json={"axes": axes, "buttons": buttons}, timeout=20)
                    pads += 1
                except Exception:
                    pass
                time.sleep(pace_ms / 1000.0)
            steps += 1
            if steps % 20 == 0:
                action_logs.commit()
        try:
            s.post(base + "/pad", json={"axes": [0, 0, 0, 0], "buttons": [0.0] * 17}, timeout=20)
        except Exception:
            pass
        med = sorted(infers)[len(infers) // 2] if infers else 0
        action_logs.commit()
        return {"steps": steps, "pad_frames": pads, "median_infer_ms": round(med, 1), "action_log": log_path}

    @modal.method()
    def play_browserbase(self, api_key: str, session_id: str, seconds: float = 30.0,
                         exec_frames: int = 6, pace_ms: int = 55) -> dict:
        import json
        import numpy as np
        import requests
        from PIL import Image
        from playwright.sync_api import sync_playwright

        session = requests.get(
            f"https://api.browserbase.com/v1/sessions/{session_id}",
            headers={"X-BB-API-Key": api_key}, timeout=20,
        ).json()
        connect_url = session.get("connectUrl")
        if not connect_url:
            raise RuntimeError(f"Browserbase session is not connectable: {session}")

        self.session.reset()
        Path("/logs").mkdir(parents=True, exist_ok=True)
        log_path = f"/logs/browserbase-{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}.jsonl"
        infers, frame_waits, pads = [], [], 0
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(connect_url)
            context = browser.contexts[0]
            context.add_init_script(GAMEPAD_INIT_JS)
            pages = [page for page in context.pages if "play.geforcenow.com" in page.url]
            page = pages[-1] if pages else context.pages[-1]
            page.evaluate(GAMEPAD_INIT_JS)
            page.evaluate("window.__gpFireConnected()")
            cdp = context.new_cdp_session(page)
            frames = []

            def on_frame(event):
                frames.append(event["data"])
                cdp.send("Page.screencastFrameAck", {"sessionId": event["sessionId"]})

            cdp.on("Page.screencastFrame", on_frame)
            cdp.send("Page.startScreencast", {
                "format": "jpeg", "quality": 40, "maxWidth": 1280,
                "maxHeight": 720, "everyNthFrame": 1,
            })
            end = time.time() + seconds
            try:
                while time.time() < end:
                    wait_start = time.time()
                    while not frames and time.time() < end:
                        page.wait_for_timeout(5)
                    if not frames:
                        break
                    frame_waits.append((time.time() - wait_start) * 1000)
                    frame = frames.pop()
                    frames.clear()
                    image_bytes = __import__("base64").b64decode(frame)
                    image = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
                    infer_start = time.time()
                    out = self.session.predict(image)
                    infers.append((time.time() - infer_start) * 1000)
                    left = np.asarray(out["j_left"]).reshape(-1, 2)
                    right = np.asarray(out["j_right"]).reshape(-1, 2)
                    button_chunk = np.asarray(out["buttons"]).reshape(len(left), -1)
                    executed = [runtime_action(left[index], right[index], button_chunk[index])
                                for index in range(min(exec_frames, len(left)))]
                    append_action_log(log_path, {
                        "time": time.time(), "step": len(infers) - 1, "infer_ms": round(infers[-1], 1),
                        "raw": {"j_left": left.tolist(), "j_right": right.tolist(), "buttons": button_chunk.tolist()},
                        "executed": [{"axes": axes, "buttons": buttons} for axes, buttons in executed],
                        "right_stick_y_locked": LOCK_CAMERA_PITCH,
                    })
                    for axes, buttons in executed:
                        page.evaluate("([a,b]) => window.__gpSetState(a,b)", [axes, buttons])
                        pads += 1
                        page.wait_for_timeout(pace_ms)
                    if len(infers) % 20 == 0:
                        action_logs.commit()
            finally:
                page.evaluate("window.__gpSetState([0,0,0,0], Array(17).fill(0))")
                cdp.send("Page.stopScreencast")
                browser.close()
                action_logs.commit()

        median = lambda values: sorted(values)[len(values) // 2] if values else 0
        return {"pad_frames": pads, "inferences": len(infers),
                "median_infer_ms": round(median(infers), 1),
                "median_frame_wait_ms": round(median(frame_waits), 1), "action_log": log_path}

    @modal.method()
    def smoke_test(self) -> dict:
        """Run a few predicts on a dummy frame (all remote, on the GPU) and
        report shapes + inference latency."""
        import numpy as np
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (1280, 720), (40, 80, 120)).save(buf, format="PNG")
        frame = buf.getvalue()
        runs = []
        for _ in range(3):
            out = self.predict.local(frame)
            runs.append(out["infer_ms"])
        jl = np.array(out["j_left"]); btn = np.array(out["buttons"])
        return {"infer_ms_runs": runs, "j_left_shape": list(jl.shape),
                "buttons_shape": list(btn.shape), "chunk_len": len(out["buttons"]),
                "j_left0": out["j_left"][0] if out["j_left"] else None,
                "buttons0": out["buttons"][0] if out["buttons"] else None}


@app.local_entrypoint()
def main():
    ng = NitroGen()
    browserbase_session = os.environ.get("BROWSERBASE_SESSION_ID", "").strip()
    if browserbase_session:
        api_key = os.environ["BROWSERBASE_API_KEY"]
        secs = float(os.environ.get("PLAY_SECONDS", "30"))
        ef = int(os.environ.get("EXEC_FRAMES", "6"))
        pace = int(os.environ.get("PACE_MS", "55"))
        print(f"NitroGen playing Browserbase session {browserbase_session} for {secs}s...")
        print(ng.play_browserbase.remote(api_key, browserbase_session, secs, ef, pace))
        return
    daemon = os.environ.get("PLAY_DAEMON", "").strip()
    if daemon:
        secs = float(os.environ.get("PLAY_SECONDS", "30"))
        ef = int(os.environ.get("EXEC_FRAMES", "6"))
        token = os.environ.get("RUNTIME_BROWSER_TOKEN", "")
        print(f"NitroGen playing via {daemon} for {secs}s (exec_frames={ef})...")
        t = time.time()
        r = ng.play_runtime.remote(daemon, secs, ef, 55, token)
        print(f"done in {time.time()-t:.0f}s: {r}")
        return
    games = ng.list_games.remote()
    print(f"\n=== NitroGen up. {len(games)} games in mapping ===")
    print("sample games:", games[:30])
    t = time.time()
    r = ng.smoke_test.remote()
    print(f"\nsmoke_test (incl cold start) round-trip {(time.time()-t)*1000:.0f}ms")
    print("inference latency runs (ms):", r["infer_ms_runs"])
    print("action chunk:", r["chunk_len"], "frames | j_left shape", r["j_left_shape"], "| buttons shape", r["buttons_shape"])
    print("sample j_left[0]:", r["j_left0"])
    print("sample buttons[0]:", r["buttons0"])
