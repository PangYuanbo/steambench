import type { BenchmarkTask } from "../benchmark/types";
import type { AgentProfile } from "../server/store";
import { adapterForGame, type RuntimeGameAdapter } from "./game-adapters";

export type RuntimeReadiness = {
  ready: boolean;
  agentId?: string;
  taskId: string;
  appid: number;
  adapter: RuntimeGameAdapter;
  requiredCapabilities: string[];
  providedCapabilities: string[];
  missingCapabilities: string[];
  warnings: string[];
};

function requiredCapabilitiesForTask(task: BenchmarkTask, adapter = adapterForGame(task)): string[] {
  const capabilities = new Set<string>(["output.mp4", "screen-capture", adapter.inputMode]);
  if (adapter.captureMode === "replay-or-screen") capabilities.add("action-log");
  if (adapter.captureMode === "stats-screen") capabilities.add("stats-screen");
  if (adapter.saveStrategy === "seeded-save" || adapter.saveStrategy === "published-seed") capabilities.add("seeded-save");
  if (task.track !== "achievement") capabilities.add("manual-review");
  return [...capabilities];
}

export function buildRuntimeReadiness(task: BenchmarkTask, agent?: AgentProfile | null): RuntimeReadiness {
  const adapter = adapterForGame(task);
  const requiredCapabilities = requiredCapabilitiesForTask(task, adapter);
  const providedCapabilities = agent?.capabilities ?? [];
  const provided = new Set(providedCapabilities);
  const missingCapabilities = requiredCapabilities.filter((capability) => !provided.has(capability));
  const warnings = [
    ...(agent ? [] : ["No agent profile selected; using generic runtime defaults."]),
    ...(adapter.inputMode === "controller" && !provided.has("controller")
      ? ["Controller tasks require controller input support or a mapped control bridge."]
      : []),
    ...(adapter.saveStrategy !== "fresh-profile" && !provided.has("seeded-save")
      ? [`${adapter.gameName} expects ${adapter.saveStrategy} readiness before dispatch.`]
      : [])
  ];

  return {
    ready: Boolean(agent) && missingCapabilities.length === 0,
    agentId: agent?.id,
    taskId: task.id,
    appid: task.appid,
    adapter,
    requiredCapabilities,
    providedCapabilities,
    missingCapabilities,
    warnings
  };
}
