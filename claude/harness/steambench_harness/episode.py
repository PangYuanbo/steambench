"""Episode runner, run records, and replay-verification.

``run_episode`` drives an :class:`Agent` through an :class:`Env` and captures a
:class:`RunRecord` — the exact, replayable story of one attempt. The record is
what gets submitted to the SteamBench backend.

``verify_record`` is the server side: re-run the recorded ``(seed, actions)``
through a fresh env and confirm the claimed ``score``/``unlocked`` match. Because
arcade envs are deterministic, a run can't claim points it didn't earn.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

from .protocol import Agent, Env, Observation, VerifyMode


@dataclass
class RunRecord:
    """A complete, replayable record of one episode."""

    env_id: str
    appid: int
    agent_id: str
    agent_kind: str               #: "human" | "agent"
    seed: int
    actions: list[str]            #: canonical action names, in order
    num_steps: int
    final_score: float
    unlocked: list[str]
    verify_mode: str = VerifyMode.REPLAY.value
    started_at: Optional[float] = None
    ended_at: Optional[float] = None
    # Optional, for the livestream / debugging. Not needed for verification.
    frames: list[str] = field(default_factory=list)
    reasoning: list[str] = field(default_factory=list)
    meta: dict = field(default_factory=dict)

    def as_dict(self, *, include_media: bool = True) -> dict:
        d = {
            "env_id": self.env_id,
            "appid": self.appid,
            "agent_id": self.agent_id,
            "agent_kind": self.agent_kind,
            "seed": self.seed,
            "actions": self.actions,
            "num_steps": self.num_steps,
            "final_score": self.final_score,
            "unlocked": self.unlocked,
            "verify_mode": self.verify_mode,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "meta": self.meta,
        }
        if include_media:
            d["frames"] = self.frames
            d["reasoning"] = self.reasoning
        return d


def run_episode(
    env: Env,
    agent: Agent,
    *,
    seed: int = 0,
    max_steps: int = 10_000,
    agent_id: str = "agent",
    agent_kind: str = "agent",
    record_frames: bool = False,
    on_step: Optional[Callable[[Observation, str], None]] = None,
    clock: Optional[Callable[[], float]] = None,
) -> RunRecord:
    """Play one episode and return its :class:`RunRecord`.

    Args:
        on_step: optional callback ``(observation, action_name)`` invoked every
            step — used by the livestream to push frames/reasoning in real time.
        clock: optional ``() -> float`` time source (injected for testability;
            defaults to wall clock).
    """
    if clock is None:
        import time

        clock = time.time
    if hasattr(agent, "reset"):
        agent.reset()  # type: ignore[attr-defined]

    started = clock()
    obs = env.reset(seed)
    actions: list[str] = []
    frames: list[str] = []
    reasoning: list[str] = []

    if record_frames and obs.frame:
        frames.append(obs.frame)

    while not obs.done and env.steps < max_steps:
        action = agent.act(obs)
        action_name = env.action_space.name(action)
        actions.append(action_name)
        obs = env.step(action_name)

        if record_frames and obs.frame:
            frames.append(obs.frame)
        # Capture LLM reasoning if the agent exposes it (for the stream/debug).
        last = getattr(agent, "last_reasoning", None)
        if last:
            reasoning.append(str(last))
        if on_step is not None:
            on_step(obs, action_name)

    ended = clock()
    return RunRecord(
        env_id=env.env_id,
        appid=env.appid,
        agent_id=agent_id,
        agent_kind=agent_kind,
        seed=seed,
        actions=actions,
        num_steps=env.steps,
        final_score=env.score,
        unlocked=sorted(env.unlocked),
        verify_mode=env.verify_mode.value,
        started_at=started,
        ended_at=ended,
        frames=frames,
        reasoning=reasoning,
    )


@dataclass
class VerifyResult:
    ok: bool
    claimed_score: float
    replay_score: float
    claimed_unlocked: list[str]
    replay_unlocked: list[str]
    reason: str = ""

    def as_dict(self) -> dict:
        return {
            "ok": self.ok,
            "claimed_score": self.claimed_score,
            "replay_score": self.replay_score,
            "claimed_unlocked": self.claimed_unlocked,
            "replay_unlocked": self.replay_unlocked,
            "reason": self.reason,
        }


def replay(env: Env, seed: int, actions: list[str], max_steps: int = 100_000):
    """Re-run a recorded action trace through a fresh env. Returns the env after
    the last applied action so callers can read ``score``/``unlocked``."""
    obs = env.reset(seed)
    for i, action in enumerate(actions):
        if obs.done or i >= max_steps:
            break
        obs = env.step(action)
    return env


def verify_record(env: Env, record: RunRecord, *, tol: float = 1e-6) -> VerifyResult:
    """Server-side verification: replay the trace and compare to claims.

    Only valid for ``VerifyMode.REPLAY`` envs. Real-Steam runs are verified via
    the Steam API elsewhere.
    """
    if env.verify_mode is not VerifyMode.REPLAY:
        return VerifyResult(
            ok=False,
            claimed_score=record.final_score,
            replay_score=0.0,
            claimed_unlocked=record.unlocked,
            replay_unlocked=[],
            reason=f"env {env.env_id} is not replay-verifiable ({env.verify_mode.value})",
        )

    replay(env, record.seed, record.actions)
    replay_score = env.score
    replay_unlocked = sorted(env.unlocked)
    claimed_unlocked = sorted(record.unlocked)

    score_ok = abs(replay_score - record.final_score) <= tol
    ach_ok = replay_unlocked == claimed_unlocked
    # The replayed run must independently justify every claimed achievement.
    ach_subset_ok = set(claimed_unlocked).issubset(set(replay_unlocked))

    ok = score_ok and ach_ok
    reason = ""
    if not score_ok:
        reason = f"score mismatch: claimed {record.final_score}, replay {replay_score}"
    elif not ach_subset_ok:
        reason = "claimed achievements not reproduced by replay"
    elif not ach_ok:
        reason = "achievement set differs from replay"

    return VerifyResult(
        ok=ok,
        claimed_score=record.final_score,
        replay_score=replay_score,
        claimed_unlocked=claimed_unlocked,
        replay_unlocked=replay_unlocked,
        reason=reason,
    )
