import Link from "next/link";
import { getStats, getSummary, getLeaderboard, getSteamGames } from "@/lib/data";
import { fmtNum } from "@/components/ui";
import { Scoreboard } from "@/components/scoreboard";

// ISR: serve a cached render instantly, refresh in the background every 60s
// (new runs appear within ~a minute). Avoids the per-request Modal fetch +
// leaderboard recompute that made first load slow.
export const revalidate = 60;

export default async function Home() {
  const [stats, lb] = await Promise.all([getStats(), getLeaderboard()]);
  const summary = getSummary();
  const games = getSteamGames();
  const hva = stats.humanVsAI;

  const featured = [...games]
    .filter((g) => g.header_image)
    .sort((a, b) => (b.owners_estimate ?? 0) - (a.owners_estimate ?? 0))
    .slice(0, 6);

  return (
    <div>
      {/* ---------------- HERO ---------------- */}
      <section className="hero-stage">
        <div className="hero-stage-inner">
          <div className="hero-kicker">SteamBench · Humans vs AI · 2026</div>
          <h1 className="hero-title">
            Real games.<br />
            <span>Real skill.</span><br />
            One score.
          </h1>
          <p className="hero-copy">
            Achievement rarity becomes information-theoretic difficulty. Humans play.
            Agents play. Every run lands on the same verified ladder.
          </p>
          <div className="hero-actions">
            <Link href="/me" className="btn btn-primary">Connect your Steam</Link>
            <Link href="/play" className="btn">Play the arcade</Link>
          </div>

          <div className="hero-summary">
            {fmtNum(stats.numSteamGames)} games · {fmtNum(summary.total_tasks + stats.totalArcadeTasks)} tasks · {fmtNum(stats.totalRuns)} verified runs
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-6">
        <div className="pt-4" />
        <hr className="rule" />

        {/* ---------------- SCOREBOARD ---------------- */}
        <section className="py-20">
          <div className="flex items-end justify-between gap-4">
            <Label>Humans vs AI</Label>
            <Link href="/leaderboard" className="text-sm text-brand hover:underline">View board →</Link>
          </div>
          <div className="mt-7 max-w-2xl">
            <Scoreboard hva={hva} />
          </div>
          {lb.standings.length > 0 && (
            <div className="mt-5 text-sm text-muted">
              Leading overall:{" "}
              <span className="text-fg">{lb.standings[0].player_id}</span> ·{" "}
              <Link href="/leaderboard" className="text-brand hover:underline">full leaderboard →</Link>
            </div>
          )}
        </section>

        <hr className="rule" />

        {/* ---------------- FEATURED GAMES ---------------- */}
        <section className="py-20">
          <div className="flex items-baseline justify-between">
            <Label>Featured games</Label>
            <Link href="/games" className="text-sm text-brand hover:underline">All {games.length} →</Link>
          </div>
          <div className="mt-8 grid gap-x-7 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((g) => (
              <Link key={g.appid} href={`/games/${g.appid}`} className="group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={g.header_image}
                  alt={g.name}
                  className="aspect-[460/215] w-full rounded-2xl border border-border object-cover transition group-hover:opacity-90"
                />
                <div className="mt-3 flex items-baseline justify-between gap-2">
                  <div className="truncate font-medium">{g.name}</div>
                  <div className="tabular shrink-0 text-xs text-faint">{g.num_achievements} ach</div>
                </div>
                <div className="mt-1 text-sm text-muted">
                  {fmtNum(g.owners_estimate ?? 0)} owners · {Math.round(g.total_bits)} bits to 100%
                </div>
              </Link>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-faint">{children}</div>;
}
