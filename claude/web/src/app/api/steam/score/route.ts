import { getGame, getTasksForApp } from "@/lib/data";
import { fetchUnlockedAchievements, fetchSteamProfile } from "@/lib/steam";
import { scoreRun } from "@/lib/scoring";
import { addRun, agentForKey } from "@/lib/store";
import type { PlayerKind, RunRow } from "@/lib/types";

/**
 * Score a Steam account's REAL achievements on one of our cataloged games and
 * record it on the leaderboard — verified by Steam itself (the `steam_api`
 * VerifyMode; real games can't be replayed). Works keyless via the public
 * community profile (which must be public).
 *
 * Two callers, one verified mechanism:
 *  - **No bearer key** → a HUMAN run (a person scoring their own account).
 *  - **Agent bearer key** → an AGENT run. This is how an AI that played a real
 *    Steam game — e.g. through GeForce NOW with the gamepad action space — lands
 *    on the *same* `steam/<appid>` board as humans. The achievements are read
 *    straight from Steam either way, so neither side can fake them.
 */
export async function POST(req: Request) {
  let body: { steamid?: string; appid?: number; num_steps?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const steamid = String(body.steamid || "").match(/\d{17}/)?.[0];
  const appid = Number(body.appid);
  if (!steamid) return Response.json({ error: "valid 17-digit steamid required" }, { status: 400 });
  const game = getGame(appid);
  if (!game) return Response.json({ error: "game not in catalog" }, { status: 404 });

  // Identity: an agent authenticates with a bearer key; a bare call is a human.
  const auth = req.headers.get("authorization");
  const key = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const agent = await agentForKey(key);

  const [{ unlocked, ok, reason }, profile] = await Promise.all([
    fetchUnlockedAchievements(steamid, appid),
    fetchSteamProfile(steamid),
  ]);
  if (!ok) {
    return Response.json({ error: "could not read achievements", reason }, { status: 422 });
  }

  const tasks = getTasksForApp(appid);
  const s = scoreRun(unlocked, tasks);

  const kind: PlayerKind = agent ? agent.kind : "human";
  const agent_id = agent ? agent.id : `steam:${profile.name || steamid}`;

  const row: RunRow = {
    env_id: `steam/${appid}`,
    appid,
    game: game.name,
    agent_id,
    agent_kind: kind,
    seed: 0,
    score: s.earned_points,
    steps: typeof body.num_steps === "number" ? body.num_steps : 0,
    unlocked,
    earned_points: s.earned_points,
    earned_bits: Math.round(s.earned_bits * 100) / 100,
    mastery: Math.round(s.mastery * 1e4) / 1e4,
    verified: true, // verified by Steam itself
    created_at: Date.now(),
  };
  await addRun(row);

  return Response.json({
    ok: true,
    profile,
    kind,
    authenticated: Boolean(agent),
    game: { appid: game.appid, name: game.name },
    unlocked_count: s.completed,
    total_tasks: s.total,
    earned_points: s.earned_points,
    earned_bits: row.earned_bits,
    mastery: row.mastery,
    completion: s.total ? s.completed / s.total : 0,
  });
}
