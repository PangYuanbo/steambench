import Link from "next/link";
import type { Metadata } from "next";
import { getGameCards, getArcadeGames, getSummary, getSteamGames } from "@/lib/data";
import {
  TierBadge,
  TierHistogram,
  fmtNum,
  SectionHeading,
} from "@/components/ui";
import { SteamGrid } from "@/components/steam-grid";
import { classifyAchievement } from "@/lib/taxonomy";
import type { Game, Tier } from "@/lib/types";

export const metadata: Metadata = {
  title: "Games — SteamBench",
  description:
    "Browse every game in the SteamBench catalog: the playable arcade plus real Steam titles, each with its difficulty ladder.",
};

const TIER_ORDER: Tier[] = ["legendary", "elite", "hard", "medium", "easy", "tutorial"];

export default async function GamesPage() {
  const summary = getSummary();
  const arcade = getArcadeGames();
  const cards = getGameCards();
  // Per-game skill share (taxonomy lens) for the "Most skill" sort + card badge.
  const skillByApp = new Map<number, number>();
  for (const g of getSteamGames()) {
    const ts = g.tasks ?? [];
    let s = 0;
    for (const t of ts) {
      if (classifyAchievement(t.name || "", t.description || "", t.rarity).type === "skill") s += 1;
    }
    skillByApp.set(g.appid, ts.length ? s / ts.length : 0);
  }
  const steam = cards
    .filter((g) => g.appid < 9000000)
    .map((g) => ({ ...g, skill_share: skillByApp.get(g.appid) ?? 0 }))
    .sort((a, b) => (b.owners_estimate ?? 0) - (a.owners_estimate ?? 0));

  const tierMax = Math.max(1, ...Object.values(summary.by_tier));

  return (
    <div>
      {/* ---------------- HEADER / SUMMARY ---------------- */}
      <section className="relative overflow-hidden border-b border-border-soft">
        <div className="grid-faint pointer-events-none absolute inset-0 opacity-50" />
        <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-12 sm:px-6">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-wider text-brand">
              The catalog
            </div>
            <h1 className="mt-1 text-balance text-4xl font-black tracking-tight sm:text-5xl">
              Browse the <span className="text-gradient">games</span>
            </h1>
            <p className="mt-4 text-pretty text-muted">
              {fmtNum(summary.num_games)} Steam titles and {arcade.length} playable
              arcade games, every achievement tiered by real global rarity.
            </p>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-[repeat(2,minmax(0,12rem))_1fr]">
            <div className="card p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-faint">Steam games</div>
              <div className="tabular mt-1 text-2xl font-bold text-brand">{fmtNum(summary.num_games)}</div>
              <div className="mt-0.5 text-xs text-muted">+ {arcade.length} arcade</div>
            </div>
            <div className="card p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-faint">Benchmark tasks</div>
              <div className="tabular mt-1 text-2xl font-bold">{fmtNum(summary.total_tasks)}</div>
              <div className="mt-0.5 text-xs text-muted">achievements scored</div>
            </div>
            <div className="card p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-faint">
                Difficulty distribution
              </div>
              <div className="mt-3 space-y-1.5">
                {TIER_ORDER.map((t) => {
                  const count = summary.by_tier[t] || 0;
                  return (
                    <div key={t} className="flex items-center gap-3">
                      <span className="w-20 shrink-0">
                        <TierBadge tier={t} small />
                      </span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-bg-soft">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(count / tierMax) * 100}%`, background: "var(--color-border)" }}
                        />
                      </div>
                      <span className="tabular w-12 text-right text-sm text-fg">{fmtNum(count)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- PLAYABLE NOW (arcade) ---------------- */}
      {arcade.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
          <SectionHeading kicker="No Steam required" title="Playable now">
            <Link href="/play" className="btn">
              Open the arcade →
            </Link>
          </SectionHeading>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {arcade.map((g) => (
              <ArcadeCard key={g.appid} game={g} />
            ))}
          </div>
        </section>
      )}

      {/* ---------------- STEAM GRID ---------------- */}
      <section className="mx-auto max-w-7xl px-4 pb-16 pt-2 sm:px-6">
        <SectionHeading kicker="Real Steam data" title="All Steam games">
          <span className="chip">{steam.length} titles</span>
        </SectionHeading>
        <SteamGrid games={steam} />
      </section>
    </div>
  );
}

function ArcadeCard({ game: g }: { game: Game }) {
  return (
    <Link href="/play" className="card card-hover group overflow-hidden">
      {g.header_image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={g.header_image}
          alt={g.name}
          className="h-32 w-full object-cover opacity-90 transition group-hover:opacity-100"
        />
      ) : (
        <div className="grid-faint flex h-32 w-full items-center justify-center bg-bg-soft">
          <span className="text-2xl font-black text-faint">{g.name.slice(0, 2)}</span>
        </div>
      )}
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="truncate font-semibold">{g.name}</div>
          <span
            className="chip shrink-0"
            style={{ color: "var(--color-accent)", borderColor: "color-mix(in srgb, var(--color-accent) 40%, transparent)" }}
          >
            ▶ play
          </span>
        </div>
        {g.short_description && (
          <p className="mt-2 line-clamp-2 text-xs text-muted">{g.short_description}</p>
        )}
        <div className="mt-3">
          <TierHistogram hist={g.tier_histogram} />
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-muted">
          <span className="tabular">{g.num_achievements} tasks</span>
          <span className="tabular">{Math.round(g.total_bits)} bits to 100%</span>
        </div>
      </div>
    </Link>
  );
}

