"""Env registry: map a stable ``env_id`` to its env class.

Both the agent runner and the server-side verifier use this to instantiate an
env by id, so a submitted run can be replayed without trusting the client about
which env it ran on.
"""

from __future__ import annotations

from typing import Type

from .protocol import Env

_REGISTRY: dict[str, Type[Env]] = {}


def register(env_cls: Type[Env]) -> Type[Env]:
    """Class decorator that registers an env under its ``env_id``."""
    env_id = env_cls.env_id
    if env_id in _REGISTRY and _REGISTRY[env_id] is not env_cls:
        raise ValueError(f"env_id {env_id!r} already registered")
    _REGISTRY[env_id] = env_cls
    return env_cls


def make(env_id: str) -> Env:
    """Instantiate an env by id."""
    if env_id not in _REGISTRY:
        raise KeyError(f"unknown env_id {env_id!r}; registered: {sorted(_REGISTRY)}")
    return _REGISTRY[env_id]()


def all_env_ids() -> list[str]:
    return sorted(_REGISTRY)


def all_specs() -> list[dict]:
    """Spec dicts for every registered env (drives the catalog + docs)."""
    return [make(env_id).spec() for env_id in all_env_ids()]
