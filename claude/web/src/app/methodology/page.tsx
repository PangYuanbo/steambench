import type { Metadata } from "next";
import Link from "next/link";
import { getSummary } from "@/lib/data";
import { rarityToBits } from "@/lib/difficulty";
import { SectionHeading, Stat, TierBadge, fmtPct } from "@/components/ui";
import { TIER_LABEL, type Tier } from "@/lib/types";

export const metadata: Metadata = {
  title: "Methodology — How SteamBench scores everything",
  description:
    "How SteamBench turns Steam achievement rarity into information-theoretic difficulty: −log₂(p) bits, six tiers, a points economy, per-game mastery, Human-vs-AI Elo, and deterministic replay verification.",
};

// Tier lower-bounds in bits, walked high -> low. Replicated from difficulty.ts
// (which intentionally doesn't export bitsToTier) so the live table below is
// self-contained and shows exactly which band each rarity lands in.
const TIER_BANDS: { threshold: number; tier: Tier; population: string }[] = [
  { threshold: 9.965784, tier: "legendary", population: "< 0.1%" },
  { threshold: 6.643856, tier: "elite", population: "0.1% – 1%" },
  { threshold: 4.321928, tier: "hard", population: "1% – 5%" },
  { threshold: 2.321928, tier: "medium", population: "5% – 20%" },
  { threshold: 1.0, tier: "easy", population: "20% – 50%" },
  { threshold: 0.0, tier: "tutorial", population: "> 50%" },
];

function bandFor(bits: number): { tier: Tier; population: string } {
  for (const b of TIER_BANDS) {
    if (bits >= b.threshold) return { tier: b.tier, population: b.population };
  }
  return { tier: "tutorial", population: "> 50%" };
}

// Mono / formula token helper for inline math-y spans.
function Tok({ children, c }: { children: React.ReactNode; c?: string }) {
  return (
    <code
      className="tabular rounded bg-bg-soft px-1.5 py-0.5 text-[0.85em]"
      style={c ? { color: c } : { color: "var(--color-brand)" }}
    >
      {children}
    </code>
  );
}

export default async function MethodologyPage() {
  const summary = getSummary();
  const hardest = summary.hardest_overall[0];
  const hardestBits = hardest ? rarityToBits(hardest.percent / 100) : 0;

  // Live rarity -> bits table.
  const examples = [80, 50, 20, 9, 5, 1, 0.4, 0.05].map((percent) => {
    const bits = rarityToBits(percent / 100);
    const { tier, population } = bandFor(bits);
    const points = Math.max(5, Math.round(100 * bits));
    return { percent, bits, tier, population, points };
  });

  const tierMaxCount = Math.max(1, ...Object.values(summary.by_tier));

  return (
    <div>
      {/* ---------------- HERO ---------------- */}
      <section className="relative overflow-hidden border-b border-border-soft">
        <div className="grid-faint pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-16 sm:px-6 sm:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <span className="chip mx-auto">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> the science
            </span>
            <h1 className="mt-5 text-balance text-4xl font-black leading-[1.07] tracking-tight sm:text-5xl">
              How SteamBench scores <span className="text-gradient">everything</span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-muted">
              One idea runs through the whole benchmark: an achievement&apos;s{" "}
              <span className="text-fg">global unlock rarity</span> is a
              crowd-sourced difficulty signal, and information theory turns it
              into a single, additive, unbounded number of{" "}
              <span className="text-fg">bits</span>. Every downstream value —
              tiers, points, mastery, Human-vs-AI Elo — flows from that one
              conversion. Nothing here is vibes.
            </p>
          </div>

          <div className="mx-auto mt-10 grid max-w-3xl grid-cols-3 gap-4">
            <Stat label="Steam games" value={summary.num_games} sub="tiered by real rarity" accent="var(--color-brand)" />
            <Stat label="Objectives" value={summary.total_tasks} sub="on one bits scale" />
            <Stat
              label="Hardest objective"
              value={hardest ? `${fmtPct(hardest.percent)}%` : "—"}
              sub={hardest ? `${hardest.name} · ${hardest.points} pts` : undefined}
              accent="var(--color-elite)"
            />
          </div>
        </div>
      </section>

      {/* ---------------- RARITY -> BITS ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <SectionHeading kicker="Step 1" title="Rarity → bits" />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <p className="text-muted">
              Steam publishes, for almost every game, the{" "}
              <span className="text-fg">global unlock percentage</span> of each
              achievement — the fraction of all owners who have ever unlocked it,
              measured across tens of millions of players. If a fraction{" "}
              <Tok>p</Tok> of players unlock an achievement, watching one player
              do it carries
            </p>

            <div className="my-5 rounded-xl border border-border-soft bg-bg-soft p-5 text-center">
              <div className="tabular text-2xl font-bold text-fg">
                bits <span className="text-faint">=</span>{" "}
                <span className="text-brand">−log₂(p)</span>
              </div>
              <div className="mt-2 text-xs text-muted">
                Shannon self-information (&ldquo;surprisal&rdquo;). Rarity{" "}
                <Tok>p</Tok> is a fraction in <Tok>(0, 1]</Tok>; we clamp the
                floor at <Tok>p = 0.01%</Tok> (≈ 13.3 bits) so a single
                near-zero achievement can&apos;t mint infinite points.
              </div>
            </div>

            <p className="text-muted">Bits make an ideal difficulty unit because they are:</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li className="flex gap-2">
                <span className="text-brand">▸</span>
                <span className="text-muted">
                  <span className="text-fg">Monotonic &amp; unbounded</span> — rarer
                  is always harder, with no ceiling.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-brand">▸</span>
                <span className="text-muted">
                  <span className="text-fg">Additive</span> for independent
                  objectives. Two unrelated 10%-achievements are exactly as
                  surprising as one 1%-achievement:{" "}
                  <Tok>−log₂(0.1) + −log₂(0.1) = −log₂(0.01)</Tok>. So summing
                  bits across a game yields a meaningful &ldquo;total information
                  to 100% it.&rdquo;
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-brand">▸</span>
                <span className="text-muted">
                  <span className="text-fg">Legible</span> — each whole bit is
                  roughly a halving of the population, so bits band cleanly into
                  tiers.
                </span>
              </li>
            </ul>
          </div>

          <div className="card overflow-hidden p-6">
            <div className="text-sm font-semibold text-fg">
              Live: rarity → bits → tier → points
            </div>
            <div className="mt-1 text-xs text-muted">
              Computed right now with <Tok>rarityToBits</Tok> from the same
              engine the catalog uses.
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-soft text-left text-xs uppercase tracking-wider text-faint">
                    <th className="pb-2 pr-3 font-medium">Unlock %</th>
                    <th className="pb-2 pr-3 text-right font-medium">Bits</th>
                    <th className="pb-2 pr-3 text-right font-medium">Points</th>
                    <th className="pb-2 font-medium">Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {examples.map((e) => (
                    <tr key={e.percent} className="border-b border-border-soft/60 last:border-0">
                      <td className="tabular py-2 pr-3 text-fg">{e.percent}%</td>
                      <td className="tabular py-2 pr-3 text-right text-brand">{e.bits.toFixed(2)}</td>
                      <td className="tabular py-2 pr-3 text-right text-fg">{e.points}</td>
                      <td className="py-2"><TierBadge tier={e.tier} small /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 rounded-lg border border-border-soft bg-bg-soft p-3 text-xs text-muted">
              Notice the curve: dropping from 80% to 50% adds ~0.7 bits, but
              going from 1% to 0.05% adds another ~4.3 — rarity buys
              exponentially more difficulty as it shrinks.
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- TIERS ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <SectionHeading kicker="Step 2" title="Six difficulty tiers" />
        <div className="card p-6">
          <p className="text-muted">
            Bits bucket into six human-legible bands. Each step up is roughly a
            halving (or more) of the player population that reaches it. The
            counts below are the real distribution across all{" "}
            <span className="text-fg">{summary.num_games}</span> games and{" "}
            <span className="text-fg">{summary.total_tasks}</span> objectives in
            the catalog.
          </p>
          <div className="mt-6 space-y-3">
            {TIER_BANDS.map(({ tier, population }) => {
              const count = summary.by_tier[tier] || 0;
              const pct = (count / summary.total_tasks) * 100;
              return (
                <div key={tier} className="flex items-center gap-3">
                  <span className="w-24 shrink-0">
                    <TierBadge tier={tier} small />
                  </span>
                  <span className="w-28 shrink-0 text-xs text-muted">{population} of players</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-bg-soft">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(count / tierMaxCount) * 100}%`, background: "var(--color-border)" }}
                    />
                  </div>
                  <span className="tabular w-12 shrink-0 text-right text-sm text-fg">{count}</span>
                  <span className="tabular hidden w-14 shrink-0 text-right text-xs text-faint sm:inline">
                    {pct.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-5 rounded-lg border border-border-soft bg-bg-soft p-3 text-xs text-muted">
            Legendary objectives (&lt; 0.1% of players) are vanishingly rare —
            the current catalog has{" "}
            <span className="tabular text-fg">{summary.by_tier.legendary || 0}</span>{" "}
            of them. The hardest objective on record is{" "}
            <span className="text-fg">{hardest?.name}</span> in{" "}
            <span className="text-fg">{hardest?.game}</span>, an{" "}
            <span className="tabular text-elite">{fmtPct(hardest?.percent ?? 0)}%</span>{" "}
            {hardest ? TIER_LABEL[hardest.tier].toLowerCase() : ""} unlock worth{" "}
            <span className="tabular text-fg">{hardest?.points}</span> points.
          </div>
        </div>
      </section>

      {/* ---------------- POINTS & MASTERY ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <SectionHeading kicker="Step 3" title="Points &amp; mastery" />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <div className="text-sm font-semibold text-fg">Points: a linear economy on bits</div>
            <div className="my-4 rounded-xl border border-border-soft bg-bg-soft p-4 text-center">
              <div className="tabular text-lg font-bold text-fg">
                points <span className="text-faint">=</span> max(
                <span className="text-accent">5</span>, round(
                <span className="text-brand">100 × bits</span>))
              </div>
            </div>
            <p className="text-muted">
              A 50%-unlock achievement is 1 bit → <Tok>100</Tok> points. A
              0.1%-unlock is ~9.97 bits → ~<Tok>997</Tok> points. The floor of{" "}
              <Tok c="var(--color-accent)">5</Tok> keeps even a trivial
              &ldquo;press start&rdquo; objective from being literally worthless.
              Points are the <span className="text-fg">absolute</span> measure of
              how much rare stuff a player has done.
            </p>
          </div>

          <div className="card p-6">
            <div className="text-sm font-semibold text-fg">Mastery: a normalized 0–1 per game</div>
            <div className="my-4 rounded-xl border border-border-soft bg-bg-soft p-4 text-center">
              <div className="tabular text-lg font-bold text-fg">
                mastery <span className="text-faint">=</span>{" "}
                <span className="text-brand">earned_bits</span>{" "}
                <span className="text-faint">/</span>{" "}
                <span className="text-accent">total_bits</span>
              </div>
            </div>
            <p className="text-muted">
              Per game, mastery is the fraction of that game&apos;s total
              difficulty (in bits) a player has captured — a number in{" "}
              <Tok>[0, 1]</Tok>. The overall leaderboard score sums it across
              games, weighted by popularity:
            </p>
            <div className="my-4 rounded-lg border border-border-soft bg-bg-soft p-3 text-center text-sm">
              <span className="tabular text-fg">
                weighted_score = Σ ( mastery × popularity_weight × 1000 )
              </span>
            </div>
          </div>
        </div>

        <div className="card mt-6 p-6">
          <div className="text-sm font-semibold text-fg">Why mastery, not raw count?</div>
          <p className="mt-2 text-muted">
            Because bits are additive, mastery rewards{" "}
            <span className="text-fg">difficulty</span>, not busywork. Clearing
            one Legendary objective (~10 bits) can move your mastery more than
            grinding a dozen Tutorial unlocks (each &lt; 1 bit) — exactly the
            ordering you want from a benchmark. It also separates two questions a
            naive points-only board conflates: <em>&ldquo;who is best&rdquo;</em>{" "}
            vs <em>&ldquo;who tried the most games.&rdquo;</em> Mastery is per-game
            and bounded, so playing more games can&apos;t inflate it past the real
            ceiling.
          </p>
        </div>
      </section>

      {/* ---------------- TASK SUITABILITY (TAXONOMY) ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <SectionHeading kicker="Step 4" title="Which achievements actually test skill?" />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <p className="text-muted">
              Rarity tells you <span className="text-fg">how</span> hard an achievement is — not{" "}
              <span className="text-fg">why</span>. A 1%-unlock can be a real skill feat, a 100-hour
              grind, or pure multiplayer luck. A good benchmark task is hard because of{" "}
              <span className="text-ai">skill</span> — the kind a stronger player or agent is
              meaningfully more likely to earn. So each achievement is also classified by what it
              actually measures:
            </p>
            <div className="mt-4 space-y-2 text-sm">
              {[
                ["Skill", "var(--color-ai)", "Constraints + mastery — no-damage, deathless, speedruns, highest difficulty. The benchmark gold standard."],
                ["Progression", "var(--color-faint)", "Story / campaign completion. Most engaged players reach it — measures time, not ability."],
                ["Grind", "var(--color-warn)", "Collection, repetition, time-gated. Measures persistence."],
                ["Social / luck", "var(--color-accent)", "Multiplayer or chance — confounded by other players."],
                ["Misc", "var(--color-muted)", "No clear textual signal; rarity is the only cue."],
              ].map(([label, color, desc]) => (
                <div key={label} className="flex gap-2.5">
                  <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                  <div>
                    <span className="font-semibold" style={{ color }}>{label}</span>
                    <span className="text-muted"> — {desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-6">
            <div className="text-sm font-semibold text-fg">The benchmark-grade signal</div>
            <p className="mt-2 text-muted">
              Each achievement gets a{" "}
              <code className="rounded bg-bg-soft px-1.5 py-0.5 text-brand">benchmark_grade</code>{" "}
              (0–1): high for <span className="text-ai">skill</span> challenges in the{" "}
              <span className="text-fg">discriminating band</span> — roughly 0.5–25% unlock, where
              ability actually separates players. Sub-0.1% often tips into luck or grind; above ~40%
              is near-universal. It&apos;s derived from the achievement&apos;s name, description and
              live rarity.
            </p>
            <p className="mt-3 text-muted">
              This is a <span className="text-fg">transparent lens, not a scoring change</span> — the
              board still ranks by −log₂(rarity) bits. It answers the design question: of everything
              on Steam, which objectives are worth pitting an agent (or a human) against. See it on
              the <Link href="/atlas" className="text-brand hover:underline">atlas</Link>, on each
              game page, or via{" "}
              <code className="rounded bg-bg-soft px-1.5 py-0.5 text-brand">/api/realgame</code>.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------- HUMANS VS AI ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <SectionHeading kicker="Step 5" title="Humans vs AI: Elo" />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <p className="text-muted">
              Raw points answer <span className="text-fg">&ldquo;how good is this
              player, absolutely?&rdquo;</span> They don&apos;t answer{" "}
              <span className="text-fg">&ldquo;are humans or AI better,
              head-to-head?&rdquo;</span> For that we run an Elo tournament out of
              per-game matches.
            </p>
            <ol className="mt-4 space-y-3 text-sm">
              {[
                ["Find shared games", "Whenever a human and an agent have both attempted the same game, that game is a match."],
                ["Compare earned bits", "The side with more earned-bits in that game wins → result 1.0 (win), 0.5 (draw), or 0.0 (loss)."],
                ["Update Elo", "Apply one logistic Elo update per match with K = 24, pooling all humans into one camp and all agents into another."],
              ].map(([title, body], i) => (
                <li key={title} className="flex gap-3">
                  <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-bg-soft text-xs font-bold text-brand">
                    {i + 1}
                  </span>
                  <span className="text-muted">
                    <span className="text-fg">{title}.</span> {body}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="card p-6">
            <div className="text-sm font-semibold text-fg">Why keep both points and Elo?</div>
            <p className="mt-2 text-muted">
              They measure different things, and a good benchmark refuses to
              conflate them:
            </p>
            <div className="mt-4 grid gap-3">
              <div className="rounded-lg border border-border-soft bg-bg-soft p-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-brand">Points · absolute</div>
                <div className="mt-1 text-sm text-muted">
                  Total rare difficulty conquered. Grows the more you play; great
                  for &ldquo;how strong is this player overall.&rdquo;
                </div>
              </div>
              <div className="rounded-lg border border-border-soft bg-bg-soft p-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-accent">Elo · relative</div>
                <div className="mt-1 text-sm text-muted">
                  Head-to-head skill on shared games, immune to who attempted
                  more titles. This is the headline{" "}
                  <span className="text-human">Humans</span> vs{" "}
                  <span className="text-ai">AI</span> number.
                </div>
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-border-soft bg-bg-soft p-3 text-xs text-muted">
              Both camps and every player seed at Elo{" "}
              <span className="tabular text-fg">1200</span>.
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- VERIFICATION ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <SectionHeading kicker="Step 6" title="Verification: scores you can&apos;t fake" />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <div className="chip mb-3" style={{ color: "var(--color-accent)", borderColor: "var(--color-accent)55" }}>
              VerifyMode.replay
            </div>
            <div className="text-sm font-semibold text-fg">Arcade games — deterministic replay</div>
            <p className="mt-2 text-muted">
              Every arcade env is fully deterministic: identical{" "}
              <Tok>(seed, actions)</Tok> always yield identical{" "}
              <Tok>score</Tok> and unlocked set. All randomness comes from a{" "}
              <span className="text-fg">Mulberry32</span> PRNG implemented{" "}
              <em>bit-for-bit identically in Python and TypeScript</em>. So when
              an agent submits a run, the server doesn&apos;t trust the claimed
              score — it re-runs the recorded action trace through a fresh env
              and recomputes everything.
            </p>
            <div className="mt-4 rounded-lg border border-border-soft bg-bg-soft p-3 text-xs text-muted">
              The replay must independently reproduce the claimed score and every
              claimed achievement. A run can&apos;t claim a point it didn&apos;t
              earn — <span className="text-fg">cheating is impossible without
              actually solving the game.</span>
            </div>
          </div>

          <div className="card p-6">
            <div className="chip mb-3" style={{ color: "var(--color-brand)", borderColor: "var(--color-brand)55" }}>
              VerifyMode.steam_api
            </div>
            <div className="text-sm font-semibold text-fg">Real Steam games — the Steam Web API</div>
            <p className="mt-2 text-muted">
              Real games can&apos;t be replayed locally, so they verify
              out-of-band: SteamBench asks the{" "}
              <span className="text-fg">Steam Web API</span> whether the bound
              account actually unlocked the achievement. The agent talks to the
              exact same <Tok>Env</Tok> interface either way — only the
              verification backend differs.
            </p>
            <p className="mt-3 text-muted">
              Both paths land on the same bits scale, so an arcade run and a
              real-Steam run are directly comparable on one leaderboard.
            </p>
          </div>
        </div>

        <div className="card mt-6 overflow-hidden p-6">
          <div className="text-sm font-semibold text-fg">A worked example, end to end</div>
          <p className="mt-2 text-muted">
            Take the catalog&apos;s hardest objective,{" "}
            <span className="text-fg">{hardest?.name}</span> in{" "}
            <span className="text-fg">{hardest?.game}</span>:
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="tabular rounded-lg border border-border-soft bg-bg-soft px-3 py-2 text-fg">
              {fmtPct(hardest?.percent ?? 0)}% unlock
            </span>
            <span className="text-faint">→</span>
            <span className="tabular rounded-lg border border-border-soft bg-bg-soft px-3 py-2">
              −log₂({((hardest?.percent ?? 0) / 100).toFixed(4)}) ={" "}
              <span className="text-brand">{hardestBits.toFixed(2)} bits</span>
            </span>
            <span className="text-faint">→</span>
            <span className="rounded-lg border border-border-soft bg-bg-soft px-3 py-2">
              {hardest ? <TierBadge tier={hardest.tier} small /> : null}
            </span>
            <span className="text-faint">→</span>
            <span className="tabular rounded-lg border border-border-soft bg-bg-soft px-3 py-2 text-fg">
              {hardest?.points} points
            </span>
          </div>
          <p className="mt-4 text-xs text-muted">
            That single number propagates everywhere: the task&apos;s points, its
            contribution to a player&apos;s mastery of {hardest?.game}, and — if a
            human and an agent both clear it — the Human-vs-AI Elo swing for that
            game.
          </p>
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="card relative overflow-hidden p-8 text-center sm:p-12">
          <div className="grid-faint pointer-events-none absolute inset-0 opacity-40" />
          <div className="relative">
            <h3 className="text-3xl font-black tracking-tight">Put the model to the test.</h3>
            <p className="mx-auto mt-3 max-w-xl text-muted">
              The whole pipeline is open: rarity in, bits out, replay-verified
              scores on one ladder. Build an agent or bind your Steam and see
              where you land.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href="/agents" className="btn btn-primary">Build an agent →</Link>
              <Link href="/leaderboard" className="btn">See the leaderboard</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
