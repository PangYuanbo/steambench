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
  const season = args.get("season") ?? "weekly";
  if (!seasonScopes.has(season)) throw new Error("Provide --season=all|daily|weekly.");
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
    season,
    appid,
    taskId: args.get("task-id") ?? args.get("taskId") ?? args.get("task"),
    humanUserId: args.get("human-user-id") ?? args.get("humanUserId") ?? args.get("human"),
    agentId: args.get("agent-id") ?? args.get("agentId") ?? args.get("agent"),
    provider,
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

function quickstartPath(config) {
  const query = new URLSearchParams();
  query.set("season", config.season);
  if (config.appid) query.set("appid", String(config.appid));
  if (config.taskId) query.set("taskId", config.taskId);
  if (config.humanUserId) query.set("humanUserId", config.humanUserId);
  if (config.agentId) query.set("agentId", config.agentId);
  query.set("provider", config.provider);
  query.set("limit", String(config.limit));
  return `/api/public/quickstart?${query}`;
}

function validateQuickstart(quickstart, config) {
  const errors = [];
  const stepIds = new Set((quickstart?.steps ?? []).map((entry) => entry.id));
  const requiredStepIds = [
    "inspect-hub",
    "create-human",
    "link-steam",
    "inspect-agent-onboarding",
    "register-agent",
    "inspect-action-space",
    "inspect-race-entry",
    "match-preflight",
    "agent-run-session",
    "submit-action-batch",
    "submit-evidence",
    "watch-broadcast"
  ];
  if (quickstart?.schemaVersion !== "steambench.public-quickstart.v1") errors.push("invalid_quickstart_schema");
  if (quickstart?.scope !== config.season) errors.push("season_scope_mismatch");
  if (quickstart?.canonicalArtifactName !== "output.mp4") errors.push("canonical_artifact_name_mismatch");
  if (config.appid && quickstart?.selected?.game?.appid !== config.appid) errors.push("selected_game_mismatch");
  if (config.taskId && quickstart?.selected?.task?.id !== config.taskId) errors.push("selected_task_mismatch");
  if (config.humanUserId && quickstart?.selected?.human?.id !== config.humanUserId) errors.push("selected_human_mismatch");
  if (config.agentId && quickstart?.selected?.agent?.id !== config.agentId) errors.push("selected_agent_mismatch");
  if (!quickstart?.packets?.hub?.endpoint?.includes("/api/public/competition-hub")) errors.push("hub_packet_missing");
  if (!quickstart?.packets?.raceEntry?.endpoint?.includes("/api/public/tasks/")) errors.push("race_entry_packet_missing");
  if (quickstart?.packets?.actionSpace?.schemaVersion !== "steambench.public-task-action-space.v1") errors.push("action_space_packet_missing");
  if (quickstart?.packets?.agentOnboarding?.schemaVersion !== "steambench.public-agent-onboarding.v1") errors.push("agent_onboarding_packet_missing");
  if (!Array.isArray(quickstart?.steps) || quickstart.steps.length < requiredStepIds.length) errors.push("steps_missing");
  for (const stepId of requiredStepIds) {
    if (!stepIds.has(stepId)) errors.push(`step_missing:${stepId}`);
  }
  if (quickstart?.readiness?.actionSpace?.privilegedSystemInput !== false) errors.push("privileged_system_input_enabled");
  if (!quickstart?.steps?.some((step) => step.id === "submit-evidence" && step.bodyTemplate?.artifactPath === "output/output.mp4")) {
    errors.push("canonical_artifact_step_missing");
  }
  if (!String(quickstart?.commands?.registerAgent ?? "").includes("public:agent")) errors.push("register_agent_command_missing");
  if (!String(quickstart?.commands?.inspectRaceEntry ?? "").includes("public:race-entry")) errors.push("race_entry_command_missing");
  if (!String(quickstart?.commands?.runAgentSession ?? "").includes("agent:run-session")) errors.push("run_session_command_missing");
  return errors;
}

async function runPublicQuickstart(config = configFromArgs()) {
  const payload = await readJson(config.baseUrl, quickstartPath(config));
  const quickstart = payload.quickstart;
  const errors = validateQuickstart(quickstart, config);
  return {
    schemaVersion: "steambench.public-quickstart-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    request: {
      season: config.season,
      appid: config.appid,
      taskId: config.taskId,
      humanUserId: config.humanUserId,
      agentId: config.agentId,
      provider: config.provider,
      limit: config.limit
    },
    quickstart,
    validation: {
      valid: errors.length === 0,
      errors
    },
    summary: {
      valid: errors.length === 0,
      scope: quickstart?.scope,
      selectedAppid: quickstart?.selected?.game?.appid,
      selectedTaskId: quickstart?.selected?.task?.id,
      humanStatus: quickstart?.readiness?.human?.status,
      humanReady: quickstart?.readiness?.human?.ready,
      agentStatus: quickstart?.readiness?.agent?.status,
      agentReady: quickstart?.readiness?.agent?.ready,
      actionSpaceTransport: quickstart?.readiness?.actionSpace?.transport,
      bridgeable: quickstart?.readiness?.actionSpace?.bridgeable,
      requiresControlSession: quickstart?.readiness?.actionSpace?.requiresControlSession,
      readyForMatch: quickstart?.readiness?.match?.readyForMatch,
      steps: quickstart?.steps?.length ?? 0,
      commands: Object.keys(quickstart?.commands ?? {}),
      canonicalArtifact: quickstart?.steps?.find((step) => step.id === "submit-evidence")?.bodyTemplate?.artifactPath
    }
  };
}

export { runPublicQuickstart };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicQuickstart()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.validation.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
