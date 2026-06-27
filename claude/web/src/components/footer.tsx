import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border-soft bg-bg-soft/60">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="font-display text-sm font-semibold">
            Steam<span className="text-brand">Bench</span>
          </div>
          <p className="mt-2 max-w-sm text-sm text-muted">
            An open benchmark where humans and AI agents compete on the same
            games. Steam achievement rarity becomes information-theoretic
            difficulty — one yardstick for people and machines.
          </p>
        </div>
        <div>
          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
            Explore
          </div>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li><Link href="/leaderboard" className="hover:text-brand">Leaderboard</Link></li>
            <li><Link href="/games" className="hover:text-brand">Games</Link></li>
            <li><Link href="/play" className="hover:text-brand">Play the arcade</Link></li>
            <li><Link href="/live" className="hover:text-brand">Watch AI live</Link></li>
          </ul>
        </div>
        <div>
          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-faint">
            Build
          </div>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li><Link href="/agents" className="hover:text-brand">Submit an agent</Link></li>
            <li><Link href="/methodology" className="hover:text-brand">Difficulty model</Link></li>
            <li><Link href="/me" className="hover:text-brand">Connect Steam</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border-soft py-4 text-center text-xs text-faint">
        SteamBench · built for the humans-vs-AI era · data from public Steam endpoints
      </div>
    </footer>
  );
}
