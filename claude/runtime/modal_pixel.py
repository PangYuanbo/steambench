"""Modal-hosted pixel game runtime — streams a vision AI playing from pixels.

This is the native-runtime / nitrogen.minedojo half made concrete: real RGB games
run on Modal, a CV agent reads each rendered frame (pixels, not state) and acts,
and the frames + the agent's reasoning + its perception stream to the browser
over SSE. The web `/native` page renders the PNGs and overlays the perception.

Two games prove the runtime generalizes:
  * dodger  — dodge falling blocks (one-class: avoid).
  * catcher — catch green, dodge red (two-class: tell good from bad).

Both share logic + RNG with the harness arcade envs, so a streamed (seed, actions)
trace replay-verifies on the same engine that checks human runs.

Deploy:  modal deploy runtime/modal_pixel.py
"""

from __future__ import annotations

import base64
import json
import time
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parents[1]
image = (
    modal.Image.debian_slim()
    .pip_install("fastapi[standard]", "pillow", "numpy")
    .add_local_file(str(ROOT / "runtime" / "pixel_game.py"), "/pkg/pixel_game.py")
)
app = modal.App("steambench-pixel", image=image)


@app.function(min_containers=0)
@modal.asgi_app()
def web():
    import sys

    if "/pkg" not in sys.path:
        sys.path.insert(0, "/pkg")
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import StreamingResponse
    import pixel_game as pg

    GAMES = {
        "dodger": {
            "game": pg.PixelDodger, "agent": pg.CVAgent, "env_id": "arcade/dodger",
            "pw": pg.PW, "player_y": pg.PLAYER_Y, "player_h": pg.PH, "unit": "ticks",
            "model": "CV vision agent",
        },
        "catcher": {
            "game": pg.CatcherGame, "agent": pg.CatcherCVAgent, "env_id": "arcade/catcher",
            "pw": pg.C_PW, "player_y": pg.PLAYER_Y, "player_h": pg.C_PH, "unit": "catches",
            "model": "CV two-class agent",
        },
        "volley": {
            "game": pg.VolleyGame, "agent": pg.VolleyCVAgent, "env_id": "arcade/volley",
            "pw": pg.V_PW, "player_y": pg.V_PLAYER_Y, "player_h": pg.V_PH, "unit": "bounces",
            "model": "CV temporal agent",
        },
        "storm": {
            "game": pg.StormGame, "agent": pg.StormCVAgent, "env_id": "arcade/storm",
            "pw": pg.S_PW, "player_y": pg.S_PLAYER_Y, "player_h": pg.S_PH, "unit": "ticks",
            "model": "CV multi-object agent",
        },
        "turret": {
            "game": pg.TurretGame, "agent": pg.TurretCVAgent, "env_id": "arcade/turret",
            "pw": pg.T_CW, "player_y": pg.T_CANNON_Y, "player_h": pg.T_CH, "unit": "hits",
            "model": "CV targeting agent",
        },
        "forager": {
            "game": pg.ForagerGame, "agent": pg.ForagerCVAgent, "env_id": "arcade/forager",
            "pw": pg.F_PS, "player_y": pg.H // 2, "player_h": pg.F_PS, "unit": "drops",
            "model": "CV 2D-navigation agent",
        },
        "phantom": {
            "game": pg.PhantomGame, "agent": pg.PhantomCVAgent, "env_id": "arcade/phantom",
            "pw": pg.PH_PW, "player_y": pg.PH_PLAYER_Y, "player_h": pg.PH_PH, "unit": "ticks",
            "model": "CV memory agent",
        },
        "rally": {
            "game": pg.RallyGame, "agent": pg.RallyCVAgent, "env_id": "arcade/rally",
            "pw": pg.R_PADW, "player_y": pg.H // 2, "player_h": pg.R_PADH, "unit": "returns",
            "model": "CV adversarial agent",
        },
    }

    api = FastAPI(title="SteamBench Pixel Runtime")
    api.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    @api.get("/health")
    def health():
        return {"ok": True, "service": "steambench-pixel", "games": list(GAMES), "w": pg.W, "h": pg.H}

    def perception(agent, which: str, pw: int) -> dict:
        if which == "dodger":
            items = [{"box": b, "kind": "hazard"} for b in agent.detected_hazards]
        elif which == "catcher":
            items = [{"box": it["box"], "kind": "good" if it["kind"] == 0 else "bad"}
                     for it in agent.detected_items]
        else:  # volley — detected_items already carry a string kind ("ball")
            items = [{"box": it["box"], "kind": it["kind"]} for it in agent.detected_items]
        return {"player": agent.detected_player, "target": agent.target_x, "pw": pw, "items": items}

    @api.get("/stream")
    def stream(game: str = "dodger", seed: int = 1, max_ticks: int = 900):
        cfg = GAMES.get(game, GAMES["dodger"])

        def gen():
            G = cfg["game"](seed)
            agent = cfg["agent"]()
            frame = G.render_array()
            names = {aid: name for aid, name, _ in cfg["game"].achievements}

            def send(event: str, data: dict) -> str:
                return f"event: {event}\ndata: {json.dumps(data)}\n\n"

            yield send("start", {
                "game": game, "env_id": cfg["env_id"], "seed": seed, "w": pg.W, "h": pg.H,
                "model": cfg["model"], "unit": cfg["unit"],
                "player_y": cfg["player_y"], "player_h": cfg["player_h"], "player_w": cfg["pw"],
                "achievements": [{"id": a, "name": n, "goal": t} for a, n, t in cfg["game"].achievements],
            })
            steps = 0
            while not G.done and steps < max_ticks:
                action = agent.act(frame)  # perception aligns with the current frame
                yield send("frame", {
                    "tick": steps, "action": action, "reasoning": agent.last_reasoning,
                    "frame": base64.b64encode(G.render_png()).decode(),
                    "score": G.score, "unlocked": sorted(G.unlocked),
                    "perception": perception(agent, game, cfg["pw"]),
                })
                frame = G.step(action)
                steps += 1
                time.sleep(0.06)
            yield send("frame", {
                "tick": steps, "action": None, "reasoning": "run over",
                "frame": base64.b64encode(G.render_png()).decode(),
                "score": G.score, "unlocked": sorted(G.unlocked), "perception": None,
            })
            yield send("done", {
                "score": G.score, "unlocked": sorted(G.unlocked),
                "achievements_named": [names[a] for a in sorted(G.unlocked)],
            })

        return StreamingResponse(gen(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache, no-transform"})

    return api
