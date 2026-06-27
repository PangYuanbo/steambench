import { describe, expect, it } from "vitest";
import type { BenchmarkTask, ScoreboardRow } from "../benchmark/types";
import type { BenchmarkRun, RunArtifact, RunProof, StoreSnapshot } from "./store";
import { buildScoreboardOpsReport } from "./scoreboard-ops";

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

function snapshot(): StoreSnapshot {
  return {
    users: [],
    agents: [],
    matches: [],
    challenges: [],
    suiteRaces: [],
    agentCampaigns: [],
    gameCoverageRuns: [],
    eventRegistrations: [],
    steamLinks: [],
    runs: [],
    dispatches: [],
    controlSessions: [],
    events: [],
    artifacts: [],
    streams: [],
    proofs: [],
    taskRegistry: [],
    steamAppDiscoveries: [],
    scoreboard: []
  };
}

function run(id: string, status: BenchmarkRun["status"], score = task.score): BenchmarkRun {
  return {
    id,
    taskId: task.id,
    competitor: `agent:${id}`,
    competitorType: "agent",
    status,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: `2026-06-14T00:0${id.length % 5}:00.000Z`,
    runtimeProvider: "local-sim",
    artifactName: "output.mp4",
    artifactPath: status === "scored" ? "output/output.mp4" : undefined,
    eventCount: 1,
    score: status === "scored" ? score : undefined
  };
}

function artifact(runId: string): RunArtifact {
  return {
    id: `art_${runId}`,
    runId,
    kind: "video",
    name: "output.mp4",
    uri: `local://${runId}/output.mp4`,
    createdAt: "2026-06-14T00:00:00.000Z",
    canonical: true
  };
}

function proof(runId: string, type: RunProof["type"]): RunProof {
  return {
    id: `proof_${runId}_${type}`,
    runId,
    type,
    status: "verified",
    createdAt: "2026-06-14T00:00:00.000Z",
    verifiedAt: "2026-06-14T00:00:01.000Z",
    summary: `${type} verified`
  };
}

function row(run: BenchmarkRun): ScoreboardRow {
  return {
    rank: 1,
    runId: run.id,
    taskId: task.id,
    appid: task.appid,
    competitor: run.competitor,
    type: run.competitorType,
    game: task.gameName,
    task: task.title,
    track: task.track,
    level: task.level,
    score: run.score ?? task.score,
    evidence: "Steam proof + output.mp4",
    completedAt: "2026-06-14"
  };
}

describe("scoreboard ops report", () => {
  it("summarizes ready, proof-missing, missing-row, and orphan scoreboard tickets", () => {
    const store = snapshot();
    const readyRun = run("run_ready", "scored", 5000);
    const proofMissingRun = run("run_missing_proof", "artifact-submitted");
    const scoreboardMissingRun = run("run_missing_row", "scored", 4400);
    store.runs.push(readyRun, proofMissingRun, scoreboardMissingRun);
    store.artifacts.push(artifact(readyRun.id), artifact(scoreboardMissingRun.id));
    store.proofs.push(
      proof(readyRun.id, "canonical-artifact"),
      proof(readyRun.id, "steam-achievement"),
      proof(scoreboardMissingRun.id, "canonical-artifact"),
      proof(scoreboardMissingRun.id, "steam-achievement")
    );
    store.scoreboard.push(row(readyRun), {
      ...row({ ...readyRun, id: "run_deleted", competitor: "agent:deleted" }),
      rank: 2,
      runId: "run_deleted"
    });

    const report = buildScoreboardOpsReport({
      snapshot: store,
      tasks: [task],
      appid: 620,
      limit: 20,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report).toMatchObject({
      schemaVersion: "steambench.scoreboard-ops-report.v1",
      status: "needs-attention",
      filters: {
        appid: 620,
        limit: 20
      },
      totals: {
        runs: 3,
        scoreboardRows: 2,
        selectedTickets: 4,
        scoreboardReady: 1,
        proofMissing: 1,
        scoreboardMissing: 1,
        orphanRows: 1
      }
    });
    expect(report.tickets.map((ticket) => ticket.status)).toEqual([
      "proof-missing",
      "orphan-row",
      "scoreboard-missing",
      "scoreboard-ready"
    ]);
    expect(report.tickets[0].blockers).toContain("steam_achievement_missing");
    expect(report.tickets[1].blockers).toContain("scoreboard_row_without_run");
    expect(report.recommendedActions.map((action) => action.id)).toEqual([
      "republish-scoreboard-row",
      "inspect-proof-missing-run",
      "inspect-scoreboard-inconsistency",
      "share-standings",
      "inspect-standings"
    ]);
  });

  it("filters by scoreboard ops status", () => {
    const store = snapshot();
    const readyRun = run("run_ready", "scored", 5000);
    const incompleteRun = run("run_incomplete", "running");
    store.runs.push(readyRun, incompleteRun);
    store.artifacts.push(artifact(readyRun.id));
    store.proofs.push(proof(readyRun.id, "canonical-artifact"), proof(readyRun.id, "steam-achievement"));
    store.scoreboard.push(row(readyRun));

    const report = buildScoreboardOpsReport({
      snapshot: store,
      tasks: [task],
      status: "scoreboard-ready",
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.status).toBe("ready-to-share");
    expect(report.totals.selectedTickets).toBe(1);
    expect(report.tickets[0].status).toBe("scoreboard-ready");
    expect(report.recommendedActions.map((action) => action.id)).toEqual([
      "share-standings",
      "inspect-standings"
    ]);
  });
});
