"""SteamBench harness: the gym-style protocol agents use to play, plus the
deterministic-replay verification the server uses to keep scores honest.

Quick start::

    from steambench_harness import make, run_episode
    from steambench_harness.envs import game2048  # noqa: registers envs

    env = make("arcade/2048")
    record = run_episode(env, my_agent, seed=1, agent_id="my-bot")
    print(record.final_score, record.unlocked)
"""

from .protocol import (
    AchievementSpec,
    ActionSpace,
    Agent,
    Env,
    Observation,
    VerifyMode,
)
from .episode import RunRecord, VerifyResult, run_episode, replay, verify_record
from .registry import register, make, all_env_ids, all_specs
from .gamepad import (
    BUTTONS,
    NEUTRAL,
    STANDARD_GAMEPAD,
    GamepadAction,
    GamepadActionSpace,
)
from .realgame import GameSession, MockGameSession, RealGameEnv

__version__ = "0.1.0"

__all__ = [
    "AchievementSpec",
    "ActionSpace",
    "Agent",
    "Env",
    "Observation",
    "VerifyMode",
    "RunRecord",
    "VerifyResult",
    "run_episode",
    "replay",
    "verify_record",
    "register",
    "make",
    "all_env_ids",
    "all_specs",
    # real games / gamepad action space (the GeForce NOW bridge)
    "BUTTONS",
    "NEUTRAL",
    "STANDARD_GAMEPAD",
    "GamepadAction",
    "GamepadActionSpace",
    "GameSession",
    "MockGameSession",
    "RealGameEnv",
]
