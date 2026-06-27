import type { BenchmarkTask, ScoreboardRow } from "../benchmark/types";
import { buildRunAuditReport, type RunAuditReport } from "./run-audit";
import type { BenchmarkRun, StoreSnapshot } from "./store";

export type ScoreboardOpsTicketStatus =
  | "scoreboard-ready"
  | "proof-missing"
  | "scoreboard-missing"
  | "row-inconsistent"
  | "orphan-row"
  | "in-progress"
  | "failed";

export type ScoreboardOpsTicket = {
  status: ScoreboardOpsTicketStatus;
  readiness: "public" | "attention" | "pending";
  run?: Pick<BenchmarkRun, "id" | "taskId" | "competitor" | "competitorType" | "status" | "runtimeProvider" | "score" | "artifactName" | "updatedAt">;
  task?: Pick<BenchmarkTask, "id" | "appid" | "gameName" | "title" | "track" | "level">;
  scoreboardRow?: ScoreboardRow;
  audit?: Pick<RunAuditReport, "verdict" | "missingProofs" | "evidenceCounts"> & {
    canonicalArtifact?: Pick<NonNullable<RunAuditReport["canonicalArtifact"]>, "id" | "name" | "uri" | "canonical">;
    scoreboardRowPresent: boolean;
  };
  blockers: string[];
  links: {
    run?: string;
    audit?: string;
    evidenceBundle?: string;
    resultCertificate?: string;
    score?: string;
    standings: string;
    taskLeaderboard?: string;
  };
};

export type ScoreboardOpsReport = {
  schemaVersion: "steambench.scoreboard-ops-report.v1";
  generatedAt: string;
  status: "ready-to-share" | "needs-publication" | "needs-attention" | "building";
  filters: {
    status?: ScoreboardOpsTicketStatus;
    appid?: number;
    limit: number;
  };
  totals: {
    runs: number;
    scoreboardRows: number;
    selectedTickets: number;
    scoreboardReady: number;
    proofMissing: number;
    scoreboardMissing: number;
    rowInconsistent: number;
    orphanRows: number;
    inProgress: number;
    failed: number;
    totalPublishedScore: number;
  };
  tickets: ScoreboardOpsTicket[];
  recommendedActions: Array<{
    id: "republish-scoreboard-row" | "inspect-proof-missing-run" | "inspect-scoreboard-inconsistency" | "share-standings" | "inspect-standings";
    label: string;
    priority: "high" | "medium" | "low";
    method: "GET" | "POST";
    endpoint: string;
    reason: string;
  }>;
  links: {
    standings: "/api/standings";
    leaderboards: "/api/leaderboards";
    seasons: "/api/seasons";
  };
};

function taskPick(task: BenchmarkTask): NonNullable<ScoreboardOpsTicket["task"]> {
  return {
    id: task.id,
    appid: task.appid,
    gameName: task.gameName,
    title: task.title,
    track: task.track,
    level: task.level
  };
}

function runPick(run: BenchmarkRun): NonNullable<ScoreboardOpsTicket["run"]> {
  return {
    id: run.id,
    taskId: run.taskId,
    competitor: run.competitor,
    competitorType: run.competitorType,
    status: run.status,
    runtimeProvider: run.runtimeProvider,
    score: run.score,
    artifactName: run.artifactName,
    updatedAt: run.updatedAt
  };
}

function rowMatchesRun(row: ScoreboardRow | undefined, run: BenchmarkRun, task: BenchmarkTask): boolean {
  if (!row) return false;
  return (
    row.runId === run.id &&
    row.taskId === task.id &&
    row.appid === task.appid &&
    row.competitor === run.competitor &&
    row.type === run.competitorType &&
    row.score === run.score
  );
}

function ticketStatus(input: {
  run: BenchmarkRun;
  task: BenchmarkTask;
  audit: RunAuditReport;
  row?: ScoreboardRow;
}): ScoreboardOpsTicketStatus {
  if (input.run.status === "failed" || input.audit.verdict === "failed") return "failed";
  if (input.row && input.run.status !== "scored") return "row-inconsistent";
  if (input.row && !rowMatchesRun(input.row, input.run, input.task)) return "row-inconsistent";
  if (input.audit.verdict === "scoreboard-ready") return "scoreboard-ready";
  if (input.audit.verdict === "proof-missing") return "proof-missing";
  if (input.run.status === "scored" && !input.row) return "scoreboard-missing";
  return "in-progress";
}

function readiness(status: ScoreboardOpsTicketStatus): ScoreboardOpsTicket["readiness"] {
  if (status === "scoreboard-ready") return "public";
  if (status === "in-progress") return "pending";
  return "attention";
}

function blockers(input: {
  status: ScoreboardOpsTicketStatus;
  run?: BenchmarkRun;
  task?: BenchmarkTask;
  row?: ScoreboardRow;
  audit?: RunAuditReport;
}): string[] {
  const result = new Set<string>();
  if (input.status === "orphan-row") result.add("scoreboard_row_without_run");
  if (input.status === "scoreboard-missing") result.add("scored_run_missing_scoreboard_row");
  if (input.status === "failed") result.add("run_failed");
  if (input.status === "in-progress") result.add("run_not_terminal");
  for (const proof of input.audit?.missingProofs ?? []) result.add(`${proof.replaceAll("-", "_")}_missing`);
  if (input.audit && !input.audit.canonicalArtifact) result.add("canonical_artifact_missing");
  if (input.row && input.run && input.row.score !== input.run.score) result.add("score_mismatch");
  if (input.row && input.run && input.row.competitor !== input.run.competitor) result.add("competitor_mismatch");
  if (input.row && input.run && input.row.type !== input.run.competitorType) result.add("competitor_type_mismatch");
  if (input.row && input.task && input.row.taskId !== input.task.id) result.add("task_mismatch");
  if (input.row && input.task && input.row.appid !== input.task.appid) result.add("appid_mismatch");
  if (input.row && input.run && input.run.status !== "scored") result.add("scoreboard_row_for_unscored_run");
  return [...result].sort();
}

function reportStatus(totals: ScoreboardOpsReport["totals"]): ScoreboardOpsReport["status"] {
  if (totals.proofMissing + totals.rowInconsistent + totals.orphanRows + totals.failed > 0) return "needs-attention";
  if (totals.scoreboardMissing > 0) return "needs-publication";
  if (totals.scoreboardReady > 0) return "ready-to-share";
  return "building";
}

function actions(tickets: ScoreboardOpsTicket[]): ScoreboardOpsReport["recommendedActions"] {
  const result: ScoreboardOpsReport["recommendedActions"] = [];
  const missingRow = tickets.find((ticket) => ticket.status === "scoreboard-missing" && ticket.links.score);
  if (missingRow?.links.score) {
    result.push({
      id: "republish-scoreboard-row",
      label: "Republish scoreboard row",
      priority: "high",
      method: "POST",
      endpoint: missingRow.links.score,
      reason: `${missingRow.run?.id} is scored but missing its public scoreboard row.`
    });
  }

  const proofMissing = tickets.find((ticket) => ticket.status === "proof-missing" && ticket.links.audit);
  if (proofMissing?.links.audit) {
    result.push({
      id: "inspect-proof-missing-run",
      label: "Inspect proof-missing run",
      priority: result.length === 0 ? "high" : "medium",
      method: "GET",
      endpoint: proofMissing.links.audit,
      reason: `${proofMissing.run?.id} is blocked on required proof or canonical artifact evidence.`
    });
  }

  const inconsistent = tickets.find((ticket) => (ticket.status === "row-inconsistent" || ticket.status === "orphan-row") && (ticket.links.audit ?? ticket.links.standings));
  if (inconsistent) {
    result.push({
      id: "inspect-scoreboard-inconsistency",
      label: "Inspect scoreboard inconsistency",
      priority: result.length === 0 ? "high" : "medium",
      method: "GET",
      endpoint: inconsistent.links.audit ?? inconsistent.links.standings,
      reason: "A public scoreboard row does not line up with its canonical run record."
    });
  }

  const ready = tickets.find((ticket) => ticket.status === "scoreboard-ready");
  if (ready) {
    result.push({
      id: "share-standings",
      label: "Share standings",
      priority: result.length === 0 ? "high" : "low",
      method: "GET",
      endpoint: "/api/standings",
      reason: "At least one audited run is ready for public scoreboard sharing."
    });
  }

  result.push({
    id: "inspect-standings",
    label: "Inspect standings",
    priority: "low",
    method: "GET",
    endpoint: "/api/standings",
    reason: "Review derived human-vs-agent totals and task leaderboards."
  });

  return result;
}

function buildAudit(snapshot: StoreSnapshot, run: BenchmarkRun, task: BenchmarkTask): RunAuditReport {
  return buildRunAuditReport({
    run,
    task,
    events: snapshot.events.filter((event) => event.runId === run.id),
    artifacts: snapshot.artifacts.filter((artifact) => artifact.runId === run.id),
    proofs: snapshot.proofs.filter((proof) => proof.runId === run.id),
    streams: snapshot.streams.filter((stream) => stream.runId === run.id),
    scoreboard: snapshot.scoreboard
  });
}

export function buildScoreboardOpsReport(input: {
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
  status?: ScoreboardOpsTicketStatus;
  appid?: number;
  limit?: number;
  generatedAt?: string;
}): ScoreboardOpsReport {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
  const runIds = new Set(input.snapshot.runs.map((run) => run.id));
  const rowByRunId = new Map(input.snapshot.scoreboard.filter((row) => row.runId).map((row) => [row.runId!, row]));
  const runTickets = input.snapshot.runs
    .filter((run) => {
      const task = tasksById.get(run.taskId);
      return input.appid === undefined || task?.appid === input.appid;
    })
    .map((run): ScoreboardOpsTicket => {
      const task = tasksById.get(run.taskId);
      if (!task) {
        return {
          status: "row-inconsistent",
          readiness: "attention",
          run: runPick(run),
          blockers: ["task_missing"],
          links: {
            run: `/api/runs/${run.id}`,
            audit: `/api/runs/${run.id}/audit`,
            score: `/api/runs/${run.id}/score`,
            standings: "/api/standings"
          }
        };
      }
      const row = rowByRunId.get(run.id);
      const audit = buildAudit(input.snapshot, run, task);
      const status = ticketStatus({ run, task, audit, row });
      return {
        status,
        readiness: readiness(status),
        run: runPick(run),
        task: taskPick(task),
        scoreboardRow: row,
        audit: {
          verdict: audit.verdict,
          missingProofs: audit.missingProofs,
          evidenceCounts: audit.evidenceCounts,
          canonicalArtifact: audit.canonicalArtifact
            ? {
                id: audit.canonicalArtifact.id,
                name: audit.canonicalArtifact.name,
                uri: audit.canonicalArtifact.uri,
                canonical: audit.canonicalArtifact.canonical
              }
            : undefined,
          scoreboardRowPresent: Boolean(audit.scoreboardRow)
        },
        blockers: blockers({ status, run, task, row, audit }),
        links: {
          run: `/api/runs/${run.id}`,
          audit: `/api/runs/${run.id}/audit`,
          evidenceBundle: `/api/runs/${run.id}/evidence-bundle`,
          resultCertificate: `/api/runs/${run.id}/result-certificate`,
          score: `/api/runs/${run.id}/score`,
          standings: "/api/standings",
          taskLeaderboard: `/api/tasks/${encodeURIComponent(task.id)}/leaderboard`
        }
      };
    });
  const orphanTickets = input.snapshot.scoreboard
    .filter((row) => {
      if (row.runId && runIds.has(row.runId)) return false;
      return input.appid === undefined || row.appid === input.appid;
    })
    .map((row): ScoreboardOpsTicket => ({
      status: "orphan-row",
      readiness: "attention",
      scoreboardRow: row,
      blockers: blockers({ status: "orphan-row", row }),
      links: {
        standings: "/api/standings",
        taskLeaderboard: row.taskId ? `/api/tasks/${encodeURIComponent(row.taskId)}/leaderboard` : undefined
      }
    }));
  const tickets = [...runTickets, ...orphanTickets]
    .filter((ticket) => !input.status || ticket.status === input.status)
    .sort((a, b) => {
      const priority = (ticket: ScoreboardOpsTicket) => {
        if (ticket.status === "proof-missing" || ticket.status === "row-inconsistent" || ticket.status === "orphan-row") return 0;
        if (ticket.status === "scoreboard-missing" || ticket.status === "failed") return 1;
        if (ticket.status === "in-progress") return 2;
        return 3;
      };
      return priority(a) - priority(b) || (b.run?.updatedAt ?? b.scoreboardRow?.completedAt ?? "").localeCompare(a.run?.updatedAt ?? a.scoreboardRow?.completedAt ?? "");
    })
    .slice(0, limit);
  const totals = {
    runs: input.appid === undefined ? input.snapshot.runs.length : input.snapshot.runs.filter((run) => tasksById.get(run.taskId)?.appid === input.appid).length,
    scoreboardRows: input.appid === undefined ? input.snapshot.scoreboard.length : input.snapshot.scoreboard.filter((row) => row.appid === input.appid).length,
    selectedTickets: tickets.length,
    scoreboardReady: tickets.filter((ticket) => ticket.status === "scoreboard-ready").length,
    proofMissing: tickets.filter((ticket) => ticket.status === "proof-missing").length,
    scoreboardMissing: tickets.filter((ticket) => ticket.status === "scoreboard-missing").length,
    rowInconsistent: tickets.filter((ticket) => ticket.status === "row-inconsistent").length,
    orphanRows: tickets.filter((ticket) => ticket.status === "orphan-row").length,
    inProgress: tickets.filter((ticket) => ticket.status === "in-progress").length,
    failed: tickets.filter((ticket) => ticket.status === "failed").length,
    totalPublishedScore: tickets.reduce((total, ticket) => total + (ticket.scoreboardRow?.score ?? 0), 0)
  };

  return {
    schemaVersion: "steambench.scoreboard-ops-report.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: reportStatus(totals),
    filters: {
      status: input.status,
      appid: input.appid,
      limit
    },
    totals,
    tickets,
    recommendedActions: actions(tickets),
    links: {
      standings: "/api/standings",
      leaderboards: "/api/leaderboards",
      seasons: "/api/seasons"
    }
  };
}
