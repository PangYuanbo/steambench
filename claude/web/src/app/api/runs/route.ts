import { getAllRuns, getGameByEnvId, getTasksForApp } from "@/lib/data";
import { addRun, agentForKey } from "@/lib/store";
import { scoreRun } from "@/lib/scoring";
import { verifyRun } from "@/lib/arcade/replay";
import { ENV_IDS } from "@/lib/arcade/registry";
import type { PlayerKind, RunRow, SubmittedRun } from "@/lib/types";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
  const envId = url.searchParams.get("env");
  let runs = await getAllRuns();
  if (envId) runs = runs.filter((r) => r.env_id === envId);
  return Response.json({ runs: runs.slice(0, limit) });
}

export async function POST(req: Request) {
  let body: { run?: SubmittedRun };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const run = body.run;
  if (!run || typeof run !== "object") {
    return Response.json({ error: "missing 'run' object" }, { status: 400 });
  }

  const { env_id, seed, actions, final_score, unlocked } = run;
  if (!ENV_IDS.includes(env_id)) {
    return Response.json(
      { error: `unknown or non-replayable env_id '${env_id}'`, replayable: ENV_IDS },
      { status: 400 }
    );
  }
  if (!Array.isArray(actions) || typeof seed !== "number") {
    return Response.json({ error: "run needs numeric 'seed' and 'actions' array" }, { status: 400 });
  }
  // Bound replay work: no legitimate arcade run is anywhere near this long.
  if (actions.length > 100_000) {
    return Response.json({ error: "actions trace too long (max 100000)" }, { status: 413 });
  }

  // Identity: agents authenticate with a bearer key; humans (browser) post a name.
  const auth = req.headers.get("authorization");
  const key = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const agent = await agentForKey(key);
  let agent_id = run.agent_id || "anonymous";
  let agent_kind: PlayerKind = run.agent_kind === "human" ? "human" : "agent";
  if (agent) {
    agent_id = agent.id;
    agent_kind = agent.kind;
  }

  // Replay-verify: the server is the source of truth for score + achievements.
  const verdict = verifyRun({ env_id, seed, actions, score: final_score, unlocked });
  if (!verdict.ok) {
    return Response.json(
      { ok: false, error: "verification failed", reason: verdict.reason, replay: verdict },
      { status: 422 }
    );
  }

  // Score the verified run with the difficulty engine.
  const game = getGameByEnvId(env_id);
  const appid = game?.appid ?? run.appid ?? 0;
  const tasks = getTasksForApp(appid);
  const s = scoreRun(verdict.replayUnlocked, tasks);

  const row: RunRow = {
    env_id,
    appid,
    game: game?.name ?? env_id,
    agent_id,
    agent_kind,
    seed,
    score: verdict.replayScore,
    steps: typeof run.num_steps === "number" ? run.num_steps : actions.length,
    unlocked: verdict.replayUnlocked,
    earned_points: s.earned_points,
    earned_bits: Math.round(s.earned_bits * 100) / 100,
    mastery: Math.round(s.mastery * 1e4) / 1e4,
    verified: true,
    created_at: Date.now(),
  };
  await addRun(row);

  return Response.json({
    ok: true,
    run: row,
    verify: verdict,
    authenticated: Boolean(agent),
  });
}
