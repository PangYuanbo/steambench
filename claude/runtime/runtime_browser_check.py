#!/usr/bin/env python3
"""End-to-end check for frame, recording, control, and WebRTC ICE."""

import argparse
import json
import subprocess
import time
import urllib.parse
import urllib.request


def main(base: str, token: str, record_path: str):
    def request(path: str, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(base + path, data=data, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=140) as response:
            return response.headers, response.read()

    def post(path: str, body=None):
        return json.loads(request(path, body or {})[1])

    html = """<!doctype html><style>button{position:absolute;left:100px;top:100px;width:200px;height:100px}</style><button onclick=\"document.title='mouse-ok'\">click</button><script>document.title='ready';addEventListener('keydown',e=>document.title='key-'+e.key);function poll(){let g=navigator.getGamepads()[0];if(g&&g.buttons[0].pressed)document.title='pad-ok';requestAnimationFrame(poll)}poll()</script>"""
    post("/goto", {"url": "data:text/html," + urllib.parse.quote(html)})
    post("/mouse", {"x": 150, "y": 150})
    mouse = post("/eval", {"expression": "document.title"})
    post("/key", {"key": "K"})
    key = post("/eval", {"expression": "document.title"})
    post("/pad", {"axes": [0, 0, 0, 0], "buttons": [1] + [0] * 16})
    time.sleep(0.1)
    pad = post("/eval", {"expression": "document.title"})
    fullscreen = post("/fullscreen")

    frame_id = -1
    frame_ids = []
    started = time.perf_counter()
    for _ in range(120):
        headers, _ = request(f"/frame?after={frame_id}")
        frame_id = int(headers["X-Frame-Id"])
        frame_ids.append(frame_id)
    frame_fps = 120 / (time.perf_counter() - started)

    post("/record/start", {"path": record_path})
    time.sleep(3)
    recording = post("/record/stop")
    probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate,nb_frames", "-of", "json", record_path]))["streams"][0]

    post("/goto", {"url": "https://example.com"})
    ice = post("/eval", {"expression": """async () => {const pc=new RTCPeerConnection({iceServers:[{urls:'stun:74.125.250.129:19302'}]});let candidates=[];pc.createDataChannel('x');pc.onicecandidate=e=>e.candidate&&candidates.push(e.candidate.candidate);await pc.setLocalDescription(await pc.createOffer());await new Promise(r=>setTimeout(r,10000));return {state:pc.iceGatheringState,candidates}}"""})
    result = {"mouse": mouse, "key": key, "pad": pad, "fullscreen": fullscreen, "unique_frames": len(set(frame_ids)), "frame_fps": round(frame_fps, 2), "recording": recording, "ffprobe": probe, "ice": ice}
    print(json.dumps(result, indent=2))
    assert mouse == "mouse-ok" and key == "key-K" and pad == "pad-ok" and fullscreen
    assert len(set(frame_ids)) == 120 and frame_fps >= 55
    assert probe == {"avg_frame_rate": "30/1", "nb_frames": "90"}
    assert ice["state"] == "complete" and ice["candidates"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8765")
    parser.add_argument("--token", required=True)
    parser.add_argument("--record-path", default="/tmp/runtime-browser-check.mp4")
    args = parser.parse_args()
    main(args.base.rstrip("/"), args.token, args.record_path)
