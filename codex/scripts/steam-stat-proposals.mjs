import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();

function boolArg(name, fallback = false) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function configFromArgs() {
  const appid = Number(args.get("appid"));
  if (!Number.isFinite(appid)) throw new Error("Provide --appid=<steam_appid>.");
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    appid,
    useFixture: boolArg("fixture", boolArg("use-fixture", false)),
    refresh: boolArg("refresh", false),
    importRecommended: boolArg("import", false),
    publish: boolArg("publish", false),
    reviewApproved: boolArg("review-approved", false),
    forceReviewOverride: boolArg("force-review-override", false),
    limit: intArg("limit", 12, { min: 1, max: 50 }),
    publishLimit: intArg("publish-limit", intArg("limit", 25, { min: 1, max: 100 }), { min: 1, max: 100 }),
    reviewNotes: args.get("review-notes"),
    gameName: args.get("game-name")
  };
}

async function readJson(baseUrl, path, options) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`${path} failed with ${response.status}: ${text}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function statProposalQuery(config) {
  const query = new URLSearchParams();
  if (config.useFixture) query.set("useFixture", "true");
  if (config.refresh) query.set("refresh", "true");
  query.set("limit", String(config.limit));
  if (config.gameName) query.set("gameName", config.gameName);
  return query.toString();
}

async function runSteamStatProposals(config = configFromArgs()) {
  const appPath = `/api/steam/apps/${encodeURIComponent(config.appid)}`;
  const proposalRun = config.importRecommended
    ? await readJson(config.baseUrl, `${appPath}/stat-proposals/import-recommended`, {
        method: "POST",
        body: JSON.stringify({
          useFixture: config.useFixture,
          refresh: config.refresh,
          limit: config.limit,
          gameName: config.gameName,
          reviewNotes: config.reviewNotes
        })
      })
    : await readJson(config.baseUrl, `${appPath}/stat-proposals?${statProposalQuery(config)}`);
  const publication = config.publish
    ? await readJson(config.baseUrl, `${appPath}/publish-candidates`, {
        method: "POST",
        body: JSON.stringify({
          limit: config.publishLimit,
          reviewApproved: config.reviewApproved,
          forceReviewOverride: config.forceReviewOverride,
          reviewNotes: config.reviewNotes ?? "Published from Steam stat schema proposals."
        })
      })
    : undefined;

  return {
    schemaVersion: "steambench.steam-stat-proposals-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    appid: config.appid,
    source: proposalRun.source ?? proposalRun.importRun?.source,
    useFixture: config.useFixture,
    imported: config.importRecommended,
    publish: config.publish,
    proposalRun: proposalRun.proposalRun ?? proposalRun.importRun,
    stats: proposalRun.stats,
    proposals: proposalRun.proposals,
    tasks: proposalRun.tasks,
    candidates: proposalRun.imported,
    reviews: proposalRun.reviews,
    publication: publication?.publication,
    warning: proposalRun.warning,
    summary: {
      stats: proposalRun.proposalRun?.stats,
      proposed: proposalRun.proposalRun?.proposed ?? proposalRun.importRun?.proposed,
      imported: proposalRun.importRun?.imported,
      reviewRequired: proposalRun.proposalRun?.reviewRequired ?? proposalRun.importRun?.reviewRequired,
      published: publication?.publication?.published?.length,
      blocked: publication?.publication?.blocked?.length
    }
  };
}

export { runSteamStatProposals };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSteamStatProposals()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
