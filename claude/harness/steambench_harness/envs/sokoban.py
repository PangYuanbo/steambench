"""Sokoban — a deterministic SteamBench arcade *planning* env.

A different kind of challenge than 2048/Snake: pure deduction, no randomness.
You push boxes ('$') onto goals ('.'); solving a level advances to the next,
harder one. Because a box shoved into a corner can deadlock a level, the action
space includes ``restart`` (reset the current level) so a stuck player/agent can
recover — it's a recorded, deterministic action, so runs still replay-verify.

Levels are fixed (no RNG), so a run is fully determined by its action trace.
"""

from __future__ import annotations

from typing import Union

from ..protocol import AchievementSpec, ActionSpace, Env, Observation, VerifyMode
from ..registry import register

_ACTIONS = ["up", "down", "left", "right", "restart"]
_DELTA = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}

# Hand-authored, verified-solvable levels of increasing difficulty.
# '#' wall, ' ' floor, '@' player, '$' box, '.' goal, '*' box-on-goal, '+' player-on-goal.
LEVELS = [
    # 1 — one push right
    "#####\n#@$.#\n#####",
    # 2 — push two boxes down
    "######\n#@   #\n#$$  #\n#..  #\n######",
    # 3 — push three boxes down
    "#######\n#@    #\n#$$$  #\n#...  #\n#######",
    # 4 — an L-shaped push (right, then down)
    "######\n#@   #\n# $  #\n#  . #\n######",
    # 5 — two boxes, two corners
    "######\n#@ . #\n# $$ #\n# .  #\n######",
    # 6 — a roomier puzzle
    "#######\n#@    #\n# $$  #\n# ..  #\n#     #\n#######",
]


def _parse(level: str):
    walls, goals = set(), set()
    boxes = set()
    player = (0, 0)
    for y, row in enumerate(level.split("\n")):
        for x, ch in enumerate(row):
            if ch == "#":
                walls.add((x, y))
            elif ch in ".+*":
                goals.add((x, y))
            if ch == "@" or ch == "+":
                player = (x, y)
            elif ch in "$*":
                boxes.add((x, y))
    return walls, goals, boxes, player


@register
class Sokoban(Env):
    env_id = "arcade/sokoban"
    appid = 9000003
    name = "Sokoban"
    description = (
        "Push every box ('$') onto a goal ('.'). Solve a level to advance to a "
        "harder one. Pure planning — beware corners; use restart if you jam."
    )
    verify_mode = VerifyMode.REPLAY
    action_space = ActionSpace(_ACTIONS)
    achievements = [
        AchievementSpec("solve_1", "First Push", "Solve level 1.", 0.85),
        AchievementSpec("solve_2", "Getting It", "Solve level 2.", 0.6),
        AchievementSpec("solve_3", "Box Wrangler", "Solve level 3.", 0.35),
        AchievementSpec("solve_4", "Cornered No More", "Solve level 4.", 0.18),
        AchievementSpec("solve_5", "Warehouse Keeper", "Solve level 5.", 0.07),
        AchievementSpec("solve_all", "Sokoban Master", "Solve every level.", 0.025),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.level_index = 0
        self.levels_solved = 0
        self.walls: set = set()
        self.goals: set = set()
        self.boxes: set = set()
        self.player = (0, 0)
        self._dims = (0, 0)

    # ---- lifecycle -------------------------------------------------------- #

    def reset(self, seed: int = 0) -> Observation:
        self._begin(seed)  # seed unused (levels are fixed) but keeps the contract
        self.level_index = 0
        self.levels_solved = 0
        self._load_level(0)
        return self._observe(0.0)

    def _load_level(self, i: int) -> None:
        level = LEVELS[i]
        self.walls, self.goals, self.boxes, self.player = _parse(level)
        rows = level.split("\n")
        self._dims = (max(len(r) for r in rows), len(rows))

    def step(self, action: Union[int, str]) -> Observation:
        if self.done:
            return self._observe(0.0)
        name = self.action_space.name(action)
        self.steps += 1

        if name == "restart":
            self._load_level(self.level_index)
            return self._observe(0.0)

        dx, dy = _DELTA[name]
        px, py = self.player
        nx, ny = px + dx, py + dy
        target = (nx, ny)
        if target in self.walls:
            return self._observe(0.0)  # blocked
        if target in self.boxes:
            beyond = (nx + dx, ny + dy)
            if beyond in self.walls or beyond in self.boxes:
                return self._observe(0.0)  # box can't move
            self.boxes.discard(target)
            self.boxes.add(beyond)
            self.player = target
        else:
            self.player = target

        reward = 0.0
        if self.boxes == self.goals:  # level solved
            self.levels_solved += 1
            self.score = 100 * self.levels_solved
            reward = 100.0
            self._unlock(f"solve_{min(self.levels_solved, 5)}")
            if self.levels_solved >= len(LEVELS):
                self._unlock("solve_all")
                self.done = True
            else:
                self.level_index += 1
                self._load_level(self.level_index)
        return self._observe(reward)

    # ---- introspection ---------------------------------------------------- #

    @property
    def boxes_on_goal(self) -> int:
        return len(self.boxes & self.goals)

    def legal_actions(self) -> list[str]:
        return list(_ACTIONS)  # all always permitted (restart is always safe)

    def render(self) -> str:
        w, h = self._dims
        out = [f"level {self.level_index + 1}/{len(LEVELS)}  solved={self.levels_solved}  score={self.score}"]
        for y in range(h):
            line = []
            for x in range(w):
                p = (x, y)
                if p in self.walls:
                    line.append("#")
                elif p == self.player:
                    line.append("+" if p in self.goals else "@")
                elif p in self.boxes:
                    line.append("*" if p in self.goals else "$")
                elif p in self.goals:
                    line.append(".")
                else:
                    line.append(" ")
            out.append("".join(line))
        return "\n".join(out)

    def _observe(self, reward: float) -> Observation:
        w, h = self._dims
        return Observation(
            step=self.steps,
            state={
                "level_index": self.level_index,
                "level_number": self.level_index + 1,
                "total_levels": len(LEVELS),
                "levels_solved": self.levels_solved,
                "width": w,
                "height": h,
                "player": list(self.player),
                "walls": [list(p) for p in sorted(self.walls)],
                "goals": [list(p) for p in sorted(self.goals)],
                "boxes": [list(p) for p in sorted(self.boxes)],
                "score": self.score,
            },
            text=self.render(),
            legal_actions=self.legal_actions(),
            score=float(self.score),
            done=self.done,
            reward=float(reward),
            info={"levels_solved": self.levels_solved, "boxes_on_goal": self.boxes_on_goal},
        )
