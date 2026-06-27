import type { BenchmarkTask } from "../benchmark/types";
import type { RunEvidenceBundle } from "./evidence-bundle";
import type { AgentProfile, GameCoverageRunRecord, UserAccount } from "./store";

export type GameCoverageRunEvidenceChecklistItem = {
  id: string;
  label: string;
  status: "pass" | "fail";
};

export type GameCoverageRunEvidenceBundle = {
  schemaVersion: "steambench.game-coverage-run-evidence-bundle.v1";
  generatedAt: string;
  coverageRunId: string;
  appid: number;
  gameName: string;
  record: GameCoverageRunRecord;
  human?: Pick<UserAccount, "id" | "handle" | "displayName" | "linkedSteamId" | "proofConsentAt">;
  agent?: Pick<AgentProfile, "id" | "handle" | "displayName" | "provider" | "runtimeProvider" | "status" | "capabilities">;
  runBundles: Array<{
    side: "human" | "agent" | "unknown";
    runId: string;
    task?: Pick<BenchmarkTask, "id" | "appid" | "gameName" | "title" | "track" | "level" | "score">;
    bundle?: RunEvidenceBundle;
  }>;
  links: {
    coverageRun: string;
    coverageRuns: string;
    coveragePlan: string;
    standings: string;
    resultCertificate: string;
  };
  integrity: {
    verdict: "scoreboard-ready" | "partial" | "empty";
    canonicalArtifactName: "output.mp4";
    runCount: number;
    scoreboardReadyRuns: number;
    allRunBundlesReady: boolean;
    humanRuns: number;
    agentRuns: number;
    remainingHumanGaps: number;
    remainingAgentGaps: number;
    eventCount: number;
    artifactCount: number;
    proofCount: number;
    streamCount: number;
    scoreboardRows: number;
    checklist: GameCoverageRunEvidenceChecklistItem[];
  };
};

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function taskSummary(task: BenchmarkTask): GameCoverageRunEvidenceBundle["runBundles"][number]["task"] {
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

export function buildGameCoverageRunEvidenceBundle(input: {
  record: GameCoverageRunRecord;
  human?: UserAccount;
  agent?: AgentProfile;
  runBundles: Array<{
    runId: string;
    task?: BenchmarkTask;
    bundle?: RunEvidenceBundle;
  }>;
  baseUrl: string;
  generatedAt?: string;
}): GameCoverageRunEvidenceBundle {
  const runBundles = input.runBundles.map((entry) => ({
    side: input.record.humanRunIds.includes(entry.runId)
      ? "human" as const
      : input.record.agentRunIds.includes(entry.runId)
        ? "agent" as const
        : "unknown" as const,
    runId: entry.runId,
    task: entry.task ? taskSummary(entry.task) : undefined,
    bundle: entry.bundle
  }));
  const allRunBundlesReady =
    runBundles.length > 0 &&
    runBundles.every((entry) => entry.bundle?.integrity.verdict === "scoreboard-ready");
  const scoreboardRows = runBundles.filter((entry) => entry.bundle?.audit.scoreboardRow).length;
  const checklist: GameCoverageRunEvidenceChecklistItem[] = [
    {
      id: "coverage-record",
      label: "Coverage execution record exists",
      status: input.record.completedRuns > 0 ? "pass" : "fail"
    },
    {
      id: "run-bundles",
      label: "Every coverage run has a scoreboard-ready evidence bundle",
      status: allRunBundlesReady ? "pass" : "fail"
    },
    {
      id: "scoreboard-rows",
      label: "Every coverage run published a scoreboard row",
      status: runBundles.length > 0 && scoreboardRows === runBundles.length ? "pass" : "fail"
    },
    {
      id: "canonical-artifacts",
      label: "Every coverage run preserved output.mp4 as the canonical artifact",
      status: runBundles.length > 0 && runBundles.every((entry) => entry.bundle?.integrity.canonicalArtifactPresent) ? "pass" : "fail"
    }
  ];
  const verdict: GameCoverageRunEvidenceBundle["integrity"]["verdict"] =
    input.record.completedRuns === 0
      ? "empty"
      : checklist.every((entry) => entry.status === "pass")
        ? "scoreboard-ready"
        : "partial";

  return {
    schemaVersion: "steambench.game-coverage-run-evidence-bundle.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    coverageRunId: input.record.id,
    appid: input.record.appid,
    gameName: input.record.gameName,
    record: input.record,
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
    runBundles,
    links: {
      coverageRun: apiUrl(input.baseUrl, `/api/game-coverage-runs/${input.record.id}`),
      coverageRuns: apiUrl(input.baseUrl, `/api/games/${input.record.appid}/coverage-runs`),
      coveragePlan: apiUrl(input.baseUrl, `/api/games/${input.record.appid}/coverage-plan`),
      standings: apiUrl(input.baseUrl, `/api/games/${input.record.appid}/standings`),
      resultCertificate: apiUrl(input.baseUrl, `/api/game-coverage-runs/${input.record.id}/result-certificate`)
    },
    integrity: {
      verdict,
      canonicalArtifactName: "output.mp4",
      runCount: runBundles.length,
      scoreboardReadyRuns: runBundles.filter((entry) => entry.bundle?.integrity.verdict === "scoreboard-ready").length,
      allRunBundlesReady,
      humanRuns: runBundles.filter((entry) => entry.side === "human").length,
      agentRuns: runBundles.filter((entry) => entry.side === "agent").length,
      remainingHumanGaps: input.record.remainingHumanGaps,
      remainingAgentGaps: input.record.remainingAgentGaps,
      eventCount: runBundles.reduce((total, entry) => total + (entry.bundle?.integrity.eventCount ?? 0), 0),
      artifactCount: runBundles.reduce((total, entry) => total + (entry.bundle?.integrity.artifactCount ?? 0), 0),
      proofCount: runBundles.reduce((total, entry) => total + (entry.bundle?.integrity.proofCount ?? 0), 0),
      streamCount: runBundles.reduce((total, entry) => total + (entry.bundle?.integrity.streamCount ?? 0), 0),
      scoreboardRows,
      checklist
    }
  };
}
