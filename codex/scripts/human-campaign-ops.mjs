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
  const userId = args.get("user-id") ?? args.get("userId");
  if (!userId) {
    throw new Error("Provide --user-id=<human_user_id>.");
  }
  const execute = args.get("execute") ?? "";
  if (execute && execute !== "run-local") {
    throw new Error("Provide --execute=run-local or omit --execute for read-only inspection.");
  }
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    userId,
    campaignId: args.get("campaign-id") ?? args.get("campaignId"),
    limit: intArg("limit", 8, { min: 1, max: 50 }),
    execute
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

function planPath(config) {
  const query = new URLSearchParams({
    limit: String(config.limit)
  });
  if (config.campaignId) query.set("campaignId", config.campaignId);
  return `/api/users/${encodeURIComponent(config.userId)}/human-campaign-plan?${query}`;
}

function runLocalRequest(config) {
  return {
    method: "POST",
    body: JSON.stringify({
      campaignId: config.campaignId,
      limit: config.limit
    })
  };
}

async function runHumanCampaignOps(config = configFromArgs()) {
  const planPayload = await readJson(config.baseUrl, planPath(config));
  const executedAction = config.execute
    ? {
        action: {
          id: "run-local",
          method: "POST",
          endpoint: `/api/users/${encodeURIComponent(config.userId)}/human-campaigns/run-local`
        },
        result: await readJson(
          config.baseUrl,
          `/api/users/${encodeURIComponent(config.userId)}/human-campaigns/run-local`,
          runLocalRequest(config)
        )
      }
    : undefined;
  const refreshedPlan = executedAction
    ? (await readJson(config.baseUrl, planPath(config))).plan
    : planPayload.plan;

  return {
    schemaVersion: "steambench.human-campaign-ops-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    userId: config.userId,
    campaignId: config.campaignId,
    plan: refreshedPlan,
    executedAction,
    summary: {
      status: refreshedPlan.status,
      sourceType: refreshedPlan.source?.type,
      sourceCampaignId: refreshedPlan.source?.campaignId,
      tasks: refreshedPlan.totals?.tasks,
      ready: refreshedPlan.totals?.ready,
      alreadyScored: refreshedPlan.totals?.alreadyScored,
      blocked: refreshedPlan.totals?.blocked,
      completionRate: refreshedPlan.totals?.completionRate,
      humanScore: refreshedPlan.totals?.humanScore,
      agentScore: refreshedPlan.totals?.agentScore,
      execute: config.execute || "inspect",
      executedActionId: executedAction?.action?.id,
      submissions: executedAction?.result?.submissions?.length,
      comparisonStatus: executedAction?.result?.comparison?.status,
      comparisonComplete: executedAction?.result?.bundle?.integrity?.comparisonComplete,
      certificateKind: executedAction?.result?.certificate?.kind,
      certificateReady: executedAction?.result?.certificate?.integrity?.readyForPublicShare
    }
  };
}

export { runHumanCampaignOps };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHumanCampaignOps()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
