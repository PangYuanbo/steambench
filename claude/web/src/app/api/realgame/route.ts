import { getSteamGames, getGame, getTasksForApp } from "@/lib/data";
import { classifyAchievement, type TaskType } from "@/lib/taxonomy";
import type { Task } from "@/lib/types";

/**
 * The real-game task surface — the `steam_api` analog of `/api/arcade`.
 *
 * Real Steam games are first-class benchmark tasks: an agent plays them through
 * the **gamepad action space** (streamed via GeForce NOW), and the achievements
 * it unlocks on the bound Steam account are read straight from Steam and scored
 * on the same `−log₂(rarity)` bits scale as everything else. This endpoint gives
 * an agent everything it needs to attempt one: the controls, the achievement
 * ladder as scored tasks, and how to submit.
 *
 *   GET /api/realgame            → controls + contract + every cataloged game
 *   GET /api/realgame?appid=620  → full task spec (achievement ladder) for one
 */

// Mirrors steambench_harness.gamepad.GamepadActionSpace.spec()/describe().
const GAMEPAD_ACTION_SPACE = {
  kind: "gamepad",
  buttons: [
    "A", "B", "X", "Y", "LB", "RB", "LS", "RS", "START", "BACK", "GUIDE",
    "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT",
  ],
  axes: ["lx", "ly", "rx", "ry", "lt", "rt"],
  ranges: { stick: [-1, 1], trigger: [0, 1] },
  frame:
    'One GamepadAction per step: held buttons + 2 analog sticks + 2 triggers, ' +
    'e.g. {"buttons":["A","DPAD_UP"],"lx":1.0,"ly":0.0,"rx":0,"ry":0,"lt":0,"rt":1.0}. ' +
    "lx/ly/rx/ry in [-1,1] (ly: +1 up); lt/rt in [0,1]. Hold a button across steps to keep it pressed.",
} as const;

const CONTRACT = {
  verify_mode: "steam_api",
  scoring:
    "points = 100 · −log₂(rarity) per unlocked achievement — the same bits scale as the arcade, so humans and AI sit on one yardstick.",
  task_signal:
    "Each task carries task_type (skill/progression/grind/social/misc) + benchmark_grade (0–1). 'recommended_tasks' are the skill achievements that best test ability — target these. Scoring is still by rarity bits; the taxonomy is guidance, not score.",
  observation: "obs.frame — the raw streamed pixels of the game (base64 PNG).",
  play:
    "Stream the game (e.g. GeForce NOW), read each frame, emit a GamepadAction. See CONNECTING_GEFORCE_NOW.md / runtime/geforce_now.py.",
  submit: {
    endpoint: "/api/steam/score",
    method: "POST",
    auth: "Authorization: Bearer <agent key>  (from /api/agents/register)",
    body: { steamid: "<17-digit>", appid: "<appid>", num_steps: "<optional int>" },
    note: "With an agent key the run is recorded as an AGENT run on steam/<appid> — head-to-head with humans. Achievements are read from Steam, so nothing can be faked.",
  },
} as const;

function taskSpec(t: Task) {
  // Enrich with the skill taxonomy so an agent can target the achievements that
  // actually test ability, not just the rare ones (see lib/taxonomy.ts).
  const c = classifyAchievement(t.name || "", t.description || "", t.rarity);
  return {
    task_id: t.task_id,
    name: t.name,
    description: t.description,
    kind: t.kind,
    rarity: t.rarity,
    percent: Math.round(t.rarity * 1000) / 10,
    bits: t.bits,
    points: t.points,
    tier: t.tier,
    task_type: c.type,
    benchmark_grade: c.benchmarkGrade,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const appid = Number(url.searchParams.get("appid"));

  if (appid) {
    const g = getGame(appid);
    if (!g || g.appid >= 9_000_000) {
      return Response.json(
        { error: `unknown Steam appid '${url.searchParams.get("appid")}'` },
        { status: 404 }
      );
    }
    const tasks = getTasksForApp(appid).map(taskSpec).sort((a, b) => b.bits - a.bits);
    const task_mix: Record<TaskType, number> = { skill: 0, progression: 0, grind: 0, social: 0, misc: 0 };
    for (const t of tasks) task_mix[t.task_type] += 1;
    const recommended_tasks = [...tasks]
      .filter((t) => t.task_type === "skill")
      .sort((a, b) => b.benchmark_grade - a.benchmark_grade)
      .slice(0, 10)
      .map((t) => ({ task_id: t.task_id, name: t.name, benchmark_grade: t.benchmark_grade, percent: t.percent, points: t.points }));
    return Response.json({
      appid: g.appid,
      name: g.name,
      header: g.header_image,
      verify_mode: "steam_api",
      num_achievements: g.num_achievements,
      total_bits: g.total_bits,
      total_points: g.total_points,
      tier_histogram: g.tier_histogram,
      task_mix,
      recommended_tasks,
      action_space: GAMEPAD_ACTION_SPACE,
      tasks,
      contract: CONTRACT,
    });
  }

  const games = getSteamGames()
    .filter((g) => g.num_achievements > 0)
    .map((g) => {
      const ts = g.tasks ?? [];
      let skill = 0;
      for (const t of ts) {
        if (classifyAchievement(t.name || "", t.description || "", t.rarity).type === "skill") skill += 1;
      }
      return {
        appid: g.appid,
        name: g.name,
        header: g.header_image,
        num_achievements: g.num_achievements,
        total_bits: g.total_bits,
        total_points: g.total_points,
        tier_histogram: g.tier_histogram,
        skill_share: ts.length ? Math.round((skill / ts.length) * 100) / 100 : 0,
        hardest: g.hardest
          ? {
              name: g.hardest.display_name || g.hardest.name,
              rarity: g.hardest.rarity,
              bits: g.hardest.bits,
              tier: g.hardest.tier,
            }
          : null,
      };
    })
    .sort((a, b) => b.total_bits - a.total_bits);

  return Response.json({
    action_space: GAMEPAD_ACTION_SPACE,
    contract: CONTRACT,
    count: games.length,
    games,
  });
}
