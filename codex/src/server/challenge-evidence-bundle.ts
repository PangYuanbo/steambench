import type { BenchmarkTask } from "../benchmark/types";
import type { RunEvidenceBundle } from "./evidence-bundle";
import type { AgentProfile, BenchmarkChallenge, BenchmarkMatch, UserAccount } from "./store";

export type ChallengeEvidenceChecklistItem = {
  id: string;
  label: string;
  status: "pass" | "fail";
};

export type ChallengeEvidenceBundle = {
  schemaVersion: "steambench.challenge-evidence-bundle.v1";
  generatedAt: string;
  challengeId: string;
  taskId: string;
  challenge: BenchmarkChallenge;
  task: BenchmarkTask;
  human?: Pick<UserAccount, "id" | "handle" | "displayName" | "linkedSteamId" | "proofConsentAt">;
  agent?: Pick<AgentProfile, "id" | "handle" | "displayName" | "provider" | "runtimeProvider" | "status" | "capabilities">;
  match?: BenchmarkMatch;
  runBundles: {
    human?: RunEvidenceBundle;
    agent?: RunEvidenceBundle;
  };
  links: {
    challenge: string;
    resultCertificate: string;
    match?: string;
    humanRun?: string;
    agentRun?: string;
  };
  integrity: {
    verdict: "scoreboard-ready" | "match-incomplete" | "blocked" | "failed";
    canonicalArtifactName: "output.mp4";
    challengeAccepted: boolean;
    matchScored: boolean;
    humanBundleReady: boolean;
    agentBundleReady: boolean;
    allRunBundlesScoreboardReady: boolean;
    scoreboardRows: number;
    eventCount: number;
    artifactCount: number;
    proofCount: number;
    streamCount: number;
    checklist: ChallengeEvidenceChecklistItem[];
  };
};

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export function buildChallengeEvidenceBundle(input: {
  challenge: BenchmarkChallenge;
  task: BenchmarkTask;
  human?: UserAccount;
  agent?: AgentProfile;
  match?: BenchmarkMatch;
  humanBundle?: RunEvidenceBundle;
  agentBundle?: RunEvidenceBundle;
  baseUrl: string;
  generatedAt?: string;
}): ChallengeEvidenceBundle {
  const challengeAccepted = Boolean(input.challenge.matchId && input.match);
  const matchScored = input.match?.status === "scored";
  const humanBundleReady = input.humanBundle?.integrity.verdict === "scoreboard-ready";
  const agentBundleReady = input.agentBundle?.integrity.verdict === "scoreboard-ready";
  const allRunBundlesScoreboardReady = humanBundleReady && agentBundleReady;
  const scoreboardRows = [
    input.humanBundle?.audit.scoreboardRow,
    input.agentBundle?.audit.scoreboardRow
  ].filter(Boolean).length;
  const checklist: ChallengeEvidenceChecklistItem[] = [
    {
      id: "challenge-accepted",
      label: "Challenge has a match contract",
      status: challengeAccepted ? "pass" : "fail"
    },
    {
      id: "match-scored",
      label: "Challenge match is scored",
      status: matchScored ? "pass" : "fail"
    },
    {
      id: "human-run-bundle",
      label: "Human run evidence bundle is scoreboard-ready",
      status: humanBundleReady ? "pass" : "fail"
    },
    {
      id: "agent-run-bundle",
      label: "Agent run evidence bundle is scoreboard-ready",
      status: agentBundleReady ? "pass" : "fail"
    },
    {
      id: "scoreboard-rows",
      label: "Both challenge sides published scoreboard rows",
      status: scoreboardRows === 2 ? "pass" : "fail"
    }
  ];
  const verdict: ChallengeEvidenceBundle["integrity"]["verdict"] =
    checklist.every((entry) => entry.status === "pass")
      ? "scoreboard-ready"
      : input.match?.status === "failed"
        ? "failed"
        : input.challenge.status === "blocked"
          ? "blocked"
          : "match-incomplete";

  return {
    schemaVersion: "steambench.challenge-evidence-bundle.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    challengeId: input.challenge.id,
    taskId: input.task.id,
    challenge: input.challenge,
    task: input.task,
    human: input.human
      ? {
          id: input.human.id,
          handle: input.human.handle,
          displayName: input.human.displayName,
          linkedSteamId: input.human.linkedSteamId,
          proofConsentAt: input.human.proofConsentAt
        }
      : undefined,
    agent: input.agent
      ? {
          id: input.agent.id,
          handle: input.agent.handle,
          displayName: input.agent.displayName,
          provider: input.agent.provider,
          runtimeProvider: input.agent.runtimeProvider,
          status: input.agent.status,
          capabilities: input.agent.capabilities
        }
      : undefined,
    match: input.match,
    runBundles: {
      human: input.humanBundle,
      agent: input.agentBundle
    },
    links: {
      challenge: apiUrl(input.baseUrl, `/api/challenges/${input.challenge.id}`),
      resultCertificate: apiUrl(input.baseUrl, `/api/challenges/${input.challenge.id}/result-certificate`),
      ...(input.match ? { match: apiUrl(input.baseUrl, `/api/matches/${input.match.id}`) } : {}),
      ...(input.match?.humanRunId ? { humanRun: apiUrl(input.baseUrl, `/api/runs/${input.match.humanRunId}`) } : {}),
      ...(input.match?.agentRunId ? { agentRun: apiUrl(input.baseUrl, `/api/runs/${input.match.agentRunId}`) } : {})
    },
    integrity: {
      verdict,
      canonicalArtifactName: "output.mp4",
      challengeAccepted,
      matchScored,
      humanBundleReady,
      agentBundleReady,
      allRunBundlesScoreboardReady,
      scoreboardRows,
      eventCount: (input.humanBundle?.integrity.eventCount ?? 0) + (input.agentBundle?.integrity.eventCount ?? 0),
      artifactCount: (input.humanBundle?.integrity.artifactCount ?? 0) + (input.agentBundle?.integrity.artifactCount ?? 0),
      proofCount: (input.humanBundle?.integrity.proofCount ?? 0) + (input.agentBundle?.integrity.proofCount ?? 0),
      streamCount: (input.humanBundle?.integrity.streamCount ?? 0) + (input.agentBundle?.integrity.streamCount ?? 0),
      checklist
    }
  };
}
