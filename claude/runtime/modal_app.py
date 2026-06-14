"""SteamBench remote agent runtime, on Modal.

This is the "agents run somewhere and submit scores" half of the benchmark: a
serverless runtime that plays the arcade envs with the reference agents and
POSTs each completed run to the deployed SteamBench API, which independently
replay-verifies and scores it. It demonstrates the full agent path end to end
without any trust in the runner — the server is the source of truth.

Usage:
    modal run runtime/modal_app.py                 # default batch -> live API
    modal run runtime/modal_app.py --api-base https://your-deploy.vercel.app
    modal deploy runtime/modal_app.py              # also installs a daily cron

Run it from the repo's `claude/` directory so the local package dirs resolve.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

import modal

# Local package dirs are added to the image so the runtime imports the exact
# same harness/agents code that's unit-tested locally.
ROOT = Path(__file__).resolve().parents[1]
image = (
    modal.Image.debian_slim(python_version="3.11")
    .add_local_dir(str(ROOT / "harness"), "/pkg/harness")
    .add_local_dir(str(ROOT / "engine"), "/pkg/engine")
    .add_local_dir(str(ROOT / "agents"), "/pkg/agents")
)

app = modal.App("steambench-runtime", image=image)

DEFAULT_API_BASE = "https://web-iota-steel-12.vercel.app"


def _import_harness():
    for p in ("/pkg/harness", "/pkg/engine", "/pkg"):
        if p not in sys.path:
            sys.path.insert(0, p)
    from steambench_harness import make, run_episode, verify_record  # noqa: E402
    from steambench_harness.envs import game2048, snake  # noqa: E402,F401
    from agents import make_agent  # noqa: E402

    return make, run_episode, verify_record, make_agent


@app.function(timeout=900)
def run_and_submit(env_id: str, agent_name: str, seed: int, api_base: str) -> dict:
    """Play one episode on Modal and submit the run to the SteamBench API."""
    make, run_episode, verify_record, make_agent = _import_harness()

    env = make(env_id)
    agent = make_agent(agent_name, env_id=env_id)
    rec = run_episode(
        env, agent, seed=seed, max_steps=6000,
        agent_id=f"modal-{agent_name}", agent_kind="agent",
    )
    # Sanity self-check before we even send it (the server checks again).
    local = verify_record(make(env_id), rec)

    body = {
        "run": {
            "env_id": rec.env_id,
            "appid": rec.appid,
            "agent_id": f"modal-{agent_name}",
            "agent_kind": "agent",
            "seed": rec.seed,
            "actions": rec.actions,
            "num_steps": rec.num_steps,
            "final_score": rec.final_score,
            "unlocked": rec.unlocked,
            "verify_mode": rec.verify_mode,
            "meta": {"runtime": "modal"},
        }
    }
    req = urllib.request.Request(
        f"{api_base.rstrip('/')}/api/runs",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            server = json.loads(resp.read().decode())
        accepted = bool(server.get("ok"))
        points = server.get("run", {}).get("earned_points")
    except Exception as e:  # noqa: BLE001
        accepted, points, server = False, None, {"error": str(e)}

    print(
        f"{env_id} {agent_name} seed={seed} score={rec.final_score:.0f} "
        f"unlocked={len(rec.unlocked)} local_ok={local.ok} "
        f"server_accepted={accepted} pts={points}"
    )
    return {
        "env_id": env_id, "agent": agent_name, "seed": seed,
        "score": rec.final_score, "unlocked": rec.unlocked,
        "local_ok": local.ok, "server_accepted": accepted, "points": points,
    }


# The reference battery: every game's strong agent over a few seeds + a random
# floor per game. This is what the daily cron replays to keep the board fresh.
def _battery(api_base: str):
    strong = {
        "arcade/2048": "expectimax",
        "arcade/snake": "hamiltonian",
        "arcade/sokoban": "sokoban",
        "arcade/tetris": "tetris",
        "arcade/minesweeper": "minesweeper",
        "arcade/flappy": "flappy",
        "arcade/connect4": "connect4",
    }
    jobs = []
    for env_id, agent in strong.items():
        for s in (1, 2):
            jobs.append((env_id, agent, s, api_base))
        jobs.append((env_id, "random", 1, api_base))
    return jobs


@app.local_entrypoint()
def main(api_base: str = DEFAULT_API_BASE):
    jobs = _battery(api_base)
    print(f"Running {len(jobs)} agent episodes on Modal -> {api_base}")
    results = list(run_and_submit.starmap(jobs))
    accepted = sum(1 for r in results if r["server_accepted"])
    print(f"\nDone. {accepted}/{len(results)} runs accepted by the live API.")
    best = max(results, key=lambda r: r["points"] or 0)
    print(f"Best: {best['agent']} on {best['env_id']} — {best['points']} pts")


# Optional: deploy a daily fresh-run cron with `modal deploy runtime/modal_app.py`.
@app.function(schedule=modal.Cron("0 12 * * *"), timeout=1800)
def daily_battery():
    for env_id, agent_name, seed, api in _battery(DEFAULT_API_BASE):
        run_and_submit.local(env_id, agent_name, seed, api)
