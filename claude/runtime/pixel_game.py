"""A pixel-based game runtime — the "AI plays from rendered pixels" frontier.

Unlike the deterministic arcade envs (which hand agents structured state), this
renders a real RGB game frame and the agent must read it back from PIXELS, like
the nitrogen.minedojo / native-Steam-runtime vision: frame -> agent -> input.

`PixelDodger` is a small rendered game (a green paddle dodging red falling
blocks). `CVAgent` plays it using ONLY the rendered frame — locating the player
and hazards by colour with numpy, then steering away from the nearest threat.
Designed to run on Modal (see modal_pixel.py) and stream frames to the browser.
"""

from __future__ import annotations

import io
import random
from typing import Optional, Sequence

import numpy as np
from PIL import Image

_MASK = 0xFFFFFFFF


class Mulberry32:
    """Portable PRNG, bit-for-bit identical to harness/steambench_harness/rng.py
    and web/src/lib/arcade/rng.ts. Inlined so this module is self-contained on
    Modal, yet a (seed, actions) trace produced here replays on the TS engine."""

    def __init__(self, seed: int = 0) -> None:
        self.a = seed & _MASK

    def next_u32(self) -> int:
        self.a = (self.a + 0x6D2B79F5) & _MASK
        a = self.a
        t = (a ^ (a >> 15)) * (1 | a) & _MASK
        t = ((t + ((t ^ (t >> 7)) * (61 | t) & _MASK)) & _MASK) ^ t
        t &= _MASK
        return (t ^ (t >> 14)) & _MASK

    def random(self) -> float:
        return self.next_u32() / 4294967296.0

    def randrange(self, n: int) -> int:
        if n <= 0:
            raise ValueError("randrange requires n > 0")
        return int(self.random() * n)

    def choice(self, seq: "Sequence"):
        return seq[self.randrange(len(seq))]


W, H = 168, 120
PW, PH = 20, 8          # player paddle
HW, HH = 14, 14         # hazard block
PLAYER_Y = H - PH - 3
PSPEED = 7
FALL = 4
SPAWN_GAP = 26          # vertical spacing between hazard waves
BG = (11, 14, 22)
PLAYER_RGB = (74, 222, 128)   # green
HAZARD_RGB = (248, 113, 113)  # red
ACTIONS = ["left", "stay", "right"]


class PixelDodger:
    """Dodge falling blocks. Observation is the rendered frame; score = ticks."""

    achievements = [
        ("survive_50", "Reflexes", 50),
        ("survive_150", "In the Groove", 150),
        ("survive_300", "Untouchable", 300),
        ("survive_600", "Bullet Time", 600),
        ("survive_1200", "Matrix", 1200),
    ]

    def __init__(self, seed: int = 0) -> None:
        self.reset(seed)

    def reset(self, seed: int = 0):
        self.rng = Mulberry32(seed)
        self.px = (W - PW) // 2
        self.hazards: list[list[int]] = []  # [x, y]
        self.score = 0
        self.done = False
        self.unlocked: set[str] = set()
        self._since_spawn = SPAWN_GAP
        return self.render_array()

    def _spawn(self) -> None:
        x = self.rng.randrange(W - HW + 1)   # inclusive [0, W-HW], one draw per spawn
        self.hazards.append([x, -HH])

    def step(self, action: str):
        if self.done:
            return self.render_array()
        if action == "left":
            self.px = max(0, self.px - PSPEED)
        elif action == "right":
            self.px = min(W - PW, self.px + PSPEED)

        self._since_spawn += FALL
        if self._since_spawn >= SPAWN_GAP:
            self._since_spawn = 0
            self._spawn()
        for hz in self.hazards:
            hz[1] += FALL
        self.hazards = [h for h in self.hazards if h[1] < H]

        # collision: paddle rect vs any hazard rect
        for hx, hy in self.hazards:
            if (hx < self.px + PW and hx + HW > self.px and
                    hy < PLAYER_Y + PH and hy + HH > PLAYER_Y):
                self.done = True
                break

        if not self.done:
            self.score += 1
            for aid, _name, thresh in self.achievements:
                if self.score >= thresh:
                    self.unlocked.add(aid)
        return self.render_array()

    # ---- rendering (the observation) -------------------------------------- #

    def render_array(self) -> np.ndarray:
        frame = np.empty((H, W, 3), dtype=np.uint8)
        frame[:, :] = BG
        for hx, hy in self.hazards:
            y0, y1 = max(0, hy), min(H, hy + HH)
            x0, x1 = max(0, hx), min(W, hx + HW)
            if y1 > y0 and x1 > x0:
                frame[y0:y1, x0:x1] = HAZARD_RGB
        frame[PLAYER_Y:PLAYER_Y + PH, self.px:self.px + PW] = PLAYER_RGB
        return frame

    def render_png(self, scale: int = 3) -> bytes:
        img = Image.fromarray(self.render_array(), "RGB")
        if scale != 1:
            img = img.resize((W * scale, H * scale), Image.NEAREST)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()


class CVAgent:
    """Plays PixelDodger from the rendered frame alone (no game state)."""

    name = "cv-vision"
    LOOKAHEAD = 60   # danger-band depth (px) for the greedy continuation
    HORIZON = 16     # freeze-rollout depth (ticks)

    def __init__(self) -> None:
        self.last_reasoning = ""
        # Perception, exposed so the viewer can overlay what the agent "sees".
        self.detected_player: Optional[list[int]] = None   # [x0, x1]
        self.detected_hazards: list[list[int]] = []          # [[x0,y0,x1,y1], ...]
        self.target_x: Optional[int] = None

    def reset(self) -> None:
        pass

    def _detect(self, frame: np.ndarray) -> None:
        self.target_x = None
        r = frame[:, :, 0].astype(int)
        g = frame[:, :, 1].astype(int)
        b = frame[:, :, 2].astype(int)
        green = (g > 150) & (r < 130) & (b < 160)
        red = (r > 170) & (g < 140) & (b < 140)
        gcols = np.where(green.any(axis=0))[0]
        self.detected_player = [int(gcols.min()), int(gcols.max())] if gcols.size else None
        # bounding boxes of red blobs (column-run grouping is enough for the viewer)
        boxes = []
        rcols = np.where(red.any(axis=0))[0]
        if rcols.size:
            runs, start = [], rcols[0]
            for i in range(1, len(rcols)):
                if rcols[i] != rcols[i - 1] + 1:
                    runs.append((start, rcols[i - 1]))
                    start = rcols[i]
            runs.append((start, rcols[-1]))
            for x0, x1 in runs:
                ys = np.where(red[:, x0:x1 + 1].any(axis=1))[0]
                if ys.size:
                    boxes.append([int(x0), int(ys.min()), int(x1), int(ys.max())])
        self.detected_hazards = boxes

    def _greedy(self, px: int, boxes: list) -> str:
        """One-step column-avoidance over the detected hazard boxes (the rollout
        continuation, and a fine standalone policy)."""
        band_top = PLAYER_Y - self.LOOKAHEAD
        occ = bytearray(W)
        for x0, y0, x1, y1 in boxes:
            if y1 >= band_top and y0 < PLAYER_Y + PH:
                for x in range(max(0, x0), min(W, x1 + 1)):
                    occ[x] = 1
        if not any(occ):
            center = (W - PW) // 2
            self.target_x = center
            return "left" if px > center + 4 else "right" if px < center - 4 else "stay"
        max_x = W - PW
        safe = [x for x in range(max_x + 1) if not any(occ[x:x + PW])]
        if safe:
            target = min(safe, key=lambda x: abs(x - px))
        else:
            target = min(range(max_x + 1), key=lambda x: sum(occ[x:x + PW]))
        self.target_x = int(target)
        return "left" if target < px - 1 else "right" if target > px + 1 else "stay"

    def _rollout(self, px: int, boxes: list, first: str) -> int:
        """Simulate the next HORIZON ticks (boxes fall by FALL, paddle plays the
        greedy continuation) and count survival. Mirrors PixelDodger.step's order
        on the *detected* boxes — known game dynamics, perception from pixels."""
        haz = [list(b) for b in boxes]

        def advance(p, haz, action):
            if action == "left":
                p = max(0, p - PSPEED)
            elif action == "right":
                p = min(W - PW, p + PSPEED)
            for bx in haz:
                bx[1] += FALL
                bx[3] += FALL
            haz = [bx for bx in haz if bx[1] < H]
            for x0, y0, x1, y1 in haz:
                if x0 < p + PW and x1 + 1 > p and y0 < PLAYER_Y + PH and y1 + 1 > PLAYER_Y:
                    return p, haz, True
            return p, haz, False

        p, haz, dead = advance(px, haz, first)
        if dead:
            return 0
        survived = 1
        for _ in range(self.HORIZON - 1):
            a = self._greedy(p, haz)
            p, haz, dead = advance(p, haz, a)
            if dead:
                break
            survived += 1
        return survived

    def act(self, frame: np.ndarray):
        self._detect(frame)
        if self.detected_player is None:
            self.last_reasoning = "no paddle seen"
            return "stay"
        px = self.detected_player[0]
        boxes = self.detected_hazards
        results = [(self._rollout(px, boxes, a), a) for a in ("left", "stay", "right")]
        best = max(v for v, _ in results)
        # Re-run greedy on the live frame so target_x reflects the real choice (for the overlay).
        greedy = self._greedy(px, boxes)
        winners = [a for v, a in results if v == best]
        choice = greedy if greedy in winners else winners[0]
        self.last_reasoning = f"vision rollout {best}t → {choice}"
        return choice


# ======================================================================== #
# Catcher — a 2nd pixel game (catch good / dodge bad), proving the vision
# runtime generalizes. Shares logic + Mulberry32 draw order with the harness
# env arcade/catcher, so the CV agent's pixel run replay-verifies there too.
# ======================================================================== #

C_PW, C_PH = 24, 8
C_IW, C_IH = 12, 12
C_SPAWN_GAP = 22
C_BAD_NUM, C_BAD_DEN = 37, 100
PADDLE_CYAN = (56, 189, 248)
GOOD_GREEN = (74, 222, 128)
BAD_RED = (248, 113, 113)


class CatcherGame:
    """Catch green drops, dodge red ones. Observation is the rendered frame."""

    achievements = [
        ("catch_5", "First Drops", 5),
        ("catch_15", "Bucket Hands", 15),
        ("catch_30", "Sticky Fingers", 30),
        ("catch_60", "Vacuum", 60),
        ("catch_120", "Event Horizon", 120),
    ]

    def __init__(self, seed: int = 0) -> None:
        self.reset(seed)

    def reset(self, seed: int = 0):
        self.rng = Mulberry32(seed)
        self.px = (W - C_PW) // 2
        self.items: list[list[int]] = []  # [x, y, kind] kind 0=good 1=bad
        self.caught = 0
        self.score = 0
        self.done = False
        self.unlocked: set[str] = set()
        self._since_spawn = C_SPAWN_GAP
        return self.render_array()

    def step(self, action: str):
        if self.done:
            return self.render_array()
        if action == "left":
            self.px = max(0, self.px - PSPEED)
        elif action == "right":
            self.px = min(W - C_PW, self.px + PSPEED)

        self._since_spawn += FALL
        if self._since_spawn >= C_SPAWN_GAP:
            self._since_spawn = 0
            x = self.rng.randrange(W - C_IW + 1)
            kind = 1 if self.rng.randrange(C_BAD_DEN) < C_BAD_NUM else 0
            self.items.append([x, -C_IH, kind])
        for it in self.items:
            it[1] += FALL

        survivors = []
        for x, y, kind in self.items:
            if (x < self.px + C_PW and x + C_IW > self.px and
                    y < PLAYER_Y + C_PH and y + C_IH > PLAYER_Y):
                if kind == 1:
                    self.done = True
                else:
                    self.caught += 1
                continue
            if y >= H:
                continue
            survivors.append([x, y, kind])
        self.items = survivors

        self.score = self.caught  # always reflects goods caught, even on a death tick
        if not self.done:
            for aid, _name, thresh in self.achievements:
                if self.caught >= thresh:
                    self.unlocked.add(aid)
        return self.render_array()

    def render_array(self) -> np.ndarray:
        frame = np.empty((H, W, 3), dtype=np.uint8)
        frame[:, :] = BG
        for x, y, kind in self.items:
            y0, y1 = max(0, y), min(H, y + C_IH)
            x0, x1 = max(0, x), min(W, x + C_IW)
            if y1 > y0 and x1 > x0:
                frame[y0:y1, x0:x1] = BAD_RED if kind == 1 else GOOD_GREEN
        frame[PLAYER_Y:PLAYER_Y + C_PH, self.px:self.px + C_PW] = PADDLE_CYAN
        return frame

    def render_png(self, scale: int = 3) -> bytes:
        img = Image.fromarray(self.render_array(), "RGB")
        if scale != 1:
            img = img.resize((W * scale, H * scale), Image.NEAREST)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()


def _toward(px: int, target: int) -> str:
    return "left" if target < px - 1 else "right" if target > px + 1 else "stay"


class CatcherCVAgent:
    """Plays CatcherGame from pixels: a TWO-class perception — tell green (catch)
    from red (avoid) — then a freeze-rollout that maximizes catches while living."""

    name = "cv-catcher"
    LOOKAHEAD = 70
    HORIZON = 16

    def __init__(self) -> None:
        self.last_reasoning = ""
        self.detected_player: Optional[list[int]] = None
        self.detected_items: list[dict] = []   # [{"box":[x0,y0,x1,y1],"kind":0|1}]
        self.target_x: Optional[int] = None

    def reset(self) -> None:
        pass

    def _detect(self, frame: np.ndarray) -> None:
        r = frame[:, :, 0].astype(int)
        g = frame[:, :, 1].astype(int)
        b = frame[:, :, 2].astype(int)
        cyan = (b > 170) & (g > 120) & (r < 120)
        green = (g > 160) & (r < 130) & (b < 170)
        red = (r > 180) & (g < 150) & (b < 150)
        ccols = np.where(cyan.any(axis=0))[0]
        self.detected_player = [int(ccols.min()), int(ccols.max())] if ccols.size else None
        items = []
        for mask, kind in ((green, 0), (red, 1)):
            cols = np.where(mask.any(axis=0))[0]
            if not cols.size:
                continue
            runs, start = [], cols[0]
            for i in range(1, len(cols)):
                if cols[i] != cols[i - 1] + 1:
                    runs.append((start, cols[i - 1]))
                    start = cols[i]
            runs.append((start, cols[-1]))
            for x0, x1 in runs:
                ys = np.where(mask[:, x0:x1 + 1].any(axis=1))[0]
                if ys.size:
                    items.append({"box": [int(x0), int(ys.min()), int(x1), int(ys.max())], "kind": kind})
        self.detected_items = items

    def _items_as_rects(self):
        return [(it["box"][0], it["box"][1], it["box"][2], it["box"][3], it["kind"]) for it in self.detected_items]

    def _greedy(self, px: int, items) -> str:
        band_top = PLAYER_Y - self.LOOKAHEAD
        occ = bytearray(W)
        for x0, y0, x1, y1, kind in items:
            if kind == 1 and y1 >= band_top and y0 < PLAYER_Y + C_PH:
                for c in range(max(0, x0), min(W, x1 + 1)):
                    occ[c] = 1
        max_x = W - C_PW

        def span_bad(x):
            return sum(occ[x:x + C_PW])

        if span_bad(px) > 0:
            safe = [x for x in range(max_x + 1) if span_bad(x) == 0]
            t = (min(safe, key=lambda x: abs(x - px)) if safe
                 else min(range(max_x + 1), key=span_bad))
            self.target_x = t
            return _toward(px, t)
        goods = [(x0, y0, x1, y1) for x0, y0, x1, y1, k in items
                 if k == 0 and y0 < PLAYER_Y + C_PH and y1 > band_top]
        goods.sort(key=lambda t: -t[1])
        for x0, y0, x1, y1 in goods:
            cx = (x0 + x1) // 2
            desired = min(max_x, max(0, cx - C_PW // 2))
            if span_bad(desired) == 0:
                self.target_x = desired
                return _toward(px, desired)
        self.target_x = px
        return "stay"

    def _rollout(self, px: int, items, first: str) -> float:
        def advance(p, its, action):
            if action == "left":
                p = max(0, p - PSPEED)
            elif action == "right":
                p = min(W - C_PW, p + PSPEED)
            for it in its:
                it[1] += FALL
                it[3] += FALL
            gained, dead, surv = 0, False, []
            for x0, y0, x1, y1, k in its:
                if x0 < p + C_PW and x1 + 1 > p and y0 < PLAYER_Y + C_PH and y1 + 1 > PLAYER_Y:
                    if k == 1:
                        dead = True
                    else:
                        gained += 1
                    continue
                if y0 >= H:
                    continue
                surv.append([x0, y0, x1, y1, k])
            return p, surv, gained, dead

        its = [list(it) for it in items]
        p, its, gained, dead = advance(px, its, first)
        total, tick = gained, 1
        if dead:
            return total * 1000 + tick
        for _ in range(self.HORIZON - 1):
            a = self._greedy(p, [(x0, y0, x1, y1, k) for x0, y0, x1, y1, k in its])
            p, its, gN, dead = advance(p, its, a)
            total += gN
            tick += 1
            if dead:
                return total * 1000 + tick
        return 1_000_000 + total * 1000 + tick

    def act(self, frame: np.ndarray):
        self._detect(frame)
        if self.detected_player is None:
            self.last_reasoning = "no paddle seen"
            return "stay"
        px = self.detected_player[0]
        items = self._items_as_rects()
        results = [(self._rollout(px, items, a), a) for a in ("left", "stay", "right")]
        best = max(v for v, _ in results)
        greedy = self._greedy(px, items)
        winners = [a for v, a in results if v == best]
        choice = greedy if greedy in winners else winners[0]
        self.last_reasoning = f"catch rollout {int(best % 1000)} → {choice}"
        return choice


# ======================================================================== #
# Volley — a 3rd pixel game, the TEMPORAL-vision frontier: the agent must infer
# the ball's velocity by differencing consecutive frames (a single frame can't
# reveal motion), then predict the landing. Shares logic + RNG with arcade/volley.
# ======================================================================== #

V_BS = 8
V_PW, V_PH = 26, 6
V_PLAYER_Y = H - V_PH - 3   # 111
V_PSPEED = 6
V_VY0 = 4
V_VY_MAX = 11
V_LAUNCH_VX = [-8, -7, 7, 8]
BALL_WHITE = (238, 238, 240)
V_PADDLE = (56, 189, 248)


class VolleyGame:
    """Keep a bouncing ball up. Observation is the rendered frame."""

    achievements = [
        ("bounce_5", "Rally", 5),
        ("bounce_15", "Keepy-Uppy", 15),
        ("bounce_30", "Metronome", 30),
        ("bounce_60", "Wall", 60),
        ("bounce_120", "Unbreakable", 120),
    ]

    def __init__(self, seed: int = 0) -> None:
        self.reset(seed)

    def reset(self, seed: int = 0):
        self.rng = Mulberry32(seed)
        self.bx = self.rng.randrange(W - V_BS + 1)
        self.by = 12
        self.vx = V_LAUNCH_VX[self.rng.randrange(len(V_LAUNCH_VX))]
        self.vy = V_VY0
        self.px = (W - V_PW) // 2
        self.bounces = 0
        self.score = 0
        self.done = False
        self.unlocked: set[str] = set()
        return self.render_array()

    def step(self, action: str):
        if self.done:
            return self.render_array()
        if action == "left":
            self.px = max(0, self.px - V_PSPEED)
        elif action == "right":
            self.px = min(W - V_PW, self.px + V_PSPEED)
        self.bx += self.vx
        self.by += self.vy
        if self.bx <= 0:
            self.bx = 0
            self.vx = -self.vx
        elif self.bx >= W - V_BS:
            self.bx = W - V_BS
            self.vx = -self.vx
        if self.by <= 0:
            self.by = 0
            self.vy = -self.vy
        if self.vy > 0 and self.by + V_BS >= V_PLAYER_Y:
            in_band = self.by <= V_PLAYER_Y + V_PH
            x_overlap = self.bx + V_BS > self.px and self.bx < self.px + V_PW
            if in_band and x_overlap:
                self.bounces += 1
                self.by = V_PLAYER_Y - V_BS
                self.vy = -min(V_VY_MAX, V_VY0 + self.bounces // 10)
                for aid, _name, thresh in self.achievements:
                    if self.bounces >= thresh:
                        self.unlocked.add(aid)
            elif self.by >= H:
                self.done = True
        self.score = self.bounces
        return self.render_array()

    def render_array(self) -> np.ndarray:
        frame = np.empty((H, W, 3), dtype=np.uint8)
        frame[:, :] = BG
        y0, y1 = max(0, self.by), min(H, self.by + V_BS)
        x0, x1 = max(0, self.bx), min(W, self.bx + V_BS)
        if y1 > y0 and x1 > x0:
            frame[y0:y1, x0:x1] = BALL_WHITE
        frame[V_PLAYER_Y:V_PLAYER_Y + V_PH, self.px:self.px + V_PW] = V_PADDLE
        return frame

    def render_png(self, scale: int = 3) -> bytes:
        img = Image.fromarray(self.render_array(), "RGB")
        if scale != 1:
            img = img.resize((W * scale, H * scale), Image.NEAREST)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()


class VolleyCVAgent:
    """Plays VolleyGame from pixels using TEMPORAL reasoning: it remembers the
    previous frame's ball position, differences to infer velocity, then simulates
    the ball forward (through wall bounces) to the paddle row to predict landing."""

    name = "cv-volley"

    def __init__(self) -> None:
        self.last_reasoning = ""
        self.prev = None                       # previous ball top-left (bx, by)
        self.detected_player: Optional[list[int]] = None
        self.detected_items: list[dict] = []   # the ball, for the overlay
        self.target_x: Optional[int] = None
        self._ball = None

    def reset(self) -> None:
        self.prev = None

    def _detect(self, frame: np.ndarray) -> None:
        r = frame[:, :, 0].astype(int)
        g = frame[:, :, 1].astype(int)
        b = frame[:, :, 2].astype(int)
        white = (r > 200) & (g > 200) & (b > 200)
        cyan = (b > 170) & (g > 120) & (r < 120)
        ccols = np.where(cyan.any(axis=0))[0]
        self.detected_player = [int(ccols.min()), int(ccols.max())] if ccols.size else None
        wcols = np.where(white.any(axis=0))[0]
        wrows = np.where(white.any(axis=1))[0]
        if wcols.size and wrows.size:
            self._ball = [int(wcols.min()), int(wrows.min()), int(wcols.max()), int(wrows.max())]
            self.detected_items = [{"box": list(self._ball), "kind": "ball"}]
        else:
            self._ball = None
            self.detected_items = []

    def act(self, frame: np.ndarray):
        self._detect(frame)
        if self.detected_player is None or self._ball is None:
            self.last_reasoning = "searching for the ball"
            return "stay"
        px = self.detected_player[0]
        bx0, by0, bx1, by1 = self._ball
        if self.prev is None:
            self.prev = (bx0, by0)
            self.last_reasoning = "reading motion…"
            target = bx0 + V_BS // 2 - V_PW // 2
        else:
            vx = bx0 - self.prev[0]
            vy = by0 - self.prev[1]
            self.prev = (bx0, by0)
            if vy == 0:
                vy = V_VY0  # haven't seen vertical motion yet — assume descending
            sx, sy, svx, svy = bx0, by0, vx, vy
            tx = sx
            for _ in range(400):
                sx += svx
                sy += svy
                if sx <= 0:
                    sx = 0
                    svx = -svx
                elif sx >= W - V_BS:
                    sx = W - V_BS
                    svx = -svx
                if sy <= 0:
                    sy = 0
                    svy = -svy
                if svy > 0 and sy + V_BS >= V_PLAYER_Y:
                    tx = sx
                    break
            else:
                tx = sx
            target = tx + V_BS // 2 - V_PW // 2
            self.last_reasoning = f"v=({vx},{vy}) → intercept @x{max(0, min(W - V_PW, target))}"
        target = max(0, min(W - V_PW, target))
        self.target_x = target
        if target < px - 1:
            return "left"
        if target > px + 1:
            return "right"
        return "stay"


def play_volley(seed: int = 1, agent: Optional[object] = None, max_steps: int = 3000):
    game = VolleyGame(seed)
    agent = agent or VolleyCVAgent()
    frame = game.render_array()
    actions = []
    while not game.done and len(actions) < max_steps:
        a = agent.act(frame)
        actions.append(a)
        frame = game.step(a)
    return game.bounces, sorted(game.unlocked), actions


# ======================================================================== #
# Storm — a 4th pixel game, MULTI-OBJECT temporal vision: blocks fall at varying
# speeds, so the agent must track SEVERAL across frames and infer each one's
# velocity. Shares logic + RNG with arcade/storm.
# ======================================================================== #

S_PW, S_PH = 22, 8
S_BW, S_BH = 12, 12
S_PLAYER_Y = H - S_PH - 3   # 109
S_PSPEED = 7
S_SPAWN_EVERY = 8
S_VY_MIN, S_VY_SPAN = 3, 5
S_LOOK_T, S_HORIZON = 13, 16


class StormGame:
    """Dodge falling blocks, each at its own speed. Observation = rendered frame."""

    achievements = [
        ("survive_50", "Drizzle", 50),
        ("survive_150", "Downpour", 150),
        ("survive_300", "Squall", 300),
        ("survive_600", "Tempest", 600),
        ("survive_1200", "Eye of the Storm", 1200),
    ]

    def __init__(self, seed: int = 0) -> None:
        self.reset(seed)

    def reset(self, seed: int = 0):
        self.rng = Mulberry32(seed)
        self.px = (W - S_PW) // 2
        self.blocks: list[list[int]] = []   # [x, y, vy]
        self.steps = 0
        self.score = 0
        self.done = False
        self.unlocked: set[str] = set()
        return self.render_array()

    def step(self, action: str):
        if self.done:
            return self.render_array()
        self.steps += 1
        if action == "left":
            self.px = max(0, self.px - S_PSPEED)
        elif action == "right":
            self.px = min(W - S_PW, self.px + S_PSPEED)
        if self.steps % S_SPAWN_EVERY == 0:
            x = self.rng.randrange(W - S_BW + 1)
            vy = S_VY_MIN + self.rng.randrange(S_VY_SPAN)
            self.blocks.append([x, -S_BH, vy])
        for b in self.blocks:
            b[1] += b[2]
        self.blocks = [b for b in self.blocks if b[1] < H]
        hit = any(bx < self.px + S_PW and bx + S_BW > self.px and
                  by < S_PLAYER_Y + S_PH and by + S_BH > S_PLAYER_Y
                  for bx, by, _vy in self.blocks)
        if hit:
            self.done = True
        else:
            self.score += 1
            for aid, _name, thresh in self.achievements:
                if self.score >= thresh:
                    self.unlocked.add(aid)
        return self.render_array()

    def render_array(self) -> np.ndarray:
        frame = np.empty((H, W, 3), dtype=np.uint8)
        frame[:, :] = BG
        for bx, by, _vy in self.blocks:
            y0, y1 = max(0, by), min(H, by + S_BH)
            x0, x1 = max(0, bx), min(W, bx + S_BW)
            if y1 > y0 and x1 > x0:
                frame[y0:y1, x0:x1] = HAZARD_RGB
        frame[S_PLAYER_Y:S_PLAYER_Y + S_PH, self.px:self.px + S_PW] = PLAYER_RGB
        return frame

    def render_png(self, scale: int = 3) -> bytes:
        img = Image.fromarray(self.render_array(), "RGB")
        if scale != 1:
            img = img.resize((W * scale, H * scale), Image.NEAREST)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()


class StormCVAgent:
    """Plays StormGame from pixels with MULTI-OBJECT tracking: each frame it finds
    the red blocks, matches them to the previous frame to infer each block's fall
    speed, then freeze-rolls-out an avoidance plan using those per-block speeds."""

    name = "cv-storm"

    def __init__(self) -> None:
        self.last_reasoning = ""
        self.prev_centers: list[tuple[float, float]] = []
        self.detected_player: Optional[list[int]] = None
        self.detected_items: list[dict] = []
        self.target_x: Optional[int] = None

    def reset(self) -> None:
        self.prev_centers = []

    def _detect(self, frame: np.ndarray):
        r = frame[:, :, 0].astype(int)
        g = frame[:, :, 1].astype(int)
        b = frame[:, :, 2].astype(int)
        green = (g > 150) & (r < 130) & (b < 160)
        red = (r > 170) & (g < 140) & (b < 140)
        gcols = np.where(green.any(axis=0))[0]
        self.detected_player = [int(gcols.min()), int(gcols.max())] if gcols.size else None
        boxes = []
        rcols = np.where(red.any(axis=0))[0]
        if rcols.size:
            runs, start = [], rcols[0]
            for i in range(1, len(rcols)):
                if rcols[i] != rcols[i - 1] + 1:
                    runs.append((start, rcols[i - 1]))
                    start = rcols[i]
            runs.append((start, rcols[-1]))
            for x0, x1 in runs:
                ys = np.where(red[:, x0:x1 + 1].any(axis=1))[0]
                if ys.size:
                    boxes.append([int(x0), int(ys.min()), int(x1), int(ys.max())])
        return boxes

    def _match_vy(self, boxes):
        """For each detected block, infer fall speed by matching it to the nearest
        block in the previous frame (same column, plausible downward step)."""
        vys = []
        for x0, y0, x1, y1 in boxes:
            cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
            best_d, best_dy = 1e9, None
            for pcx, pcy in self.prev_centers:
                if pcy <= cy and abs(pcx - cx) < 8 and 1 <= (cy - pcy) <= 14:
                    d = abs(pcx - cx) + (cy - pcy) * 0.3
                    if d < best_d:
                        best_d, best_dy = d, cy - pcy
            vys.append(int(round(best_dy)) if best_dy is not None else 5)
        return vys

    def _greedy(self, px: int, blocks) -> str:
        # blocks: [x0, y0, x1, y1, vy]
        occ = bytearray(W)
        for x0, y0, x1, y1, vy in blocks:
            if vy <= 0:
                continue
            t = (S_PLAYER_Y - (y1 + 1)) / vy
            if t <= S_LOOK_T:
                for c in range(max(0, x0), min(W, x1 + 1)):
                    occ[c] = 1
        if not any(occ):
            center = (W - S_PW) // 2
            return "left" if px > center + 4 else "right" if px < center - 4 else "stay"
        max_x = W - S_PW
        safe = [x for x in range(max_x + 1) if not any(occ[x:x + S_PW])]
        target = (min(safe, key=lambda x: abs(x - px)) if safe
                  else min(range(max_x + 1), key=lambda x: sum(occ[x:x + S_PW])))
        return _toward(px, target)

    def _rollout(self, px: int, blocks, first: str) -> int:
        def advance(p, blks, action):
            if action == "left":
                p = max(0, p - S_PSPEED)
            elif action == "right":
                p = min(W - S_PW, p + S_PSPEED)
            for b in blks:
                b[1] += b[4]
                b[3] += b[4]
            blks = [b for b in blks if b[1] < H]
            for x0, y0, x1, y1, _vy in blks:
                if x0 < p + S_PW and x1 + 1 > p and y0 < S_PLAYER_Y + S_PH and y1 + 1 > S_PLAYER_Y:
                    return p, blks, True
            return p, blks, False

        blks = [list(b) for b in blocks]
        p, blks, dead = advance(px, blks, first)
        if dead:
            return 0
        survived = 1
        for _ in range(S_HORIZON - 1):
            a = self._greedy(p, [(b[0], b[1], b[2], b[3], b[4]) for b in blks])
            p, blks, dead = advance(p, blks, a)
            if dead:
                break
            survived += 1
        return survived

    def act(self, frame: np.ndarray):
        boxes = self._detect(frame)
        if self.detected_player is None:
            self.prev_centers = [((x0 + x1) / 2.0, (y0 + y1) / 2.0) for x0, y0, x1, y1 in boxes]
            self.last_reasoning = "searching"
            return "stay"
        px = self.detected_player[0]
        vys = self._match_vy(boxes)
        blocks = [(boxes[i][0], boxes[i][1], boxes[i][2], boxes[i][3], vys[i]) for i in range(len(boxes))]
        self.detected_items = [{"box": boxes[i], "kind": "hazard"} for i in range(len(boxes))]
        self.prev_centers = [((x0 + x1) / 2.0, (y0 + y1) / 2.0) for x0, y0, x1, y1 in boxes]
        results = [(self._rollout(px, blocks, a), a) for a in ("left", "stay", "right")]
        best = max(v for v, _ in results)
        greedy = self._greedy(px, blocks)
        winners = [a for v, a in results if v == best]
        choice = greedy if greedy in winners else winners[0]
        self.target_x = None
        self.last_reasoning = f"tracking {len(boxes)} blocks · rollout {best}t → {choice}"
        return choice


def play_storm(seed: int = 1, agent: Optional[object] = None, max_steps: int = 2000):
    game = StormGame(seed)
    agent = agent or StormCVAgent()
    frame = game.render_array()
    actions = []
    while not game.done and len(actions) < max_steps:
        a = agent.act(frame)
        actions.append(a)
        frame = game.step(a)
    return game.score, sorted(game.unlocked), actions


# ======================================================================== #
# Turret — a 5th pixel game, the TARGETING modality: the agent aims a cannon and
# fires at descending targets (acting on the world, not just reacting). Shares
# logic + RNG with arcade/turret.
# ======================================================================== #

T_CW, T_CH = 18, 8
T_CANNON_Y = H - T_CH - 3   # 109
T_PSPEED = 7
T_BUW, T_BUH = 4, 8
T_BULLET_SPEED = 9
T_TW, T_TH = 14, 12
T_TARGET_VY = 3
T_LEAK_Y = T_CANNON_Y
T_START_LIVES = 3
BULLET_YELLOW = (250, 204, 21)


class TurretGame:
    """Shoot descending targets before they leak. Observation = rendered frame."""

    achievements = [
        ("hit_5", "Bullseye", 5),
        ("hit_15", "Sharpshooter", 15),
        ("hit_30", "Deadeye", 30),
        ("hit_60", "Gunslinger", 60),
        ("hit_120", "Annie Oakley", 120),
    ]

    def __init__(self, seed: int = 0) -> None:
        self.reset(seed)

    def reset(self, seed: int = 0):
        self.rng = Mulberry32(seed)
        self.cx = (W - T_CW) // 2
        self.bullet = None
        self.targets: list[list[int]] = []
        self.steps = 0
        self.hits = 0
        self.lives = T_START_LIVES
        self.score = 0
        self.done = False
        self.unlocked: set[str] = set()
        return self.render_array()

    def _spawn_every(self) -> int:
        return max(9, 24 - self.hits // 7)

    def step(self, action: str):
        if self.done:
            return self.render_array()
        self.steps += 1
        if action == "left":
            self.cx = max(0, self.cx - T_PSPEED)
        elif action == "right":
            self.cx = min(W - T_CW, self.cx + T_PSPEED)
        elif action == "fire" and self.bullet is None:
            self.bullet = [self.cx + T_CW // 2 - T_BUW // 2, T_CANNON_Y - T_BUH]
        if self.bullet is not None:
            self.bullet[1] -= T_BULLET_SPEED
            if self.bullet[1] + T_BUH < 0:
                self.bullet = None
        if self.steps % self._spawn_every() == 0:
            x = self.rng.randrange(W - T_TW + 1)
            self.targets.append([x, -T_TH])
        for t in self.targets:
            t[1] += T_TARGET_VY
        if self.bullet is not None:
            bx, by = self.bullet
            for i, (tx, ty) in enumerate(self.targets):
                if bx < tx + T_TW and bx + T_BUW > tx and by < ty + T_TH and by + T_BUH > ty:
                    del self.targets[i]
                    self.bullet = None
                    self.hits += 1
                    for aid, _name, thresh in self.achievements:
                        if self.hits >= thresh:
                            self.unlocked.add(aid)
                    break
        leaked = [t for t in self.targets if t[1] + T_TH >= T_LEAK_Y]
        if leaked:
            self.targets = [t for t in self.targets if t[1] + T_TH < T_LEAK_Y]
            self.lives -= len(leaked)
            if self.lives <= 0:
                self.done = True
        self.score = self.hits
        return self.render_array()

    def render_array(self) -> np.ndarray:
        frame = np.empty((H, W, 3), dtype=np.uint8)
        frame[:, :] = BG
        for tx, ty in self.targets:
            y0, y1 = max(0, ty), min(H, ty + T_TH)
            x0, x1 = max(0, tx), min(W, tx + T_TW)
            if y1 > y0 and x1 > x0:
                frame[y0:y1, x0:x1] = HAZARD_RGB
        if self.bullet is not None:
            bx, by = self.bullet
            y0, y1 = max(0, by), min(H, by + T_BUH)
            x0, x1 = max(0, bx), min(W, bx + T_BUW)
            if y1 > y0 and x1 > x0:
                frame[y0:y1, x0:x1] = BULLET_YELLOW
        frame[T_CANNON_Y:T_CANNON_Y + T_CH, self.cx:self.cx + T_CW] = PLAYER_RGB
        return frame

    def render_png(self, scale: int = 3) -> bytes:
        img = Image.fromarray(self.render_array(), "RGB")
        if scale != 1:
            img = img.resize((W * scale, H * scale), Image.NEAREST)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()


class TurretCVAgent:
    """Plays TurretGame from pixels: find the cannon (green), the targets (red),
    and the bullet (yellow); aim at the lowest target and fire when lined up."""

    name = "cv-turret"

    def __init__(self) -> None:
        self.last_reasoning = ""
        self.detected_player: Optional[list[int]] = None
        self.detected_items: list[dict] = []
        self.target_x: Optional[int] = None

    def reset(self) -> None:
        pass

    def _detect(self, frame: np.ndarray):
        r = frame[:, :, 0].astype(int)
        g = frame[:, :, 1].astype(int)
        b = frame[:, :, 2].astype(int)
        green = (g > 150) & (r < 130) & (b < 160)
        red = (r > 170) & (g < 140) & (b < 140)
        yellow = (r > 200) & (g > 170) & (b < 120)
        gcols = np.where(green.any(axis=0))[0]
        self.detected_player = [int(gcols.min()), int(gcols.max())] if gcols.size else None
        self._bullet_present = bool(yellow.any())
        boxes = []
        rcols = np.where(red.any(axis=0))[0]
        if rcols.size:
            runs, start = [], rcols[0]
            for i in range(1, len(rcols)):
                if rcols[i] != rcols[i - 1] + 1:
                    runs.append((start, rcols[i - 1]))
                    start = rcols[i]
            runs.append((start, rcols[-1]))
            for x0, x1 in runs:
                ys = np.where(red[:, x0:x1 + 1].any(axis=1))[0]
                if ys.size:
                    boxes.append([int(x0), int(ys.min()), int(x1), int(ys.max())])
        self.detected_items = [{"box": bx, "kind": "hazard"} for bx in boxes]
        return boxes

    def act(self, frame: np.ndarray):
        boxes = self._detect(frame)
        if self.detected_player is None:
            self.last_reasoning = "searching"
            return "stay"
        cannon_cx = self.detected_player[0] + T_CW // 2
        if not boxes:
            center = (W - T_CW) // 2 + T_CW // 2
            self.target_x = None
            self.last_reasoning = "no targets"
            return "left" if cannon_cx > center + 4 else "right" if cannon_cx < center - 4 else "stay"
        # lowest target = the box with the largest bottom-y (closest to leaking)
        low = max(boxes, key=lambda bx: bx[3])
        target_cx = (low[0] + low[2]) // 2
        self.target_x = target_cx
        if abs(cannon_cx - target_cx) <= 3:
            if not self._bullet_present:
                self.last_reasoning = f"aligned @x{target_cx} — fire"
                return "fire"
            self.last_reasoning = "aligned — bullet in flight"
            return "stay"
        self.last_reasoning = f"aim lowest target @x{target_cx}"
        return "left" if target_cx < cannon_cx else "right"


def play_turret(seed: int = 1, agent: Optional[object] = None, max_steps: int = 3000):
    game = TurretGame(seed)
    agent = agent or TurretCVAgent()
    frame = game.render_array()
    actions = []
    while not game.done and len(actions) < max_steps:
        a = agent.act(frame)
        actions.append(a)
        frame = game.step(a)
    return game.hits, sorted(game.unlocked), actions


# ======================================================================== #
# Forager — a 6th pixel game, the 2D-NAVIGATION modality: free up/down/left/right
# movement, collect goods + dodge roaming hazards. The CV agent must read the
# whole 2D board (connected-component blobs), not just one row. Shares logic +
# RNG with arcade/forager.
# ======================================================================== #

F_PS, F_PSPEED = 10, 5
F_GS, F_HS = 8, 12
F_N_GOOD, F_START_HAZ, F_MAX_HAZ = 3, 2, 5
F_HAZ_V = [-3, -2, 2, 3]
PLAYER_CYAN2 = (56, 189, 248)
GOOD_GREEN2 = (74, 222, 128)
HAZ_RED2 = (248, 113, 113)


class ForagerGame:
    """Roam a 2D arena: collect goods, dodge roaming hazards. Obs = rendered frame."""

    achievements = [
        ("collect_5", "Scavenger", 5),
        ("collect_15", "Gatherer", 15),
        ("collect_30", "Forager", 30),
        ("collect_60", "Hoarder", 60),
        ("collect_120", "Cornucopia", 120),
    ]

    def __init__(self, seed: int = 0) -> None:
        self.reset(seed)

    def _rand_good(self):
        return [self.rng.randrange(W - F_GS + 1), self.rng.randrange(H - F_GS + 1)]

    def _rand_hazard(self):
        x = self.rng.randrange(W - F_HS + 1)
        y = self.rng.randrange(max(1, H // 2 - F_HS))
        vx = F_HAZ_V[self.rng.randrange(len(F_HAZ_V))]
        vy = F_HAZ_V[self.rng.randrange(len(F_HAZ_V))]
        return [x, y, vx, vy]

    def reset(self, seed: int = 0):
        self.rng = Mulberry32(seed)
        self.px = (W - F_PS) // 2
        self.py = (H - F_PS) // 2
        self.collected = 0
        self.score = 0
        self.done = False
        self.unlocked: set[str] = set()
        self.goods = [self._rand_good() for _ in range(F_N_GOOD)]
        self.hazards = [self._rand_hazard() for _ in range(F_START_HAZ)]
        return self.render_array()

    def step(self, action: str):
        if self.done:
            return self.render_array()
        if action == "up":
            self.py = max(0, self.py - F_PSPEED)
        elif action == "down":
            self.py = min(H - F_PS, self.py + F_PSPEED)
        elif action == "left":
            self.px = max(0, self.px - F_PSPEED)
        elif action == "right":
            self.px = min(W - F_PS, self.px + F_PSPEED)
        for hz in self.hazards:
            hz[0] += hz[2]
            hz[1] += hz[3]
            if hz[0] <= 0:
                hz[0] = 0
                hz[2] = -hz[2]
            elif hz[0] >= W - F_HS:
                hz[0] = W - F_HS
                hz[2] = -hz[2]
            if hz[1] <= 0:
                hz[1] = 0
                hz[3] = -hz[3]
            elif hz[1] >= H - F_HS:
                hz[1] = H - F_HS
                hz[3] = -hz[3]
        for i, (gx, gy) in enumerate(self.goods):
            if gx < self.px + F_PS and gx + F_GS > self.px and gy < self.py + F_PS and gy + F_GS > self.py:
                self.collected += 1
                for aid, _name, thresh in self.achievements:
                    if self.collected >= thresh:
                        self.unlocked.add(aid)
                self.goods[i] = self._rand_good()
                if self.collected % 18 == 0 and len(self.hazards) < F_MAX_HAZ:
                    self.hazards.append(self._rand_hazard())
        for hx, hy, _vx, _vy in self.hazards:
            if hx < self.px + F_PS and hx + F_HS > self.px and hy < self.py + F_PS and hy + F_HS > self.py:
                self.done = True
                break
        self.score = self.collected
        return self.render_array()

    def render_array(self) -> np.ndarray:
        frame = np.empty((H, W, 3), dtype=np.uint8)
        frame[:, :] = BG
        for gx, gy in self.goods:
            frame[gy:gy + F_GS, gx:gx + F_GS] = GOOD_GREEN2
        for hx, hy, _vx, _vy in self.hazards:
            frame[hy:hy + F_HS, hx:hx + F_HS] = HAZ_RED2
        frame[self.py:self.py + F_PS, self.px:self.px + F_PS] = PLAYER_CYAN2
        return frame

    def render_png(self, scale: int = 3) -> bytes:
        img = Image.fromarray(self.render_array(), "RGB")
        if scale != 1:
            img = img.resize((W * scale, H * scale), Image.NEAREST)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()


def _blobs(mask: np.ndarray):
    """4-connected components of a boolean mask -> list of [x0,y0,x1,y1] bboxes."""
    ys, xs = np.where(mask)
    if not len(xs):
        return []
    pts = set(zip(xs.tolist(), ys.tolist()))
    seen: set = set()
    boxes = []
    for start in list(pts):
        if start in seen:
            continue
        stack = [start]
        seen.add(start)
        x0 = x1 = start[0]
        y0 = y1 = start[1]
        while stack:
            x, y = stack.pop()
            if x < x0: x0 = x
            if x > x1: x1 = x
            if y < y0: y0 = y
            if y > y1: y1 = y
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (x + dx, y + dy)
                if n in pts and n not in seen:
                    seen.add(n)
                    stack.append(n)
        boxes.append([int(x0), int(y0), int(x1), int(y1)])
    return boxes


class ForagerCVAgent:
    """Plays ForagerGame from pixels: connected-component blobs give the player
    (cyan), goods (green), hazards (red); a potential field then navigates 2D."""

    name = "cv-forager"

    def __init__(self) -> None:
        self.last_reasoning = ""
        self.detected_player = None
        self.detected_items: list[dict] = []
        self.target_x = None

    def reset(self) -> None:
        pass

    @staticmethod
    def _center(box):
        return ((box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0)

    def act(self, frame: np.ndarray):
        r = frame[:, :, 0].astype(int)
        g = frame[:, :, 1].astype(int)
        b = frame[:, :, 2].astype(int)
        cyan = (b > 170) & (g > 120) & (r < 120)
        green = (g > 160) & (r < 130) & (b < 170)
        red = (r > 180) & (g < 150) & (b < 150)
        pbox = _blobs(cyan)
        goods = _blobs(green)
        hazards = _blobs(red)
        self.detected_player = None  # 2D player -> drawn as an item, not a floor rect
        self.detected_items = (
            [{"box": bx, "kind": "good"} for bx in goods]
            + [{"box": bx, "kind": "bad"} for bx in hazards]
            + [{"box": bx, "kind": "player"} for bx in pbox]
        )
        if not pbox:
            self.last_reasoning = "searching"
            return "stay"
        px0, py0, px1, py1 = pbox[0]
        pcx, pcy = (px0 + px1) / 2.0, (py0 + py1) / 2.0
        # nearest good centroid
        if goods:
            gc = min((self._center(bx) for bx in goods),
                     key=lambda c: abs(c[0] - pcx) + abs(c[1] - pcy))
        else:
            gc = (pcx, pcy)
        hcs = [self._center(bx) for bx in hazards]

        def danger(nx, ny):
            ncx, ncy = nx + F_PS / 2.0, ny + F_PS / 2.0
            total = 0.0
            for hx, hy in hcs:
                dx, dy = hx - ncx, hy - ncy
                if abs(dx) < (F_PS + F_HS) / 2.0 + 3 and abs(dy) < (F_PS + F_HS) / 2.0 + 3:
                    total += 1000.0
                else:
                    d2 = dx * dx + dy * dy
                    if d2 < 32 * 32:
                        total += 250.0 / (d2 / 80.0 + 1.0)
            return total

        moves = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0), "stay": (0, 0)}
        best, best_score = "stay", -1e18
        for a, (dx, dy) in moves.items():
            nx = max(0, min(W - F_PS, px0 + dx * F_PSPEED))
            ny = max(0, min(H - F_PS, py0 + dy * F_PSPEED))
            attract = -(abs(gc[0] - (nx + F_PS / 2.0)) + abs(gc[1] - (ny + F_PS / 2.0)))
            score = attract - danger(nx, ny)
            if score > best_score:
                best_score, best = score, a
        self.last_reasoning = f"→ drop @({int(gc[0])},{int(gc[1])}) · {len(hazards)} hazards"
        return best


def play_forager(seed: int = 1, agent: Optional[object] = None, max_steps: int = 3000):
    game = ForagerGame(seed)
    agent = agent or ForagerCVAgent()
    frame = game.render_array()
    actions = []
    while not game.done and len(actions) < max_steps:
        a = agent.act(frame)
        actions.append(a)
        frame = game.step(a)
    return game.collected, sorted(game.unlocked), actions


# ======================================================================== #
# Phantom — a 7th pixel game, the MEMORY / OCCLUSION modality: blocks blink out
# of view (the whole frame darkens) while still falling, so the agent must
# remember and extrapolate what it can't see. Shares logic + RNG with
# arcade/phantom. The /native overlay draws the agent's REMEMBERED blocks, so you
# watch it track hazards through the dark.
# ======================================================================== #

PH_PW, PH_PH = 20, 8
PH_BW, PH_BH = 14, 14
PH_PLAYER_Y = H - PH_PH - 3   # 109
PH_PSPEED = 7
PH_FALL = 4
PH_SPAWN_GAP = 26
PH_BLINK_PERIOD = 14
PH_VISIBLE = 9
DARK_BG = (20, 12, 40)        # the screen tints dark during a blackout
PH_LOOK, PH_HORIZON = 60, 16


class PhantomGame:
    """Dodge falling blocks that blink invisible. Observation = rendered frame."""

    achievements = [
        ("survive_50", "Blink", 50),
        ("survive_150", "Afterimage", 150),
        ("survive_300", "Sixth Sense", 300),
        ("survive_600", "Echolocation", 600),
        ("survive_1200", "Mind's Eye", 1200),
    ]

    def __init__(self, seed: int = 0) -> None:
        self.reset(seed)

    def reset(self, seed: int = 0):
        self.rng = Mulberry32(seed)
        self.px = (W - PH_PW) // 2
        self.blocks: list[list[int]] = []
        self.steps = 0
        self.score = 0
        self.done = False
        self.unlocked: set[str] = set()
        self._since_spawn = PH_SPAWN_GAP
        return self.render_array()

    def _visible(self) -> bool:
        return (self.steps % PH_BLINK_PERIOD) < PH_VISIBLE

    def step(self, action: str):
        if self.done:
            return self.render_array()
        self.steps += 1
        if action == "left":
            self.px = max(0, self.px - PH_PSPEED)
        elif action == "right":
            self.px = min(W - PH_PW, self.px + PH_PSPEED)
        self._since_spawn += PH_FALL
        if self._since_spawn >= PH_SPAWN_GAP:
            self._since_spawn = 0
            x = self.rng.randrange(W - PH_BW + 1)
            self.blocks.append([x, -PH_BH])
        for blk in self.blocks:
            blk[1] += PH_FALL
        self.blocks = [b for b in self.blocks if b[1] < H]
        hit = any(bx < self.px + PH_PW and bx + PH_BW > self.px and
                  by < PH_PLAYER_Y + PH_PH and by + PH_BH > PH_PLAYER_Y
                  for bx, by in self.blocks)
        if hit:
            self.done = True
        else:
            self.score += 1
            for aid, _name, thresh in self.achievements:
                if self.score >= thresh:
                    self.unlocked.add(aid)
        return self.render_array()

    def render_array(self) -> np.ndarray:
        frame = np.empty((H, W, 3), dtype=np.uint8)
        if self._visible():
            frame[:, :] = BG
            for bx, by in self.blocks:
                y0, y1 = max(0, by), min(H, by + PH_BH)
                x0, x1 = max(0, bx), min(W, bx + PH_BW)
                if y1 > y0 and x1 > x0:
                    frame[y0:y1, x0:x1] = HAZARD_RGB
        else:
            frame[:, :] = DARK_BG   # blackout: blocks omitted, screen tinted
        frame[PH_PLAYER_Y:PH_PLAYER_Y + PH_PH, self.px:self.px + PH_PW] = PLAYER_RGB
        return frame

    def render_png(self, scale: int = 3) -> bytes:
        img = Image.fromarray(self.render_array(), "RGB")
        if scale != 1:
            img = img.resize((W * scale, H * scale), Image.NEAREST)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()


class PhantomCVAgent:
    """Plays PhantomGame from pixels WITH MEMORY: while the screen is lit it reads
    the blocks; when it darkens it extrapolates the remembered blocks (they keep
    falling) and dodges against that recalled world."""

    name = "cv-phantom"

    def __init__(self) -> None:
        self.last_reasoning = ""
        self.memory: list[list[int]] = []
        self.detected_player = None
        self.detected_items: list[dict] = []
        self.target_x = None

    def reset(self) -> None:
        self.memory = []

    def _greedy(self, px, blocks):
        band_top = PH_PLAYER_Y - PH_LOOK
        occ = bytearray(W)
        for bx, by in blocks:
            if by + PH_BH > band_top and by < PH_PLAYER_Y + PH_PH:
                for c in range(max(0, bx), min(W, bx + PH_BW)):
                    occ[c] = 1
        if not any(occ):
            center = (W - PH_PW) // 2
            self.target_x = center
            return "left" if px > center + 4 else "right" if px < center - 4 else "stay"
        max_x = W - PH_PW
        safe = [x for x in range(max_x + 1) if not any(occ[x:x + PH_PW])]
        target = (min(safe, key=lambda x: abs(x - px)) if safe
                  else min(range(max_x + 1), key=lambda x: sum(occ[x:x + PH_PW])))
        self.target_x = int(target)
        return "left" if target < px - 1 else "right" if target > px + 1 else "stay"

    def _rollout(self, px, blocks, first):
        def advance(p, blks, action):
            if action == "left":
                p = max(0, p - PH_PSPEED)
            elif action == "right":
                p = min(W - PH_PW, p + PH_PSPEED)
            blks = [[bx, by + PH_FALL] for bx, by in blks if by + PH_FALL < H]
            for bx, by in blks:
                if bx < p + PH_PW and bx + PH_BW > p and by < PH_PLAYER_Y + PH_PH and by + PH_BH > PH_PLAYER_Y:
                    return p, blks, True
            return p, blks, False
        blks = [[bx, by] for bx, by in blocks]
        p, blks, dead = advance(px, blks, first)
        if dead:
            return 0
        survived = 1
        for _ in range(PH_HORIZON - 1):
            a = self._greedy(p, blks)
            p, blks, dead = advance(p, blks, a)
            if dead:
                break
            survived += 1
        return survived

    def act(self, frame: np.ndarray):
        r = frame[:, :, 0].astype(int)
        g = frame[:, :, 1].astype(int)
        b = frame[:, :, 2].astype(int)
        green = (g > 150) & (r < 130) & (b < 160)
        red = (r > 170) & (g < 140) & (b < 140)
        gcols = np.where(green.any(axis=0))[0]
        self.detected_player = [int(gcols.min()), int(gcols.max())] if gcols.size else None
        dark = int(frame[2, 2, 2]) > 30   # blue channel high -> DARK_BG -> blackout

        if dark:
            for m in self.memory:
                m[1] += PH_FALL
            self.memory = [m for m in self.memory if m[1] < H]
        else:
            # refresh memory from sight — connected-component blobs so two
            # vertically-stacked blocks are tracked separately (not merged).
            self.memory = [[bx[0], bx[1]] for bx in _blobs(red)]

        # overlay shows the remembered blocks (so you watch it track through the dark)
        self.detected_items = [{"box": [m[0], m[1], m[0] + PH_BW - 1, m[1] + PH_BH - 1], "kind": "hazard"}
                               for m in self.memory]
        if self.detected_player is None:
            self.last_reasoning = "searching"
            return "stay"
        px = self.detected_player[0]
        blocks = [(m[0], m[1]) for m in self.memory]
        results = [(self._rollout(px, blocks, a), a) for a in ("left", "stay", "right")]
        best = max(v for v, _ in results)
        greedy = self._greedy(px, blocks)
        winners = [a for v, a in results if v == best]
        choice = greedy if greedy in winners else winners[0]
        self.last_reasoning = (f"DARK · recall {len(blocks)} → {choice}" if dark
                               else f"see {len(blocks)} → {choice}")
        return choice


def play_phantom(seed: int = 1, agent: Optional[object] = None, max_steps: int = 2000):
    game = PhantomGame(seed)
    agent = agent or PhantomCVAgent()
    frame = game.render_array()
    actions = []
    while not game.done and len(actions) < max_steps:
        a = agent.act(frame)
        actions.append(a)
        frame = game.step(a)
    return game.score, sorted(game.unlocked), actions


# ======================================================================== #
# Rally — an 8th pixel game, the ADVERSARIAL modality (Pong): the agent reads
# the ball + its paddle, infers the ball's motion across frames, and returns an
# attacking opponent's shots. Shares logic + RNG with arcade/rally.
# ======================================================================== #

R_PADW, R_PADH = 4, 26
R_AGENT_X = 4
R_OPP_X = W - 4 - R_PADW
R_PSPEED = 6
R_OPP_SPEED = 7
R_BS = 6
R_BASE, R_MAX = 4, 8
R_SERVE_VY = [-2, -1, 1, 2]
R_OPP_ORANGE = (251, 146, 60)


class RallyGame:
    """Pong vs a built-in attacking opponent. Observation = rendered frame."""

    achievements = [
        ("rally_5", "Warm-up", 5),
        ("rally_15", "Rally", 15),
        ("rally_30", "Backboard", 30),
        ("rally_60", "Iron Wall", 60),
        ("rally_120", "Untouchable", 120),
    ]

    def __init__(self, seed: int = 0) -> None:
        self.reset(seed)

    def _serve(self):
        self.bx = W // 2
        self.by = H // 2
        self.speed = R_BASE
        self.vx = -R_BASE
        self.vy = R_SERVE_VY[self.rng.randrange(len(R_SERVE_VY))]

    def reset(self, seed: int = 0):
        self.rng = Mulberry32(seed)
        self.ay = (H - R_PADH) // 2
        self.oy = (H - R_PADH) // 2
        self.points = 0
        self.score = 0
        self.done = False
        self.unlocked: set[str] = set()
        self._serve()
        return self.render_array()

    def step(self, action: str):
        if self.done:
            return self.render_array()
        if action == "up":
            self.ay = max(0, self.ay - R_PSPEED)
        elif action == "down":
            self.ay = min(H - R_PADH, self.ay + R_PSPEED)
        ball_cy = self.by + R_BS // 2
        opp_cy = self.oy + R_PADH // 2
        if ball_cy < opp_cy - 1:
            self.oy = max(0, self.oy - R_OPP_SPEED)
        elif ball_cy > opp_cy + 1:
            self.oy = min(H - R_PADH, self.oy + R_OPP_SPEED)
        self.bx += self.vx
        self.by += self.vy
        if self.by <= 0:
            self.by = 0
            self.vy = -self.vy
        elif self.by >= H - R_BS:
            self.by = H - R_BS
            self.vy = -self.vy
        if self.vx < 0 and self.bx <= R_AGENT_X + R_PADW and self.bx > R_AGENT_X - self.speed:
            if self.by + R_BS > self.ay and self.by < self.ay + R_PADH:
                self.bx = R_AGENT_X + R_PADW
                self.speed = min(R_MAX, self.speed + 1)
                self.vx = self.speed
                off = (self.by + R_BS // 2) - (self.ay + R_PADH // 2)
                self.vy = max(-7, min(7, off // 2))
                self.points += 1
                for aid, _name, thresh in self.achievements:
                    if self.points >= thresh:
                        self.unlocked.add(aid)
        elif self.vx > 0 and self.bx + R_BS >= R_OPP_X and self.bx + R_BS < R_OPP_X + R_PADW + self.speed:
            self.bx = R_OPP_X - R_BS
            self.speed = min(R_MAX, self.speed + 1)
            self.vx = -self.speed
            agent_cy = self.ay + R_PADH // 2
            self.vy = (self.speed - 2) if agent_cy < H // 2 else -(self.speed - 2)
        if self.bx + R_BS < 0:
            self.done = True
        elif self.bx > W:
            self._serve()
        self.score = self.points
        return self.render_array()

    def render_array(self) -> np.ndarray:
        frame = np.empty((H, W, 3), dtype=np.uint8)
        frame[:, :] = BG
        frame[self.ay:self.ay + R_PADH, R_AGENT_X:R_AGENT_X + R_PADW] = PLAYER_RGB
        frame[self.oy:self.oy + R_PADH, R_OPP_X:R_OPP_X + R_PADW] = R_OPP_ORANGE
        y0, y1 = max(0, self.by), min(H, self.by + R_BS)
        x0, x1 = max(0, self.bx), min(W, self.bx + R_BS)
        if y1 > y0 and x1 > x0:
            frame[y0:y1, x0:x1] = BALL_WHITE
        return frame

    def render_png(self, scale: int = 3) -> bytes:
        img = Image.fromarray(self.render_array(), "RGB")
        if scale != 1:
            img = img.resize((W * scale, H * scale), Image.NEAREST)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()


class RallyCVAgent:
    """Plays RallyGame from pixels: find its paddle (green) + the ball (white),
    infer the ball's velocity across frames, and move to intercept the return."""

    name = "cv-rally"

    def __init__(self) -> None:
        self.last_reasoning = ""
        self.prev = None
        self.detected_player = None
        self.detected_items: list[dict] = []
        self.target_x = None

    def reset(self) -> None:
        self.prev = None

    def act(self, frame: np.ndarray):
        r = frame[:, :, 0].astype(int)
        g = frame[:, :, 1].astype(int)
        b = frame[:, :, 2].astype(int)
        green = (g > 150) & (r < 130) & (b < 160)
        white = (r > 200) & (g > 200) & (b > 200)
        orange = (r > 220) & (g > 110) & (g < 180) & (b < 110)
        grows = np.where(green.any(axis=1))[0]
        ay = int(grows.min()) if grows.size else self.ay if hasattr(self, "ay") else (H - R_PADH) // 2
        self.ay = ay
        wrows = np.where(white.any(axis=1))[0]
        wcols = np.where(white.any(axis=0))[0]
        self.detected_items = []
        if grows.size:
            gcols = np.where(green.any(axis=0))[0]
            self.detected_items.append({"box": [int(gcols.min()), ay, int(gcols.max()), int(grows.max())], "kind": "player"})
        orows = np.where(orange.any(axis=1))[0]
        if orows.size:
            ocols = np.where(orange.any(axis=0))[0]
            self.detected_items.append({"box": [int(ocols.min()), int(orows.min()), int(ocols.max()), int(orows.max())], "kind": "bad"})
        if not (wrows.size and wcols.size):
            self.last_reasoning = "no ball"
            return "stay"
        bx0, by0 = int(wcols.min()), int(wrows.min())
        self.detected_items.append({"box": [bx0, by0, int(wcols.max()), int(wrows.max())], "kind": "ball"})
        if self.prev is None:
            self.prev = (bx0, by0)
            self.last_reasoning = "reading motion…"
            return "stay"
        vx = bx0 - self.prev[0]
        vy = by0 - self.prev[1]
        self.prev = (bx0, by0)
        if vx < 0:  # ball coming toward the agent — predict where it crosses the paddle
            sx, sy, svy = bx0, by0, vy if vy != 0 else 1
            ty = sy
            for _ in range(400):
                sx += vx
                sy += svy
                if sy <= 0:
                    sy = 0
                    svy = -svy
                elif sy >= H - R_BS:
                    sy = H - R_BS
                    svy = -svy
                if sx <= R_AGENT_X + R_PADW:
                    ty = sy
                    break
            target_cy = ty + R_BS // 2
            self.last_reasoning = f"v=({vx},{vy}) intercept @y{int(target_cy)}"
        else:
            target_cy = H // 2
            self.last_reasoning = "recenter"
        desired = max(0, min(H - R_PADH, target_cy - R_PADH // 2))
        if desired < ay - 1:
            return "up"
        if desired > ay + 1:
            return "down"
        return "stay"


def play_rally(seed: int = 1, agent: Optional[object] = None, max_steps: int = 6000):
    game = RallyGame(seed)
    agent = agent or RallyCVAgent()
    frame = game.render_array()
    actions = []
    while not game.done and len(actions) < max_steps:
        a = agent.act(frame)
        actions.append(a)
        frame = game.step(a)
    return game.points, sorted(game.unlocked), actions


# ======================================================================== #
# Rally DUEL — two vision agents on ONE rendered board, head-to-head. Both read
# the SAME frame and drive their own paddle; the competition thesis made literal.
# A /native showcase (not a single scored run).
# ======================================================================== #


R_DUEL_MAX = 18   # the duel's ball gets fast enough that reachability breaks -> points


class RallyDuel:
    """Two-paddle Pong where BOTH paddles are externally controlled."""

    def __init__(self, seed: int = 0) -> None:
        self.reset(seed)

    def _serve(self, toward_left: bool = True):
        self.bx = W // 2
        self.by = H // 2
        self.speed = R_BASE
        self.vx = -R_BASE if toward_left else R_BASE
        self.vy = R_SERVE_VY[self.rng.randrange(len(R_SERVE_VY))]

    def reset(self, seed: int = 0):
        self.rng = Mulberry32(seed)
        self.ay = (H - R_PADH) // 2
        self.oy = (H - R_PADH) // 2
        self.left_score = 0
        self.right_score = 0
        self.done = False
        self._serve(True)
        return self.render_array()

    def step(self, left_action: str, right_action: str):
        if left_action == "up":
            self.ay = max(0, self.ay - R_PSPEED)
        elif left_action == "down":
            self.ay = min(H - R_PADH, self.ay + R_PSPEED)
        if right_action == "up":
            self.oy = max(0, self.oy - R_PSPEED)
        elif right_action == "down":
            self.oy = min(H - R_PADH, self.oy + R_PSPEED)
        self.bx += self.vx
        self.by += self.vy
        if self.by <= 0:
            self.by = 0
            self.vy = -self.vy
        elif self.by >= H - R_BS:
            self.by = H - R_BS
            self.vy = -self.vy
        if self.vx < 0 and self.bx <= R_AGENT_X + R_PADW and self.bx > R_AGENT_X - self.speed:
            if self.by + R_BS > self.ay and self.by < self.ay + R_PADH:
                self.bx = R_AGENT_X + R_PADW
                self.speed = min(R_DUEL_MAX, self.speed + 1)
                self.vx = self.speed
                self.vy = max(-7, min(7, ((self.by + R_BS // 2) - (self.ay + R_PADH // 2)) // 2))
        elif self.vx > 0 and self.bx + R_BS >= R_OPP_X and self.bx + R_BS < R_OPP_X + R_PADW + self.speed:
            if self.by + R_BS > self.oy and self.by < self.oy + R_PADH:
                self.bx = R_OPP_X - R_BS
                self.speed = min(R_DUEL_MAX, self.speed + 1)
                self.vx = -self.speed
                self.vy = max(-7, min(7, ((self.by + R_BS // 2) - (self.oy + R_PADH // 2)) // 2))
        if self.bx + R_BS < 0:
            self.right_score += 1
            self._serve(False)   # serve toward the loser's opponent
        elif self.bx > W:
            self.left_score += 1
            self._serve(True)
        return self.render_array()

    def render_array(self) -> np.ndarray:
        frame = np.empty((H, W, 3), dtype=np.uint8)
        frame[:, :] = BG
        frame[self.ay:self.ay + R_PADH, R_AGENT_X:R_AGENT_X + R_PADW] = PLAYER_RGB
        frame[self.oy:self.oy + R_PADH, R_OPP_X:R_OPP_X + R_PADW] = R_OPP_ORANGE
        y0, y1 = max(0, self.by), min(H, self.by + R_BS)
        x0, x1 = max(0, self.bx), min(W, self.bx + R_BS)
        if y1 > y0 and x1 > x0:
            frame[y0:y1, x0:x1] = BALL_WHITE
        return frame

    def render_png(self, scale: int = 3) -> bytes:
        img = Image.fromarray(self.render_array(), "RGB")
        if scale != 1:
            img = img.resize((W * scale, H * scale), Image.NEAREST)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()


class RallyCVAgentRight:
    """Mirror of RallyCVAgent for the RIGHT paddle: reads the orange paddle +
    white ball from pixels, infers motion, intercepts balls heading right."""

    name = "cv-rally-right"

    def __init__(self) -> None:
        self.prev = None
        self.last_reasoning = ""

    def reset(self) -> None:
        self.prev = None

    def act(self, frame: np.ndarray):
        r = frame[:, :, 0].astype(int)
        g = frame[:, :, 1].astype(int)
        b = frame[:, :, 2].astype(int)
        orange = (r > 220) & (g > 110) & (g < 180) & (b < 110)
        white = (r > 200) & (g > 200) & (b > 200)
        orows = np.where(orange.any(axis=1))[0]
        oy = int(orows.min()) if orows.size else (H - R_PADH) // 2
        wrows = np.where(white.any(axis=1))[0]
        wcols = np.where(white.any(axis=0))[0]
        if not (wrows.size and wcols.size):
            return "stay"
        bx0, by0 = int(wcols.min()), int(wrows.min())
        if self.prev is None:
            self.prev = (bx0, by0)
            return "stay"
        vx = bx0 - self.prev[0]
        vy = by0 - self.prev[1]
        self.prev = (bx0, by0)
        if vx > 0:  # ball heading right toward this paddle — predict + intercept
            sx, sy, svy = bx0, by0, vy if vy != 0 else 1
            ty = sy
            for _ in range(400):
                sx += vx
                sy += svy
                if sy <= 0:
                    sy = 0
                    svy = -svy
                elif sy >= H - R_BS:
                    sy = H - R_BS
                    svy = -svy
                if sx + R_BS >= R_OPP_X:
                    ty = sy
                    break
            target_cy = ty + R_BS // 2
        else:
            target_cy = H // 2
        desired = max(0, min(H - R_PADH, target_cy - R_PADH // 2))
        if desired < oy - 1:
            return "up"
        if desired > oy + 1:
            return "down"
        return "stay"


def play(seed: int = 1, agent: Optional[object] = None, max_steps: int = 2000):
    game = PixelDodger(seed)
    agent = agent or CVAgent()
    frame = game.render_array()
    actions = []
    while not game.done and game.score < max_steps:
        a = agent.act(frame)
        actions.append(a)
        frame = game.step(a)
    return game.score, sorted(game.unlocked), actions


def play_catcher(seed: int = 1, agent: Optional[object] = None, max_steps: int = 2000):
    game = CatcherGame(seed)
    agent = agent or CatcherCVAgent()
    frame = game.render_array()
    actions = []
    while not game.done and len(actions) < max_steps:
        a = agent.act(frame)
        actions.append(a)
        frame = game.step(a)
    return game.caught, sorted(game.unlocked), actions


if __name__ == "__main__":
    for s in range(1, 6):
        sc, unl, _ = play(s)
        print(f"seed {s}: CV agent survived {sc} ticks, unlocked {len(unl)}/5 {unl}")
    # random baseline
    class R:
        def act(self, f):
            return random.choice(ACTIONS)
    for s in range(1, 3):
        sc, unl, _ = play(s, R())
        print(f"seed {s}: random survived {sc} ticks, unlocked {len(unl)}/5")
