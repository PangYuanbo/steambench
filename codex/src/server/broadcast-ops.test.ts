import { describe, expect, it } from "vitest";
import type { BenchmarkTask } from "../benchmark/types";
import type { BenchmarkRun, LiveStreamSession } from "./store";
import type { BroadcastCenterRow } from "./broadcast-center";
import { buildBroadcastOpsReport } from "./broadcast-ops";

const task: BenchmarkTask = {
  id: "620:ACH.WAKE_UP",
  appid: 620,
  gameName: "Portal 2",
  title: "Wake Up Call",
  track: "achievement",
  level: 2,
  score: 3200,
  objective: "Unlock the benchmark achievement.",
  proof: ["Canonical output/output.mp4 video artifact.", "Steam achievement proof."],
  estimatedRuntimeMinutes: 8,
  suitability: "baseline",
  suitabilityScore: 80,
  reviewRequired: false,
  fairnessVerdict: "good",
  riskFlags: [],
  source: "fixture",
  signalSource: "steam-achievement"
};

function run(id: string, status: BenchmarkRun["status"]): BenchmarkRun {
  return {
    id,
    taskId: task.id,
    competitor: "agent:caster",
    competitorType: "agent",
    status,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:01:00.000Z",
    runtimeProvider: "local-sim",
    artifactName: "output.mp4",
    eventCount: 4,
    score: status === "scored" ? 4200 : undefined
  };
}

function stream(id: string, runId: string, status: LiveStreamSession["status"]): LiveStreamSession {
  return {
    id,
    runId,
    status,
    provider: "hls",
    title: id,
    ingestUrl: `/streams/${runId}/ingest`,
    playbackUrl: `/streams/${runId}.m3u8`,
    thumbnailUrl: `/streams/${runId}.jpg`,
    viewerCount: status === "live" ? 12 : 0,
    currentScene: status === "live" ? "Runtime live" : "Run complete",
    createdAt: "2026-06-14T00:00:00.000Z",
    startedAt: status === "live" ? "2026-06-14T00:00:10.000Z" : undefined,
    endedAt: status === "ended" ? "2026-06-14T00:02:00.000Z" : undefined
  };
}

function row(id: string, status: LiveStreamSession["status"], options: Partial<Pick<BroadcastCenterRow, "scoreboardReady" | "proofReady" | "artifactCount" | "eventCount">> = {}): BroadcastCenterRow {
  const benchmarkRun = run(`run_${id}`, options.scoreboardReady ? "scored" : status === "failed" ? "failed" : "running");
  return {
    stream: stream(`stream_${id}`, benchmarkRun.id, status),
    run: benchmarkRun,
    task,
    eventCount: options.eventCount ?? 4,
    proofCount: options.proofReady ? 2 : 0,
    artifactCount: options.artifactCount ?? (options.proofReady ? 1 : 0),
    checkpointCount: 1,
    viewerCount: status === "live" ? 12 : 0,
    scoreboardReady: Boolean(options.scoreboardReady),
    proofReady: Boolean(options.proofReady),
    timelinePreview: []
  };
}

describe("broadcast ops report", () => {
  it("summarizes public, live, and proof-missing broadcasts", () => {
    const report = buildBroadcastOpsReport({
      rows: [
        row("ready", "ended", { scoreboardReady: true, proofReady: true, artifactCount: 1 }),
        row("live", "live", { eventCount: 2 }),
        row("missing", "ended", { scoreboardReady: false, proofReady: false, artifactCount: 0 })
      ],
      limit: 10,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report).toMatchObject({
      schemaVersion: "steambench.broadcast-ops-report.v1",
      status: "needs-attention",
      totals: {
        broadcasts: 3,
        selectedBroadcasts: 3,
        live: 1,
        ended: 2,
        scoreboardReady: 1,
        proofReady: 1,
        proofMissing: 1,
        viewers: 12
      }
    });
    expect(report.tickets.map((ticket) => ticket.status)).toEqual([
      "scoreboard-ready",
      "live",
      "proof-missing"
    ]);
    expect(report.tickets[2].blockers).toContain("canonical_artifact_missing");
    expect(report.recommendedActions.map((action) => action.id)).toEqual([
      "end-live-broadcast",
      "inspect-proof-missing-broadcast",
      "share-broadcast-certificate",
      "inspect-broadcast-center"
    ]);
  });

  it("filters by broadcast ops ticket status", () => {
    const report = buildBroadcastOpsReport({
      rows: [
        row("ready", "ended", { scoreboardReady: true, proofReady: true, artifactCount: 1 }),
        row("missing", "ended")
      ],
      status: "scoreboard-ready",
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.status).toBe("ready-to-share");
    expect(report.totals.selectedBroadcasts).toBe(1);
    expect(report.tickets[0].status).toBe("scoreboard-ready");
    expect(report.recommendedActions.map((action) => action.id)).toEqual([
      "share-broadcast-certificate",
      "inspect-broadcast-center"
    ]);
  });

  it("recommends starting a scheduled broadcast before live monitoring", () => {
    const report = buildBroadcastOpsReport({
      rows: [
        row("scheduled", "scheduled", { eventCount: 1 }),
        row("live", "live", { eventCount: 2 })
      ],
      status: "scheduled",
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.status).toBe("monitoring");
    expect(report.totals.selectedBroadcasts).toBe(1);
    expect(report.tickets[0].status).toBe("scheduled");
    expect(report.recommendedActions[0]).toMatchObject({
      id: "start-scheduled-broadcast",
      method: "POST",
      endpoint: "/api/livestreams/stream_scheduled/status",
      body: {
        status: "live",
        currentScene: "Runtime live",
        viewerCount: 1
      }
    });
    expect(report.recommendedActions.map((action) => action.id)).toEqual([
      "start-scheduled-broadcast",
      "inspect-broadcast-center"
    ]);
  });
});
