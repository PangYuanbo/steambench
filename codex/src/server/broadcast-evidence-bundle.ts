import type { BroadcastPayload } from "../runtime/broadcast";
import type { EvidenceChecklistItem } from "./evidence-bundle";
import type { ControllerExecutorReportSummary } from "./run-audit";

export type BroadcastEvidenceBundle = {
  schemaVersion: "steambench.broadcast-evidence-bundle.v1";
  generatedAt: string;
  streamId: string;
  runId: string;
  broadcast: BroadcastPayload;
  integrity: {
    verdict: "scoreboard-ready" | "proof-ready" | "live" | "incomplete" | "failed";
    streamPlayable: boolean;
    timelinePresent: boolean;
    canonicalArtifactPresent: boolean;
    requiredProofsVerified: boolean;
    scoreboardPublished: boolean;
    eventCount: number;
    artifactCount: number;
    proofCount: number;
    executorReportCount: number;
    latestExecutorReport?: ControllerExecutorReportSummary;
    highImportanceEvents: number;
    viewerCount: number;
    checklist: EvidenceChecklistItem[];
  };
};

function metadataString(item: BroadcastPayload["timeline"][number], key: string): string | undefined {
  const value = item.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function metadataNumber(item: BroadcastPayload["timeline"][number], key: string): number | undefined {
  const value = item.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function metadataBoolean(item: BroadcastPayload["timeline"][number], key: string): boolean | undefined {
  const value = item.metadata?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function summarizeControllerExecutorReports(timeline: BroadcastPayload["timeline"]): ControllerExecutorReportSummary[] {
  return timeline
    .filter((item) => item.metadata?.executorReport === "steambench.controller-executor-report.v1")
    .map((item) => ({
      eventId: item.id,
      createdAt: item.at,
      controlSessionId: metadataString(item, "controlSessionId"),
      executor: metadataString(item, "executor"),
      provider: metadataString(item, "executorProvider"),
      status: metadataString(item, "executorStatus"),
      planSchemaVersion: metadataString(item, "planSchemaVersion"),
      target: metadataString(item, "target"),
      timing: metadataString(item, "timing"),
      totalDurationMs: metadataNumber(item, "totalDurationMs"),
      plannedStepCount: metadataNumber(item, "plannedStepCount"),
      executedStepCount: metadataNumber(item, "executedStepCount"),
      sideEffects: metadataBoolean(item, "sideEffects"),
      adapterProtocol: metadataString(item, "adapterProtocol"),
      backendProtocol: metadataString(item, "backendProtocol")
    }));
}

export function buildBroadcastEvidenceBundle(input: {
  broadcast: BroadcastPayload;
  generatedAt?: string;
}): BroadcastEvidenceBundle {
  const requiredPrimaryProof = input.broadcast.task.track === "achievement" ? "steam-achievement" : "manual-review";
  const streamPlayable = input.broadcast.stream.playbackUrl.trim().length > 0 &&
    input.broadcast.stream.status !== "failed";
  const timelinePresent = input.broadcast.timeline.length > 0;
  const canonicalArtifactPresent = input.broadcast.artifacts.some((artifact) => artifact.canonical && artifact.name === "output.mp4");
  const requiredProofsVerified =
    input.broadcast.proofs.some((proof) => proof.type === requiredPrimaryProof && proof.status === "verified") &&
    input.broadcast.proofs.some((proof) => proof.type === "canonical-artifact" && proof.status === "verified");
  const scoreboardPublished = input.broadcast.scoreboardReady;
  const controllerExecutorReports = summarizeControllerExecutorReports(input.broadcast.timeline);
  const latestExecutorReport = controllerExecutorReports.at(-1);
  const verdict: BroadcastEvidenceBundle["integrity"]["verdict"] =
    input.broadcast.stream.status === "failed"
      ? "failed"
      : scoreboardPublished && canonicalArtifactPresent && requiredProofsVerified
        ? "scoreboard-ready"
        : canonicalArtifactPresent && requiredProofsVerified
          ? "proof-ready"
          : input.broadcast.stream.status === "live"
            ? "live"
            : "incomplete";
  const checklist: EvidenceChecklistItem[] = [
    {
      id: "stream-playback",
      label: "Broadcast playback URL is available",
      status: streamPlayable ? "pass" : "fail"
    },
    {
      id: "timeline-present",
      label: "Broadcast has runtime timeline events",
      status: timelinePresent ? "pass" : "fail"
    },
    {
      id: "canonical-artifact",
      label: "Broadcast run has canonical output.mp4 artifact",
      status: canonicalArtifactPresent ? "pass" : "fail"
    },
    {
      id: "proofs-verified",
      label: "Broadcast run has verified primary and artifact proofs",
      status: requiredProofsVerified ? "pass" : "fail"
    },
    {
      id: "scoreboard-row",
      label: "Broadcast run is published on the scoreboard",
      status: scoreboardPublished ? "pass" : "fail"
    },
    ...(
      latestExecutorReport
        ? [
            {
              id: "controller-executor-report",
              label: "Broadcast timeline includes a controller executor report without forbidden side effects",
              status: latestExecutorReport.sideEffects === false ? "pass" as const : "fail" as const
            }
          ]
        : []
    )
  ];

  return {
    schemaVersion: "steambench.broadcast-evidence-bundle.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    streamId: input.broadcast.stream.id,
    runId: input.broadcast.run.id,
    broadcast: input.broadcast,
    integrity: {
      verdict,
      streamPlayable,
      timelinePresent,
      canonicalArtifactPresent,
      requiredProofsVerified,
      scoreboardPublished,
      eventCount: input.broadcast.timeline.length,
      artifactCount: input.broadcast.artifacts.length,
      proofCount: input.broadcast.proofs.length,
      executorReportCount: controllerExecutorReports.length,
      latestExecutorReport,
      highImportanceEvents: input.broadcast.timeline.filter((event) => event.importance === "high").length,
      viewerCount: input.broadcast.stream.viewerCount,
      checklist
    }
  };
}
