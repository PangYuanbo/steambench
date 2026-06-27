import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();
const validDecisions = new Set(["ranked-ready", "review-required", "reject"]);
const validFairnessVerdicts = new Set(["good", "controlled", "not-comparable", "exclude"]);
const validRiskFlags = new Set(["grind", "multiplayer", "dlc", "seasonal", "antiCheat", "longHorizon"]);
const validRegistryStatuses = new Set(["fixture-active", "candidate", "active", "rejected"]);

function intArg(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function enumArg(name, valid) {
  const value = args.get(name);
  if (value === undefined) return undefined;
  if (!valid.has(value)) {
    throw new Error(`Provide --${name} as one of: ${[...valid].join(", ")}.`);
  }
  return value;
}

function configFromArgs() {
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    decision: enumArg("decision", validDecisions),
    fairnessVerdict: enumArg("fairnessVerdict", validFairnessVerdicts) ?? enumArg("fairness-verdict", validFairnessVerdicts),
    riskFlag: enumArg("riskFlag", validRiskFlags) ?? enumArg("risk-flag", validRiskFlags),
    registryStatus: enumArg("registryStatus", validRegistryStatuses) ?? enumArg("registry-status", validRegistryStatuses),
    limit: intArg("limit", 50, { min: 1, max: 200 })
  };
}

async function readJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json" }
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
  const query = new URLSearchParams();
  if (config.decision) query.set("decision", config.decision);
  if (config.fairnessVerdict) query.set("fairnessVerdict", config.fairnessVerdict);
  if (config.riskFlag) query.set("riskFlag", config.riskFlag);
  if (config.registryStatus) query.set("registryStatus", config.registryStatus);
  query.set("limit", String(config.limit));
  return query.toString();
}

function topRisk(catalog) {
  return catalog.risks?.[0]?.flag;
}

async function runTaskReviewOps(config = configFromArgs()) {
  const path = `/api/tasks/review-catalog?${queryString(config)}`;
  const payload = await readJson(config.baseUrl, path);
  const catalog = payload.catalog;
  return {
    schemaVersion: "steambench.task-review-ops-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    filters: {
      decision: config.decision,
      fairnessVerdict: config.fairnessVerdict,
      riskFlag: config.riskFlag,
      registryStatus: config.registryStatus,
      limit: config.limit
    },
    catalog,
    summary: {
      tasks: catalog.totals.tasks,
      active: catalog.totals.active,
      candidates: catalog.totals.candidates,
      rejected: catalog.totals.rejected,
      rankedReady: catalog.totals.rankedReady,
      reviewRequired: catalog.totals.reviewRequired,
      blocked: catalog.totals.blocked,
      controlled: catalog.fairness.controlled,
      exclude: catalog.fairness.exclude,
      topRisk: topRisk(catalog),
      queue: catalog.reviewQueue.map((entry) => ({
        taskId: entry.task.id,
        decision: entry.review.decision,
        registryStatus: entry.registryStatus,
        fairnessVerdict: entry.review.fairnessVerdict,
        riskFlags: entry.review.risks.map((risk) => risk.flag)
      }))
    }
  };
}

export { runTaskReviewOps };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTaskReviewOps()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
