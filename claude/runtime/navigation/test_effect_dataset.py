from runtime.navigation.build_effect_dataset import confidence


def test_blocked_confidence_uses_command_and_stillness():
    strong = confidence({
        "effect": "blocked_candidate",
        "command": {"move": 1.0, "turn": 0.0},
        "motion": {"pixel_change": 0.005, "inlier_ratio": 0.9},
    })
    weak = confidence({
        "effect": "blocked_candidate",
        "command": {"move": 0.4, "turn": 0.0},
        "motion": {"pixel_change": 0.04, "inlier_ratio": 0.3},
    })
    assert strong > weak
