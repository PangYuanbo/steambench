import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();
const executeModes = new Set(["inspect", "register"]);

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function listArg(name) {
  const value = args.get(name);
  if (!value) return undefined;
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function configFromArgs() {
  const provider = args.get("provider") ?? "external";
  if (provider !== "local" && provider !== "modal" && provider !== "external") {
    throw new Error("Provide --provider=local|modal|external.");
  }
  const execute = args.get("execute") ?? "inspect";
  if (!executeModes.has(execute)) {
    throw new Error(`Provide --execute as one of: ${[...executeModes].join(", ")}.`);
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    taskId: args.get("task-id") ?? args.get("taskId") ?? args.get("task"),
    agentId: args.get("agent-id") ?? args.get("agentId") ?? args.get("agent"),
    provider,
    execute,
    handle: args.get("handle"),
    displayName: args.get("display-name") ?? args.get("displayName"),
    command: args.get("command"),
    capabilities: listArg("capabilities"),
    limit: intArg("limit", 6, { min: 1, max: 20 })
  };
}

function resolveUrl(baseUrl, pathOrUrl) {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${baseUrl.replace(/\/$/, "")}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

async function readJson(baseUrl, pathOrUrl, options) {
  const response = await fetch(resolveUrl(baseUrl, pathOrUrl), {
    headers: { "content-type": "application/json" },
    ...options
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

function onboardingPath(config, agentId = config.agentId) {
  const query = new URLSearchParams();
  if (config.taskId) query.set("taskId", config.taskId);
  if (agentId) query.set("agentId", agentId);
  if (config.provider) query.set("provider", config.provider);
  query.set("limit", String(config.limit));
  return `/api/public/agents/onboarding?${query}`;
}

function validateOnboarding(onboarding) {
  const errors = [];
  if (onboarding?.schemaVersion !== "steambench.public-agent-onboarding.v1") errors.push("invalid_onboarding_schema");
  if (!["ready-to-register", "ready-to-run", "missing-capabilities"].includes(onboarding?.status)) errors.push("invalid_onboarding_status");
  if (!onboarding?.selectedTask?.id || !onboarding?.selectedTask?.appid) errors.push("selected_task_missing");
  if (onboarding?.registration?.endpoint === undefined || !String(onboarding.registration.endpoint).endsWith("/api/agents")) errors.push("registration_endpoint_missing");
  if (onboarding?.registration?.method !== "POST") errors.push("registration_method_mismatch");
  if (!Array.isArray(onboarding?.registration?.requiredCapabilities) || onboarding.registration.requiredCapabilities.length === 0) errors.push("required_capabilities_missing");
  if (!Array.isArray(onboarding?.registration?.recommendedCapabilities) || onboarding.registration.recommendedCapabilities.length === 0) errors.push("recommended_capabilities_missing");
  if (onboarding?.actionSpace?.schemaVersion !== "steambench.runtime-action-space.v1") errors.push("runtime_action_space_schema_missing");
  if (!Array.isArray(onboarding?.actionSpace?.allowedActionTypes) || onboarding.actionSpace.allowedActionTypes.length === 0) errors.push("allowed_action_types_missing");
  if (!String(onboarding?.actionSpace?.publicPacket ?? "").includes("/api/public/tasks/")) errors.push("public_action_space_link_missing");
  if (onboarding?.runEntry?.runSessionBodyTemplate?.taskId !== onboarding?.selectedTask?.id) errors.push("run_session_task_mismatch");
  if (!Array.isArray(onboarding?.taskRecommendations) || onboarding.taskRecommendations.length === 0) errors.push("task_recommendations_missing");
  return errors;
}

function registrationBody(config, onboarding) {
  const template = onboarding.registration?.requestBodyTemplate ?? {};
  return {
    ...template,
    handle: config.handle ?? template.handle,
    displayName: config.displayName ?? template.displayName,
    provider: config.provider ?? template.provider,
    runtimeProvider: config.provider === "modal" ? "modal" : template.runtimeProvider,
    command: config.command ?? template.command,
    capabilities: config.capabilities ?? template.capabilities ?? onboarding.registration?.requiredCapabilities
  };
}

async function runPublicAgent(config = configFromArgs()) {
  const initialPayload = await readJson(config.baseUrl, onboardingPath(config));
  const initial = initialPayload.onboarding;
  const initialErrors = validateOnboarding(initial);
  let registration;
  let refreshed = initial;
  let refreshedErrors = [];

  if (config.execute === "register") {
    registration = await readJson(config.baseUrl, initial.registration.endpoint, {
      method: "POST",
      body: JSON.stringify(registrationBody(config, initial))
    });
    const refreshedPayload = await readJson(config.baseUrl, onboardingPath(config, registration.agent?.id));
    refreshed = refreshedPayload.onboarding;
    refreshedErrors = validateOnboarding(refreshed);
  }

  const errors = [...initialErrors, ...refreshedErrors];
  return {
    schemaVersion: "steambench.public-agent-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    execute: config.execute,
    request: {
      taskId: config.taskId,
      agentId: config.agentId,
      provider: config.provider,
      limit: config.limit
    },
    onboarding: refreshed,
    registration,
    validation: {
      valid: errors.length === 0,
      errors
    },
    summary: {
      valid: errors.length === 0,
      status: refreshed?.status,
      selectedTaskId: refreshed?.selectedTask?.id,
      selectedAppid: refreshed?.selectedTask?.appid,
      agentId: refreshed?.selectedAgent?.id ?? registration?.agent?.id,
      agentHandle: refreshed?.selectedAgent?.handle ?? registration?.agent?.handle,
      ready: refreshed?.readiness?.ready,
      missingCapabilities: refreshed?.readiness?.missingCapabilities,
      requiredCapabilities: refreshed?.registration?.requiredCapabilities,
      actionSpaceInputMode: refreshed?.actionSpace?.inputMode,
      actionSpaceTransport: refreshed?.actionSpace?.transport,
      bridgeable: refreshed?.actionSpace?.bridgeable,
      publicActionSpace: refreshed?.actionSpace?.publicPacket,
      runnerContract: refreshed?.runEntry?.runnerContract,
      runSession: refreshed?.runEntry?.runSession,
      registered: Boolean(registration?.agent)
    }
  };
}

export { runPublicAgent };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicAgent()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.validation.valid) process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
