import { describe, expect, it } from "vitest";
import type { BenchmarkTask } from "../benchmark/types";
import type { AgentProfile, StoreSnapshot } from "./store";
import { buildAgentOpsReport } from "./agent-ops";

const task: BenchmarkTask = {
  id: "620:STAT.PORTALS",
  appid: 620,
  gameName: "Portal 2",
  title: "Portal Placement Count",
  track: "stat",
  level: 4,
  score: 5000,
  objective: "Place portals during a controlled segment.",
  proof: ["Canonical output/output.mp4 video artifact.", "Manual metric review proof."],
  estimatedRuntimeMinutes: 12,
  suitability: "ranked",
  suitabilityScore: 82,
  reviewRequired: false,
  fairnessVerdict: "good",
  riskFlags: [],
  source: "fixture",
  signalSource: "steam-stat"
};

const controllerTask: BenchmarkTask = {
  id: "1145360:ESCAPE_CLEAR",
  appid: 1145360,
  gameName: "Hades",
  title: "Escape Clear",
  track: "achievement",
  level: 1,
  score: 3000,
  objective: "Clear a seeded Hades run.",
  proof: ["Canonical output/output.mp4 video artifact.", "Save-state proof."],
  estimatedRuntimeMinutes: 24,
  suitability: "ranked",
  suitabilityScore: 80,
  reviewRequired: false,
  fairnessVerdict: "good",
  riskFlags: [],
  source: "fixture",
  signalSource: "steam-achievement"
};

function agent(id: string, overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id,
    userId: `usr_${id}`,
    handle: id,
    displayName: id,
    provider: "local",
    runtimeProvider: "local-sim",
    command: "node scripts/runtime-worker.mjs",
    capabilities: ["screen-capture", "manual-review", "output.mp4", "controller", "keyboard-mouse", "seeded-save"],
    status: "active",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    ...overrides
  };
}

function snapshot(agents: AgentProfile[]): StoreSnapshot {
  return {
    users: [],
    agents,
    matches: [],
    challenges: [],
    suiteRaces: [],
    agentCampaigns: [],
    gameCoverageRuns: [],
    eventRegistrations: [],
    steamLinks: [],
    runs: [],
    dispatches: [],
    controlSessions: [],
    events: [],
    artifacts: [],
    streams: [],
    proofs: [],
    taskRegistry: [],
    steamAppDiscoveries: [],
    scoreboard: []
  };
}

describe("agent ops report", () => {
  it("summarizes ready, queued, and paused agents", () => {
    const readyAgent = agent("ready-agent");
    const queuedAgent = agent("queued-agent");
    const pausedAgent = agent("paused-agent", { status: "paused" });
    const store = snapshot([readyAgent, queuedAgent, pausedAgent]);
    store.runs.push({
      id: "run_queued",
      taskId: task.id,
      competitor: "agent:queued-agent",
      competitorType: "agent",
      status: "queued",
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
      runtimeProvider: "local-sim",
      artifactName: "output.mp4",
      eventCount: 0
    });

    const report = buildAgentOpsReport({
      agents: store.agents,
      snapshot: store,
      tasks: [task],
      provider: "local",
      limit: 10,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report).toMatchObject({
      schemaVersion: "steambench.agent-ops-report.v1",
      status: "needs-dispatch",
      filters: {
        provider: "local",
        limit: 10
      },
      totals: {
        agents: 3,
        selectedAgents: 3,
        active: 2,
        paused: 1,
        readyForCampaign: 1,
        queuedAgents: 1,
        queuedRuns: 1,
        readyRecommendedTasks: 3
      }
    });
    expect(report.tickets.map((ticket) => ticket.status)).toEqual([
      "ready-for-campaign",
      "queued",
      "paused"
    ]);
    expect(report.tickets[0].nextTask?.id).toBe(task.id);
    expect(report.recommendedActions.map((action) => action.id)).toEqual([
      "open-agent-run-session",
      "create-agent-campaign",
      "drain-dispatches",
      "activate-agent",
      "inspect-agent-lab"
    ]);
    expect(report.recommendedActions[0]).toMatchObject({
      endpoint: "/api/agents/ready-agent/run-session",
      body: {
        taskId: task.id,
        ttlSeconds: 900
      }
    });
  });

  it("prefers virtual-controller tasks for single run-session recommendations", () => {
    const readyAgent = agent("ready-agent");
    const store = snapshot([readyAgent]);

    const report = buildAgentOpsReport({
      agents: store.agents,
      snapshot: store,
      tasks: [task, controllerTask],
      provider: "local",
      limit: 10,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.tickets[0].nextTask?.id).toBe(controllerTask.id);
    expect(report.recommendedActions[0]).toMatchObject({
      id: "open-agent-run-session",
      endpoint: "/api/agents/ready-agent/run-session",
      body: {
        taskId: controllerTask.id,
        ttlSeconds: 900
      }
    });
  });
});
