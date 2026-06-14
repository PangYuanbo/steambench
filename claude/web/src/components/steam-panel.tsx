"use client";

import { useState } from "react";
import Link from "next/link";

interface GameOpt {
  appid: number;
  name: string;
}

interface ScoreResult {
  ok: boolean;
  profile?: { name: string; avatar: string; profileUrl: string };
  game?: { appid: number; name: string };
  unlocked_count?: number;
  total_tasks?: number;
  earned_points?: number;
  earned_bits?: number;
  mastery?: number;
  completion?: number;
  error?: string;
  reason?: string;
}

export function SteamPanel({
  initialSteamId,
  initialName,
  games,
}: {
  initialSteamId: string;
  initialName: string;
  games: GameOpt[];
}) {
  const [steamid, setSteamid] = useState(initialSteamId);
  const [appid, setAppid] = useState(games[0]?.appid ?? 0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const bound = Boolean(initialSteamId);

  async function score() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/steam/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamid, appid }),
      });
      setResult(await res.json());
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* connect / status */}
      <div className="card p-5">
        {bound ? (
          <div className="flex items-center gap-3">
            <span className="live-dot inline-block h-2.5 w-2.5 rounded-full bg-good text-good" />
            <div className="flex-1">
              <div className="font-semibold">
                Connected{initialName ? ` as ${initialName}` : ""}
              </div>
              <div className="tabular text-xs text-faint">SteamID {initialSteamId}</div>
            </div>
            <a href="/api/auth/steam/login" className="btn">Re-connect</a>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <a href="/api/auth/steam/login" className="btn btn-primary">
              <SteamGlyph /> Sign in through Steam
            </a>
            <div className="text-xs text-faint">
              Official Steam OpenID — we never see your password.
            </div>
          </div>
        )}
      </div>

      {/* manual + game pick */}
      <div className="card p-5">
        <div className="mb-3 text-sm font-semibold">Score yourself on a game</div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input
            value={steamid}
            onChange={(e) => setSteamid(e.target.value)}
            placeholder="SteamID64 (17 digits)"
            className="tabular rounded-lg border border-border bg-bg-soft px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <select
            value={appid}
            onChange={(e) => setAppid(Number(e.target.value))}
            className="rounded-lg border border-border bg-bg-soft px-3 py-2 text-sm outline-none focus:border-brand"
          >
            {games.map((g) => (
              <option key={g.appid} value={g.appid}>{g.name}</option>
            ))}
          </select>
          <button
            className="btn btn-primary justify-center"
            onClick={score}
            disabled={loading || !/\d{17}/.test(steamid)}
          >
            {loading ? "Reading…" : "Score me"}
          </button>
        </div>
        <p className="mt-2 text-xs text-faint">
          Don&apos;t know your SteamID64? Sign in above and it fills automatically.
          Your Steam profile and game details must be set to public.
        </p>
      </div>

      {/* result */}
      {result && (
        <div className="card p-5" style={result.ok ? { borderLeft: "3px solid var(--color-human)" } : undefined}>
          {result.ok ? (
            <div>
              <div className="flex items-center gap-3">
                {result.profile?.avatar && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={result.profile.avatar} alt="" className="h-12 w-12 rounded-lg" />
                )}
                <div className="flex-1">
                  <div className="font-semibold">{result.profile?.name}</div>
                  <div className="text-xs text-faint">{result.game?.name}</div>
                </div>
                <KindPill />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <Metric label="Achievements" value={`${result.unlocked_count}/${result.total_tasks}`} />
                <Metric label="Points" value={String(result.earned_points)} accent />
                <Metric label="Mastery" value={`${Math.round((result.mastery ?? 0) * 100)}%`} />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-faint">Recorded as a human run — verified by Steam.</span>
                <div className="flex items-center gap-3 text-sm">
                  {result.game && (
                    <Link href={`/games/${result.game.appid}`} className="text-human hover:underline">
                      You vs AI on {result.game.name} →
                    </Link>
                  )}
                  <Link href="/leaderboard" className="text-brand hover:underline">Board →</Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-bad">
              Couldn&apos;t read achievements: {result.reason || result.error}.
              <div className="mt-1 text-xs text-faint">
                Make sure your profile + game details are public, and that you own the game.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border-soft bg-bg-soft p-3">
      <div className="text-[0.65rem] uppercase tracking-wider text-faint">{label}</div>
      <div
        className="tabular mt-1 text-xl font-bold"
        style={{ color: accent ? "var(--color-human)" : "var(--color-fg)" }}
      >
        {value}
      </div>
    </div>
  );
}

function KindPill() {
  return (
    <span className="chip" style={{ color: "var(--color-human)", borderColor: "var(--color-human)55" }}>
      🧑 Human
    </span>
  );
}

function SteamGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 0 0-9.9 8.7l5.4 2.2a2.8 2.8 0 0 1 1.6-.5l2.4-3.5v-.05a3.75 3.75 0 1 1 3.75 3.75h-.08l-3.45 2.46a2.8 2.8 0 0 1-5.55.5L2.3 14a10 10 0 1 0 9.7-12zm-4.2 15.2a2.15 2.15 0 0 1-1.2-2.8l1 .4a1.58 1.58 0 1 0 1.2-2.9l-1-.4a2.15 2.15 0 0 1 2.9 2 2.15 2.15 0 0 1-2.9 3.7zm8.7-7.2a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
    </svg>
  );
}
