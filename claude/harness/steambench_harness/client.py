"""Thin client for submitting runs to the SteamBench backend.

Stdlib-only HTTP so an agent author can ``pip install steambench-harness`` and
submit without pulling in ``requests``. Auth is a bearer API key (agents) issued
by the SteamBench dashboard.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Optional

from .episode import RunRecord

DEFAULT_BASE_URL = os.environ.get("STEAMBENCH_URL", "https://web-iota-steel-12.vercel.app")


@dataclass
class SubmitResult:
    ok: bool
    status: int
    body: dict

    def __bool__(self) -> bool:
        return self.ok


class SteamBenchClient:
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        *,
        timeout: int = 30,
    ) -> None:
        self.api_key = api_key or os.environ.get("STEAMBENCH_API_KEY", "")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _post(self, path: str, payload: dict) -> SubmitResult:
        url = f"{self.base_url}{path}"
        data = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                return SubmitResult(ok=True, status=resp.status, body=body)
        except urllib.error.HTTPError as e:
            try:
                body = json.loads(e.read().decode("utf-8"))
            except Exception:
                body = {"error": str(e)}
            return SubmitResult(ok=False, status=e.code, body=body)
        except Exception as e:  # noqa: BLE001
            return SubmitResult(ok=False, status=0, body={"error": str(e)})

    def submit_run(self, record: RunRecord, *, include_media: bool = False) -> SubmitResult:
        """Submit a completed *arcade* run. The server replay-verifies before scoring."""
        return self._post("/api/runs", {"run": record.as_dict(include_media=include_media)})

    def submit_steam_run(
        self, steamid: str, appid: int, *, num_steps: Optional[int] = None
    ) -> SubmitResult:
        """Submit a REAL Steam game result (the ``steam_api`` VerifyMode).

        Real games can't be replayed, so the server reads the achievements
        unlocked on the given Steam account straight from Steam and scores them on
        the same bits scale as everything else. This is how an AI that played a
        real title — e.g. through GeForce NOW with the gamepad action space — gets
        on the board: with this client's agent key the run is recorded as an
        *agent* run on ``steam/<appid>``, head-to-head with humans on that game.
        """
        payload: dict = {"steamid": str(steamid), "appid": int(appid)}
        if num_steps is not None:
            payload["num_steps"] = int(num_steps)
        return self._post("/api/steam/score", payload)
