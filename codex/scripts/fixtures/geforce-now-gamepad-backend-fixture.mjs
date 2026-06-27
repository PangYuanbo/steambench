let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  const report = {
    schemaVersion: "steambench.geforce-now-gamepad-backend-report.v1",
    status: "executed",
    provider: "geforce-now-backend-fixture",
    backend: "fixture",
    executedStepCount: request.steps.length,
    sideEffects: false,
    receivedProtocol: request.schemaVersion,
    receivedStepKinds: request.steps.map((entry) => entry.step.kind)
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
});
