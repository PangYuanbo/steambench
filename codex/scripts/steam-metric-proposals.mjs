import { readFile } from "node:fs/promises";
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
  const file = args.get("file");
  if (!file) throw new Error("Provide --file=<metric_proposals.json>.");
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    appid,
    file,
    publish: boolArg("publish", false),
    reviewApproved: boolArg("review-approved", false),
    forceReviewOverride: boolArg("force-review-override", false),
    publishLimit: intArg("publish-limit", intArg("limit", 50, { min: 1, max: 100 }), { min: 1, max: 100 }),
    reviewNotes: args.get("review-notes")
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

async function readManifest(file) {
  const raw = JSON.parse(await readFile(file, "utf8"));
  const proposals = Array.isArray(raw) ? raw : raw.proposals;
  if (!Array.isArray(proposals) || proposals.length === 0) {
    throw new Error("Metric proposal manifest must be an array or an object with a non-empty proposals array.");
  }
  return Array.isArray(raw)
    ? { proposals }
    : {
        gameName: raw.gameName,
        benchmarkFit: raw.benchmarkFit,
        harnessRisk: raw.harnessRisk,
        reviewNotes: raw.reviewNotes,
        proposals
      };
}

async function runSteamMetricProposals(config = configFromArgs()) {
  const manifest = await readManifest(config.file);
  const proposalPayload = {
    ...manifest,
    reviewNotes: config.reviewNotes ?? manifest.reviewNotes
  };
  const proposalRun = await readJson(config.baseUrl, `/api/steam/apps/${encodeURIComponent(config.appid)}/metric-proposals`, {
    method: "POST",
    body: JSON.stringify(proposalPayload)
  });
  const publication = config.publish
    ? await readJson(config.baseUrl, `/api/steam/apps/${encodeURIComponent(config.appid)}/publish-candidates`, {
        method: "POST",
        body: JSON.stringify({
          limit: config.publishLimit,
          reviewApproved: config.reviewApproved,
          forceReviewOverride: config.forceReviewOverride,
          reviewNotes: config.reviewNotes ?? manifest.reviewNotes ?? "Published from Steam metric proposal manifest."
        })
      })
    : undefined;

  return {
    schemaVersion: "steambench.steam-metric-proposals-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    appid: config.appid,
    file: config.file,
    publish: config.publish,
    proposalRun: proposalRun.proposalRun,
    candidates: proposalRun.candidates,
    reviews: proposalRun.reviews,
    publication: publication?.publication,
    summary: {
      proposed: proposalRun.proposalRun?.proposed,
      candidates: proposalRun.proposalRun?.candidates,
      tracks: proposalRun.proposalRun?.tracks ?? [],
      reviewRequired: proposalRun.proposalRun?.reviewRequired,
      published: publication?.publication?.published?.length,
      blocked: publication?.publication?.blocked?.length
    }
  };
}

export { runSteamMetricProposals };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSteamMetricProposals()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
