import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function configFromArgs() {
  const taskId = args.get("task-id") ?? args.get("taskId") ?? args.get("task");
  if (!taskId) throw new Error("Provide --task-id=<task_id>.");
  const provider = args.get("provider") ?? "external";
  if (provider !== "local" && provider !== "modal" && provider !== "external") {
    throw new Error("Provide --provider=local|modal|external.");
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    taskId,
    humanUserId: args.get("human-user-id") ?? args.get("humanUserId") ?? args.get("human"),
    agentId: args.get("agent-id") ?? args.get("agentId") ?? args.get("agent"),
    provider,
    limit: intArg("limit", 6, { min: 1, max: 20 })
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

function raceEntryPath(config) {
  const query = new URLSearchParams();
  if (config.humanUserId) query.set("humanUserId", config.humanUserId);
  if (config.agentId) query.set("agentId", config.agentId);
  if (config.provider) query.set("provider", config.provider);
  query.set("limit", String(config.limit));
  return `/api/public/tasks/${encodeURIComponent(config.taskId)}/race-entry?${query}`;
}

function validateRaceEntry(packet, config) {
  const errors = [];
  if (packet?.schemaVersion !== "steambench.public-task-race-entry.v1") errors.push("invalid_race_entry_schema");
  if (packet?.task?.id !== config.taskId) errors.push("task_id_mismatch");
  if (packet?.canonicalArtifactName !== "output.mp4") errors.push("canonical_artifact_name_mismatch");
  if (packet?.human?.entryPacket && packet.human.entryPacket.evidence?.canonicalArtifact !== "output/output.mp4") errors.push("human_canonical_artifact_mismatch");
  if (packet?.actionSpace?.schemaVersion !== "steambench.public-task-action-space.v1") errors.push("action_space_missing");
  if (packet?.actionSpace?.permissions?.privilegedSystemInput !== false) errors.push("privileged_system_input_enabled");
  if (packet?.agent?.onboarding?.schemaVersion !== "steambench.public-agent-onboarding.v1") errors.push("agent_onboarding_missing");
  if (!String(packet?.runnerContract?.endpoint ?? "").includes("/api/public/tasks/")) errors.push("runner_contract_link_missing");
  if (packet?.match?.preflight?.method !== "POST") errors.push("preflight_method_mismatch");
  if (packet?.match?.preflight?.bodyTemplate?.taskId !== config.taskId) errors.push("preflight_task_mismatch");
  if (packet?.scoreboard?.season !== "all") errors.push("scoreboard_scope_mismatch");
  return errors;
}

async function runPublicRaceEntry(config = configFromArgs()) {
  const payload = await readJson(config.baseUrl, raceEntryPath(config));
  const raceEntry = payload.raceEntry;
  const errors = validateRaceEntry(raceEntry, config);
  return {
    schemaVersion: "steambench.public-race-entry-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    request: {
      taskId: config.taskId,
      humanUserId: config.humanUserId,
      agentId: config.agentId,
      provider: config.provider,
      limit: config.limit
    },
    raceEntry,
    validation: {
      valid: errors.length === 0,
      errors
    },
    summary: {
      valid: errors.length === 0,
      taskId: raceEntry?.task?.id,
      appid: raceEntry?.task?.appid,
      runnable: raceEntry?.runnable,
      readyForMatch: raceEntry?.readyForMatch,
      humanStatus: raceEntry?.human?.status,
      humanReady: raceEntry?.human?.ready,
      agentStatus: raceEntry?.agent?.status,
      agentReady: raceEntry?.agent?.ready,
      actionSpaceTransport: raceEntry?.actionSpace?.permissions?.transport,
      bridgeable: raceEntry?.actionSpace?.bridge?.bridgeable,
      matchEligible: raceEntry?.match?.preflight?.eligibility?.eligible,
      canonicalArtifact: raceEntry?.human?.entryPacket?.evidence?.canonicalArtifact ?? raceEntry?.actionSpace?.evidence?.canonicalArtifact
    }
  };
}

export { runPublicRaceEntry };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicRaceEntry()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.validation.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
