// Steam integration: "Sign in through Steam" (OpenID 2.0) for human identity,
// plus per-user achievement reads. Achievement reads work WITHOUT a Steam Web
// API key via the public community profile XML (the keyless "小黑盒" approach);
// if STEAM_API_KEY is set we use the official endpoints for richer data.

const STEAM_OPENID = "https://steamcommunity.com/openid/login";

export function buildSteamLoginUrl(returnTo: string, realm: string): string {
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  return `${STEAM_OPENID}?${params.toString()}`;
}

/**
 * Verify an OpenID callback by echoing the params back to Steam with
 * mode=check_authentication. Returns the 17-digit steamid64 on success.
 */
export async function verifySteamCallback(
  query: URLSearchParams
): Promise<string | null> {
  if (query.get("openid.mode") !== "id_res") return null;
  const params = new URLSearchParams(query);
  params.set("openid.mode", "check_authentication");
  const res = await fetch(STEAM_OPENID, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const text = await res.text();
  if (!/is_valid\s*:\s*true/i.test(text)) return null;
  const claimed = query.get("openid.claimed_id") || "";
  const m = claimed.match(/(\d{17})/);
  return m ? m[1] : null;
}

export interface SteamProfile {
  steamid: string;
  name: string;
  avatar: string;
  profileUrl: string;
}

const UA = "SteamBench/0.1 (+https://steambench.app)";

export async function fetchSteamProfile(steamid: string): Promise<SteamProfile> {
  const key = process.env.STEAM_API_KEY;
  if (key) {
    try {
      const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${steamid}`;
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      const j = await r.json();
      const p = j?.response?.players?.[0];
      if (p)
        return {
          steamid,
          name: p.personaname || steamid,
          avatar: p.avatarfull || "",
          profileUrl: p.profileurl || `https://steamcommunity.com/profiles/${steamid}`,
        };
    } catch {
      /* fall through to public XML */
    }
  }
  // Keyless: public profile XML.
  try {
    const r = await fetch(
      `https://steamcommunity.com/profiles/${steamid}/?xml=1`,
      { headers: { "User-Agent": UA } }
    );
    const xml = await r.text();
    const name = xml.match(/<steamID>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/steamID>/)?.[1] ?? steamid;
    const avatar = xml.match(/<avatarFull>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/avatarFull>/)?.[1] ?? "";
    return {
      steamid,
      name,
      avatar,
      profileUrl: `https://steamcommunity.com/profiles/${steamid}`,
    };
  } catch {
    return { steamid, name: steamid, avatar: "", profileUrl: `https://steamcommunity.com/profiles/${steamid}` };
  }
}

/**
 * Unlocked achievement apinames for a user on a game.
 * Prefers the official API when a key is present, else parses the public
 * community stats XML (requires the user's profile/game details to be public).
 */
export async function fetchUnlockedAchievements(
  steamid: string,
  appid: number
): Promise<{ unlocked: string[]; ok: boolean; reason?: string }> {
  const key = process.env.STEAM_API_KEY;
  if (key) {
    try {
      const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?appid=${appid}&key=${key}&steamid=${steamid}`;
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      const j = await r.json();
      if (j?.playerstats?.success) {
        const unlocked = (j.playerstats.achievements || [])
          .filter((a: { achieved: number }) => a.achieved === 1)
          .map((a: { apiname: string }) => a.apiname);
        return { unlocked, ok: true };
      }
      return { unlocked: [], ok: false, reason: j?.playerstats?.error || "private profile" };
    } catch (e) {
      return { unlocked: [], ok: false, reason: String(e) };
    }
  }
  // Keyless public XML: <achievements><achievement closed="1"><apiname>..</apiname>
  try {
    const r = await fetch(
      `https://steamcommunity.com/profiles/${steamid}/stats/${appid}/?xml=1&l=english`,
      { headers: { "User-Agent": UA } }
    );
    const xml = await r.text();
    const unlocked: string[] = [];
    const re = /<achievement[^>]*closed="1"[^>]*>([\s\S]*?)<\/achievement>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
      const api = m[1].match(/<apiname>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/apiname>/)?.[1];
      if (api) unlocked.push(api);
    }
    if (unlocked.length === 0 && /<privacyState>(?!public)/.test(xml)) {
      return { unlocked: [], ok: false, reason: "profile/game stats are private" };
    }
    return { unlocked, ok: true };
  } catch (e) {
    return { unlocked: [], ok: false, reason: String(e) };
  }
}
