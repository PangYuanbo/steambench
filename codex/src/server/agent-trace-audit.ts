import type { RuntimeActionSpace } from "../runtime/action-space";
import { buildRuntimeRunPlan, type RuntimeRunEvent } from "../runtime/events";
import type { BenchmarkTask } from "../benchmark/types";
import type { BenchmarkRun, RuntimeControlSession } from "./store";

export type AgentTraceAuditVerdict =
  | "trace-ready"
  | "needs-actions"
  | "needs-control-session"
  | "needs-executor-report"
  | "invalid";

export type AgentTraceAuditReport = {
  schemaVersion: "steambench.agent-trace-audit.v1";
  generatedAt: string;
  verdict: AgentTraceAuditVerdict;
  run: Pick<BenchmarkRun, "id" | "taskId" | "competitor" | "competitorType" | "status" | "runtimeProvider">;
  task: Pick<BenchmarkTask, "id" | "appid" | "gameName" | "title" | "track" | "level">;
  actionSpace: Pick<RuntimeActionSpace, "schemaVersion" | "inputMode" | "transport" | "allowedActionTypes" | "permissions" | "constraints">;
  totals: {
    events: number;
    observations: number;
    actionBatches: number;
    actions: number;
    checkpoints: number;
    controlSessions: number;
    activeControlSessions: number;
    executorReports: number;
    invalidFindings: number;
  };
  integrity: {
    hasObservation: boolean;
    hasActionBatch: boolean;
    requiresControlSession: boolean;
    hasControlSession: boolean;
    actionBatchesBoundToKnownControlSession: boolean;
    controllerExecutionPlansPresent: boolean;
    controllerExecutionPlansWithinLimit: boolean;
    executorReportRequired: boolean;
    executorReportPresent: boolean;
    executorReportsSideEffectFree: boolean;
    privilegedSystemInputDisabled: boolean;
  };
  findings: Array<{
    id: string;
    severity: "info" | "warning" | "error";
    message: string;
    eventId?: string;
    controlSessionId?: string;
  }>;
  recommendedActions: Array<{
    id: "create-control-session" | "submit-action-batch" | "run-bridge-executor" | "inspect-agent-handoff" | "submit-run";
    label: string;
    priority: "high" | "medium" | "low";
    method: "GET" | "POST" | "CLI";
    endpoint?: string;
    command?: string;
    body?: Record<string, unknown>;
    reason: string;
  }>;
  links: {
    handoff: string;
    playbook: string;
    trace: string;
    actionBatch: string;
    controlSessions: string;
    evidenceBundle: string;
  };
};

function metadataString(event: RuntimeRunEvent, key: string): string | undefined {
  const value = event.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function metadataNumber(event: RuntimeRunEvent, key: string): number | undefined {
  const value = event.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function metadataBoolean(event: RuntimeRunEvent, key: string): boolean | undefined {
  const value = event.metadata?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function reportVerdict(input: {
  invalidFindings: number;
  hasObservation: boolean;
  hasActionBatch: boolean;
  requiresControlSession: boolean;
  hasControlSession: boolean;
  executorReportRequired: boolean;
  executorReportPresent: boolean;
}): AgentTraceAuditVerdict {
  if (input.invalidFindings > 0) return "invalid";
  if (!input.hasObservation || !input.hasActionBatch) return "needs-actions";
  if (input.requiresControlSession && !input.hasControlSession) return "needs-control-session";
  if (input.executorReportRequired && !input.executorReportPresent) return "needs-executor-report";
  return "trace-ready";
}

function recommendedActions(input: {
  run: BenchmarkRun;
  verdict: AgentTraceAuditVerdict;
  activeSession?: RuntimeControlSession;
}): AgentTraceAuditReport["recommendedActions"] {
  const result: AgentTraceAuditReport["recommendedActions"] = [];
  if (input.verdict === "needs-control-session") {
    result.push({
      id: "create-control-session",
      label: "Create control session",
      priority: "high",
      method: "POST",
      endpoint: `/api/runs/${input.run.id}/control-sessions`,
      body: { ttlSeconds: 900 },
      reason: "Controller action spaces require a bounded control lease before bridge execution."
    });
  }
  if (input.verdict === "needs-actions" || input.verdict === "needs-control-session") {
    result.push({
      id: "submit-action-batch",
      label: "Submit action batch",
      priority: input.verdict === "needs-actions" ? "high" : "medium",
      method: "POST",
      endpoint: `/api/runs/${input.run.id}/action-batches`,
      reason: "The trace needs at least one observation and one accepted action batch."
    });
  }
  if (input.verdict === "needs-executor-report" && input.activeSession) {
    result.push({
      id: "run-bridge-executor",
      label: "Run bridge executor",
      priority: "high",
      method: "CLI",
      command: `npm run bridge:control -- --session=${input.activeSession.id}`,
      reason: "Controller actions have an execution plan but no side-effect-free executor report yet."
    });
  }
  if (input.verdict === "trace-ready") {
    result.push({
      id: "submit-run",
      label: "Submit run evidence",
      priority: "medium",
      method: "POST",
      endpoint: `/api/runs/${input.run.id}/submission`,
      body: { artifactPath: "output/output.mp4" },
      reason: "The runtime trace is action-ready; submit canonical capture and proof when available."
    });
  }
  result.push({
    id: "inspect-agent-handoff",
    label: "Inspect agent handoff",
    priority: "low",
    method: "GET",
    endpoint: `/api/runs/${input.run.id}/agent-handoff`,
    reason: "Inspect playbook, trace coverage, control leases, and next runtime actions."
  });
  return result;
}

export function buildAgentTraceAuditReport(input: {
  run: BenchmarkRun;
  task: BenchmarkTask;
  events: RuntimeRunEvent[];
  controlSessions: RuntimeControlSession[];
  generatedAt?: string;
}): AgentTraceAuditReport {
  const plan = buildRuntimeRunPlan(input.task);
  const actionSpace = plan.actionSpace;
  const observations = input.events.filter((event) => event.type === "observe");
  const acts = input.events.filter((event) => event.type === "act");
  const checkpoints = input.events.filter((event) => event.type === "checkpoint");
  const executorReports = input.events.filter((event) => event.metadata?.executorReport === "steambench.controller-executor-report.v1");
  const activeSession = input.controlSessions.find((session) => session.status === "active");
  const knownSessionIds = new Set(input.controlSessions.map((session) => session.id));
  const findings: AgentTraceAuditReport["findings"] = [];

  if (actionSpace.permissions.privilegedSystemInput) {
    findings.push({
      id: "privileged-system-input",
      severity: "error",
      message: "Runtime action space enables privileged system input."
    });
  }
  if (observations.length === 0) {
    findings.push({
      id: "missing-observation",
      severity: "warning",
      message: "Trace has no observe event before action submission."
    });
  }
  if (acts.length === 0) {
    findings.push({
      id: "missing-action-batch",
      severity: "warning",
      message: "Trace has no accepted action batch."
    });
  }

  let actionCount = 0;
  let boundControllerActs = 0;
  let controllerPlans = 0;
  let controllerPlansWithinLimit = 0;
  for (const event of acts) {
    const eventActionCount = metadataNumber(event, "actionCount") ?? metadataNumber(event, "actions") ?? 0;
    actionCount += eventActionCount;
    if (eventActionCount <= 0) {
      findings.push({
        id: "empty-action-event",
        severity: "error",
        message: "Action event recorded zero accepted actions.",
        eventId: event.id
      });
    }
    if (actionSpace.transport === "virtual-controller") {
      const controlSessionId = metadataString(event, "controlSessionId");
      if (!controlSessionId) {
        findings.push({
          id: "controller-action-without-session",
          severity: "error",
          message: "Controller action batch is missing a controlSessionId.",
          eventId: event.id
        });
      } else if (!knownSessionIds.has(controlSessionId)) {
        findings.push({
          id: "controller-action-unknown-session",
          severity: "error",
          message: "Controller action batch references an unknown control session.",
          eventId: event.id,
          controlSessionId
        });
      } else {
        boundControllerActs += 1;
      }
      const executionPlan = metadataString(event, "executionPlan");
      const stepCount = metadataNumber(event, "executionPlanStepCount") ?? 0;
      const durationMs = metadataNumber(event, "executionPlanDurationMs") ?? 0;
      if (executionPlan !== "steambench.controller-execution-plan.v1" || stepCount <= 0) {
        findings.push({
          id: "controller-execution-plan-missing",
          severity: "error",
          message: "Controller action batch is missing a compiled controller execution plan.",
          eventId: event.id,
          controlSessionId
        });
      } else {
        controllerPlans += 1;
      }
      if (durationMs > actionSpace.constraints.maxBatchDurationMs) {
        findings.push({
          id: "controller-execution-plan-duration",
          severity: "error",
          message: "Controller execution plan exceeds the action-space max batch duration.",
          eventId: event.id,
          controlSessionId
        });
      } else if (executionPlan === "steambench.controller-execution-plan.v1" && stepCount > 0) {
        controllerPlansWithinLimit += 1;
      }
    }
  }

  for (const event of executorReports) {
    if (metadataString(event, "planSchemaVersion") !== "steambench.controller-execution-plan.v1") {
      findings.push({
        id: "executor-plan-schema",
        severity: "error",
        message: "Controller executor report does not reference the controller execution-plan schema.",
        eventId: event.id,
        controlSessionId: metadataString(event, "controlSessionId")
      });
    }
    if (metadataBoolean(event, "sideEffects") !== false) {
      findings.push({
        id: "executor-side-effects",
        severity: "error",
        message: "Controller executor report did not assert sideEffects=false.",
        eventId: event.id,
        controlSessionId: metadataString(event, "controlSessionId")
      });
    }
  }

  const requiresControlSession = actionSpace.transport === "virtual-controller";
  const hasControlSession = input.controlSessions.length > 0;
  const executorReportRequired = requiresControlSession && acts.length > 0;
  const integrity = {
    hasObservation: observations.length > 0,
    hasActionBatch: acts.length > 0,
    requiresControlSession,
    hasControlSession,
    actionBatchesBoundToKnownControlSession: !requiresControlSession || acts.length === 0 || boundControllerActs === acts.length,
    controllerExecutionPlansPresent: !requiresControlSession || acts.length === 0 || controllerPlans === acts.length,
    controllerExecutionPlansWithinLimit: !requiresControlSession || acts.length === 0 || controllerPlansWithinLimit === acts.length,
    executorReportRequired,
    executorReportPresent: !executorReportRequired || executorReports.length > 0,
    executorReportsSideEffectFree: executorReports.every((event) => metadataBoolean(event, "sideEffects") === false),
    privilegedSystemInputDisabled: actionSpace.permissions.privilegedSystemInput === false
  };
  const invalidFindings = findings.filter((finding) => finding.severity === "error").length;
  const verdict = reportVerdict({
    invalidFindings,
    hasObservation: integrity.hasObservation,
    hasActionBatch: integrity.hasActionBatch,
    requiresControlSession,
    hasControlSession,
    executorReportRequired,
    executorReportPresent: integrity.executorReportPresent
  });

  return {
    schemaVersion: "steambench.agent-trace-audit.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    verdict,
    run: {
      id: input.run.id,
      taskId: input.run.taskId,
      competitor: input.run.competitor,
      competitorType: input.run.competitorType,
      status: input.run.status,
      runtimeProvider: input.run.runtimeProvider
    },
    task: {
      id: input.task.id,
      appid: input.task.appid,
      gameName: input.task.gameName,
      title: input.task.title,
      track: input.task.track,
      level: input.task.level
    },
    actionSpace: {
      schemaVersion: actionSpace.schemaVersion,
      inputMode: actionSpace.inputMode,
      transport: actionSpace.transport,
      allowedActionTypes: actionSpace.allowedActionTypes,
      permissions: actionSpace.permissions,
      constraints: actionSpace.constraints
    },
    totals: {
      events: input.events.length,
      observations: observations.length,
      actionBatches: acts.length,
      actions: actionCount,
      checkpoints: checkpoints.length,
      controlSessions: input.controlSessions.length,
      activeControlSessions: input.controlSessions.filter((session) => session.status === "active").length,
      executorReports: executorReports.length,
      invalidFindings
    },
    integrity,
    findings,
    recommendedActions: recommendedActions({
      run: input.run,
      verdict,
      activeSession
    }),
    links: {
      handoff: `/api/runs/${input.run.id}/agent-handoff`,
      playbook: `/api/runs/${input.run.id}/agent-playbook`,
      trace: `/api/runs/${input.run.id}/agent-trace`,
      actionBatch: `/api/runs/${input.run.id}/action-batches`,
      controlSessions: `/api/runs/${input.run.id}/control-sessions`,
      evidenceBundle: `/api/runs/${input.run.id}/evidence-bundle`
    }
  };
}
