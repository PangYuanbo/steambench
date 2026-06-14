#!/usr/bin/env python3
"""Generate cross-language replay fixtures.

Each fixture is a fixed ``(env_id, seed, actions)`` trace and the canonical
``final_score`` / ``unlocked`` the Python env produces. The TypeScript port of
the envs must reproduce these exactly — that's how we guarantee a human's
browser run and an agent's Python run are scored by identical dynamics.
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "harness"))

from steambench_harness import make, run_episode  # noqa: E402
from steambench_harness.envs import game2048, snake, sokoban, tetris, minesweeper, flappy, connect4, dodger, catcher, volley, storm, turret  # noqa: E402,F401

sys.path.insert(0, str(ROOT))
from agents import make_agent  # noqa: E402


class FixedRandomAgent:
    def __init__(self, seed):
        self.rng = random.Random(seed)

    def reset(self):
        pass

    def act(self, obs):
        return self.rng.choice(obs.legal_actions or ["up", "down", "left", "right"])


class RallyOffsetReturner:
    """Returns the ball but deliberately strikes it OFF-CENTRE (odd negative
    offset), exercising Rally's english `off // 2` — the exact path where a TS
    `Math.trunc` would diverge from Python's floor division. A regression guard:
    random agents die on the serve and never hit this, so the cross-language
    fixture must include a returner that does."""

    def reset(self):
        pass

    def act(self, obs):
        s = obs.state
        H, PADH, BS = s["height"], s["paddle_h"], s["ball_size"]
        ax, pw, ay = s["agent_x"], s["paddle_w"], s["agent_y"]
        bx, by, vx, vy = s["ball_x"], s["ball_y"], s["ball_vx"], s["ball_vy"]
        if vx < 0:
            sx, sy, svy, ty = bx, by, vy, by
            for _ in range(400):
                sx += vx
                sy += svy
                if sy <= 0:
                    sy = 0
                    svy = -svy
                elif sy >= H - BS:
                    sy = H - BS
                    svy = -svy
                if sx <= ax + pw:
                    ty = sy
                    break
            desired = ty - 5   # paddle a touch high -> ball strikes upper paddle -> off ≈ -5 (odd)
        else:
            desired = H // 2 - PADH // 2
        desired = max(0, min(H - PADH, desired))
        return "up" if desired < ay - 1 else "down" if desired > ay + 1 else "stay"


def main() -> None:
    fixtures = []
    plans = [
        # (env_id, seed, agent_factory) -- mix trivial random traces with a
        # meaty heuristic trace so the TS port is tested on real gameplay.
        ("arcade/2048", 1, lambda: FixedRandomAgent(20)),
        ("arcade/2048", 2, lambda: FixedRandomAgent(37)),
        ("arcade/snake", 1, lambda: make_agent("bfs")),
        ("arcade/snake", 2, lambda: FixedRandomAgent(55)),
        ("arcade/snake", 3, lambda: make_agent("bfs")),
        ("arcade/sokoban", 1, lambda: make_agent("sokoban")),
        ("arcade/sokoban", 2, lambda: FixedRandomAgent(9)),
        ("arcade/tetris", 1, lambda: make_agent("tetris")),
        ("arcade/tetris", 2, lambda: FixedRandomAgent(13)),
        ("arcade/minesweeper", 2, lambda: make_agent("minesweeper")),
        ("arcade/minesweeper", 7, lambda: FixedRandomAgent(3)),
        ("arcade/flappy", 1, lambda: make_agent("flappy")),
        ("arcade/flappy", 4, lambda: FixedRandomAgent(2)),
        ("arcade/connect4", 1, lambda: make_agent("connect4")),
        ("arcade/connect4", 2, lambda: FixedRandomAgent(4)),
        ("arcade/dodger", 1, lambda: make_agent("dodger")),
        ("arcade/dodger", 2, lambda: FixedRandomAgent(8)),
        ("arcade/catcher", 1, lambda: make_agent("catcher")),
        ("arcade/catcher", 2, lambda: FixedRandomAgent(6)),
        ("arcade/volley", 1, lambda: make_agent("volley")),
        ("arcade/volley", 2, lambda: FixedRandomAgent(5)),
        ("arcade/storm", 1, lambda: make_agent("storm")),
        ("arcade/storm", 2, lambda: FixedRandomAgent(7)),
        ("arcade/turret", 1, lambda: make_agent("turret")),
        ("arcade/turret", 2, lambda: FixedRandomAgent(9)),
        ("arcade/forager", 1, lambda: make_agent("forager")),
        ("arcade/forager", 2, lambda: FixedRandomAgent(4)),
        ("arcade/phantom", 1, lambda: make_agent("phantom")),
        ("arcade/phantom", 2, lambda: FixedRandomAgent(3)),
        ("arcade/rally", 1, lambda: make_agent("rally")),
        ("arcade/rally", 2, lambda: FixedRandomAgent(2)),
        ("arcade/rally", 5, lambda: RallyOffsetReturner()),   # exercises off-centre english
    ]
    # Broad cross-language guard: several random-agent traces per env. Random
    # play exercises every env's branches + RNG draw order; the TS port must
    # reproduce each one (this is what keeps replay-verification cheat-proof
    # identical in Python and the browser).
    from steambench_harness import all_env_ids  # noqa: E402
    for env_id in all_env_ids():
        for env_seed in (11, 12, 13):
            plans.append((env_id, env_seed, lambda s=env_seed: FixedRandomAgent(s * 31 + 7)))

    for env_id, env_seed, factory in plans:
            agent = factory()
            rec = run_episode(make(env_id), agent, seed=env_seed, max_steps=500,
                              agent_id="fixture")
            fixtures.append({
                "env_id": env_id,
                "seed": env_seed,
                "actions": rec.actions,
                "expected_score": rec.final_score,
                "expected_unlocked": rec.unlocked,
                "expected_steps": rec.num_steps,
            })
    out = ROOT / "data" / "fixtures"
    out.mkdir(parents=True, exist_ok=True)
    (out / "replay_fixtures.json").write_text(json.dumps({"fixtures": fixtures}, indent=2))
    for f in fixtures:
        print(f"  {f['env_id']:<14} seed={f['seed']} steps={f['expected_steps']:>4} "
              f"score={f['expected_score']:>6.0f} unlocked={len(f['expected_unlocked'])} "
              f"({len(f['actions'])} actions)")
    print(f"\nWrote {out / 'replay_fixtures.json'}")


if __name__ == "__main__":
    main()
