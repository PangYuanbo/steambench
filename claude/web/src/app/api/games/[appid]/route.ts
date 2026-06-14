import { getGame } from "@/lib/data";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ appid: string }> }
) {
  const { appid } = await params;
  const game = getGame(Number(appid));
  if (!game) {
    return Response.json({ error: "game not found" }, { status: 404 });
  }
  return Response.json({ game });
}
