import { TIER_COLOR } from "@/lib/difficulty";
import { TIER_LABEL, type Tier, type PlayerKind } from "@/lib/types";

export function TierBadge({ tier, small }: { tier: Tier; small?: boolean }) {
  const color = TIER_COLOR[tier];
  return (
    <span
      className={`chip ${small ? "!px-2 !py-0.5 !text-[0.65rem]" : ""}`}
      style={{ color, borderColor: `${color}55`, background: `${color}14` }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {TIER_LABEL[tier]}
    </span>
  );
}

export function KindBadge({ kind }: { kind: PlayerKind }) {
  const human = kind === "human";
  const color = human ? "var(--color-human)" : "var(--color-ai)";
  return (
    <span
      className="chip"
      style={{ color, borderColor: `color-mix(in srgb, ${color} 40%, transparent)` }}
    >
      {human ? "🧑 Human" : "🤖 AI"}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-faint">{label}</div>
      <div className="tabular mt-1 text-2xl font-bold" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub != null && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function MasteryBar({ value, color = "var(--color-brand)" }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-bg-soft">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

const TIER_ORDER: Tier[] = ["tutorial", "easy", "medium", "hard", "elite", "legendary"];

export function TierHistogram({
  hist,
  height = 8,
}: {
  hist: Record<string, number>;
  height?: number;
}) {
  const total = TIER_ORDER.reduce((n, t) => n + (hist[t] || 0), 0) || 1;
  return (
    <div className="flex w-full overflow-hidden rounded-full" style={{ height }}>
      {TIER_ORDER.map((t) => {
        const w = ((hist[t] || 0) / total) * 100;
        if (w === 0) return null;
        return (
          <div
            key={t}
            style={{ width: `${w}%`, background: TIER_COLOR[t] }}
            title={`${TIER_LABEL[t]}: ${hist[t]}`}
          />
        );
      })}
    </div>
  );
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

export function fmtPct(p: number): string {
  if (p < 0.1) return p.toFixed(3);
  if (p < 1) return p.toFixed(2);
  return p.toFixed(1);
}

export function SectionHeading({
  kicker,
  title,
  children,
}: {
  kicker?: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {kicker && (
          <div className="text-xs font-semibold uppercase tracking-wider text-brand">{kicker}</div>
        )}
        <h2 className="mt-1 text-2xl font-bold tracking-tight">{title}</h2>
      </div>
      {children}
    </div>
  );
}
