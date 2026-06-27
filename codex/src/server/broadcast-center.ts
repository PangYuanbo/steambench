import type { BenchmarkTask } from "../benchmark/types";
import { buildBroadcastTimeline, type BroadcastTimelineItem } from "../runtime/broadcast";
import type { BenchmarkRun, LiveStreamSession, RunArtifact, RunProof, StoreSnapshot } from "./store";

export type BroadcastCenterRow = {
  stream: LiveStreamSession;
  run: BenchmarkRun;
  task: BenchmarkTask;
  eventCount: number;
  proofCount: number;
  artifactCount: number;
  checkpointCount: number;
  viewerCount: number;
  scoreboardReady: boolean;
  proofReady: boolean;
  latestEvent?: BroadcastTimelineItem;
  timelinePreview: BroadcastTimelineItem[];
};

export type BroadcastCenter = {
  generatedAt: string;
  totals: {
    broadcasts: number;
    live: number;
    scheduled: number;
    ended: number;
    failed: number;
    viewers: number;
    scoreboardReady: number;
    proofReady: number;
  };
  featured?: BroadcastCenterRow;
  live: BroadcastCenterRow[];
  recent: BroadcastCenterRow[];
  scoreboardReady: BroadcastCenterRow[];
};

function rowPriority(row: BroadcastCenterRow): number {
  if (row.stream.status === "live") return 0;
  if (row.scoreboardReady) return 1;
  if (row.stream.status === "scheduled") return 2;
  if (row.stream.status === "ended") return 3;
  return 4;
}

export function buildBroadcastCenter(input: {
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
  generatedAt?: string;
  limit?: number;
}): BroadcastCenter {
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  const limit = input.limit ?? 24;
  const rows: BroadcastCenterRow[] = input.snapshot.streams
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .flatMap((stream) => {
      const run = input.snapshot.runs.find((entry) => entry.id === stream.runId);
      const task = run ? taskById.get(run.taskId) : undefined;
      if (!run || !task) return [];
      const events = input.snapshot.events.filter((entry) => entry.runId === run.id);
      const proofs = input.snapshot.proofs.filter((entry) => entry.runId === run.id);
      const artifacts = input.snapshot.artifacts.filter((entry) => entry.runId === run.id);
      const timeline = buildBroadcastTimeline(events);
      const requiredPrimaryProof = task.track === "achievement" ? "steam-achievement" : "manual-review";
      const proofReady =
        proofs.some((proof) => proof.type === requiredPrimaryProof && proof.status === "verified") &&
        proofs.some((proof) => proof.type === "canonical-artifact" && proof.status === "verified");

      return {
        stream,
        run,
        task,
        eventCount: events.length,
        proofCount: proofs.length,
        artifactCount: artifacts.length,
        checkpointCount: events.filter((event) => event.type === "checkpoint").length,
        viewerCount: stream.viewerCount,
        scoreboardReady: run.status === "scored",
        proofReady,
        latestEvent: timeline.at(-1),
        timelinePreview: timeline.filter((event) => event.importance !== "low").slice(-4)
      };
    });

  const live = rows.filter((row) => row.stream.status === "live");
  const recent = rows.slice(0, limit);
  const scoreboardReady = rows.filter((row) => row.scoreboardReady).slice(0, limit);
  const featured = [...rows].sort(
    (a, b) => rowPriority(a) - rowPriority(b) || b.stream.createdAt.localeCompare(a.stream.createdAt)
  )[0];

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    totals: {
      broadcasts: rows.length,
      live: live.length,
      scheduled: rows.filter((row) => row.stream.status === "scheduled").length,
      ended: rows.filter((row) => row.stream.status === "ended").length,
      failed: rows.filter((row) => row.stream.status === "failed").length,
      viewers: rows.reduce((total, row) => total + row.viewerCount, 0),
      scoreboardReady: rows.filter((row) => row.scoreboardReady).length,
      proofReady: rows.filter((row) => row.proofReady).length
    },
    featured,
    live: live.slice(0, limit),
    recent,
    scoreboardReady
  };
}
