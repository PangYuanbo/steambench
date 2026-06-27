import { describe, expect, it } from "vitest";
import type { BenchmarkTask } from "../benchmark/types";
import type { RuntimeRunEvent } from "../runtime/events";
import { buildRuntimeRunPlan } from "../runtime/events";
import { buildAgentTraceAuditReport } from "./agent-trace-audit";
import type { BenchmarkRun, RuntimeControlSession } from "./store";

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

const run: BenchmarkRun = {
  id: "run_trace_audit",
  taskId: task.id,
  competitor: "agent:trace-audit",
  competitorType: "agent",
  status: "queued",
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
  runtimeProvider: "local-sim",
  artifactName: "output.mp4",
  eventCount: 0
};

function session(): RuntimeControlSession {
  return {
    id: "control_trace_audit",
    runId: run.id,
    taskId: task.id,
    status: "active",
    actionSpace: buildRuntimeRunPlan(task).actionSpace,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    expiresAt: "2026-06-14T00:15:00.000Z"
  };
}

function traceEvents(controlSessionId = "control_trace_audit"): RuntimeRunEvent[] {
  return [
    {
      id: "evt_observe",
      runId: run.id,
      type: "observe",
      message: "Screen observed",
      createdAt: "2026-06-14T00:00:01.000Z",
      metadata: {
        step: 1,
        source: "test"
      }
    },
    {
      id: "evt_act",
      runId: run.id,
      type: "act",
      message: "Controller actions accepted",
      createdAt: "2026-06-14T00:00:02.000Z",
      metadata: {
        step: 1,
        actionCount: 3,
        controlSessionId,
        actionSpace: "steambench.runtime-action-space.v1",
        executionPlan: "steambench.controller-execution-plan.v1",
        executionPlanStepCount: 9,
        executionPlanDurationMs: 500
      }
    }
  ];
}

describe("agent trace audit report", () => {
  it("requires a side-effect-free executor report for controller traces", () => {
    const report = buildAgentTraceAuditReport({
      run,
      task,
      events: traceEvents(),
      controlSessions: [session()],
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report).toMatchObject({
      schemaVersion: "steambench.agent-trace-audit.v1",
      verdict: "needs-executor-report",
      totals: {
        observations: 1,
        actionBatches: 1,
        actions: 3,
        controlSessions: 1,
        executorReports: 0,
        invalidFindings: 0
      },
      integrity: {
        requiresControlSession: true,
        hasControlSession: true,
        actionBatchesBoundToKnownControlSession: true,
        controllerExecutionPlansPresent: true,
        executorReportRequired: true,
        executorReportPresent: false
      }
    });
    expect(report.recommendedActions.map((action) => action.id)).toEqual([
      "run-bridge-executor",
      "inspect-agent-handoff"
    ]);
  });

  it("marks controller traces ready after an executor report", () => {
    const controlSession = session();
    const events: RuntimeRunEvent[] = [
      ...traceEvents(controlSession.id),
      {
        id: "evt_executor",
        runId: run.id,
        type: "checkpoint",
        message: "Executor validated plan",
        createdAt: "2026-06-14T00:00:03.000Z",
        metadata: {
          executorReport: "steambench.controller-executor-report.v1",
          controlSessionId: controlSession.id,
          executor: "geforce-now",
          executorProvider: "geforce-now-fixture",
          executorStatus: "validated",
          planSchemaVersion: "steambench.controller-execution-plan.v1",
          sideEffects: false,
          plannedStepCount: 9,
          executedStepCount: 0
        }
      }
    ];

    const report = buildAgentTraceAuditReport({
      run,
      task,
      events,
      controlSessions: [controlSession],
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.verdict).toBe("trace-ready");
    expect(report.integrity.executorReportsSideEffectFree).toBe(true);
    expect(report.totals.executorReports).toBe(1);
    expect(report.recommendedActions.map((action) => action.id)).toEqual([
      "submit-run",
      "inspect-agent-handoff"
    ]);
  });

  it("flags controller actions bound to unknown sessions", () => {
    const report = buildAgentTraceAuditReport({
      run,
      task,
      events: traceEvents("control_missing"),
      controlSessions: [session()],
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.verdict).toBe("invalid");
    expect(report.findings.map((finding) => finding.id)).toContain("controller-action-unknown-session");
    expect(report.totals.invalidFindings).toBe(1);
  });
});
