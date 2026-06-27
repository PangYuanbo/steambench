import type { SuiteRaceAuditReport } from "./suite-race-audit";

export type SuiteRaceEvidenceChecklistItem = {
  id: string;
  label: string;
  status: "pass" | "fail";
};

export type SuiteRaceEvidenceBundle = {
  schemaVersion: "steambench.suite-race-evidence-bundle.v1";
  generatedAt: string;
  raceId: string;
  suiteId: string;
  audit: SuiteRaceAuditReport;
  integrity: {
    verdict: SuiteRaceAuditReport["verdict"];
    aggregateScored: boolean;
    allChildMatchesPresent: boolean;
    allChildMatchesScored: boolean;
    allChildRunsScoreboardReady: boolean;
    missingEvidenceCount: number;
    matchCount: number;
    runCount: number;
    eventCount: number;
    artifactCount: number;
    proofCount: number;
    streamCount: number;
    checklist: SuiteRaceEvidenceChecklistItem[];
  };
};

export function buildSuiteRaceEvidenceBundle(input: {
  audit: SuiteRaceAuditReport;
  generatedAt?: string;
}): SuiteRaceEvidenceBundle {
  const aggregateScored =
    input.audit.race.status === "scored" &&
    input.audit.aggregate.humanScore !== undefined &&
    input.audit.aggregate.agentScore !== undefined &&
    input.audit.aggregate.winner !== undefined;
  const allChildMatchesPresent = input.audit.matches.length === input.audit.race.matchIds.length &&
    input.audit.matches.every((entry) => entry.match !== undefined);
  const allChildMatchesScored = input.audit.evidenceCounts.scoredMatches === input.audit.evidenceCounts.matches &&
    input.audit.evidenceCounts.matches === input.audit.race.matchIds.length;
  const allChildRunsScoreboardReady = input.audit.matches.every((entry) =>
    entry.status === "scoreboard-ready" &&
    entry.humanAudit?.verdict === "scoreboard-ready" &&
    entry.agentAudit?.verdict === "scoreboard-ready"
  );

  return {
    schemaVersion: "steambench.suite-race-evidence-bundle.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    raceId: input.audit.race.id,
    suiteId: input.audit.race.suiteId,
    audit: input.audit,
    integrity: {
      verdict: input.audit.verdict,
      aggregateScored,
      allChildMatchesPresent,
      allChildMatchesScored,
      allChildRunsScoreboardReady,
      missingEvidenceCount: input.audit.missing.length,
      matchCount: input.audit.evidenceCounts.matches,
      runCount: input.audit.evidenceCounts.runs,
      eventCount: input.audit.evidenceCounts.events,
      artifactCount: input.audit.evidenceCounts.artifacts,
      proofCount: input.audit.evidenceCounts.proofs,
      streamCount: input.audit.evidenceCounts.streams,
      checklist: [
        {
          id: "aggregate-scored",
          label: "Suite race aggregate result is scored",
          status: aggregateScored ? "pass" : "fail"
        },
        {
          id: "child-matches-present",
          label: "Every suite task has a child match",
          status: allChildMatchesPresent ? "pass" : "fail"
        },
        {
          id: "child-matches-scored",
          label: "Every child match is scored",
          status: allChildMatchesScored ? "pass" : "fail"
        },
        {
          id: "child-run-audits",
          label: "Every child human and agent run is scoreboard-ready",
          status: allChildRunsScoreboardReady ? "pass" : "fail"
        },
        {
          id: "missing-evidence",
          label: "Suite race audit has no missing evidence",
          status: input.audit.missing.length === 0 ? "pass" : "fail"
        }
      ]
    }
  };
}
