const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=") || "1"];
  })
);

const baseUrl = args.get("api") ?? process.env.STEAMBENCH_API_URL ?? "http://127.0.0.1:8787";
const competitor = args.get("competitor") ?? "local-runtime-agent";
const requestedTaskId = args.get("task");
const requestedRunId = args.get("run");
const agentId = args.get("agent");
const workerId = args.get("worker") ?? `worker-${agentId ?? competitor}`;

async function readJson(path, options) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json" },
    ...options
  });
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

const state = await readJson("/api/state");
const existingRun = requestedRunId ? await readJson(`/api/runs/${encodeURIComponent(requestedRunId)}`) : null;
const task = existingRun
  ? state.tasks.find((entry) => entry.id === existingRun.run.taskId)
  : requestedTaskId
    ? state.tasks.find((entry) => entry.id === requestedTaskId)
    : state.tasks
        .filter((entry) => entry.fairnessVerdict !== "exclude")
        .sort((a, b) => b.suitabilityScore - a.suitabilityScore)[0];

if (!task) {
  throw new Error(
    requestedRunId
      ? `Task not found for run: ${requestedRunId}`
      : requestedTaskId
        ? `Task not found: ${requestedTaskId}`
        : "No runnable task found"
  );
}

const created = existingRun
  ? { run: existingRun.run }
  : agentId
  ? await readJson(`/api/agents/${encodeURIComponent(agentId)}/runs`, {
      method: "POST",
      body: JSON.stringify({
        taskId: task.id
      })
    })
  : await readJson("/api/runs", {
      method: "POST",
      body: JSON.stringify({
        taskId: task.id,
        competitor,
        competitorType: "agent"
      })
    });

const claim = await readJson(`/api/runs/${created.run.id}/claim`, {
  method: "POST",
  body: JSON.stringify({
    workerId,
    runtimeProvider: created.run.runtimeProvider ?? "local-sim",
    leaseMinutes: 15
  })
});

await readJson(`/api/runs/${created.run.id}/heartbeat`, {
  method: "POST",
  body: JSON.stringify({
    workerId,
    idempotencyKey: `${created.run.id}:heartbeat:initial`
  })
});

const presign = await readJson(`/api/runs/${created.run.id}/artifacts/presign`, {
  method: "POST",
  body: JSON.stringify({
    name: "output.mp4",
    canonical: true
  })
});

const runtimePackage = await readJson(
  `/api/runs/${created.run.id}/runtime-package${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ""}`
);
const executionManifest = await readJson(
  `/api/runs/${created.run.id}/execution-manifest${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ""}`
);

const simulated = await readJson(`/api/runs/${created.run.id}/simulate-agent`, {
  method: "POST",
  body: JSON.stringify({})
});

const summary = {
  runId: created.run.id,
  competitor: created.run.competitor,
  workerId,
  agent: runtimePackage.agent?.handle,
  taskId: task.id,
  game: task.gameName,
  task: task.title,
  plan: claim.plan,
  runtimePackage: {
    manifestSchema: executionManifest.manifest.schemaVersion,
    proofRequirements: runtimePackage.proofRequirements,
    artifactContract: runtimePackage.artifactContract,
    stage2Contract: executionManifest.manifest.stage2Contract,
    adapter: {
      launchUri: runtimePackage.plan.adapter.launchUri,
      inputMode: runtimePackage.plan.adapter.inputMode,
      captureMode: runtimePackage.plan.adapter.captureMode,
      saveStrategy: runtimePackage.plan.adapter.saveStrategy,
      readinessChecks: runtimePackage.plan.adapter.readinessChecks
    },
    launch: runtimePackage.launch
  },
  upload: presign.upload,
  status: simulated.run.status,
  score: simulated.run.score,
  scoreMetadata: simulated.run.scoreMetadata,
  artifact: simulated.run.artifactName,
  eventCount: simulated.run.eventCount,
  stream: simulated.stream?.playbackUrl
};

console.log(JSON.stringify(summary, null, 2));
