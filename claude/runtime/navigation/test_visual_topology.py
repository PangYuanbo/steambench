import io
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

from runtime.navigation.visual_topology import VisualTopology


def jpeg(seed: int) -> bytes:
    rng = np.random.default_rng(seed)
    image = Image.fromarray(rng.integers(0, 255, (180, 320, 3), dtype=np.uint8))
    output = io.BytesIO()
    image.save(output, "JPEG")
    return output.getvalue()


def test_builds_nodes_edges_and_hindsight():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        topology = VisualTopology(root, node_interval=1)
        first = jpeg(1)
        topology.observe(first, timestamp=1, action={"axes": [0, 1]})
        topology.observe(first, timestamp=2, action={"axes": [0, 1]})
        topology.observe(jpeg(2), timestamp=3, action={"axes": [1, 0]})
        assert len(topology.nodes) == 2
        assert len(topology.edges) == 1
        topology.export_hindsight(root / "hindsight.jsonl")
        assert (root / "hindsight.jsonl").read_text().count("\n") == 1
