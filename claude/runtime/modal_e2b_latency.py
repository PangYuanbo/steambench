"""Measure network latency from a Modal function to an E2B sandbox endpoint.

The production shape is: the agent/harness runs on Modal and drives a browser
(GeForce NOW) in an E2B desktop sandbox. This probes that exact hop — HTTP RTT
from inside a Modal container to an E2B sandbox's public port — under two
placements: Modal's default region, and Modal pinned to GCP us-west1 (where E2B
runs, The Dalles/Oregon) to show the best co-located case.

    SBURL=https://8080-<id>.e2b.app modal run runtime/modal_e2b_latency.py
"""
import os
import time

import modal

app = modal.App("e2b-latency")
image = modal.Image.debian_slim().pip_install("requests")


def _measure(url: str) -> dict:
    import requests

    out = {}
    try:
        out["modal_loc"] = requests.get("https://ipinfo.io/json", timeout=8).json()
    except Exception as e:
        out["modal_loc"] = str(e)[:80]
    out["modal_env_region"] = os.environ.get("MODAL_REGION") or os.environ.get("MODAL_CLOUD_REGION")
    s = requests.Session()
    # TCP connect RTT (fresh socket)
    try:
        t0 = time.time(); s.get(url, timeout=10); out["first_req_ms"] = round((time.time() - t0) * 1000, 1)
    except Exception as e:
        return {"error": f"cannot reach {url}: {str(e)[:120]}", **out}
    # warm steady-state RTT (keepalive)
    ts = []
    for _ in range(12):
        t0 = time.time()
        try:
            s.get(url, timeout=10)
        except Exception:
            continue
        ts.append((time.time() - t0) * 1000)
    ts.sort()
    out["rtt_samples_ms"] = [round(x, 1) for x in ts]
    out["rtt_median_ms"] = round(ts[len(ts) // 2], 1) if ts else None
    out["rtt_min_ms"] = round(ts[0], 1) if ts else None
    return out


@app.function(image=image)
def probe_default(url: str) -> dict:
    return _measure(url)


@app.function(image=image, region="us-west1", cloud="gcp")
def probe_gcp_west(url: str) -> dict:
    return _measure(url)


@app.local_entrypoint()
def main():
    import json

    url = os.environ["SBURL"]
    print("== Modal DEFAULT region ==")
    print(json.dumps(probe_default.remote(url), indent=2, default=str, ensure_ascii=False))
    try:
        print("\n== Modal pinned GCP us-west1 (co-located with E2B) ==")
        print(json.dumps(probe_gcp_west.remote(url), indent=2, default=str, ensure_ascii=False))
    except Exception as e:
        print("gcp_west probe unavailable:", str(e)[:120])
