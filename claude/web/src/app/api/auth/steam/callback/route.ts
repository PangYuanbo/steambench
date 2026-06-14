import { verifySteamCallback, fetchSteamProfile } from "@/lib/steam";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const steamid = await verifySteamCallback(url.searchParams);
  if (!steamid) {
    return Response.redirect(`${url.origin}/me?error=steam_verify_failed`, 302);
  }
  // Best-effort profile for a friendlier cookie + redirect.
  let name = steamid;
  try {
    const p = await fetchSteamProfile(steamid);
    name = p.name;
  } catch {
    /* ignore */
  }
  const headers = new Headers();
  headers.set("Location", `${url.origin}/me?steamid=${steamid}`);
  // 30-day identity cookie. HttpOnly so client JS can't tamper; SameSite=Lax.
  const maxAge = 60 * 60 * 24 * 30;
  headers.append(
    "Set-Cookie",
    `sb_steamid=${steamid}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`
  );
  headers.append(
    "Set-Cookie",
    `sb_steamname=${encodeURIComponent(name)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`
  );
  return new Response(null, { status: 302, headers });
}
