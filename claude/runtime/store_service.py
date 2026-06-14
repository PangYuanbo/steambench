"""Durable run store for SteamBench, hosted on Modal.

The Vercel app is stateless (serverless instances don't share memory), so live
submissions need a shared, persistent store. Rather than provision a database,
this is a tiny Modal web service backed by a ``modal.Dict`` (persistent,
distributed). The Vercel ``/api/runs`` handler — which has ALREADY
replay-verified a run — POSTs it here; the public leaderboard reads from here.

Each run is stored under a unique key, so concurrent appends never race.
Writes require a shared bearer secret (so only the verified Vercel path can add
runs); reads are public (leaderboard data).

Deploy:  modal deploy runtime/store_service.py   ->  prints the public base URL
Then set MODAL_STORE_URL + STORE_SECRET in the Vercel project env.
"""

from __future__ import annotations

import os
import uuid

import modal

app = modal.App("steambench-store")
runs = modal.Dict.from_name("steambench-runs", create_if_missing=True)
image = modal.Image.debian_slim().pip_install("fastapi[standard]")

MAX_RUNS = 5000


def _count() -> int:
    try:
        return runs.len()
    except Exception:
        try:
            return len(runs)
        except Exception:
            return -1


def _all() -> list:
    out = []
    try:
        for k in runs.keys():
            try:
                out.append(runs[k])
            except Exception:
                pass
    except Exception:
        pass
    return out


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("steambench-store")],
    min_containers=0,
)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, Header, HTTPException
    from fastapi.middleware.cors import CORSMiddleware

    api = FastAPI(title="SteamBench Store")
    api.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
    )
    secret = os.environ.get("STORE_SECRET", "")

    @api.get("/health")
    def health():
        return {"ok": True, "count": _count(), "service": "steambench-store"}

    @api.post("/runs")
    def add_run(body: dict, authorization: str = Header(default="")):
        if secret and authorization.removeprefix("Bearer ").strip() != secret:
            raise HTTPException(status_code=401, detail="bad store secret")
        run = body.get("run", body) if isinstance(body, dict) else None
        if not isinstance(run, dict):
            raise HTTPException(status_code=400, detail="run must be an object")
        runs[str(uuid.uuid4())] = run
        try:
            if _count() > MAX_RUNS:
                items = sorted(
                    ((k, runs[k]) for k in runs.keys()),
                    key=lambda kv: kv[1].get("created_at", 0),
                )
                for k, _v in items[: _count() - MAX_RUNS]:
                    runs.pop(k, None)
        except Exception:
            pass
        return {"ok": True}

    @api.get("/runs")
    def list_runs(limit: int = 500):
        items = _all()
        items.sort(key=lambda r: r.get("created_at", 0) if isinstance(r, dict) else 0, reverse=True)
        return {"runs": items[: max(1, min(limit, 2000))]}

    return api
