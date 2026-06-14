# Connecting GeForce NOW

This is the step-by-step to take an AI agent from the deterministic arcade to a
**real Steam game streamed through GeForce NOW**, scored on the same leaderboard
as humans. The platform is already built — the agent, the gamepad action space,
scoring, the trace, and the leaderboard submit all work today against a mock
session. Going live is wiring **one adapter**: `GeForceNowSession`.

```
 VisionGamepadAgent ──reads frame──▶ RealGameEnv ──GamepadAction──▶ GameSession ──▶ GeForce NOW ──▶ the game
        ▲ pixels                         │ score = bits of unlocked achievements
        └──────────────── obs.frame ◀────┘
```

## Two bridges

There are two ways to deliver the agent's gamepad into GeForce NOW:

- **Browser bridge (recommended; works on macOS) — `runtime/gfn_browser.py`.**
  GeForce NOW's web client reads the **standard Gamepad API**. Playwright drives
  the *real system Chrome* and injects a virtual gamepad into the page
  (`navigator.getGamepads` returns a controllable pad), so the game polls our
  state every frame as if a controller were plugged in. No OS driver, no
  Windows. This is verified working:

  ```bash
  # prove the CLI-simulated gamepad is seen by the browser (no GFN/login needed):
  PYTHONPATH=harness:. ./engine/.venv/bin/python runtime/gfn_browser.py --test

  # prove the FULL loop end-to-end on a self-contained browser game (no login):
  # the CLI gamepad drives a sprite + we capture the frame that proves it moved.
  PYTHONPATH=harness:. ./engine/.venv/bin/python runtime/gfn_browser.py --demo

  # drive GeForce NOW: opens real Chrome — log into NVIDIA + start a game once
  # (the profile is remembered), then a gamepad agent drives it:
  PYTHONPATH=harness:. ./engine/.venv/bin/python runtime/gfn_browser.py --play --agent vision
  ```

  One-time setup: `./engine/.venv/bin/pip install playwright` (driver is bundled;
  `--play` uses your system Chrome via `channel="chrome"`, no `playwright install`
  needed). For `--play` frame capture, grant Terminal/Python **Screen Recording**
  permission so the OS-capture fallback works on the live (GPU-overlay) stream.

  `BrowserGamepadSession` is a `GameSession`, so the existing gamepad agents and
  `RealGameEnv` drive it unchanged. Frames come from the streamed `<video>`;
  because GFN hardware-decodes WebRTC into a GPU overlay, in-page capture can
  read back black — if so, capture the Chrome window with `mss`/`screencapture`
  (headed) instead (grant macOS Screen-Recording permission once).

- **Native bridge (Windows) — `runtime/geforce_now.py`.** A real virtual Xbox
  pad via `vgamepad`/ViGEm + screen-capture of the GFN window. Use this with the
  native GFN app on Windows.

Both implement the same `GameSession` contract below.

## What you provide

| Piece | How |
|------|-----|
| **Frames** (the game screen) | `mss` (or Pillow `ImageGrab`) screen-capture of the GeForce NOW client window. |
| **Input** (drive the game) | A virtual Xbox pad via `vgamepad` (ViGEm, Windows). The agent's `GamepadAction` maps 1:1 to XInput. |
| **Verification** (the score) | Steam Web API `GetPlayerAchievements` for the account that played — read straight from Steam, so nothing can be faked. |

The agent gets exactly a controller — 15 buttons, two sticks, two triggers —
the same affordance a human has. Nothing game-specific is hard-coded.

## Steps

**1. Install the backends** (on the Windows box running the GeForce NOW client):

```bash
pip install vgamepad mss pillow        # virtual pad + fast screen capture
# vgamepad needs the ViGEm bus driver (its installer prompts on first use)
```

**2. Launch the game** on GeForce NOW and note the client window rectangle
`(left, top, width, height)` — that's the capture `region`.

**3. Pre-flight check** — confirm all three backends before playing:

```bash
python runtime/geforce_now_check.py --appid 1245620 \
    --region 0 0 1920 1080 --steamid 7656119XXXXXXXXXX --steam-key $STEAM_API_KEY
```

You want `gamepad ✓` and `capture ✓` (Steam can be verified at submit). It tells
you the exact next step for anything ✗.

**4. Map achievements** — your `AchievementSpec` ids ↔ Steam `apiname`s, so an
unlock on the account counts for the right task. (Identity-mapped if you name
your specs after the apinames.)

**5. Play a real episode** — swap the mock for the live session:

```python
from steambench_harness import RealGameEnv, AchievementSpec, run_episode
from steambench_harness.client import SteamBenchClient
from agents.gamepad_agents import VisionGamepadAgent
from runtime.geforce_now import GeForceNowSession

session = GeForceNowSession(
    appid=1245620,
    region=(0, 0, 1920, 1080),
    steam_key=STEAM_API_KEY, steamid=STEAMID,
    achievement_map={"ELDEN_FIRST_RUNE": "first_rune"},  # steam apiname -> our id
    frame_size=(512, 288),         # downscale for cheaper/faster vision
)
env = RealGameEnv(session, name="Elden Ring",
                  achievements=[AchievementSpec("first_rune", "First Rune", "…", 0.5)])

rec = run_episode(env, VisionGamepadAgent(goal="Defeat the first boss."),
                  max_steps=4000, record_frames=True)
```

**6. Submit** — land it on the leaderboard, verified by Steam:

```python
SteamBenchClient(api_key="sk_sb_...").submit_steam_run(STEAMID, 1245620,
                                                       num_steps=rec.num_steps)
```

The achievements unlocked on the account are read from Steam and scored on the
`−log₂(rarity)` bits scale — head-to-head with humans on the same `steam/<appid>`
board.

## Knobs

- **`frame_size=(w, h)`** — downscale captured frames; vision models are faster
  and cheaper on small frames.
- **`poll_every=N`** — how often to poll Steam (it's rate-limited); the unlocked
  set is cached between polls.
- **`VisionGamepadAgent(policy=...)`** — plug in any vision model; the default
  uses an OpenAI vision model via `OPENAI_API_KEY`. The signature is
  `policy(frame_b64, obs, controls) -> dict | GamepadAction | str`.
- **Not GeForce NOW?** The same `GeForceNowSession` drives a *local* game or a
  capture card — it only screen-captures + injects a pad. For anything more
  exotic, implement the four `GameSession` methods (`start` / `frame` / `apply`
  / `achievements`) against your source.

## Try it now, without the cloud

```bash
PYTHONPATH=harness:. ./engine/.venv/bin/python runtime/realgame_demo.py
```

Runs the whole loop against `MockGameSession` (which renders the live controller
and fires achievements on a schedule) — proof the agent → gamepad → env → score
path works before any game is connected.
