#!/usr/bin/env python3
"""Dual-rate frame buffers — the agent's research链路 runtime.

Open any game's environment ready-to-run, then expose two independent,
thread-safe frame feeds the agent reads from:

* **video buffer @ ~120 Hz** — a rolling window of recent *raw* frames (numpy),
  for motion / temporal perception. This is the "video stream" buffer.
* **screenshot buffer @ ~60 Hz** — a separate rolling window of PNG-encoded
  stills, for discrete vision / LLM frames.

The game runs in its own producer thread at the video rate; the agent reads the
buffers and sets the next action asynchronously, so the **game frame rate is
decoupled from the agent's decision rate** (a 30 Hz agent can watch a 120 Hz
game). The env auto-resets on game-over so frames never stop flowing.

    # open Dodger ready-to-run, watch the buffers fill, report achieved rates:
    PYTHONPATH=harness:. ./engine/.venv/bin/python runtime/frame_buffer.py --game dodger --secs 3

    # let the game's CV agent drive it through the buffer for a few seconds:
    PYTHONPATH=harness:. ./engine/.venv/bin/python runtime/frame_buffer.py --game storm --secs 4 --drive
"""

from __future__ import annotations

import argparse
import io
import sys
import threading
import time
from collections import deque
from pathlib import Path
from typing import Callable, Optional

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
for p in (ROOT, ROOT / "runtime"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

import pixel_game as pg  # noqa: E402  (the rendered games + their CV agents)


# game id -> (GameClass, CVAgentClass, default no-op action). Each game renders
# a 168x120 RGB frame and steps on a string action — a ready FrameSource.
GAMES: dict[str, tuple[type, type, str]] = {
    "dodger": (pg.PixelDodger, pg.CVAgent, "stay"),
    "catcher": (pg.CatcherGame, pg.CatcherCVAgent, "stay"),
    "volley": (pg.VolleyGame, pg.VolleyCVAgent, "stay"),
    "storm": (pg.StormGame, pg.StormCVAgent, "stay"),
    "turret": (pg.TurretGame, pg.TurretCVAgent, "stay"),
    "forager": (pg.ForagerGame, pg.ForagerCVAgent, "stay"),
    "phantom": (pg.PhantomGame, pg.PhantomCVAgent, "stay"),
    "rally": (pg.RallyGame, pg.RallyCVAgent, "stay"),
}


class _Ring:
    """A tiny thread-safe ring buffer of (timestamp, item)."""

    def __init__(self, maxlen: int) -> None:
        self._dq: deque = deque(maxlen=maxlen)
        self._lock = threading.Lock()
        self.pushed = 0

    def push(self, t: float, item) -> None:
        with self._lock:
            self._dq.append((t, item))
            self.pushed += 1

    def latest(self):
        with self._lock:
            return self._dq[-1] if self._dq else None

    def window(self, n: Optional[int] = None) -> list:
        with self._lock:
            items = list(self._dq)
        return items if n is None else items[-n:]

    def __len__(self) -> int:
        with self._lock:
            return len(self._dq)


class GameSource:
    """Adapter over a pixel game: holds the game + a CV agent, applies the latest
    action, steps, and exposes the rendered frame. Auto-resets on game-over."""

    def __init__(self, game_id: str, seed: int = 1) -> None:
        if game_id not in GAMES:
            raise KeyError(f"unknown game {game_id!r}; have {sorted(GAMES)}")
        self.game_id = game_id
        self._cls, self._agent_cls, self.noop = GAMES[game_id]
        self._seed = seed
        self.game = self._cls(seed)
        self.episodes = 0
        self.best_score = 0

    def make_agent(self):
        a = self._agent_cls()
        if hasattr(a, "reset"):
            a.reset()
        return a

    def tick(self, action: str) -> np.ndarray:
        frame = self.game.step(action)
        if frame is None:                       # some steps return None; re-render
            frame = self.game.render_array()
        if getattr(self.game, "done", False):
            self.best_score = max(self.best_score, int(getattr(self.game, "score", 0)))
            self.episodes += 1
            self._seed += 1
            self.game.reset(self._seed)          # keep the env alive for the agent
        return frame


def encode_png(frame: np.ndarray, scale: int = 1) -> bytes:
    from PIL import Image

    img = Image.fromarray(frame)
    if scale != 1:
        img = img.resize((frame.shape[1] * scale, frame.shape[0] * scale), Image.NEAREST)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class DualRateBuffer:
    """Runs a GameSource at `video_hz` in a producer thread, filling a video ring
    (raw frames) every tick and a screenshot ring (PNG) at `shot_hz`. The agent
    reads the rings and calls :meth:`set_action` asynchronously."""

    def __init__(
        self,
        source: GameSource,
        *,
        video_hz: int = 120,
        shot_hz: int = 60,
        video_window_s: float = 1.0,
        shot_window_s: float = 2.0,
        shot_scale: int = 1,
    ) -> None:
        self.source = source
        self.video_hz = video_hz
        self.shot_hz = shot_hz
        self.shot_scale = shot_scale
        self.video = _Ring(maxlen=max(1, int(video_hz * video_window_s)))
        self.shots = _Ring(maxlen=max(1, int(shot_hz * shot_window_s)))
        self._action = source.noop
        self._action_lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._t0 = 0.0
        self._ticks = 0

    # ---- agent-facing API ------------------------------------------------- #

    def set_action(self, action: str) -> None:
        with self._action_lock:
            self._action = action

    def latest_video(self) -> Optional[np.ndarray]:
        v = self.video.latest()
        return v[1] if v else None

    def video_window(self, n: Optional[int] = None) -> list[np.ndarray]:
        return [f for _t, f in self.video.window(n)]

    def latest_shot(self) -> Optional[bytes]:
        v = self.shots.latest()
        return v[1] if v else None

    def shot_window(self, n: Optional[int] = None) -> list[bytes]:
        return [p for _t, p in self.shots.window(n)]

    def stats(self) -> dict:
        elapsed = max(1e-6, time.perf_counter() - self._t0) if self._t0 else 0.0
        return {
            "game": self.source.game_id,
            "ticks": self._ticks,
            "video_fps": round(self._ticks / elapsed, 1) if elapsed else 0.0,
            "shot_fps": round(self.shots.pushed / elapsed, 1) if elapsed else 0.0,
            "video_buffer": len(self.video),
            "shot_buffer": len(self.shots),
            "episodes": self.source.episodes,
            "best_score": self.source.best_score,
        }

    # ---- lifecycle -------------------------------------------------------- #

    def start(self) -> "DualRateBuffer":
        self._running = True
        self._t0 = time.perf_counter()
        self._thread = threading.Thread(target=self._produce, name="frame-producer", daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=1.0)

    def _produce(self) -> None:
        period = 1.0 / self.video_hz
        shot_every = max(1, round(self.video_hz / self.shot_hz))
        next_tick = time.perf_counter()
        while self._running:
            with self._action_lock:
                action = self._action
            frame = self.source.tick(action)
            now = time.perf_counter()
            self.video.push(now, frame)
            if self._ticks % shot_every == 0:
                self.shots.push(now, encode_png(frame, self.shot_scale))
            self._ticks += 1
            # pace to the video rate; if we fell behind, resync without spiraling.
            next_tick += period
            slack = next_tick - time.perf_counter()
            if slack > 0:
                time.sleep(slack)
            else:
                next_tick = time.perf_counter()

    def __enter__(self):
        return self.start()

    def __exit__(self, *exc):
        self.stop()


def open_game(game_id: str, seed: int = 1, **kw) -> DualRateBuffer:
    """Open a game's environment ready-to-run with both buffers live — the agent
    attaches and reads immediately."""
    return DualRateBuffer(GameSource(game_id, seed), **kw).start()


# ======================================================================== #
# CLI / demo
# ======================================================================== #


def main() -> None:
    ap = argparse.ArgumentParser(description="Dual-rate game frame buffers (120Hz video + 60Hz screenshots)")
    ap.add_argument("--game", default="dodger", choices=sorted(GAMES))
    ap.add_argument("--secs", type=float, default=3.0)
    ap.add_argument("--video-hz", type=int, default=120)
    ap.add_argument("--shot-hz", type=int, default=60)
    ap.add_argument("--drive", action="store_true", help="let the game's CV agent drive via the buffer (30Hz)")
    args = ap.parse_args()

    buf = open_game(args.game, video_hz=args.video_hz, shot_hz=args.shot_hz)
    print(f"▶ opened '{args.game}' — video@{args.video_hz}Hz + screenshots@{args.shot_hz}Hz, agent can read now.")

    if args.drive:
        # Decoupled control: agent decides at 30Hz off the latest video frame
        # while the game runs at the full video rate.
        agent = buf.source.make_agent()
        decided = 0
        end = time.perf_counter() + args.secs
        while time.perf_counter() < end:
            frame = buf.latest_video()
            if frame is not None:
                try:
                    action = agent.act(frame)
                except Exception:
                    action = buf.source.noop
                buf.set_action(str(action))
                decided += 1
            time.sleep(1 / 30)
        print(f"  agent decided {decided}x at ~30Hz while the game ran at the video rate.")
    else:
        time.sleep(args.secs)

    s = buf.stats()
    buf.stop()
    # one screenshot to prove the buffer holds real frames
    shot = buf.latest_shot()
    vid = buf.video_window()
    moved = ""
    if len(vid) >= 2:
        moved = "moving" if not np.array_equal(vid[-1], vid[-2]) else "static"
    print("\n── buffers ─────────────────────────────")
    print(f"  video:  {s['video_fps']:>6} fps (target {args.video_hz}) · buffer holds {s['video_buffer']} raw frames {f'({moved})' if moved else ''}")
    print(f"  shots:  {s['shot_fps']:>6} fps (target {args.shot_hz}) · buffer holds {s['shot_buffer']} PNGs · latest = {len(shot or b'')} bytes")
    print(f"  game:   {s['ticks']} ticks · {s['episodes']} episodes auto-reset · best score {s['best_score']}")
    ok = s["video_fps"] >= args.video_hz * 0.8 and s["shot_fps"] >= args.shot_hz * 0.8 and bool(shot)
    print("\n" + ("PASS — both buffers live at ~target rate; agent can read video + screenshots."
                  if ok else "NOTE — achieved rate below target (Python timing); see numbers above."))


if __name__ == "__main__":
    main()
