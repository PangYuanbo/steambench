# Connecting GeForce NOW

## Canonical cloud runtime

The production path is deliberately small:

```text
Browserbase Context (login gold copy)
  -> disposable read-only Browserbase Session in us-west-2
  -> Modal NitroGen on RTX PRO 6000 in AWS us-west-2
  -> CDP screencast frames + injected W3C virtual gamepad
```

`runtime/browserbase_gfn.py` is the only lifecycle CLI. Browserbase Contexts are
read-only by default so a bad refresh cannot corrupt the saved login. Use
`--persist` only when intentionally refreshing authentication.

```bash
# One-time: record an existing healthy Context.
BROWSERBASE_API_KEY=... python runtime/browserbase_gfn.py init --context-id CONTEXT_ID

# Normal run: create a disposable session without writing back to the Context.
BROWSERBASE_API_KEY=... python runtime/browserbase_gfn.py start --timeout 21600

# Open the printed Live View, launch the game, then start the deployed agent.
BROWSERBASE_API_KEY=... python runtime/browserbase_gfn.py agent-start --seconds 3500
python runtime/browserbase_gfn.py agent-status

# Stop compute first, then the disposable browser session.
python runtime/browserbase_gfn.py agent-stop
BROWSERBASE_API_KEY=... python runtime/browserbase_gfn.py stop
```

Deploy the policy from the Modal workspace that owns the GPU quota:

```bash
modal profile activate yuanbopang
modal deploy runtime/modal_nitrogen.py
```

Fixed defaults: `1280x720`, JPEG quality `40`, four actions per observation,
`55ms` pacing, and menu buttons masked. The older E2B/HTTP daemons remain
diagnostic fallbacks, not the production path.

## Browser runtime compatibility contract

Any Browserbase replacement must preserve the behavior proven by the current
runtime:

- Keep login state in a persistent profile, but run normal game sessions
  read-only so a failed refresh cannot corrupt the saved account.
- Expose every browser tab. Browserbase Live View URLs bind to a page target,
  so OAuth popups require a new target URL instead of following automatically.
- Support trusted fullscreen. GeForce NOW's `LET'S GO` overlay only cleared
  reliably with CDP `Runtime.evaluate`, `userGesture: true`, and
  `document.documentElement.requestFullscreen()`; ordinary clicks, `F11`, and
  window fullscreen were insufficient.
- Inject the W3C virtual gamepad before the stream starts and re-inject after
  navigation. WebRTC video can receive the gamepad while ignoring CDP mouse
  clicks inside the streamed game.
- Own one long-lived CDP screencast and fan its frames out to inference,
  recording, and Live View. Multiple or repeatedly restarted screencasts caused
  long stalls.
- Preserve full `1280x720` frames. From a Modal AWS Oregon sandbox, one warm
  screencast delivered about `21-23 FPS` while receiving and H.264 encoding;
  repeated streams later degraded to `1-4 FPS` with pauses up to `19s`.
- Recover from GFN network errors, paused sessions, detached page targets, and
  OAuth tabs without replacing the persistent login profile.
- Keep the browser lifecycle independent from GPU scheduling. The browser must
  remain usable while PRO 6000 is queued, and GPU cancellation must not destroy
  login state.

These are compatibility requirements, not Browserbase-specific architecture.
They are the acceptance checks for a future Modal-hosted browser runtime.

## Modal runtime browser

`runtime/modal_runtime_browser.py` is the minimal Browserbase-independent
implementation. It keeps Chrome on an AWS Oregon CPU Sandbox, mounts login
state and recordings on Modal Volumes, and exposes noVNC plus a bearer-token
control API.

```bash
modal profile activate yuanbopang
python runtime/modal_runtime_browser.py start --timeout 21600
python runtime/modal_runtime_browser.py status
python runtime/modal_runtime_browser.py download /recordings/runtime.mp4 output/runtime.mp4
python runtime/modal_runtime_browser.py stop
```

The control API provides `/frame`, `/tabs`, `/goto`, `/tab`, `/reload`,
`/back`, `/forward`, `/fullscreen`, `/mouse`, `/key`, `/pad`, `/cookies`,
`/set_cookie`, `/record/start`, and `/record/stop`. Send the saved
`api_token` as `Authorization: Bearer ...`. `/frame?after=N` blocks until a new
frame exists and returns its sequence in `X-Frame-Id`.

Verified on Modal AWS Oregon at `1280x720`:

- X11 capture loop: `59.99-60.45 FPS`, including 120 consecutive unique frames.
- H.264 recording: exact `30/1 FPS`; a 10.43-second run produced 313 frames.
- Mouse, keyboard, W3C gamepad, multi-tab inspection, and trusted fullscreen.
- GFN login wall rendering while the capture loop remained at about `60 FPS`.
- Cookie state and recording files survived Sandbox stop/start via Modal
  Volumes.

The remaining live acceptance test is a logged-in GFN WebRTC game stream; the
runtime is intentionally left independent from NitroGen GPU scheduling.

Compatibility status against Browserbase:

| Capability | Status | Evidence or remaining work |
| --- | --- | --- |
| Persistent login state | Partial | Playwright cookies and IndexedDB survive restarts through `storage-state.json`; a separate read-only gold-copy workflow is not implemented yet. |
| Human Live View | Verified | Password-protected noVNC exposes the complete desktop rather than one CDP page target. |
| Tabs and OAuth popups | Verified | `/tabs` lists every Playwright page and `/tab` brings a selected target forward. |
| Trusted fullscreen | Verified | `/fullscreen` uses CDP `Runtime.evaluate` with `userGesture: true`. |
| Mouse and keyboard | Verified | Runtime API input was exercised on a local test page. |
| W3C virtual gamepad | Verified outside GFN | The injected pad was exercised on a local test page; a real streamed game still needs verification. |
| Shared visual stream | Verified outside GFN | One X11 capture loop supplies unique 60 Hz frames and 30 FPS recording without starting multiple CDP screencasts. |
| Real GFN WebRTC video | Blocked | The login wall renders, but Chromium in the Modal Sandbox has not produced ICE candidates, so a live game stream is not yet proven. |
| Recovery and session protection | Not implemented | Network-error recovery, detached-target recovery, and disposable sessions cloned from a protected login snapshot remain required. |

Do not treat login-wall FPS as live-game FPS. Browserbase can only be removed
after a real GFN session establishes WebRTC, accepts gamepad input, delivers
stable agent frames, records a valid 30 FPS video, and restarts without
damaging the protected login state.

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
