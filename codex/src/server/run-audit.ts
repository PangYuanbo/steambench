import type { BenchmarkTask, ScoreboardRow } from "../benchmark/types";
import type { RuntimeRunEvent } from "../runtime/events";
import type { BenchmarkRun, LiveStreamSession, RunArtifact, RunProof } from "./store";

export type RunAuditRequirement = {
  type: RunProof["type"];
  required: true;
  status: "missing" | RunProof["status"];
  verified: boolean;
  proofId?: string;
  summary?: string;
};

export type ControllerExecutorReportSummary = {
  eventId: string;
  createdAt: string;
  controlSessionId?: string;
  executor?: string;
  provider?: string;
  status?: string;
  planSchemaVersion?: string;
  target?: string;
  timing?: string;
  totalDurationMs?: number;
  plannedStepCount?: number;
  executedStepCount?: number;
  sideEffects?: boolean;
  adapterProtocol?: string;
  backendProtocol?: string;
};

export type RunAuditReport = {
  run: BenchmarkRun;
  task: BenchmarkTask;
  verdict: "scoreboard-ready" | "proof-missing" | "failed" | "in-progress";
  requiredProofs: RunAuditRequirement[];
  missingProofs: RunProof["type"][];
  canonicalArtifact?: RunArtifact;
  scoreboardRow?: ScoreboardRow;
  evidenceCounts: {
    events: number;
    artifacts: number;
    proofs: number;
    streams: number;
  };
  controllerExecutorReports: ControllerExecutorReportSummary[];
  timeline: RuntimeRunEvent[];
  artifacts: RunArtifact[];
  proofs: RunProof[];
  streams: LiveStreamSession[];
};

export type RunAuditSummary = {
  runId: string;
  taskId: string;
  competitor: string;
  status: BenchmarkRun["status"];
  verdict: RunAuditReport["verdict"];
  missingProofs: RunProof["type"][];
  score?: number;
};

function primaryProofType(task: BenchmarkTask): RunProof["type"] {
  return task.track === "achievement" ? "steam-achievement" : "manual-review";
}

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

function summarizeControllerExecutorReports(events: RuntimeRunEvent[]): ControllerExecutorReportSummary[] {
  return events
    .filter((event) => event.metadata?.executorReport === "steambench.controller-executor-report.v1")
    .map((event) => ({
      eventId: event.id,
      createdAt: event.createdAt,
      controlSessionId: metadataString(event, "controlSessionId"),
      executor: metadataString(event, "executor"),
      provider: metadataString(event, "executorProvider"),
      status: metadataString(event, "executorStatus"),
      planSchemaVersion: metadataString(event, "planSchemaVersion"),
      target: metadataString(event, "target"),
      timing: metadataString(event, "timing"),
      totalDurationMs: metadataNumber(event, "totalDurationMs"),
      plannedStepCount: metadataNumber(event, "plannedStepCount"),
      executedStepCount: metadataNumber(event, "executedStepCount"),
      sideEffects: metadataBoolean(event, "sideEffects"),
      adapterProtocol: metadataString(event, "adapterProtocol"),
      backendProtocol: metadataString(event, "backendProtocol")
    }));
}

export function buildRunAuditReport(input: {
  run: BenchmarkRun;
  task: BenchmarkTask;
  events: RuntimeRunEvent[];
  artifacts: RunArtifact[];
  proofs: RunProof[];
  streams: LiveStreamSession[];
  scoreboard: ScoreboardRow[];
}): RunAuditReport {
  const requiredProofTypes: RunProof["type"][] = [primaryProofType(input.task), "canonical-artifact"];
  const requiredProofs = requiredProofTypes.map((type): RunAuditRequirement => {
    const proof = input.proofs.find((entry) => entry.type === type && entry.status === "verified")
      ?? input.proofs.find((entry) => entry.type === type);
    return {
      type,
      required: true,
      status: proof?.status ?? "missing",
      verified: proof?.status === "verified",
      proofId: proof?.id,
      summary: proof?.summary
    };
  });
  const missingProofs = requiredProofs.filter((entry) => !entry.verified).map((entry) => entry.type);
  const canonicalArtifact = input.artifacts.find((artifact) => artifact.canonical && artifact.name === "output.mp4");
  const scoreboardRow = input.scoreboard.find((row) => row.runId === input.run.id);
  const timeline = [...input.events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const controllerExecutorReports = summarizeControllerExecutorReports(timeline);
  const missingRequiredEvidence = missingProofs.length > 0 || !canonicalArtifact;
  const verdict: RunAuditReport["verdict"] =
    input.run.status === "scored" && !missingRequiredEvidence && Boolean(scoreboardRow)
      ? "scoreboard-ready"
      : missingRequiredEvidence
        ? "proof-missing"
        : input.run.status === "failed"
          ? "failed"
          : "in-progress";

  return {
    run: input.run,
    task: input.task,
    verdict,
    requiredProofs,
    missingProofs: !canonicalArtifact && !missingProofs.includes("canonical-artifact")
      ? [...missingProofs, "canonical-artifact"]
      : missingProofs,
    canonicalArtifact,
    scoreboardRow,
    evidenceCounts: {
      events: input.events.length,
      artifacts: input.artifacts.length,
      proofs: input.proofs.length,
      streams: input.streams.length
    },
    controllerExecutorReports,
    timeline,
    artifacts: input.artifacts,
    proofs: input.proofs,
    streams: input.streams
  };
}

export function summarizeRunAudit(report: RunAuditReport): RunAuditSummary {
  return {
    runId: report.run.id,
    taskId: report.task.id,
    competitor: report.run.competitor,
    status: report.run.status,
    verdict: report.verdict,
    missingProofs: report.missingProofs,
    score: report.run.score
  };
}
