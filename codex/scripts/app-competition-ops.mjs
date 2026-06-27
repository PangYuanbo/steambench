import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();
const validActions = new Set([
  "publish-candidates",
  "schedule-coverage",
  "run-local-coverage",
  "run-suite-race",
  "inspect-certificate",
  "advance-competition-actions"
]);

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function configFromArgs() {
  const appid = Number(args.get("appid"));
  if (!Number.isFinite(appid)) {
    throw new Error("Provide --appid=<steam_appid>.");
  }
  const execute = args.get("execute") ?? "";
  if (execute && !validActions.has(execute)) {
    throw new Error(`Provide --execute as one of: ${[...validActions].join(", ")}.`);
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    appid,
    humanUserId: args.get("human-user-id"),
    agentId: args.get("agent-id"),
    suiteTier: args.get("suite-tier") ?? "ranked",
    season: args.get("season") ?? "all",
    limit: intArg("limit", 12, { min: 1, max: 50 }),
    execute,
    maxSteps: intArg("max-steps", 3, { min: 1, max: 10 }),
    compact: args.get("compact") === "true"
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

function queryString(config) {
  const params = new URLSearchParams({
    season: config.season,
    suiteTier: config.suiteTier,
    limit: String(config.limit)
  });
  if (config.humanUserId) params.set("humanUserId", config.humanUserId);
  if (config.agentId) params.set("agentId", config.agentId);
  return params.toString();
}

function actionRequest(action) {
  if (!action) throw new Error("Missing action to execute.");
  return {
    method: action.method,
    body: action.method === "POST" ? JSON.stringify(action.body ?? {}) : undefined
  };
}

function reportPath(config) {
  return `/api/games/${encodeURIComponent(config.appid)}/competition/ops-report?${queryString(config)}`;
}

function actionSignature(action) {
  return `${action.id}:${action.method}:${action.endpoint}`;
}

function nextAutomationAction(report) {
  const actions = report.recommendedActions ?? [];
  return actions.find((entry) => entry.id === "publish-candidates")
    ?? (report.totals?.publicShareReady ? actions.find((entry) => entry.id === "run-suite-race") : undefined)
    ?? actions.find((entry) => entry.id === "schedule-coverage")
    ?? actions.find((entry) => entry.id === "run-local-coverage")
    ?? actions.find((entry) => entry.id === "run-suite-race");
}

async function executeCompetitionAction(config, action) {
  return {
    action,
    result: await readJson(config.baseUrl, action?.endpoint, actionRequest(action))
  };
}

async function advanceCompetitionActions(config) {
  const executedActions = [];
  const seen = new Set();
  let refreshed = null;

  for (let step = 0; step < config.maxSteps; step += 1) {
    const payload = await readJson(config.baseUrl, reportPath(config));
    const action = nextAutomationAction(payload.report);
    if (!action) {
      refreshed = payload.report;
      break;
    }
    const signature = actionSignature(action);
    if (seen.has(signature)) {
      refreshed = payload.report;
      break;
    }
    seen.add(signature);
    executedActions.push(await executeCompetitionAction(config, action));
  }

  if (!refreshed) {
    refreshed = (await readJson(config.baseUrl, reportPath(config))).report;
  }

  return { executedActions, refreshed };
}

function compactResult(result) {
  if (!result) return undefined;
  return {
    schemaVersion: result.schemaVersion ?? result.schedule?.schemaVersion ?? result.coverageRun?.schemaVersion ?? result.competitionRun?.schemaVersion,
    schedule: result.schedule
      ? {
          schemaVersion: result.schedule.schemaVersion,
          totals: result.schedule.totals
        }
      : undefined,
    coverageRun: result.coverageRun
      ? {
          id: result.coverageRun.id,
          status: result.coverageRun.status,
          completedRuns: result.coverageRun.completedRuns
        }
      : undefined,
    competitionRun: result.competitionRun
      ? {
          raceId: result.competitionRun.raceId,
          status: result.competitionRun.status,
          complete: result.competitionRun.complete,
          matchCount: result.competitionRun.matchCount
        }
      : undefined,
    certificate: result.certificate
      ? {
          kind: result.certificate.kind,
          verdict: result.certificate.verdict,
          readyForPublicShare: result.certificate.integrity?.readyForPublicShare
        }
      : undefined
  };
}

async function runCompetitionOps(config = configFromArgs()) {
  let executedActions = [];
  let refreshed;
  if (config.execute === "advance-competition-actions") {
    ({ executedActions, refreshed } = await advanceCompetitionActions(config));
  } else {
    const payload = await readJson(config.baseUrl, reportPath(config));
    const action = config.execute
      ? payload.report?.recommendedActions?.find((entry) => entry.id === config.execute)
      : undefined;
    executedActions = config.execute ? [await executeCompetitionAction(config, action)] : [];
    refreshed = executedActions.length > 0
      ? (await readJson(config.baseUrl, reportPath(config))).report
      : payload.report;
  }
  const executedAction = executedActions[0];
  const scheduleAction = executedActions.find((entry) => entry.action?.id === "schedule-coverage");
  const localCoverageAction = executedActions.find((entry) => entry.action?.id === "run-local-coverage");
  const suiteRaceAction = executedActions.find((entry) => entry.action?.id === "run-suite-race");
  const certificateAction = executedActions.find((entry) => entry.result?.certificate);
  return {
    schemaVersion: "steambench.app-competition-ops-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    appid: config.appid,
    report: config.compact ? undefined : refreshed,
    executedAction: config.compact && executedAction
      ? {
          action: executedAction.action,
          result: compactResult(executedAction.result)
        }
      : executedAction,
    executedActions: config.compact
      ? executedActions.map((entry) => ({
          action: entry.action,
          result: compactResult(entry.result)
        }))
      : executedActions,
    summary: {
      status: refreshed?.status,
      activeTasks: refreshed?.totals?.activeTasks,
      humanGaps: refreshed?.totals?.humanGaps,
      agentGaps: refreshed?.totals?.agentGaps,
      selectedSuite: refreshed?.selectedSuite?.id,
      recommendedActionIds: refreshed?.recommendedActions?.map((entry) => entry.id) ?? [],
      executedActionId: executedAction?.action?.id,
      executedActionIds: executedActions.map((entry) => entry.action?.id),
      executedActionCount: executedActions.length,
      queuedRuns: scheduleAction?.result?.schedule?.totals?.queuedRuns,
      dispatches: scheduleAction?.result?.schedule?.totals?.dispatches,
      completedRuns: localCoverageAction?.result?.coverageRun?.completedRuns
        ?? suiteRaceAction?.result?.run?.completedRuns
        ?? suiteRaceAction?.result?.competitionRun?.completedRuns,
      certificateKind: certificateAction?.result?.certificate?.kind
    }
  };
}

export { runCompetitionOps };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCompetitionOps()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
