import Link from "next/link";
import { getAtlas, getTaxonomy } from "@/lib/data";
import { SectionHeading, TierBadge, TierHistogram, Stat, fmtNum, fmtPct } from "@/components/ui";
import { TIER_COLOR } from "@/lib/difficulty";
import { TIER_LABEL, type Tier } from "@/lib/types";
import { TYPE_LABEL, TYPE_COLOR, type TaskType } from "@/lib/taxonomy";

export const metadata = {
  title: "Difficulty Atlas — SteamBench",
  description:
    "Every Steam achievement on one information-theoretic scale: the rarest objectives, the hardest games to 100%, and the whole population by difficulty tier.",
};

const TIER_ORDER: Tier[] = ["tutorial", "easy", "medium", "hard", "elite", "legendary"];

export default function AtlasPage() {
  const { rarest, hardestGames, tierTotals, totalTasks, totalGames, totalBits } = getAtlas();
  const maxTier = Math.max(...TIER_ORDER.map((t) => tierTotals[t] ?? 0), 1);
  const legendaryCount = tierTotals["legendary"] ?? 0;
  const tax = getTaxonomy();
  const TYPE_ORDER: TaskType[] = ["skill", "misc", "progression", "grind", "social"];

  return (
    <div className="section-wrap pt-14">
      {/* hero */}
      <div className="page-kicker">The difficulty atlas</div>
      <h1 className="page-title">The hardest things on Steam</h1>
      <p className="mt-3 max-w-3xl text-muted">
        Every achievement across {totalGames} games, poured onto one
        information-theoretic scale: <code className="rounded bg-bg-soft px-1.5 py-0.5 text-sm">difficulty = −log₂(rarity)</code>{" "}
        bits of surprise. Rarer is harder; the unit is identical for humans and AI.
        Here is what {fmtNum(totalTasks)} real achievements look like once you measure them all the same way.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Games measured" value={fmtNum(totalGames)} />
        <Stat label="Achievements" value={fmtNum(totalTasks)} />
        <Stat label="Total bits to 100% all" value={fmtNum(totalBits)} accent="var(--color-brand)" />
        <Stat label="Legendary (sub-tier)" value={fmtNum(legendaryCount)} accent={TIER_COLOR.legendary} sub="rarest band" />
      </div>

      {/* tier population */}
      <section className="mt-16">
        <SectionHeading kicker="Population" title="Every achievement, by difficulty tier" />
        <div className="card space-y-2.5 p-5">
          {TIER_ORDER.map((t) => {
            const n = tierTotals[t] ?? 0;
            return (
              <div key={t} className="flex items-center gap-3">
                <div className="w-20 shrink-0 text-sm font-medium" style={{ color: TIER_COLOR[t] }}>
                  {TIER_LABEL[t]}
                </div>
                <div className="h-5 flex-1 overflow-hidden rounded bg-bg-soft">
                  <div
                    className="h-full rounded transition-all"
                    style={{ width: `${(n / maxTier) * 100}%`, background: TIER_COLOR[t], minWidth: n ? 3 : 0 }}
                  />
                </div>
                <div className="tabular w-16 shrink-0 text-right text-sm text-muted">{fmtNum(n)}</div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-faint">
          Each tier is roughly a halving of the player population. Tutorial badges are near-universal;
          Legendary ones are earned by well under ~1% of owners — which is exactly why they score the most.
        </p>
      </section>

      {/* benchmark-grade taxonomy — which achievements actually test skill */}
      <section className="mt-16">
        <SectionHeading kicker="Task design" title="Which achievements make good benchmark tasks?" />
        <div className="card p-5">
          <p className="text-sm text-muted">
            Rarity says how hard an achievement is — not <span className="text-fg">why</span>. A strong
            benchmark task is hard because of <span className="text-ai">skill</span>, not time
            (progression), repetition (grind), or other players (social / luck). Classifying all{" "}
            {fmtNum(tax.total)} achievements by name, description and rarity:
          </p>
          <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-bg-soft">
            {TYPE_ORDER.map((ty) => {
              const w = (tax.dist[ty] / tax.total) * 100;
              if (!w) return null;
              return <div key={ty} style={{ width: `${w}%`, background: TYPE_COLOR[ty] }} title={`${TYPE_LABEL[ty]}: ${tax.dist[ty]}`} />;
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            {(["skill", "progression", "grind", "social", "misc"] as TaskType[]).map((ty) => (
              <span key={ty} className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: TYPE_COLOR[ty] }} />
                <span className="font-medium" style={{ color: TYPE_COLOR[ty] }}>{TYPE_LABEL[ty]}</span>
                <span className="tabular text-faint">{fmtNum(tax.dist[ty])} · {Math.round((tax.dist[ty] / tax.total) * 100)}%</span>
              </span>
            ))}
          </div>
        </div>

        <div className="mt-4 mb-2 text-sm font-semibold text-fg">
          Highest benchmark-grade objectives — skill challenges in the discriminating band
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
          {tax.topGraded.map((t, i) => (
            <Link
              key={`${t.game_appid}:${t.task_id}`}
              href={`/games/${t.game_appid}`}
              className="card card-hover flex items-center gap-3 p-3"
            >
              <span className="tabular w-6 shrink-0 text-right text-xs text-faint">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-fg">{t.name}</div>
                <div className="truncate text-xs text-faint">{t.game}</div>
              </div>
              <span className="chip shrink-0" style={{ color: "var(--color-ai)", borderColor: "var(--color-ai)55" }}>skill</span>
              <div className="shrink-0 text-right">
                <div className="tabular text-sm font-bold" style={{ color: "var(--color-ai)" }}>{(t.grade * 100).toFixed(0)}</div>
                <div className="tabular text-[11px] text-faint">{fmtPct(t.rarity * 100)}% · {fmtNum(t.points)}p</div>
              </div>
            </Link>
          ))}
        </div>
        <p className="mt-2 text-xs text-faint">
          A transparent signal from each achievement&apos;s text + rarity — not a change to scoring (the
          board still ranks by −log₂(rarity) bits). It answers the design question the project poses:
          of everything on Steam, which objectives actually test ability?
        </p>
      </section>

      {/* rarest achievements */}
      <section className="mt-16">
        <SectionHeading kicker="The wall of pain" title={`The ${rarest.length} rarest achievements on Steam`}>
          <span className="text-xs text-faint">click through to the game</span>
        </SectionHeading>
        <div className="grid gap-2 lg:grid-cols-2">
          {rarest.map((t, i) => (
            <Link
              key={`${t.game_appid}:${t.task_id}`}
              href={`/games/${t.game_appid}`}
              className="card card-hover flex items-center gap-3 p-3"
            >
              <span className="tabular w-6 shrink-0 text-right text-xs text-faint">{i + 1}</span>
              {t.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.icon} alt="" width={34} height={34} className="shrink-0 rounded" loading="lazy" />
              ) : (
                <div className="h-[34px] w-[34px] shrink-0 rounded bg-bg-soft" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-fg">{t.name || t.source_ref}</div>
                <div className="truncate text-xs text-faint">{t.game}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="tabular text-sm font-bold text-brand">{fmtPct(t.rarity * 100)}%</div>
                <div className="tabular text-[11px] text-faint">{Math.round(t.bits)} bits · {fmtNum(t.points)}p</div>
              </div>
              <div className="hidden shrink-0 sm:block">
                <TierBadge tier={t.tier} small />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* hardest games to 100% */}
      <section className="mt-16">
        <SectionHeading kicker="Completionist's graveyard" title="Hardest games to 100%">
          <Link href="/games" className="btn">Browse all games →</Link>
        </SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {hardestGames.map((g, i) => (
            <Link key={g.appid} href={`/games/${g.appid}`} className="card card-hover overflow-hidden p-0">
              <div className="relative h-24 w-full bg-bg-soft">
                {g.header_image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.header_image} alt="" className="h-full w-full object-cover opacity-80" loading="lazy" />
                )}
                <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-xs font-bold text-fg backdrop-blur">
                  #{i + 1}
                </span>
              </div>
              <div className="p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="truncate font-bold">{g.name}</div>
                  <div className="tabular shrink-0 text-sm font-bold text-brand">{fmtNum(g.total_bits)} bits</div>
                </div>
                <div className="mt-1 text-xs text-faint">{g.num_achievements} achievements to 100%</div>
                <div className="mt-3"><TierHistogram hist={g.tier_histogram} /></div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <p className="mt-12 text-center text-xs text-faint">
        Percentages, names and icons are real, pulled from public Steam endpoints. The bits scale is the same one
        that scores the <Link href="/play" className="text-brand">arcade games</Link> and the{" "}
        <Link href="/leaderboard" className="text-brand">humans-vs-AI leaderboard</Link>.
      </p>
    </div>
  );
}
