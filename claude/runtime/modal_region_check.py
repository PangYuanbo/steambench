"""Confirm Modal honors region pinning. Each function requests a specific
cloud+region; it reports back the region Modal placed it in + the resolved
datacenter (via ipinfo) so we can see the request was actually honored.

    modal run runtime/modal_region_check.py
"""
import os

import modal

app = modal.App("region-check")
image = modal.Image.debian_slim().pip_install("requests")


def _where() -> dict:
    import requests

    info = {}
    try:
        info["ipinfo"] = requests.get("https://ipinfo.io/json", timeout=8).json()
    except Exception as e:
        info["ipinfo"] = str(e)[:80]
    info["MODAL_REGION"] = os.environ.get("MODAL_REGION")
    info["MODAL_CLOUD_PROVIDER"] = os.environ.get("MODAL_CLOUD_PROVIDER")
    return info


@app.function(image=image, cloud="gcp", region="us-west1")
def gcp_us_west1() -> dict:
    return _where()


@app.local_entrypoint()
def main():
    import json

    print("requested: cloud=gcp region=us-west1 (E2B's region)")
    r = gcp_us_west1.remote()
    ip = r.get("ipinfo", {})
    print(json.dumps({
        "MODAL_REGION_env": r.get("MODAL_REGION"),
        "MODAL_CLOUD_PROVIDER_env": r.get("MODAL_CLOUD_PROVIDER"),
        "datacenter_city": ip.get("city") if isinstance(ip, dict) else ip,
        "datacenter_region": ip.get("region") if isinstance(ip, dict) else None,
        "org": ip.get("org") if isinstance(ip, dict) else None,
        "loc": ip.get("loc") if isinstance(ip, dict) else None,
    }, indent=2, ensure_ascii=False))
