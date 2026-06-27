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
  if (!Number.isFinite(appid) || appid <= 0) {
    throw new Error("Provide --appid=<steam_appid>.");
  }
  const execute = args.get("execute") ?? "inspect";
  if (execute !== "inspect" && execute !== "advance" && execute !== "run-local") {
    throw new Error("Provide --execute=inspect|advance|run-local.");
  }
  const side = args.get("side") ?? "both";
  if (side !== "human" && side !== "agent" && side !== "both") {
    throw new Error("Provide --side=human|agent|both.");
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    appid,
    execute,
    useFixture: boolArg("fixture", false),
    refresh: boolArg("refresh", false),
    reviewApproved: boolArg("review-approved", true),
    forceReviewOverride: boolArg("force-review-override", false),
    reviewNotes: args.get("review-notes"),
    humanUserId: args.get("human-user-id"),
    agentId: args.get("agent-id"),
    side,
    limit: intArg("limit", 4, { min: 1, max: 50 })
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

function onboardingQuery(config) {
  const query = new URLSearchParams();
  query.set("useFixture", String(config.useFixture));
  query.set("refresh", String(config.refresh));
  query.set("limit", String(config.limit));
  if (config.humanUserId) query.set("humanUserId", config.humanUserId);
  if (config.agentId) query.set("agentId", config.agentId);
  return query.toString();
}

function requestBody(config) {
  return JSON.stringify({
    useFixture: config.useFixture,
    refresh: config.refresh,
    reviewApproved: config.reviewApproved,
    forceReviewOverride: config.forceReviewOverride,
    reviewNotes: config.reviewNotes ?? `Steam app onboarding CLI ${config.execute}.`,
    humanUserId: config.humanUserId,
    agentId: config.agentId,
    side: config.side,
    limit: config.limit
  });
}

function summarizeOnboarding(onboarding) {
  return {
    status: onboarding?.status,
    readinessScore: onboarding?.readinessScore,
    readyStages: onboarding?.stages?.filter((stage) => stage.status === "ready").map((stage) => stage.id) ?? [],
    completeStages: onboarding?.stages?.filter((stage) => stage.status === "complete").map((stage) => stage.id) ?? [],
    blockedStages: onboarding?.stages?.filter((stage) => stage.status === "blocked").map((stage) => stage.id) ?? [],
    nextActions: onboarding?.nextActions ?? []
  };
}

async function runSteamOnboard(config = configFromArgs()) {
  const appPath = `/api/steam/apps/${encodeURIComponent(config.appid)}`;
  const before = await readJson(config.baseUrl, `${appPath}/onboarding?${onboardingQuery(config)}`);
  let executedAction;
  if (config.execute === "advance") {
    executedAction = {
      id: "advance",
      result: await readJson(config.baseUrl, `${appPath}/onboarding/advance`, {
        method: "POST",
        body: requestBody(config)
      })
    };
  }
  if (config.execute === "run-local") {
    executedAction = {
      id: "run-local",
      result: await readJson(config.baseUrl, `${appPath}/onboarding/run-local`, {
        method: "POST",
        body: requestBody(config)
      })
    };
  }
  const after = config.execute === "inspect"
    ? before
    : await readJson(config.baseUrl, `${appPath}/onboarding?${onboardingQuery({ ...config, refresh: false })}`);
  return {
    schemaVersion: "steambench.steam-onboard-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    appid: config.appid,
    execute: config.execute,
    before: summarizeOnboarding(before.onboarding),
    after: summarizeOnboarding(after.onboarding),
    executedAction: executedAction
      ? {
          id: executedAction.id,
          advance: executedAction.result.advance
            ? {
                schemaVersion: executedAction.result.advance.schemaVersion,
                steps: executedAction.result.advance.steps,
                links: executedAction.result.advance.links
              }
            : undefined,
          run: executedAction.result.run
            ? {
                schemaVersion: executedAction.result.run.schemaVersion,
                steps: executedAction.result.run.steps,
                links: executedAction.result.run.links
              }
            : undefined,
          coverage: executedAction.result.coverage
            ? {
                schemaVersion: executedAction.result.coverage.schemaVersion,
                completedRuns: executedAction.result.coverage.totals?.completedRuns,
                scoreboardReady: executedAction.result.coverage.totals?.scoreboardReady,
                humanRuns: executedAction.result.coverage.totals?.humanRuns,
                agentRuns: executedAction.result.coverage.totals?.agentRuns
              }
            : undefined
        }
      : undefined,
    summary: {
      status: after.onboarding?.status,
      readinessScore: after.onboarding?.readinessScore,
      readyStages: after.onboarding?.stages?.filter((stage) => stage.status === "ready").map((stage) => stage.id) ?? [],
      completeStages: after.onboarding?.stages?.filter((stage) => stage.status === "complete").map((stage) => stage.id) ?? [],
      blockedStages: after.onboarding?.stages?.filter((stage) => stage.status === "blocked").map((stage) => stage.id) ?? [],
      nextActions: after.onboarding?.nextActions ?? [],
      executedActionId: executedAction?.id,
      completedRuns: executedAction?.result.coverage?.totals?.completedRuns,
      scoreboardReady: executedAction?.result.coverage?.totals?.scoreboardReady
    }
  };
}

export { runSteamOnboard };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSteamOnboard()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
