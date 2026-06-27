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
  const discoveryStatus = args.get("discovery-status") ?? "";
  if (discoveryStatus && !["discovered", "shortlisted", "rejected", "imported"].includes(discoveryStatus)) {
    throw new Error("Provide --discovery-status=discovered|shortlisted|rejected|imported.");
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    useFixture: boolArg("fixture", boolArg("use-fixture", false)),
    refresh: boolArg("refresh", false),
    limit: intArg("limit", 8, { min: 1, max: 20 }),
    proposalLimit: intArg("proposal-limit", 8, { min: 1, max: 50 }),
    maxSteps: intArg("max-steps", 3, { min: 1, max: 10 }),
    discoveryStatus,
    execute: args.get("execute") ?? "",
    reviewApproved: boolArg("review-approved", false),
    forceReviewOverride: boolArg("force-review-override", false),
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

function queueQuery(config) {
  const query = new URLSearchParams();
  if (config.useFixture) query.set("useFixture", "true");
  if (config.refresh) query.set("refresh", "true");
  query.set("limit", String(config.limit));
  query.set("proposalLimit", String(config.proposalLimit));
  if (config.discoveryStatus) query.set("discoveryStatus", config.discoveryStatus);
  return query.toString();
}

function actionRequest(action, config) {
  if (!action) throw new Error("Missing action to execute.");
  if (action.method === "GET") return { method: "GET" };
  const body = {
    ...(action.body ?? {}),
    useFixture: config.useFixture,
    refresh: config.refresh,
    limit: config.proposalLimit,
    reviewNotes: config.reviewNotes ?? `Steam source queue ${action.id}.`
  };
  if (action.id.endsWith(":publish-candidates")) {
    body.reviewApproved = Boolean(config.reviewApproved);
    body.forceReviewOverride = Boolean(config.forceReviewOverride);
  }
  return {
    method: action.method,
    body: JSON.stringify(body)
  };
}

function resolveAction(queue, execute) {
  if (!execute) return undefined;
  if (execute === "next") return queue.recommendedActions?.[0];
  if (execute === "advance-next") return queue.recommendedActions?.[0];
  return queue.recommendedActions?.find((entry) => entry.id === execute);
}

function buildExecutionReceipt({ before, after, executedAction }) {
  if (!executedAction) return undefined;
  return {
    schemaVersion: "steambench.steam-source-queue-execution.v1",
    actionId: executedAction.action?.id,
    appid: executedAction.action?.appid,
    gameName: executedAction.action?.gameName,
    before: {
      readyToPublish: before.totals.readyToPublish,
      readyToImport: before.totals.readyToImport,
      catalogReady: before.totals.catalogReady,
      newImportsAvailable: before.totals.newImportsAvailable,
      publishableCandidates: before.totals.publishableCandidates,
      topActionId: before.recommendedActions[0]?.id
    },
    after: {
      readyToPublish: after.totals.readyToPublish,
      readyToImport: after.totals.readyToImport,
      catalogReady: after.totals.catalogReady,
      newImportsAvailable: after.totals.newImportsAvailable,
      publishableCandidates: after.totals.publishableCandidates,
      topActionId: after.recommendedActions[0]?.id
    },
    delta: {
      newImportsAvailable: after.totals.newImportsAvailable - before.totals.newImportsAvailable,
      publishableCandidates: after.totals.publishableCandidates - before.totals.publishableCandidates
    },
    result: {
      imported: executedAction.result?.importRun?.imported ?? executedAction.result?.importRun?.totals?.imported,
      proposed: executedAction.result?.importRun?.proposed,
      published: executedAction.result?.publication?.published?.length,
      blocked: executedAction.result?.publication?.blocked?.length
    }
  };
}

function buildAdvanceReceipt({ before, after, executedActions }) {
  if (executedActions.length === 0) return undefined;
  return {
    schemaVersion: "steambench.steam-source-queue-advance.v1",
    requestedAction: "advance-next",
    appid: executedActions[0]?.action?.appid,
    gameName: executedActions[0]?.action?.gameName,
    steps: executedActions.map((entry, index) => ({
      index: index + 1,
      actionId: entry.action?.id,
      method: entry.action?.method,
      endpoint: entry.action?.endpoint,
      result: {
        imported: entry.result?.importRun?.imported ?? entry.result?.importRun?.totals?.imported,
        proposed: entry.result?.importRun?.proposed,
        published: entry.result?.publication?.published?.length,
        blocked: entry.result?.publication?.blocked?.length
      }
    })),
    before: {
      readyToPublish: before.totals.readyToPublish,
      readyToImport: before.totals.readyToImport,
      catalogReady: before.totals.catalogReady,
      newImportsAvailable: before.totals.newImportsAvailable,
      publishableCandidates: before.totals.publishableCandidates,
      topActionId: before.recommendedActions[0]?.id
    },
    after: {
      readyToPublish: after.totals.readyToPublish,
      readyToImport: after.totals.readyToImport,
      catalogReady: after.totals.catalogReady,
      newImportsAvailable: after.totals.newImportsAvailable,
      publishableCandidates: after.totals.publishableCandidates,
      topActionId: after.recommendedActions[0]?.id
    },
    delta: {
      newImportsAvailable: after.totals.newImportsAvailable - before.totals.newImportsAvailable,
      publishableCandidates: after.totals.publishableCandidates - before.totals.publishableCandidates
    }
  };
}

async function executeQueueAction(baseUrl, action, config) {
  return {
    action,
    result: await readJson(baseUrl, action?.endpoint, actionRequest(action, config))
  };
}

async function advanceNextSource(baseUrl, path, queue, config) {
  const executedActions = [];
  const firstAction = resolveAction(queue, "next");
  const appid = firstAction?.appid;
  let current = queue;
  for (let step = 0; step < config.maxSteps; step += 1) {
    const action = resolveAction(current, "next");
    if (!action || action.appid !== appid || action.method !== "POST") break;
    executedActions.push(await executeQueueAction(baseUrl, action, config));
    current = (await readJson(baseUrl, path)).queue;
  }
  return { executedActions, refreshedQueue: current };
}

async function runSteamSourceQueue(config = configFromArgs()) {
  const path = `/api/steam/source-queue?${queueQuery(config)}`;
  const payload = await readJson(config.baseUrl, path);
  const queue = payload.queue;
  const advance = config.execute === "advance-next"
    ? await advanceNextSource(config.baseUrl, path, queue, config)
    : undefined;
  const action = advance ? undefined : resolveAction(queue, config.execute);
  const executedAction = advance
    ? advance.executedActions.at(-1)
    : config.execute
      ? await executeQueueAction(config.baseUrl, action, config)
      : undefined;
  const refreshedPayload = advance
    ? undefined
    : executedAction
      ? await readJson(config.baseUrl, path)
      : payload;
  const refreshedQueue = advance?.refreshedQueue ?? refreshedPayload.queue;
  const executionReceipt = advance
    ? buildAdvanceReceipt({ before: queue, after: refreshedQueue, executedActions: advance.executedActions })
    : buildExecutionReceipt({ before: queue, after: refreshedQueue, executedAction });

  return {
    schemaVersion: "steambench.steam-source-queue-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    useFixture: config.useFixture,
    refresh: config.refresh,
    queue: refreshedQueue,
    executedAction,
    executedActions: advance?.executedActions,
    executionReceipt,
    summary: {
      apps: refreshedQueue.totals.apps,
      readyToPublish: refreshedQueue.totals.readyToPublish,
      readyToImport: refreshedQueue.totals.readyToImport,
      catalogReady: refreshedQueue.totals.catalogReady,
      sourceRecords: refreshedQueue.totals.sourceRecords,
      newImportsAvailable: refreshedQueue.totals.newImportsAvailable,
      publishableCandidates: refreshedQueue.totals.publishableCandidates,
      topApp: refreshedQueue.items[0]?.appid,
      topGame: refreshedQueue.items[0]?.gameName,
      topSourceBreakdown: refreshedQueue.items[0]?.sourceBreakdown,
      topMissingCandidateTracks: refreshedQueue.items[0]?.registryTracks?.missingCandidates,
      actions: refreshedQueue.recommendedActions.map((entry) => entry.id),
      achievementRecords: refreshedQueue.totals.achievementRecords,
      statRecords: refreshedQueue.totals.statRecords,
      leaderboardRecords: refreshedQueue.totals.leaderboardRecords,
      achievementImportsAvailable: refreshedQueue.totals.achievementImportsAvailable,
      statImportsAvailable: refreshedQueue.totals.statImportsAvailable,
      leaderboardImportsAvailable: refreshedQueue.totals.leaderboardImportsAvailable,
      executedActionId: executedAction?.action?.id,
      advancedSteps: advance?.executedActions.length,
      advancedActionIds: advance?.executedActions.map((entry) => entry.action?.id),
      nextActionId: refreshedQueue.recommendedActions[0]?.id,
      imported: executedAction?.result?.importRun?.imported ?? executedAction?.result?.importRun?.totals?.imported,
      proposed: executedAction?.result?.importRun?.proposed,
      published: executedAction?.result?.publication?.published?.length,
      blocked: executedAction?.result?.publication?.blocked?.length
    }
  };
}

export { runSteamSourceQueue };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSteamSourceQueue()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
