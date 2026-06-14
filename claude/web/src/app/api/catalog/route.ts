import { getGameCards, getArcadeGames, getSummary } from "@/lib/data";

export async function GET() {
  return Response.json({
    games: getGameCards(),
    arcade: getArcadeGames().map(({ tasks, ...g }) => ({ ...g, num_tasks: tasks?.length ?? 0 })),
    summary: getSummary(),
  });
}
