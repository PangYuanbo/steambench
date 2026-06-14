#!/usr/bin/env python3
"""Watch an agent play a *real-style* game through the gamepad action space.

This runs the whole real-game platform end-to-end **without a cloud or a real
game**, using :class:`MockGameSession` — which renders a frame visualizing the
live controller and fires achievements on a schedule. It's the tangible proof
that the GeForce NOW path works: an agent emits controller frames, the env turns
unlocked achievements into information-theoretic points, and ``run_episode``
records a fully-auditable trace.

To go live, swap ``MockGameSession`` for ``runtime.geforce_now.GeForceNowSession``
pointed at a streamed Steam game — the agent and everything below it are unchanged.

    python runtime/realgame_demo.py                 # scripted pad (no deps)
    python runtime/realgame_demo.py --agent vision   # vision agent (needs OPENAI_API_KEY)
    python runtime/realgame_demo.py --frames out/     # also dump the rendered frames

Run with the repo root + harness importable, e.g.::

    PYTHONPATH=harness:. ./engine/.venv/bin/python runtime/realgame_demo.py
"""

from __future__ import annotations

import argparse
import base64
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for p in (ROOT, ROOT / "harness", ROOT / "agents"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from steambench_harness import (  # noqa: E402
    AchievementSpec,
    GamepadAction,
    MockGameSession,
    RealGameEnv,
    run_episode,
)


# A small, illustrative achievement ladder (rarities → points via −log₂).
ACHIEVEMENTS = [
    AchievementSpec("boot", "Boot Up", "Send the first input", 0.90),
    AchievementSpec("move", "On the Move", "Walk and pull a trigger", 0.40),
    AchievementSpec("combo", "Combo Master", "Chain a button + stick combo", 0.12),
    AchievementSpec("boss", "Boss Down", "Reach and beat the boss", 0.03),
    AchievementSpec("clear", "100%", "Finish the game", 0.006),
]


def build_agent(kind: str):
    from gamepad_agents import RandomGamepadAgent, ScriptedGamepadAgent, VisionGamepadAgent

    if kind == "vision":
        return VisionGamepadAgent(goal="Explore, fight, and unlock achievements.")
    if kind == "random":
        return RandomGamepadAgent(seed=7)
    # default: a deterministic scripted controller program
    return ScriptedGamepadAgent([
        (3, GamepadAction.press("A")),                       # boot: tap A
        (6, {"lx": 1.0, "rt": 0.8}),                         # move: walk right + trigger
        (6, {"buttons": ["B"], "lx": -1.0, "ry": 0.5}),      # combo: button + sticks
        (40, "DPAD_UP"),                                     # press on to the end
    ])


def main() -> None:
    ap = argparse.ArgumentParser(description="Real-game (GeForce NOW) gamepad demo")
    ap.add_argument("--agent", default="scripted", choices=["scripted", "random", "vision"])
    ap.add_argument("--steps", type=int, default=24)
    ap.add_argument("--frames", default="", help="dir to dump rendered frames (optional)")
    args = ap.parse_args()

    session = MockGameSession(
        appid=620, total_steps=args.steps,
        unlock_schedule={1: "boot", 9: "move", 15: "combo",
                         max(20, args.steps - 3): "boss", args.steps: "clear"},
    )
    env = RealGameEnv(session, name="Demo Quest (mock GeForce NOW)",
                      achievements=ACHIEVEMENTS, env_id="steam/620")
    agent = build_agent(args.agent)

    print(f"▶ {env.name}  |  agent={args.agent}  verify={env.verify_mode.value}")
    print(f"  controls: gamepad ({len(env.action_space.buttons)} buttons + 2 sticks + 2 triggers)\n")

    seen: set[str] = set()
    frames_dir = Path(args.frames) if args.frames else None
    if frames_dir:
        frames_dir.mkdir(parents=True, exist_ok=True)

    def on_step(obs, action_token):
        nonlocal seen
        pad = env.action_space.parse(action_token)
        newly = set(obs.state.get("unlocked", [])) - seen
        seen = set(obs.state.get("unlocked", []))
        reason = getattr(agent, "last_reasoning", "")
        flag = f"  ✦ UNLOCKED {sorted(newly)}" if newly else ""
        print(f"  f{obs.step:>3} | pad: {str(pad):<34} | {reason}{flag}")
        if frames_dir and obs.frame:
            (frames_dir / f"f{obs.step:04d}.png").write_bytes(base64.b64decode(obs.frame))

    rec = run_episode(env, agent, seed=7, max_steps=args.steps + 5,
                      agent_id=f"{args.agent}-pad", record_frames=bool(frames_dir),
                      on_step=on_step)

    print("\n── result ───────────────────────────────")
    print(f"  steps        : {rec.num_steps}")
    print(f"  achievements : {len(rec.unlocked)}/{len(ACHIEVEMENTS)}  {rec.unlocked}")
    print(f"  score (pts)  : {rec.final_score:.1f}")
    print(f"  verify_mode  : {rec.verify_mode}  (real games confirmed via Steam Web API)")
    if frames_dir:
        print(f"  frames       : wrote {len(rec.frames)} PNGs to {frames_dir}/")
    print("\nSwap MockGameSession → GeForceNowSession to play a real streamed Steam game.")


if __name__ == "__main__":
    main()
