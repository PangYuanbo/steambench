#!/usr/bin/env python3
"""Run the LLM agent on the arcade games and bake the runs into the seed board.

Adds a real, durable LLM competitor (gpt-4o-mini) to the leaderboard alongside
the search-based agents — the whole point of SteamBench is comparing a raw LLM,
purpose-built search agents, and humans on one ladder. Each run is
replay-verified locally before being added. Requires OPENAI_API_KEY.

    python scripts/add_llm_to_board.py
"""

from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "harness"))
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT))

from steambench_harness import make, run_episode, verify_record  # noqa: E402
from steambench_harness.envs import game2048, snake  # noqa: E402,F401
from steambench.catalog import Achievement, Game  # noqa: E402
from steambench.scoring import score_game  # noqa: E402
from agents import make_agent  # noqa: E402

# (env_id, max_steps, seeds) — bounded so the LLM stays cheap; it won't match the
# search agents, which is exactly the comparison we want to show.
PLAN = [
    ("arcade/2048", 110, [1, 2, 3]),
    ("arcade/snake", 170, [1, 2, 3]),
]
AGENT_ID = "gpt-4o-mini"


def env_to_game(env) -> Game:
    achs = [
        Achievement(apiname=a.id, percent=a.percent_hint(), display_name=a.name, description=a.description)
        for a in env.achievements
    ]
    return Game(appid=env.appid, name=env.name, achievements=achs)


def main() -> None:
    runs_path = ROOT / "data" / "seed" / "runs.json"
    data = json.loads(runs_path.read_text())
    runs = data["runs"]
    # Drop any prior LLM rows so re-running is idempotent.
    runs = [r for r in runs if r.get("agent_id") != AGENT_ID]

    jobs = [(env_id, max_steps, seed) for env_id, max_steps, seeds in PLAN for seed in seeds]

    def play(job):
        env_id, max_steps, seed = job
        game = env_to_game(make(env_id))
        tasks = game.tasks()
        task_by_aid = {t.source_ref: t.task_id for t in tasks}
        env = make(env_id)
        agent = make_agent("llm", env_id=env_id)
        rec = run_episode(env, agent, seed=seed, max_steps=max_steps,
                          agent_id=AGENT_ID, agent_kind="agent")
        if not verify_record(make(env_id), rec).ok:
            return None
        completed = [task_by_aid[a] for a in rec.unlocked if a in task_by_aid]
        gs = score_game(completed, tasks)
        return {
            "env_id": env_id, "appid": env.appid, "game": game.name,
            "agent_id": AGENT_ID, "agent_kind": "agent", "seed": seed,
            "score": rec.final_score, "steps": rec.num_steps,
            "unlocked": rec.unlocked, "earned_points": gs.earned_points,
            "earned_bits": round(gs.earned_bits, 2), "mastery": round(gs.mastery, 4),
            "verified": True,
        }

    # Episodes run concurrently (each is sequential LLM calls); the pool just
    # overlaps the network latency so the whole batch finishes in a few minutes.
    with ThreadPoolExecutor(max_workers=len(jobs)) as ex:
        rows = [r for r in ex.map(play, jobs) if r]
    for r in rows:
        runs.insert(0, r)
        print(f"  ✓ {r['env_id']:<14} seed={r['seed']} score={r['score']:.0f} "
              f"steps={r['steps']} unlocked={len(r['unlocked'])} pts={r['earned_points']}")
    added = len(rows)

    data["runs"] = runs
    runs_path.write_text(json.dumps(data, indent=2))
    print(f"\nAdded {added} {AGENT_ID} runs; runs.json now has {len(runs)} runs.")


if __name__ == "__main__":
    main()
