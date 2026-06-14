import Link from "next/link";
import { getArcadeGames } from "@/lib/data";
import { TierHistogram, SectionHeading } from "@/components/ui";

export const metadata = { title: "Play the Arcade — SteamBench" };

export default function PlayIndex() {
  const games = getArcadeGames();
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <SectionHeading kicker="No Steam required" title="Play the SteamBench Arcade">
        <Link href="/leaderboard" className="btn">Leaderboard →</Link>
      </SectionHeading>
      <p className="-mt-2 mb-8 max-w-2xl text-muted">
        These are original, headless, fully-deterministic games with Steam-style
        achievement ladders. You play in the browser; an AI plays through the
        Python harness — and both runs are verified the same way (the server
        replays your moves to recompute the score). Beat the bots.
      </p>
      <div className="grid gap-5 sm:grid-cols-2">
        {games.map((g) => {
          const slug = (g.env_id ?? "").replace("arcade/", "");
          return (
            <Link key={g.appid} href={`/play/${slug}`} className="card card-hover group p-6">
              <div className="flex items-center justify-between">
                <div className="text-xl font-bold">{g.name}</div>
                <span className="chip">{g.num_achievements} achievements</span>
              </div>
              <p className="mt-2 text-sm text-muted">{g.short_description}</p>
              <div className="mt-4"><TierHistogram hist={g.tier_histogram} /></div>
              <div className="mt-4 flex items-center justify-between text-xs text-faint">
                <span className="tabular">{Math.round(g.total_bits)} bits to 100%</span>
                <span className="text-brand group-hover:underline">Play {g.name} →</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
