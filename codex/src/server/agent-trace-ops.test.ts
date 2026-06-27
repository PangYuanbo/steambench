import { describe, expect, it } from "vitest";
import type { BenchmarkTask } from "../benchmark/types";
import type { RuntimeRunEvent } from "../runtime/events";
import { buildRuntimeRunPlan } from "../runtime/events";
import type { BenchmarkRun, RuntimeControlSession } from "./store";
import { buildAgentTraceOpsReport } from "./agent-trace-ops";

const task: BenchmarkTask = {
  id: "1145360:ESCAPE_TARTARUS",
  appid: 1145360,
  gameName: "Hades",
  title: "Escaped Tartarus",
  track: "achievement",
  level: 4,
  score: 4800,
  objective: "Reach the first biome clear state.",
  proof: ["Canonical output/output.mp4 video artifact.", "Steam achievement proof."],
  estimatedRuntimeMinutes: 18,
  suitability: "ranked",
  suitabilityScore: 86,
  reviewRequired: false,
  fairnessVerdict: "good",
  riskFlags: [],
  source: "fixture",
  signalSource: "steam-achievement"
};

function run(id: string): BenchmarkRun {
  return {
    id,
    taskId: task.id,
    competitor: `agent:${id}`,
    competitorType: "agent",
    status: "queued",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: `2026-06-14T00:00:0${id.length % 9}.000Z`,
    runtimeProvider: "local-sim",
    artifactName: "output.mp4",
    eventCount: 0
  };
}

function session(runId: string): RuntimeControlSession {
  return {
    id: `control_${runId}`,
    runId,
    taskId: task.id,
    status: "active",
    actionSpace: buildRuntimeRunPlan(task).actionSpace,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    expiresAt: "2026-06-14T00:15:00.000Z"
  };
}

function traceEvents(runId: string, includeExecutor = false): RuntimeRunEvent[] {
  const events: RuntimeRunEvent[] = [
    {
      id: `evt_${runId}_observe`,
      runId,
      type: "observe",
      message: "Screen observed",
      createdAt: "2026-06-14T00:00:01.000Z",
      metadata: { step: 1 }
    },
    {
      id: `evt_${runId}_act`,
      runId,
      type: "act",
      message: "Controller actions accepted",
      createdAt: "2026-06-14T00:00:02.000Z",
      metadata: {
        actionCount: 3,
        controlSessionId: `control_${runId}`,
        executionPlan: "steambench.controller-execution-plan.v1",
        executionPlanStepCount: 9,
        executionPlanDurationMs: 500
      }
    }
  ];
  if (includeExecutor) {
    events.push({
      id: `evt_${runId}_executor`,
      runId,
      type: "checkpoint",
      message: "Executor validated plan",
      createdAt: "2026-06-14T00:00:03.000Z",
      metadata: {
        executorReport: "steambench.controller-executor-report.v1",
        controlSessionId: `control_${runId}`,
        planSchemaVersion: "steambench.controller-execution-plan.v1",
        sideEffects: false
      }
    });
  }
  return events;
}

describe("agent trace ops report", () => {
  it("summarizes cross-run trace readiness", () => {
    const needsActions = run("run_needs_actions");
    const needsExecutor = run("run_needs_executor");
    const ready = run("run_ready");

    const report = buildAgentTraceOpsReport({
      runs: [needsActions, needsExecutor, ready],
      tasks: [task],
      events: [...traceEvents(needsExecutor.id), ...traceEvents(ready.id, true)],
      controlSessions: [session(needsExecutor.id), session(ready.id)],
      limit: 10,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report).toMatchObject({
      schemaVersion: "steambench.agent-trace-ops-report.v1",
      status: "needs-runtime",
      totals: {
        agentRuns: 3,
        selectedRuns: 3,
        traceReady: 1,
        needsControlSession: 1,
        needsExecutorReport: 1,
        actions: 6,
        controlSessions: 2,
        executorReports: 1
      }
    });
    expect(report.tickets.map((ticket) => ticket.verdict)).toEqual([
      "needs-executor-report",
      "needs-control-session",
      "trace-ready"
    ]);
    expect(report.recommendedActions.map((action) => action.id)).toEqual([
      "run-bridge-executor",
      "create-control-session",
      "inspect-agent-handoff"
    ]);
    expect(report.recommendedActions[0]).toMatchObject({
      id: "run-bridge-executor",
      command: `npm run bridge:control -- --session=control_${needsExecutor.id} --executor=audit`
    });
    expect(report.tickets[0].audit.activeControlSessionId).toBe(`control_${needsExecutor.id}`);
  });

  it("filters by trace audit verdict", () => {
    const needsExecutor = run("run_needs_executor");
    const ready = run("run_ready");

    const report = buildAgentTraceOpsReport({
      runs: [needsExecutor, ready],
      tasks: [task],
      events: [...traceEvents(needsExecutor.id), ...traceEvents(ready.id, true)],
      controlSessions: [session(needsExecutor.id), session(ready.id)],
      verdict: "trace-ready",
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.status).toBe("ready");
    expect(report.totals.selectedRuns).toBe(1);
    expect(report.tickets[0].verdict).toBe("trace-ready");
  });
});
