import Link from "next/link";
import { notFound } from "next/navigation";
import { make, ENV_IDS } from "@/lib/arcade/registry";
import { PlayClient } from "@/components/play-client";

export async function generateMetadata({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  return { title: `Play ${game} — SteamBench Arcade` };
}

export default async function PlayGame({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  const envId = `arcade/${game}`;
  if (!ENV_IDS.includes(envId)) notFound();
  const spec = make(envId).spec();

  return (
    <div className="section-wrap max-w-6xl pt-12">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/play" className="text-sm text-muted hover:text-brand">← Arcade</Link>
          <h1 className="mt-1 text-4xl font-semibold tracking-tight">{spec.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{spec.description}</p>
        </div>
        <span className="chip hidden sm:inline-flex">replay-verified</span>
      </div>
      <PlayClient envId={envId} spec={spec} />
    </div>
  );
}
