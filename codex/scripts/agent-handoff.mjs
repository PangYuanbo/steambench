import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./steam-ingest.mjs";

const args = parseCliArgs();

function configFromArgs() {
  const runId = args.get("run");
  if (!runId) throw new Error("Provide --run=<run_id>.");
  return {
    baseUrl: args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787",
    runId,
    agentId: args.get("agent") ?? args.get("agentId")
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

async function runAgentHandoff(config = configFromArgs()) {
  const query = config.agentId ? `?agentId=${encodeURIComponent(config.agentId)}` : "";
  const payload = await readJson(config.baseUrl, `/api/runs/${encodeURIComponent(config.runId)}/agent-handoff${query}`);
  const handoff = payload.handoff;
  return {
    schemaVersion: "steambench.agent-handoff-cli.v1",
    generatedAt: new Date().toISOString(),
    api: config.baseUrl,
    runId: config.runId,
    agentId: config.agentId,
    handoff,
    summary: {
      status: handoff.status,
      runStatus: handoff.run.status,
      inputMode: handoff.control.inputMode,
      transport: handoff.control.transport,
      requiresControlSession: handoff.control.requiresControlSession,
      activeControlSessionId: handoff.control.activeSession?.id,
      activeAccessPacketEndpoint: handoff.control.activeSession?.accessPacket ?? handoff.endpoints?.activeAccessPacket,
      activeBridgeManifestEndpoint: handoff.control.activeSession?.bridgeManifest ?? handoff.endpoints?.activeBridgeManifest,
      activeExecutorReportEndpoint: handoff.control.activeSession?.executorReport ?? handoff.endpoints?.activeExecutorReport,
      activeStreamId: handoff.broadcast?.activeStream?.id,
      activeStreamStatus: handoff.broadcast?.activeStream?.status,
      activeBroadcastEndpoint: handoff.broadcast?.activeStream?.detail,
      activeBroadcastEvidenceBundleEndpoint: handoff.broadcast?.activeStream?.evidenceBundle,
      activeBroadcastResultCertificateEndpoint: handoff.broadcast?.activeStream?.resultCertificate,
      livestreamStatusEndpoint: handoff.broadcast?.activeStream?.statusEndpoint,
      observations: handoff.trace.totals.observations,
      actionBatches: handoff.trace.totals.actionBatches,
      actions: handoff.trace.totals.actions,
      readyForSubmission: handoff.trace.coverage.readyForSubmission,
      blockers: handoff.blockers,
      actionsRecommended: handoff.recommendedActions.map((action) => action.id)
    }
  };
}

export { runAgentHandoff };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAgentHandoff()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
