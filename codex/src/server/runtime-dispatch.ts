import type { AgentProfile, BenchmarkRun, RuntimeDispatch } from "./store";

export type RuntimeDispatchPlan = {
  provider: RuntimeDispatch["provider"];
  workerId: string;
  command: string;
  manifestUrl: string;
  runtimePackageUrl: string;
  summary: string;
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function query(agent?: AgentProfile): string {
  return agent ? `?agentId=${encodeURIComponent(agent.id)}` : "";
}

export function buildRuntimeDispatchPlan(input: {
  run: BenchmarkRun;
  agent?: AgentProfile | null;
  provider: RuntimeDispatch["provider"];
  apiBaseUrl: string;
  workerId?: string;
}): RuntimeDispatchPlan {
  const apiBaseUrl = input.apiBaseUrl.replace(/\/$/, "");
  const workerId = input.workerId?.trim() || `${input.provider}-worker-${input.run.id}`;
  const agentArg = input.agent ? ` --agent=${shellQuote(input.agent.id)}` : "";
  const manifestUrl = `/api/runs/${input.run.id}/execution-manifest${query(input.agent ?? undefined)}`;
  const runtimePackageUrl = `/api/runs/${input.run.id}/runtime-package${query(input.agent ?? undefined)}`;
  const command = input.provider === "local"
    ? `STEAMBENCH_API_URL=${shellQuote(apiBaseUrl)} node scripts/runtime-worker.mjs --api=${shellQuote(apiBaseUrl)} --run=${shellQuote(input.run.id)}${agentArg} --worker=${shellQuote(workerId)}`
    : `modal run modal/steambench_runtime.py --run-id ${shellQuote(input.run.id)}${input.agent ? ` --agent-id ${shellQuote(input.agent.id)}` : ""} --api-base-url ${shellQuote(apiBaseUrl)} --worker-id ${shellQuote(workerId)}`;

  return {
    provider: input.provider,
    workerId,
    command,
    manifestUrl,
    runtimePackageUrl,
    summary: input.provider === "local"
      ? `Local worker dispatch for ${input.run.id}.`
      : `Modal worker dispatch plan for ${input.run.id}.`
  };
}
