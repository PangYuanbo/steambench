import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();
const seasonScopes = new Set(["all", "daily", "weekly"]);
const tracks = new Set(["achievement", "leaderboard", "stat", "capture"]);
const transports = new Set(["local-desktop", "virtual-controller", "structured-turn-api"]);

function boolArg(name) {
  const value = args.get(name);
  if (value === undefined) return undefined;
  if (value === "1" || value === "true" || value === "yes") return true;
  if (value === "0" || value === "false" || value === "no") return false;
  throw new Error(`Provide --${name}=true|false.`);
}

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
  const track = args.get("track");
  if (track !== undefined && !tracks.has(track)) throw new Error("Provide --track=achievement|leaderboard|stat|capture.");
  const transport = args.get("transport");
  if (transport !== undefined && !transports.has(transport)) {
    throw new Error("Provide --transport=local-desktop|virtual-controller|structured-turn-api.");
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    season,
    appid,
    track,
    transport,
    bridgeable: boolArg("bridgeable"),
    provider,
    limit: intArg("limit", 24, { min: 1, max: 100 })
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

function catalogPath(config) {
  const query = new URLSearchParams();
  query.set("season", config.season);
  if (config.appid) query.set("appid", String(config.appid));
  if (config.track) query.set("track", config.track);
  if (config.transport) query.set("transport", config.transport);
  if (config.bridgeable !== undefined) query.set("bridgeable", String(config.bridgeable));
  query.set("provider", config.provider);
  query.set("limit", String(config.limit));
  return `/api/public/catalog?${query}`;
}

function validateCatalog(catalog, config) {
  const errors = [];
  if (catalog?.schemaVersion !== "steambench.public-catalog.v1") errors.push("invalid_catalog_schema");
  if (catalog?.scope !== config.season) errors.push("season_scope_mismatch");
  if (catalog?.canonicalArtifactName !== "output.mp4") errors.push("canonical_artifact_name_mismatch");
  if (catalog?.filters?.provider !== config.provider) errors.push("provider_filter_mismatch");
  if (config.appid && catalog?.filters?.appid !== config.appid) errors.push("appid_filter_mismatch");
  if (config.track && catalog?.filters?.track !== config.track) errors.push("track_filter_mismatch");
  if (config.transport && catalog?.filters?.transport !== config.transport) errors.push("transport_filter_mismatch");
  if (config.bridgeable !== undefined && catalog?.filters?.bridgeable !== config.bridgeable) errors.push("bridgeable_filter_mismatch");
  if (!Array.isArray(catalog?.games) || catalog.games.length === 0) errors.push("games_missing");
  if (!Array.isArray(catalog?.tasks) || catalog.tasks.length === 0) errors.push("tasks_missing");
  if (config.appid && !catalog?.games?.some((game) => game.appid === config.appid)) errors.push("selected_game_missing");
  if (config.appid && !catalog?.tasks?.some((task) => task.appid === config.appid)) errors.push("selected_game_tasks_missing");
  if (config.bridgeable === true && catalog?.tasks?.some((task) => task.actionSpace?.bridgeable !== true)) errors.push("non_bridgeable_task_returned");
  if (config.transport && catalog?.tasks?.some((task) => task.actionSpace?.transport !== config.transport)) errors.push("wrong_transport_task_returned");
  if (!String(catalog?.entrypoints?.quickstartTemplate ?? "").includes("/api/public/quickstart")) errors.push("quickstart_template_missing");
  if (!String(catalog?.entrypoints?.bridgeHandoffTemplate ?? "").includes("/api/public/tasks/{taskId}/bridge-handoff")) errors.push("bridge_handoff_template_missing");
  if (!catalog?.tasks?.every((task) => task.evidence?.canonicalArtifact === "output/output.mp4")) errors.push("canonical_artifact_path_mismatch");
  return errors;
}

async function runPublicCatalog(config = configFromArgs()) {
  const payload = await readJson(config.baseUrl, catalogPath(config));
  const catalog = payload.catalog;
  const errors = validateCatalog(catalog, config);
  return {
    schemaVersion: "steambench.public-catalog-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    request: {
      season: config.season,
      appid: config.appid,
      track: config.track,
      transport: config.transport,
      bridgeable: config.bridgeable,
      provider: config.provider,
      limit: config.limit
    },
    catalog,
    validation: {
      valid: errors.length === 0,
      errors
    },
    summary: {
      valid: errors.length === 0,
      scope: catalog?.scope,
      games: catalog?.games?.length ?? 0,
      tasks: catalog?.tasks?.length ?? 0,
      activeTasks: catalog?.totals?.activeTasks,
      candidateTasks: catalog?.totals?.candidateTasks,
      bridgeableTasks: catalog?.totals?.bridgeableTasks,
      firstGameAppid: catalog?.games?.[0]?.appid,
      firstTaskId: catalog?.tasks?.[0]?.id,
      firstTaskTransport: catalog?.tasks?.[0]?.actionSpace?.transport,
      firstTaskBridgeable: catalog?.tasks?.[0]?.actionSpace?.bridgeable,
      canonicalArtifact: catalog?.tasks?.[0]?.evidence?.canonicalArtifact
    }
  };
}

export { runPublicCatalog };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicCatalog()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.validation.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
