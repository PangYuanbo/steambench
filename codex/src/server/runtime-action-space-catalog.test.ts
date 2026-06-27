import { describe, expect, it } from "vitest";
import { buildFixtureTasks } from "../benchmark/task-generator";
import type { AgentProfile } from "./store";
import { buildRuntimeActionSpaceCatalog } from "./runtime-action-space-catalog";

function agent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "agent_controller",
    userId: "agent_user",
    handle: "controller-agent",
    displayName: "Controller Agent",
    provider: "local",
    runtimeProvider: "local-sim",
    command: "npm run worker:local",
    capabilities: ["controller", "screen-capture", "stats-screen", "seeded-save", "manual-review", "output.mp4"],
    status: "active",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    ...overrides
  };
}

describe("runtime action-space catalog", () => {
  it("summarizes controller tasks as GeForce NOW bridgeable action spaces", () => {
    const catalog = buildRuntimeActionSpaceCatalog({
      tasks: buildFixtureTasks(),
      agents: [agent()],
      agentId: "agent_controller",
      inputMode: "controller",
      transport: "virtual-controller",
      limit: 5,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(catalog).toMatchObject({
      schemaVersion: "steambench.runtime-action-space-catalog.v1",
      totals: {
        tasks: 5,
        controllerTasks: 5,
        virtualControllerTasks: 5,
        bridgeableTasks: 5,
        readyForSelectedAgent: 5,
        blockedForSelectedAgent: 0
      }
    });
    expect(catalog.entries[0]).toMatchObject({
      actionSpace: {
        inputMode: "controller",
        transport: "virtual-controller",
        permissions: {
          controller: true,
          privilegedSystemInput: false
        },
        controller: {
          layout: "xinput-standard"
        }
      },
      bridge: {
        provider: "geforce-now",
        bridgeable: true,
        manifestRequired: "steambench.control-bridge-manifest.v1",
        executorRequest: "steambench.controller-executor-request.v1"
      },
      links: {
        createAgentRun: "/api/agents/agent_controller/runs"
      }
    });
    expect(catalog.recommendedActions[0]).toMatchObject({
      id: "create-control-run-session",
      method: "POST",
      endpoint: "/api/agents/agent_controller/run-session",
      body: {
        taskId: catalog.entries[0].task.id,
        createControlSession: true,
        ttlSeconds: 900
      }
    });
    expect(catalog.recommendedActions[1]).toMatchObject({
      id: "create-agent-run",
      priority: "medium",
      body: {
        taskId: catalog.entries[0].task.id
      }
    });
  });

  it("surfaces selected-agent capability blockers without creating runs", () => {
    const catalog = buildRuntimeActionSpaceCatalog({
      tasks: buildFixtureTasks(),
      agents: [agent({ id: "agent_keyboard", handle: "keyboard-agent", capabilities: ["keyboard-mouse", "screen-capture", "output.mp4"] })],
      agentId: "agent_keyboard",
      appid: 1145360,
      inputMode: "controller",
      limit: 10
    });

    expect(catalog.totals.readyForSelectedAgent).toBe(0);
    expect(catalog.totals.blockedForSelectedAgent).toBeGreaterThan(0);
    expect(catalog.entries[0].readiness.ready).toBe(false);
    expect(catalog.entries[0].readiness.missingCapabilities).toContain("controller");
    expect(catalog.recommendedActions.map((action) => action.id)).not.toContain("create-control-run-session");
    expect(catalog.recommendedActions.map((action) => action.id)).not.toContain("create-agent-run");
    expect(catalog.recommendedActions.map((action) => action.id)).toContain("inspect-control-bridge-docs");
  });
});
