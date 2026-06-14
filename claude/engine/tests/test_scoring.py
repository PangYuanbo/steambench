import pytest

from steambench.catalog import Achievement, Game
from steambench.scoring import (
    PlayerKind,
    score_game,
    aggregate_player,
    elo_update,
    expected_score,
    match_outcome,
    HumanVsAI,
)


def make_game():
    return Game(
        appid=1145360,
        name="Hades",
        owners_estimate=10_000_000,
        achievements=[
            Achievement("AchClearTartarus", 82.1),   # tutorial, 100-ish pts
            Achievement("AchClearAnyRun", 47.1),      # easy
            Achievement("AchHardClear", 4.2),         # hard
            Achievement("AchCompletionist", 0.4),     # elite/legendary
        ],
    )


def test_score_game_partial():
    g = make_game()
    tasks = g.tasks()
    # Player cleared the two easiest only.
    done = [t.task_id for t in tasks if t.source_ref in ("AchClearTartarus", "AchClearAnyRun")]
    gs = score_game(done, tasks)
    assert gs.completed_tasks == 2
    assert gs.total_tasks == 4
    assert 0 < gs.mastery < 0.5  # easy achievements are a small slice of total bits
    assert gs.earned_points > 0


def test_score_game_full_mastery():
    g = make_game()
    tasks = g.tasks()
    gs = score_game([t.task_id for t in tasks], tasks)
    assert gs.mastery == pytest.approx(1.0)
    assert gs.completion == pytest.approx(1.0)
    assert gs.earned_points == g.total_points


def test_mastery_rewards_hard_over_many_easy():
    g = make_game()
    tasks = g.tasks()
    hard = next(t for t in tasks if t.source_ref == "AchCompletionist")
    easy_two = [t.task_id for t in tasks if t.source_ref in ("AchClearTartarus", "AchClearAnyRun")]
    only_hard = score_game([hard.task_id], tasks)
    two_easy = score_game(easy_two, tasks)
    # One legendary should be worth more mastery than two tutorial/easy ones.
    assert only_hard.earned_bits > two_easy.earned_bits


def test_aggregate_player():
    g = make_game()
    tasks = g.tasks()
    gs = score_game([t.task_id for t in tasks], tasks)
    standing = aggregate_player(
        "agent:gpt",
        PlayerKind.AGENT,
        {g.appid: gs},
        popularity_weights={g.appid: g.popularity_weight},
        legendary_counts={g.appid: 1},
    )
    assert standing.games_played == 1
    assert standing.tasks_completed == 4
    assert standing.weighted_score > 0
    assert standing.legendary_count == 1


def test_elo_symmetry_and_direction():
    # Equal ratings, A wins -> A up, B down by same amount.
    a, b = elo_update(1200, 1200, 1.0)
    assert a > 1200 and b < 1200
    assert (a - 1200) == pytest.approx(1200 - b)
    assert expected_score(1200, 1200) == pytest.approx(0.5)


def test_match_outcome():
    assert match_outcome(5.0, 3.0) == 1.0
    assert match_outcome(3.0, 5.0) == 0.0
    assert match_outcome(4.0, 4.0) == 0.5


def test_human_vs_ai_board():
    board = HumanVsAI()
    # AI wins three contested games decisively.
    for _ in range(3):
        board.record_match(human_bits=2.0, ai_bits=8.0)
    assert board.ai_wins == 3
    assert board.ai_elo > board.human_elo
    assert board.leader == "ai"
    d = board.as_dict()
    assert d["games_contested"] == 3
    assert d["gap"] > 0
