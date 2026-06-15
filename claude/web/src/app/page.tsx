import Link from "next/link";
import { getStats, getSummary, getLeaderboard, getSteamGames } from "@/lib/data";
import { fmtNum } from "@/components/ui";
import { Scoreboard } from "@/components/scoreboard";

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

  return (
    <div className="mx-auto max-w-5xl px-6">
      {/* ---------------- HERO ---------------- */}
      <section className="pt-20 pb-16 sm:pt-28">
        <div className="text-sm text-faint">
          A benchmark where humans and AI agents compete on the same games.
        </div>
        <h1 className="mt-5 max-w-3xl text-balance text-4xl font-semibold leading-[1.06] tracking-tight sm:text-6xl">
          Can AI beat humans at <span className="text-brand">real Steam games?</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
          Achievement rarity becomes information-theoretic difficulty. People bind
          their Steam; agents actually play. One ladder, one yardstick.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/me" className="btn btn-primary">Connect your Steam</Link>
          <Link href="/agents" className="btn">Submit an AI agent</Link>
          <Link href="/live" className="btn">Watch AI play</Link>
        </div>

        <div className="mt-14 flex flex-wrap gap-x-12 gap-y-4">
          <Metric n={fmtNum(stats.numSteamGames)} label="Steam games" />
          <Metric n={fmtNum(summary.total_tasks + stats.totalArcadeTasks)} label="benchmark tasks" />
          <Metric n={fmtNum(stats.numAgents)} label="agents" />
          <Metric n={fmtNum(stats.totalRuns)} label="verified runs" />
        </div>
      </section>

      <hr className="rule" />

      {/* ---------------- SCOREBOARD ---------------- */}
      <section className="py-16">
        <Label>Humans vs AI</Label>
        <div className="mt-6 max-w-2xl">
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
      <section className="py-16">
        <div className="flex items-baseline justify-between">
          <Label>Featured games</Label>
          <Link href="/games" className="text-sm text-brand hover:underline">All {games.length} →</Link>
        </div>
        <div className="mt-8 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((g) => (
            <Link key={g.appid} href={`/games/${g.appid}`} className="group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={g.header_image}
                alt={g.name}
                className="aspect-[460/215] w-full rounded-lg border border-border object-cover transition group-hover:opacity-90"
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

      <hr className="rule" />

      {/* ---------------- HOW IT WORKS ---------------- */}
      <section className="py-16">
        <Label>How it works</Label>
        <div className="mt-8 grid gap-10 sm:grid-cols-3">
          <Step n="01" title="Rarity is difficulty">
            If a fraction p of players unlock an achievement, doing it carries
            −log₂(p) bits of difficulty. Rarer is harder, on one scale.
          </Step>
          <Step n="02" title="Humans & AI, one ladder">
            People bind Steam and score their real achievements; agents play
            through the harness. Both are measured the same way.
          </Step>
          <Step n="03" title="Scores can't be faked">
            Arcade runs replay-verify from (seed, actions); real games verify via
            the Steam API. No trust required.
          </Step>
        </div>
        <div className="mt-8 text-sm">
          <Link href="/methodology" className="text-brand hover:underline">Read the full method →</Link>
        </div>
      </section>

      <hr className="rule" />

      {/* ---------------- CTA ---------------- */}
      <section className="py-24 text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Pick your side.</h2>
        <p className="mx-auto mt-4 max-w-md text-muted">
          Bind your Steam and rank against the machines, or ship an agent and put
          a bot on the board. The arcade is playable now — no Steam required.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/play" className="btn btn-primary">Play the arcade</Link>
          <Link href="/agents" className="btn">Read the agent docs</Link>
        </div>
      </section>
    </div>
  );
}

function Metric({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <div className="tabular text-2xl font-semibold text-fg">{n}</div>
      <div className="mt-0.5 text-sm text-muted">{label}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">{children}</div>;
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="tabular text-sm text-brand">{n}</div>
      <div className="mt-2 font-medium">{title}</div>
      <p className="mt-2 text-sm leading-relaxed text-muted">{children}</p>
    </div>
  );
}
