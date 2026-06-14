import { allSpecs } from "@/lib/arcade/registry";
import { getArcadeGames } from "@/lib/data";

// Specs + catalog metadata for the playable arcade games.
export async function GET() {
  const games = getArcadeGames();
  const byEnv = new Map(games.map((g) => [g.env_id, g]));
  const specs = allSpecs().map((s) => {
    const g = byEnv.get(s.env_id);
    return {
      ...s,
      appid: g?.appid ?? s.appid,
      total_bits: g?.total_bits,
      total_points: g?.total_points,
      tier_histogram: g?.tier_histogram,
    };
  });
  return Response.json({ envs: specs });
}
