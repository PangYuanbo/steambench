import type { BenchmarkTask } from "../benchmark/types";
import { buildRuntimeActionSpace, type RuntimeActionSpace } from "../runtime/action-space";
import { adapterForGame, type RuntimeGameAdapter } from "../runtime/game-adapters";
import { buildRuntimeReadiness, type RuntimeReadiness } from "../runtime/readiness";
import type { AgentProfile } from "./store";

export type RuntimeActionSpaceCatalogEntry = {
  task: Pick<BenchmarkTask, "id" | "appid" | "gameName" | "title" | "track" | "level" | "estimatedRuntimeMinutes">;
  adapter: RuntimeGameAdapter;
  actionSpace: RuntimeActionSpace;
  bridge: {
    provider: "geforce-now";
    bridgeable: boolean;
    reason: string;
    manifestRequired: "steambench.control-bridge-manifest.v1";
    executorRequest: "steambench.controller-executor-request.v1";
    executorReport: "steambench.controller-executor-report.v1";
  };
  readiness: RuntimeReadiness;
  compatibleAgents: Array<{
    id: string;
    handle: string;
    displayName: string;
    provider: AgentProfile["provider"];
    runtimeProvider: AgentProfile["runtimeProvider"];
    status: AgentProfile["status"];
    ready: boolean;
    missingCapabilities: string[];
  }>;
  links: {
    createAgentRun?: string;
    taskLeaderboard: string;
    gameProfile: string;
    gameStandings: string;
  };
};

export type RuntimeActionSpaceCatalog = {
  schemaVersion: "steambench.runtime-action-space-catalog.v1";
  generatedAt: string;
  filters: {
    appid?: number;
    agentId?: string;
    inputMode?: RuntimeGameAdapter["inputMode"];
    transport?: RuntimeActionSpace["transport"];
    limit: number;
  };
  totals: {
    tasks: number;
    controllerTasks: number;
    keyboardMouseTasks: number;
    turnBasedTasks: number;
    virtualControllerTasks: number;
    bridgeableTasks: number;
    readyForSelectedAgent: number;
    blockedForSelectedAgent: number;
  };
  entries: RuntimeActionSpaceCatalogEntry[];
  recommendedActions: Array<{
    id: "create-control-run-session" | "create-agent-run" | "inspect-control-bridge-docs" | "inspect-agent-ops";
    label: string;
    priority: "high" | "medium" | "low";
    method: "GET" | "POST";
    endpoint: string;
    body?: Record<string, string | number | boolean>;
    reason: string;
  }>;
};

function compatibleAgents(task: BenchmarkTask, agents: AgentProfile[]) {
  return agents
    .filter((agent) => agent.status === "active")
    .map((agent) => {
      const readiness = buildRuntimeReadiness(task, agent);
      return {
        id: agent.id,
        handle: agent.handle,
        displayName: agent.displayName,
        provider: agent.provider,
        runtimeProvider: agent.runtimeProvider,
        status: agent.status,
        ready: readiness.ready,
        missingCapabilities: readiness.missingCapabilities
      };
    })
    .sort((a, b) =>
      Number(b.ready) - Number(a.ready) ||
      a.missingCapabilities.length - b.missingCapabilities.length ||
      a.handle.localeCompare(b.handle)
    );
}

function bridgeFor(actionSpace: RuntimeActionSpace): RuntimeActionSpaceCatalogEntry["bridge"] {
  const bridgeable = actionSpace.inputMode === "controller" &&
    actionSpace.transport === "virtual-controller" &&
    actionSpace.permissions.controller &&
    !actionSpace.permissions.privilegedSystemInput;
  return {
    provider: "geforce-now",
    bridgeable,
    reason: bridgeable
      ? "Task can be handed to a GeForce NOW virtual-controller bridge after a bounded control session is granted."
      : "Task does not use the virtual-controller transport; use its declared action space instead of a gamepad bridge.",
    manifestRequired: "steambench.control-bridge-manifest.v1",
    executorRequest: "steambench.controller-executor-request.v1",
    executorReport: "steambench.controller-executor-report.v1"
  };
}

function buildEntry(input: {
  task: BenchmarkTask;
  agents: AgentProfile[];
  selectedAgent?: AgentProfile;
}): RuntimeActionSpaceCatalogEntry {
  const adapter = adapterForGame(input.task);
  const actionSpace = buildRuntimeActionSpace({ adapter, task: input.task });
  const readiness = buildRuntimeReadiness(input.task, input.selectedAgent);
  return {
    task: {
      id: input.task.id,
      appid: input.task.appid,
      gameName: input.task.gameName,
      title: input.task.title,
      track: input.task.track,
      level: input.task.level,
      estimatedRuntimeMinutes: input.task.estimatedRuntimeMinutes
    },
    adapter,
    actionSpace,
    bridge: bridgeFor(actionSpace),
    readiness,
    compatibleAgents: compatibleAgents(input.task, input.agents),
    links: {
      createAgentRun: input.selectedAgent ? `/api/agents/${encodeURIComponent(input.selectedAgent.id)}/runs` : undefined,
      taskLeaderboard: `/api/tasks/${encodeURIComponent(input.task.id)}/leaderboard`,
      gameProfile: `/api/games/${input.task.appid}/profile`,
      gameStandings: `/api/games/${input.task.appid}/standings`
    }
  };
}

function sortEntries(entries: RuntimeActionSpaceCatalogEntry[]): RuntimeActionSpaceCatalogEntry[] {
  return [...entries].sort((a, b) =>
    Number(b.readiness.ready) - Number(a.readiness.ready) ||
    Number(b.bridge.bridgeable) - Number(a.bridge.bridgeable) ||
    b.compatibleAgents.filter((agent) => agent.ready).length - a.compatibleAgents.filter((agent) => agent.ready).length ||
    a.task.appid - b.task.appid ||
    a.task.level - b.task.level ||
    a.task.title.localeCompare(b.task.title)
  );
}

function actions(entries: RuntimeActionSpaceCatalogEntry[], selectedAgent?: AgentProfile): RuntimeActionSpaceCatalog["recommendedActions"] {
  const result: RuntimeActionSpaceCatalog["recommendedActions"] = [];
  const ready = selectedAgent
    ? entries.find((entry) => entry.readiness.ready && entry.links.createAgentRun)
    : undefined;
  if (ready?.links.createAgentRun && ready.bridge.bridgeable) {
    result.push({
      id: "create-control-run-session",
      label: "Create control run session",
      priority: "high",
      method: "POST",
      endpoint: `/api/agents/${encodeURIComponent(selectedAgent!.id)}/run-session`,
      body: {
        taskId: ready.task.id,
        createControlSession: true,
        ttlSeconds: 900
      },
      reason: `${selectedAgent?.handle} can start ${ready.task.gameName}: ${ready.task.title} with a bounded virtual-controller lease for bridge handoff.`
    });
  }

  if (ready?.links.createAgentRun) {
    result.push({
      id: "create-agent-run",
      label: "Create agent run",
      priority: ready.bridge.bridgeable ? "medium" : "high",
      method: "POST",
      endpoint: ready.links.createAgentRun,
      body: {
        taskId: ready.task.id
      },
      reason: `${selectedAgent?.handle} has every required capability for ${ready.task.gameName}: ${ready.task.title}.`
    });
  }

  const bridgeable = entries.find((entry) => entry.bridge.bridgeable);
  if (bridgeable) {
    result.push({
      id: "inspect-control-bridge-docs",
      label: "Inspect control bridge docs",
      priority: result.length === 0 ? "medium" : "low",
      method: "GET",
      endpoint: "/api/control-sessions/ops-report?transport=virtual-controller",
      reason: `${bridgeable.task.gameName} exposes a virtual-controller action space for GeForce NOW bridge handoff.`
    });
  }

  result.push({
    id: "inspect-agent-ops",
    label: "Inspect agent ops",
    priority: "low",
    method: "GET",
    endpoint: "/api/agents/ops-report",
    reason: "Review agent capability gaps before queueing benchmark runs."
  });
  return result;
}

export function buildRuntimeActionSpaceCatalog(input: {
  tasks: BenchmarkTask[];
  agents: AgentProfile[];
  agentId?: string;
  appid?: number;
  inputMode?: RuntimeGameAdapter["inputMode"];
  transport?: RuntimeActionSpace["transport"];
  limit?: number;
  generatedAt?: string;
}): RuntimeActionSpaceCatalog {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
  const selectedAgent = input.agentId
    ? input.agents.find((agent) => agent.id === input.agentId || agent.handle === input.agentId)
    : undefined;
  const entries = input.tasks
    .filter((task) => input.appid === undefined || task.appid === input.appid)
    .map((task) => buildEntry({ task, agents: input.agents, selectedAgent }))
    .filter((entry) => input.inputMode === undefined || entry.actionSpace.inputMode === input.inputMode)
    .filter((entry) => input.transport === undefined || entry.actionSpace.transport === input.transport);
  const ranked = sortEntries(entries).slice(0, limit);

  return {
    schemaVersion: "steambench.runtime-action-space-catalog.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    filters: {
      appid: input.appid,
      agentId: input.agentId,
      inputMode: input.inputMode,
      transport: input.transport,
      limit
    },
    totals: {
      tasks: ranked.length,
      controllerTasks: ranked.filter((entry) => entry.actionSpace.inputMode === "controller").length,
      keyboardMouseTasks: ranked.filter((entry) => entry.actionSpace.inputMode === "keyboard-mouse").length,
      turnBasedTasks: ranked.filter((entry) => entry.actionSpace.inputMode === "turn-based-actions").length,
      virtualControllerTasks: ranked.filter((entry) => entry.actionSpace.transport === "virtual-controller").length,
      bridgeableTasks: ranked.filter((entry) => entry.bridge.bridgeable).length,
      readyForSelectedAgent: selectedAgent ? ranked.filter((entry) => entry.readiness.ready).length : 0,
      blockedForSelectedAgent: selectedAgent ? ranked.filter((entry) => !entry.readiness.ready).length : 0
    },
    entries: ranked,
    recommendedActions: actions(ranked, selectedAgent)
  };
}
