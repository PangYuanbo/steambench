import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();
const validActions = new Set([
  "create-human",
  "link-steam",
  "grant-proof-consent",
  "register-event",
  "inspect-event-registrations",
  "inspect-human-proof-ops",
  "advance-onboarding-actions"
]);

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function boolArg(name, fallback = false) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function configFromArgs() {
  const execute = args.get("execute") ?? "";
  if (execute && !validActions.has(execute)) {
    throw new Error(`Provide --execute as one of: ${[...validActions].join(", ")}.`);
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    scope: args.get("scope") ?? "all",
    limit: intArg("limit", 50, { min: 1, max: 200 }),
    execute,
    maxSteps: intArg("max-steps", 4, { min: 1, max: 10 }),
    handle: args.get("handle"),
    displayName: args.get("display-name") ?? args.get("displayName"),
    steamid: args.get("steamid"),
    proofConsent: boolArg("proof-consent", true),
    notes: args.get("notes")
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

function opsQuery(config) {
  const query = new URLSearchParams();
  query.set("scope", config.scope);
  query.set("limit", String(config.limit));
  return query.toString();
}

function reportPath(config) {
  return `/api/human-onboarding/ops-report?${opsQuery(config)}`;
}

function actionRequest(action, config) {
  if (!action) throw new Error("Missing action to execute.");
  if (action.method === "GET") return { method: "GET" };
  const body = { ...(action.body ?? {}) };
  if (action.id === "create-human") {
    if (!config.handle) throw new Error("Provide --handle=<handle> when executing create-human.");
    body.handle = config.handle;
    body.displayName = config.displayName ?? config.handle;
    body.type = "human";
  }
  if (action.id === "link-steam") {
    if (!config.steamid) throw new Error("Provide --steamid=<17_digit_steamid> when executing link-steam.");
    body.steamid = config.steamid;
    body.proofConsent = config.proofConsent;
  }
  if (action.id === "grant-proof-consent") {
    body.consented = true;
  }
  if (action.id === "register-event" && config.notes) {
    body.notes = config.notes;
  }
  return {
    method: action.method,
    body: JSON.stringify(body)
  };
}

function actionSignature(action) {
  return `${action.id}:${action.method}:${action.endpoint}`;
}

function nextAutomationAction(report) {
  return report.recommendedActions?.find((entry) =>
    entry.id === "create-human" ||
    entry.id === "link-steam" ||
    entry.id === "grant-proof-consent" ||
    entry.id === "register-event"
  );
}

async function executeOnboardingAction(config, action) {
  return {
    action,
    result: await readJson(config.baseUrl, action?.endpoint, actionRequest(action, config))
  };
}

async function advanceOnboardingActions(config) {
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
    executedActions.push(await executeOnboardingAction(config, action));
  }

  if (!refreshed) {
    refreshed = (await readJson(config.baseUrl, reportPath(config))).report;
  }

  return { executedActions, refreshed };
}

async function runHumanOnboardingOps(config = configFromArgs()) {
  let executedActions = [];
  let refreshed;
  if (config.execute === "advance-onboarding-actions") {
    ({ executedActions, refreshed } = await advanceOnboardingActions(config));
  } else {
    const payload = await readJson(config.baseUrl, reportPath(config));
    const report = payload.report;
    const action = config.execute
      ? report.recommendedActions?.find((entry) => entry.id === config.execute)
      : undefined;
    executedActions = config.execute ? [await executeOnboardingAction(config, action)] : [];
    refreshed = executedActions.length > 0
      ? (await readJson(config.baseUrl, reportPath(config))).report
      : report;
  }
  const executedAction = executedActions[0];
  return {
    schemaVersion: "steambench.human-onboarding-ops-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    scope: config.scope,
    report: refreshed,
    executedAction,
    executedActions,
    summary: {
      status: refreshed.status,
      humans: refreshed.totals.humans,
      selectedHumans: refreshed.totals.selectedHumans,
      linked: refreshed.totals.linked,
      consented: refreshed.totals.consented,
      registeredHumans: refreshed.totals.registeredHumans,
      readyForRegistration: refreshed.totals.readyForRegistration,
      consentRequired: refreshed.totals.consentRequired,
      steamNotLinked: refreshed.totals.steamNotLinked,
      actions: refreshed.recommendedActions.map((entry) => entry.id),
      executedActionId: executedAction?.action?.id,
      executedActionIds: executedActions.map((entry) => entry.action?.id),
      executedActionCount: executedActions.length,
      createdUserId: executedAction?.result?.user?.id,
      linkedUserId: executedActions.find((entry) => entry.action?.id === "link-steam")?.result?.user?.id,
      consentedUserId: executedActions.find((entry) => entry.action?.id === "grant-proof-consent")?.result?.user?.id,
      registeredParticipantId: executedActions.find((entry) => entry.action?.id === "register-event")?.result?.registration?.participantId
    }
  };
}

export { runHumanOnboardingOps };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHumanOnboardingOps()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
