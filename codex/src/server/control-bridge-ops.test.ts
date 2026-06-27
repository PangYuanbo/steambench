import { describe, expect, it } from "vitest";
import type { BenchmarkTask } from "../benchmark/types";
import type { RuntimeRunEvent } from "../runtime/events";
import type { AgentProfile, BenchmarkRun, RuntimeControlSession } from "./store";
import { buildControlBridgeOpsReport } from "./control-bridge-ops";

const task: BenchmarkTask = {
  id: "1145360:CAP.MEGAERA_12M",
  appid: 1145360,
  gameName: "Hades",
  title: "First Fury Clear",
  track: "capture",
  level: 7,
  score: 8000,
  objective: "Defeat the first Fury.",
  proof: ["Canonical output.mp4 artifact"],
  estimatedRuntimeMinutes: 18,
  suitability: "ranked",
  suitabilityScore: 80,
  reviewRequired: false,
  fairnessVerdict: "controlled",
  riskFlags: [],
  source: "manual"
};

const run: BenchmarkRun = {
  id: "run_controller",
  taskId: task.id,
  competitor: "agent_controller",
  competitorType: "agent",
  status: "running",
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:01.000Z",
  runtimeProvider: "local-sim",
  artifactName: "output.mp4",
  eventCount: 2
};

const agent: AgentProfile = {
  id: "agent_controller",
  userId: "usr_agent",
  handle: "controller-agent",
  displayName: "Controller Agent",
  provider: "local",
  runtimeProvider: "local-sim",
  command: "node scripts/runtime-worker.mjs",
  capabilities: ["controller", "screen-capture", "manual-review", "output.mp4"],
  status: "active",
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z"
};

const session: RuntimeControlSession = {
  id: "control_a",
  runId: run.id,
  taskId: task.id,
  agentId: agent.id,
  status: "active",
  actionSpace: {
    schemaVersion: "steambench.runtime-action-space.v1",
    inputMode: "controller",
    transport: "virtual-controller",
    permissions: {
      controller: true,
      keyboard: false,
      mouse: false,
      turnBased: false,
      privilegedSystemInput: false
    },
    allowedActionTypes: ["button", "stick", "trigger", "wait"],
    controller: {
      layout: "xinput-standard",
      buttons: ["a"],
      sticks: ["left"],
      triggers: ["rt"],
      stickRange: { min: -1, max: 1 },
      triggerRange: { min: 0, max: 1 },
      defaultTapMs: 80
    },
    constraints: {
      maxActionsPerBatch: 32,
      maxBatchDurationMs: 4000,
      minObserveBeforeAct: true,
      requireCanonicalCapture: true,
      forbiddenActions: ["os-hotkey"]
    },
    examples: [{ type: "button", button: "a", action: "tap" }]
  },
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
  expiresAt: "2026-06-14T01:00:00.000Z"
};

describe("control bridge ops report", () => {
  it("flags controller sessions with action batches but no executor report", () => {
    const events: RuntimeRunEvent[] = [
      {
        id: "evt_act",
        runId: run.id,
        type: "act",
        message: "acted",
        createdAt: "2026-06-14T00:00:02.000Z",
        metadata: {
          controlSessionId: session.id,
          actionCount: 3
        }
      }
    ];

    const report = buildControlBridgeOpsReport({
      sessions: [session],
      runs: [run],
      tasks: [task],
      agents: [agent],
      events
    });

    expect(report).toMatchObject({
      schemaVersion: "steambench.control-bridge-ops-report.v1",
      status: "needs-executor-report",
      totals: {
        active: 1,
        virtualController: 1,
        needsExecutorReport: 1
      }
    });
    expect(report.tickets[0]).toMatchObject({
      status: "needs-executor-report",
      actionBatches: 1,
      acceptedActions: 3,
      executorReports: 0,
      links: {
        bridgeManifest: "/api/control-sessions/control_a/bridge-manifest"
      }
    });
    expect(report.recommendedActions[0]).toMatchObject({
      id: "run-control-bridge",
      method: "CLI",
      command: "npm run bridge:control -- --session=control_a --executor=audit"
    });
  });

  it("recognizes persisted executor reports for a control session", () => {
    const report = buildControlBridgeOpsReport({
      sessions: [session],
      runs: [run],
      tasks: [task],
      agents: [agent],
      events: [
        {
          id: "evt_report",
          runId: run.id,
          type: "checkpoint",
          message: "executor report",
          createdAt: "2026-06-14T00:00:03.000Z",
          metadata: {
            executorReport: "steambench.controller-executor-report.v1",
            controlSessionId: session.id,
            executorStatus: "validated",
            executorProvider: "geforce-now-fixture",
            sideEffects: false
          }
        }
      ]
    });

    expect(report.status).toBe("idle");
    expect(report.tickets[0]).toMatchObject({
      status: "executor-validated",
      readiness: "ready",
      executorReports: 1,
      lastExecutorStatus: "validated",
      lastExecutorProvider: "geforce-now-fixture",
      lastExecutorSideEffects: false
    });
  });
});
