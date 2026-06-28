# Pure-visual navigation scaffold

This builds a topological map from game pixels without GPS, game memory access,
or a hand-authored reward function.

Each node is a stored visual place. Each edge contains the controller actions
that moved between places. A lightweight descriptor proposes loop-closure
candidates; ORB feature geometry confirms them. When visual evidence is weak,
the mapper creates a new node instead of inventing a false loop closure.

```bash
python runtime/navigation/visual_topology.py screenshots/ --output output/map
```

Outputs:

- `topology.json`: nodes, directed edges, action traces, current node
- `observations.jsonl`: motion, stuck state, loop evidence, optional VLM labels
- `frames/node-*.jpg`: visual place exemplars
- `hindsight.jsonl`: `(current image, future goal image, intervening actions)`
  samples for goal-conditioned behavior cloning

The online collector should call `observe(jpeg, action=..., label=...)` once per
second. `label` is intentionally optional; a VLM can later add sparse events
such as `dead`, `enemy_visible`, `interaction_success`, or a semantic location.
The map itself does not depend on those labels.

`action_effect.py` compares each command with subsequent background motion. It
produces conservative pseudo-labels including `movement_effective`,
`turn_effective`, `blocked_candidate`, and `external_motion`. These labels are
the initial supervision for a future temporal SigLIP/CLIP reward head; they are
not treated as final scalar rewards.

Build aligned training/review manifests:

```bash
python runtime/navigation/build_effect_dataset.py screenshots/ actions.jsonl \
  --output output/action-effect.jsonl
```

Low-confidence and collision candidates are written to a separate
`*-review.jsonl` queue for VLM or human verification. `effect_model.py` defines
the small temporal classification head that consumes frozen SigLIP/CLIP
embeddings from the previous frame, current frame, their difference, and the
controller command. The visual encoder should stay frozen for the first
training pass.

Live Runtime Browser collection:

```bash
python runtime/navigation/collect_runtime.py \
  --state .runtime-browser-cropped.json \
  --output output/live-map --seconds 300
```

Pass `--actions actions.jsonl` to attach NitroGen's latest executed action chunk
to each map transition.
