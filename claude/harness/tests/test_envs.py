import random

import pytest

from steambench_harness import make, run_episode, verify_record
from steambench_harness.envs import game2048, snake, sokoban, tetris, minesweeper, flappy, connect4, dodger, catcher, volley, storm, turret, forager, phantom, rally  # noqa: F401  (register)
from steambench_harness.envs.game2048 import _slide_left
from steambench_harness.protocol import VerifyMode


class ScriptedAgent:
    """Plays a fixed cyclic action list — fully deterministic, for tests."""

    def __init__(self, actions):
        self.actions = actions
        self.i = 0

    def reset(self):
        self.i = 0

    def act(self, obs):
        a = self.actions[self.i % len(self.actions)]
        self.i += 1
        # fall back to a legal move if the scripted one isn't available
        return a if a in obs.legal_actions else (obs.legal_actions or ["up"])[0]


class SeededRandomAgent:
    def __init__(self, seed):
        self.rng = random.Random(seed)

    def reset(self):
        pass

    def act(self, obs):
        return self.rng.choice(obs.legal_actions or ["up", "down", "left", "right"])


# --------------------------------------------------------------------------- #
# 2048 mechanics
# --------------------------------------------------------------------------- #


def test_slide_merges_once():
    # [2,2,2,2] -> [4,4,0,0], gaining 8.
    out, gained, changed = _slide_left([2, 2, 2, 2])
    assert out == [4, 4, 0, 0]
    assert gained == 8
    assert changed


def test_slide_no_triple_merge():
    out, gained, _ = _slide_left([4, 4, 8, 0])
    assert out == [8, 8, 0, 0]
    assert gained == 8


def test_2048_reset_has_two_tiles():
    env = make("arcade/2048")
    env.reset(0)
    filled = sum(1 for r in env.board for v in r if v)
    assert filled == 2


# --------------------------------------------------------------------------- #
# Snake mechanics
# --------------------------------------------------------------------------- #


def test_snake_dies_on_wall():
    env = make("arcade/snake")
    env.reset(0)
    # Head starts heading right at center; drive straight into the right wall.
    obs = None
    for _ in range(env.spec()["env_id"] and 20):
        obs = env.step("right")
        if obs.done:
            break
    assert obs.done
    assert obs.state["alive"] is False


def test_snake_cannot_reverse_into_self():
    env = make("arcade/snake")
    env.reset(0)
    # Moving right; "left" is the illegal 180 and must be ignored.
    assert "left" not in env.legal_actions()


# --------------------------------------------------------------------------- #
# Determinism + replay verification (the anti-cheat backbone)
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("env_id", ["arcade/2048", "arcade/snake", "arcade/sokoban", "arcade/tetris", "arcade/minesweeper", "arcade/flappy", "arcade/connect4", "arcade/dodger", "arcade/catcher", "arcade/volley", "arcade/storm", "arcade/turret", "arcade/forager", "arcade/phantom", "arcade/rally"])
def test_determinism_same_seed_same_outcome(env_id):
    a1 = SeededRandomAgent(123)
    a2 = SeededRandomAgent(123)
    r1 = run_episode(make(env_id), a1, seed=7, max_steps=500)
    r2 = run_episode(make(env_id), a2, seed=7, max_steps=500)
    assert r1.final_score == r2.final_score
    assert r1.unlocked == r2.unlocked
    assert r1.actions == r2.actions


@pytest.mark.parametrize("env_id", ["arcade/2048", "arcade/snake", "arcade/sokoban", "arcade/tetris", "arcade/minesweeper", "arcade/flappy", "arcade/connect4", "arcade/dodger", "arcade/catcher", "arcade/volley", "arcade/storm", "arcade/turret", "arcade/forager", "arcade/phantom", "arcade/rally"])
def test_replay_verifies_legit_run(env_id):
    agent = SeededRandomAgent(99)
    record = run_episode(make(env_id), agent, seed=3, max_steps=500)
    result = verify_record(make(env_id), record)
    assert result.ok, result.reason
    assert result.replay_score == record.final_score


@pytest.mark.parametrize("env_id", ["arcade/2048", "arcade/snake", "arcade/sokoban", "arcade/tetris", "arcade/minesweeper", "arcade/flappy", "arcade/connect4", "arcade/dodger", "arcade/catcher", "arcade/volley", "arcade/storm", "arcade/turret", "arcade/forager", "arcade/phantom", "arcade/rally"])
def test_replay_catches_inflated_score(env_id):
    agent = SeededRandomAgent(99)
    record = run_episode(make(env_id), agent, seed=3, max_steps=500)
    # A cheater inflates their score and claims a bogus achievement.
    record.final_score += 99999
    record.unlocked = sorted(set(record.unlocked) | {"score_20k", "len_45"} & {a.id for a in make(env_id).achievements})
    result = verify_record(make(env_id), record)
    assert not result.ok


def test_spec_shape():
    env = make("arcade/2048")
    spec = env.spec()
    assert spec["env_id"] == "arcade/2048"
    assert spec["verify_mode"] == VerifyMode.REPLAY.value
    assert len(spec["achievements"]) == len(env.achievements)
    assert "up" in spec["action_space"]


# --------------------------------------------------------------------------- #
# Sokoban mechanics
# --------------------------------------------------------------------------- #


def test_sokoban_solve_advances_level():
    env = make("arcade/sokoban")
    env.reset(0)
    assert env.level_index == 0
    env.step("right")  # level 1 is a single push onto the goal
    assert env.levels_solved == 1
    assert env.score == 100
    assert "solve_1" in env.unlocked
    assert env.level_index == 1  # advanced to the next level


def test_sokoban_restart_resets_level_not_progress():
    env = make("arcade/sokoban")
    env.reset(0)
    env.step("right")  # solve level 1 -> now on level 2
    p0 = tuple(env.player)
    env.step("right")  # a non-solving move within level 2
    assert tuple(env.player) != p0
    env.step("restart")
    assert tuple(env.player) == p0       # level state reset
    assert env.levels_solved == 1        # but solved progress is preserved


# --------------------------------------------------------------------------- #
# Tetris mechanics
# --------------------------------------------------------------------------- #


def test_tetris_spawn_and_hard_drop_locks_piece():
    env = make("arcade/tetris")
    obs = env.reset(0)
    assert obs.state["piece"] in "IOTSZJL"
    before = sum(1 for row in env.board for c in row if c)
    env.step("drop")  # hard-drop locks the 4 minos into the (empty) board
    after = sum(1 for row in env.board for c in row if c)
    assert after == before + 4  # no line possible from one piece on an empty board


def test_tetris_bag_is_deterministic_per_seed():
    # Same seed -> same 7-bag piece order (the determinism the TS port relies on).
    def first_pieces(seed):
        env = make("arcade/tetris")
        env.reset(seed)
        seq = [env._observe(0.0).state["piece"]]  # current piece
        for _ in range(7):
            env.step("drop")
            seq.append(env._observe(0.0).state["piece"])
        return seq
    assert first_pieces(5) == first_pieces(5)


def test_minesweeper_first_click_is_safe():
    # Mines are placed only after the first reveal, never on it -> never explode first.
    env = make("arcade/minesweeper")
    env.reset(3)
    obs = env.step("4,4")  # first click
    assert not obs.done            # cannot lose on the first click
    assert env.revealed_count >= 1
    assert "reveal_1" in env.unlocked


def test_flappy_gravity_pulls_down():
    env = make("arcade/flappy")
    env.reset(0)
    y0 = env.y
    env.step("idle")  # no flap -> gravity
    assert env.y > y0          # y grows downward
    env2 = make("arcade/flappy")
    env2.reset(0)
    env2.step("flap")          # flap sets upward velocity
    assert env2.vy < 0


def test_connect4_deterministic_no_rng():
    # No RNG: the same player actions always produce the same series outcome.
    acts = ["3", "3", "3", "3"]
    def run(seed):
        env = make("arcade/connect4")
        env.reset(seed)
        for a in acts:
            env.step(a)
        return env.wins, env.losses, [row[:] for row in env.board]
    assert run(1) == run(999)  # seed is irrelevant


# --------------------------------------------------------------------------- #
# Dodger mechanics + pixel-runtime parity
# --------------------------------------------------------------------------- #


def test_dodger_paddle_movement_and_clamp():
    env = make("arcade/dodger")
    o = env.reset(1)
    spd = o.state["paddle_speed"]
    x0 = o.state["paddle_x"]
    o = env.step("left")
    assert o.state["paddle_x"] == max(0, x0 - spd)  # slid left by paddle_speed
    # slam into the left wall: x clamps at 0, never negative
    env2 = make("arcade/dodger")
    last = env2.reset(1)
    for _ in range(40):
        if env2.done:
            break
        last = env2.step("left")
    assert last.state["paddle_x"] >= 0


def test_dodger_pixel_runtime_parity():
    """runtime/pixel_game.py shares logic + Mulberry32 draw order with this env,
    so a (seed, actions) trace scores identically on both. That equivalence is
    what lets the vision agent's *pixel* run replay-verify on this engine."""
    import pathlib
    import sys

    root = pathlib.Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "runtime"))
    try:
        from pixel_game import PixelDodger  # needs numpy/PIL (present in engine venv)
    except Exception as exc:  # pragma: no cover - only when deps missing
        pytest.skip(f"pixel_game unavailable: {exc}")

    actions = (["left", "left", "stay", "right", "right", "stay", "left", "stay"] * 25)
    for seed in (1, 7, 42):
        pg = PixelDodger(seed)
        for a in actions:
            pg.step(a)
        env = make("arcade/dodger")
        env.reset(seed)
        for a in actions:
            env.step(a)
        assert pg.score == env.score, f"seed {seed}: pixel {pg.score} != env {env.score}"
        assert sorted(pg.unlocked) == sorted(env.unlocked)


def test_catcher_catches_good_blocks_bad():
    # A good (green) item caught raises the score; a bad (red) item ends the run.
    env = make("arcade/catcher")
    env.reset(2)
    saw_catch = False
    for _ in range(400):
        if env.done:
            break
        before = env.caught
        env.step("stay")
        if env.caught > before:
            saw_catch = True
    assert saw_catch or env.done  # either caught something or a red ended it


def test_catcher_pixel_runtime_parity():
    """runtime/pixel_game.py CatcherGame shares logic + Mulberry32 draw order with
    this env (two draws/spawn: column then kind), so a (seed, actions) trace —
    including the vision agent's pixel run — replays identically here."""
    import pathlib
    import sys

    root = pathlib.Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "runtime"))
    try:
        from pixel_game import CatcherGame
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"pixel_game unavailable: {exc}")

    actions = (["left", "stay", "right", "right", "stay", "left"] * 40)
    for seed in (1, 7, 42):
        pg = CatcherGame(seed)
        for a in actions:
            pg.step(a)
        env = make("arcade/catcher")
        env.reset(seed)
        for a in actions:
            env.step(a)
        assert pg.caught == env.caught, f"seed {seed}: pixel {pg.caught} != env {env.caught}"
        assert sorted(pg.unlocked) == sorted(env.unlocked)


def test_volley_pixel_runtime_parity():
    """runtime/pixel_game.py VolleyGame shares integer physics + Mulberry32 launch
    draws (column then vx) with this env, so a (seed, actions) trace — including
    the temporal vision agent's pixel run — replays identically here."""
    import pathlib
    import sys

    root = pathlib.Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "runtime"))
    try:
        from pixel_game import VolleyGame
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"pixel_game unavailable: {exc}")

    actions = (["left", "stay", "right", "stay", "right", "left"] * 60)
    for seed in (1, 7, 42):
        pg = VolleyGame(seed)
        for a in actions:
            pg.step(a)
        env = make("arcade/volley")
        env.reset(seed)
        for a in actions:
            env.step(a)
        assert pg.bounces == env.bounces, f"seed {seed}: pixel {pg.bounces} != env {env.bounces}"
        assert sorted(pg.unlocked) == sorted(env.unlocked)


def test_storm_pixel_runtime_parity():
    """runtime/pixel_game.py StormGame shares logic + Mulberry32 spawn draws
    (column, then fall speed) with this env, so a (seed, actions) trace — incl.
    the multi-object vision agent's pixel run — replays identically here."""
    import pathlib
    import sys

    root = pathlib.Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "runtime"))
    try:
        from pixel_game import StormGame
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"pixel_game unavailable: {exc}")

    actions = (["left", "stay", "right", "stay", "left", "right"] * 100)
    for seed in (1, 7, 42):
        pg = StormGame(seed)
        for a in actions:
            pg.step(a)
        env = make("arcade/storm")
        env.reset(seed)
        for a in actions:
            env.step(a)
        assert pg.score == env.score, f"seed {seed}: pixel {pg.score} != env {env.score}"
        assert sorted(pg.unlocked) == sorted(env.unlocked)


def test_turret_pixel_runtime_parity():
    """runtime/pixel_game.py TurretGame shares logic + Mulberry32 spawn draw +
    hits-dependent cadence with this env, so a (seed, actions) trace — incl. the
    targeting vision agent's pixel run — replays identically here."""
    import pathlib
    import sys

    root = pathlib.Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "runtime"))
    try:
        from pixel_game import TurretGame
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"pixel_game unavailable: {exc}")

    actions = (["left", "fire", "stay", "right", "fire", "stay", "right"] * 90)
    for seed in (1, 7, 42):
        pg = TurretGame(seed)
        for a in actions:
            pg.step(a)
        env = make("arcade/turret")
        env.reset(seed)
        for a in actions:
            env.step(a)
        assert pg.hits == env.hits, f"seed {seed}: pixel {pg.hits} != env {env.hits}"
        assert sorted(pg.unlocked) == sorted(env.unlocked)


def test_forager_pixel_runtime_parity():
    """runtime/pixel_game.py ForagerGame shares logic + Mulberry32 draw order
    (goods then hazards at reset; respawn + new-hazard draws on collection) with
    this env, so a (seed, actions) trace — incl. the 2D vision agent's pixel run
    — replays identically here."""
    import pathlib
    import sys

    root = pathlib.Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "runtime"))
    try:
        from pixel_game import ForagerGame
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"pixel_game unavailable: {exc}")

    actions = (["up", "right", "down", "left", "right", "up", "stay", "down"] * 70)
    for seed in (1, 7, 42):
        pg = ForagerGame(seed)
        for a in actions:
            pg.step(a)
        env = make("arcade/forager")
        env.reset(seed)
        for a in actions:
            env.step(a)
        assert pg.collected == env.collected, f"seed {seed}: pixel {pg.collected} != env {env.collected}"
        assert sorted(pg.unlocked) == sorted(env.unlocked)


def test_phantom_pixel_runtime_parity():
    """runtime/pixel_game.py PhantomGame shares logic + Mulberry32 spawn draw +
    blink cycle with this env, so a (seed, actions) trace — incl. the memory CV
    agent's pixel run — replays identically here (score uses the REAL blocks)."""
    import pathlib
    import sys

    root = pathlib.Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "runtime"))
    try:
        from pixel_game import PhantomGame
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"pixel_game unavailable: {exc}")

    actions = (["left", "stay", "right", "stay", "left", "right"] * 100)
    for seed in (1, 7, 42):
        pg = PhantomGame(seed)
        for a in actions:
            pg.step(a)
        env = make("arcade/phantom")
        env.reset(seed)
        for a in actions:
            env.step(a)
        assert pg.score == env.score, f"seed {seed}: pixel {pg.score} != env {env.score}"
        assert sorted(pg.unlocked) == sorted(env.unlocked)


def test_rally_pixel_runtime_parity():
    """runtime/pixel_game.py RallyGame shares logic + Mulberry32 serve draw +
    the deterministic opponent with this env, so a (seed, actions) trace — incl.
    the adversarial vision agent's pixel run — replays identically here."""
    import pathlib
    import sys

    root = pathlib.Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "runtime"))
    try:
        from pixel_game import RallyGame
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"pixel_game unavailable: {exc}")

    actions = (["up", "stay", "down", "stay", "up", "down", "up"] * 90)
    for seed in (1, 7, 42):
        pg = RallyGame(seed)
        for a in actions:
            pg.step(a)
        env = make("arcade/rally")
        env.reset(seed)
        for a in actions:
            env.step(a)
        assert pg.points == env.points, f"seed {seed}: pixel {pg.points} != env {env.points}"
        assert sorted(pg.unlocked) == sorted(env.unlocked)
