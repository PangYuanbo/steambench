import { buildSteamLoginUrl } from "@/lib/steam";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const returnTo = `${origin}/api/auth/steam/callback`;
  const loginUrl = buildSteamLoginUrl(returnTo, origin);
  return Response.redirect(loginUrl, 302);
}
