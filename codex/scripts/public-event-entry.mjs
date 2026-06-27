import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();
const seasonScopes = new Set(["all", "daily", "weekly"]);

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function configFromArgs() {
  const scope = args.get("scope") ?? args.get("season") ?? "weekly";
  if (!seasonScopes.has(scope)) throw new Error("Provide --scope=all|daily|weekly.");
  const provider = args.get("provider") ?? "external";
  if (provider !== "local" && provider !== "modal" && provider !== "external") {
    throw new Error("Provide --provider=local|modal|external.");
  }
  const appid = args.get("appid") === undefined ? undefined : Number(args.get("appid"));
  if (args.get("appid") !== undefined && (!Number.isInteger(appid) || appid <= 0)) {
    throw new Error("Provide --appid=<positive integer>.");
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    scope,
    appid,
    taskId: args.get("task-id") ?? args.get("taskId") ?? args.get("task"),
    humanUserId: args.get("human-user-id") ?? args.get("humanUserId") ?? args.get("human"),
    agentId: args.get("agent-id") ?? args.get("agentId") ?? args.get("agent"),
    provider,
    suiteId: args.get("suite-id") ?? args.get("suiteId"),
    limit: intArg("limit", 12, { min: 1, max: 50 })
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

function eventEntryPath(config) {
  const query = new URLSearchParams();
  if (config.appid) query.set("appid", String(config.appid));
  if (config.taskId) query.set("taskId", config.taskId);
  if (config.humanUserId) query.set("humanUserId", config.humanUserId);
  if (config.agentId) query.set("agentId", config.agentId);
  query.set("provider", config.provider);
  if (config.suiteId) query.set("suiteId", config.suiteId);
  query.set("limit", String(config.limit));
  return `/api/public/events/${encodeURIComponent(config.scope)}/entry?${query}`;
}

function validateEventEntry(entry, config) {
  const errors = [];
  if (entry?.schemaVersion !== "steambench.public-event-entry.v1") errors.push("invalid_event_entry_schema");
  if (entry?.scope !== config.scope) errors.push("scope_mismatch");
  if (entry?.canonicalArtifactName !== "output.mp4") errors.push("canonical_artifact_name_mismatch");
  if (entry?.event?.id !== `event:${config.scope}`) errors.push("event_id_mismatch");
  if (config.appid && entry?.selected?.task?.appid !== config.appid) errors.push("selected_appid_mismatch");
  if (config.taskId && entry?.selected?.task?.id !== config.taskId) errors.push("selected_task_mismatch");
  if (config.humanUserId && entry?.selected?.human?.id !== config.humanUserId) errors.push("selected_human_mismatch");
  if (config.agentId && entry?.selected?.agent?.id !== config.agentId) errors.push("selected_agent_mismatch");
  if (entry?.registration?.endpoint?.includes(`/api/competition-events/${config.scope}/register`) !== true) errors.push("registration_endpoint_missing");
  if (entry?.registration?.method !== "POST") errors.push("registration_method_mismatch");
  if (entry?.registration?.human?.bodyTemplate?.participantType !== "human") errors.push("human_registration_body_missing");
  if (entry?.registration?.agent?.bodyTemplate?.participantType !== "agent") errors.push("agent_registration_body_missing");
  if (entry?.packets?.quickstart?.schemaVersion !== "steambench.public-quickstart.v1") errors.push("quickstart_packet_missing");
  if (entry?.packets?.raceEntry?.schemaVersion !== "steambench.public-task-race-entry.v1") errors.push("race_entry_packet_missing");
  if (entry?.packets?.bridgeHandoff?.schemaVersion !== "steambench.public-bridge-handoff.v1") errors.push("bridge_handoff_packet_missing");
  if (entry?.packets?.opsReport?.schemaVersion !== "steambench.competition-event-ops-report.v1") errors.push("ops_report_packet_missing");
  if (!String(entry?.links?.evidenceBundle ?? "").includes(`/api/competition-events/${config.scope}/evidence-bundle`)) errors.push("evidence_bundle_link_missing");
  if (!String(entry?.links?.resultCertificate ?? "").includes(`/api/competition-events/${config.scope}/result-certificate`)) errors.push("result_certificate_link_missing");
  if (!Array.isArray(entry?.nextActions) || entry.nextActions.length === 0) errors.push("next_actions_missing");
  return errors;
}

async function runPublicEventEntry(config = configFromArgs()) {
  const payload = await readJson(config.baseUrl, eventEntryPath(config));
  const entry = payload.entry;
  const errors = validateEventEntry(entry, config);
  return {
    schemaVersion: "steambench.public-event-entry-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    request: {
      scope: config.scope,
      appid: config.appid,
      taskId: config.taskId,
      humanUserId: config.humanUserId,
      agentId: config.agentId,
      provider: config.provider,
      suiteId: config.suiteId,
      limit: config.limit
    },
    entry,
    validation: {
      valid: errors.length === 0,
      errors
    },
    summary: {
      valid: errors.length === 0,
      scope: entry?.scope,
      eventStatus: entry?.event?.status,
      selectedTaskId: entry?.selected?.task?.id,
      selectedAppid: entry?.selected?.task?.appid,
      selectedSuiteId: entry?.selected?.suite?.id,
      humanStatus: entry?.readiness?.human?.status,
      humanCanRegister: entry?.readiness?.human?.canRegister,
      agentStatus: entry?.readiness?.agent?.status,
      agentCanRegister: entry?.readiness?.agent?.canRegister,
      pairReady: entry?.readiness?.pair?.ready,
      pairRegistered: entry?.readiness?.pair?.registered,
      readyForRaceEntry: entry?.readiness?.pair?.readyForRaceEntry,
      eventOpsStatus: entry?.readiness?.eventOps?.status,
      registeredPairs: entry?.readiness?.eventOps?.registeredPairs,
      recommendedActionIds: entry?.readiness?.eventOps?.recommendedActionIds,
      raceEntryReadyForMatch: entry?.packets?.raceEntry?.readyForMatch,
      bridgeHandoffStatus: entry?.packets?.bridgeHandoff?.status,
      bridgeable: entry?.packets?.bridgeHandoff?.bridgeable
    }
  };
}

export { runPublicEventEntry };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicEventEntry()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.validation.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
