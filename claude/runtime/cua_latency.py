"""Measure CUA I/O latency (excludes agent/LLM thinking): how long a screenshot
takes and how long an input action takes. Run against the daemon both from
inside the sandbox (DAEMON=http://localhost:8765 = pure pipeline latency a
co-located agent sees) and remotely (DAEMON=https://8765-<id>.e2b.app).

    DAEMON=http://localhost:8765 python3 cua_latency.py
"""
import json
import os
import statistics
import time
import urllib.request

BASE = os.environ["DAEMON"].rstrip("/")
N = int(os.environ.get("N", "25"))


def t_get(path):
    t0 = time.perf_counter()
    urllib.request.urlopen(BASE + path, timeout=20).read()
    return (time.perf_counter() - t0) * 1000


def t_post(path, obj):
    data = json.dumps(obj).encode()
    t0 = time.perf_counter()
    urllib.request.urlopen(urllib.request.Request(
        BASE + path, data=data, headers={"Content-Type": "application/json"}), timeout=20).read()
    return (time.perf_counter() - t0) * 1000


def stats(name, fn):
    xs = sorted(fn() for _ in range(N))
    print(f"  {name:22} median {statistics.median(xs):6.1f}ms   p90 {xs[int(N*0.9)]:6.1f}ms   min {xs[0]:6.1f}ms")


print(f"== CUA I/O latency from {BASE}  (n={N}) ==")
stats("screenshot /frame", lambda: t_get("/frame"))
stats("gamepad  /pad", lambda: t_post("/pad", {"axes": [0, 0, 0, 0], "buttons": [0.0] * 17}))
stats("keyboard /key", lambda: t_post("/key", {"action": "tap", "key": "a"}))
stats("mouse    /mouse", lambda: t_post("/mouse", {"action": "move", "x": 100, "y": 100}))
