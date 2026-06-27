import type { BenchmarkTask } from "../benchmark/types";
import { buildRuntimeRunPlan } from "../runtime/events";
import type { AgentProfile, BenchmarkMatch, BenchmarkRun, UserAccount } from "./store";

export type MatchArenaPacket = {
  schemaVersion: "steambench.match-arena-packet.v1";
  matchId: string;
  taskId: string;
  appid: number;
  status: BenchmarkMatch["status"];
  readyForStart: boolean;
  readyForEvaluation: boolean;
  readyForPublicShare: boolean;
  objective: {
    gameName: string;
    title: string;
    track: BenchmarkTask["track"];
    metricName?: string;
    targetValue?: string;
    scoringRule?: string;
  };
  human: {
    userId: string;
    handle: string;
    displayName: string;
    steamid?: string;
    proofConsentAt?: string;
    runId?: string;
    status: BenchmarkRun["status"] | "not-started";
    score?: number;
    entryPacket: {
      schemaVersion: "steambench.human-benchmark-entry-packet.v1";
      endpoint: string;
      canonicalArtifact: "output/output.mp4";
      proofType: "steam-achievement" | "manual-review";
    };
  };
  agent: {
    agentId: string;
    handle: string;
    displayName: string;
    provider: AgentProfile["provider"];
    runtimeProvider: BenchmarkRun["runtimeProvider"];
    runId?: string;
    status: BenchmarkRun["status"] | "not-started";
    score?: number;
    actionSpace: {
      schemaVersion: "steambench.runtime-action-space.v1";
      inputMode: string;
      transport: string;
      allowedActionTypes: string[];
    };
  };
  evidence: {
    canonicalArtifact: "output/output.mp4";
    acceptedArtifactName: "output.mp4";
    forbiddenArtifactNames: ["output-test.mp4"];
    humanProofRequired: true;
    agentTraceRequired: true;
  };
  endpoints: {
    match: string;
    start: string;
    runLocal: string;
    evaluate: string;
    resultCertificate: string;
    humanSubmission: string;
    humanRun?: string;
    humanEvidenceBundle?: string;
    humanResultCertificate?: string;
    agentRun?: string;
    agentHandoff?: string;
    agentPlaybook?: string;
    agentActionBatch?: string;
    agentTrace?: string;
    agentTraceAudit?: string;
    agentSubmission?: string;
    agentEvidenceBundle?: string;
    agentResultCertificate?: string;
  };
  nextActions: Array<{
    id: "start-match" | "submit-human-proof" | "submit-agent-actions" | "evaluate-match" | "share-certificate";
    label: string;
    endpoint: string;
    method: "GET" | "POST";
  }>;
};

export function buildMatchArenaPacket(input: {
  match: BenchmarkMatch;
  task: BenchmarkTask;
  human?: UserAccount;
  agent?: AgentProfile;
  humanRun?: BenchmarkRun;
  agentRun?: BenchmarkRun;
}): MatchArenaPacket {
  const actionSpace = buildRuntimeRunPlan(input.task).actionSpace;
  const humanProofType = input.task.track === "achievement" ? "steam-achievement" : "manual-review";
  const humanStatus = input.humanRun?.status ?? "not-started";
  const agentStatus = input.agentRun?.status ?? "not-started";
  const nextActions: MatchArenaPacket["nextActions"] = [];

  if (!input.match.humanRunId || !input.match.agentRunId) {
    nextActions.push({
      id: "start-match",
      label: "Start paired human and agent runs",
      endpoint: `/api/matches/${input.match.id}/start`,
      method: "POST"
    });
  }
  if (humanStatus !== "scored") {
    nextActions.push({
      id: "submit-human-proof",
      label: "Submit human canonical proof",
      endpoint: `/api/users/${input.match.humanUserId}/steam-proof-submissions`,
      method: "POST"
    });
  }
  if (agentStatus !== "scored") {
    nextActions.push({
      id: "submit-agent-actions",
      label: "Submit agent actions and canonical proof",
      endpoint: input.agentRun ? `/api/runs/${input.agentRun.id}/action-batches` : `/api/matches/${input.match.id}/start`,
      method: "POST"
    });
  }
  if (humanStatus === "scored" && agentStatus === "scored" && input.match.status !== "scored") {
    nextActions.push({
      id: "evaluate-match",
      label: "Evaluate match winner",
      endpoint: `/api/matches/${input.match.id}/evaluate`,
      method: "POST"
    });
  }
  if (input.match.status === "scored") {
    nextActions.push({
      id: "share-certificate",
      label: "Share match result certificate",
      endpoint: `/api/matches/${input.match.id}/result-certificate`,
      method: "GET"
    });
  }

  return {
    schemaVersion: "steambench.match-arena-packet.v1",
    matchId: input.match.id,
    taskId: input.task.id,
    appid: input.task.appid,
    status: input.match.status,
    readyForStart: Boolean(input.human && input.agent && !input.match.humanRunId && !input.match.agentRunId),
    readyForEvaluation: humanStatus === "scored" && agentStatus === "scored",
    readyForPublicShare: input.match.status === "scored",
    objective: {
      gameName: input.task.gameName,
      title: input.task.title,
      track: input.task.track,
      metricName: input.task.metricName,
      targetValue: input.task.targetValue,
      scoringRule: input.task.scoringRule
    },
    human: {
      userId: input.match.humanUserId,
      handle: input.human?.handle ?? input.match.humanUserId,
      displayName: input.human?.displayName ?? input.match.humanUserId,
      steamid: input.human?.linkedSteamId,
      proofConsentAt: input.human?.proofConsentAt,
      runId: input.humanRun?.id,
      status: humanStatus,
      score: input.humanRun?.score,
      entryPacket: {
        schemaVersion: "steambench.human-benchmark-entry-packet.v1",
        endpoint: `/api/users/${input.match.humanUserId}/steam-proof-plan`,
        canonicalArtifact: "output/output.mp4",
        proofType: humanProofType
      }
    },
    agent: {
      agentId: input.match.agentId,
      handle: input.agent?.handle ?? input.match.agentId,
      displayName: input.agent?.displayName ?? input.match.agentId,
      provider: input.agent?.provider ?? "external",
      runtimeProvider: input.agentRun?.runtimeProvider ?? input.agent?.runtimeProvider ?? "local-sim",
      runId: input.agentRun?.id,
      status: agentStatus,
      score: input.agentRun?.score,
      actionSpace: {
        schemaVersion: actionSpace.schemaVersion,
        inputMode: actionSpace.inputMode,
        transport: actionSpace.transport,
        allowedActionTypes: actionSpace.allowedActionTypes
      }
    },
    evidence: {
      canonicalArtifact: "output/output.mp4",
      acceptedArtifactName: "output.mp4",
      forbiddenArtifactNames: ["output-test.mp4"],
      humanProofRequired: true,
      agentTraceRequired: true
    },
    endpoints: {
      match: `/api/matches/${input.match.id}`,
      start: `/api/matches/${input.match.id}/start`,
      runLocal: `/api/matches/${input.match.id}/run-local`,
      evaluate: `/api/matches/${input.match.id}/evaluate`,
      resultCertificate: `/api/matches/${input.match.id}/result-certificate`,
      humanSubmission: `/api/users/${input.match.humanUserId}/steam-proof-submissions`,
      humanRun: input.humanRun ? `/api/runs/${input.humanRun.id}` : undefined,
      humanEvidenceBundle: input.humanRun ? `/api/runs/${input.humanRun.id}/evidence-bundle` : undefined,
      humanResultCertificate: input.humanRun ? `/api/runs/${input.humanRun.id}/result-certificate` : undefined,
      agentRun: input.agentRun ? `/api/runs/${input.agentRun.id}` : undefined,
      agentHandoff: input.agentRun ? `/api/runs/${input.agentRun.id}/agent-handoff?agentId=${encodeURIComponent(input.match.agentId)}` : undefined,
      agentPlaybook: input.agentRun ? `/api/runs/${input.agentRun.id}/agent-playbook?agentId=${encodeURIComponent(input.match.agentId)}` : undefined,
      agentActionBatch: input.agentRun ? `/api/runs/${input.agentRun.id}/action-batches` : undefined,
      agentTrace: input.agentRun ? `/api/runs/${input.agentRun.id}/agent-trace` : undefined,
      agentTraceAudit: input.agentRun ? `/api/runs/${input.agentRun.id}/agent-trace/audit` : undefined,
      agentSubmission: input.agentRun ? `/api/runs/${input.agentRun.id}/submission` : undefined,
      agentEvidenceBundle: input.agentRun ? `/api/runs/${input.agentRun.id}/evidence-bundle` : undefined,
      agentResultCertificate: input.agentRun ? `/api/runs/${input.agentRun.id}/result-certificate` : undefined
    },
    nextActions
  };
}
