import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();

function configFromArgs() {
  const runId = args.get("run");
  if (!runId) throw new Error("Provide --run=<run_id>.");
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    runId
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

async function runAgentTraceAudit(config = configFromArgs()) {
  const payload = await readJson(config.baseUrl, `/api/runs/${encodeURIComponent(config.runId)}/agent-trace/audit`);
  const audit = payload.audit;
  return {
    schemaVersion: "steambench.agent-trace-audit-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    runId: config.runId,
    audit,
    summary: {
      verdict: audit.verdict,
      inputMode: audit.actionSpace.inputMode,
      transport: audit.actionSpace.transport,
      observations: audit.totals.observations,
      actionBatches: audit.totals.actionBatches,
      actions: audit.totals.actions,
      controlSessions: audit.totals.controlSessions,
      executorReports: audit.totals.executorReports,
      invalidFindings: audit.totals.invalidFindings,
      findings: audit.findings.map((finding) => finding.id),
      actionsRecommended: audit.recommendedActions.map((action) => action.id)
    }
  };
}

export { runAgentTraceAudit };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAgentTraceAudit()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
