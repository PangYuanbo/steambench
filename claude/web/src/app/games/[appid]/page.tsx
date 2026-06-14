import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getGame, getAllRuns } from "@/lib/data";
import {
  TierBadge,
  TierHistogram,
  KindBadge,
  Stat,
  fmtNum,
  fmtPct,
  SectionHeading,
} from "@/components/ui";
import { GameVersus } from "@/components/scoreboard";
import { classifyAchievement, TYPE_LABEL, TYPE_COLOR, type TaskType } from "@/lib/taxonomy";
import type { RunRow, Task } from "@/lib/types";

const LADDER_CAP = 120;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ appid: string }>;
}): Promise<Metadata> {
  const { appid } = await params;
  const game = getGame(Number(appid));
  if (!game) return { title: "Game not found — SteamBench" };
  return {
    title: `${game.name} — SteamBench`,
    description:
      game.short_description ||
      `${game.name}: ${game.num_achievements} achievements tiered by global rarity on SteamBench.`,
  };
}

export default async function GameDetailPage({
  params,
}: {
  params: Promise<{ appid: string }>;
}) {
  const { appid } = await params;
  const game = getGame(Number(appid));

  if (!game) {
    return (
      <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <div className="card mx-auto max-w-lg p-10 text-center">
          <div className="text-5xl">🛸</div>
          <h1 className="mt-4 text-2xl font-bold">Game not found</h1>
          <p className="mt-2 text-muted">
            We don&apos;t have a game with id <span className="tabular text-fg">{appid}</span> in the
            catalog.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/games" className="btn btn-primary">
              ← Browse all games
            </Link>
            <Link href="/leaderboard" className="btn">
              Leaderboard
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const isSteam = game.appid < 9000000;
  const slug = (game.env_id ?? "").replace("arcade/", "");
  const tasks: Task[] = [...(game.tasks ?? [])].sort(
    (a, b) => b.tier_rank - a.tier_rank || b.bits - a.bits
  );
  const shown = tasks.slice(0, LADDER_CAP);
  const hidden = tasks.length - shown.length;

  // Per-game task mix: is this a skill game or a grind/story game? Classify
  // every objective (additive lens; see lib/taxonomy.ts), tally, and tag rows.
  const mix: Record<TaskType, number> = { skill: 0, progression: 0, grind: 0, social: 0, misc: 0 };
  const classOf = new Map<string, TaskType>();
  for (const t of tasks) {
    const c = classifyAchievement(t.name || "", t.description || "", t.rarity);
    mix[c.type] += 1;
    classOf.set(t.task_id, c.type);
  }
  const mixTotal = tasks.length || 1;
  const MIX_ORDER: TaskType[] = ["skill", "misc", "progression", "grind", "social"];

  // Who leads THIS game — real now for both arcade (replay) and Steam titles
  // (humans who bound their account + agents who played via the gamepad path).
  const appRuns: RunRow[] = (await getAllRuns())
    .filter((r) => r.appid === game.appid && r.verified)
    .sort((a, b) => b.earned_points - a.earned_points || b.score - a.score);
  const topRuns = appRuns.slice(0, 6);
  const humanBest = Math.max(0, ...appRuns.filter((r) => r.agent_kind === "human").map((r) => r.earned_points));
  const aiBest = Math.max(0, ...appRuns.filter((r) => r.agent_kind === "agent").map((r) => r.earned_points));
  const hasRuns = appRuns.length > 0;

  return (
    <div>
      {/* ---------------- HEADER ---------------- */}
      <section className="relative overflow-hidden border-b border-border-soft">
        {game.header_image && (
          <div className="absolute inset-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={game.header_image} alt="" className="h-full w-full object-cover opacity-20" />
            <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/80 to-bg/40" />
          </div>
        )}
        <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-10 sm:px-6">
          <Link href="/games" className="text-sm text-muted hover:text-brand">
            ← All games
          </Link>
          <div className="mt-4 grid gap-6 lg:grid-cols-[20rem_1fr]">
            {game.header_image && (
              <div className="card overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={game.header_image} alt={game.name} className="w-full object-cover" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-balance text-3xl font-black tracking-tight sm:text-4xl">
                {game.name}
              </h1>
              {game.genres.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {game.genres.map((g) => (
                    <span key={g} className="chip">
                      {g}
                    </span>
                  ))}
                </div>
              )}
              {game.short_description && (
                <p className="mt-4 max-w-2xl text-pretty text-muted">{game.short_description}</p>
              )}
              <div className="mt-5">
                <div className="mb-1.5 flex items-center justify-between text-xs text-faint">
                  <span>Difficulty mix</span>
                  <span className="tabular">{game.num_achievements} achievements</span>
                </div>
                <TierHistogram hist={game.tier_histogram} height={10} />
              </div>
            </div>
          </div>

          {/* stat strip */}
          <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat
              label="Achievements"
              value={fmtNum(game.num_achievements)}
              accent="var(--color-brand)"
            />
            <Stat
              label="Bits to 100%"
              value={Math.round(game.total_bits)}
              sub="full clear"
            />
            <Stat
              label="Total points"
              value={fmtNum(game.total_points)}
              accent="var(--color-accent)"
            />
            <Stat
              label="Owners"
              value={fmtNum(game.owners_estimate ?? 0)}
              sub={game.review_count != null ? `${fmtNum(game.review_count)} reviews` : undefined}
            />
          </div>
        </div>
      </section>

      {/* ---------------- WHO LEADS THIS GAME ---------------- */}
      {hasRuns && (
        <section className="mx-auto max-w-7xl px-4 pt-10 sm:px-6">
          <SectionHeading kicker="Humans vs AI" title={`Who leads ${game.name}`} />
          <div className="mx-auto max-w-2xl">
            <GameVersus humanBest={humanBest} aiBest={aiBest} />
          </div>
        </section>
      )}

      {/* ---------------- DIFFICULTY LADDER ---------------- */}
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <SectionHeading kicker="Hardest first" title="The difficulty ladder">
          <span className="chip">rarity → bits → points</span>
        </SectionHeading>

        {tasks.length > 0 && (
          <div className="card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-5">
            <div className="shrink-0 text-xs text-faint">
              Task mix ·{" "}
              <span className="font-semibold" style={{ color: "var(--color-ai)" }}>
                {Math.round((mix.skill / mixTotal) * 100)}% skill
              </span>
            </div>
            <div className="flex-1">
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-bg-soft">
                {MIX_ORDER.map((ty) => {
                  const w = (mix[ty] / mixTotal) * 100;
                  if (!w) return null;
                  return <div key={ty} style={{ width: `${w}%`, background: TYPE_COLOR[ty] }} title={`${TYPE_LABEL[ty]}: ${mix[ty]}`} />;
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                {(["skill", "progression", "grind", "social", "misc"] as TaskType[]).filter((ty) => mix[ty]).map((ty) => (
                  <span key={ty} className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: TYPE_COLOR[ty] }} />
                    <span style={{ color: TYPE_COLOR[ty] }}>{TYPE_LABEL[ty]}</span>
                    <span className="tabular text-faint">{mix[ty]}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {shown.length === 0 ? (
          <div className="card flex items-center justify-center p-10 text-sm text-muted">
            No tiered achievements available for this game yet.
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="hidden border-b border-border-soft bg-bg-soft px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-faint md:grid md:grid-cols-[7rem_1fr_5rem_5rem_5rem] md:items-center md:gap-3">
              <span>Tier</span>
              <span>Objective</span>
              <span className="text-right">Rarity</span>
              <span className="text-right">Bits</span>
              <span className="text-right">Points</span>
            </div>
            <div className="divide-y divide-border-soft">
              {shown.map((t) => (
                <LadderRow key={t.task_id} task={t} type={classOf.get(t.task_id)} />
              ))}
            </div>
            {hidden > 0 && (
              <div className="border-t border-border-soft bg-bg-soft px-4 py-3 text-center text-xs text-muted">
                Showing the {LADDER_CAP} hardest of {fmtNum(tasks.length)} objectives ·{" "}
                <span className="tabular text-fg">{fmtNum(hidden)}</span> easier ones hidden
              </div>
            )}
          </div>
        )}

        {/* CTA for real Steam games */}
        {isSteam && (
          <div className="card mt-8 flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
            <div>
              <div className="text-lg font-bold">Score yourself on {game.name}</div>
              <p className="mt-1 max-w-xl text-sm text-muted">
                Bind your Steam account and your real unlocks rank you against everyone — humans and
                machines alike — on this exact ladder.
              </p>
            </div>
            <Link href="/me" className="btn btn-primary shrink-0">
              Connect your Steam →
            </Link>
          </div>
        )}

        {/* Standings on this game + (arcade) play/watch */}
        {(hasRuns || !isSteam) && (
          <div className={`mt-8 grid gap-6 ${!isSteam && hasRuns ? "lg:grid-cols-[1fr_20rem]" : ""}`}>
            {hasRuns && (
              <div className="card p-6">
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-bold">Top runs on {game.name}</div>
                  <span className="chip">{isSteam ? "steam-verified" : "replay-verified"}</span>
                </div>
                <div className="space-y-2">
                  {topRuns.map((r, i) => (
                    <div
                      key={`${r.agent_id}:${r.seed}:${i}`}
                      className="flex items-center gap-3 rounded-lg border border-border-soft bg-bg-soft px-3 py-2"
                    >
                      <span className="tabular w-5 text-center text-sm text-faint">{i + 1}</span>
                      <KindBadge kind={r.agent_kind} />
                      <span className="flex-1 truncate text-sm font-medium">{r.agent_id}</span>
                      <span className="tabular text-xs text-faint">{r.unlocked.length} 🏆</span>
                      <span className="tabular w-16 text-right font-bold text-brand">
                        {fmtNum(r.earned_points)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!isSteam && (
              <div className="card flex flex-col justify-center gap-3 p-6">
                <div className="text-sm text-muted">Think you can beat the bots?</div>
                <Link href={`/play/${slug}`} className="btn btn-primary justify-center">
                  ▶ Play {game.name}
                </Link>
                <Link href="/live" className="btn justify-center">
                  Watch an AI play →
                </Link>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function LadderRow({ task: t, type }: { task: Task; type?: TaskType }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 md:grid-cols-[7rem_1fr_5rem_5rem_5rem]">
      <div className="md:order-1">
        <TierBadge tier={t.tier} small />
      </div>
      <div className="order-first min-w-0 md:order-2">
        <div className="flex items-center gap-2.5">
          {t.icon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={t.icon} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded border border-border-soft" />
          ) : null}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {type && (
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: TYPE_COLOR[type] }}
                  title={`${TYPE_LABEL[type]} task`}
                />
              )}
              <span className="truncate font-medium">{t.name}</span>
            </div>
            {t.description && <div className="truncate text-xs text-muted">{t.description}</div>}
          </div>
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-faint md:hidden">
          <span className="tabular">{fmtPct(t.rarity * 100)}% rare</span>
          <span className="tabular">{Math.round(t.bits)} bits</span>
          <span className="tabular text-brand">{fmtNum(t.points)} pts</span>
        </div>
      </div>
      <span className="tabular hidden text-right text-sm text-muted md:block md:order-3">
        {fmtPct(t.rarity * 100)}%
      </span>
      <span className="tabular hidden text-right text-sm text-fg md:block md:order-4">
        {t.bits.toFixed(1)}
      </span>
      <span className="tabular hidden text-right text-sm font-semibold text-brand md:block md:order-5">
        {fmtNum(t.points)}
      </span>
    </div>
  );
}
