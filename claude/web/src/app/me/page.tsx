import { cookies } from "next/headers";
import { getSteamGames } from "@/lib/data";
import { SteamPanel } from "@/components/steam-panel";

export const metadata = { title: "Connect Steam — SteamBench" };

export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<{ steamid?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const jar = await cookies();
  const steamid = sp.steamid || jar.get("sb_steamid")?.value || "";
  const name = jar.get("sb_steamname")?.value
    ? decodeURIComponent(jar.get("sb_steamname")!.value)
    : "";

  const games = getSteamGames()
    .filter((g) => g.appid < 9_000_000)
    .map((g) => ({ appid: g.appid, name: g.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="section-wrap max-w-3xl pt-16">
      <div className="text-center">
        <h1 className="text-5xl font-semibold tracking-tight">
          Bind your <span className="text-brand">Steam</span>, join the fight
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-muted">
          Sign in through Steam, pick a game you&apos;ve played, and SteamBench
          reads your real achievements and scores them against the AI on the same
          difficulty ladder. Your profile must be public.
        </p>
      </div>

      {sp.error && (
        <div className="mx-auto mt-6 max-w-md rounded-2xl border border-bad/40 bg-bad/10 p-3 text-center text-sm text-bad">
          Steam sign-in failed ({sp.error}). You can also enter your SteamID64 manually below.
        </div>
      )}

      <div className="mt-8">
        <SteamPanel initialSteamId={steamid} initialName={name} games={games} />
      </div>
    </div>
  );
}
