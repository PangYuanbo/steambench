import type { BenchmarkTask } from "../benchmark/types";
import type { BenchmarkRun, LiveStreamSession } from "./store";
import type { BroadcastCenterRow } from "./broadcast-center";

export type BroadcastOpsTicketStatus =
  | "live"
  | "scheduled"
  | "scoreboard-ready"
  | "proof-ready"
  | "proof-missing"
  | "incomplete"
  | "failed";

export type BroadcastOpsTicket = {
  stream: Pick<LiveStreamSession, "id" | "runId" | "status" | "provider" | "title" | "playbackUrl" | "viewerCount" | "currentScene" | "createdAt" | "startedAt" | "endedAt">;
  run: Pick<BenchmarkRun, "id" | "status" | "competitor" | "competitorType" | "runtimeProvider" | "score" | "artifactName" | "updatedAt">;
  task: Pick<BenchmarkTask, "id" | "appid" | "gameName" | "title" | "track" | "level">;
  status: BroadcastOpsTicketStatus;
  readiness: "public" | "monitoring" | "attention";
  evidence: {
    events: number;
    proofs: number;
    artifacts: number;
    checkpoints: number;
    proofReady: boolean;
    scoreboardReady: boolean;
  };
  blockers: string[];
  links: {
    broadcast: string;
    evidenceBundle: string;
    resultCertificate: string;
    runAudit: string;
    updateStatus: string;
    playback: string;
  };
};

export type BroadcastOpsReport = {
  schemaVersion: "steambench.broadcast-ops-report.v1";
  generatedAt: string;
  status: "ready-to-share" | "monitoring" | "needs-attention" | "idle";
  filters: {
    status?: BroadcastOpsTicketStatus;
    limit: number;
  };
  totals: {
    broadcasts: number;
    selectedBroadcasts: number;
    live: number;
    scheduled: number;
    ended: number;
    failed: number;
    scoreboardReady: number;
    proofReady: number;
    proofMissing: number;
    incomplete: number;
    viewers: number;
  };
  tickets: BroadcastOpsTicket[];
  recommendedActions: Array<{
    id: "start-scheduled-broadcast" | "end-live-broadcast" | "inspect-proof-missing-broadcast" | "share-broadcast-certificate" | "inspect-broadcast-center";
    label: string;
    priority: "high" | "medium" | "low";
    method: "GET" | "POST";
    endpoint: string;
    body?: Record<string, unknown>;
    reason: string;
  }>;
  links: {
    broadcasts: "/api/broadcasts";
    center: "/api/broadcasts/center";
  };
};

function ticketStatus(row: BroadcastCenterRow): BroadcastOpsTicketStatus {
  if (row.stream.status === "failed") return "failed";
  if (row.stream.status === "live") return "live";
  if (row.stream.status === "scheduled") return "scheduled";
  if (row.scoreboardReady && row.proofReady) return "scoreboard-ready";
  if (row.proofReady) return "proof-ready";
  if (row.stream.status === "ended" && !row.proofReady) return "proof-missing";
  return "incomplete";
}

function readiness(status: BroadcastOpsTicketStatus): BroadcastOpsTicket["readiness"] {
  if (status === "scoreboard-ready") return "public";
  if (status === "live" || status === "scheduled" || status === "proof-ready") return "monitoring";
  return "attention";
}

function blockers(status: BroadcastOpsTicketStatus, row: BroadcastCenterRow): string[] {
  const result = [];
  if (!row.proofReady) result.push("proof_not_ready");
  if (!row.scoreboardReady) result.push("scoreboard_not_ready");
  if (row.artifactCount === 0) result.push("canonical_artifact_missing");
  if (row.eventCount === 0) result.push("timeline_missing");
  if (status === "failed") result.push("stream_failed");
  return result;
}

function reportStatus(totals: BroadcastOpsReport["totals"]): BroadcastOpsReport["status"] {
  if (totals.failed > 0 || totals.proofMissing > 0 || totals.incomplete > 0) return "needs-attention";
  if (totals.live > 0 || totals.scheduled > 0 || totals.proofReady > totals.scoreboardReady) return "monitoring";
  if (totals.scoreboardReady > 0) return "ready-to-share";
  return "idle";
}

function actions(tickets: BroadcastOpsTicket[]): BroadcastOpsReport["recommendedActions"] {
  const result: BroadcastOpsReport["recommendedActions"] = [];
  const scheduled = tickets.find((ticket) => ticket.status === "scheduled");
  if (scheduled) {
    result.push({
      id: "start-scheduled-broadcast",
      label: "Start scheduled broadcast",
      priority: "high",
      method: "POST",
      endpoint: scheduled.links.updateStatus,
      body: { status: "live", currentScene: "Runtime live", viewerCount: Math.max(1, scheduled.stream.viewerCount) },
      reason: `Broadcast ${scheduled.stream.id} is scheduled and ready to move into live monitoring.`
    });
  }

  const live = tickets.find((ticket) => ticket.status === "live");
  if (live) {
    result.push({
      id: "end-live-broadcast",
      label: "End live broadcast",
      priority: "medium",
      method: "POST",
      endpoint: live.links.updateStatus,
      body: { status: "ended", currentScene: "Run complete" },
      reason: `Broadcast ${live.stream.id} is live with ${live.stream.viewerCount} viewer(s).`
    });
  }

  const proofMissing = tickets.find((ticket) => ticket.status === "proof-missing" || ticket.status === "incomplete" || ticket.status === "failed");
  if (proofMissing) {
    result.push({
      id: "inspect-proof-missing-broadcast",
      label: "Inspect broadcast evidence",
      priority: "high",
      method: "GET",
      endpoint: proofMissing.links.evidenceBundle,
      reason: `Broadcast ${proofMissing.stream.id} is not public-share ready.`
    });
  }

  const ready = tickets.find((ticket) => ticket.status === "scoreboard-ready");
  if (ready) {
    result.push({
      id: "share-broadcast-certificate",
      label: "Share broadcast certificate",
      priority: result.length === 0 ? "high" : "low",
      method: "GET",
      endpoint: ready.links.resultCertificate,
      reason: `Broadcast ${ready.stream.id} has proof-ready scoreboard evidence.`
    });
  }

  result.push({
    id: "inspect-broadcast-center",
    label: "Inspect broadcast center",
    priority: "low",
    method: "GET",
    endpoint: "/api/broadcasts/center",
    reason: "Review live streams, recent replays, viewer counts, and public-ready broadcasts."
  });
  return result;
}

export function buildBroadcastOpsReport(input: {
  rows: BroadcastCenterRow[];
  status?: BroadcastOpsTicketStatus;
  limit?: number;
  generatedAt?: string;
}): BroadcastOpsReport {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
  const tickets = input.rows
    .map((row): BroadcastOpsTicket => {
      const status = ticketStatus(row);
      return {
        stream: {
          id: row.stream.id,
          runId: row.stream.runId,
          status: row.stream.status,
          provider: row.stream.provider,
          title: row.stream.title,
          playbackUrl: row.stream.playbackUrl,
          viewerCount: row.stream.viewerCount,
          currentScene: row.stream.currentScene,
          createdAt: row.stream.createdAt,
          startedAt: row.stream.startedAt,
          endedAt: row.stream.endedAt
        },
        run: {
          id: row.run.id,
          status: row.run.status,
          competitor: row.run.competitor,
          competitorType: row.run.competitorType,
          runtimeProvider: row.run.runtimeProvider,
          score: row.run.score,
          artifactName: row.run.artifactName,
          updatedAt: row.run.updatedAt
        },
        task: {
          id: row.task.id,
          appid: row.task.appid,
          gameName: row.task.gameName,
          title: row.task.title,
          track: row.task.track,
          level: row.task.level
        },
        status,
        readiness: readiness(status),
        evidence: {
          events: row.eventCount,
          proofs: row.proofCount,
          artifacts: row.artifactCount,
          checkpoints: row.checkpointCount,
          proofReady: row.proofReady,
          scoreboardReady: row.scoreboardReady
        },
        blockers: blockers(status, row),
        links: {
          broadcast: `/api/broadcasts/${row.stream.id}`,
          evidenceBundle: `/api/broadcasts/${row.stream.id}/evidence-bundle`,
          resultCertificate: `/api/broadcasts/${row.stream.id}/result-certificate`,
          runAudit: `/api/runs/${row.run.id}/audit`,
          updateStatus: `/api/livestreams/${row.stream.id}/status`,
          playback: row.stream.playbackUrl
        }
      };
    })
    .filter((ticket) => !input.status || ticket.status === input.status)
    .slice(0, limit);
  const totals = {
    broadcasts: input.rows.length,
    selectedBroadcasts: tickets.length,
    live: tickets.filter((ticket) => ticket.stream.status === "live").length,
    scheduled: tickets.filter((ticket) => ticket.stream.status === "scheduled").length,
    ended: tickets.filter((ticket) => ticket.stream.status === "ended").length,
    failed: tickets.filter((ticket) => ticket.stream.status === "failed").length,
    scoreboardReady: tickets.filter((ticket) => ticket.status === "scoreboard-ready").length,
    proofReady: tickets.filter((ticket) => ticket.evidence.proofReady).length,
    proofMissing: tickets.filter((ticket) => ticket.status === "proof-missing").length,
    incomplete: tickets.filter((ticket) => ticket.status === "incomplete").length,
    viewers: tickets.reduce((total, ticket) => total + ticket.stream.viewerCount, 0)
  };
  return {
    schemaVersion: "steambench.broadcast-ops-report.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: reportStatus(totals),
    filters: {
      status: input.status,
      limit
    },
    totals,
    tickets,
    recommendedActions: actions(tickets),
    links: {
      broadcasts: "/api/broadcasts",
      center: "/api/broadcasts/center"
    }
  };
}
