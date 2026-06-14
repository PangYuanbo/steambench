# SteamBench

**A benchmark where humans and AI agents compete on the same games — scored on one yardstick.**

🔗 **Live:** https://web-iota-steel-12.vercel.app · 🤖 **Watch AI play live:** [/live](https://web-iota-steel-12.vercel.app/live) · 🎮 **Play:** [/play](https://web-iota-steel-12.vercel.app/play)

---

## The idea

Steam publishes, for almost every game, the **global unlock percentage** of each
achievement — the fraction of all owners who have ever earned it. That number is
a crowd-sourced difficulty signal collected from tens of millions of players.

SteamBench turns it into a calibrated benchmark using **information theory**. If a
fraction `p` of players unlock an achievement, observing a given player do it
carries

```
difficulty = -log₂(p)   bits of "surprise"
```

This single unit is the spine of the whole system:

- **Monotonic** — rarer is harder, unbounded above.
- **Additive** — two independent 10% achievements ≈ one 1% achievement, in bits, so summing bits over a game gives "total information to 100% it".
- **Legible** — it bands into tiers (each a ~halving of the population): Tutorial → Easy → Medium → Hard → Elite → Legendary.
- **Universal** — leaderboard placements ("top 1%") map onto the *same* bits scale as achievements, and so do original arcade games. Humans and AI are scored identically.

Points are `100 × bits`. A 50%-of-players achievement is worth 100 pts; a
0.1%-of-players one is worth ~1000.

> Built from **real, public Steam data** (no API key required): 97 games, **9,800+
> real achievements** with names + icons, tiered by live global rarity —
> including 77 sub-0.1% "Legendary" objectives. Browse them all in the
> [difficulty atlas](https://web-iota-steel-12.vercel.app/atlas).

## What's live today

| | |
|---|---|
| 🎯 **Real Steam catalog** | 97 popular games, 9,800+ achievements (with real names + icons), each tiered by real global rarity. Browse the full difficulty ladder per game, or the cross-game [difficulty atlas](https://web-iota-steel-12.vercel.app/atlas). |
| 🕹️ **Playable arcade** | 15 original, headless, fully-deterministic games — **2048** (puzzle), **Snake** (reflex), **Sokoban** (planning), **Tetris** (stacking), **Minesweeper** (deduction), **Flappy** (timing), **Connect Four** (adversarial), and an eight-game **vision** suite: **Dodger** (avoid), **Catcher** (catch-vs-avoid), **Volley** (motion), **Storm** (multi-object), **Turret** (aim + fire), **Forager** (2D navigation), **Phantom** (memory/occlusion), **Rally** (adversarial Pong) — with Steam-style achievement ladders. Humans play in the browser; agents play via the Python harness — **both verified the same way.** |
| 🧑‍🤝‍🤖 **Humans vs AI** | One leaderboard, two camps, plus a per-game **Elo** that pits the best human against the best AI. |
| 📺 **Live AI play** | Watch an AI play any of the 15 games move-by-move with its reasoning streamed in real time (SSE) — an LLM when a key is configured, otherwise a strong per-game AI (BFS Snake, El-Tetris planner, Minesweeper solver, Dodger/Catcher/Storm rollouts, Volley bounce-predictor, Turret aim-and-fire, Forager 2D-navigator, Phantom memory, Rally duel, …). The finished run is replay-verified and posted to the board. |
| 🔌 **Steam binding** | "Sign in through Steam" (OpenID 2.0) and score your *real* achievements — works keyless via public Steam endpoints. |
| ☁️ **Remote runtime** | A Modal app runs the reference agents and submits verified runs to the live API — the "agents run somewhere and score" path. |
| 🎥 **Native pixel runtime → scored** | The frontier, now *first-class benchmark games*: an **eight-game vision suite** runs as real rendered games on Modal, and a **vision agent reads raw pixels** (not state) across the full capability spectrum — avoid (Dodger), *good* vs *bad* (Catcher), single-object **motion** (Volley), **multi-object tracking** (Storm), **aim + fire targeting** (Turret), **free 2D navigation** (Forager), **memory under occlusion** (Phantom: the screen blinks dark, so the agent must *remember* what it can't see — its recalled positions are drawn on the overlay), and **adversarial play** (Rally: a Pong duel vs a built-in opponent) — with perception overlaid live at [/native](https://web-iota-steel-12.vercel.app/native), then **submits its pixel run to the leaderboard, replay-verified on the same engine that checks humans.** Eight modalities prove the pixels-in/inputs-out runtime generalizes; each is also playable from structured state. |
| 🎮 **Real games via GeForce NOW** | The platform's real-game half: an agent's **action space is a virtual gamepad** (15 buttons + 2 analog sticks + 2 triggers), its observation is the streamed frame, and a run is verified out-of-band via the **Steam Web API**. **The browser bridge is built + verified** (`runtime/gfn_browser.py`): Playwright drives real Chrome and injects a virtual gamepad through the **standard Gamepad API** that GeForce NOW web reads, so the agent's controller frames drive a real streamed game — `--test` proves the simulated pad is seen by the browser exactly like a physical controller. (A native ViGEm/Windows bridge — `runtime/geforce_now.py` — is also provided.) This is how an AI plays a *real* Steam game on the very same benchmark a human does — the agent gets exactly the affordance a human has: a controller. |

## Verification — why scores can't be faked

Every arcade run is **deterministic** given `(seed, actions)`: all randomness comes
from a portable **Mulberry32** PRNG that is *bit-for-bit identical in Python and
TypeScript* (cross-checked against Node — see `harness/tests/test_rng.py`). So:

- A human plays in the browser (TypeScript env) → records `(seed, actions)`.
- An agent plays in Python (same env) → records `(seed, actions)`.
- The server **replays the action trace** on a fresh env and recomputes the score. If the claimed score doesn't match the replay, the run is rejected.

This is live: submitting a run claiming 99,999 points returns
`422 — score mismatch: claimed 99999, replayed 43`.

Real Steam games can't be replayed, so they use a second `VerifyMode`
(`steam_api`): the agent drives the game through a **virtual gamepad** (the same
controller a human holds) and the unlocked achievement is confirmed out-of-band
via the Steam Web API. One protocol, two verification backends — see
`harness/steambench_harness/{gamepad,realgame}.py`.

## Real games — the GeForce NOW bridge

Arcade envs are the cheat-proof, deterministic half. The other half is **real
Steam games**, streamed through GeForce NOW and driven by the *same agent
contract* — except the action space is a controller, not a discrete move:

- **Action space = a virtual Xbox gamepad** (`steambench_harness.gamepad`): a
  per-frame `GamepadAction` of held buttons + two analog sticks + two triggers.
  The agent gets exactly the affordance a human has — a controller — and nothing
  more. The space is forgiving (accepts a `GamepadAction`, a dict, a token, or
  free-form button names from an LLM) and serializes to a canonical token, so
  every run still records an auditable input trace.
- **Observation = the streamed frame.** A vision agent reads raw pixels and
  emits controller frames (`agents/gamepad_agents.py::VisionGamepadAgent`, with a
  pluggable model — default OpenAI vision).
- **Verification = Steam Web API.** A run's score is the information-theoretic
  value (same `−log₂(rarity)` bits) of the achievements the *bound Steam account*
  actually unlocked — so real and arcade games sit on one scale.
- **One adapter to go live.** `RealGameEnv` talks to a `GameSession`; implement
  its four methods against GeForce NOW. `runtime/geforce_now.py` is a turnkey
  skeleton — `mss` screen-capture · `vgamepad`/ViGEm virtual pad · Steam
  `GetPlayerAchievements` — so everything above the adapter (agent, scoring,
  trace, stream) is unchanged.

It runs end-to-end **today** against a mock session (no cloud, no real game):

```bash
PYTHONPATH=harness:. ./engine/.venv/bin/python runtime/realgame_demo.py        # play the loop (mock session)
PYTHONPATH=harness ./engine/.venv/bin/python runtime/geforce_now_check.py --appid 1245620  # pre-flight readiness
```

The first shows the agent pressing buttons, achievements unlocking, and the
final Steam-verified score. The second checks the three backends (virtual pad ·
screen capture · Steam) before you go live. Full wiring walkthrough:
**[CONNECTING_GEFORCE_NOW.md](CONNECTING_GEFORCE_NOW.md)**.

## Architecture

```
                    ┌─────────────────────────── Vercel (Next.js 16) ───────────────────────────┐
                    │  Pages: landing · leaderboard · games browser · play · live · agents · me  │
  Real Steam data   │  API:  /catalog /games /leaderboard /runs(POST=verify+score) /stats        │
  (public endpoints)│        /arcade /auth/steam/* /steam/score /agents/register /live/stream(SSE)│
        │           │  Verifier: TS arcade envs replay (seed, actions) ── identical to Python     │
        ▼           └───────────────▲───────────────────────────────────────────▲────────────────┘
  scripts/ingest ──► data/seed/*.json                       POST verified runs   │ live LLM moves
        │            (catalog, leaderboard, runs)                    │            │ (OpenAI, SSE)
        ▼                    ▲                                       │            │
  engine/  ── difficulty (−log₂ rarity) · scoring · Elo ────────────┘    ┌───────┴────────┐
  (pure Python, 17 tests)                                                │ humans (browser)│
        ▲                                                                └────────────────┘
        │                                                          ┌──── Modal (remote runtime) ───┐
  harness/ ── gym-style protocol · deterministic arcade envs ──────│ runs expectimax/bfs/random,   │
  (38 tests) · Mulberry32 PRNG · replay-verify                     │ submits verified runs to API  │
        ▲                                                          └───────────────────────────────┘
  agents/  ── random · expectimax(2048) · BFS(snake) · BFS-solver(sokoban) · placement(tetris) · solver(minesweeper) · reflex(flappy) · minimax(connect4) · rollout(dodger,catcher,storm) · predict(volley,rally) · aim(turret) · nav(forager) · memory(phantom) · CV-vision(8 games; pixels) · LLM(OpenAI)
```

## Repository layout

```
engine/    Pure-Python scoring brain (stdlib only). difficulty · catalog · scoring · ingest. 17 tests.
harness/   Agent protocol, 15 deterministic arcade envs (2048, Snake, Sokoban, Tetris, Minesweeper, Flappy, Connect Four, Dodger, Catcher, Volley, Storm, Turret, Forager, Phantom, Rally), Mulberry32 PRNG, replay-verify, + the real-game half: gamepad.py (virtual-controller action space) & realgame.py (RealGameEnv + GameSession adapter contract + a mock session). 86 tests.
agents/    Reference agents: random, expectimax (2048), BFS (Snake), BFS solver (Sokoban), placement-search (Tetris), constraint-solver (Minesweeper), reaction-heuristic (Flappy), minimax (Connect Four), rollout (Dodger, Catcher, Storm), bounce-predictor (Volley), aim+fire (Turret), potential-field nav (Forager), Hamiltonian (Snake), LLM (OpenAI), gamepad_agents.py (random/scripted/vision controller agents for real games), + run_demo. The vision envs are shared bit-for-bit with the pixel runtime, so their CV vision agents' pixel runs replay-verify here too.
scripts/   ingest_seed.py (real Steam → catalog) · run_tournament.py (seed leaderboard) · gen_fixtures.py
runtime/   Modal apps: modal_app.py (remote agent runtime → submits verified runs),
           store_service.py (durable run store), modal_pixel.py + pixel_game.py
           (8 rendered vision games + CV agents → stream frames to /native; their
           pixel runs are submittable to the board, replay-verified).
           gfn_browser.py (BROWSER GeForce NOW bridge: Playwright drives real
           Chrome + injects a virtual gamepad via the standard Gamepad API GFN
           web reads — verified; --test / --play) · geforce_now.py (native
           ViGEm/Windows GameSession) · geforce_now_check.py (pre-flight check) ·
           realgame_demo.py (the gamepad → real-game loop vs a mock session).
           frame_buffer.py (research-link runtime: open any game ready-to-run with
           a 120Hz video buffer + a separate 60Hz screenshot buffer the agent
           reads; --serve opens it as a browser-viewable MJPEG stream window).
web/       Next.js 16 + React 19 + Tailwind v4 app (frontend + API). TS port of the arcade envs in src/lib/arcade.
data/      Generated seed catalog, leaderboard, runs, and cross-language replay fixtures.
```

## Run it

```bash
# --- Python core (engine + harness) ---
cd engine && python3 -m venv .venv && .venv/bin/pip install pytest
.venv/bin/python -m pytest                       # 17 engine tests
(cd ../harness && PYTHONPATH=. ../engine/.venv/bin/python -m pytest)   # 86 harness tests

# --- Watch an agent play + get replay-verified ---
./engine/.venv/bin/python agents/run_demo.py --env arcade/2048 --agent expectimax
./engine/.venv/bin/python agents/run_demo.py --env arcade/snake --agent bfs
./engine/.venv/bin/python agents/run_demo.py --env arcade/sokoban --agent sokoban
./engine/.venv/bin/python agents/run_demo.py --env arcade/tetris --agent tetris
./engine/.venv/bin/python agents/run_demo.py --env arcade/snake --agent hamiltonian
./engine/.venv/bin/python agents/run_demo.py --env arcade/dodger --agent dodger
./engine/.venv/bin/python agents/run_demo.py --env arcade/catcher --agent catcher
./engine/.venv/bin/python agents/run_demo.py --env arcade/volley --agent volley
./engine/.venv/bin/python agents/run_demo.py --env arcade/storm --agent storm
./engine/.venv/bin/python agents/run_demo.py --env arcade/turret --agent turret
./engine/.venv/bin/python agents/run_demo.py --env arcade/forager --agent forager
./engine/.venv/bin/python agents/run_demo.py --env arcade/phantom --agent phantom
./engine/.venv/bin/python agents/run_demo.py --env arcade/rally --agent rally

# --- Put your own bot on the LIVE board (turnkey: play -> verify -> submit) ---
PYTHONPATH=harness:. ./engine/.venv/bin/python examples/example_agent.py

# --- Real game via a virtual gamepad (the GeForce NOW path, mock session) ---
PYTHONPATH=harness:. ./engine/.venv/bin/python runtime/realgame_demo.py
PYTHONPATH=harness:. ./engine/.venv/bin/python runtime/realgame_demo.py --agent vision  # needs OPENAI_API_KEY

# --- Rebuild the real Steam catalog + seed leaderboard ---
./engine/.venv/bin/python scripts/ingest_seed.py
./engine/.venv/bin/python scripts/run_tournament.py

# --- Web app ---
cd web && npm install && npm run dev            # http://localhost:3000

# --- Deploy ---
# Pushes to `main` auto-deploy via Vercel's GitHub integration
# (project root directory = claude/web). No manual step needed:
git push                                         # → Vercel builds + deploys the web app
cd web && vercel --prod                          # (or deploy manually)
modal run runtime/modal_app.py                   # run agents remotely, submit to the live API
```

The LLM agent and the `/live` stream use `OPENAI_API_KEY`. Steam binding and the
catalog need **no** keys (public endpoints); set `STEAM_API_KEY` only for nicer
achievement labels.

## Reference results (replay-verified)

| Game | Agent | Best score | Achievements | Notes |
|------|-------|-----------:|:------------:|-------|
| 2048 | expectimax (depth-2) | 38,512 | 8/10 | reliably reaches the **2048 tile** (4.5% rarity) |
| Snake | Hamiltonian cycle | 141 (len 144) | 8/8 | **fills the whole board** — the AI ceiling |
| Snake | BFS + flood-fill | 43 (len 45) | 7/8 | reaches **Ouroboros** (0.7% rarity) |
| Sokoban | BFS solver | 600 | 6/6 | solves all levels (mastery 1.0) |
| Tetris | placement search (El-Tetris) | 46,200 | 8/8 | clears 100+ lines, scores a **TETRIS** |
| Minesweeper | constraint solver | 71 (all safe) | 5/5 | **wins** ~4/5 boards by deduction |
| Flappy | aim-for-gap heuristic | 135 pipes | 6/6 | threads gaps indefinitely (random crashes at 0) |
| Connect Four | alpha-beta minimax | 6-0 sweep | 5/5 | sweeps the bot every series (random goes 0-6) |
| Dodger | rollout look-ahead (state) | 1,500 (capped) | 5/5 | survives indefinitely — reaches **Matrix** (0.6% rarity) |
| Dodger | CV vision (pixels) | ~1,065 avg, 1,500 max | up to 5/5 | reads **rendered pixels** on Modal + same look-ahead; pixel run replay-verifies here |
| Catcher | rollout (state) | 147 caught | 5/5 | catches good, dodges bad — reaches **Event Horizon** (0.6%) |
| Catcher | CV vision (pixels) | ~50–80 caught | 3-4/5 | **two-class** pixel perception (good vs bad) on Modal; run replay-verifies here |
| Volley | predict-the-bounce (state) | 205 bounces | 5/5 | simulates the ball forward to the landing — reaches **Unbreakable** (0.6%) |
| Volley | CV vision (pixels) | ~60 bounces | 4/5 | **temporal** vision: infers velocity by differencing frames; run replay-verifies here |
| Storm | rollout (state) | 1,834 ticks | 5/5 | dodges blocks at varying speeds — reaches **Eye of the Storm** (0.6%) |
| Storm | CV vision (pixels) | ~770 ticks | up to 5/5 | **multi-object** vision: tracks several blocks + infers each speed; run replay-verifies |
| Turret | aim + fire (state) | 237 hits | 5/5 | shoots descending targets — reaches **Annie Oakley** (0.6%) |
| Turret | CV vision (pixels) | ~120 hits | up to 5/5 | **targeting** vision: detects targets/cannon/bullet, aims, fires; run replay-verifies |
| Forager | potential field (state) | ~64–112 collected | up to 4/5 | roams 2D, collects + dodges roaming hazards |
| Forager | CV vision (pixels) | ~52 collected | up to 4/5 | **2D-navigation** vision: connected-component blobs + potential field; run replay-verifies |
| Phantom | memory (state) | ~1,486 ticks | 5/5 | remembers blocks through the blackout — reaches **Mind's Eye** (0.6%) |
| Phantom | CV vision (pixels) | ~1,486 ticks | 5/5 | **memory** vision: recalls blocks through the dark (a no-memory agent gets ~52 → 28× worse); run replay-verifies |
| Rally | predict-the-volley (state) | 157 returns | 5/5 | out-lasts the attacking opponent — reaches **Untouchable** |
| Rally | CV vision (pixels) | ~78–157 returns | 4-5/5 | **adversarial** vision: infers ball motion, returns the opponent's shots; run replay-verifies |
| 2048 | random | 2,288 | 3/10 | the floor |

## Honesty notes

- Steam achievement **percentages, names, owner estimates** are real, pulled from
  public endpoints (`GetGlobalAchievementPercentagesForApp`, the store API, SteamSpy).
- Arcade achievement rarities are *designed* (and converge to crowd-measured
  values as people play) — exactly how a freshly-released Steam game's
  achievements start at 0% and settle over time.
- Live submissions persist in a **durable Modal-hosted store** (`modal.Dict`,
  `runtime/store_service.py`) shared across all Vercel instances, with an
  in-memory fallback if it's unreachable; the seed catalog + reference runs are
  always baked in. A Postgres schema (`web/src/lib/db.schema.ts`) is also
  provided as an alternative backend.
