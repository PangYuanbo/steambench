#!/usr/bin/env python3
"""Run one agent on one arcade env, verify the run, and (optionally) submit it.

Examples:
    python agents/run_demo.py --env arcade/2048 --agent expectimax --seed 1
    python agents/run_demo.py --env arcade/snake --agent bfs --episodes 3
    python agents/run_demo.py --env arcade/2048 --agent llm --max-steps 40
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "harness"))
sys.path.insert(0, str(ROOT))

from steambench_harness import make, run_episode, verify_record  # noqa: E402
from steambench_harness.envs import game2048, snake, sokoban, tetris, minesweeper, flappy, connect4  # noqa: E402,F401  (register)
from agents import make_agent  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", default="arcade/2048")
    ap.add_argument("--agent", default="expectimax")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--episodes", type=int, default=1)
    ap.add_argument("--max-steps", type=int, default=5000)
    ap.add_argument("--render", action="store_true", help="print the final board")
    args = ap.parse_args()

    for ep in range(args.episodes):
        seed = args.seed + ep
        env = make(args.env)
        agent = make_agent(args.agent, env_id=args.env)
        record = run_episode(
            env,
            agent,
            seed=seed,
            max_steps=args.max_steps,
            agent_id=getattr(agent, "name", args.agent),
            agent_kind="agent",
        )
        # Verify by replay on a fresh env (the server does exactly this).
        verifier = make(args.env)
        result = verify_record(verifier, record)

        print(
            f"[{args.env}] agent={record.agent_id} seed={seed} "
            f"score={record.final_score:.0f} steps={record.num_steps} "
            f"unlocked={len(record.unlocked)}/{len(env.achievements)} "
            f"verified={'OK' if result.ok else 'FAIL: ' + result.reason}"
        )
        if record.unlocked:
            print("   achievements:", ", ".join(record.unlocked))
        if args.render:
            print(env.render())


if __name__ == "__main__":
    main()
