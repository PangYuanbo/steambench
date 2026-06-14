"""A tiny, portable, deterministic PRNG (mulberry32).

Why not ``random.Random``? Because SteamBench verifies arcade runs by *replay*,
and humans play these games in the browser (TypeScript) while agents play them
in Python. For a recorded ``(seed, actions)`` trace to replay identically in
either language, both must draw the *same* random numbers. ``random.Random``
(Mersenne Twister) and ``Math.random`` are not portable; mulberry32 is trivially
identical across languages.

This Python implementation is byte-for-byte verified against the canonical
JavaScript mulberry32 (see ``tests/test_rng.py`` for the cross-checked vectors).
The TypeScript mirror lives at ``web/src/lib/arcade/rng.ts``.
"""

from __future__ import annotations

from typing import Sequence, TypeVar

_MASK = 0xFFFFFFFF
T = TypeVar("T")


def _imul(a: int, b: int) -> int:
    """Equivalent of JS ``Math.imul`` on the low 32 bits (unsigned domain)."""
    return (a * b) & _MASK


class Mulberry32:
    """Seedable PRNG matching the canonical JS mulberry32 bit-for-bit."""

    def __init__(self, seed: int = 0) -> None:
        self.a = seed & _MASK

    def next_u32(self) -> int:
        self.a = (self.a + 0x6D2B79F5) & _MASK
        a = self.a
        t = _imul(a ^ (a >> 15), 1 | a)
        t = ((t + _imul(t ^ (t >> 7), 61 | t)) & _MASK) ^ t
        t &= _MASK
        return (t ^ (t >> 14)) & _MASK

    def random(self) -> float:
        """Float in [0, 1), matching ``mulberry32()()`` in JS."""
        return self.next_u32() / 4294967296.0

    def randrange(self, n: int) -> int:
        """Uniform integer in [0, n). Same formula the TS mirror uses."""
        if n <= 0:
            raise ValueError("randrange requires n > 0")
        return int(self.random() * n)

    def choice(self, seq: Sequence[T]) -> T:
        if not seq:
            raise IndexError("cannot choose from an empty sequence")
        return seq[self.randrange(len(seq))]
