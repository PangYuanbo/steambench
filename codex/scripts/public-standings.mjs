import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();
const seasonScopes = new Set(["all", "daily", "weekly"]);
const tracks = new Set(["achievement", "leaderboard", "stat", "capture"]);

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
  const appid = args.get("appid") === undefined ? undefined : Number(args.get("appid"));
  if (args.get("appid") !== undefined && (!Number.isInteger(appid) || appid <= 0)) {
    throw new Error("Provide --appid=<positive integer>.");
  }
  const track = args.get("track");
  if (track !== undefined && !tracks.has(track)) throw new Error("Provide --track=achievement|leaderboard|stat|capture.");
  const competitor = args.get("competitor");
  if (competitor !== undefined && competitor !== "human" && competitor !== "agent") {
    throw new Error("Provide --competitor=human|agent.");
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    season,
    appid,
    track,
    competitor,
    limit: intArg("limit", 25, { min: 1, max: 100 })
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

function standingsPath(config) {
  const query = new URLSearchParams();
  query.set("season", config.season);
  if (config.appid) query.set("appid", String(config.appid));
  if (config.track) query.set("track", config.track);
  if (config.competitor) query.set("competitor", config.competitor);
  query.set("limit", String(config.limit));
  return `/api/public/standings?${query}`;
}

function validateStandings(standings, config) {
  const errors = [];
  if (standings?.schemaVersion !== "steambench.public-standings.v1") errors.push("invalid_standings_schema");
  if (standings?.scope !== config.season) errors.push("season_scope_mismatch");
  if (standings?.canonicalArtifactName !== "output.mp4") errors.push("canonical_artifact_name_mismatch");
  if (standings?.filters?.season !== config.season) errors.push("season_filter_mismatch");
  if (config.appid && standings?.filters?.appid !== config.appid) errors.push("appid_filter_mismatch");
  if (config.track && standings?.filters?.track !== config.track) errors.push("track_filter_mismatch");
  if (config.competitor && standings?.filters?.competitor !== config.competitor) errors.push("competitor_filter_mismatch");
  if (!standings?.window || standings.window.scope !== config.season) errors.push("window_missing");
  if (!standings?.totals || typeof standings.totals.rows !== "number") errors.push("totals_missing");
  if (!Array.isArray(standings?.leaders?.competitors)) errors.push("competitor_leaders_missing");
  if (!Array.isArray(standings?.games)) errors.push("games_missing");
  if (!Array.isArray(standings?.taskLeaderboards)) errors.push("task_leaderboards_missing");
  if (!String(standings?.entrypoints?.taskScoreboardTemplate ?? "").includes("/api/public/tasks/{taskId}/scoreboard")) errors.push("task_scoreboard_template_missing");
  if (!String(standings?.entrypoints?.quickstartTemplate ?? "").includes("/api/public/quickstart")) errors.push("quickstart_template_missing");
  if (!String(standings?.links?.catalog ?? "").includes("/api/public/catalog")) errors.push("catalog_link_missing");
  if (config.competitor && standings?.leaders?.competitors?.some((entry) => entry.type !== config.competitor)) errors.push("wrong_competitor_returned");
  return errors;
}

async function runPublicStandings(config = configFromArgs()) {
  const payload = await readJson(config.baseUrl, standingsPath(config));
  const standings = payload.standings;
  const errors = validateStandings(standings, config);
  return {
    schemaVersion: "steambench.public-standings-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    request: {
      season: config.season,
      appid: config.appid,
      track: config.track,
      competitor: config.competitor,
      limit: config.limit
    },
    standings,
    validation: {
      valid: errors.length === 0,
      errors
    },
    summary: {
      valid: errors.length === 0,
      scope: standings?.scope,
      rows: standings?.totals?.rows,
      humanRows: standings?.totals?.humanRows,
      agentRows: standings?.totals?.agentRows,
      competitors: standings?.leaders?.competitors?.length ?? 0,
      games: standings?.games?.length ?? 0,
      taskLeaderboards: standings?.taskLeaderboards?.length ?? 0,
      topCompetitor: standings?.leaders?.competitors?.[0]?.competitor,
      topCompetitorType: standings?.leaders?.competitors?.[0]?.type,
      topTaskId: standings?.taskLeaderboards?.[0]?.taskId
    }
  };
}

export { runPublicStandings };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicStandings()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.validation.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
