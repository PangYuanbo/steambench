import os
import subprocess
from pathlib import Path

import modal


app = modal.App("steambench-runtime")

image = (
    modal.Image.debian_slim(python_version="3.13")
    .apt_install("nodejs", "npm", "curl", "ffmpeg", "xvfb")
    .pip_install("requests")
    .add_local_dir(
        ".",
        remote_path="/root/steambench",
        ignore=["node_modules", "dist", "data", ".git", "../claude"],
    )
    .workdir("/root/steambench")
)

steam_state = modal.Volume.from_name("steambench-steam-state", create_if_missing=True)


@app.function(
    image=image,
    volumes={"/steam-state": steam_state},
    timeout=60 * 90,
    cpu=2,
    memory=4096,
)
def run_steambench(run_id: str, api_base_url: str, worker_id: str, agent_id: str = "") -> str:
    env = os.environ.copy()
    env["STEAMBENCH_API_URL"] = api_base_url
    env["STEAMBENCH_STEAM_STATE_DIR"] = "/steam-state"

    command = [
        "node",
        "scripts/runtime-worker.mjs",
        f"--api={api_base_url}",
        f"--run={run_id}",
        f"--worker={worker_id}",
    ]
    if agent_id:
        command.append(f"--agent={agent_id}")

    Path("output").mkdir(exist_ok=True)
    completed = subprocess.run(
        command,
        env=env,
        check=False,
        text=True,
        capture_output=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr or completed.stdout or f"Worker exited {completed.returncode}")
    return completed.stdout


@app.local_entrypoint()
def main(run_id: str, api_base_url: str, worker_id: str, agent_id: str = ""):
    print(run_steambench.remote(run_id, api_base_url, worker_id, agent_id))
