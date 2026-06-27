import { createHash } from "node:crypto";
import type { BenchmarkTask } from "../benchmark/types";
import type { AgentCampaignEvidenceBundle } from "./agent-campaign-evidence-bundle";
import type { BroadcastEvidenceBundle } from "./broadcast-evidence-bundle";
import type { CompetitionEventEvidenceBundle } from "./competition-event-evidence-bundle";
import type { RunEvidenceBundle } from "./evidence-bundle";
import type { GameCompetitionEvidenceBundle } from "./game-competition-evidence-bundle";
import type { GameCoverageRunEvidenceBundle } from "./game-coverage-run-evidence-bundle";
import type { HumanAgentComparisonEvidenceBundle } from "./human-agent-comparison-evidence-bundle";
import type { RunAuditReport } from "./run-audit";
import type { SuiteRaceEvidenceBundle } from "./suite-race-evidence-bundle";
import type { AgentProfile, BenchmarkChallenge, BenchmarkMatch, BenchmarkSuiteRace, UserAccount } from "./store";

export type ResultCertificate = {
  schemaVersion: "steambench.result-certificate.v1";
  generatedAt: string;
  kind: "run" | "match" | "challenge" | "suite-race" | "agent-campaign" | "human-agent-comparison" | "competition-event" | "broadcast" | "game-competition" | "game-coverage-run";
  id: string;
  title: string;
  status: string;
  verdict: "scoreboard-ready" | "proof-missing" | "match-incomplete" | "blocked" | "in-progress" | "failed";
  canonicalArtifactName: "output.mp4";
  participants: Array<{
    side: "human" | "agent" | "competitor";
    id: string;
    handle: string;
    displayName: string;
    score?: number;
  }>;
  tasks: Array<{
    id: string;
    appid: number;
    gameName: string;
    title: string;
    track: BenchmarkTask["track"];
    level: number;
    score: number;
  }>;
  result: {
    winner?: "human" | "agent" | "tie";
    margin?: number;
    score?: number;
    humanScore?: number;
    agentScore?: number;
    scoreboardRows: number;
  };
  evidence: {
    eventCount: number;
    artifactCount: number;
    proofCount: number;
    streamCount: number;
    executorReportCount?: number;
    bundleReady: boolean;
  };
  links: Record<string, string>;
  integrity: {
    readyForPublicShare: boolean;
    checklist: Array<{
      id: string;
      label: string;
      status: "pass" | "fail";
    }>;
  };
  verification: {
    method: "sha256";
    fingerprint: string;
    signedFields: string[];
  };
};

export type ResultCertificateVerificationResult = {
  schemaVersion: "steambench.result-certificate-verification.v1";
  valid: boolean;
  method: "sha256";
  expectedFingerprint?: string;
  actualFingerprint?: string;
  signedFields: string[];
  errors: string[];
  certificate?: {
    schemaVersion?: string;
    kind?: string;
    id?: string;
    status?: string;
    verdict?: string;
    readyForPublicShare?: boolean;
  };
};

const certificateSignedFields = [
  "schemaVersion",
  "kind",
  "id",
  "title",
  "status",
  "verdict",
  "canonicalArtifactName",
  "participants",
  "tasks",
  "result",
  "evidence",
  "links",
  "integrity"
];

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function withCertificateVerification(certificate: Omit<ResultCertificate, "verification">): ResultCertificate {
  const signedPayload = Object.fromEntries(
    certificateSignedFields.map((field) => [field, certificate[field as keyof typeof certificate]])
  );
  return {
    ...certificate,
    verification: {
      method: "sha256",
      fingerprint: createHash("sha256").update(stableJson(signedPayload)).digest("hex"),
      signedFields: certificateSignedFields
    }
  };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function signedFieldsMatch(fields: unknown): boolean {
  return Array.isArray(fields) &&
    fields.length === certificateSignedFields.length &&
    fields.every((field, index) => field === certificateSignedFields[index]);
}

export function verifyResultCertificate(certificateInput: unknown): ResultCertificateVerificationResult {
  const certificate = recordValue(certificateInput);
  const verification = recordValue(certificate?.verification);
  const expectedFingerprint = typeof verification?.fingerprint === "string" ? verification.fingerprint : undefined;
  const method = verification?.method;
  const errors: string[] = [];

  if (!certificate) errors.push("invalid_certificate");
  if (certificate?.schemaVersion !== "steambench.result-certificate.v1") errors.push("invalid_certificate_schema");
  if (method !== "sha256") errors.push("invalid_verification_method");
  if (!expectedFingerprint || !/^[a-f0-9]{64}$/.test(expectedFingerprint)) errors.push("invalid_expected_fingerprint");
  if (!signedFieldsMatch(verification?.signedFields)) errors.push("invalid_signed_fields");

  const missingSignedFields = certificateSignedFields.filter((field) => certificate && !(field in certificate));
  if (missingSignedFields.length > 0) {
    errors.push(`missing_signed_fields:${missingSignedFields.join(",")}`);
  }

  let actualFingerprint;
  if (certificate) {
    const signedPayload = Object.fromEntries(
      certificateSignedFields.map((field) => [field, certificate[field]])
    );
    actualFingerprint = createHash("sha256").update(stableJson(signedPayload)).digest("hex");
    if (expectedFingerprint && actualFingerprint !== expectedFingerprint) {
      errors.push("fingerprint_mismatch");
    }
  }

  return {
    schemaVersion: "steambench.result-certificate-verification.v1",
    valid: errors.length === 0,
    method: "sha256",
    expectedFingerprint,
    actualFingerprint,
    signedFields: certificateSignedFields,
    errors,
    certificate: certificate
      ? {
          schemaVersion: typeof certificate.schemaVersion === "string" ? certificate.schemaVersion : undefined,
          kind: typeof certificate.kind === "string" ? certificate.kind : undefined,
          id: typeof certificate.id === "string" ? certificate.id : undefined,
          status: typeof certificate.status === "string" ? certificate.status : undefined,
          verdict: typeof certificate.verdict === "string" ? certificate.verdict : undefined,
          readyForPublicShare: typeof recordValue(certificate.integrity)?.readyForPublicShare === "boolean"
            ? recordValue(certificate.integrity)?.readyForPublicShare as boolean
            : undefined
        }
      : undefined
  };
}

function taskSummary(task: BenchmarkTask): ResultCertificate["tasks"][number] {
  return {
    id: task.id,
    appid: task.appid,
    gameName: task.gameName,
    title: task.title,
    track: task.track,
    level: task.level,
    score: task.score
  };
}

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function uniqueTasks(tasks: BenchmarkTask[]): ResultCertificate["tasks"] {
  const seen = new Set<string>();
  return tasks.flatMap((task) => {
    if (seen.has(task.id)) return [];
    seen.add(task.id);
    return [taskSummary(task)];
  });
}

export function buildRunResultCertificate(input: {
  bundle: RunEvidenceBundle;
  baseUrl: string;
  generatedAt?: string;
}): ResultCertificate {
  const run = input.bundle.audit.run;
  const task = input.bundle.audit.task;
  const checklist = [
    ...input.bundle.integrity.checklist,
    {
      id: "run-scored",
      label: "Run has a final score",
      status: run.status === "scored" && run.score !== undefined ? "pass" as const : "fail" as const
    }
  ];
  const readyForPublicShare = checklist.every((item) => item.status === "pass");

  return withCertificateVerification({
    schemaVersion: "steambench.result-certificate.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    kind: "run",
    id: run.id,
    title: `${run.competitor} on ${task.title}`,
    status: run.status,
    verdict: input.bundle.integrity.verdict,
    canonicalArtifactName: "output.mp4",
    participants: [
      {
        side: "competitor",
        id: run.competitor,
        handle: run.competitor,
        displayName: run.competitor,
        score: run.score
      }
    ],
    tasks: [taskSummary(task)],
    result: {
      score: run.score,
      scoreboardRows: input.bundle.audit.scoreboardRow ? 1 : 0
    },
    evidence: {
      eventCount: input.bundle.integrity.eventCount,
      artifactCount: input.bundle.integrity.artifactCount,
      proofCount: input.bundle.integrity.proofCount,
      streamCount: input.bundle.integrity.streamCount,
      executorReportCount: input.bundle.integrity.executorReportCount,
      bundleReady: input.bundle.integrity.verdict === "scoreboard-ready"
    },
    links: {
      run: apiUrl(input.baseUrl, `/api/runs/${run.id}`),
      audit: apiUrl(input.baseUrl, `/api/runs/${run.id}/audit`),
      evidenceBundle: apiUrl(input.baseUrl, `/api/runs/${run.id}/evidence-bundle`)
    },
    integrity: {
      readyForPublicShare,
      checklist
    }
  });
}

export function buildChallengeResultCertificate(input: {
  challenge: BenchmarkChallenge;
  task: BenchmarkTask;
  human?: UserAccount;
  agent?: AgentProfile;
  match?: BenchmarkMatch;
  humanAudit?: RunAuditReport;
  agentAudit?: RunAuditReport;
  baseUrl: string;
  generatedAt?: string;
}): ResultCertificate {
  const humanScore = input.humanAudit?.run.score;
  const agentScore = input.agentAudit?.run.score;
  const checklist = [
    {
      id: "challenge-accepted",
      label: "Challenge has a match contract",
      status: input.challenge.matchId && input.match ? "pass" as const : "fail" as const
    },
    {
      id: "match-scored",
      label: "Challenge match is scored",
      status: input.match?.status === "scored" ? "pass" as const : "fail" as const
    },
    {
      id: "human-run-ready",
      label: "Human run audit is scoreboard-ready",
      status: input.humanAudit?.verdict === "scoreboard-ready" ? "pass" as const : "fail" as const
    },
    {
      id: "agent-run-ready",
      label: "Agent run audit is scoreboard-ready",
      status: input.agentAudit?.verdict === "scoreboard-ready" ? "pass" as const : "fail" as const
    }
  ];
  const readyForPublicShare = checklist.every((item) => item.status === "pass");
  const eventCount = (input.humanAudit?.evidenceCounts.events ?? 0) + (input.agentAudit?.evidenceCounts.events ?? 0);
  const artifactCount = (input.humanAudit?.evidenceCounts.artifacts ?? 0) + (input.agentAudit?.evidenceCounts.artifacts ?? 0);
  const proofCount = (input.humanAudit?.evidenceCounts.proofs ?? 0) + (input.agentAudit?.evidenceCounts.proofs ?? 0);
  const streamCount = (input.humanAudit?.evidenceCounts.streams ?? 0) + (input.agentAudit?.evidenceCounts.streams ?? 0);

  return withCertificateVerification({
    schemaVersion: "steambench.result-certificate.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    kind: "challenge",
    id: input.challenge.id,
    title: `${input.human?.displayName ?? input.challenge.humanUserId} vs ${input.agent?.displayName ?? input.challenge.agentId} on ${input.task.title}`,
    status: input.challenge.status,
    verdict: readyForPublicShare ? "scoreboard-ready" : input.match?.status === "failed" ? "failed" : input.challenge.status === "blocked" ? "blocked" : "match-incomplete",
    canonicalArtifactName: "output.mp4",
    participants: [
      {
        side: "human",
        id: input.human?.id ?? input.challenge.humanUserId,
        handle: input.human?.handle ?? input.challenge.humanUserId,
        displayName: input.human?.displayName ?? input.challenge.humanUserId,
        score: humanScore
      },
      {
        side: "agent",
        id: input.agent?.id ?? input.challenge.agentId,
        handle: input.agent?.handle ?? input.challenge.agentId,
        displayName: input.agent?.displayName ?? input.challenge.agentId,
        score: agentScore
      }
    ],
    tasks: [taskSummary(input.task)],
    result: {
      winner: input.match?.winner,
      margin: input.match?.margin,
      humanScore,
      agentScore,
      scoreboardRows: [input.humanAudit?.scoreboardRow, input.agentAudit?.scoreboardRow].filter(Boolean).length
    },
    evidence: {
      eventCount,
      artifactCount,
      proofCount,
      streamCount,
      bundleReady: readyForPublicShare
    },
    links: {
      challenge: apiUrl(input.baseUrl, `/api/challenges/${input.challenge.id}`),
      evidenceBundle: apiUrl(input.baseUrl, `/api/challenges/${input.challenge.id}/evidence-bundle`),
      resultCertificate: apiUrl(input.baseUrl, `/api/challenges/${input.challenge.id}/result-certificate`),
      ...(input.match ? { match: apiUrl(input.baseUrl, `/api/matches/${input.match.id}`) } : {})
    },
    integrity: {
      readyForPublicShare,
      checklist
    }
  });
}

export function buildMatchResultCertificate(input: {
  match: BenchmarkMatch;
  task: BenchmarkTask;
  human?: UserAccount;
  agent?: AgentProfile;
  humanAudit?: RunAuditReport;
  agentAudit?: RunAuditReport;
  baseUrl: string;
  generatedAt?: string;
}): ResultCertificate {
  const humanScore = input.humanAudit?.run.score;
  const agentScore = input.agentAudit?.run.score;
  const checklist = [
    {
      id: "match-scored",
      label: "Match is scored",
      status: input.match.status === "scored" ? "pass" as const : "fail" as const
    },
    {
      id: "human-run-ready",
      label: "Human run audit is scoreboard-ready",
      status: input.humanAudit?.verdict === "scoreboard-ready" ? "pass" as const : "fail" as const
    },
    {
      id: "agent-run-ready",
      label: "Agent run audit is scoreboard-ready",
      status: input.agentAudit?.verdict === "scoreboard-ready" ? "pass" as const : "fail" as const
    }
  ];
  const readyForPublicShare = checklist.every((item) => item.status === "pass");
  const eventCount = (input.humanAudit?.evidenceCounts.events ?? 0) + (input.agentAudit?.evidenceCounts.events ?? 0);
  const artifactCount = (input.humanAudit?.evidenceCounts.artifacts ?? 0) + (input.agentAudit?.evidenceCounts.artifacts ?? 0);
  const proofCount = (input.humanAudit?.evidenceCounts.proofs ?? 0) + (input.agentAudit?.evidenceCounts.proofs ?? 0);
  const streamCount = (input.humanAudit?.evidenceCounts.streams ?? 0) + (input.agentAudit?.evidenceCounts.streams ?? 0);

  return withCertificateVerification({
    schemaVersion: "steambench.result-certificate.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    kind: "match",
    id: input.match.id,
    title: `${input.human?.displayName ?? input.match.humanUserId} vs ${input.agent?.displayName ?? input.match.agentId} on ${input.task.title}`,
    status: input.match.status,
    verdict: readyForPublicShare ? "scoreboard-ready" : input.match.status === "failed" ? "failed" : input.match.status === "canceled" ? "blocked" : "match-incomplete",
    canonicalArtifactName: "output.mp4",
    participants: [
      {
        side: "human",
        id: input.human?.id ?? input.match.humanUserId,
        handle: input.human?.handle ?? input.match.humanUserId,
        displayName: input.human?.displayName ?? input.match.humanUserId,
        score: humanScore
      },
      {
        side: "agent",
        id: input.agent?.id ?? input.match.agentId,
        handle: input.agent?.handle ?? input.match.agentId,
        displayName: input.agent?.displayName ?? input.match.agentId,
        score: agentScore
      }
    ],
    tasks: [taskSummary(input.task)],
    result: {
      winner: input.match.winner,
      margin: input.match.margin,
      humanScore,
      agentScore,
      scoreboardRows: [input.humanAudit?.scoreboardRow, input.agentAudit?.scoreboardRow].filter(Boolean).length
    },
    evidence: {
      eventCount,
      artifactCount,
      proofCount,
      streamCount,
      bundleReady: readyForPublicShare
    },
    links: {
      match: apiUrl(input.baseUrl, `/api/matches/${input.match.id}`),
      resultCertificate: apiUrl(input.baseUrl, `/api/matches/${input.match.id}/result-certificate`)
    },
    integrity: {
      readyForPublicShare,
      checklist
    }
  });
}

export function buildSuiteRaceResultCertificate(input: {
  bundle: SuiteRaceEvidenceBundle;
  baseUrl: string;
  generatedAt?: string;
}): ResultCertificate {
  const race: BenchmarkSuiteRace = input.bundle.audit.race;
  const checklist = input.bundle.integrity.checklist;
  const readyForPublicShare = checklist.every((item) => item.status === "pass");
  const tasks = input.bundle.audit.matches.flatMap((entry) => entry.task ? [taskSummary(entry.task)] : []);

  return withCertificateVerification({
    schemaVersion: "steambench.result-certificate.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    kind: "suite-race",
    id: race.id,
    title: race.title,
    status: race.status,
    verdict: input.bundle.integrity.verdict,
    canonicalArtifactName: "output.mp4",
    participants: [
      {
        side: "human",
        id: race.humanUserId,
        handle: race.humanUserId,
        displayName: race.humanUserId,
        score: race.humanScore
      },
      {
        side: "agent",
        id: race.agentId,
        handle: race.agentId,
        displayName: race.agentId,
        score: race.agentScore
      }
    ],
    tasks,
    result: {
      winner: race.winner,
      margin: race.margin,
      humanScore: race.humanScore,
      agentScore: race.agentScore,
      scoreboardRows: input.bundle.audit.matches.filter((entry) => entry.humanAudit?.scoreboardRow).length +
        input.bundle.audit.matches.filter((entry) => entry.agentAudit?.scoreboardRow).length
    },
    evidence: {
      eventCount: input.bundle.integrity.eventCount,
      artifactCount: input.bundle.integrity.artifactCount,
      proofCount: input.bundle.integrity.proofCount,
      streamCount: input.bundle.integrity.streamCount,
      bundleReady: readyForPublicShare
    },
    links: {
      suiteRace: apiUrl(input.baseUrl, `/api/suite-races/${race.id}`),
      audit: apiUrl(input.baseUrl, `/api/suite-races/${race.id}/audit`),
      evidenceBundle: apiUrl(input.baseUrl, `/api/suite-races/${race.id}/evidence-bundle`)
    },
    integrity: {
      readyForPublicShare,
      checklist
    }
  });
}

export function buildAgentCampaignResultCertificate(input: {
  bundle: AgentCampaignEvidenceBundle;
  baseUrl: string;
  generatedAt?: string;
}): ResultCertificate {
  const checklist = input.bundle.integrity.checklist;
  const readyForPublicShare = checklist.every((item) => item.status === "pass");
  const report = input.bundle.report;
  const tasks = report.items.flatMap((entry) => entry.task ? [taskSummary(entry.task)] : []);

  return withCertificateVerification({
    schemaVersion: "steambench.result-certificate.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    kind: "agent-campaign",
    id: input.bundle.campaignId,
    title: `${report.agent?.displayName ?? input.bundle.agentId} campaign: ${report.totals.scoreboardRows}/${report.totals.tasks} tasks`,
    status: report.status,
    verdict: input.bundle.integrity.verdict === "scoreboard-ready"
      ? "scoreboard-ready"
      : input.bundle.integrity.verdict === "needs-attention"
        ? "failed"
        : input.bundle.integrity.verdict === "running"
          ? "in-progress"
          : "in-progress",
    canonicalArtifactName: "output.mp4",
    participants: [
      {
        side: "agent",
        id: report.agent?.id ?? input.bundle.agentId,
        handle: report.agent?.handle ?? input.bundle.agentId,
        displayName: report.agent?.displayName ?? input.bundle.agentId,
        score: report.totals.totalScore
      }
    ],
    tasks,
    result: {
      score: report.totals.totalScore,
      scoreboardRows: input.bundle.integrity.scoreboardRows
    },
    evidence: {
      eventCount: input.bundle.integrity.eventCount,
      artifactCount: input.bundle.integrity.artifactCount,
      proofCount: input.bundle.integrity.proofCount,
      streamCount: input.bundle.integrity.streamCount,
      bundleReady: readyForPublicShare
    },
    links: {
      campaign: apiUrl(input.baseUrl, `/api/campaigns/${input.bundle.campaignId}`),
      evidenceBundle: apiUrl(input.baseUrl, `/api/campaigns/${input.bundle.campaignId}/evidence-bundle`),
      resultCertificate: apiUrl(input.baseUrl, `/api/campaigns/${input.bundle.campaignId}/result-certificate`),
      standings: apiUrl(input.baseUrl, "/api/campaign-standings")
    },
    integrity: {
      readyForPublicShare,
      checklist
    }
  });
}

export function buildHumanAgentComparisonResultCertificate(input: {
  bundle: HumanAgentComparisonEvidenceBundle;
  baseUrl: string;
  generatedAt?: string;
}): ResultCertificate {
  const checklist = input.bundle.integrity.checklist;
  const readyForPublicShare = checklist.every((item) => item.status === "pass");
  const comparison = input.bundle.comparison;
  const tasks = comparison.items.map((entry) => taskSummary(entry.task));
  const verdict: ResultCertificate["verdict"] = readyForPublicShare
    ? "scoreboard-ready"
    : comparison.status === "complete"
      ? "proof-missing"
      : "match-incomplete";
  const query = `humanUserId=${encodeURIComponent(comparison.human.id)}&campaignId=${encodeURIComponent(comparison.campaign.id)}`;

  return withCertificateVerification({
    schemaVersion: "steambench.result-certificate.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    kind: "human-agent-comparison",
    id: input.bundle.comparisonId,
    title: `${comparison.human.displayName} vs ${comparison.agent?.displayName ?? comparison.campaign.agentId}: ${comparison.totals.completeTasks}/${comparison.totals.tasks} tasks`,
    status: comparison.status,
    verdict,
    canonicalArtifactName: "output.mp4",
    participants: [
      {
        side: "human",
        id: comparison.human.id,
        handle: comparison.human.handle,
        displayName: comparison.human.displayName,
        score: comparison.totals.humanScore
      },
      {
        side: "agent",
        id: comparison.agent?.id ?? comparison.campaign.agentId,
        handle: comparison.agent?.handle ?? comparison.campaign.agentId,
        displayName: comparison.agent?.displayName ?? comparison.campaign.agentId,
        score: comparison.totals.agentScore
      }
    ],
    tasks,
    result: {
      winner: comparison.winner,
      margin: comparison.totals.margin,
      humanScore: comparison.totals.humanScore,
      agentScore: comparison.totals.agentScore,
      scoreboardRows: input.bundle.integrity.scoreboardRows
    },
    evidence: {
      eventCount: input.bundle.integrity.eventCount,
      artifactCount: input.bundle.integrity.artifactCount,
      proofCount: input.bundle.integrity.proofCount,
      streamCount: input.bundle.integrity.streamCount,
      bundleReady: readyForPublicShare
    },
    links: {
      comparison: apiUrl(input.baseUrl, `/api/comparisons/human-agent?${query}`),
      evidenceBundle: apiUrl(input.baseUrl, `/api/comparisons/human-agent/evidence-bundle?${query}`),
      resultCertificate: apiUrl(input.baseUrl, `/api/comparisons/human-agent/result-certificate?${query}`),
      campaignCertificate: apiUrl(input.baseUrl, `/api/campaigns/${comparison.campaign.id}/result-certificate`),
      humanProofPlan: apiUrl(input.baseUrl, `/api/users/${comparison.human.id}/steam-proof-plan`)
    },
    integrity: {
      readyForPublicShare,
      checklist
    }
  });
}

export function buildCompetitionEventResultCertificate(input: {
  bundle: CompetitionEventEvidenceBundle;
  baseUrl: string;
  generatedAt?: string;
}): ResultCertificate {
  const readySuiteBundles = input.bundle.suiteRaces.filter((entry) => entry.bundle?.integrity.verdict === "scoreboard-ready").length;
  const readyCampaignComparisons = input.bundle.integrity.campaignComparisonReadyCount;
  const hasReadyEvidence = readySuiteBundles > 0 || readyCampaignComparisons > 0;
  const event = input.bundle.event;
  const humanScore = event.score.humanScore + event.suiteRaces.humanScore;
  const agentScore = event.score.agentScore + event.suiteRaces.agentScore;
  const participants = input.bundle.registrations.flatMap((entry): ResultCertificate["participants"] => {
    if (entry.registration.status !== "registered") return [];
    if (entry.registration.participantType === "human") {
      return [{
        side: "human",
        id: entry.human?.id ?? entry.registration.participantId,
        handle: entry.human?.handle ?? entry.registration.participantId,
        displayName: entry.human?.displayName ?? entry.registration.participantId
      }];
    }
    return [{
      side: "agent",
      id: entry.agent?.id ?? entry.registration.participantId,
      handle: entry.agent?.handle ?? entry.registration.participantId,
      displayName: entry.agent?.displayName ?? entry.registration.participantId
    }];
  });
  const suiteTasks = input.bundle.suiteRaces.flatMap((entry) =>
    entry.bundle?.audit.matches.flatMap((match) => match.task ? [match.task] : []) ?? []
  );
  const comparisonTasks = input.bundle.campaignComparisons.flatMap((entry) =>
    entry.bundle?.comparison.items.map((item) => item.task) ?? []
  );
  const checklist = [
    {
      id: "event-active",
      label: "Event has scored rows, suite races, or campaign comparisons",
      status: event.status === "active" ? "pass" as const : "fail" as const
    },
    {
      id: "registered-participants",
      label: "Event has registered public participants",
      status: participants.length > 0 ? "pass" as const : "fail" as const
    },
    {
      id: "ready-evidence-surface",
      label: "Event has at least one scoreboard-ready suite race or campaign comparison",
      status: hasReadyEvidence ? "pass" as const : "fail" as const
    },
    {
      id: "evidence-bundle-linked",
      label: "Event evidence bundle is linked from the certificate",
      status: "pass" as const
    }
  ];
  const readyForPublicShare = checklist.every((item) => item.status === "pass");
  const winner: ResultCertificate["result"]["winner"] =
    humanScore > agentScore ? "human" : agentScore > humanScore ? "agent" : humanScore === agentScore && humanScore > 0 ? "tie" : undefined;

  return withCertificateVerification({
    schemaVersion: "steambench.result-certificate.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    kind: "competition-event",
    id: event.id,
    title: event.title,
    status: event.status,
    verdict: readyForPublicShare
      ? "scoreboard-ready"
      : event.status === "empty"
        ? "in-progress"
        : "proof-missing",
    canonicalArtifactName: "output.mp4",
    participants,
    tasks: uniqueTasks([...suiteTasks, ...comparisonTasks]),
    result: {
      winner,
      margin: Math.abs(humanScore - agentScore),
      humanScore,
      agentScore,
      scoreboardRows: event.window.rowCount + input.bundle.integrity.scoredRaces * 2 + input.bundle.campaignComparisons.reduce(
        (total, entry) => total + (entry.bundle?.integrity.scoreboardRows ?? 0),
        0
      )
    },
    evidence: {
      eventCount: input.bundle.campaignComparisons.reduce((total, entry) => total + (entry.bundle?.integrity.eventCount ?? 0), 0),
      artifactCount: input.bundle.campaignComparisons.reduce((total, entry) => total + (entry.bundle?.integrity.artifactCount ?? 0), 0),
      proofCount: input.bundle.campaignComparisons.reduce((total, entry) => total + (entry.bundle?.integrity.proofCount ?? 0), 0),
      streamCount: input.bundle.campaignComparisons.reduce((total, entry) => total + (entry.bundle?.integrity.streamCount ?? 0), 0),
      bundleReady: readyForPublicShare
    },
    links: {
      event: apiUrl(input.baseUrl, `/api/competition-events/${event.scope}`),
      evidenceBundle: apiUrl(input.baseUrl, `/api/competition-events/${event.scope}/evidence-bundle`),
      resultCertificate: apiUrl(input.baseUrl, `/api/competition-events/${event.scope}/result-certificate`)
    },
    integrity: {
      readyForPublicShare,
      checklist
    }
  });
}

export function buildBroadcastResultCertificate(input: {
  bundle: BroadcastEvidenceBundle;
  baseUrl: string;
  generatedAt?: string;
}): ResultCertificate {
  const checklist = input.bundle.integrity.checklist;
  const readyForPublicShare = checklist.every((item) => item.status === "pass");
  const broadcast = input.bundle.broadcast;
  const verdict: ResultCertificate["verdict"] =
    readyForPublicShare
      ? "scoreboard-ready"
      : input.bundle.integrity.verdict === "failed"
        ? "failed"
        : input.bundle.integrity.verdict === "live"
          ? "in-progress"
          : "proof-missing";

  return withCertificateVerification({
    schemaVersion: "steambench.result-certificate.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    kind: "broadcast",
    id: input.bundle.streamId,
    title: broadcast.stream.title,
    status: broadcast.stream.status,
    verdict,
    canonicalArtifactName: "output.mp4",
    participants: [
      {
        side: broadcast.run.competitorType === "human" ? "human" : "agent",
        id: broadcast.run.competitor,
        handle: broadcast.run.competitor,
        displayName: broadcast.run.competitor,
        score: broadcast.run.score
      }
    ],
    tasks: [taskSummary(broadcast.task)],
    result: {
      score: broadcast.run.score,
      scoreboardRows: broadcast.scoreboardReady ? 1 : 0
    },
    evidence: {
      eventCount: input.bundle.integrity.eventCount,
      artifactCount: input.bundle.integrity.artifactCount,
      proofCount: input.bundle.integrity.proofCount,
      streamCount: 1,
      executorReportCount: input.bundle.integrity.executorReportCount,
      bundleReady: readyForPublicShare
    },
    links: {
      broadcast: apiUrl(input.baseUrl, `/api/broadcasts/${input.bundle.streamId}`),
      playback: broadcast.stream.playbackUrl,
      evidenceBundle: apiUrl(input.baseUrl, `/api/broadcasts/${input.bundle.streamId}/evidence-bundle`),
      resultCertificate: apiUrl(input.baseUrl, `/api/broadcasts/${input.bundle.streamId}/result-certificate`),
      runCertificate: apiUrl(input.baseUrl, `/api/runs/${broadcast.run.id}/result-certificate`)
    },
    integrity: {
      readyForPublicShare,
      checklist
    }
  });
}

export function buildGameCompetitionResultCertificate(input: {
  bundle: GameCompetitionEvidenceBundle;
  baseUrl: string;
  generatedAt?: string;
}): ResultCertificate {
  const checklist = input.bundle.integrity.checklist;
  const readyForPublicShare = checklist.every((item) => item.status === "pass");
  const standings = input.bundle.standings;
  const winner = standings.summary.winnerType === "tie" ? "tie" : standings.summary.winnerType;

  return withCertificateVerification({
    schemaVersion: "steambench.result-certificate.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    kind: "game-competition",
    id: `game:${standings.game.appid}:${standings.season.scope}`,
    title: `${standings.game.name} ${standings.season.label} human-vs-agent standings`,
    status: readyForPublicShare ? "scoreboard-ready" : "incomplete",
    verdict: readyForPublicShare ? "scoreboard-ready" : "proof-missing",
    canonicalArtifactName: "output.mp4",
    participants: [
      {
        side: "human",
        id: `game:${standings.game.appid}:human`,
        handle: "human",
        displayName: "Human players",
        score: standings.summary.humanScore
      },
      {
        side: "agent",
        id: `game:${standings.game.appid}:agent`,
        handle: "agent",
        displayName: "Runtime agents",
        score: standings.summary.agentScore
      }
    ],
    tasks: input.bundle.activeTasks,
    result: {
      winner,
      margin: standings.summary.margin,
      humanScore: standings.summary.humanScore,
      agentScore: standings.summary.agentScore,
      scoreboardRows: standings.totals.scoreboardRows
    },
    evidence: {
      eventCount: 0,
      artifactCount: 0,
      proofCount: 0,
      streamCount: 0,
      bundleReady: readyForPublicShare
    },
    links: {
      standings: apiUrl(input.baseUrl, `/api/games/${standings.game.appid}/standings?season=${standings.season.scope}`),
      evidenceBundle: apiUrl(input.baseUrl, `/api/games/${standings.game.appid}/evidence-bundle?season=${standings.season.scope}`),
      resultCertificate: apiUrl(input.baseUrl, `/api/games/${standings.game.appid}/result-certificate?season=${standings.season.scope}`)
    },
    integrity: {
      readyForPublicShare,
      checklist
    }
  });
}

export function buildGameCoverageRunResultCertificate(input: {
  bundle: GameCoverageRunEvidenceBundle;
  baseUrl: string;
  generatedAt?: string;
}): ResultCertificate {
  const checklist = input.bundle.integrity.checklist;
  const readyForPublicShare = checklist.every((item) => item.status === "pass");
  const humanScore = input.bundle.runBundles
    .filter((entry) => entry.side === "human")
    .reduce((total, entry) => total + (entry.bundle?.audit.run.score ?? 0), 0);
  const agentScore = input.bundle.runBundles
    .filter((entry) => entry.side === "agent")
    .reduce((total, entry) => total + (entry.bundle?.audit.run.score ?? 0), 0);
  const winner = humanScore === agentScore ? "tie" : humanScore > agentScore ? "human" : "agent";

  return withCertificateVerification({
    schemaVersion: "steambench.result-certificate.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    kind: "game-coverage-run",
    id: input.bundle.coverageRunId,
    title: `${input.bundle.gameName} coverage run`,
    status: input.bundle.record.status,
    verdict: input.bundle.integrity.verdict === "scoreboard-ready" ? "scoreboard-ready" : input.bundle.integrity.verdict === "empty" ? "blocked" : "proof-missing",
    canonicalArtifactName: "output.mp4",
    participants: [
      ...(input.bundle.human
        ? [{
            side: "human" as const,
            id: input.bundle.human.id,
            handle: input.bundle.human.handle,
            displayName: input.bundle.human.displayName,
            score: humanScore
          }]
        : []),
      ...(input.bundle.agent
        ? [{
            side: "agent" as const,
            id: input.bundle.agent.id,
            handle: input.bundle.agent.handle,
            displayName: input.bundle.agent.displayName,
            score: agentScore
          }]
        : [])
    ],
    tasks: uniqueTasks(input.bundle.runBundles.flatMap((entry) => entry.bundle?.audit.task ? [entry.bundle.audit.task] : [])),
    result: {
      winner,
      margin: Math.abs(humanScore - agentScore),
      humanScore,
      agentScore,
      scoreboardRows: input.bundle.integrity.scoreboardRows
    },
    evidence: {
      eventCount: input.bundle.integrity.eventCount,
      artifactCount: input.bundle.integrity.artifactCount,
      proofCount: input.bundle.integrity.proofCount,
      streamCount: input.bundle.integrity.streamCount,
      bundleReady: readyForPublicShare
    },
    links: {
      coverageRun: apiUrl(input.baseUrl, `/api/game-coverage-runs/${input.bundle.coverageRunId}`),
      evidenceBundle: apiUrl(input.baseUrl, `/api/game-coverage-runs/${input.bundle.coverageRunId}/evidence-bundle`),
      resultCertificate: apiUrl(input.baseUrl, `/api/game-coverage-runs/${input.bundle.coverageRunId}/result-certificate`),
      coveragePlan: apiUrl(input.baseUrl, `/api/games/${input.bundle.appid}/coverage-plan`),
      standings: apiUrl(input.baseUrl, `/api/games/${input.bundle.appid}/standings`)
    },
    integrity: {
      readyForPublicShare,
      checklist
    }
  });
}
