import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();
const seasonScopes = new Set(["all", "daily", "weekly"]);

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function configFromArgs() {
  const season = args.get("season") ?? "weekly";
  if (!seasonScopes.has(season)) throw new Error("Provide --season=all|daily|weekly.");
  const provider = args.get("provider") ?? "external";
  if (provider !== "local" && provider !== "modal" && provider !== "external") {
    throw new Error("Provide --provider=local|modal|external.");
  }
  const appid = args.get("appid") === undefined ? undefined : Number(args.get("appid"));
  if (args.get("appid") !== undefined && (!Number.isInteger(appid) || appid <= 0)) {
    throw new Error("Provide --appid=<positive integer>.");
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    season,
    appid,
    taskId: args.get("task-id") ?? args.get("taskId") ?? args.get("task"),
    provider,
    limit: intArg("limit", 12, { min: 1, max: 50 })
  };
}

function resolveUrl(baseUrl, pathOrUrl) {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${baseUrl.replace(/\/$/, "")}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

async function readJson(baseUrl, pathOrUrl) {
  const response = await fetch(resolveUrl(baseUrl, pathOrUrl), {
    headers: { "content-type": "application/json" }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`${pathOrUrl} failed with ${response.status}: ${text}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function hubPath(config) {
  const query = new URLSearchParams();
  query.set("season", config.season);
  if (config.appid) query.set("appid", String(config.appid));
  if (config.taskId) query.set("taskId", config.taskId);
  query.set("provider", config.provider);
  query.set("limit", String(config.limit));
  return `/api/public/competition-hub?${query}`;
}

function validateHub(hub, config) {
  const errors = [];
  if (hub?.schemaVersion !== "steambench.public-competition-hub.v1") errors.push("invalid_hub_schema");
  if (hub?.scope !== config.season) errors.push("season_scope_mismatch");
  if (hub?.canonicalArtifactName !== "output.mp4") errors.push("canonical_artifact_name_mismatch");
  if (config.appid && hub?.selected?.game?.appid !== config.appid) errors.push("selected_game_mismatch");
  if (config.taskId && hub?.selected?.task?.id !== config.taskId) errors.push("selected_task_mismatch");
  if (!hub?.platform?.totals) errors.push("platform_totals_missing");
  if (!Array.isArray(hub?.games) || hub.games.length === 0) errors.push("games_missing");
  if (!Array.isArray(hub?.featuredTasks) || hub.featuredTasks.length === 0) errors.push("featured_tasks_missing");
  if (hub?.selected?.gamePack?.schemaVersion !== "steambench.public-game-benchmark-pack.v1") errors.push("game_pack_missing");
  if (hub?.selected?.actionSpace?.schemaVersion !== "steambench.public-task-action-space.v1") errors.push("action_space_missing");
  if (hub?.selected?.raceEntry?.schemaVersion !== "steambench.public-task-race-entry.v1") errors.push("race_entry_missing");
  if (!String(hub?.entrypoints?.taskRaceEntryTemplate ?? "").includes("/api/public/tasks/{taskId}/race-entry")) errors.push("race_entry_template_missing");
  if (!String(hub?.entrypoints?.publicWatchTemplate ?? "").includes("/api/public/broadcasts/{streamId}/watch")) errors.push("public_watch_template_missing");
  return errors;
}

async function runPublicHub(config = configFromArgs()) {
  const payload = await readJson(config.baseUrl, hubPath(config));
  const hub = payload.hub;
  const errors = validateHub(hub, config);
  return {
    schemaVersion: "steambench.public-hub-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    request: {
      season: config.season,
      appid: config.appid,
      taskId: config.taskId,
      provider: config.provider,
      limit: config.limit
    },
    hub,
    validation: {
      valid: errors.length === 0,
      errors
    },
    summary: {
      valid: errors.length === 0,
      scope: hub?.scope,
      selectedAppid: hub?.selected?.game?.appid,
      selectedTaskId: hub?.selected?.task?.id,
      activeTasks: hub?.platform?.totals?.activeTasks,
      games: hub?.games?.length ?? 0,
      featuredTasks: hub?.featuredTasks?.length ?? 0,
      raceEntryStatus: hub?.selected?.raceEntry?.human?.status,
      actionSpaceTransport: hub?.selected?.actionSpace?.permissions?.transport,
      bridgeable: hub?.selected?.actionSpace?.bridge?.bridgeable,
      broadcasts: hub?.broadcasts?.totals?.broadcasts
    }
  };
}

export { runPublicHub };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicHub()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.validation.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
