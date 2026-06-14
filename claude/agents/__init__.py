"""Reference agents + a registry so the demo/tournament runners can build any
agent by name."""

from __future__ import annotations

from .baselines import RandomAgent, LegalRandomAgent
from .heuristic_2048 import Expectimax2048Agent
from .heuristic_snake import SnakeBFSAgent
from .hamiltonian_snake import SnakeHamiltonianAgent
from .heuristic_sokoban import SokobanSolverAgent
from .heuristic_tetris import TetrisHeuristicAgent
from .heuristic_minesweeper import MinesweeperSolverAgent
from .heuristic_flappy import FlappyHeuristicAgent
from .heuristic_connect4 import Connect4MinimaxAgent
from .heuristic_dodger import DodgerHeuristicAgent
from .heuristic_catcher import CatcherHeuristicAgent
from .heuristic_volley import VolleyPredictAgent
from .heuristic_storm import StormRolloutAgent
from .heuristic_turret import TurretAimAgent
from .heuristic_forager import ForagerAgent
from .heuristic_phantom import PhantomMemoryAgent
from .heuristic_rally import RallyPredictAgent


def make_agent(name: str, env_id: str = "arcade/2048", **kwargs):
    """Build an agent by short name. ``env_id`` lets game-specific agents and
    the LLM agent tailor themselves."""
    name = name.lower()
    if name in ("random",):
        return RandomAgent(**kwargs)
    if name in ("legal-random", "legalrandom"):
        return LegalRandomAgent(**kwargs)
    if name in ("expectimax", "expectimax-2048", "2048"):
        return Expectimax2048Agent(**kwargs)
    if name in ("bfs", "bfs-snake", "snake"):
        return SnakeBFSAgent()
    if name in ("hamiltonian", "hamiltonian-snake", "ham"):
        return SnakeHamiltonianAgent()
    if name in ("sokoban", "solver", "solver-sokoban"):
        return SokobanSolverAgent()
    if name in ("tetris", "heuristic-tetris"):
        return TetrisHeuristicAgent()
    if name in ("minesweeper", "solver-minesweeper", "mines"):
        return MinesweeperSolverAgent()
    if name in ("flappy", "heuristic-flappy"):
        return FlappyHeuristicAgent()
    if name in ("connect4", "minimax-connect4", "c4"):
        return Connect4MinimaxAgent()
    if name in ("dodger", "heuristic-dodger", "dodge"):
        return DodgerHeuristicAgent()
    if name in ("catcher", "heuristic-catcher", "catch"):
        return CatcherHeuristicAgent()
    if name in ("volley", "predict-volley", "ball"):
        return VolleyPredictAgent()
    if name in ("storm", "rollout-storm"):
        return StormRolloutAgent()
    if name in ("turret", "aim-turret", "aim"):
        return TurretAimAgent()
    if name in ("forager", "forager-nav", "forage"):
        return ForagerAgent()
    if name in ("phantom", "memory-phantom", "memory"):
        return PhantomMemoryAgent()
    if name in ("rally", "predict-rally", "pong"):
        return RallyPredictAgent()
    if name in ("llm", "openai", "gpt"):
        from .llm_agent import OpenAILLMAgent

        return OpenAILLMAgent(env_id=env_id, **kwargs)
    raise ValueError(f"unknown agent {name!r}")


#: Strong programmatic default per env (the "AI to beat").
BEST_FOR_ENV = {
    "arcade/2048": "expectimax",
    "arcade/snake": "bfs",
    "arcade/sokoban": "sokoban",
    "arcade/dodger": "dodger",
    "arcade/catcher": "catcher",
    "arcade/volley": "volley",
    "arcade/storm": "storm",
    "arcade/turret": "turret",
    "arcade/forager": "forager",
    "arcade/phantom": "phantom",
    "arcade/rally": "rally",
}

__all__ = [
    "RandomAgent",
    "LegalRandomAgent",
    "Expectimax2048Agent",
    "SnakeBFSAgent",
    "make_agent",
    "BEST_FOR_ENV",
]
