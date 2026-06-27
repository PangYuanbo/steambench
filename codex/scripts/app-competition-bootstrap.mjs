import { pathToFileURL } from "node:url";
import { parseCliArgs, runSteamIngest } from "./steam-ingest.mjs";

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

function configFromArgs() {
  const baseUrl = args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787";
  const stamp = Date.now().toString(36);
  return {
    baseUrl,
    query: args.get("query") ?? args.get("q") ?? "",
    appids: splitAppIds(args.get("appid") ?? args.get("appids")),
    useFixture: boolArg("fixture", false),
    refresh: boolArg("refresh", false),
    dryRun: boolArg("dry-run", false),
    publish: boolArg("publish", true),
    reviewApproved: boolArg("review-approved", true),
    forceReviewOverride: boolArg("force-review-override", false),
    humanUserId: args.get("human-user-id"),
    agentId: args.get("agent-id"),
    humanHandle: args.get("human-handle") ?? `bootstrap-human-${stamp}`,
    agentHandle: args.get("agent-handle") ?? `bootstrap-agent-${stamp}`,
    steamid: args.get("steamid") ?? "76561198000000000",
    top: intArg("top", 1, { min: 1, max: 10 }),
    importLimit: intArg("import-limit", intArg("limit", 4, { min: 1, max: 25 }), { min: 1, max: 25 }),
    publishLimit: intArg("publish-limit", intArg("limit", 4, { min: 1, max: 25 }), { min: 1, max: 25 }),
    coverageLimit: intArg("coverage-limit", intArg("limit", 2, { min: 1, max: 12 }), { min: 1, max: 12 }),
    suiteTier: args.get("suite-tier") ?? "ranked",
    runCoverage: boolArg("coverage", true),
    runCompetition: boolArg("competition", true)
  };
}

async function ensureHuman(config) {
  if (config.humanUserId) return { user: { id: config.humanUserId }, created: false, linked: false };
  const created = await readJson(config.baseUrl, "/api/users", {
    method: "POST",
    body: JSON.stringify({
      handle: config.humanHandle,
      displayName: config.humanHandle,
      type: "human"
    })
  });
  const linked = await readJson(config.baseUrl, `/api/users/${encodeURIComponent(created.user.id)}/steam`, {
    method: "POST",
    body: JSON.stringify({
      steamid: config.steamid,
      proofConsent: true
    })
  });
  return {
    user: linked.user,
    created: true,
    linked: true
  };
}

async function ensureAgent(config) {
  if (config.agentId) return { agent: { id: config.agentId }, created: false };
  const created = await readJson(config.baseUrl, "/api/agents", {
    method: "POST",
    body: JSON.stringify({
      handle: config.agentHandle,
      displayName: config.agentHandle,
      provider: "local",
      runtimeProvider: "local-sim",
      command: `node scripts/runtime-worker.mjs --agent=${config.agentHandle}`,
      capabilities: [
        "controller",
        "keyboard-mouse",
        "turn-based-actions",
        "seeded-save",
        "manual-review",
        "screen-capture",
        "action-log",
        "output.mp4"
      ]
    })
  });
  return {
    agent: created.agent,
    created: true
  };
}

async function bootstrapAppCompetition(config = configFromArgs()) {
  if (!config.query.trim() && config.appids.length === 0) {
    throw new Error("Provide --query=<steam search> or --appid=<appid[,appid]>.");
  }
  const ingest = await runSteamIngest({
    baseUrl: config.baseUrl,
    query: config.query,
    appids: config.appids,
    useFixture: config.useFixture,
    refresh: config.refresh,
    publish: config.publish,
    reviewApproved: config.reviewApproved,
    forceReviewOverride: config.forceReviewOverride,
    dryRun: config.dryRun,
    discoveryLimit: config.top,
    importLimit: config.importLimit,
    publishLimit: config.publishLimit,
    top: config.top
  });
  const target = ingest.results[0];
  if (!target) throw new Error("Steam ingest did not return an app target.");
  if (config.dryRun) {
    return {
      schemaVersion: "steambench.app-competition-bootstrap.v1",
      generatedAt: new Date().toISOString(),
      api: config.baseUrl,
      dryRun: true,
      target,
      ingest
    };
  }

  const human = await ensureHuman(config);
  const agent = await ensureAgent(config);
  const onboardingRun = config.runCoverage
    ? await readJson(config.baseUrl, `/api/steam/apps/${encodeURIComponent(target.appid)}/onboarding/run-local`, {
        method: "POST",
        body: JSON.stringify({
          useFixture: config.useFixture,
          refresh: config.refresh,
          reviewApproved: config.reviewApproved,
          forceReviewOverride: config.forceReviewOverride,
          reviewNotes: `App competition bootstrap for ${target.name}.`,
          humanUserId: human.user.id,
          agentId: agent.agent.id,
          limit: config.coverageLimit
        })
      })
    : null;
  const competitionRun = config.runCompetition
    ? await readJson(config.baseUrl, `/api/games/${encodeURIComponent(target.appid)}/competition/run-local`, {
        method: "POST",
        body: JSON.stringify({
          humanUserId: human.user.id,
          agentId: agent.agent.id,
          suiteTier: config.suiteTier,
          reviewApproved: config.reviewApproved
        })
      })
    : null;

  return {
    schemaVersion: "steambench.app-competition-bootstrap.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    dryRun: false,
    target: {
      appid: target.appid,
      name: target.name,
      source: target.source,
      ladderAfter: target.ladderAfter,
      onboarding: target.onboarding
    },
    human,
    agent,
    ingest,
    onboardingRun: onboardingRun
      ? {
          schemaVersion: onboardingRun.run?.schemaVersion,
          completedRuns: onboardingRun.coverage?.totals?.completedRuns,
          scoreboardReady: onboardingRun.coverage?.totals?.scoreboardReady,
          links: onboardingRun.run?.links
        }
      : undefined,
    competitionRun: competitionRun
      ? {
          schemaVersion: competitionRun.competitionRun?.schemaVersion,
          suiteId: competitionRun.competitionRun?.suiteId,
          suiteTier: competitionRun.competitionRun?.suiteTier,
          raceId: competitionRun.competitionRun?.raceId,
          status: competitionRun.competitionRun?.status,
          complete: competitionRun.competitionRun?.complete,
          winner: competitionRun.race?.winner,
          readyForPublicShare: competitionRun.certificate?.integrity?.readyForPublicShare,
          links: competitionRun.competitionRun?.links
        }
      : undefined
  };
}

export { bootstrapAppCompetition };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  bootstrapAppCompetition()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
