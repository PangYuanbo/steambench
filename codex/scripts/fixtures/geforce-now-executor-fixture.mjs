let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

const request = JSON.parse(input);
const plan = request.plan;

console.log(JSON.stringify({
  schemaVersion: "steambench.controller-executor-report.v1",
  status: "validated",
  executor: "geforce-now",
  provider: "geforce-now-fixture",
  sessionId: request.sessionId,
  runId: request.runId,
  taskId: request.taskId,
  planSchemaVersion: plan.schemaVersion,
  target: plan.target,
  timing: plan.timing,
  totalDurationMs: plan.totalDurationMs,
  plannedStepCount: plan.steps.length,
  executedStepCount: 0,
  sideEffects: false,
  neutralOnCompletion: plan.neutralOnCompletion,
  adapterProtocol: request.schemaVersion,
  receivedStepKinds: plan.steps.map((step) => step.kind)
}));
