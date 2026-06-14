"""Tests for the gamepad action space + the real-game (GeForce NOW) bridge.

These cover the platform's *real-game* half: the controller action space an
agent emits, and the live env that turns those frames into Steam-verified score.
The arcade half is covered by ``test_envs.py``.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# agents/ and runtime/ live at the repo root (runtime/ isn't a package), so put
# them on sys.path and import their modules directly — same pattern test_envs.py
# uses for the pixel-runtime parity tests.
_ROOT = Path(__file__).resolve().parents[2]
for _p in (_ROOT / "runtime", _ROOT / "agents"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from steambench_harness import (
    AchievementSpec,
    GamepadAction,
    GamepadActionSpace,
    MockGameSession,
    RealGameEnv,
    STANDARD_GAMEPAD,
    run_episode,
)
from steambench_harness.gamepad import NEUTRAL
from steambench_harness.rng import Mulberry32


# ---------------------------------------------------------------- gamepad core


def test_gamepad_action_helpers():
    ga = GamepadAction.press("A", "DPAD_UP", lt=1.0)
    assert ga.held("a") and ga.held("DPAD_UP") and not ga.held("B")
    assert ga.lt == 1.0 and not ga.is_idle()
    assert NEUTRAL.is_idle()
    assert "A" in str(ga)


def test_coerce_clamps_and_aliases():
    s = STANDARD_GAMEPAD
    ga = s.coerce({"buttons": ["a", "menu", "bogus"], "lx": 2.0, "ly": -9.0, "rt": -1.0})
    assert ga.buttons == frozenset({"A", "START"})   # alias menu->START, unknown dropped
    assert ga.lx == 1.0 and ga.ly == -1.0            # clamped into [-1,1]
    assert ga.rt == 0.0                              # clamped into [0,1]


def test_coerce_accepts_many_forms():
    s = STANDARD_GAMEPAD
    assert s.coerce("A b square").buttons == frozenset({"A", "B", "X"})   # free-form + DS alias
    assert s.coerce(["RB", "nope"]).buttons == frozenset({"RB"})          # iterable + drop
    assert s.coerce('{"b":["DPAD_UP"],"ls":[0.5,0.0]}').lx == 0.5         # token
    assert s.coerce(GamepadAction.press("Y")).held("Y")                  # passthrough
    assert s.coerce(42).is_idle()                                         # nonsense -> neutral


def test_token_roundtrip_is_stable():
    s = STANDARD_GAMEPAD
    ga = GamepadAction.press("A", "DPAD_UP", lx=-0.5, rt=0.8)
    token = s.name(ga)
    assert s.parse(token) == s.coerce(ga)
    # identical controller states must serialize identically (diff-able trace)
    assert s.name(GamepadAction.press("DPAD_UP", "A", lx=-0.5, rt=0.8)) == token


def test_disabled_axes_are_zeroed():
    s = GamepadActionSpace(right_stick=False, triggers=False)
    ga = s.coerce({"rx": 1.0, "ry": 1.0, "lt": 1.0, "rt": 1.0, "lx": 0.5})
    assert ga.rx == 0.0 and ga.ry == 0.0 and ga.lt == 0.0 and ga.rt == 0.0
    assert ga.lx == 0.5   # left stick still allowed


def test_sample_is_deterministic_and_valid():
    s = STANDARD_GAMEPAD
    a = [s.sample(Mulberry32(7)) for _ in range(1)][0]
    b = s.sample(Mulberry32(7))
    assert a == b                                   # same seed -> same frame
    assert s.coerce(a) == a                         # samples are already valid
    assert s.sample(Mulberry32(1)) != s.sample(Mulberry32(2))


def test_describe_and_spec():
    s = STANDARD_GAMEPAD
    assert "gamepad" == s.spec()["kind"]
    assert "lx" in s.spec()["axes"] and "rt" in s.spec()["axes"]
    assert "controller" in s.describe().lower()


# ----------------------------------------------------------- real-game bridge


def _demo_env(total_steps=30):
    achs = [
        AchievementSpec("ach_start", "First Input", "Press any button", 0.8),
        AchievementSpec("ach_mid", "Halfway", "Reach the midpoint", 0.2),
        AchievementSpec("ach_end", "Finale", "Reach the end", 0.02),
    ]
    session = MockGameSession(
        appid=620, total_steps=total_steps,
        unlock_schedule={1: "ach_start", 10: "ach_mid", total_steps: "ach_end"},
    )
    return RealGameEnv(session, name="Demo", achievements=achs, env_id="steam/620"), achs


def test_real_game_runs_through_run_episode():
    from gamepad_agents import ScriptedGamepadAgent

    env, _ = _demo_env(total_steps=30)
    agent = ScriptedGamepadAgent([(5, GamepadAction.press("A")),
                                  (5, {"lx": 1.0, "rt": 1.0}),
                                  (100, "DPAD_UP")])
    rec = run_episode(env, agent, seed=3, max_steps=60, record_frames=True)

    assert rec.verify_mode == "steam_api"                       # not replay
    assert rec.num_steps == 30                                  # session signalled done
    assert set(rec.unlocked) == {"ach_start", "ach_mid", "ach_end"}
    assert rec.final_score > 0
    assert rec.actions and rec.actions[0].startswith("{")       # trace is gamepad tokens
    assert len(rec.frames) >= 1                                 # frames captured for stream


def test_real_game_score_is_information_theoretic():
    """Rarer achievement -> strictly more points (same bits scale as arcade)."""
    env, _ = _demo_env(total_steps=10)
    agent_done = run_episode(env, _Idle(), seed=1, max_steps=10)
    # ach_end (rarity .02) must be worth more than ach_start (rarity .8)
    from steambench_harness.realgame import _points
    assert _points(0.02) > _points(0.2) > _points(0.8) > 0


def test_real_game_idle_timeout_ends_episode():
    achs = [AchievementSpec("a", "A", "a", 0.5)]
    session = MockGameSession(appid=1, total_steps=0)   # never signals done itself
    env = RealGameEnv(session, name="Idle", achievements=achs, max_idle_frames=3)
    rec = run_episode(env, _Idle(), seed=0, max_steps=100)
    assert rec.num_steps == 3                            # 3 idle frames -> done


def test_real_game_spec_exposes_gamepad_controls():
    env, _ = _demo_env()
    sp = env.spec()
    assert sp["verify_mode"] == "steam_api"
    assert sp["action_space"]["kind"] == "gamepad"
    assert "controls" in sp and "controller" in sp["controls"].lower()
    assert len(sp["achievements"]) == 3


def test_geforce_now_session_degrades_without_backends():
    """The concrete GFN adapter must import + construct + no-op safely when its
    optional backends (vgamepad / steam key) are absent — so the platform is
    complete before the cloud is wired."""
    from geforce_now import GeForceNowSession

    s = GeForceNowSession(appid=620)        # no steam key, no vgamepad here
    s.start()
    s.apply(GamepadAction.press("A"))       # no virtual pad -> safe no-op
    assert s.achievements() == set()        # no key -> empty, no crash
    assert isinstance(s.status(), dict)
    s.close()


def test_geforce_now_selftest_reports_readiness():
    """selftest() must return a structured ✓/✗ report and never crash, even with
    no backends — it's the pre-flight check before wiring GeForce NOW."""
    from geforce_now import GeForceNowSession

    r = GeForceNowSession(appid=620).selftest(capture=False)
    assert set(r) >= {"gamepad", "capture", "steam", "region", "ready"}
    assert r["capture"].get("skipped") is True
    assert r["ready"] is False                       # nothing wired on this box
    assert all("detail" in r[k] for k in ("gamepad", "capture", "steam"))


def test_geforce_now_frame_downscale():
    """frame_size must downscale captured frames (vision models want small PNGs)."""
    pytest.importorskip("PIL")
    import io
    from PIL import Image
    from geforce_now import GeForceNowSession

    s = GeForceNowSession(appid=1, frame_size=(40, 20))
    png = s._encode(Image.new("RGB", (200, 100), (10, 20, 30)))
    assert Image.open(io.BytesIO(png)).size == (40, 20)
    # …and a no-frame_size session preserves the source size.
    s2 = GeForceNowSession(appid=1)
    assert Image.open(io.BytesIO(s2._encode(Image.new("RGB", (64, 48))))).size == (64, 48)


class _Idle:
    def reset(self):
        pass

    def act(self, obs):
        return NEUTRAL


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
