import { pathToFileURL } from "node:url";

export function parseCliArgs(argv = process.argv.slice(2)) {
  return new Map(argv.map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=") || "1"];
  }));
}

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

function splitAppIds(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
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

function ingestConfig() {
  const baseUrl = args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787";
  const query = args.get("query") ?? args.get("q") ?? "";
  return {
    baseUrl,
    query,
    appids: splitAppIds(args.get("appid") ?? args.get("appids")),
    useFixture: boolArg("fixture", false),
    refresh: boolArg("refresh", false),
    publish: boolArg("publish", false),
    reviewApproved: boolArg("review-approved", false),
    forceReviewOverride: boolArg("force-review-override", false),
    dryRun: boolArg("dry-run", false),
    discoveryLimit: intArg("discovery-limit", intArg("limit", 10, { min: 1, max: 50 }), { min: 1, max: 50 }),
    importLimit: intArg("import-limit", intArg("limit", 12, { min: 1, max: 100 }), { min: 1, max: 100 }),
    publishLimit: intArg("publish-limit", intArg("limit", 12, { min: 1, max: 100 }), { min: 1, max: 100 }),
    top: intArg("top", 3, { min: 1, max: 20 })
  };
}

async function discoverCandidates(config) {
  if (!config.query.trim()) return [];
  const payload = await readJson(config.baseUrl, "/api/steam/apps/discover", {
    method: "POST",
    body: JSON.stringify({
      query: config.query,
      limit: config.discoveryLimit,
      useFixture: config.useFixture,
      refresh: config.refresh
    })
  });
  return (payload.discoveries ?? [])
    .filter((entry) => entry.status !== "rejected")
    .slice(0, config.top)
    .map((entry) => ({
      appid: entry.appid,
      name: entry.name,
      candidateId: entry.id,
      benchmarkFit: entry.benchmarkFit,
      harnessRisk: entry.harnessRisk,
      source: entry.source,
      discoveryStatus: entry.status
    }));
}

function directCandidates(config) {
  return config.appids.map((appid) => ({
    appid,
    name: `Steam App ${appid}`,
    candidateId: null,
    benchmarkFit: undefined,
    harnessRisk: undefined,
    source: config.useFixture ? "fixture" : "steam-live",
    discoveryStatus: "manual"
  }));
}

async function ingestCandidate(config, candidate) {
  const ladderBefore = await readJson(
    config.baseUrl,
    `/api/steam/apps/${encodeURIComponent(candidate.appid)}/achievement-ladder?useFixture=${config.useFixture ? "true" : "false"}&refresh=${config.refresh ? "true" : "false"}`
  );
  const result = {
    appid: candidate.appid,
    name: candidate.name,
    candidateId: candidate.candidateId,
    source: candidate.source,
    discoveryStatus: candidate.discoveryStatus,
    ladderBefore: {
      source: ladderBefore.source,
      warning: ladderBefore.warning,
      achievements: ladderBefore.ladder?.totals?.achievements ?? 0,
      recommendedImports: ladderBefore.ladder?.totals?.recommendedImports ?? 0,
      active: ladderBefore.ladder?.totals?.active ?? 0,
      candidates: ladderBefore.ladder?.totals?.candidates ?? 0
    }
  };

  if (!config.dryRun) {
    const importPath = candidate.candidateId
      ? `/api/steam/apps/discovery/${encodeURIComponent(candidate.candidateId)}/import-achievements`
      : `/api/steam/apps/${encodeURIComponent(candidate.appid)}/import-achievements`;
    const imported = await readJson(config.baseUrl, importPath, {
      method: "POST",
      body: JSON.stringify({
        limit: config.importLimit,
        useFixture: config.useFixture,
        refresh: config.refresh,
        gameName: candidate.name,
        benchmarkFit: candidate.benchmarkFit,
        harnessRisk: candidate.harnessRisk,
        reviewNotes: `Imported by steambench steam-ingest CLI for ${candidate.name}.`
      })
    });
    result.importRun = {
      source: imported.source,
      warning: imported.warning,
      imported: imported.imported?.length ?? 0,
      discoveryStatus: imported.discovery?.status
    };
  }

  const ladderAfter = await readJson(
    config.baseUrl,
    `/api/steam/apps/${encodeURIComponent(candidate.appid)}/achievement-ladder?useFixture=${config.useFixture ? "true" : "false"}`
  );
  result.ladderAfter = {
    source: ladderAfter.source,
    warning: ladderAfter.warning,
    achievements: ladderAfter.ladder?.totals?.achievements ?? 0,
    recommendedImports: ladderAfter.ladder?.totals?.recommendedImports ?? 0,
    active: ladderAfter.ladder?.totals?.active ?? 0,
    candidates: ladderAfter.ladder?.totals?.candidates ?? 0
  };

  if (config.publish && !config.dryRun) {
    const publication = await readJson(config.baseUrl, `/api/steam/apps/${encodeURIComponent(candidate.appid)}/publish-candidates`, {
      method: "POST",
      body: JSON.stringify({
        limit: config.publishLimit,
        gameName: candidate.name,
        benchmarkFit: candidate.benchmarkFit,
        harnessRisk: candidate.harnessRisk,
        reviewApproved: config.reviewApproved,
        forceReviewOverride: config.forceReviewOverride,
        reviewNotes: `Published by steambench steam-ingest CLI for ${candidate.name}.`
      })
    });
    result.publication = {
      status: publication.publication?.status,
      published: publication.publication?.published?.length ?? 0,
      blocked: publication.publication?.blocked?.length ?? 0
    };
  }

  const onboarding = await readJson(
    config.baseUrl,
    `/api/steam/apps/${encodeURIComponent(candidate.appid)}/onboarding?useFixture=${config.useFixture ? "true" : "false"}`
  );
  result.onboarding = {
    status: onboarding.onboarding?.status,
    readinessScore: onboarding.onboarding?.readinessScore,
    readyStages: onboarding.onboarding?.stages?.filter((stage) => stage.status === "ready").map((stage) => stage.id) ?? [],
    nextActions: onboarding.onboarding?.nextActions ?? []
  };
  return result;
}

export async function runSteamIngest(config = ingestConfig()) {
  if (!config.query.trim() && config.appids.length === 0) {
    throw new Error("Provide --query=<steam search> or --appid=<appid[,appid]>.");
  }
  const candidatesById = new Map();
  for (const candidate of [...directCandidates(config), ...(await discoverCandidates(config))]) {
    if (!candidatesById.has(candidate.appid)) candidatesById.set(candidate.appid, candidate);
  }
  const candidates = [...candidatesById.values()].slice(0, config.top);
  const results = [];
  for (const candidate of candidates) {
    results.push(await ingestCandidate(config, candidate));
  }
  return {
    schemaVersion: "steambench.steam-ingest-run.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    query: config.query || undefined,
    appids: candidates.map((candidate) => candidate.appid),
    useFixture: config.useFixture,
    refresh: config.refresh,
    dryRun: config.dryRun,
    publish: config.publish,
    results
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSteamIngest()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
