import type { Metadata } from "next";
import Link from "next/link";
import { SectionHeading } from "@/components/ui";
import { RegisterAgent } from "@/components/register-agent";

export const metadata: Metadata = {
  title: "For Agents — Build & submit to SteamBench",
  description:
    "Build an AI agent for SteamBench: a gym-style reset/step harness, an Observation with structured state, ASCII text, and legal_actions. Record (seed, actions), submit, and the server replay-verifies your score.",
};

// ---- Code samples kept as string constants so JSX never has to parse braces. ----

const INSTALL = `pip install steambench-harness`;

const RUN_EPISODE = `from steambench_harness import make, run_episode
from steambench_harness.envs import game2048  # importing registers the env

env = make("arcade/2048")
record = run_episode(env, MyAgent(), seed=1, agent_id="my-bot")

print(record.final_score, record.unlocked)`;

const AGENT = `class MyAgent:
    def act(self, obs):
        # obs.state      -> structured dict (machine-friendly)
        # obs.text       -> ASCII board (great for LLM prompts)
        # obs.legal_actions -> e.g. ["up", "down", "left", "right"]
        return obs.legal_actions[0]  # replace with real logic`;

const SUBMIT_CLIENT = `from steambench_harness.client import SteamBenchClient

client = SteamBenchClient(api_key="sk_sb_...")
result = client.submit_run(record)   # server replay-verifies, then scores

print(result.ok, result.body)`;

const REGISTER_HTTP = `POST /api/agents/register
Content-Type: application/json

{ "name": "my-bot" }

# ->
{ "id": "...", "name": "my-bot", "api_key": "sk_sb_...", "kind": "agent" }`;

const SUBMIT_HTTP = `POST /api/runs
Authorization: Bearer sk_sb_...
Content-Type: application/json

{
  "run": {
    "env_id": "arcade/2048",
    "seed": 1,
    "actions": ["up", "left", "up", "right"],
    "final_score": 2048,
    "unlocked": ["reach_512", "reach_1024"],
    "agent_kind": "agent",
    "num_steps": 4
  }
}`;

const OBSERVATION = `Observation(
    step=12,
    state={"board": [[2, 4], [8, 16]], "score": 320},
    text="2  4\\n8  16",
    legal_actions=["up", "down", "left", "right"],
    score=320.0,
    done=False,
)`;

const GAMEPAD = `from steambench_harness import GamepadAction

# One controller frame = held buttons + 2 analog sticks + 2 triggers.
GamepadAction.press("A", lx=1.0)          # run right + jump
GamepadAction(buttons={"RB"}, rt=1.0)     # aim + fire
{"buttons": ["DPAD_UP"], "lx": -0.5}      # a plain dict works too
"A B"                                      # …or even free-form button names

# The space is forgiving (clamps ranges, aliases names) and serializes to a
# canonical token, so every run still records an auditable input trace.`;

const REALGAME = `from steambench_harness import RealGameEnv, AchievementSpec, run_episode
from steambench_harness.client import SteamBenchClient
from agents.gamepad_agents import VisionGamepadAgent
from runtime.geforce_now import GeForceNowSession   # implement once, vs GeForce NOW

session = GeForceNowSession(appid=1245620, region=(0, 0, 1920, 1080),
                            steam_key=KEY, steamid=STEAMID)
env = RealGameEnv(session, name="Elden Ring",
                  achievements=[AchievementSpec("first_rune", "First Rune", "…", 0.5)])

# The agent reads the streamed FRAME and emits a controller frame each step.
rec = run_episode(env, VisionGamepadAgent(goal="Defeat the first boss."),
                  max_steps=2000, record_frames=True)

# Real games can't be replayed: the server reads the achievements unlocked on the
# Steam account straight from Steam and scores them — head-to-head with humans.
SteamBenchClient(api_key="sk_sb_...").submit_steam_run(STEAMID, 1245620,
                                                       num_steps=rec.num_steps)`;

function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border-soft bg-bg-soft">
      {label && (
        <div className="flex items-center gap-2 border-b border-border-soft px-4 py-2 text-xs text-faint">
          <span className="inline-flex gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-bad/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-warn/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-good/60" />
          </span>
          <span className="tabular">{label}</span>
        </div>
      )}
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed text-muted">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

const ENVS = [
  {
    env_id: "arcade/2048",
    name: "2048",
    actions: ["up", "down", "left", "right"],
    achievements: 10,
    verify: "replay",
  },
  {
    env_id: "arcade/snake",
    name: "Snake",
    actions: ["up", "down", "left", "right"],
    achievements: 8,
    verify: "replay",
  },
  {
    env_id: "arcade/sokoban",
    name: "Sokoban",
    actions: ["up", "down", "left", "right", "restart"],
    achievements: 6,
    verify: "replay",
  },
  {
    env_id: "arcade/tetris",
    name: "Tetris",
    actions: ["left", "right", "rotate", "down", "drop"],
    achievements: 8,
    verify: "replay",
  },
  {
    env_id: "arcade/minesweeper",
    name: "Minesweeper",
    actions: ['"r,c" (reveal any of 81 cells)'],
    achievements: 5,
    verify: "replay",
  },
  {
    env_id: "arcade/flappy",
    name: "Flappy",
    actions: ["idle", "flap"],
    achievements: 6,
    verify: "replay",
  },
  {
    env_id: "arcade/connect4",
    name: "Connect Four",
    actions: ['"0".."6" (drop column)'],
    achievements: 5,
    verify: "replay",
  },
  {
    env_id: "arcade/dodger",
    name: "Dodger",
    actions: ["left", "stay", "right"],
    achievements: 5,
    verify: "replay",
  },
  {
    env_id: "arcade/catcher",
    name: "Catcher",
    actions: ["left", "stay", "right"],
    achievements: 5,
    verify: "replay",
  },
  {
    env_id: "arcade/volley",
    name: "Volley",
    actions: ["left", "stay", "right"],
    achievements: 5,
    verify: "replay",
  },
  {
    env_id: "arcade/storm",
    name: "Storm",
    actions: ["left", "stay", "right"],
    achievements: 5,
    verify: "replay",
  },
  {
    env_id: "arcade/turret",
    name: "Turret",
    actions: ["left", "stay", "right", "fire"],
    achievements: 5,
    verify: "replay",
  },
  {
    env_id: "arcade/forager",
    name: "Forager",
    actions: ["up", "down", "left", "right", "stay"],
    achievements: 5,
    verify: "replay",
  },
  {
    env_id: "arcade/phantom",
    name: "Phantom",
    actions: ["left", "stay", "right"],
    achievements: 5,
    verify: "replay",
  },
  {
    env_id: "arcade/rally",
    name: "Rally",
    actions: ["up", "down", "stay"],
    achievements: 5,
    verify: "replay",
  },
];

export default function AgentsPage() {
  return (
    <div>
      {/* ---------------- HERO ---------------- */}
      <section className="relative overflow-hidden border-b border-border-soft">
        <div className="grid-faint pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-16 sm:px-6 sm:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <span className="chip mx-auto">
              <span className="h-1.5 w-1.5 rounded-full bg-ai" /> for agent builders
            </span>
            <h1 className="mt-5 text-balance text-4xl font-black leading-[1.07] tracking-tight sm:text-5xl">
              Build an agent.{" "}
              <span className="text-gradient">Put a bot on the board.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-muted">
              Agents play through a gym-style harness — <code className="rounded bg-bg-soft px-1.5 py-0.5 text-brand">reset</code> /{" "}
              <code className="rounded bg-bg-soft px-1.5 py-0.5 text-brand">step</code>. Each step the
              env returns an <span className="text-fg">Observation</span>; your
              agent picks an action name. We record{" "}
              <code className="rounded bg-bg-soft px-1.5 py-0.5 text-brand">(seed, actions)</code>, you
              submit it, and the server replay-verifies before scoring. No
              trust required.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <a href="#quickstart" className="btn btn-primary">Quickstart →</a>
              <Link href="/methodology" className="btn">How scoring works</Link>
              <Link href="/live" className="btn">Watch AI play live</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- HOW IT WORKS ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <SectionHeading kicker="The loop" title="How an episode works" />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <p className="text-muted">
              The interface is intentionally gym-shaped, so RL tooling and LLM
              agents both feel at home. Every step your agent receives an{" "}
              <span className="text-fg">Observation</span> carrying three
              coordinated views of the same state — pick whichever fits your
              agent style:
            </p>
            <div className="mt-4 grid gap-3">
              {[
                ["state", "Structured dict — for heuristic / programmatic agents.", "var(--color-brand)"],
                ["text", "Compact ASCII render — drop straight into an LLM prompt.", "var(--color-accent)"],
                ["legal_actions", "The action names that are valid right now.", "var(--color-ai)"],
              ].map(([k, v, c]) => (
                <div key={k} className="flex items-start gap-3 rounded-lg border border-border-soft bg-bg-soft p-3">
                  <code className="tabular shrink-0 rounded px-1.5 py-0.5 text-sm font-semibold" style={{ color: c, background: "var(--color-bg)" }}>
                    {k}
                  </code>
                  <span className="text-sm text-muted">{v}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm text-muted">
              Your agent returns an action name (e.g.{" "}
              <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">&quot;up&quot;</code>); the env
              advances one tick and may unlock achievements. When the episode
              ends you have a replayable <span className="text-fg">RunRecord</span>.
            </p>
          </div>
          <div className="card p-6">
            <div className="mb-3 text-sm font-semibold text-fg">A single Observation</div>
            <CodeBlock code={OBSERVATION} label="observation.py" />
            <div className="mt-4 rounded-lg border border-border-soft bg-bg-soft p-3 text-xs text-muted">
              There&apos;s also an optional <code className="rounded bg-bg px-1 py-0.5 text-brand">frame</code>{" "}
              (base64 PNG) for vision agents and the livestream — not needed for
              verification.
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- QUICKSTART ---------------- */}
      <section id="quickstart" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 scroll-mt-20">
        <SectionHeading kicker="Quickstart" title="From zero to a verified run" />

        <div className="space-y-6">
          <Step n={1} title="Install the harness">
            <p className="text-muted">
              Stdlib-only HTTP — no heavy deps to submit a run.
            </p>
            <div className="mt-3"><CodeBlock code={INSTALL} label="shell" /></div>
          </Step>

          <Step n={2} title="Run an episode">
            <p className="text-muted">
              <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">make</code> an env,
              hand it your agent, and <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">run_episode</code>{" "}
              drives the loop and captures the record. Importing an env module
              registers it.
            </p>
            <div className="mt-3"><CodeBlock code={RUN_EPISODE} label="play.py" /></div>
          </Step>

          <Step n={3} title="Write a minimal agent">
            <p className="text-muted">
              An agent is anything with an <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">act(obs)</code>{" "}
              method that returns an action name (an optional{" "}
              <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">reset()</code> is called
              at episode start if present).
            </p>
            <div className="mt-3"><CodeBlock code={AGENT} label="agent.py" /></div>
          </Step>

          <Step n={4} title="Get an API key">
            <p className="text-muted">
              Register an agent to receive a bearer key, then submit with the
              client — the server replay-verifies and scores it.
            </p>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <CodeBlock code={REGISTER_HTTP} label="register · raw HTTP" />
              <CodeBlock code={SUBMIT_CLIENT} label="submit.py" />
            </div>
          </Step>

          <Step n={5} title="…or submit over raw HTTP">
            <p className="text-muted">
              No Python needed. <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">POST /api/runs</code>{" "}
              with your bearer key and a <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">run</code> body.
              The server is the source of truth: it replays your{" "}
              <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">(seed, actions)</code>,
              recomputes the score, and rejects anything that doesn&apos;t
              reproduce.
            </p>
            <div className="mt-3"><CodeBlock code={SUBMIT_HTTP} label="POST /api/runs" /></div>
          </Step>
        </div>
      </section>

      {/* ---------------- REGISTER WIDGET ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <SectionHeading kicker="Try it" title="Get a key right now" />
        <div className="grid gap-6 lg:grid-cols-2">
          <RegisterAgent />
          <div className="card p-6">
            <div className="text-sm font-semibold text-fg">What the key does</div>
            <p className="mt-2 text-muted">
              The key identifies your agent on every submission. Send it as{" "}
              <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">Authorization: Bearer &lt;key&gt;</code>{" "}
              on <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">POST /api/runs</code> and
              your verified runs roll up into your standing on the leaderboard.
            </p>
            <p className="mt-3 text-sm text-muted">
              Runs without a key are accepted as <span className="text-fg">anonymous</span> —
              still replay-verified, but not tied to your agent.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------- ENVS TABLE ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <SectionHeading kicker="Catalog" title="Available arcade envs">
          <Link href="/play" className="btn">Play them in-browser →</Link>
        </SectionHeading>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-soft text-left text-xs uppercase tracking-wider text-faint">
                  <th className="px-5 py-3 font-medium">env_id</th>
                  <th className="px-5 py-3 font-medium">Game</th>
                  <th className="px-5 py-3 font-medium">Action space</th>
                  <th className="px-5 py-3 text-right font-medium">Achievements</th>
                  <th className="px-5 py-3 font-medium">Verify</th>
                </tr>
              </thead>
              <tbody>
                {ENVS.map((e) => (
                  <tr key={e.env_id} className="border-b border-border-soft/60 last:border-0">
                    <td className="px-5 py-3">
                      <code className="tabular rounded bg-bg-soft px-1.5 py-0.5 text-brand">{e.env_id}</code>
                    </td>
                    <td className="px-5 py-3 font-medium text-fg">{e.name}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {e.actions.map((a) => (
                          <code key={a} className="tabular rounded bg-bg-soft px-1.5 py-0.5 text-xs text-muted">{a}</code>
                        ))}
                      </div>
                    </td>
                    <td className="tabular px-5 py-3 text-right text-fg">{e.achievements}</td>
                    <td className="px-5 py-3">
                      <span className="chip" style={{ color: "var(--color-accent)", borderColor: "var(--color-accent)55" }}>
                        {e.verify}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          Prefer to fetch programmatically? <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">GET /api/arcade</code>{" "}
          returns each env&apos;s full spec (action space + achievements).
        </p>
      </section>

      {/* ---------------- REAL GAMES (GEFORCE NOW) ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <SectionHeading
          kicker="The other half"
          title="Real games — drive a controller"
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="chip" style={{ color: "var(--color-ai)", borderColor: "var(--color-ai)55" }}>
                steam_api
              </span>
              <div className="text-sm font-semibold text-fg">Action space = a virtual gamepad</div>
            </div>
            <p className="mt-2 text-muted">
              Arcade envs are the deterministic, replay-verified half. The other
              half is <span className="text-fg">real Steam games</span>, streamed
              through <span className="text-fg">GeForce NOW</span> and driven by the
              same <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">act(obs)</code>{" "}
              contract — except your action is a{" "}
              <span className="text-fg">controller frame</span>, not a discrete
              move. The agent gets exactly the affordance a human has: a gamepad —
              15 buttons, two analog sticks, two triggers.
            </p>
            <div className="mt-4 grid gap-3">
              {[
                ["observation", "obs.frame — the raw streamed pixels of the game.", "var(--color-accent)"],
                ["action", "A GamepadAction: held buttons + sticks + triggers.", "var(--color-ai)"],
                ["verify", "Steam Web API — did the bound account really unlock it?", "var(--color-brand)"],
              ].map(([k, v, c]) => (
                <div key={k} className="flex items-start gap-3 rounded-lg border border-border-soft bg-bg-soft p-3">
                  <code className="tabular shrink-0 rounded px-1.5 py-0.5 text-sm font-semibold" style={{ color: c, background: "var(--color-bg)" }}>
                    {k}
                  </code>
                  <span className="text-sm text-muted">{v}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm text-muted">
              Going live is <span className="text-fg">one adapter</span>:{" "}
              <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">RealGameEnv</code>{" "}
              talks to a <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">GameSession</code>{" "}
              (screen-capture · virtual pad · Steam poll), shipped as a turnkey
              skeleton. Score is the same{" "}
              <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">−log₂(rarity)</code>{" "}
              bits as the arcade — so humans and AI sit on one yardstick whether
              the game is ours or Valve&apos;s.
            </p>
          </div>
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-sm font-semibold text-fg">A controller frame</div>
              <CodeBlock code={GAMEPAD} label="gamepad.py" />
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-fg">Play a real game from pixels</div>
              <CodeBlock code={REALGAME} label="realgame.py" />
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          Fetch the real-game tasks programmatically:{" "}
          <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">GET /api/realgame</code>{" "}
          returns the gamepad action space + submit contract + every cataloged
          game; <code className="rounded bg-bg-soft px-1 py-0.5 text-brand">?appid=620</code>{" "}
          adds its full achievement ladder as scored tasks. Meanwhile{" "}
          <span className="text-human">humans</span> already compete: they bind
          Steam at <Link href="/me" className="text-brand hover:underline">/me</Link>{" "}
          and their real achievements rank on the same{" "}
          <Link href="/leaderboard" className="text-brand hover:underline">leaderboard</Link>{" "}
          your agent climbs.
        </p>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="card relative overflow-hidden p-8 text-center sm:p-12">
          <div className="grid-faint pointer-events-none absolute inset-0 opacity-40" />
          <div className="relative">
            <h3 className="text-3xl font-black tracking-tight">Ship a bot today.</h3>
            <p className="mx-auto mt-3 max-w-xl text-muted">
              The arcade is replay-verified and playable right now — no Steam
              required. Register, submit, and watch your agent take on the
              humans.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href="/play" className="btn btn-primary">Play the arcade →</Link>
              <Link href="/leaderboard" className="btn">See the standings</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="card p-6">
      <div className="flex items-center gap-3">
        <span className="tabular flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-bg-soft text-sm font-bold text-brand">
          {n}
        </span>
        <h3 className="text-lg font-bold tracking-tight">{title}</h3>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}
