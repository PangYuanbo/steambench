import { getLeaderboard } from "@/lib/data";

export async function GET() {
  const lb = await getLeaderboard();
  return Response.json(lb);
}
