import Link from "next/link";
import { getStats, getSummary, getLeaderboard, getSteamGames } from "@/lib/data";
import { rarityToBits } from "@/lib/difficulty";
import {
  Stat,
  TierBadge,
  KindBadge,
  TierHistogram,
  fmtNum,
  fmtPct,
  SectionHeading,
} from "@/components/ui";
import { Scoreboard } from "@/components/scoreboard";
import { type Tier } from "@/lib/types";

// Reflect freshly-submitted runs (the run store is live, not build-time).
export const dynamic = "force-dynamic";

export default async function Home() {
  const [stats, lb] = await Promise.all([getStats(), getLeaderboard()]);
  const summary = getSummary();
  const games = getSteamGames();
  const hva = stats.humanVsAI;

  const featured = [...games]
    .filter((g) => g.header_image)
    .sort((a, b) => (b.owners_estimate ?? 0) - (a.owners_estimate ?? 0))
    .slice(0, 6);

  const hardest = summary.hardest_overall.slice(0, 6);
  const topStandings = lb.standings.slice(0, 5);

  return (
    <div>
      {/* ---------------- HERO ---------------- */}
      <section className="relative overflow-hidden border-b border-border-soft">
        <div className="grid-faint pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
          <div className="animate-fade-up mx-auto max-w-3xl text-center">
            <span className="chip mx-auto">
              <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-good text-good" /> live benchmark · {stats.totalRuns} verified runs
            </span>
            <h1 className="mt-5 text-balance text-5xl font-black leading-[1.05] tracking-tight sm:text-6xl">
              Can AI beat humans <br className="hidden sm:block" />
              at <span className="text-gradient">real Steam games?</span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-muted">
              SteamBench turns each game&apos;s achievement rarity into
              information-theoretic difficulty, then scores humans and AI agents
              on the exact same ladder. People bind their Steam; agents actually
              play. One leaderboard.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link href="/me" className="btn btn-primary">Connect your Steam →</Link>
              <Link href="/agents" className="btn">Submit an AI agent</Link>
              <Link href="/live" className="btn">Watch AI play live</Link>
            </div>
          </div>

          {/* Human vs AI scoreboard — the rivalry, made literal (shared component) */}
          <div className="animate-fade-up mx-auto mt-12 max-w-3xl" style={{ animationDelay: "120ms" }}>
            <Scoreboard hva={hva} />
          </div>
        </div>
      </section>

      {/* ---------------- STATS ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Steam games" value={fmtNum(stats.numSteamGames)} sub="real, public data" accent="var(--color-brand)" />
          <Stat label="Benchmark tasks" value={fmtNum(stats.totalSteamTasks + stats.totalArcadeTasks)} sub={`${summary.total_tasks} from Steam`} />
          <Stat label="Arcade games" value={stats.numArcadeGames} sub="playable now, replay-verified" accent="var(--color-accent)" />
          <Stat label="Agents on board" value={stats.numAgents} sub={stats.topAgent ? `top: ${stats.topAgent.player_id}` : "—"} accent="var(--color-ai)" />
        </div>
      </section>

      {/* ---------------- DIFFICULTY MODEL ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <SectionHeading kicker="The core idea" title="Rarity is difficulty">
          <Link href="/methodology" className="btn">How scoring works →</Link>
        </SectionHeading>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <p className="text-muted">
              If a fraction <span className="text-fg">p</span> of all players
              ever unlock an achievement, observing one player do it carries{" "}
              <code className="rounded bg-bg-soft px-1.5 py-0.5 text-brand">−log₂(p)</code>{" "}
              bits of surprise. That single number is our difficulty unit: rarer
              is harder, it&apos;s additive across objectives, and it bands
              naturally into tiers.
            </p>
            <div className="mt-5 space-y-2">
              {[80, 35, 9, 2.5, 0.4, 0.05].map((p) => {
                const bits = rarityToBits(p / 100);
                const tier = (bits >= 9.97 ? "legendary" : bits >= 6.64 ? "elite" : bits >= 4.32 ? "hard" : bits >= 2.32 ? "medium" : bits >= 1 ? "easy" : "tutorial") as Tier;
                return (
                  <div key={p} className="flex items-center gap-3">
                    <span className="tabular w-16 text-right text-sm text-muted">{p}%</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-soft">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, (bits / 11) * 100)}%`, background: "linear-gradient(90deg,var(--color-brand),var(--color-accent))" }} />
                    </div>
                    <span className="tabular w-14 text-sm text-fg">{bits.toFixed(1)} b</span>
                    <span className="w-24"><TierBadge tier={tier} small /></span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card p-6">
            <div className="text-sm font-semibold text-fg">Difficulty distribution across {summary.num_games} Steam games</div>
            <div className="mt-1 text-xs text-muted">{summary.total_tasks} achievements, tiered by real global rarity</div>
            <div className="mt-5 space-y-3">
              {(["legendary", "elite", "hard", "medium", "easy", "tutorial"] as Tier[]).map((t) => {
                const count = summary.by_tier[t] || 0;
                const max = Math.max(1, ...Object.values(summary.by_tier));
                return (
                  <div key={t} className="flex items-center gap-3">
                    <span className="w-20"><TierBadge tier={t} small /></span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-bg-soft">
                      <div className="h-full rounded-full" style={{ width: `${(count / max) * 100}%`, background: "var(--color-border)" }} />
                    </div>
                    <span className="tabular w-12 text-right text-sm text-fg">{count}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-5 rounded-lg border border-border-soft bg-bg-soft p-3 text-xs text-muted">
              Hardest objective in the catalog:{" "}
              <span className="text-fg">{hardest[0]?.name}</span> in{" "}
              <span className="text-fg">{hardest[0]?.game}</span> — only{" "}
              <span className="tabular text-elite">{fmtPct(hardest[0]?.percent ?? 0)}%</span> of
              players have it ({hardest[0]?.points} pts).
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- STANDINGS + HARDEST ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <SectionHeading title="Current standings">
              <Link href="/leaderboard" className="text-sm text-brand hover:underline">Full board →</Link>
            </SectionHeading>
            <div className="space-y-2">
              {topStandings.map((s) => (
                <div key={`${s.kind}:${s.player_id}`} className="flex items-center gap-3 rounded-lg border border-border-soft bg-bg-soft px-3 py-2">
                  <span className="tabular w-6 text-center text-sm text-faint">{s.rank}</span>
                  <KindBadge kind={s.kind} />
                  <span className="flex-1 truncate font-medium">{s.player_id}</span>
                  <span className="tabular text-sm text-muted">{s.tasks_completed} tasks</span>
                  <span className="tabular w-16 text-right font-bold text-brand">{Math.round(s.weighted_score)}</span>
                </div>
              ))}
              {topStandings.length === 0 && <div className="text-sm text-muted">No runs yet.</div>}
            </div>
          </div>

          <div className="card p-6">
            <SectionHeading title="Hall of pain">
              <span className="chip">rarest achievements</span>
            </SectionHeading>
            <div className="space-y-2">
              {hardest.map((h) => (
                <Link key={`${h.appid}:${h.name}`} href={`/games/${h.appid}`} className="flex items-center gap-3 rounded-lg border border-border-soft bg-bg-soft px-3 py-2 hover:border-border">
                  <TierBadge tier={h.tier} small />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{h.name}</div>
                    <div className="truncate text-xs text-faint">{h.game}</div>
                  </div>
                  <span className="tabular text-sm text-elite">{fmtPct(h.percent)}%</span>
                  <span className="tabular w-12 text-right text-sm text-fg">{h.points}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- FEATURED GAMES ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <SectionHeading kicker="Real Steam data" title="Featured games">
          <Link href="/games" className="btn">Browse all {games.length} →</Link>
        </SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((g) => (
            <Link key={g.appid} href={`/games/${g.appid}`} className="card card-hover group overflow-hidden">
              {g.header_image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={g.header_image} alt={g.name} className="h-32 w-full object-cover opacity-90 transition group-hover:opacity-100" />
              )}
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate font-semibold">{g.name}</div>
                  <span className="tabular shrink-0 text-xs text-faint">{g.num_achievements} ach</span>
                </div>
                <div className="mt-3"><TierHistogram hist={g.tier_histogram} /></div>
                <div className="mt-3 flex items-center justify-between text-xs text-muted">
                  <span>{fmtNum(g.owners_estimate ?? 0)} owners</span>
                  <span className="tabular">{Math.round(g.total_bits)} bits to 100%</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------------- Explore: atlas + frontier ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Link href="/atlas" className="card card-hover group p-6">
            <div className="text-xs font-semibold uppercase tracking-wider text-accent">Difficulty atlas</div>
            <h3 className="mt-1 text-xl font-bold">The hardest things on Steam</h3>
            <p className="mt-2 text-sm text-muted">
              Every achievement across {stats.numSteamGames} games on one{" "}
              <code className="rounded bg-bg-soft px-1 text-xs">−log₂(rarity)</code> bits scale — the
              rarest objectives, the population by tier, and the hardest games to 100%.
            </p>
            <span className="mt-3 inline-block text-sm text-brand group-hover:underline">Explore the atlas →</span>
          </Link>
          <Link href="/native" className="card card-hover group p-6">
            <div className="text-xs font-semibold uppercase tracking-wider text-accent">The frontier</div>
            <h3 className="mt-1 text-xl font-bold">An AI playing from raw pixels</h3>
            <p className="mt-2 text-sm text-muted">
              Watch a vision agent read a rendered game frame-by-frame on Modal — its perception
              overlaid live — then submit its pixel run to the board, <span className="text-fg">replay-verified
              like any human run</span>.
            </p>
            <span className="mt-3 inline-block text-sm text-brand group-hover:underline">Watch the vision AI →</span>
          </Link>
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="card relative overflow-hidden p-8 text-center sm:p-12">
          <div className="grid-faint pointer-events-none absolute inset-0 opacity-40" />
          <div className="relative">
            <h3 className="text-3xl font-black tracking-tight">Pick your side.</h3>
            <p className="mx-auto mt-3 max-w-xl text-muted">
              Bind your Steam and let your real achievements rank you against the
              machines — or build an agent, grab an API key, and put a bot on the
              board. The arcade is playable right now, no Steam required.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href="/play" className="btn btn-primary">Play the arcade →</Link>
              <Link href="/agents" className="btn">Read the agent docs</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
