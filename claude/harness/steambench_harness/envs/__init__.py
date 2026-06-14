"""Arcade environments. Importing this package registers every built-in env.

Add a new game by creating a module here that defines an ``Env`` subclass
decorated with ``@register``, then import it below.
"""

from ..registry import make, all_env_ids, all_specs  # re-export

# Importing each module triggers its @register decorator.
from . import game2048  # noqa: F401
from . import snake  # noqa: F401
from . import sokoban  # noqa: F401
from . import tetris  # noqa: F401
from . import minesweeper  # noqa: F401
from . import flappy  # noqa: F401
from . import connect4  # noqa: F401
from . import dodger  # noqa: F401
from . import catcher  # noqa: F401
from . import volley  # noqa: F401
from . import storm  # noqa: F401
from . import turret  # noqa: F401
from . import forager  # noqa: F401
from . import phantom  # noqa: F401
from . import rally  # noqa: F401

__all__ = ["make", "all_env_ids", "all_specs"]
