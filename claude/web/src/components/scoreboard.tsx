import Link from "next/link";
import { fmtNum } from "./ui";
import type { HumanVsAI } from "@/lib/types";

/**
 * The signature human(amber) ↔ AI(cyan) scoreboard: two camps split by a seam
 * carrying the duality gradient + a VS token, with a tug-of-war bar that reads
 * the relative Elo at a glance. One component, used on the landing hero and the
 * leaderboard so the rivalry framing is identical everywhere.
 */
export function Scoreboard({ hva }: { hva: HumanVsAI }) {
  return (
    <div className="card overflow-hidden">
      <div className="relative grid grid-cols-2">
        <Camp side="human" label="Humans" elo={hva.human_elo} wins={hva.human_wins} leading={hva.leader === "human"} />
        <Camp side="ai" label="AI Agents" elo={hva.ai_elo} wins={hva.ai_wins} leading={hva.leader === "ai"} />
        {/* center seam carrying the amber↔cyan duality + a VS token */}
        <div className="seam-duality pointer-events-none absolute inset-y-4 left-1/2 w-px -translate-x-1/2 opacity-50" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-[0.64rem] font-semibold tracking-wide text-faint">
          VS
        </div>
      </div>
      <TugOfWar human={hva.human_elo} ai={hva.ai_elo} />
      <div className="border-t border-border-soft bg-bg-soft px-4 py-2 text-center text-xs text-muted">
        {hva.games_contested > 0 ? (
          <>
            {hva.games_contested} games contested
            {hva.draws ? <> · {hva.draws} draws</> : null} · Elo gap{" "}
            <span className="tabular text-fg">{Math.round(hva.gap)}</span>
          </>
        ) : (
          <>
            No human has contested the AI yet —{" "}
            <Link href="/play" className="text-brand hover:underline">be the first</Link>.
          </>
        )}
      </div>
    </div>
  );
}

function Camp({
  side,
  label,
  elo,
  wins,
  leading,
}: {
  side: "human" | "ai";
  label: string;
  elo: number;
  wins: number;
  leading: boolean;
}) {
  const color = side === "human" ? "var(--color-human)" : "var(--color-ai)";
  return (
    <div className="relative p-6 text-center" style={{ background: leading ? `${color}0d` : undefined }}>
      <div className="flex items-center justify-center gap-1.5 text-sm font-semibold" style={{ color }}>
        <span aria-hidden>{side === "human" ? "🧑" : "🤖"}</span>
        {label}
      </div>
      <div className="tabular mt-2 text-5xl font-semibold leading-none" style={{ color }}>
        {Math.round(elo)}
      </div>
      <div className="mt-1.5 text-xs text-muted">Elo · {wins} game wins</div>
      {leading && (
        <div className="chip absolute right-3 top-3" style={{ color, borderColor: `${color}55` }}>
          leading
        </div>
      )}
    </div>
  );
}

/**
 * Compact per-game head-to-head for a single title's page: best human run vs
 * best AI run (in points), the same amber↔cyan signature scaled down. Makes the
 * "humans vs AI on *this* game" thesis visible per Steam title.
 */
export function GameVersus({ humanBest, aiBest }: { humanBest: number; aiBest: number }) {
  const human = "var(--color-human)";
  const ai = "var(--color-ai)";
  const total = humanBest + aiBest;
  const humanPct = total > 0 ? Math.round((humanBest / total) * 1000) / 10 : 50;
  const leader = humanBest > aiBest ? "Humans lead" : aiBest > humanBest ? "AI leads" : "Dead heat";
  const leadColor = humanBest > aiBest ? human : aiBest > humanBest ? ai : "var(--color-muted)";
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-5">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: human }}>
            <span aria-hidden>🧑</span>Humans
          </div>
          <div className="tabular mt-1 text-3xl font-semibold leading-none" style={{ color: human }}>{fmtNum(humanBest)}</div>
          <div className="mt-1 text-[0.65rem] text-faint">best points</div>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-bg text-[0.7rem] font-bold tracking-wide text-faint">
          VS
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-1.5 text-xs font-semibold" style={{ color: ai }}>
            AI<span aria-hidden>🤖</span>
          </div>
          <div className="tabular mt-1 text-3xl font-semibold leading-none" style={{ color: ai }}>{fmtNum(aiBest)}</div>
          <div className="mt-1 text-[0.65rem] text-faint">best points</div>
        </div>
      </div>
      <div className="px-5 pb-4">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-bg-soft">
          <div style={{ width: `${humanPct}%`, background: human }} />
          <div style={{ width: `${100 - humanPct}%`, background: ai }} />
        </div>
      </div>
      <div className="border-t border-border-soft bg-bg-soft px-4 py-2 text-center text-xs">
        <span className="font-semibold" style={{ color: leadColor }}>{leader}</span> on this game
      </div>
    </div>
  );
}

// The rivalry at a glance: a tug-of-war split by relative Elo (amber ↔ cyan).
function TugOfWar({ human, ai }: { human: number; ai: number }) {
  const total = human + ai || 1;
  const humanPct = Math.round((human / total) * 1000) / 10;
  return (
    <div className="px-4 pb-3 pt-3">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-bg-soft">
        <div style={{ width: `${humanPct}%`, background: "var(--color-human)" }} />
        <div style={{ width: `${100 - humanPct}%`, background: "var(--color-ai)" }} />
      </div>
      <div className="tabular mt-1.5 flex justify-between text-[0.65rem] font-medium">
        <span style={{ color: "var(--color-human)" }}>{humanPct.toFixed(1)}%</span>
        <span style={{ color: "var(--color-ai)" }}>{(100 - humanPct).toFixed(1)}%</span>
      </div>
    </div>
  );
}
