"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TierHistogram, fmtNum } from "@/components/ui";
import type { Game } from "@/lib/types";

type GameCard = Game & { skill_share?: number };
type SortKey = "owners" | "bits" | "skill" | "achievements" | "name";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "owners", label: "Most owned" },
  { key: "bits", label: "Hardest to 100%" },
  { key: "skill", label: "Most skill" },
  { key: "achievements", label: "Most achievements" },
  { key: "name", label: "A–Z" },
];

export function SteamGrid({ games }: { games: GameCard[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("owners");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? games.filter(
          (g) =>
            g.name.toLowerCase().includes(q) ||
            g.genres.some((x) => x.toLowerCase().includes(q))
        )
      : [...games];
    list.sort((a, b) => {
      switch (sort) {
        case "name":
          return a.name.localeCompare(b.name);
        case "bits":
          return b.total_bits - a.total_bits;
        case "skill":
          return (b.skill_share ?? 0) - (a.skill_share ?? 0);
        case "achievements":
          return b.num_achievements - a.num_achievements;
        default:
          return (b.owners_estimate ?? 0) - (a.owners_estimate ?? 0);
      }
    });
    return list;
  }, [games, query, sort]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search games or genres…"
          className="input-control min-w-0 flex-1 text-sm"
        />
        <div className="flex rounded-full border border-border-soft bg-bg-soft p-1">
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={`rounded-full px-2.5 py-1.5 text-xs font-medium transition ${
                sort === s.key ? "bg-surface-2 text-brand" : "text-muted hover:text-fg"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="tabular text-xs text-faint">
          {filtered.length} / {games.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="card flex items-center justify-center p-10 text-sm text-muted">
          No games match “{query}”.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((g) => (
            <SteamCard key={g.appid} game={g} highlightSkill={sort === "skill"} />
          ))}
        </div>
      )}
    </div>
  );
}

function SteamCard({ game: g, highlightSkill }: { game: GameCard; highlightSkill?: boolean }) {
  const skillPct = g.skill_share != null ? Math.round(g.skill_share * 100) : null;
  return (
    <Link href={`/games/${g.appid}`} className="card card-hover group overflow-hidden">
      {g.header_image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={g.header_image}
          alt={g.name}
          loading="lazy"
          className="h-32 w-full object-cover opacity-90 transition group-hover:opacity-100"
        />
      ) : (
        <div className="grid-faint flex h-32 w-full items-center justify-center bg-bg-soft">
          <span className="text-2xl font-semibold text-faint">{g.name.slice(0, 2)}</span>
        </div>
      )}
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="truncate font-semibold">{g.name}</div>
          <span className="tabular shrink-0 text-xs text-faint">{g.num_achievements} ach</span>
        </div>
        <div className="mt-3">
          <TierHistogram hist={g.tier_histogram} />
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-muted">
          <span>{fmtNum(g.owners_estimate ?? 0)} owners</span>
          {highlightSkill && skillPct != null ? (
            <span className="tabular" style={{ color: "var(--color-ai)" }}>{skillPct}% skill</span>
          ) : (
            <span className="tabular">{Math.round(g.total_bits)} bits to 100%</span>
          )}
        </div>
      </div>
    </Link>
  );
}
