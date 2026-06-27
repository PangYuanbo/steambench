import type { BenchmarkTask } from "../benchmark/types";
import type { RuntimeRunEvent } from "../runtime/events";
import { buildRunAuditReport, type RunAuditReport } from "./run-audit";
import type { BenchmarkMatch, BenchmarkRun, BenchmarkSuiteRace, LiveStreamSession, RunArtifact, RunProof } from "./store";

export type SuiteRaceMatchAudit = {
  matchId: string;
  taskId: string;
  status: "scoreboard-ready" | "proof-missing" | "match-incomplete" | "failed" | "match-missing";
  match?: BenchmarkMatch;
  task?: BenchmarkTask;
  humanRun?: BenchmarkRun;
  agentRun?: BenchmarkRun;
  humanAudit?: RunAuditReport;
  agentAudit?: RunAuditReport;
  winner?: BenchmarkMatch["winner"];
  margin?: number;
  missing: string[];
};

export type SuiteRaceAuditReport = {
  race: BenchmarkSuiteRace;
  verdict: "scoreboard-ready" | "match-incomplete" | "blocked" | "in-progress";
  aggregate: {
    humanScore?: number;
    agentScore?: number;
    winner?: BenchmarkSuiteRace["winner"];
    margin?: number;
  };
  matches: SuiteRaceMatchAudit[];
  evidenceCounts: {
    matches: number;
    scoredMatches: number;
    runs: number;
    events: number;
    artifacts: number;
    proofs: number;
    streams: number;
  };
  missing: string[];
};

export type SuiteRaceAuditSummary = {
  raceId: string;
  suiteId: string;
  title: string;
  status: BenchmarkSuiteRace["status"];
  verdict: SuiteRaceAuditReport["verdict"];
  scoredMatches: number;
  totalMatches: number;
  missingCount: number;
  humanScore?: number;
  agentScore?: number;
  winner?: BenchmarkSuiteRace["winner"];
  updatedAt: string;
};

function firstById<T extends { id: string }>(items: T[], id?: string): T | undefined {
  return id ? items.find((entry) => entry.id === id) : undefined;
}

function runAuditFor(input: {
  run?: BenchmarkRun;
  task?: BenchmarkTask;
  events: RuntimeRunEvent[];
  artifacts: RunArtifact[];
  proofs: RunProof[];
  streams: LiveStreamSession[];
  scoreboard: Parameters<typeof buildRunAuditReport>[0]["scoreboard"];
}): RunAuditReport | undefined {
  if (!input.run || !input.task) return undefined;
  return buildRunAuditReport({
    run: input.run,
    task: input.task,
    events: input.events.filter((event) => event.runId === input.run?.id),
    artifacts: input.artifacts.filter((artifact) => artifact.runId === input.run?.id),
    proofs: input.proofs.filter((proof) => proof.runId === input.run?.id),
    streams: input.streams.filter((stream) => stream.runId === input.run?.id),
    scoreboard: input.scoreboard
  });
}

export function buildSuiteRaceAuditReport(input: {
  race: BenchmarkSuiteRace;
  matches: BenchmarkMatch[];
  tasks: BenchmarkTask[];
  runs: BenchmarkRun[];
  events: RuntimeRunEvent[];
  artifacts: RunArtifact[];
  proofs: RunProof[];
  streams: LiveStreamSession[];
  scoreboard: Parameters<typeof buildRunAuditReport>[0]["scoreboard"];
}): SuiteRaceAuditReport {
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  const runIds = new Set<string>();
  const missing: string[] = [];

  const matches = input.race.matchIds.map((matchId, index): SuiteRaceMatchAudit => {
    const match = input.matches.find((entry) => entry.id === matchId);
    const taskId = match?.taskId ?? input.race.taskIds[index] ?? "unknown-task";
    const task = taskById.get(taskId);
    const itemMissing: string[] = [];

    if (!match) itemMissing.push(`Missing child match ${matchId}.`);
    if (!task) itemMissing.push(`Missing task contract ${taskId}.`);

    const humanRun = firstById(input.runs, match?.humanRunId);
    const agentRun = firstById(input.runs, match?.agentRunId);
    if (match && !humanRun) itemMissing.push(`Missing human run for match ${match.id}.`);
    if (match && !agentRun) itemMissing.push(`Missing agent run for match ${match.id}.`);
    if (humanRun) runIds.add(humanRun.id);
    if (agentRun) runIds.add(agentRun.id);

    const humanAudit = runAuditFor({ run: humanRun, task, events: input.events, artifacts: input.artifacts, proofs: input.proofs, streams: input.streams, scoreboard: input.scoreboard });
    const agentAudit = runAuditFor({ run: agentRun, task, events: input.events, artifacts: input.artifacts, proofs: input.proofs, streams: input.streams, scoreboard: input.scoreboard });

    if (match && match.status !== "scored") itemMissing.push(`Match ${match.id} is ${match.status}, not scored.`);
    if (humanAudit && humanAudit.verdict !== "scoreboard-ready") itemMissing.push(`Human run ${humanAudit.run.id} audit is ${humanAudit.verdict}.`);
    if (agentAudit && agentAudit.verdict !== "scoreboard-ready") itemMissing.push(`Agent run ${agentAudit.run.id} audit is ${agentAudit.verdict}.`);

    const status: SuiteRaceMatchAudit["status"] =
      !match
        ? "match-missing"
        : match.status === "failed" || match.status === "canceled"
          ? "failed"
          : humanAudit?.verdict === "scoreboard-ready" && agentAudit?.verdict === "scoreboard-ready" && match.status === "scored"
            ? "scoreboard-ready"
            : humanAudit?.verdict === "proof-missing" || agentAudit?.verdict === "proof-missing"
              ? "proof-missing"
              : "match-incomplete";

    missing.push(...itemMissing);
    return {
      matchId,
      taskId,
      status,
      match,
      task,
      humanRun,
      agentRun,
      humanAudit,
      agentAudit,
      winner: match?.winner,
      margin: match?.margin,
      missing: itemMissing
    };
  });

  const scopedRuns = input.runs.filter((run) => runIds.has(run.id));
  const scopedEvents = input.events.filter((event) => runIds.has(event.runId));
  const scopedArtifacts = input.artifacts.filter((artifact) => runIds.has(artifact.runId));
  const scopedProofs = input.proofs.filter((proof) => runIds.has(proof.runId));
  const scopedStreams = input.streams.filter((stream) => runIds.has(stream.runId));
  const scoredMatches = matches.filter((entry) => entry.match?.status === "scored").length;
  const allMatchesReady = matches.length === input.race.matchIds.length && matches.every((entry) => entry.status === "scoreboard-ready");
  const verdict: SuiteRaceAuditReport["verdict"] =
    input.race.status === "blocked" || matches.some((entry) => entry.status === "match-missing" || entry.status === "failed")
      ? "blocked"
      : input.race.status === "scored" && allMatchesReady
        ? "scoreboard-ready"
        : missing.length > 0
          ? "match-incomplete"
          : "in-progress";

  return {
    race: input.race,
    verdict,
    aggregate: {
      humanScore: input.race.humanScore,
      agentScore: input.race.agentScore,
      winner: input.race.winner,
      margin: input.race.margin
    },
    matches,
    evidenceCounts: {
      matches: matches.length,
      scoredMatches,
      runs: scopedRuns.length,
      events: scopedEvents.length,
      artifacts: scopedArtifacts.length,
      proofs: scopedProofs.length,
      streams: scopedStreams.length
    },
    missing
  };
}

export function summarizeSuiteRaceAudit(report: SuiteRaceAuditReport): SuiteRaceAuditSummary {
  return {
    raceId: report.race.id,
    suiteId: report.race.suiteId,
    title: report.race.title,
    status: report.race.status,
    verdict: report.verdict,
    scoredMatches: report.evidenceCounts.scoredMatches,
    totalMatches: report.evidenceCounts.matches,
    missingCount: report.missing.length,
    humanScore: report.aggregate.humanScore,
    agentScore: report.aggregate.agentScore,
    winner: report.aggregate.winner,
    updatedAt: report.race.updatedAt
  };
}
