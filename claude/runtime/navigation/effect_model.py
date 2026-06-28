"""Small temporal action-effect head for frozen visual embeddings."""

from __future__ import annotations

import torch
from torch import nn


EFFECTS = [
    "idle", "external_motion", "movement_effective", "turn_effective",
    "blocked_candidate", "action_effective", "action_uncertain",
]


class ActionEffectHead(nn.Module):
    """Classify `(previous vision, current vision, command)`; encoder stays external."""

    def __init__(self, vision_dim: int, action_dim: int = 7, hidden_dim: int = 512):
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(vision_dim * 3 + action_dim, hidden_dim),
            nn.GELU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, len(EFFECTS)),
        )

    def forward(self, previous, current, action):
        features = torch.cat([previous, current, current - previous, action], dim=-1)
        return self.network(features)
