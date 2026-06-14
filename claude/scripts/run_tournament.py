#!/usr/bin/env python3
"""Run the reference agents across the arcade envs and emit seed leaderboard data.

Produces, under ``data/seed/``:
  * ``arcade_catalog.json`` -- arcade envs expressed as catalog Games (so they
    appear in the browser next to the real Steam games, flagged as playable).
  * ``runs.json``           -- every verified run (drives the live activity feed).
  * ``leaderboard.json``    -- per-agent standings + per-env breakdown.

Deterministic agents only (random/expectimax/bfs) so the data is fast and
reproducible; the LLM agent is showcased live by the stream runner instead.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "harness"))
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT))

from steambench_harness import make, run_episode, verify_record  # noqa: E402
from steambench_harness.envs import game2048, snake, sokoban, tetris, minesweeper, flappy, connect4, dodger, catcher, volley, storm, turret, forager, phantom, rally  # noqa: E402,F401
from steambench.catalog import Achievement, Game  # noqa: E402
from steambench.scoring import PlayerKind, score_game, aggregate_player  # noqa: E402
from agents import make_agent  # noqa: E402

ENVS = ["arcade/2048", "arcade/snake", "arcade/sokoban", "arcade/tetris", "arcade/minesweeper", "arcade/flappy", "arcade/connect4", "arcade/dodger", "arcade/catcher", "arcade/volley", "arcade/storm", "arcade/turret", "arcade/forager", "arcade/phantom", "arcade/rally"]
AGENTS = {
    "arcade/2048": ["random", "expectimax"],
    "arcade/snake": ["random", "bfs", "hamiltonian"],
    "arcade/sokoban": ["random", "sokoban"],
    "arcade/tetris": ["random", "tetris"],
    "arcade/minesweeper": ["random", "minesweeper"],
    "arcade/flappy": ["random", "flappy"],
    "arcade/connect4": ["random", "connect4"],
    "arcade/dodger": ["random", "dodger"],
    "arcade/catcher": ["random", "catcher"],
    "arcade/volley": ["random", "volley"],
    "arcade/storm": ["random", "storm"],
    "arcade/turret": ["random", "turret"],
    "arcade/forager": ["random", "forager"],
    "arcade/phantom": ["random", "phantom"],
    "arcade/rally": ["random", "rally"],
}
# Per-env step cap (the rollout agents would otherwise run to the cap; these
# lengths already let the best agent unlock the whole ladder).
MAX_STEPS = {"arcade/dodger": 1500, "arcade/catcher": 2000, "arcade/volley": 5000, "arcade/storm": 2000, "arcade/turret": 4000, "arcade/forager": 4000, "arcade/phantom": 1500, "arcade/rally": 5000}
SEEDS = list(range(1, 9))


def env_to_game(env) -> Game:
    """Express an arcade env as a catalog Game so engine scoring applies."""
    achs = [
        Achievement(
            apiname=a.id,
            percent=a.percent_hint(),
            display_name=a.name,
            description=a.description,
        )
        for a in env.achievements
    ]
    return Game(appid=env.appid, name=env.name, achievements=achs)


def main() -> None:
    out_dir = ROOT / "data" / "seed"
    out_dir.mkdir(parents=True, exist_ok=True)

    games = {env_id: env_to_game(make(env_id)) for env_id in ENVS}
    all_runs: list[dict] = []
    # best run per (agent, env): max earned_bits
    best: dict[tuple[str, str], dict] = {}

    for env_id in ENVS:
        game = games[env_id]
        tasks = game.tasks()
        task_by_aid = {t.source_ref: t.task_id for t in tasks}
        for agent_name in AGENTS[env_id]:
            for seed in SEEDS:
                env = make(env_id)
                agent = make_agent(agent_name, env_id=env_id)
                rec = run_episode(
                    env, agent, seed=seed, max_steps=MAX_STEPS.get(env_id, 6000),
                    agent_id=f"{agent_name}", agent_kind="agent",
                )
                ver = verify_record(make(env_id), rec)
                completed = [task_by_aid[a] for a in rec.unlocked if a in task_by_aid]
                gs = score_game(completed, tasks)
                run_row = {
                    "env_id": env_id,
                    "appid": env.appid,
                    "game": game.name,
                    "agent_id": agent_name,
                    "agent_kind": "agent",
                    "seed": seed,
                    "score": rec.final_score,
                    "steps": rec.num_steps,
                    "unlocked": rec.unlocked,
                    "earned_points": gs.earned_points,
                    "earned_bits": round(gs.earned_bits, 2),
                    "mastery": round(gs.mastery, 4),
                    "verified": ver.ok,
                }
                all_runs.append(run_row)
                key = (agent_name, env_id)
                if key not in best or gs.earned_bits > best[key]["_bits"]:
                    best[key] = {"_bits": gs.earned_bits, "gs": gs, "run": run_row}
            b = best[(agent_name, env_id)]
            print(
                f"  {env_id:<14} {agent_name:<12} best score={b['run']['score']:>7.0f} "
                f"pts={b['gs'].earned_points:>5} mastery={b['gs'].mastery:.2f} "
                f"unlocked={b['run']['unlocked'] and len(b['run']['unlocked'])}/{len(game.achievements)}"
            )

    # Aggregate per agent across envs (best run per env counts).
    standings = []
    agent_names = sorted({a for v in AGENTS.values() for a in v})
    for agent_name in agent_names:
        per_env_gs = {}
        pop_w = {}
        for env_id in ENVS:
            key = (agent_name, env_id)
            if key in best:
                per_env_gs[games[env_id].appid] = best[key]["gs"]
                pop_w[games[env_id].appid] = 1.2  # arcade games weighted modestly
        if not per_env_gs:
            continue
        st = aggregate_player(agent_name, PlayerKind.AGENT, per_env_gs, pop_w)
        standings.append(st.as_dict())

    standings.sort(key=lambda s: s["weighted_score"], reverse=True)

    arcade_catalog = {
        "version": 1,
        "kind": "arcade",
        "games": [
            {**games[e].as_dict(include_tasks=True),
             "env_id": e,
             "playable": True,
             "verify_mode": make(e).verify_mode.value}
            for e in ENVS
        ],
    }
    (out_dir / "arcade_catalog.json").write_text(json.dumps(arcade_catalog, indent=2))
    (out_dir / "runs.json").write_text(json.dumps({"runs": all_runs}, indent=2))
    (out_dir / "leaderboard.json").write_text(
        json.dumps({"agents": standings, "envs": ENVS, "seeds": SEEDS}, indent=2)
    )

    print(f"\nWrote arcade_catalog.json, runs.json ({len(all_runs)} runs), leaderboard.json")
    print("\nAI leaderboard (by weighted score):")
    for i, s in enumerate(standings, 1):
        print(f"  {i}. {s['player_id']:<12} weighted={s['weighted_score']:>7.1f} "
              f"points={s['total_points']:>5} tasks={s['tasks_completed']}")


if __name__ == "__main__":
    main()
