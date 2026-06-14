#!/usr/bin/env python3
"""A complete, runnable SteamBench agent — from zero to a verified leaderboard run.

This is the canonical "how do I put a bot on the board?" example. It:
  1. defines a tiny agent (replace `act` with your real logic),
  2. plays an arcade env through the harness,
  3. submits the run to the live SteamBench API, which independently
     replay-verifies it before scoring.

Run:
    # from the repo's claude/ directory
    PYTHONPATH=harness:. python examples/example_agent.py

    # against your own deployment / with an API key:
    STEAMBENCH_URL=https://your-app.vercel.app \
    STEAMBENCH_API_KEY=sk_sb_... python examples/example_agent.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Make the harness + agents importable when run from the repo.
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "harness"), str(ROOT)]

from steambench_harness import make, run_episode, verify_record  # noqa: E402
from steambench_harness.envs import game2048, snake  # noqa: E402,F401  (registers envs)
from steambench_harness.client import SteamBenchClient  # noqa: E402


class GreedyTileAgent:
    """A minimal 2048 agent: prefer down/left, fall back to any legal move.

    Replace `act` with search, RL, an LLM — anything. The only contract is:
    given an Observation, return one of `obs.legal_actions`.
    """

    name = "example-greedy"

    def act(self, obs):
        for preferred in ("down", "left", "right", "up"):
            if preferred in obs.legal_actions:
                return preferred
        return obs.legal_actions[0]


def main() -> None:
    env = make("arcade/2048")
    agent = GreedyTileAgent()

    record = run_episode(env, agent, seed=7, agent_id="example-greedy", agent_kind="agent")
    print(f"Played 2048: score={record.final_score:.0f}, "
          f"unlocked={record.unlocked} in {record.num_steps} steps")

    # The same check the server runs: replay the (seed, actions) trace.
    local = verify_record(make("arcade/2048"), record)
    print(f"Local replay verification: {'OK' if local.ok else local.reason}")

    # Submit. With an API key the run is attributed to your agent; without one
    # it posts under `agent_id`. Either way the server re-verifies before scoring.
    client = SteamBenchClient(api_key=os.environ.get("STEAMBENCH_API_KEY"))
    result = client.submit_run(record)
    if result.ok:
        run = result.body.get("run", {})
        print(f"Submitted ✓ — {run.get('earned_points')} pts, "
              f"mastery {run.get('mastery')}. See {client.base_url}/leaderboard")
    else:
        print(f"Submission rejected ({result.status}): {result.body}")


if __name__ == "__main__":
    main()
