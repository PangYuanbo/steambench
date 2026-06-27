import type { ExecutionManifest } from "./execution-manifest";
import type { RunAuditReport } from "./run-audit";

export type EvidenceChecklistItem = {
  id: string;
  label: string;
  status: "pass" | "fail";
};

export type RunEvidenceBundle = {
  schemaVersion: "steambench.evidence-bundle.v1";
  generatedAt: string;
  runId: string;
  taskId: string;
  manifest: ExecutionManifest;
  audit: RunAuditReport;
  integrity: {
    verdict: RunAuditReport["verdict"];
    canonicalArtifactName: "output.mp4";
    canonicalArtifactPresent: boolean;
    requiredProofsVerified: boolean;
    scoreboardPublished: boolean;
    eventCount: number;
    artifactCount: number;
    proofCount: number;
    streamCount: number;
    executorReportCount: number;
    latestExecutorReport?: RunAuditReport["controllerExecutorReports"][number];
    checklist: EvidenceChecklistItem[];
  };
};

export function buildRunEvidenceBundle(input: {
  manifest: ExecutionManifest;
  audit: RunAuditReport;
  generatedAt?: string;
}): RunEvidenceBundle {
  const canonicalArtifactPresent = input.audit.canonicalArtifact?.name === "output.mp4";
  const requiredProofsVerified = input.audit.requiredProofs.every((proof) => proof.verified);
  const scoreboardPublished = Boolean(input.audit.scoreboardRow);
  const stage2PreservesOutput = input.manifest.stage2Contract.preserveExistingOutputs === true;
  const canonicalContractAligned =
    input.manifest.artifactContract.name === "output.mp4" &&
    input.manifest.artifactContract.path === "output/output.mp4";
  const latestExecutorReport = input.audit.controllerExecutorReports.at(-1);
  const executorChecklist: EvidenceChecklistItem[] = latestExecutorReport
    ? [
        {
          id: "controller-executor-report",
          label: "Controller executor report is persisted without forbidden host-input side effects",
          status: latestExecutorReport.sideEffects === false ? "pass" : "fail"
        }
      ]
    : [];

  return {
    schemaVersion: "steambench.evidence-bundle.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    runId: input.audit.run.id,
    taskId: input.audit.task.id,
    manifest: input.manifest,
    audit: input.audit,
    integrity: {
      verdict: input.audit.verdict,
      canonicalArtifactName: "output.mp4",
      canonicalArtifactPresent,
      requiredProofsVerified,
      scoreboardPublished,
      eventCount: input.audit.evidenceCounts.events,
      artifactCount: input.audit.evidenceCounts.artifacts,
      proofCount: input.audit.evidenceCounts.proofs,
      streamCount: input.audit.evidenceCounts.streams,
      executorReportCount: input.audit.controllerExecutorReports.length,
      latestExecutorReport,
      checklist: [
        {
          id: "canonical-artifact",
          label: "Canonical output.mp4 artifact is attached",
          status: canonicalArtifactPresent ? "pass" : "fail"
        },
        {
          id: "proofs-verified",
          label: "Required proof records are verified",
          status: requiredProofsVerified ? "pass" : "fail"
        },
        {
          id: "scoreboard-row",
          label: "Scoreboard row is published",
          status: scoreboardPublished ? "pass" : "fail"
        },
        {
          id: "manifest-contract",
          label: "Manifest artifact contract targets output/output.mp4",
          status: canonicalContractAligned ? "pass" : "fail"
        },
        {
          id: "stage2-start-contract",
          label: "Stage 2 start contract preserves existing outputs",
          status: stage2PreservesOutput ? "pass" : "fail"
        },
        ...executorChecklist
      ]
    }
  };
}
