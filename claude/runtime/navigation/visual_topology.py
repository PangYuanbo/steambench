"""Visual topological mapping without GPS or game-state access."""

from __future__ import annotations

import argparse
import io
import json
import math
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


@dataclass
class Node:
    id: int
    frame: str
    created_at: float
    visits: int = 1
    semantic_label: str | None = None


@dataclass
class Edge:
    source: int
    target: int
    started_at: float
    ended_at: float
    actions: list[dict] = field(default_factory=list)


def _normalize(values: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(values)
    return values / norm if norm else values


def visual_descriptor(rgb: np.ndarray) -> np.ndarray:
    small = cv2.resize(rgb, (32, 18), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(small, cv2.COLOR_RGB2LAB).astype(np.float32)
    channels = []
    for channel in cv2.split(lab):
        channel = (channel - channel.mean()) / (channel.std() + 1e-6)
        channels.append(channel.reshape(-1))
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    gradient_x = np.diff(gray, axis=1, prepend=gray[:, :1]).reshape(-1)
    gradient_y = np.diff(gray, axis=0, prepend=gray[:1, :]).reshape(-1)
    return _normalize(np.concatenate([*channels, gradient_x, gradient_y]))


def cosine_similarity(left: np.ndarray, right: np.ndarray) -> float:
    return float(np.dot(left, right))


def frame_motion(previous: np.ndarray, current: np.ndarray) -> float:
    left = cv2.resize(previous, (160, 90), interpolation=cv2.INTER_AREA)
    right = cv2.resize(current, (160, 90), interpolation=cv2.INTER_AREA)
    left = cv2.cvtColor(left, cv2.COLOR_RGB2GRAY)
    right = cv2.cvtColor(right, cv2.COLOR_RGB2GRAY)
    return float(np.mean(cv2.absdiff(left, right)) / 255.0)


def geometric_similarity(left: np.ndarray, right: np.ndarray) -> tuple[int, float]:
    orb = cv2.ORB_create(nfeatures=700)
    left_gray = cv2.cvtColor(left, cv2.COLOR_RGB2GRAY)
    right_gray = cv2.cvtColor(right, cv2.COLOR_RGB2GRAY)
    left_keys, left_desc = orb.detectAndCompute(left_gray, None)
    right_keys, right_desc = orb.detectAndCompute(right_gray, None)
    if left_desc is None or right_desc is None or len(left_keys) < 12 or len(right_keys) < 12:
        return 0, 0.0
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(left_desc, right_desc, k=2)
    good = [first for first, second in pairs if first.distance < 0.72 * second.distance]
    if len(good) < 8:
        return len(good), 0.0
    source = np.float32([left_keys[item.queryIdx].pt for item in good])
    target = np.float32([right_keys[item.trainIdx].pt for item in good])
    _, mask = cv2.findHomography(source, target, cv2.RANSAC, 5.0)
    return len(good), float(mask.mean()) if mask is not None else 0.0


class VisualTopology:
    def __init__(self, root: Path, *, node_interval: float = 2.0,
                 candidate_similarity: float = 0.72, loop_inliers: float = 0.55,
                 stuck_motion: float = 0.012, stuck_samples: int = 4):
        self.root = root
        self.frames = root / "frames"
        self.frames.mkdir(parents=True, exist_ok=True)
        self.node_interval = node_interval
        self.candidate_similarity = candidate_similarity
        self.loop_inliers = loop_inliers
        self.stuck_motion = stuck_motion
        self.nodes: list[Node] = []
        self.edges: list[Edge] = []
        self.descriptors: list[np.ndarray] = []
        self.node_images: list[np.ndarray] = []
        self.current: int | None = None
        self.last_node_at = 0.0
        self.previous_frame: np.ndarray | None = None
        self.motion_history = deque(maxlen=stuck_samples)
        self.pending_actions: list[dict] = []

    def observe(self, jpeg: bytes, *, timestamp: float | None = None,
                action: dict | None = None, label: dict | None = None) -> dict:
        timestamp = timestamp or time.time()
        rgb = np.array(Image.open(io.BytesIO(jpeg)).convert("RGB"))
        descriptor = visual_descriptor(rgb)
        motion = frame_motion(self.previous_frame, rgb) if self.previous_frame is not None else 1.0
        self.motion_history.append(motion)
        if action:
            self.pending_actions.append(action)

        match = self._match(descriptor, rgb)
        event = "observe"
        if match is not None and self.current is not None and match[0] != self.current:
            previous = self.current
            self.current = match[0]
            self.nodes[self.current].visits += 1
            self.edges.append(Edge(previous, self.current, self.last_node_at, timestamp, self.pending_actions.copy()))
            self.last_node_at = timestamp
            self.pending_actions.clear()
            event = "loop_closure"
        elif self.current is None or (timestamp - self.last_node_at >= self.node_interval and match is None):
            target = self._add_node(jpeg, rgb, descriptor, timestamp, label)
            if self.current is not None:
                self.edges.append(Edge(self.current, target, self.last_node_at, timestamp, self.pending_actions.copy()))
            self.current = target
            self.last_node_at = timestamp
            self.pending_actions.clear()
            event = "new_node"

        stuck = len(self.motion_history) == self.motion_history.maxlen and max(self.motion_history) < self.stuck_motion
        self.previous_frame = rgb
        result = {
            "time": timestamp, "event": event, "node": self.current,
            "motion": round(motion, 5), "stuck": stuck,
            "match": None if match is None else {
                "node": match[0], "descriptor": round(match[1], 4),
                "matches": match[2], "inlier_ratio": round(match[3], 4),
            },
            "label": label or {},
        }
        with (self.root / "observations.jsonl").open("a", encoding="utf-8") as output:
            output.write(json.dumps(result, separators=(",", ":")) + "\n")
        self.save()
        return result

    def _match(self, descriptor: np.ndarray, rgb: np.ndarray):
        candidates = sorted(
            ((cosine_similarity(descriptor, known), index) for index, known in enumerate(self.descriptors)),
            reverse=True,
        )[:5]
        for similarity, index in candidates:
            if similarity < self.candidate_similarity:
                break
            matches, inliers = geometric_similarity(self.node_images[index], rgb)
            if matches >= 12 and inliers >= self.loop_inliers:
                return index, similarity, matches, inliers
        return None

    def _add_node(self, jpeg: bytes, rgb: np.ndarray, descriptor: np.ndarray,
                  timestamp: float, label: dict | None) -> int:
        node_id = len(self.nodes)
        name = f"node-{node_id:05d}.jpg"
        (self.frames / name).write_bytes(jpeg)
        self.nodes.append(Node(node_id, f"frames/{name}", timestamp,
                               semantic_label=(label or {}).get("semantic_location")))
        self.descriptors.append(descriptor)
        self.node_images.append(rgb)
        return node_id

    def save(self):
        payload = {
            "version": 1,
            "nodes": [asdict(node) for node in self.nodes],
            "edges": [asdict(edge) for edge in self.edges],
            "current_node": self.current,
        }
        (self.root / "topology.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def export_hindsight(self, path: Path, max_hops: int = 5):
        with path.open("w", encoding="utf-8") as output:
            for start in range(len(self.edges)):
                actions = []
                source = self.edges[start].source
                for end in range(start, min(len(self.edges), start + max_hops)):
                    edge = self.edges[end]
                    if end > start and self.edges[end - 1].target != edge.source:
                        break
                    actions.extend(edge.actions)
                    sample = {
                        "observation": self.nodes[source].frame,
                        "goal": self.nodes[edge.target].frame,
                        "actions": actions.copy(),
                        "hops": end - start + 1,
                    }
                    output.write(json.dumps(sample, separators=(",", ":")) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("frames", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--interval", type=float, default=1.0)
    args = parser.parse_args()
    topology = VisualTopology(args.output)
    started = time.time()
    frames = sorted(frame for frame in args.frames.glob("*.jpg") if frame.stem.isdigit())
    for index, frame in enumerate(frames):
        result = topology.observe(frame.read_bytes(), timestamp=started + index * args.interval)
        print(frame.name, result)
    topology.export_hindsight(args.output / "hindsight.jsonl")
    print(json.dumps({"nodes": len(topology.nodes), "edges": len(topology.edges), "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
