import { describe, expect, it } from "vitest";
import { buildFixtureTasks } from "../benchmark/task-generator";
import { createSteambenchApp } from "./app";
import { SteambenchStore } from "./store";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("SteambenchStore", () => {
  it("supports the local competition lifecycle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-store-"));
    const store = new SteambenchStore(join(dir, "store.json"));

    try {
      const link = await store.createSteamLinkIntent("http://127.0.0.1:5173");
      expect(link.status).toBe("pending");

      const user = await store.createUser({
        handle: "human-astra",
        type: "human"
      });
      expect(user.handle).toBe("human-astra");

      const linked = await store.markSteamLinked(
        link.state,
        "76561198000000000",
        "https://steamcommunity.com/openid/id/76561198000000000"
      );
      expect(linked?.status).toBe("linked");
      expect(linked?.claimedId).toBe("https://steamcommunity.com/openid/id/76561198000000000");

      const linkedUser = await store.linkSteamToUser(user.id, "76561198000000000", { proofConsent: true });
      expect(linkedUser?.linkedSteamId).toBe("76561198000000000");

      const task = buildFixtureTasks()[0];
      const run = await store.createRun({
        taskId: task.id,
        competitor: "Codex Runner",
        competitorType: "agent"
      });
      expect(run?.artifactName).toBe("output.mp4");
      expect(run?.eventCount).toBe(0);

      const claimed = await store.claimRun(run!.id, {
        workerId: "worker-a",
        runtimeProvider: "local-sim",
        leaseMinutes: 10
      });
      expect(claimed?.status).toBe("preparing");
      expect(claimed?.workerId).toBe("worker-a");
      expect(claimed?.leaseExpiresAt).toBeDefined();

      const heartbeat = await store.heartbeatRun(run!.id, "worker-a", 10);
      expect(heartbeat?.heartbeatAt).toBeDefined();

      const event = await store.appendRunEvent({
        runId: run!.id,
        type: "launch",
        message: "Runtime launched",
        idempotencyKey: "launch-once"
      });
      expect(event?.type).toBe("launch");
      const duplicateEvent = await store.appendRunEvent({
        runId: run!.id,
        type: "launch",
        message: "Runtime launched again",
        idempotencyKey: "launch-once"
      });
      expect(duplicateEvent?.id).toBe(event?.id);

      const withArtifact = await store.attachArtifact(run!.id, "output/output.mp4");
      expect(withArtifact?.status).toBe("artifact-submitted");
      expect(withArtifact?.eventCount).toBe(1);
      const runDetail = await store.getRun(run!.id);
      expect(runDetail?.artifacts[0]).toMatchObject({
        name: "output.mp4",
        canonical: true
      });
      expect(runDetail?.proofs.some((proof) => proof.type === "canonical-artifact" && proof.status === "verified")).toBe(true);

      const stream = await store.createLiveStream(run!.id, "Runtime test stream");
      expect(stream?.status).toBe("scheduled");
      const liveStream = await store.updateLiveStreamStatus(stream!.id, "live");
      expect(liveStream?.startedAt).toBeDefined();

      const wrongWorkerFailure = await store.failRun(run!.id, {
        code: "wrong_worker",
        message: "wrong worker",
        workerId: "worker-b"
      });
      expect(wrongWorkerFailure).toBeNull();

      const missingProofEvaluation = await store.evaluateRun(run!.id);
      expect(missingProofEvaluation?.passed).toBe(false);
      expect(missingProofEvaluation?.missingProofs).toContain("steam-achievement");

      await store.createRunProof({
        runId: run!.id,
        type: "steam-achievement",
        status: "verified",
        summary: "Steam proof verified"
      });

      const scored = await store.scoreRun(run!.id);
      expect(scored?.run.status).toBe("scored");
      expect(scored?.row.score).toBe(task.score);

      const snapshot = await store.read();
      expect(snapshot.scoreboard[0].score).toBeGreaterThanOrEqual(scored!.row.score);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("requeues expired worker leases without touching active or completed runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-lease-recovery-"));
    const store = new SteambenchStore(join(dir, "store.json"));

    try {
      const [task] = buildFixtureTasks();
      const expired = await store.createRun({
        taskId: task.id,
        competitor: "expired-worker-agent",
        competitorType: "agent"
      });
      const active = await store.createRun({
        taskId: task.id,
        competitor: "active-worker-agent",
        competitorType: "agent"
      });
      const completed = await store.createRun({
        taskId: task.id,
        competitor: "completed-worker-agent",
        competitorType: "agent"
      });

      await store.claimRun(expired!.id, {
        workerId: "worker-expired",
        leaseMinutes: -1
      });
      await store.claimRun(active!.id, {
        workerId: "worker-active",
        leaseMinutes: 30
      });
      await store.claimRun(completed!.id, {
        workerId: "worker-completed",
        leaseMinutes: -1
      });
      await store.failRun(completed!.id, {
        code: "already_failed",
        message: "Completed terminal state should not be requeued.",
        workerId: "worker-completed"
      });

      const queueBefore = await store.listWorkerQueue();
      expect(queueBefore.expired.map((run) => run.id)).toContain(expired!.id);
      expect(queueBefore.expired.map((run) => run.id)).not.toContain(completed!.id);

      const recovered = await store.requeueExpiredRuns({
        reason: "test lease expiry"
      });
      expect(recovered.map((run) => run.id)).toEqual([expired!.id]);

      const snapshot = await store.read();
      const recoveredRun = snapshot.runs.find((run) => run.id === expired!.id);
      const activeRun = snapshot.runs.find((run) => run.id === active!.id);
      const failedRun = snapshot.runs.find((run) => run.id === completed!.id);
      expect(recoveredRun).toMatchObject({
        status: "queued",
        workerId: undefined,
        leaseExpiresAt: undefined
      });
      expect(activeRun).toMatchObject({
        status: "preparing",
        workerId: "worker-active"
      });
      expect(failedRun?.status).toBe("failed");
      expect(snapshot.events.some((event) => event.runId === expired!.id && event.message === "test lease expiry")).toBe(true);

      const reclaimed = await store.claimNextRun({
        workerId: "worker-reclaimed",
        leaseMinutes: 5
      });
      expect(reclaimed?.id).toBe(expired!.id);
      expect(reclaimed?.workerId).toBe("worker-reclaimed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects non-canonical artifact names at the API boundary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-api-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const task = buildFixtureTasks()[0];

      const runResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          competitor: "contract-test-agent",
          competitorType: "agent"
        })
      });
      const runPayload = await runResponse.json();

      const badArtifactResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/artifact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifactPath: "output/output-test.mp4" })
      });

      expect(badArtifactResponse.status).toBe(400);
      expect(await badArtifactResponse.json()).toMatchObject({
        error: "invalid_artifact_name"
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exposes a platform-wide ops rollup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-platform-ops-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "platform-human", type: "human" })
      });
      await fetch(`${baseUrl}/api/agents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: "platform-agent",
          provider: "local",
          capabilities: ["keyboard-mouse", "controller", "turn-based-actions", "screen-capture", "stats-screen", "action-log", "seeded-save", "manual-review", "output.mp4"]
        })
      });

      const opsResponse = await fetch(`${baseUrl}/api/platform/ops-report?scope=weekly&limit=10`);
      const opsPayload = await opsResponse.json();
      expect(opsResponse.status).toBe(200);
      expect(opsPayload.report).toMatchObject({
        schemaVersion: "steambench.platform-ops-report.v1",
        filters: {
          scope: "weekly",
          limit: 10
        },
        totals: {
          humans: 1,
          agents: 1,
          activeAgents: 1,
          humanProofReadyTickets: expect.any(Number),
          humanProofReadyTasks: expect.any(Number),
          humanProofConsentRequired: expect.any(Number),
          humanProofSteamNotLinked: expect.any(Number),
          humanAgentComparisons: expect.any(Number),
          humanAgentCompleteComparisons: expect.any(Number),
          humanAgentIncompleteComparisons: expect.any(Number),
          humanAgentShareReadyComparisons: expect.any(Number),
          humanAgentHumanMissingTasks: expect.any(Number),
          humanAgentAgentMissingTasks: expect.any(Number),
          blueprintGames: expect.any(Number),
          blueprintOutputMp4Contracts: expect.any(Number),
          blueprintStage2Contracts: expect.any(Number),
          competitionGames: expect.any(Number),
          competitionCoverageGaps: expect.any(Number)
        },
        links: {
          taskReviewCatalog: "/api/tasks/review-catalog",
          benchmarkBlueprintOps: "/api/games/:appid/benchmark-blueprint",
          gameCompetitionOps: "/api/games/:appid/competition/ops-report",
          humanProofOps: "/api/human-proof/ops-report",
          humanAgentComparisonOps: "/api/comparisons/human-agent/ops-report",
          agentOps: "/api/agents/ops-report",
          actionSpaces: "/api/runtime/action-spaces",
          agentTraceOps: "/api/agent-traces/ops-report",
          humanOnboarding: "/api/human-onboarding/ops-report",
          dispatchOps: "/api/dispatches/ops-report",
          controlBridgeOps: "/api/control-sessions/ops-report",
          challengeOps: "/api/challenges/ops-report",
          matchArenaOps: "/api/matches/arena-ops-report"
        }
      });
      expect(opsPayload.report.subsystems.map((entry: { id: string }) => entry.id)).toEqual([
        "steam-sources",
        "task-review",
        "benchmark-blueprints",
        "game-competition",
        "human-onboarding",
        "human-proof",
        "human-agent-comparisons",
        "agent-runtime",
        "action-spaces",
        "runtime-dispatch",
        "agent-traces",
        "control-bridge",
        "challenges",
        "match-arena",
        "scoreboard",
        "broadcasts",
        "events"
      ]);
      expect(opsPayload.report.recommendedActions.some((action: { id: string }) =>
        action.id === "human-onboarding:link-steam" || action.id === "agent-runtime:open-agent-run-session"
      )).toBe(true);
      expect(opsPayload.report.recommendedActions).toContainEqual(expect.objectContaining({
        id: "events:register-agent",
        endpoint: "/api/competition-events/weekly/register",
        body: {
          participantType: "agent",
          participantId: expect.any(String)
        }
      }));

      const invalidResponse = await fetch(`${baseUrl}/api/platform/ops-report?scope=monthly`);
      expect(invalidResponse.status).toBe(400);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks evaluation until both Steam and canonical artifact proof are verified", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-eval-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const task = buildFixtureTasks()[0];

      const runResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          competitor: "eval-test-agent",
          competitorType: "agent"
        })
      });
      const runPayload = await runResponse.json();

      const failedEvaluation = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/evaluate`, {
        method: "POST"
      });
      expect(failedEvaluation.status).toBe(422);
      expect((await failedEvaluation.json()).evaluation.missingProofs).toEqual([
        "steam-achievement",
        "canonical-artifact"
      ]);

      const auditResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/audit`);
      const auditPayload = await auditResponse.json();
      expect(auditResponse.status).toBe(200);
      expect(auditPayload.audit).toMatchObject({
        verdict: "proof-missing",
        missingProofs: ["steam-achievement", "canonical-artifact"]
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("scores non-achievement tasks with manual review and canonical artifact proof", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-manual-review-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const task = buildFixtureTasks().find((entry) => entry.track === "leaderboard");
      expect(task).toBeDefined();

      const runResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task!.id,
          competitor: "manual-review-agent",
          competitorType: "agent"
        })
      });
      const runPayload = await runResponse.json();

      await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/artifact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifactPath: "output/output.mp4" })
      });

      const failedEvaluation = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/evaluate`, {
        method: "POST"
      });
      expect(failedEvaluation.status).toBe(422);
      expect((await failedEvaluation.json()).evaluation.missingProofs).toEqual(["manual-review"]);

      const proofResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/proofs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "manual-review",
          status: "verified",
          summary: "Leaderboard run reviewed",
          metadata: {
            metricName: task!.metricName,
            metricValue: 1550,
            targetValue: task!.targetValue
          }
        })
      });
      expect(proofResponse.status).toBe(201);

      const passedEvaluation = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/evaluate`, {
        method: "POST"
      });
      const passedPayload = await passedEvaluation.json();
      expect(passedEvaluation.status).toBe(200);
      expect(passedPayload.evaluation.passed).toBe(true);
      expect(passedPayload.evaluation.row.task).toBe(task!.title);
      expect(passedPayload.evaluation.row.score).toBeGreaterThan(task!.score);
      expect(passedPayload.evaluation.run.scoreMetadata).toMatchObject({
        scoringMode: "metric",
        metricValue: 1550,
        direction: "higher-is-better"
      });

      const leaderboardsResponse = await fetch(`${baseUrl}/api/leaderboards`);
      const leaderboardsPayload = await leaderboardsResponse.json();
      expect(leaderboardsResponse.status).toBe(200);
      const taskLeaderboard = leaderboardsPayload.leaderboards.find((entry: { taskId?: string }) => entry.taskId === task!.id);
      expect(taskLeaderboard).toMatchObject({
        taskId: task!.id,
        metricName: task!.metricName,
        leader: expect.objectContaining({
          competitor: "manual-review-agent",
          metricValue: 1550,
          taskRank: 1
        })
      });

      const singleLeaderboardResponse = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(task!.id)}/leaderboard`);
      const singleLeaderboardPayload = await singleLeaderboardResponse.json();
      expect(singleLeaderboardResponse.status).toBe(200);
      expect(singleLeaderboardPayload.leaderboard.entries[0]).toMatchObject({
        competitor: "manual-review-agent",
        score: passedPayload.evaluation.row.score
      });

      const reviewResponse = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(task!.id)}/review`);
      const reviewPayload = await reviewResponse.json();
      expect(reviewResponse.status).toBe(200);
      expect(reviewPayload.review).toMatchObject({
        taskId: task!.id,
        decision: "review-required",
        fairnessVerdict: "controlled"
      });
      expect(reviewPayload.review.controls.join(" ")).toContain("Snapshot leaderboard rules");

      const reviewCatalogResponse = await fetch(`${baseUrl}/api/tasks/review-catalog?decision=review-required&fairnessVerdict=controlled&limit=5`);
      const reviewCatalogPayload = await reviewCatalogResponse.json();
      expect(reviewCatalogResponse.status).toBe(200);
      expect(reviewCatalogPayload.catalog.totals.reviewRequired).toBeGreaterThan(0);
      expect(reviewCatalogPayload.catalog.entries.every((entry: { review: { decision: string; fairnessVerdict: string } }) =>
        entry.review.decision === "review-required" && entry.review.fairnessVerdict === "controlled"
      )).toBe(true);
      expect(reviewCatalogPayload.catalog.reviewQueue.some((entry: { task: { id: string } }) => entry.task.id === task!.id)).toBe(true);

      const invalidReviewCatalogResponse = await fetch(`${baseUrl}/api/tasks/review-catalog?riskFlag=not-a-risk`);
      expect(invalidReviewCatalogResponse.status).toBe(400);

      const repeatedEvaluation = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/evaluate`, {
        method: "POST"
      });
      expect(repeatedEvaluation.status).toBe(200);
      const repeatedLeaderboardResponse = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(task!.id)}/leaderboard`);
      const repeatedLeaderboardPayload = await repeatedLeaderboardResponse.json();
      const entriesForRun = repeatedLeaderboardPayload.leaderboard.entries.filter(
        (entry: { runId?: string }) => entry.runId === runPayload.run.id
      );
      expect(entriesForRun).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts metric submissions through a single run submission receipt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-submission-receipt-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const task = buildFixtureTasks().find((entry) => entry.track === "leaderboard");
      expect(task).toBeDefined();

      const runResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task!.id,
          competitor: "receipt-agent",
          competitorType: "agent"
        })
      });
      const runPayload = await runResponse.json();

      const submissionResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/submission`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          artifactPath: "output/output.mp4",
          metricValue: 1800,
          summary: "Receipt metric proof accepted"
        })
      });
      const submissionPayload = await submissionResponse.json();
      expect(submissionResponse.status).toBe(201);
      expect(submissionPayload.receipt).toMatchObject({
        schemaVersion: "steambench.run-submission-receipt.v1",
        scoreboardReady: true
      });
      expect(submissionPayload.evaluation.row).toMatchObject({
        competitor: "receipt-agent",
        metricValue: 1800
      });
      expect(submissionPayload.run.scoreMetadata).toMatchObject({
        scoringMode: "metric",
        metricValue: 1800
      });
      expect(submissionPayload.audit.verdict).toBe("scoreboard-ready");
      expect(submissionPayload.bundle.integrity.scoreboardPublished).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("simulates an agent run with event evidence and scoring", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-sim-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const task = buildFixtureTasks()[0];

      const runResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          competitor: "agent-runtime-test",
          competitorType: "agent"
        })
      });
      const runPayload = await runResponse.json();

      const claimResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workerId: "agent-runtime-test-worker",
          runtimeProvider: "local-sim"
        })
      });
      expect(claimResponse.status).toBe(200);

      const heartbeatResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/heartbeat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workerId: "agent-runtime-test-worker",
          idempotencyKey: "heartbeat-once"
        })
      });
      expect(heartbeatResponse.status).toBe(200);

      const presignResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/artifacts/presign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "output.mp4",
          canonical: true
        })
      });
      const presignPayload = await presignResponse.json();
      expect(presignPayload.upload.url).toContain("local-artifact://");

      const simResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/simulate-agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const simPayload = await simResponse.json();

      expect(simResponse.status).toBe(200);
      expect(simPayload.events.map((event: { type: string }) => event.type)).toEqual([
        "plan",
        "launch",
        "observe",
        "act",
        "proof"
      ]);
      expect(simPayload.run.status).toBe("scored");
      expect(simPayload.evaluation.passed).toBe(true);
      expect(simPayload.run.eventCount).toBe(7);
      const runDetail = await store.getRun(runPayload.run.id);
      expect(runDetail?.artifacts.some((artifact) => artifact.name === "output.mp4")).toBe(true);
      expect(runDetail?.proofs.some((proof) => proof.type === "steam-achievement" && proof.status === "verified")).toBe(true);
      expect(runDetail?.proofs.some((proof) => proof.type === "canonical-artifact" && proof.status === "verified")).toBe(true);
      expect(runDetail?.proofs.some((proof) => proof.type === "livestream" && proof.status === "verified")).toBe(true);
      expect(runDetail?.streams.some((stream) => stream.status === "ended")).toBe(true);

      const auditResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/audit`);
      const auditPayload = await auditResponse.json();
      expect(auditResponse.status).toBe(200);
      expect(auditPayload.audit).toMatchObject({
        verdict: "scoreboard-ready",
        canonicalArtifact: {
          name: "output.mp4",
          canonical: true
        },
        scoreboardRow: {
          runId: runPayload.run.id
        },
        evidenceCounts: {
          artifacts: 1,
          streams: 1
        }
      });
      expect(auditPayload.audit.requiredProofs.every((proof: { verified: boolean }) => proof.verified)).toBe(true);

      const evidenceBundleResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/evidence-bundle`);
      const evidenceBundlePayload = await evidenceBundleResponse.json();
      expect(evidenceBundleResponse.status).toBe(200);
      expect(evidenceBundlePayload.bundle).toMatchObject({
        schemaVersion: "steambench.evidence-bundle.v1",
        runId: runPayload.run.id,
        manifest: {
          schemaVersion: "steambench.execution-manifest.v1",
          artifactContract: {
            name: "output.mp4",
            path: "output/output.mp4"
          }
        },
        integrity: {
          verdict: "scoreboard-ready",
          canonicalArtifactPresent: true,
          requiredProofsVerified: true,
          scoreboardPublished: true
        }
      });
      expect(evidenceBundlePayload.bundle.integrity.checklist.every((item: { status: string }) => item.status === "pass")).toBe(true);

      const runCertificateResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/result-certificate`);
      const runCertificatePayload = await runCertificateResponse.json();
      expect(runCertificateResponse.status).toBe(200);
      expect(runCertificatePayload.certificate).toMatchObject({
        schemaVersion: "steambench.result-certificate.v1",
        kind: "run",
        id: runPayload.run.id,
        verdict: "scoreboard-ready",
        canonicalArtifactName: "output.mp4",
        result: {
          scoreboardRows: 1
        },
        evidence: {
          bundleReady: true
        },
        integrity: {
          readyForPublicShare: true
        }
      });
      expect(runCertificatePayload.certificate.links.evidenceBundle).toBe(`${baseUrl}/api/runs/${runPayload.run.id}/evidence-bundle`);

      const stateResponse = await fetch(`${baseUrl}/api/state`);
      const statePayload = await stateResponse.json();
      expect(statePayload.auditSummaries.some((audit: { runId: string; verdict: string }) => audit.runId === runPayload.run.id && audit.verdict === "scoreboard-ready")).toBe(true);
      expect(statePayload.gameProfiles.some((profile: { game: { appid: number }; totals: { activeTasks: number } }) =>
        profile.game.appid === task.appid && profile.totals.activeTasks > 0
      )).toBe(true);

      const broadcastListResponse = await fetch(`${baseUrl}/api/broadcasts`);
      const broadcastListPayload = await broadcastListResponse.json();
      expect(broadcastListResponse.status).toBe(200);
      expect(broadcastListPayload.broadcasts[0].stream.status).toBe("ended");
      expect(broadcastListPayload.center).toMatchObject({
        totals: {
          broadcasts: 1,
          ended: 1,
          scoreboardReady: 1,
          proofReady: 1
        }
      });
      expect(broadcastListPayload.center.featured.stream.runId).toBe(runPayload.run.id);

      const broadcastCenterResponse = await fetch(`${baseUrl}/api/broadcasts/center`);
      const broadcastCenterPayload = await broadcastCenterResponse.json();
      expect(broadcastCenterResponse.status).toBe(200);
      expect(broadcastCenterPayload.center.scoreboardReady[0]).toMatchObject({
        stream: {
          runId: runPayload.run.id
        },
        task: {
          id: task.id
        },
        checkpointCount: 1,
        scoreboardReady: true,
        proofReady: true
      });

      const broadcastOpsResponse = await fetch(`${baseUrl}/api/broadcasts/ops-report?limit=5`);
      const broadcastOpsPayload = await broadcastOpsResponse.json();
      expect(broadcastOpsResponse.status).toBe(200);
      expect(broadcastOpsPayload.report).toMatchObject({
        schemaVersion: "steambench.broadcast-ops-report.v1",
        status: "ready-to-share",
        totals: {
          broadcasts: 1,
          selectedBroadcasts: 1,
          scoreboardReady: 1,
          proofReady: 1
        }
      });
      expect(broadcastOpsPayload.report.tickets[0]).toMatchObject({
        stream: {
          runId: runPayload.run.id
        },
        status: "scoreboard-ready",
        readiness: "public",
        links: {
          resultCertificate: `/api/broadcasts/${broadcastListPayload.broadcasts[0].stream.id}/result-certificate`
        }
      });
      expect(broadcastOpsPayload.report.recommendedActions.map((entry: { id: string }) => entry.id)).toContain("share-broadcast-certificate");

      const scoreboardOpsResponse = await fetch(`${baseUrl}/api/scoreboard/ops-report?status=scoreboard-ready&appid=${task.appid}&limit=5`);
      const scoreboardOpsPayload = await scoreboardOpsResponse.json();
      expect(scoreboardOpsResponse.status).toBe(200);
      expect(scoreboardOpsPayload.report).toMatchObject({
        schemaVersion: "steambench.scoreboard-ops-report.v1",
        status: "ready-to-share",
        filters: {
          status: "scoreboard-ready",
          appid: task.appid,
          limit: 5
        },
        totals: {
          selectedTickets: 1,
          scoreboardReady: 1
        }
      });
      expect(scoreboardOpsPayload.report.tickets[0]).toMatchObject({
        run: {
          id: runPayload.run.id,
          status: "scored"
        },
        status: "scoreboard-ready",
        readiness: "public",
        audit: {
          verdict: "scoreboard-ready",
          scoreboardRowPresent: true
        }
      });
      expect(scoreboardOpsPayload.report.recommendedActions.map((entry: { id: string }) => entry.id)).toContain("share-standings");

      const gameProfileResponse = await fetch(`${baseUrl}/api/games/${task.appid}/profile`);
      const gameProfilePayload = await gameProfileResponse.json();
      expect(gameProfileResponse.status).toBe(200);
      expect(gameProfilePayload.profile).toMatchObject({
        game: {
          appid: task.appid
        },
        totals: {
          activeTasks: expect.any(Number),
          scoreboardRows: expect.any(Number),
          scoreboardReadyBroadcasts: expect.any(Number)
        },
        competition: {
          activeTasks: expect.any(Number),
          scoredTasks: expect.any(Number),
          coveragePercent: expect.any(Number)
        }
      });
      expect(gameProfilePayload.profile.topTasks.some((entry: { task: { id: string } }) => entry.task.id === task.id)).toBe(true);
      expect(gameProfilePayload.profile.suites.some((suite: { appid: number }) => suite.appid === task.appid)).toBe(true);
      expect(gameProfilePayload.profile.broadcasts.some((entry: { stream: { runId: string } }) => entry.stream.runId === runPayload.run.id)).toBe(true);

      const gameStandingsResponse = await fetch(`${baseUrl}/api/games/${task.appid}/standings`);
      const gameStandingsPayload = await gameStandingsResponse.json();
      expect(gameStandingsResponse.status).toBe(200);
      expect(gameStandingsPayload.standings).toMatchObject({
        schemaVersion: "steambench.game-competition-standings.v1",
        game: {
          appid: task.appid
        },
        season: {
          scope: "all"
        },
        totals: {
          scoreboardRows: expect.any(Number),
          activeTasks: expect.any(Number),
          scoredTasks: expect.any(Number)
        },
        summary: {
          activeTasks: expect.any(Number),
          scoredTasks: expect.any(Number),
          coveragePercent: expect.any(Number)
        }
      });
      expect(gameStandingsPayload.standings.taskLeaderboards.some((leaderboard: { taskId?: string; entries: unknown[] }) =>
        leaderboard.taskId === task.id && leaderboard.entries.length > 0
      )).toBe(true);
      expect(gameStandingsPayload.standings.taskCoverage.some((entry: { taskId: string; scoredRows: number }) =>
        entry.taskId === task.id && entry.scoredRows > 0
      )).toBe(true);
      expect(gameStandingsPayload.standings.summary.coveragePercent).toBeLessThanOrEqual(100);
      expect(gameStandingsPayload.standings.totals.scoredTasks).toBeLessThanOrEqual(gameStandingsPayload.standings.totals.activeTasks);

      const gameCoveragePlanResponse = await fetch(`${baseUrl}/api/games/${task.appid}/coverage-plan?limit=50`);
      const gameCoveragePlanPayload = await gameCoveragePlanResponse.json();
      expect(gameCoveragePlanResponse.status).toBe(200);
      expect(gameCoveragePlanPayload.plan).toMatchObject({
        schemaVersion: "steambench.game-coverage-plan.v1",
        game: {
          appid: task.appid
        },
        totals: {
          activeTasks: expect.any(Number),
          humanGaps: expect.any(Number),
          agentGaps: expect.any(Number),
          readyHumanActions: expect.any(Number),
          readyAgentActions: expect.any(Number),
          blockedTasks: expect.any(Number)
        },
        links: {
          standings: `/api/games/${task.appid}/standings`,
          evidenceBundle: `/api/games/${task.appid}/evidence-bundle`,
          resultCertificate: `/api/games/${task.appid}/result-certificate`
        }
      });
      expect(gameCoveragePlanPayload.plan.items.some((entry: { task: { id: string }; scoreboard: { rows: number }; gaps: string[] }) =>
        entry.task.id === task.id && entry.scoreboard.rows > 0 && Array.isArray(entry.gaps)
      )).toBe(true);

      const coverageHuman = await store.createUser({
        handle: "coverage-human",
        displayName: "Coverage Human",
        type: "human"
      });
      await store.linkSteamToUser(coverageHuman.id, "76561198000000011", { proofConsent: true });
      const coverageAgent = await store.createAgentProfile({
        handle: "coverage-agent",
        displayName: "Coverage Agent"
      });
      const coverageScheduleResponse = await fetch(`${baseUrl}/api/games/${task.appid}/coverage-plan/schedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          humanUserId: coverageHuman.id,
          agentId: coverageAgent.id,
          limit: 2,
          provider: "local",
          dispatch: true
        })
      });
      const coverageSchedulePayload = await coverageScheduleResponse.json();
      expect(coverageScheduleResponse.status).toBe(201);
      expect(coverageSchedulePayload.schedule).toMatchObject({
        schemaVersion: "steambench.game-coverage-schedule.v1",
        appid: task.appid,
        requestedSide: "both",
        provider: "local",
        dispatch: true,
        selectedHuman: {
          id: coverageHuman.id
        },
        selectedAgent: {
          id: coverageAgent.id
        },
        totals: {
          queuedRuns: expect.any(Number),
          agentRuns: expect.any(Number),
          dispatches: expect.any(Number)
        },
        links: {
          coveragePlan: `/api/games/${task.appid}/coverage-plan`,
          dispatches: "/api/dispatches"
        }
      });
      expect(coverageSchedulePayload.schedule.totals.queuedRuns).toBeGreaterThan(0);
      expect(coverageSchedulePayload.schedule.totals.dispatches).toBe(coverageSchedulePayload.schedule.totals.agentRuns);
      expect(coverageSchedulePayload.schedule.items.every((entry: { run: { status: string; artifactName: string } }) =>
        entry.run.status === "queued" && entry.run.artifactName === "output.mp4"
      )).toBe(true);

      const coverageRunHuman = await store.createUser({
        handle: "coverage-run-human",
        displayName: "Coverage Run Human",
        type: "human"
      });
      await store.linkSteamToUser(coverageRunHuman.id, "76561198000000012", { proofConsent: true });
      const coverageRunAgent = await store.createAgentProfile({
        handle: "coverage-run-agent",
        displayName: "Coverage Run Agent"
      });
      const coverageLocalRunResponse = await fetch(`${baseUrl}/api/games/${task.appid}/coverage-plan/run-local`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          humanUserId: coverageRunHuman.id,
          agentId: coverageRunAgent.id,
          limit: 2
        })
      });
      const coverageLocalRunPayload = await coverageLocalRunResponse.json();
      expect(coverageLocalRunResponse.status).toBe(201);
      expect(coverageLocalRunPayload.result).toMatchObject({
        schemaVersion: "steambench.game-coverage-local-run.v1",
        appid: task.appid,
        record: {
          appid: task.appid,
          status: "scoreboard-ready"
        },
        selectedHuman: {
          id: coverageRunHuman.id
        },
        selectedAgent: {
          id: coverageRunAgent.id
        },
        totals: {
          completedRuns: expect.any(Number),
          scoreboardReady: expect.any(Number)
        },
        links: {
          coveragePlan: `/api/games/${task.appid}/coverage-plan`,
          standings: `/api/games/${task.appid}/standings`
        }
      });
      expect(coverageLocalRunPayload.result.totals.completedRuns).toBeGreaterThan(0);
      expect(coverageLocalRunPayload.result.totals.scoreboardReady).toBe(coverageLocalRunPayload.result.totals.completedRuns);
      expect([
        ...coverageLocalRunPayload.result.submissions,
        ...coverageLocalRunPayload.result.simulations
      ].every((entry: { run: { status: string; artifactName: string }; bundle?: { schemaVersion: string }; certificate?: { schemaVersion: string } }) =>
        entry.run.status === "scored" &&
        entry.run.artifactName === "output.mp4" &&
        entry.bundle?.schemaVersion === "steambench.evidence-bundle.v1" &&
        entry.certificate?.schemaVersion === "steambench.result-certificate.v1"
      )).toBe(true);

      const coverageRunsResponse = await fetch(`${baseUrl}/api/games/${task.appid}/coverage-runs`);
      const coverageRunsPayload = await coverageRunsResponse.json();
      expect(coverageRunsResponse.status).toBe(200);
      expect(coverageRunsPayload).toMatchObject({
        schemaVersion: "steambench.game-coverage-runs.v1",
        game: {
          appid: task.appid
        }
      });
      expect(coverageRunsPayload.coverageRuns.some((entry: { record: { id: string }; runs: unknown[] }) =>
        entry.record.id === coverageLocalRunPayload.result.record.id && entry.runs.length === coverageLocalRunPayload.result.totals.completedRuns
      )).toBe(true);

      const coverageRunDetailResponse = await fetch(`${baseUrl}/api/game-coverage-runs/${coverageLocalRunPayload.result.record.id}`);
      const coverageRunDetailPayload = await coverageRunDetailResponse.json();
      expect(coverageRunDetailResponse.status).toBe(200);
      expect(coverageRunDetailPayload).toMatchObject({
        schemaVersion: "steambench.game-coverage-run-detail.v1",
        coverageRun: {
          record: {
            id: coverageLocalRunPayload.result.record.id,
            status: "scoreboard-ready"
          }
        }
      });

      const coverageRunBundleResponse = await fetch(`${baseUrl}/api/game-coverage-runs/${coverageLocalRunPayload.result.record.id}/evidence-bundle`);
      const coverageRunBundlePayload = await coverageRunBundleResponse.json();
      expect(coverageRunBundleResponse.status).toBe(200);
      expect(coverageRunBundlePayload.bundle).toMatchObject({
        schemaVersion: "steambench.game-coverage-run-evidence-bundle.v1",
        coverageRunId: coverageLocalRunPayload.result.record.id,
        appid: task.appid,
        integrity: {
          verdict: "scoreboard-ready",
          allRunBundlesReady: true,
          scoreboardRows: coverageLocalRunPayload.result.totals.completedRuns
        }
      });
      expect(coverageRunBundlePayload.bundle.runBundles.every((entry: { bundle?: { schemaVersion: string } }) =>
        entry.bundle?.schemaVersion === "steambench.evidence-bundle.v1"
      )).toBe(true);

      const coverageRunCertificateResponse = await fetch(`${baseUrl}/api/game-coverage-runs/${coverageLocalRunPayload.result.record.id}/result-certificate`);
      const coverageRunCertificatePayload = await coverageRunCertificateResponse.json();
      expect(coverageRunCertificateResponse.status).toBe(200);
      expect(coverageRunCertificatePayload.certificate).toMatchObject({
        schemaVersion: "steambench.result-certificate.v1",
        kind: "game-coverage-run",
        id: coverageLocalRunPayload.result.record.id,
        verdict: "scoreboard-ready",
        integrity: {
          readyForPublicShare: true
        },
        links: {
          evidenceBundle: `${baseUrl}/api/game-coverage-runs/${coverageLocalRunPayload.result.record.id}/evidence-bundle`
        }
      });

      const gameBundleResponse = await fetch(`${baseUrl}/api/games/${task.appid}/evidence-bundle`);
      const gameBundlePayload = await gameBundleResponse.json();
      expect(gameBundleResponse.status).toBe(200);
      expect(gameBundlePayload.bundle).toMatchObject({
        schemaVersion: "steambench.game-competition-evidence-bundle.v1",
        appid: task.appid,
        seasonScope: "all",
        standings: {
          schemaVersion: "steambench.game-competition-standings.v1"
        },
        integrity: {
          verdict: "scoreboard-ready",
          coverageWithinBounds: true
        }
      });
      expect(gameBundlePayload.bundle.activeTasks.some((entry: { id: string }) => entry.id === task.id)).toBe(true);
      expect(gameBundlePayload.bundle.topRows.some((row: { runId?: string }) => row.runId === runPayload.run.id)).toBe(true);
      expect(gameBundlePayload.bundle.integrity.checklist.every((entry: { status: string }) => entry.status === "pass")).toBe(true);

      const gameCertificateResponse = await fetch(`${baseUrl}/api/games/${task.appid}/result-certificate`);
      const gameCertificatePayload = await gameCertificateResponse.json();
      expect(gameCertificateResponse.status).toBe(200);
      expect(gameCertificatePayload.certificate).toMatchObject({
        schemaVersion: "steambench.result-certificate.v1",
        kind: "game-competition",
        id: `game:${task.appid}:all`,
        verdict: "scoreboard-ready",
        evidence: {
          bundleReady: true
        },
        integrity: {
          readyForPublicShare: true
        },
        links: {
          standings: `${baseUrl}/api/games/${task.appid}/standings?season=all`,
          evidenceBundle: `${baseUrl}/api/games/${task.appid}/evidence-bundle?season=all`
        }
      });
      expect(gameCertificatePayload.certificate.tasks.some((entry: { id: string }) => entry.id === task.id)).toBe(true);

      const publicGamePackResponse = await fetch(`${baseUrl}/api/public/games/${task.appid}/benchmark-pack?season=all&limit=12`);
      const publicGamePackPayload = await publicGamePackResponse.json();
      expect(publicGamePackResponse.status).toBe(200);
      expect(publicGamePackPayload.pack).toMatchObject({
        schemaVersion: "steambench.public-game-benchmark-pack.v1",
        appid: task.appid,
        scope: "all",
        canonicalArtifactName: "output.mp4",
        game: {
          appid: task.appid
        },
        source: {
          catalog: "curated"
        },
        profile: {
          totals: {
            activeTasks: expect.any(Number),
            scoreboardRows: expect.any(Number)
          }
        },
        standings: {
          season: {
            scope: "all"
          },
          summary: {
            activeTasks: expect.any(Number),
            coveragePercent: expect.any(Number)
          }
        },
        coverage: {
          totals: {
            activeTasks: expect.any(Number),
            scoredTasks: expect.any(Number)
          },
          links: {
            coveragePlan: `${baseUrl}/api/games/${task.appid}/coverage-plan`,
            scheduleCoverage: `${baseUrl}/api/games/${task.appid}/coverage-plan/schedule`,
            runLocalCoverage: `${baseUrl}/api/games/${task.appid}/coverage-plan/run-local`
          }
        },
        certificate: {
          kind: "game-competition",
          id: `game:${task.appid}:all`,
          canonicalArtifactName: "output.mp4",
          readyForPublicShare: true
        },
        runnerEntrypoints: {
          agentActionSpaces: `${baseUrl}/api/runtime/action-spaces?appid=${task.appid}&inputMode=controller&transport=virtual-controller&limit=12`,
          matchPreflight: `${baseUrl}/api/matches/preflight`
        },
        links: {
          standings: `${baseUrl}/api/games/${task.appid}/standings?season=all`,
          evidenceBundle: `${baseUrl}/api/games/${task.appid}/evidence-bundle?season=all`,
          resultCertificate: `${baseUrl}/api/games/${task.appid}/result-certificate?season=all`
        }
      });
      expect(publicGamePackPayload.pack.tasks.some((entry: { id: string; links: { leaderboard: string } }) =>
        entry.id === task.id && entry.links.leaderboard === `${baseUrl}/api/tasks/${encodeURIComponent(task.id)}/leaderboard?season=all`
      )).toBe(true);
      expect(publicGamePackPayload.pack.tasks.some((entry: { id: string; links: { publicScoreboard: string } }) =>
        entry.id === task.id && entry.links.publicScoreboard === `${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/scoreboard?season=all`
      )).toBe(true);
      expect(publicGamePackPayload.pack.suites.some((suite: { taskCount: number; links: { preflight: string } }) =>
        suite.taskCount > 0 && suite.links.preflight.includes("/api/benchmark-suites/")
      )).toBe(true);

      const invalidPublicGamePackResponse = await fetch(`${baseUrl}/api/public/games/${task.appid}/benchmark-pack?season=quarterly`);
      expect(invalidPublicGamePackResponse.status).toBe(400);

      const publicScoreboardHuman = await store.createUser({
        handle: "public-scoreboard-human",
        displayName: "Public Scoreboard Human",
        type: "human"
      });
      await store.linkSteamToUser(publicScoreboardHuman.id, "76561198000000014", { proofConsent: true });
      const publicScoreboardHumanSubmissionResponse = await fetch(`${baseUrl}/api/users/${publicScoreboardHuman.id}/steam-proof-submissions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: task.id })
      });
      const publicScoreboardHumanSubmissionPayload = await publicScoreboardHumanSubmissionResponse.json();
      expect(publicScoreboardHumanSubmissionResponse.status).toBe(201);
      expect(publicScoreboardHumanSubmissionPayload.submission).toMatchObject({
        schemaVersion: "steambench.human-steam-proof-submission.v1",
        taskId: task.id,
        scoreboardReady: true
      });

      const publicTaskScoreboardResponse = await fetch(`${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/scoreboard?season=all&limit=5`);
      const publicTaskScoreboardPayload = await publicTaskScoreboardResponse.json();
      expect(publicTaskScoreboardResponse.status).toBe(200);
      expect(publicTaskScoreboardPayload.scoreboard).toMatchObject({
        schemaVersion: "steambench.public-task-scoreboard.v1",
        scope: "all",
        canonicalArtifactName: "output.mp4",
        taskStatus: "active",
        runnable: true,
        task: {
          id: task.id,
          appid: task.appid,
          title: task.title
        },
        totals: {
          rows: expect.any(Number),
          humanRows: expect.any(Number),
          agentRows: expect.any(Number),
          hasHumanLeader: true,
          hasAgentLeader: true
        },
        matchup: {
          status: "complete",
          winnerType: expect.stringMatching(/human|agent|tie/),
          leader: expect.objectContaining({
            canonicalArtifactName: "output.mp4",
            links: expect.objectContaining({
              resultCertificate: expect.stringContaining("/api/runs/")
            })
          }),
          humanLeader: expect.objectContaining({
            type: "human",
            links: expect.objectContaining({
              evidenceBundle: expect.stringContaining("/evidence-bundle")
            })
          }),
          agentLeader: expect.objectContaining({
            type: "agent",
            links: expect.objectContaining({
              resultCertificate: expect.stringContaining("/result-certificate")
            })
          })
        },
        entrypoints: {
          runnerContract: `${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/runner-contract`,
          submitRunTemplate: `${baseUrl}/api/runs/{runId}/submission`
        },
        links: {
          taskLeaderboard: `${baseUrl}/api/tasks/${encodeURIComponent(task.id)}/leaderboard?season=all`,
          runnerContract: `${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/runner-contract`,
          certificateVerify: `${baseUrl}/api/result-certificates/verify`
        }
      });
      expect(publicTaskScoreboardPayload.scoreboard.totals.rows).toBeGreaterThanOrEqual(2);
      expect(publicTaskScoreboardPayload.scoreboard.entries.length).toBeLessThanOrEqual(5);
      expect(publicTaskScoreboardPayload.scoreboard.humanEntries.some((entry: { type: string }) => entry.type === "human")).toBe(true);
      expect(publicTaskScoreboardPayload.scoreboard.agentEntries.some((entry: { type: string }) => entry.type === "agent")).toBe(true);

      const invalidPublicTaskScoreboardResponse = await fetch(`${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/scoreboard?season=quarterly`);
      expect(invalidPublicTaskScoreboardResponse.status).toBe(400);
      const missingPublicTaskScoreboardResponse = await fetch(`${baseUrl}/api/public/tasks/not-a-task/scoreboard`);
      expect(missingPublicTaskScoreboardResponse.status).toBe(404);

	      const publicHubResponse = await fetch(`${baseUrl}/api/public/competition-hub?season=weekly&appid=${task.appid}&taskId=${encodeURIComponent(task.id)}&provider=external&limit=4`);
	      const publicHubPayload = await publicHubResponse.json();
	      expect(publicHubResponse.status).toBe(200);
	      expect(publicHubPayload.hub).toMatchObject({
	        schemaVersion: "steambench.public-competition-hub.v1",
	        scope: "weekly",
	        canonicalArtifactName: "output.mp4",
	        publicDataPolicy: {
	          officialSteamSourcesOnly: true,
	          proofConsentRequiredBeforePublicRanking: true
	        },
	        selected: {
	          game: {
	            appid: task.appid
	          },
	          task: {
	            id: task.id,
	            appid: task.appid,
	            runnable: true
	          },
	          gamePack: {
	            schemaVersion: "steambench.public-game-benchmark-pack.v1",
	            appid: task.appid
	          },
	          actionSpace: {
	            schemaVersion: "steambench.public-task-action-space.v1",
	            task: {
	              id: task.id
	            }
	          },
	          raceEntry: {
	            schemaVersion: "steambench.public-task-race-entry.v1",
	            task: {
	              id: task.id
	            }
	          }
	        },
	        entrypoints: {
	          taskRaceEntryTemplate: `${baseUrl}/api/public/tasks/{taskId}/race-entry?humanUserId={userId}&agentId={agentId}&provider=external`,
	          publicWatchTemplate: `${baseUrl}/api/public/broadcasts/{streamId}/watch`
	        },
	        links: {
	          selectedTaskRaceEntry: `${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/race-entry?provider=external&limit=4`,
	          selectedTaskScoreboard: `${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/scoreboard?season=weekly&limit=4`
	        }
	      });
	      expect(publicHubPayload.hub.games.length).toBeGreaterThan(0);
	      expect(publicHubPayload.hub.featuredTasks.length).toBeGreaterThan(0);
	      const invalidPublicHubResponse = await fetch(`${baseUrl}/api/public/competition-hub?season=quarterly`);
	      expect(invalidPublicHubResponse.status).toBe(400);

      const runnerContractHuman = await store.createUser({
        handle: "runner-contract-human",
        displayName: "Runner Contract Human",
        type: "human"
      });
      await store.linkSteamToUser(runnerContractHuman.id, "76561198000000013", { proofConsent: true });
	      const runnerContractAgent = await store.createAgentProfile({
	        handle: "runner-contract-agent",
	        displayName: "Runner Contract Agent"
	      });
	      const controllerTaskForContract = buildFixtureTasks().find((entry) => entry.appid === 1145360)!;

	      const publicAgentOnboardingResponse = await fetch(`${baseUrl}/api/public/agents/onboarding?taskId=${encodeURIComponent(controllerTaskForContract.id)}&agentId=${runnerContractAgent.id}&provider=external&limit=4`);
	      const publicAgentOnboardingPayload = await publicAgentOnboardingResponse.json();
	      expect(publicAgentOnboardingResponse.status).toBe(200);
	      expect(publicAgentOnboardingPayload.onboarding).toMatchObject({
	        schemaVersion: "steambench.public-agent-onboarding.v1",
	        status: "ready-to-run",
	        selectedTask: {
	          id: controllerTaskForContract.id,
	          appid: 1145360,
	          taskStatus: "active",
	          runnable: true
	        },
	        selectedAgent: {
	          id: runnerContractAgent.id,
	          handle: runnerContractAgent.handle,
	          provider: "local",
	          runtimeProvider: "local-sim",
	          status: "active"
	        },
	        registration: {
	          endpoint: `${baseUrl}/api/agents`,
	          method: "POST",
	          provider: "external",
	          requiredCapabilities: expect.arrayContaining(["controller", "screen-capture", "seeded-save", "output.mp4"]),
	          recommendedCapabilities: expect.arrayContaining(["virtual-controller", "geforce-now-bridge"]),
	          requestBodyTemplate: {
	            provider: "external",
	            runtimeProvider: "local-sim",
	            capabilities: expect.arrayContaining(["controller", "screen-capture", "seeded-save", "output.mp4"])
	          }
	        },
	        readiness: {
	          ready: true,
	          agentId: runnerContractAgent.id,
	          taskId: controllerTaskForContract.id,
	          missingCapabilities: []
	        },
	        actionSpace: {
	          publicPacket: `${baseUrl}/api/public/tasks/${encodeURIComponent(controllerTaskForContract.id)}/action-space?agentId=${runnerContractAgent.id}`,
	          schemaVersion: "steambench.runtime-action-space.v1",
	          inputMode: "controller",
	          transport: "virtual-controller",
	          bridgeable: true,
	          requiresControlSession: true,
	          exampleActions: [
	            "stick:left:0.80,0.00",
	            "button:a:tap",
	            "trigger:rt:1.00"
	          ]
	        },
	        runEntry: {
	          runnerContract: `${baseUrl}/api/public/tasks/${encodeURIComponent(controllerTaskForContract.id)}/runner-contract?agentId=${runnerContractAgent.id}`,
	          runSession: `${baseUrl}/api/agents/${runnerContractAgent.id}/run-session`,
	          runSessionBodyTemplate: {
	            taskId: controllerTaskForContract.id,
	            createControlSession: true,
	            ttlSeconds: 900
	          }
	        }
	      });
	      expect(publicAgentOnboardingPayload.onboarding.taskRecommendations.length).toBeGreaterThan(0);
	      const missingPublicAgentOnboardingResponse = await fetch(`${baseUrl}/api/public/agents/onboarding?taskId=not-a-task`);
	      expect(missingPublicAgentOnboardingResponse.status).toBe(404);

	      const publicActionSpaceResponse = await fetch(`${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/action-space?agentId=${runnerContractAgent.id}`);
	      const publicActionSpacePayload = await publicActionSpaceResponse.json();
	      expect(publicActionSpaceResponse.status).toBe(200);
	      expect(publicActionSpacePayload.actionSpace).toMatchObject({
	        schemaVersion: "steambench.public-task-action-space.v1",
	        taskStatus: "active",
	        runnable: true,
	        canonicalArtifactName: "output.mp4",
	        task: {
	          id: task.id,
	          appid: task.appid,
	          title: task.title
	        },
	        permissions: {
	          schemaVersion: "steambench.runtime-action-space.v1",
	          inputMode: "keyboard-mouse",
	          transport: "local-desktop",
	          allowedActionTypes: ["key", "mouse-move", "mouse-click", "scroll", "wait"],
	          privilegedSystemInput: false,
	          observeBeforeAct: true,
	          constraints: {
	            requireCanonicalCapture: true
	          }
	        },
	        bridge: {
	          provider: "geforce-now",
	          bridgeable: false,
	          required: false
	        },
	        exampleActionBatch: {
	          schemaVersion: "steambench.public-agent-action-batch-template.v1",
	          endpoint: "/api/runs/<run_id>/action-batches",
	          requiresControlSessionId: false,
	          acceptedActionLabels: expect.arrayContaining(["key:w:press", "mouse-move:35,-8", "mouse-click:left"])
	        },
	        controlSession: {
	          requiredBeforeHostInput: false,
	          ttlSecondsDefault: 900
	        },
	        evidence: {
	          canonicalArtifact: "output/output.mp4",
	          acceptedArtifactName: "output.mp4",
	          forbiddenArtifactNames: ["output-test.mp4"]
	        },
	        entrypoints: {
	          publicActionSpace: `${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/action-space`,
	          runnerContract: `${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/runner-contract`,
	          runSession: `${baseUrl}/api/agents/${runnerContractAgent.id}/run-session`
	        }
	      });

	      const publicRunnerContractResponse = await fetch(`${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/runner-contract?humanUserId=${runnerContractHuman.id}&agentId=${runnerContractAgent.id}`);
	      const publicRunnerContractPayload = await publicRunnerContractResponse.json();
      expect(publicRunnerContractResponse.status).toBe(200);
      expect(publicRunnerContractPayload.contract).toMatchObject({
        schemaVersion: "steambench.public-task-runner-contract.v1",
        taskStatus: "active",
        runnable: true,
        canonicalArtifactName: "output.mp4",
        task: {
          id: task.id,
          appid: task.appid,
          title: task.title
        },
        proof: {
          canonicalArtifactPath: "output/output.mp4",
          artifactName: "output.mp4"
        },
        runtime: {
          plan: {
            targetArtifact: "output.mp4",
            appid: task.appid
          },
          actionSpace: {
            schemaVersion: "steambench.runtime-action-space.v1",
            constraints: {
              requireCanonicalCapture: true
            }
          },
          selectedAgentReadiness: {
            ready: expect.any(Boolean)
          }
        },
        agentActionContract: {
          schemaVersion: "steambench.agent-action-contract.v1",
          observeBeforeAct: true,
          actionBatch: {
            method: "POST",
            endpoint: "/api/runs/<run_id>/action-batches",
            receiptSchemaVersion: "steambench.agent-action-batch-receipt.v1"
          },
          permissions: {
            inputMode: "keyboard-mouse",
            transport: "local-desktop",
            privilegedSystemInput: false,
            constraints: {
              requireCanonicalCapture: true
            }
          },
          bridge: {
            required: false,
            provider: "geforce-now"
          },
          evidence: {
            canonicalArtifact: "output/output.mp4",
            acceptedArtifactName: "output.mp4",
            forbiddenArtifactNames: ["output-test.mp4"]
          }
        },
        eligibility: {
          taskId: task.id
        },
        entrypoints: {
          human: {
            createRun: `${baseUrl}/api/users/${runnerContractHuman.id}/runs`,
            proofPlan: `${baseUrl}/api/users/${runnerContractHuman.id}/steam-proof-plan?appid=${task.appid}`,
            proofSubmission: `${baseUrl}/api/users/${runnerContractHuman.id}/steam-proof-submissions`,
            requiredBody: {
              taskId: task.id
            }
          },
	          agent: {
	            createRun: `${baseUrl}/api/agents/${runnerContractAgent.id}/runs`,
	            runSession: `${baseUrl}/api/agents/${runnerContractAgent.id}/run-session`,
	            publicActionSpace: `${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/action-space?agentId=${runnerContractAgent.id}`
	          },
          match: {
            preflight: `${baseUrl}/api/matches/preflight`,
            createMatch: `${baseUrl}/api/matches`
          }
        },
	        links: {
	          taskReview: `${baseUrl}/api/tasks/${encodeURIComponent(task.id)}/review`,
	          taskActionSpace: `${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/action-space`,
	          gameBenchmarkPack: `${baseUrl}/api/public/games/${task.appid}/benchmark-pack`
	        }
	      });
      expect(publicRunnerContractPayload.contract.runnerFlow).toContain("Verify the result certificate before public sharing.");
      expect(publicRunnerContractPayload.contract.agentActionContract.actionBatch.requestBodyTemplate.actions.length).toBeGreaterThan(0);
      expect(publicRunnerContractPayload.contract.agentActionContract.actionBatch.acceptedActionLabels).toContain("key:w:press");
      expect(publicRunnerContractPayload.contract.agentActionContract.bridge.executionPlanPreview).toBeUndefined();
      expect(publicRunnerContractPayload.contract.agentActionContract.bridge.executorRequest).toBeUndefined();

	      const publicRaceEntryResponse = await fetch(`${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/race-entry?humanUserId=${runnerContractHuman.id}&agentId=${runnerContractAgent.id}&provider=external&limit=4`);
	      const publicRaceEntryPayload = await publicRaceEntryResponse.json();
	      expect(publicRaceEntryResponse.status).toBe(200);
	      expect(publicRaceEntryPayload.raceEntry).toMatchObject({
	        schemaVersion: "steambench.public-task-race-entry.v1",
	        taskStatus: "active",
	        runnable: true,
	        canonicalArtifactName: "output.mp4",
	        task: {
	          id: task.id,
	          appid: task.appid,
	          title: task.title
	        },
	        human: {
	          status: "ready",
	          ready: true,
	          selectedUser: {
	            id: runnerContractHuman.id,
	            handle: runnerContractHuman.handle,
	            linkedSteamId: "76561198000000013"
	          },
	          entryPacket: {
	            schemaVersion: "steambench.human-benchmark-entry-packet.v1",
	            taskId: task.id,
	            readyForSubmission: true,
	            evidence: {
	              canonicalArtifact: "output/output.mp4",
	              acceptedArtifactName: "output.mp4",
	              forbiddenArtifactNames: ["output-test.mp4"]
	            }
	          },
	          proofSubmission: `${baseUrl}/api/users/${runnerContractHuman.id}/steam-proof-submissions`
	        },
	        agent: {
	          status: "ready-to-run",
	          ready: true,
	          selectedAgent: {
	            id: runnerContractAgent.id,
	            handle: runnerContractAgent.handle
	          },
	          onboarding: {
	            schemaVersion: "steambench.public-agent-onboarding.v1",
	            selectedTask: {
	              id: task.id
	            }
	          }
	        },
	        actionSpace: {
	          schemaVersion: "steambench.public-task-action-space.v1",
	          task: {
	            id: task.id
	          },
	          permissions: {
	            privilegedSystemInput: false,
	            constraints: {
	              requireCanonicalCapture: true
	            }
	          }
	        },
	        runnerContract: {
	          endpoint: `${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/runner-contract?agentId=${runnerContractAgent.id}`,
	          method: "GET"
	        },
	        match: {
	          preflight: {
	            endpoint: `${baseUrl}/api/matches/preflight`,
	            method: "POST",
	            bodyTemplate: {
	              taskId: task.id,
	              humanUserId: runnerContractHuman.id,
	              agentId: runnerContractAgent.id
	            },
	            eligibility: {
	              taskId: task.id
	            }
	          },
	          createMatch: {
	            endpoint: `${baseUrl}/api/matches`,
	            method: "POST"
	          }
	        },
	        scoreboard: {
	          endpoint: `${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/scoreboard?season=all&limit=4`,
	          season: "all"
	        }
	      });
	      expect(publicRaceEntryPayload.raceEntry.nextActions.length).toBeGreaterThan(0);

	      const publicCatalogResponse = await fetch(`${baseUrl}/api/public/catalog?season=weekly&appid=${controllerTaskForContract.appid}&transport=virtual-controller&bridgeable=true&provider=external&limit=4`);
	      const publicCatalogPayload = await publicCatalogResponse.json();
	      expect(publicCatalogResponse.status).toBe(200);
	      expect(publicCatalogPayload.catalog).toMatchObject({
	        schemaVersion: "steambench.public-catalog.v1",
	        scope: "weekly",
	        canonicalArtifactName: "output.mp4",
	        filters: {
	          season: "weekly",
	          appid: controllerTaskForContract.appid,
	          transport: "virtual-controller",
	          bridgeable: true,
	          provider: "external",
	          limit: 4
	        },
	        totals: {
	          bridgeableTasks: expect.any(Number)
	        },
	        entrypoints: {
	          quickstartTemplate: `${baseUrl}/api/public/quickstart?season=weekly&appid={appid}&taskId={taskId}&provider=external&limit=4`,
	          bridgeHandoffTemplate: `${baseUrl}/api/public/tasks/{taskId}/bridge-handoff?agentId={agentId}&provider=external`
	        }
	      });
	      expect(publicCatalogPayload.catalog.games).toEqual(expect.arrayContaining([
	        expect.objectContaining({
	          appid: controllerTaskForContract.appid,
	          bridgeableTasks: expect.any(Number),
	          bestTask: expect.objectContaining({
	            transport: "virtual-controller",
	            bridgeable: true
	          })
	        })
	      ]));
	      expect(publicCatalogPayload.catalog.tasks.length).toBeGreaterThan(0);
	      expect(publicCatalogPayload.catalog.tasks.every((entry: { appid: number; runnable: boolean; actionSpace: { transport: string; bridgeable: boolean; requiresControlSession: boolean; privilegedSystemInput: boolean }; evidence: { canonicalArtifact: string } }) =>
	        entry.appid === controllerTaskForContract.appid &&
	        entry.runnable === true &&
	        entry.actionSpace.transport === "virtual-controller" &&
	        entry.actionSpace.bridgeable === true &&
	        entry.actionSpace.requiresControlSession === true &&
	        entry.actionSpace.privilegedSystemInput === false &&
	        entry.evidence.canonicalArtifact === "output/output.mp4"
	      )).toBe(true);
	      const invalidPublicCatalogResponse = await fetch(`${baseUrl}/api/public/catalog?transport=raw-input`);
	      expect(invalidPublicCatalogResponse.status).toBe(400);

	      const publicStandingsResponse = await fetch(`${baseUrl}/api/public/standings?season=all&appid=${task.appid}&track=${task.track}&limit=4`);
	      const publicStandingsPayload = await publicStandingsResponse.json();
	      expect(publicStandingsResponse.status).toBe(200);
	      expect(publicStandingsPayload.standings).toMatchObject({
	        schemaVersion: "steambench.public-standings.v1",
	        scope: "all",
	        canonicalArtifactName: "output.mp4",
	        filters: {
	          season: "all",
	          appid: task.appid,
	          track: task.track,
	          limit: 4
	        },
	        selectedGame: {
	          appid: task.appid
	        },
	        window: {
	          scope: "all"
	        },
	        totals: {
	          rows: expect.any(Number),
	          humanRows: expect.any(Number),
	          agentRows: expect.any(Number)
	        },
	        entrypoints: {
	          taskScoreboardTemplate: `${baseUrl}/api/public/tasks/{taskId}/scoreboard?season=all&limit=4`,
	          quickstartTemplate: `${baseUrl}/api/public/quickstart?season=all&appid={appid}&taskId={taskId}&provider=external&limit=4`
	        },
	        links: {
	          catalog: `${baseUrl}/api/public/catalog?season=all&appid=${task.appid}&limit=4`
	        }
	      });
	      expect(publicStandingsPayload.standings.taskLeaderboards.length).toBeGreaterThan(0);
	      expect(publicStandingsPayload.standings.taskLeaderboards.every((entry: { appid?: number; track?: string; links?: { taskScoreboard?: string; quickstart?: string } }) =>
	        entry.appid === task.appid &&
	        entry.track === task.track &&
	        String(entry.links?.taskScoreboard ?? "").includes("/api/public/tasks/") &&
	        String(entry.links?.quickstart ?? "").includes("/api/public/quickstart")
	      )).toBe(true);
	      const invalidPublicStandingsResponse = await fetch(`${baseUrl}/api/public/standings?competitor=bot`);
	      expect(invalidPublicStandingsResponse.status).toBe(400);

	      const publicQuickstartResponse = await fetch(`${baseUrl}/api/public/quickstart?season=weekly&appid=${task.appid}&taskId=${encodeURIComponent(task.id)}&humanUserId=${runnerContractHuman.id}&agentId=${runnerContractAgent.id}&provider=external&limit=4`);
	      const publicQuickstartPayload = await publicQuickstartResponse.json();
	      expect(publicQuickstartResponse.status).toBe(200);
	      expect(publicQuickstartPayload.quickstart).toMatchObject({
	        schemaVersion: "steambench.public-quickstart.v1",
	        scope: "weekly",
	        canonicalArtifactName: "output.mp4",
	        selected: {
	          game: {
	            appid: task.appid
	          },
	          task: {
	            id: task.id,
	            appid: task.appid,
	            runnable: true
	          },
	          human: {
	            id: runnerContractHuman.id
	          },
	          agent: {
	            id: runnerContractAgent.id
	          }
	        },
	        readiness: {
	          human: {
	            status: "ready",
	            ready: true,
	            selected: true
	          },
	          agent: {
	            status: "ready-to-run",
	            ready: true,
	            selected: true
	          },
	          actionSpace: {
	            privilegedSystemInput: false
	          },
	          match: {
	            preflightRequired: true
	          }
	        },
	        packets: {
	          hub: {
	            schemaVersion: "steambench.public-competition-hub.v1"
	          },
	          raceEntry: {
	            schemaVersion: "steambench.public-task-race-entry.v1"
	          },
	          actionSpace: {
	            schemaVersion: "steambench.public-task-action-space.v1"
	          },
	          agentOnboarding: {
	            schemaVersion: "steambench.public-agent-onboarding.v1"
	          }
	        },
	        links: {
	          hub: `${baseUrl}/api/public/competition-hub?season=weekly&appid=${task.appid}&taskId=${encodeURIComponent(task.id)}&provider=external&limit=4`,
	          raceEntry: `${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/race-entry?humanUserId=${runnerContractHuman.id}&agentId=${runnerContractAgent.id}&provider=external&limit=4`,
	          actionSpace: `${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/action-space?agentId=${runnerContractAgent.id}`
	        }
	      });
	      expect(publicQuickstartPayload.quickstart.steps.map((entry: { id: string }) => entry.id)).toEqual(expect.arrayContaining([
	        "inspect-hub",
	        "create-human",
	        "link-steam",
	        "inspect-agent-onboarding",
	        "register-agent",
	        "inspect-action-space",
	        "inspect-race-entry",
	        "match-preflight",
	        "agent-run-session",
	        "submit-action-batch",
	        "submit-evidence",
	        "watch-broadcast"
	      ]));
	      expect(publicQuickstartPayload.quickstart.steps.find((entry: { id: string }) => entry.id === "submit-evidence").bodyTemplate.artifactPath).toBe("output/output.mp4");
	      expect(publicQuickstartPayload.quickstart.commands.registerAgent).toContain("npm run public:agent");
	      const invalidPublicQuickstartResponse = await fetch(`${baseUrl}/api/public/quickstart?season=quarterly`);
	      expect(invalidPublicQuickstartResponse.status).toBe(400);

	      const publicEventEntryResponse = await fetch(`${baseUrl}/api/public/events/weekly/entry?taskId=${encodeURIComponent(task.id)}&humanUserId=${runnerContractHuman.id}&agentId=${runnerContractAgent.id}&provider=external&suiteId=620:ranked&limit=4`);
	      const publicEventEntryPayload = await publicEventEntryResponse.json();
	      expect(publicEventEntryResponse.status).toBe(200);
	      expect(publicEventEntryPayload.entry).toMatchObject({
	        schemaVersion: "steambench.public-event-entry.v1",
	        scope: "weekly",
	        canonicalArtifactName: "output.mp4",
	        event: {
	          id: "event:weekly",
	          title: "Weekly Human vs Agent Cup"
	        },
	        selected: {
	          task: {
	            id: task.id,
	            appid: task.appid,
	            runnable: true
	          },
	          suite: {
	            id: "620:ranked"
	          },
	          human: {
	            id: runnerContractHuman.id,
	            linkedSteamId: "76561198000000013"
	          },
	          agent: {
	            id: runnerContractAgent.id,
	            status: "active"
	          }
	        },
	        readiness: {
	          human: {
	            status: "ready-to-register",
	            canRegister: true,
	            blockers: []
	          },
	          agent: {
	            status: "ready-to-register",
	            canRegister: true,
	            blockers: []
	          },
	          pair: {
	            ready: true,
	            registered: false
	          }
	        },
	        registration: {
	          endpoint: `${baseUrl}/api/competition-events/weekly/register`,
	          method: "POST",
	          human: {
	            bodyTemplate: {
	              participantType: "human",
	              participantId: runnerContractHuman.id
	            },
	            ready: true,
	            alreadyRegistered: false
	          },
	          agent: {
	            bodyTemplate: {
	              participantType: "agent",
	              participantId: runnerContractAgent.id
	            },
	            ready: true,
	            alreadyRegistered: false
	          }
	        },
	        packets: {
	          quickstart: {
	            schemaVersion: "steambench.public-quickstart.v1"
	          },
	          raceEntry: {
	            schemaVersion: "steambench.public-task-race-entry.v1"
	          },
	          bridgeHandoff: {
	            schemaVersion: "steambench.public-bridge-handoff.v1"
	          },
	          opsReport: {
	            schemaVersion: "steambench.competition-event-ops-report.v1"
	          }
	        },
	        links: {
	          event: `${baseUrl}/api/competition-events/weekly`,
	          registrations: `${baseUrl}/api/competition-events/registrations`,
	          evidenceBundle: `${baseUrl}/api/competition-events/weekly/evidence-bundle`,
	          resultCertificate: `${baseUrl}/api/competition-events/weekly/result-certificate`
	        }
	      });
	      expect(publicEventEntryPayload.entry.nextActions).toEqual(expect.arrayContaining([
	        "POST the human registration body to enter the event.",
	        "POST the agent registration body to enter the event."
	      ]));
	      const invalidPublicEventEntryResponse = await fetch(`${baseUrl}/api/public/events/quarterly/entry`);
	      expect(invalidPublicEventEntryResponse.status).toBe(400);

	      const publicControllerActionSpaceResponse = await fetch(`${baseUrl}/api/public/tasks/${encodeURIComponent(controllerTaskForContract.id)}/action-space?agentId=${runnerContractAgent.id}`);
	      const publicControllerActionSpacePayload = await publicControllerActionSpaceResponse.json();
	      expect(publicControllerActionSpaceResponse.status).toBe(200);
	      expect(publicControllerActionSpacePayload.actionSpace).toMatchObject({
	        schemaVersion: "steambench.public-task-action-space.v1",
	        task: {
	          id: controllerTaskForContract.id,
	          appid: 1145360
	        },
	        permissions: {
	          inputMode: "controller",
	          transport: "virtual-controller",
	          allowedActionTypes: ["button", "stick", "trigger", "wait"],
	          privilegedSystemInput: false,
	          controller: {
	            layout: "xinput-standard",
	            buttons: expect.arrayContaining(["a", "dpad-up"]),
	            sticks: ["left", "right"],
	            triggers: ["lt", "rt"]
	          },
	          constraints: {
	            requireCanonicalCapture: true
	          }
	        },
	        bridge: {
	          provider: "geforce-now",
	          bridgeable: true,
	          required: true,
	          executorRequest: "steambench.controller-executor-request.v1",
	          executorReport: "steambench.controller-executor-report.v1"
	        },
	        exampleActionBatch: {
	          requiresControlSessionId: true,
	          executionPlanPreview: {
	            schemaVersion: "steambench.controller-execution-plan.v1",
	            target: "xinput-standard",
	            stepCount: 9,
	            totalDurationMs: 550
	          },
	          acceptedActionLabels: [
	            "stick:left:0.80,0.00",
	            "button:a:tap",
	            "trigger:rt:1.00"
	          ]
	        },
	        controlSession: {
	          requiredBeforeHostInput: true,
	          createRunSessionBody: {
	            taskId: controllerTaskForContract.id,
	            createControlSession: true,
	            ttlSeconds: 900
	          }
	        }
	      });
	      const publicBridgeHandoffResponse = await fetch(`${baseUrl}/api/public/tasks/${encodeURIComponent(controllerTaskForContract.id)}/bridge-handoff?agentId=${runnerContractAgent.id}&provider=external&ttlSeconds=900`);
	      const publicBridgeHandoffPayload = await publicBridgeHandoffResponse.json();
	      expect(publicBridgeHandoffResponse.status).toBe(200);
	      expect(publicBridgeHandoffPayload.handoff).toMatchObject({
	        schemaVersion: "steambench.public-bridge-handoff.v1",
	        status: "ready-to-grant",
	        runnable: true,
	        bridgeable: true,
	        canonicalArtifactName: "output.mp4",
	        task: {
	          id: controllerTaskForContract.id,
	          appid: 1145360
	        },
	        selectedAgent: {
	          id: runnerContractAgent.id,
	          readiness: {
	            ready: true,
	            missingCapabilities: []
	          }
	        },
	        permissions: {
	          inputMode: "controller",
	          transport: "virtual-controller",
	          allowedActionTypes: ["button", "stick", "trigger", "wait"],
	          privilegedSystemInput: false,
	          observeBeforeAct: true
	        },
	        grant: {
	          method: "POST",
	          endpoint: `${baseUrl}/api/agents/${runnerContractAgent.id}/run-session`,
	          bodyTemplate: {
	            taskId: controllerTaskForContract.id,
	            createControlSession: true,
	            ttlSeconds: 900
	          },
	          responseSchemaVersion: "steambench.agent-run-session.v1",
	          createsRun: true,
	          createsControlSession: true,
	          ttlSeconds: 900
	        },
	        postGrantPackets: {
	          accessPacket: {
	            schemaVersion: "steambench.runtime-control-access-packet.v1"
	          },
	          bridgeManifest: {
	            schemaVersion: "steambench.control-bridge-manifest.v1"
	          }
	        },
	        actionBatch: {
	          method: "POST",
	          endpoint: "/api/runs/<run_id>/action-batches",
	          bodyTemplate: {
	            controlSessionId: "<control_session_id>"
	          },
	          receiptSchemaVersion: "steambench.agent-action-batch-receipt.v1",
	          acceptedActionLabels: [
	            "stick:left:0.80,0.00",
	            "button:a:tap",
	            "trigger:rt:1.00"
	          ],
	          executionPlanPreview: {
	            schemaVersion: "steambench.controller-execution-plan.v1",
	            target: "xinput-standard",
	            stepCount: 9,
	            totalDurationMs: 550
	          }
	        },
	        executor: {
	          provider: "geforce-now",
	          command: "npm run executor:geforce-now",
	          bridgeRunnerCommand: "npm run bridge:control -- --session=<control_session_id>",
	          requestSchemaVersion: "steambench.controller-executor-request.v1",
	          reportSchemaVersion: "steambench.controller-executor-report.v1",
	          required: true,
	          sideEffectsMustBeFalseForAudit: true
	        },
	        evidence: {
	          canonicalArtifact: "output/output.mp4",
	          acceptedArtifactName: "output.mp4",
	          forbiddenArtifactNames: ["output-test.mp4"]
	        },
	        links: {
	          publicActionSpace: `${baseUrl}/api/public/tasks/${encodeURIComponent(controllerTaskForContract.id)}/action-space?agentId=${runnerContractAgent.id}`,
	          runnerContract: `${baseUrl}/api/public/tasks/${encodeURIComponent(controllerTaskForContract.id)}/runner-contract?agentId=${runnerContractAgent.id}`,
	          controlBridgeOps: `${baseUrl}/api/control-sessions/ops-report?transport=virtual-controller`
	        }
	      });
	      expect(publicBridgeHandoffPayload.handoff.nextActions).toContain("POST the grant body to open a bounded run session.");
	      const invalidPublicBridgeHandoffResponse = await fetch(`${baseUrl}/api/public/tasks/${encodeURIComponent(controllerTaskForContract.id)}/bridge-handoff?provider=bad`);
	      expect(invalidPublicBridgeHandoffResponse.status).toBe(400);
	      const publicControllerContractResponse = await fetch(`${baseUrl}/api/public/tasks/${encodeURIComponent(controllerTaskForContract.id)}/runner-contract?agentId=${runnerContractAgent.id}`);
      const publicControllerContractPayload = await publicControllerContractResponse.json();
      expect(publicControllerContractResponse.status).toBe(200);
      expect(publicControllerContractPayload.contract).toMatchObject({
        schemaVersion: "steambench.public-task-runner-contract.v1",
        task: {
          id: controllerTaskForContract.id,
          appid: 1145360
        },
        runtime: {
          actionSpace: {
            inputMode: "controller",
            transport: "virtual-controller",
            permissions: {
              controller: true,
              privilegedSystemInput: false
            }
          },
          bridge: {
            provider: "geforce-now",
            bridgeable: true,
            executorRequest: "steambench.controller-executor-request.v1",
            executorReport: "steambench.controller-executor-report.v1"
          }
        },
        agentActionContract: {
          schemaVersion: "steambench.agent-action-contract.v1",
          actionBatch: {
            endpoint: "/api/runs/<run_id>/action-batches",
            receiptSchemaVersion: "steambench.agent-action-batch-receipt.v1"
          },
          permissions: {
            inputMode: "controller",
            transport: "virtual-controller",
            allowedActionTypes: ["button", "stick", "trigger", "wait"],
            privilegedSystemInput: false
          },
          bridge: {
            required: true,
            provider: "geforce-now",
            executionPlanPreview: {
              schemaVersion: "steambench.controller-execution-plan.v1",
              target: "xinput-standard",
              neutralOnCompletion: true,
              stepCount: 9,
              totalDurationMs: 550
            },
            executorRequest: {
              availableAfter: "POST an action batch with an active controlSessionId.",
              schemaVersion: "steambench.controller-executor-request.v1",
              executor: "geforce-now",
              provider: "geforce-now-external",
              command: "npm run executor:geforce-now",
              reportSchemaVersion: "steambench.controller-executor-report.v1",
              reportEndpoint: "/api/runs/<run_id>/controller-executor-reports"
            }
          }
        }
      });
      expect(publicControllerContractPayload.contract.agentActionContract.actionBatch.requestBodyTemplate).toMatchObject({
        controlSessionId: "<active_control_session_id>",
        observation: "Describe the visible game state before acting.",
        confidence: 0.75,
        idempotencyKey: "agent:<run_id>:step-1"
      });
      expect(publicControllerContractPayload.contract.agentActionContract.actionBatch.acceptedActionLabels).toEqual([
        "stick:left:0.80,0.00",
        "button:a:tap",
        "trigger:rt:1.00"
      ]);
      expect(publicControllerContractPayload.contract.agentActionContract.bridge.prerequisites).toContain("Create an agent run session with createControlSession=true.");

	      const missingPublicRunnerContractResponse = await fetch(`${baseUrl}/api/public/tasks/not-a-task/runner-contract`);
	      expect(missingPublicRunnerContractResponse.status).toBe(404);
	      const missingPublicActionSpaceResponse = await fetch(`${baseUrl}/api/public/tasks/not-a-task/action-space`);
	      expect(missingPublicActionSpaceResponse.status).toBe(404);

      const broadcastResponse = await fetch(`${baseUrl}/api/broadcasts/${broadcastListPayload.broadcasts[0].stream.id}`);
      const broadcastPayload = await broadcastResponse.json();
      expect(broadcastResponse.status).toBe(200);
      expect(broadcastPayload.broadcast.timeline.map((item: { eventType: string }) => item.eventType)).toContain("checkpoint");
      expect(broadcastPayload.broadcast.scoreboardReady).toBe(true);

      const broadcastBundleResponse = await fetch(`${baseUrl}/api/broadcasts/${broadcastListPayload.broadcasts[0].stream.id}/evidence-bundle`);
      const broadcastBundlePayload = await broadcastBundleResponse.json();
      expect(broadcastBundleResponse.status).toBe(200);
      expect(broadcastBundlePayload.bundle).toMatchObject({
        schemaVersion: "steambench.broadcast-evidence-bundle.v1",
        streamId: broadcastListPayload.broadcasts[0].stream.id,
        runId: runPayload.run.id,
        integrity: {
          verdict: "scoreboard-ready",
          streamPlayable: true,
          timelinePresent: true,
          canonicalArtifactPresent: true,
          requiredProofsVerified: true,
          scoreboardPublished: true,
          executorReportCount: 0
        }
      });
      expect(broadcastBundlePayload.bundle.integrity.checklist.every((item: { status: string }) => item.status === "pass")).toBe(true);

      const broadcastCertificateResponse = await fetch(`${baseUrl}/api/broadcasts/${broadcastListPayload.broadcasts[0].stream.id}/result-certificate`);
      const broadcastCertificatePayload = await broadcastCertificateResponse.json();
      expect(broadcastCertificateResponse.status).toBe(200);
      expect(broadcastCertificatePayload.certificate).toMatchObject({
        schemaVersion: "steambench.result-certificate.v1",
        kind: "broadcast",
        id: broadcastListPayload.broadcasts[0].stream.id,
        verdict: "scoreboard-ready",
        result: {
          score: expect.any(Number),
          scoreboardRows: 1
        },
        evidence: {
          bundleReady: true,
          streamCount: 1,
          executorReportCount: 0
        },
        integrity: {
          readyForPublicShare: true
        }
      });
      expect(broadcastCertificatePayload.certificate.links.evidenceBundle).toBe(`${baseUrl}/api/broadcasts/${broadcastListPayload.broadcasts[0].stream.id}/evidence-bundle`);

      const publicBroadcastWatchResponse = await fetch(`${baseUrl}/api/public/broadcasts/${broadcastListPayload.broadcasts[0].stream.id}/watch?timelineLimit=4`);
      const publicBroadcastWatchPayload = await publicBroadcastWatchResponse.json();
      expect(publicBroadcastWatchResponse.status).toBe(200);
      expect(publicBroadcastWatchPayload.watch).toMatchObject({
        schemaVersion: "steambench.public-broadcast-watch.v1",
        canonicalArtifactName: "output.mp4",
        stream: {
          id: broadcastListPayload.broadcasts[0].stream.id,
          runId: runPayload.run.id,
          status: "ended"
        },
        run: {
          id: runPayload.run.id,
          status: "scored",
          artifactName: "output.mp4"
        },
        task: {
          id: task.id,
          appid: task.appid
        },
        watch: {
          playable: true,
          publicShareReady: true,
          scoreboardReady: true,
          proofReady: true,
          timelinePresent: true
        },
        evidence: {
          verdict: "scoreboard-ready",
          checkpointCount: 1,
          canonicalArtifactPresent: true,
          requiredProofsVerified: true,
          scoreboardPublished: true
        },
        certificate: {
          kind: "broadcast",
          id: broadcastListPayload.broadcasts[0].stream.id,
          readyForPublicShare: true,
          fingerprint: broadcastCertificatePayload.certificate.verification.fingerprint
        },
        certificatePayload: {
          schemaVersion: "steambench.result-certificate.v1",
          kind: "broadcast",
          id: broadcastListPayload.broadcasts[0].stream.id,
          verification: {
            fingerprint: broadcastCertificatePayload.certificate.verification.fingerprint
          }
        },
        verification: {
          endpoint: `${baseUrl}/api/result-certificates/verify`,
          fingerprint: broadcastCertificatePayload.certificate.verification.fingerprint
        },
        links: {
          evidenceBundle: `${baseUrl}/api/broadcasts/${broadcastListPayload.broadcasts[0].stream.id}/evidence-bundle`,
          resultCertificate: `${baseUrl}/api/broadcasts/${broadcastListPayload.broadcasts[0].stream.id}/result-certificate`,
          taskScoreboard: `${baseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/scoreboard`
        }
      });
      expect(publicBroadcastWatchPayload.watch.watch.timelinePreview.map((item: { eventType: string }) => item.eventType)).toContain("checkpoint");
      const publicBroadcastWatchVerifyResponse = await fetch(`${baseUrl}/api/result-certificates/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ certificate: publicBroadcastWatchPayload.watch.certificatePayload })
      });
      const publicBroadcastWatchVerifyPayload = await publicBroadcastWatchVerifyResponse.json();
      expect(publicBroadcastWatchVerifyResponse.status).toBe(200);
      expect(publicBroadcastWatchVerifyPayload.verification.valid).toBe(true);

      const missingPublicBroadcastWatchResponse = await fetch(`${baseUrl}/api/public/broadcasts/not-a-stream/watch`);
      expect(missingPublicBroadcastWatchResponse.status).toBe(404);

      const seasonsResponse = await fetch(`${baseUrl}/api/seasons`);
      const seasonsPayload = await seasonsResponse.json();
      expect(seasonsResponse.status).toBe(200);
      expect(seasonsPayload.seasons.map((season: { window: { scope: string } }) => season.window.scope)).toEqual([
        "all",
        "daily",
        "weekly"
      ]);
      expect(seasonsPayload.seasons.find((season: { window: { scope: string; rowCount: number } }) => season.window.scope === "daily")?.window.rowCount).toBeGreaterThan(0);

      const dailyStandingsResponse = await fetch(`${baseUrl}/api/standings?season=daily`);
      const dailyStandingsPayload = await dailyStandingsResponse.json();
      expect(dailyStandingsResponse.status).toBe(200);
      expect(dailyStandingsPayload.season.scope).toBe("daily");
      expect(dailyStandingsPayload.standings.competitors.some((entry: { competitor: string }) => entry.competitor === "agent-runtime-test")).toBe(true);

      const weeklyLeaderboardsResponse = await fetch(`${baseUrl}/api/leaderboards?season=weekly`);
      const weeklyLeaderboardsPayload = await weeklyLeaderboardsResponse.json();
      expect(weeklyLeaderboardsResponse.status).toBe(200);
      expect(weeklyLeaderboardsPayload.season.scope).toBe("weekly");
      expect(weeklyLeaderboardsPayload.leaderboards.some((leaderboard: { taskId?: string }) => leaderboard.taskId === task.id)).toBe(true);

      const scopedTaskLeaderboardResponse = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(task.id)}/leaderboard?season=daily`);
      const scopedTaskLeaderboardPayload = await scopedTaskLeaderboardResponse.json();
      expect(scopedTaskLeaderboardResponse.status).toBe(200);
      expect(scopedTaskLeaderboardPayload.season.scope).toBe("daily");
      expect(scopedTaskLeaderboardPayload.leaderboard.entries[0].runId).toBe(runPayload.run.id);

      const invalidSeasonResponse = await fetch(`${baseUrl}/api/standings?season=quarterly`);
      expect(invalidSeasonResponse.status).toBe(400);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("builds an agent playbook and action trace from action batches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-agent-trace-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const task = buildFixtureTasks()[0];

      const runResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          competitor: "trace-agent",
          competitorType: "agent"
        })
      });
      const runPayload = await runResponse.json();

      const playbookResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/agent-playbook`);
      const playbookPayload = await playbookResponse.json();
      expect(playbookResponse.status).toBe(200);
      expect(playbookPayload.playbook).toMatchObject({
        schemaVersion: "steambench.agent-playbook.v1",
        runId: runPayload.run.id,
        eventContract: {
          actionBatchEndpoint: `/api/runs/${runPayload.run.id}/action-batches`,
          submissionEndpoint: `/api/runs/${runPayload.run.id}/submission`
        },
        evidence: {
          canonicalArtifact: "output/output.mp4"
        }
      });
      expect(playbookPayload.playbook.control).toMatchObject({
        inputMode: "keyboard-mouse",
        allowedActionTypes: ["key", "mouse-move", "mouse-click", "scroll", "wait"],
        actionSpace: {
          schemaVersion: "steambench.runtime-action-space.v1",
          permissions: {
            keyboard: true,
            mouse: true,
            controller: false,
            privilegedSystemInput: false
          },
          constraints: {
            requireCanonicalCapture: true
          }
        }
      });

      const batchResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/action-batches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          step: 1,
          observation: "Initial chamber loaded and cube is visible.",
          actions: ["key:w", "mouse-click:left", "key:e"],
          checkpoint: "Cube picked up",
          confidence: 0.82,
          idempotencyKey: "trace-batch-1"
        })
      });
      const batchPayload = await batchResponse.json();
      expect(batchResponse.status).toBe(201);
      expect(batchPayload.receipt).toMatchObject({
        schemaVersion: "steambench.agent-action-batch-receipt.v1",
        runId: runPayload.run.id,
        taskId: task.id,
        controlSessionId: null,
        inputMode: "keyboard-mouse",
        transport: "local-desktop",
        acceptedActions: 3,
        rejectedActions: 0,
        actionTypes: ["key", "mouse-click"],
        normalizedActionLabels: ["key:w:tap", "mouse-click:left", "key:e:tap"],
        audit: {
          readyForTraceAudit: true,
          executorReportRequired: false,
          canonicalCaptureRequired: true,
          canonicalArtifact: "output/output.mp4",
          acceptedArtifactName: "output.mp4",
          forbiddenArtifactNames: ["output-test.mp4"]
        },
        endpoints: {
          actionBatch: `/api/runs/${runPayload.run.id}/action-batches`,
          trace: `/api/runs/${runPayload.run.id}/agent-trace`,
          traceAudit: `/api/runs/${runPayload.run.id}/agent-trace/audit`,
          submission: `/api/runs/${runPayload.run.id}/submission`,
          evidenceBundle: `/api/runs/${runPayload.run.id}/evidence-bundle`,
          resultCertificate: `/api/runs/${runPayload.run.id}/result-certificate`
        }
      });
      expect(batchPayload.receipt.events.observationId).toBe(batchPayload.events[0].id);
      expect(batchPayload.receipt.events.actId).toBe(batchPayload.events[1].id);
      expect(batchPayload.receipt.events.checkpointId).toBe(batchPayload.events[2].id);
      expect(batchPayload.receipt.executionPlan).toBeNull();
      expect(batchPayload.actionSpace.schemaVersion).toBe("steambench.runtime-action-space.v1");
      expect(batchPayload.normalizedActions).toEqual([
        { type: "key", key: "w", action: "tap" },
        { type: "mouse-click", button: "left" },
        { type: "key", key: "e", action: "tap" }
      ]);
      expect(batchPayload.trace).toMatchObject({
        schemaVersion: "steambench.agent-action-trace.v1",
        totals: {
          observations: 1,
          actionBatches: 1,
          actions: 3,
          checkpoints: 1
        },
        coverage: {
          hasObservation: true,
          hasAction: true,
          readyForSubmission: true
        }
      });

      const traceResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/agent-trace`);
      const tracePayload = await traceResponse.json();
      expect(traceResponse.status).toBe(200);
      expect(tracePayload.trace.timeline.map((event: { type: string }) => event.type)).toEqual(["observe", "act", "checkpoint"]);
      expect(tracePayload.trace.nextActions.join(" ")).toContain("output/output.mp4");

      const controllerTask = buildFixtureTasks().find((entry) => entry.appid === 1145360)!;
      const controllerRunResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: controllerTask.id,
          competitor: "controller-trace-agent",
          competitorType: "agent"
        })
      });
      const controllerRunPayload = await controllerRunResponse.json();
      const controllerPlaybookResponse = await fetch(`${baseUrl}/api/runs/${controllerRunPayload.run.id}/agent-playbook`);
      const controllerPlaybookPayload = await controllerPlaybookResponse.json();
      expect(controllerPlaybookResponse.status).toBe(200);
      expect(controllerPlaybookPayload.playbook.control.actionSpace).toMatchObject({
        schemaVersion: "steambench.runtime-action-space.v1",
        inputMode: "controller",
        transport: "virtual-controller",
        permissions: {
          controller: true,
          keyboard: false,
          mouse: false,
          privilegedSystemInput: false
        },
        controller: {
          layout: "xinput-standard",
          sticks: ["left", "right"],
          triggers: ["lt", "rt"]
        }
      });
      expect(controllerPlaybookPayload.playbook.control.actionSpace.controller.buttons).toContain("a");
      expect(controllerPlaybookPayload.playbook.control.actionSpace.controller.buttons).toContain("dpad-up");

      const handoffBeforeControlResponse = await fetch(`${baseUrl}/api/runs/${controllerRunPayload.run.id}/agent-handoff`);
      const handoffBeforeControlPayload = await handoffBeforeControlResponse.json();
      expect(handoffBeforeControlResponse.status).toBe(200);
      expect(handoffBeforeControlPayload.handoff).toMatchObject({
        schemaVersion: "steambench.agent-runtime-handoff.v1",
        status: "needs-control-session",
        control: {
          inputMode: "controller",
          transport: "virtual-controller",
          requiresControlSession: true
        },
        endpoints: {
          playbook: `/api/runs/${controllerRunPayload.run.id}/agent-playbook`,
          actionBatch: `/api/runs/${controllerRunPayload.run.id}/action-batches`,
          controlSessions: `/api/runs/${controllerRunPayload.run.id}/control-sessions`
        }
      });
      expect(handoffBeforeControlPayload.handoff.recommendedActions.map((entry: { id: string }) => entry.id)).toContain("create-control-session");

      const controlSessionResponse = await fetch(`${baseUrl}/api/runs/${controllerRunPayload.run.id}/control-sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ttlSeconds: 120,
          idempotencyKey: "controller-control-session"
        })
      });
      const controlSessionPayload = await controlSessionResponse.json();
      expect(controlSessionResponse.status).toBe(201);
      expect(controlSessionPayload).toMatchObject({
        schemaVersion: "steambench.runtime-control-session.v1",
        session: {
          runId: controllerRunPayload.run.id,
          taskId: controllerTask.id,
          status: "active",
          actionSpace: {
            inputMode: "controller",
            transport: "virtual-controller"
          }
        },
        links: {
          actionBatch: `/api/runs/${controllerRunPayload.run.id}/action-batches`,
          heartbeat: `/api/control-sessions/${controlSessionPayload.session.id}/heartbeat`,
          revoke: `/api/control-sessions/${controlSessionPayload.session.id}/revoke`,
          accessPacket: `/api/control-sessions/${controlSessionPayload.session.id}/access-packet`,
          bridgeManifest: `/api/control-sessions/${controlSessionPayload.session.id}/bridge-manifest`,
          executorReport: `/api/runs/${controllerRunPayload.run.id}/controller-executor-reports`
        }
      });

      const duplicateControlSessionResponse = await fetch(`${baseUrl}/api/runs/${controllerRunPayload.run.id}/control-sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ttlSeconds: 120,
          idempotencyKey: "controller-control-session"
        })
      });
      const duplicateControlSessionPayload = await duplicateControlSessionResponse.json();
      expect(duplicateControlSessionResponse.status).toBe(201);
      expect(duplicateControlSessionPayload.session.id).toBe(controlSessionPayload.session.id);

      const secondControllerRunResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: controllerTask.id,
          competitor: "controller-trace-agent-second-run",
          competitorType: "agent"
        })
      });
      const secondControllerRunPayload = await secondControllerRunResponse.json();
      const secondControlSessionResponse = await fetch(`${baseUrl}/api/runs/${secondControllerRunPayload.run.id}/control-sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ttlSeconds: 120,
          idempotencyKey: "controller-control-session"
        })
      });
      const secondControlSessionPayload = await secondControlSessionResponse.json();
      expect(secondControlSessionResponse.status).toBe(201);
      expect(secondControlSessionPayload.session.runId).toBe(secondControllerRunPayload.run.id);
      expect(secondControlSessionPayload.session.id).not.toBe(controlSessionPayload.session.id);

      const controllerBatchResponse = await fetch(`${baseUrl}/api/runs/${controllerRunPayload.run.id}/action-batches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          controlSessionId: controlSessionPayload.session.id,
          observation: "Boss room loaded; dash cooldown ready.",
          actions: [
            { type: "stick", stick: "left", x: 0.8, y: -0.2, durationMs: 300 },
            { type: "button", button: "a", action: "tap" },
            { type: "trigger", trigger: "rt", value: 1, durationMs: 120 }
          ],
          confidence: 0.74
        })
      });
      const controllerBatchPayload = await controllerBatchResponse.json();
      expect(controllerBatchResponse.status).toBe(201);
      expect(controllerBatchPayload.receipt).toMatchObject({
        schemaVersion: "steambench.agent-action-batch-receipt.v1",
        runId: controllerRunPayload.run.id,
        taskId: controllerTask.id,
        controlSessionId: controlSessionPayload.session.id,
        inputMode: "controller",
        transport: "virtual-controller",
        acceptedActions: 3,
        rejectedActions: 0,
        actionTypes: ["stick", "button", "trigger"],
        normalizedActionLabels: [
          "stick:left:0.80,-0.20",
          "button:a:tap",
          "trigger:rt:1.00"
        ],
        executionPlan: {
          schemaVersion: "steambench.controller-execution-plan.v1",
          target: "xinput-standard",
          stepCount: 9,
          totalDurationMs: 500,
          neutralOnCompletion: true
        },
        controllerExecutorRequest: {
          schemaVersion: "steambench.controller-executor-request.v1",
          executor: "geforce-now",
          provider: "geforce-now-external",
          sessionId: controlSessionPayload.session.id,
          runId: controllerRunPayload.run.id,
          taskId: controllerTask.id,
          planSchemaVersion: "steambench.controller-execution-plan.v1",
          stepCount: 9,
          totalDurationMs: 500,
          command: "npm run executor:geforce-now"
        },
        audit: {
          readyForTraceAudit: true,
          executorReportRequired: true,
          canonicalCaptureRequired: true,
          canonicalArtifact: "output/output.mp4",
          acceptedArtifactName: "output.mp4",
          forbiddenArtifactNames: ["output-test.mp4"]
        },
        endpoints: {
          actionBatch: `/api/runs/${controllerRunPayload.run.id}/action-batches`,
          trace: `/api/runs/${controllerRunPayload.run.id}/agent-trace`,
          traceAudit: `/api/runs/${controllerRunPayload.run.id}/agent-trace/audit`,
          submission: `/api/runs/${controllerRunPayload.run.id}/submission`,
          evidenceBundle: `/api/runs/${controllerRunPayload.run.id}/evidence-bundle`,
          resultCertificate: `/api/runs/${controllerRunPayload.run.id}/result-certificate`,
          bridgeManifest: `/api/control-sessions/${controlSessionPayload.session.id}/bridge-manifest`
        }
      });
      expect(controllerBatchPayload.controllerExecutorRequest).toMatchObject({
        schemaVersion: "steambench.controller-executor-request.v1",
        executor: "geforce-now",
        provider: "geforce-now-external",
        sessionId: controlSessionPayload.session.id,
        runId: controllerRunPayload.run.id,
        taskId: controllerTask.id,
        plan: {
          schemaVersion: "steambench.controller-execution-plan.v1",
          target: "xinput-standard",
          totalDurationMs: 500,
          neutralOnCompletion: true
        }
      });
      expect(controllerBatchPayload.controllerExecutorRequest.plan.steps).toHaveLength(9);
      expect(controllerBatchPayload.receipt.events.observationId).toBe(controllerBatchPayload.events[0].id);
      expect(controllerBatchPayload.receipt.events.actId).toBe(controllerBatchPayload.events[1].id);
      expect(controllerBatchPayload.receipt.events.checkpointId).toBeNull();
      expect(controllerBatchPayload.controlSession.id).toBe(controlSessionPayload.session.id);
      expect(controllerBatchPayload.actionSpace.inputMode).toBe("controller");
      expect(controllerBatchPayload.normalizedActions).toEqual([
        { type: "stick", stick: "left", x: 0.8, y: -0.2, durationMs: 300 },
        { type: "button", button: "a", action: "tap", durationMs: 80 },
        { type: "trigger", trigger: "rt", value: 1, durationMs: 120 }
      ]);
      expect(controllerBatchPayload.normalizedActionLabels).toEqual([
        "stick:left:0.80,-0.20",
        "button:a:tap",
        "trigger:rt:1.00"
      ]);
      expect(controllerBatchPayload.executionPlan).toMatchObject({
        schemaVersion: "steambench.controller-execution-plan.v1",
        transport: "virtual-controller",
        target: "xinput-standard",
        timing: "relative-ms",
        neutralOnCompletion: true,
        totalDurationMs: 500,
        sourceActionLabels: [
          "stick:left:0.80,-0.20",
          "button:a:tap",
          "trigger:rt:1.00"
        ]
      });
      expect(controllerBatchPayload.executionPlan.steps.map((step: { kind: string }) => step.kind)).toEqual([
        "set-stick",
        "wait",
        "reset-stick",
        "button-down",
        "wait",
        "button-up",
        "set-trigger",
        "wait",
        "reset-trigger"
      ]);
      expect(controllerBatchPayload.trace.totals.actions).toBe(3);

      const controlAccessPacketResponse = await fetch(`${baseUrl}/api/control-sessions/${controlSessionPayload.session.id}/access-packet`);
      const controlAccessPacketPayload = await controlAccessPacketResponse.json();
      expect(controlAccessPacketResponse.status).toBe(200);
      expect(controlAccessPacketPayload.packet).toMatchObject({
        schemaVersion: "steambench.runtime-control-access-packet.v1",
        purpose: "bounded-agent-game-control",
        lease: {
          id: controlSessionPayload.session.id,
          status: "active",
          runId: controllerRunPayload.run.id,
          taskId: controllerTask.id
        },
        permissions: {
          actionSpace: "steambench.runtime-action-space.v1",
          inputMode: "controller",
          transport: "virtual-controller",
          privilegedSystemInput: false,
          canonicalCaptureRequired: true
        },
        endpoints: {
          actionBatch: `/api/runs/${controllerRunPayload.run.id}/action-batches`,
          bridgeManifest: `/api/control-sessions/${controlSessionPayload.session.id}/bridge-manifest`,
          heartbeat: `/api/control-sessions/${controlSessionPayload.session.id}/heartbeat`,
          revoke: `/api/control-sessions/${controlSessionPayload.session.id}/revoke`,
          executorReport: `/api/runs/${controllerRunPayload.run.id}/controller-executor-reports`
        },
        bridge: {
          provider: "geforce-now",
          ready: true,
          manifestSchemaVersion: "steambench.control-bridge-manifest.v1",
          executor: {
            command: "npm run executor:geforce-now",
            requestSchemaVersion: "steambench.controller-executor-request.v1",
            reportSchemaVersion: "steambench.controller-executor-report.v1",
            executionPlanSchemaVersion: "steambench.controller-execution-plan.v1",
            target: "xinput-standard",
            neutralOnCompletion: true
          },
          handoff: {
            readManifest: `/api/control-sessions/${controlSessionPayload.session.id}/bridge-manifest`,
            submitActions: `/api/runs/${controllerRunPayload.run.id}/action-batches`,
            heartbeat: `/api/control-sessions/${controlSessionPayload.session.id}/heartbeat`,
            reportBack: `/api/runs/${controllerRunPayload.run.id}/controller-executor-reports`,
            reportBackMode: "typed-controller-executor-report-submission"
          }
        },
        audit: {
          readyForActions: true,
          readyForBridge: true,
          blockers: [],
          expectedExecutorReport: "steambench.controller-executor-report.v1",
          canonicalArtifact: "output/output.mp4",
          acceptedArtifactName: "output.mp4",
          forbiddenArtifactNames: ["output-test.mp4"]
        }
      });
      expect(controlAccessPacketPayload.packet.lease.ttlRemainingSeconds).toBeGreaterThan(0);
      expect(controlAccessPacketPayload.packet.permissions.allowedActionTypes).toEqual(["button", "stick", "trigger", "wait"]);
      expect(controlAccessPacketPayload.packet.permissions.controller.buttons).toContain("a");

      const handoffAfterControlResponse = await fetch(`${baseUrl}/api/runs/${controllerRunPayload.run.id}/agent-handoff`);
      const handoffAfterControlPayload = await handoffAfterControlResponse.json();
      expect(handoffAfterControlResponse.status).toBe(200);
      expect(handoffAfterControlPayload.handoff).toMatchObject({
        status: "ready-for-submission",
        control: {
          activeSession: {
            id: controlSessionPayload.session.id,
            accessPacket: `/api/control-sessions/${controlSessionPayload.session.id}/access-packet`,
            bridgeManifest: `/api/control-sessions/${controlSessionPayload.session.id}/bridge-manifest`,
            executorReport: `/api/runs/${controllerRunPayload.run.id}/controller-executor-reports`
          }
        },
        endpoints: {
          activeAccessPacket: `/api/control-sessions/${controlSessionPayload.session.id}/access-packet`,
          activeBridgeManifest: `/api/control-sessions/${controlSessionPayload.session.id}/bridge-manifest`,
          activeExecutorReport: `/api/runs/${controllerRunPayload.run.id}/controller-executor-reports`
        },
        trace: {
          coverage: {
            readyForSubmission: true
          }
        }
      });
      expect(handoffAfterControlPayload.handoff.recommendedActions.map((entry: { id: string }) => entry.id)).toEqual([
        "inspect-bridge-manifest",
        "submit-run",
        "inspect-trace"
      ]);

      const bridgeManifestResponse = await fetch(`${baseUrl}/api/control-sessions/${controlSessionPayload.session.id}/bridge-manifest`);
      const bridgeManifestPayload = await bridgeManifestResponse.json();
      expect(bridgeManifestResponse.status).toBe(200);
      expect(bridgeManifestPayload.manifest).toMatchObject({
        schemaVersion: "steambench.control-bridge-manifest.v1",
        bridge: {
          provider: "geforce-now",
          transport: "virtual-controller",
          inputMode: "controller",
          canonicalCaptureRequired: true,
          privilegedSystemInput: false,
          executor: {
            planSchemaVersion: "steambench.controller-execution-plan.v1",
            target: "xinput-standard",
            timing: "relative-ms",
            neutralOnCompletion: true
          }
        },
        lease: {
          id: controlSessionPayload.session.id,
          status: "active",
          runId: controllerRunPayload.run.id
        },
        evidence: {
          canonicalArtifact: "output/output.mp4",
          acceptedArtifactName: "output.mp4",
          forbiddenArtifactNames: ["output-test.mp4"]
        },
        endpoints: {
          actionBatch: `/api/runs/${controllerRunPayload.run.id}/action-batches`,
          accessPacket: `/api/control-sessions/${controlSessionPayload.session.id}/access-packet`,
          heartbeat: `/api/control-sessions/${controlSessionPayload.session.id}/heartbeat`,
          revoke: `/api/control-sessions/${controlSessionPayload.session.id}/revoke`,
          trace: `/api/runs/${controllerRunPayload.run.id}/agent-trace`,
          executorReport: `/api/runs/${controllerRunPayload.run.id}/controller-executor-reports`
        },
        audit: {
          actionBatches: 1,
          acceptedActions: 3,
          readyForBridge: true,
          blockers: []
        }
      });
      expect(bridgeManifestPayload.manifest.audit.lastActionLabels).toEqual([
        "stick:left:0.80,-0.20",
        "button:a:tap",
        "trigger:rt:1.00"
      ]);
      expect(bridgeManifestPayload.manifest.audit.executorReports).toBe(0);

      const traceAuditBeforeExecutorResponse = await fetch(`${baseUrl}/api/runs/${controllerRunPayload.run.id}/agent-trace/audit`);
      const traceAuditBeforeExecutorPayload = await traceAuditBeforeExecutorResponse.json();
      expect(traceAuditBeforeExecutorResponse.status).toBe(200);
      expect(traceAuditBeforeExecutorPayload.audit).toMatchObject({
        schemaVersion: "steambench.agent-trace-audit.v1",
        verdict: "needs-executor-report",
        totals: {
          observations: 1,
          actionBatches: 1,
          actions: 3,
          controlSessions: 1,
          executorReports: 0,
          invalidFindings: 0
        },
        integrity: {
          actionBatchesBoundToKnownControlSession: true,
          controllerExecutionPlansPresent: true,
          executorReportRequired: true,
          executorReportPresent: false
        }
      });
      expect(traceAuditBeforeExecutorPayload.audit.recommendedActions.map((entry: { id: string }) => entry.id)).toEqual([
        "run-bridge-executor",
        "inspect-agent-handoff"
      ]);

      const traceOpsBeforeExecutorResponse = await fetch(`${baseUrl}/api/agent-traces/ops-report?verdict=needs-executor-report&limit=10`);
      const traceOpsBeforeExecutorPayload = await traceOpsBeforeExecutorResponse.json();
      expect(traceOpsBeforeExecutorResponse.status).toBe(200);
      expect(traceOpsBeforeExecutorPayload.report).toMatchObject({
        schemaVersion: "steambench.agent-trace-ops-report.v1",
        status: "needs-runtime",
        totals: {
          needsExecutorReport: 1
        }
      });
      expect(traceOpsBeforeExecutorPayload.report.tickets.some((entry: {
        run: { id: string };
        verdict: string;
        audit: { activeControlSessionId?: string };
      }) =>
        entry.run.id === controllerRunPayload.run.id &&
        entry.verdict === "needs-executor-report" &&
        entry.audit.activeControlSessionId === controlSessionPayload.session.id
      )).toBe(true);
      expect(traceOpsBeforeExecutorPayload.report.recommendedActions.some((entry: { id: string; command?: string }) =>
        entry.id === "run-bridge-executor" &&
        entry.command?.includes(`--session=${controlSessionPayload.session.id}`)
      )).toBe(true);

      const bridgeOpsResponse = await fetch(`${baseUrl}/api/control-sessions/ops-report?status=active&transport=virtual-controller&limit=5`);
      const bridgeOpsPayload = await bridgeOpsResponse.json();
      expect(bridgeOpsResponse.status).toBe(200);
      expect(bridgeOpsPayload.report).toMatchObject({
        schemaVersion: "steambench.control-bridge-ops-report.v1",
        status: "needs-executor-report",
        totals: {
          active: 2,
          virtualController: 2,
          needsExecutorReport: 1
        }
      });
      expect(bridgeOpsPayload.report.tickets.some((entry: { session: { id: string }; status: string; actionBatches: number }) =>
        entry.session.id === controlSessionPayload.session.id &&
        entry.status === "needs-executor-report" &&
        entry.actionBatches === 1
      )).toBe(true);
      expect(bridgeOpsPayload.report.recommendedActions.some((entry: { id: string; command?: string }) =>
        entry.id === "run-control-bridge" &&
        entry.command?.includes(`--session=${controlSessionPayload.session.id}`)
      )).toBe(true);

      const executorReportEventResponse = await fetch(`${baseUrl}/api/runs/${controllerRunPayload.run.id}/controller-executor-reports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "Controller executor validated the virtual gamepad plan.",
          idempotencyKey: "controller-executor-report",
          controlSessionId: controlSessionPayload.session.id,
          report: {
            schemaVersion: "steambench.controller-executor-report.v1",
            status: "validated",
            executor: "geforce-now",
            provider: "geforce-now-fixture",
            sessionId: controlSessionPayload.session.id,
            runId: controllerRunPayload.run.id,
            taskId: controllerTask.id,
            planSchemaVersion: "steambench.controller-execution-plan.v1",
            target: "xinput-standard",
            timing: "relative-ms",
            totalDurationMs: 500,
            plannedStepCount: 9,
            executedStepCount: 0,
            sideEffects: false,
            adapterProtocol: "steambench.controller-executor-request.v1",
            backendProtocol: "steambench.geforce-now-gamepad-backend-request.v1"
          }
        })
      });
      const executorReportEventPayload = await executorReportEventResponse.json();
      expect(executorReportEventResponse.status).toBe(201);
      expect(executorReportEventPayload.schemaVersion).toBe("steambench.controller-executor-report-submission.v1");
      expect(executorReportEventPayload.event.metadata.executorReport).toBe("steambench.controller-executor-report.v1");
      expect(executorReportEventPayload.event.metadata.backendProtocol).toBe("steambench.geforce-now-gamepad-backend-request.v1");
      expect(executorReportEventPayload.audit).toMatchObject({
        verdict: "trace-ready",
        totals: {
          executorReports: 1
        }
      });

      const executorBridgeManifestResponse = await fetch(`${baseUrl}/api/control-sessions/${controlSessionPayload.session.id}/bridge-manifest`);
      const executorBridgeManifestPayload = await executorBridgeManifestResponse.json();
      expect(executorBridgeManifestPayload.manifest.audit).toMatchObject({
        executorReports: 1,
        lastExecutorStatus: "validated",
        lastExecutor: "geforce-now",
        lastExecutorProvider: "geforce-now-fixture",
        lastExecutorSideEffects: false,
        lastExecutorPlannedStepCount: 9
      });

      const traceAuditAfterExecutorResponse = await fetch(`${baseUrl}/api/runs/${controllerRunPayload.run.id}/agent-trace/audit`);
      const traceAuditAfterExecutorPayload = await traceAuditAfterExecutorResponse.json();
      expect(traceAuditAfterExecutorResponse.status).toBe(200);
      expect(traceAuditAfterExecutorPayload.audit).toMatchObject({
        verdict: "trace-ready",
        totals: {
          executorReports: 1,
          invalidFindings: 0
        },
        integrity: {
          executorReportPresent: true,
          executorReportsSideEffectFree: true
        }
      });
      expect(traceAuditAfterExecutorPayload.audit.recommendedActions.map((entry: { id: string }) => entry.id)).toEqual([
        "submit-run",
        "inspect-agent-handoff"
      ]);

      const traceOpsAfterExecutorResponse = await fetch(`${baseUrl}/api/agent-traces/ops-report?verdict=trace-ready&limit=10`);
      const traceOpsAfterExecutorPayload = await traceOpsAfterExecutorResponse.json();
      expect(traceOpsAfterExecutorResponse.status).toBe(200);
      expect(traceOpsAfterExecutorPayload.report).toMatchObject({
        schemaVersion: "steambench.agent-trace-ops-report.v1",
        status: "ready"
      });
      expect(traceOpsAfterExecutorPayload.report.totals.traceReady).toBeGreaterThanOrEqual(1);
      expect(traceOpsAfterExecutorPayload.report.tickets.some((entry: { run: { id: string }; verdict: string }) =>
        entry.run.id === controllerRunPayload.run.id &&
        entry.verdict === "trace-ready"
      )).toBe(true);

      const validatedBridgeOpsResponse = await fetch(`${baseUrl}/api/control-sessions/ops-report?status=active&transport=virtual-controller&limit=5`);
      const validatedBridgeOpsPayload = await validatedBridgeOpsResponse.json();
      expect(validatedBridgeOpsResponse.status).toBe(200);
      expect(validatedBridgeOpsPayload.report.tickets.some((entry: {
        session: { id: string };
        status: string;
        executorReports: number;
        lastExecutorStatus?: string;
      }) =>
        entry.session.id === controlSessionPayload.session.id &&
        entry.status === "executor-validated" &&
        entry.executorReports === 1 &&
        entry.lastExecutorStatus === "validated"
      )).toBe(true);

      const controllerRunAuditResponse = await fetch(`${baseUrl}/api/runs/${controllerRunPayload.run.id}/audit`);
      const controllerRunAuditPayload = await controllerRunAuditResponse.json();
      expect(controllerRunAuditResponse.status).toBe(200);
      expect(controllerRunAuditPayload.audit.controllerExecutorReports).toEqual([
        expect.objectContaining({
          eventId: executorReportEventPayload.event.id,
          controlSessionId: controlSessionPayload.session.id,
          executor: "geforce-now",
          provider: "geforce-now-fixture",
          status: "validated",
          planSchemaVersion: "steambench.controller-execution-plan.v1",
          plannedStepCount: 9,
          executedStepCount: 0,
          sideEffects: false,
          adapterProtocol: "steambench.controller-executor-request.v1",
          backendProtocol: "steambench.geforce-now-gamepad-backend-request.v1"
        })
      ]);

      const controllerEvidenceResponse = await fetch(`${baseUrl}/api/runs/${controllerRunPayload.run.id}/evidence-bundle`);
      const controllerEvidencePayload = await controllerEvidenceResponse.json();
      expect(controllerEvidenceResponse.status).toBe(200);
      expect(controllerEvidencePayload.bundle.integrity.executorReportCount).toBe(1);
      expect(controllerEvidencePayload.bundle.integrity.latestExecutorReport).toMatchObject({
        executor: "geforce-now",
        provider: "geforce-now-fixture",
        status: "validated",
        sideEffects: false
      });
      expect(controllerEvidencePayload.bundle.integrity.checklist).toContainEqual({
        id: "controller-executor-report",
        label: "Controller executor report is persisted without forbidden host-input side effects",
        status: "pass"
      });

      const controllerStreamResponse = await fetch(`${baseUrl}/api/runs/${controllerRunPayload.run.id}/livestreams`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Controller executor smoke broadcast"
        })
      });
      const controllerStreamPayload = await controllerStreamResponse.json();
      expect(controllerStreamResponse.status).toBe(201);
      await fetch(`${baseUrl}/api/livestreams/${controllerStreamPayload.stream.id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "ended",
          viewerCount: 7
        })
      });
      const controllerBroadcastBundleResponse = await fetch(`${baseUrl}/api/broadcasts/${controllerStreamPayload.stream.id}/evidence-bundle`);
      const controllerBroadcastBundlePayload = await controllerBroadcastBundleResponse.json();
      expect(controllerBroadcastBundleResponse.status).toBe(200);
      expect(controllerBroadcastBundlePayload.bundle.integrity.executorReportCount).toBe(1);
      expect(controllerBroadcastBundlePayload.bundle.integrity.latestExecutorReport).toMatchObject({
        executor: "geforce-now",
        provider: "geforce-now-fixture",
        status: "validated",
        sideEffects: false
      });
      expect(controllerBroadcastBundlePayload.bundle.integrity.checklist).toContainEqual({
        id: "controller-executor-report",
        label: "Broadcast timeline includes a controller executor report without forbidden side effects",
        status: "pass"
      });
      const controllerBroadcastCertificateResponse = await fetch(`${baseUrl}/api/broadcasts/${controllerStreamPayload.stream.id}/result-certificate`);
      const controllerBroadcastCertificatePayload = await controllerBroadcastCertificateResponse.json();
      expect(controllerBroadcastCertificateResponse.status).toBe(200);
      expect(controllerBroadcastCertificatePayload.certificate.evidence.executorReportCount).toBe(1);

      const sessionListResponse = await fetch(`${baseUrl}/api/runs/${controllerRunPayload.run.id}/control-sessions`);
      const sessionListPayload = await sessionListResponse.json();
      expect(sessionListResponse.status).toBe(200);
      expect(sessionListPayload).toMatchObject({
        schemaVersion: "steambench.runtime-control-sessions.v1",
        runId: controllerRunPayload.run.id
      });
      expect(sessionListPayload.controlSessions.some((entry: { session: { id: string } }) => entry.session.id === controlSessionPayload.session.id)).toBe(true);

      const heartbeatResponse = await fetch(`${baseUrl}/api/control-sessions/${controlSessionPayload.session.id}/heartbeat`, {
        method: "POST"
      });
      const heartbeatPayload = await heartbeatResponse.json();
      expect(heartbeatResponse.status).toBe(200);
      expect(heartbeatPayload.session).toMatchObject({
        id: controlSessionPayload.session.id,
        status: "active",
        heartbeatAt: expect.any(String)
      });

      const revokeResponse = await fetch(`${baseUrl}/api/control-sessions/${controlSessionPayload.session.id}/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          summary: "test revoke"
        })
      });
      const revokePayload = await revokeResponse.json();
      expect(revokeResponse.status).toBe(200);
      expect(revokePayload.session.status).toBe("revoked");

      const revokedBridgeOpsResponse = await fetch(`${baseUrl}/api/control-sessions/ops-report?status=revoked&transport=virtual-controller`);
      const revokedBridgeOpsPayload = await revokedBridgeOpsResponse.json();
      expect(revokedBridgeOpsResponse.status).toBe(200);
      expect(revokedBridgeOpsPayload.report.tickets.some((entry: { session: { id: string }; status: string }) =>
        entry.session.id === controlSessionPayload.session.id &&
        entry.status === "revoked"
      )).toBe(true);

      const revokedBatchResponse = await fetch(`${baseUrl}/api/runs/${controllerRunPayload.run.id}/action-batches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          controlSessionId: controlSessionPayload.session.id,
          actions: [{ type: "button", button: "a", action: "tap" }]
        })
      });
      expect(revokedBatchResponse.status).toBe(409);
      expect(await revokedBatchResponse.json()).toMatchObject({
        error: "control_session_not_active"
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("opens a readiness-gated agent run session with control access packet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-agent-run-session-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const controllerTask = buildFixtureTasks().find((entry) => entry.appid === 1145360)!;
      const agent = await store.createAgentProfile({
        handle: "session-agent",
        displayName: "Session Agent",
        capabilities: ["keyboard-mouse", "controller", "turn-based-actions", "screen-capture", "stats-screen", "action-log", "seeded-save", "manual-review", "output.mp4"]
      });

      const sessionResponse = await fetch(`${baseUrl}/api/agents/${agent.id}/run-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: controllerTask.id,
          ttlSeconds: 180,
          createLivestream: true,
          livestreamStatus: "live",
          livestreamTitle: "Session Agent bridge stream",
          currentScene: "Bridge ready for controller input",
          viewerCount: 2,
          idempotencyKey: "route-run-session"
        })
      });
      const sessionPayload = await sessionResponse.json();
      expect(sessionResponse.status).toBe(201);
      expect(sessionPayload).toMatchObject({
        schemaVersion: "steambench.agent-run-session.v1",
        run: {
          taskId: controllerTask.id,
          competitor: "agent:session-agent",
          competitorType: "agent",
          runtimeProvider: "local-sim"
        },
        agent: {
          id: agent.id,
          handle: "session-agent"
        },
        controlSession: {
          session: {
            status: "active",
            actionSpace: {
              inputMode: "controller",
              transport: "virtual-controller"
            }
          }
        },
        handoff: {
          schemaVersion: "steambench.agent-runtime-handoff.v1",
          status: "ready-for-actions",
          control: {
            activeSession: {
              accessPacket: expect.stringContaining("/api/control-sessions/"),
              bridgeManifest: expect.stringContaining("/api/control-sessions/")
            }
          },
          broadcast: {
            activeStream: {
              status: "live",
              detail: expect.stringContaining("/api/broadcasts/"),
              evidenceBundle: expect.stringContaining("/evidence-bundle"),
              statusEndpoint: expect.stringContaining("/api/livestreams/")
            }
          }
        },
        accessPacket: {
          schemaVersion: "steambench.runtime-control-access-packet.v1",
          audit: {
            readyForActions: true,
            readyForBridge: true,
            expectedExecutorReport: "steambench.controller-executor-report.v1",
            canonicalArtifact: "output/output.mp4"
          }
        },
        bridgeManifest: {
          schemaVersion: "steambench.control-bridge-manifest.v1",
          bridge: {
            provider: "geforce-now",
            transport: "virtual-controller"
          }
        },
        livestream: {
          runId: expect.any(String),
          status: "live",
          title: "Session Agent bridge stream",
          playbackUrl: expect.stringContaining("/streams/")
        }
      });
      expect(sessionPayload.accessPacket.lease.ttlRemainingSeconds).toBeGreaterThan(0);
      expect(sessionPayload.links.accessPacket).toBe(`/api/control-sessions/${sessionPayload.controlSession.session.id}/access-packet`);
      expect(sessionPayload.links.bridgeManifest).toBe(`/api/control-sessions/${sessionPayload.controlSession.session.id}/bridge-manifest`);
      expect(sessionPayload.links.executorReport).toBe(`/api/runs/${sessionPayload.run.id}/controller-executor-reports`);
      expect(sessionPayload.links.livestreamStatus).toBe(`/api/livestreams/${sessionPayload.livestream.id}/status`);
      expect(sessionPayload.links.broadcast).toBe(`/api/broadcasts/${sessionPayload.livestream.id}`);
      expect(sessionPayload.links.broadcastEvidenceBundle).toBe(`/api/broadcasts/${sessionPayload.livestream.id}/evidence-bundle`);
      expect(sessionPayload.links.broadcastResultCertificate).toBe(`/api/broadcasts/${sessionPayload.livestream.id}/result-certificate`);

      const broadcastResponse = await fetch(`${baseUrl}/api/broadcasts/${sessionPayload.livestream.id}`);
      const broadcastPayload = await broadcastResponse.json();
      expect(broadcastResponse.status).toBe(200);
      expect(broadcastPayload.broadcast).toMatchObject({
        stream: {
          id: sessionPayload.livestream.id,
          runId: sessionPayload.run.id,
          status: "live"
        },
        run: {
          id: sessionPayload.run.id,
          competitor: "agent:session-agent"
        }
      });

      const blockedAgent = await store.createAgentProfile({
        handle: "blocked-session-agent",
        capabilities: ["screen-capture"]
      });
      const blockedResponse = await fetch(`${baseUrl}/api/agents/${blockedAgent.id}/run-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: controllerTask.id
        })
      });
      expect(blockedResponse.status).toBe(409);
      expect(await blockedResponse.json()).toMatchObject({
        error: "agent_not_ready_for_task"
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts a human Steam-linked submission with canonical artifact and mock achievement proof", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-human-run-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const task = buildFixtureTasks()[0];

      const user = await store.createUser({
        handle: "steam-proof-human",
        displayName: "Steam Proof Human",
        type: "human"
      });
      await store.linkSteamToUser(user.id, "76561198000000000", { proofConsent: true });

      const runResponse = await fetch(`${baseUrl}/api/users/${user.id}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task.id
        })
      });
      const runPayload = await runResponse.json();
      expect(runResponse.status).toBe(201);
      expect(runPayload.run).toMatchObject({
        competitor: "human:steam-proof-human",
        competitorType: "human",
        runtimeProvider: "manual",
        artifactName: "output.mp4"
      });

      const submissionResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/submission`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          artifactPath: "output/output.mp4",
          userId: user.id,
          allowMock: true,
          steamProof: {
            achieved: true,
            source: "test-mock"
          }
        })
      });
      const submissionPayload = await submissionResponse.json();
      expect(submissionResponse.status).toBe(201);
      expect(submissionPayload.receipt).toMatchObject({
        schemaVersion: "steambench.run-submission-receipt.v1",
        canonicalArtifactName: "output.mp4",
        scoreboardReady: true
      });
      expect(submissionPayload.proofs.some((proof: { type: string; status: string }) => proof.type === "steam-achievement" && proof.status === "verified")).toBe(true);
      expect(submissionPayload.evaluation.passed).toBe(true);
      expect(submissionPayload.evaluation.run.status).toBe("scored");
      expect(submissionPayload.bundle.schemaVersion).toBe("steambench.evidence-bundle.v1");
      expect(submissionPayload.certificate.schemaVersion).toBe("steambench.result-certificate.v1");
      expect(submissionPayload.certificate.integrity.readyForPublicShare).toBe(true);

      const proofPlanResponse = await fetch(`${baseUrl}/api/users/${user.id}/steam-proof-plan?limit=4`);
      const proofPlanPayload = await proofPlanResponse.json();
      expect(proofPlanResponse.status).toBe(200);
      expect(proofPlanPayload.plan).toMatchObject({
        schemaVersion: "steambench.human-steam-proof-plan.v1",
        ready: true,
        user: {
          id: user.id
        },
        steamid: "76561198000000000"
      });
      expect(proofPlanPayload.plan.items.some((entry: { task: { id: string }; status: string; action: { createRunEndpoint: string } }) =>
        entry.task.id === task.id &&
        entry.status === "already-scored" &&
        entry.action.createRunEndpoint === `/api/users/${user.id}/runs`
      )).toBe(true);
      const scoredPlanItem = proofPlanPayload.plan.items.find((entry: { task: { id: string } }) => entry.task.id === task.id);
      expect(scoredPlanItem.entryPacket).toMatchObject({
        schemaVersion: "steambench.human-benchmark-entry-packet.v1",
        userId: user.id,
        taskId: task.id,
        appid: task.appid,
        status: "already-scored",
        readyForSubmission: false,
        proofType: "steam-achievement",
        competitor: {
          type: "human",
          handle: "steam-proof-human",
          steamid: "76561198000000000"
        },
        evidence: {
          canonicalArtifact: "output/output.mp4",
          acceptedArtifactName: "output.mp4",
          forbiddenArtifactNames: ["output-test.mp4"],
          proofConsentRequired: true,
          steamLinkRequired: true
        },
        endpoints: {
          proofPlan: `/api/users/${user.id}/steam-proof-plan`,
          createRun: `/api/users/${user.id}/runs`,
          submitProof: `/api/users/${user.id}/steam-proof-submissions`,
          linkSteam: `/api/users/${user.id}/steam`,
          proofConsent: `/api/users/${user.id}/steam-proof-consent`,
          run: `/api/runs/${runPayload.run.id}`,
          artifactPresign: `/api/runs/${runPayload.run.id}/artifacts/presign`,
          submission: `/api/runs/${runPayload.run.id}/submission`,
          verifySteamProof: `/api/runs/${runPayload.run.id}/verify-steam-proof`,
          evidenceBundle: `/api/runs/${runPayload.run.id}/evidence-bundle`,
          resultCertificate: `/api/runs/${runPayload.run.id}/result-certificate`
        },
        submission: {
          method: "POST",
          endpoint: `/api/users/${user.id}/steam-proof-submissions`,
          body: {
            taskId: task.id,
            artifactPath: "output/output.mp4"
          }
        },
        blockers: [
          {
            id: "already-scored",
            endpoint: `/api/runs/${runPayload.run.id}/result-certificate`
          }
        ]
      });

      const humanProofOpsResponse = await fetch(`${baseUrl}/api/human-proof/ops-report?appid=${task.appid}&limit=4`);
      const humanProofOpsPayload = await humanProofOpsResponse.json();
      expect(humanProofOpsResponse.status).toBe(200);
      expect(humanProofOpsPayload.report).toMatchObject({
        schemaVersion: "steambench.human-proof-ops-report.v1",
        filters: {
          appid: task.appid,
          limit: 4
        },
        totals: {
          humans: 1,
          linked: 1,
          consented: 1
        }
      });
      expect(humanProofOpsPayload.report.tickets.some((entry: { user: { id: string }; status: string }) =>
        entry.user.id === user.id && (entry.status === "ready-to-submit" || entry.status === "already-scored")
      )).toBe(true);
      expect(humanProofOpsPayload.report.recommendedActions.map((entry: { id: string }) => entry.id)).toContain("inspect-human-proof-plan");

      const proofReportResponse = await fetch(`${baseUrl}/api/users/${user.id}/steam-proof-report?appid=${task.appid}&live=true`);
      const proofReportPayload = await proofReportResponse.json();
      expect(proofReportResponse.status).toBe(200);
      expect(proofReportPayload.report).toMatchObject({
        schemaVersion: "steambench.steam-proof-fetch-report.v1",
        user: {
          id: user.id
        },
        steamid: "76561198000000000",
        appid: task.appid,
        status: "live-fetch-blocked",
        liveProofEnabled: false,
        fetch: {
          attempted: true
        },
        totals: {
          verifiedProofs: 1,
          mockProofs: 1,
          steamWebApiProofs: 0
        }
      });
      expect(proofReportPayload.report.fetch.error).toContain("STEAM_WEB_API_KEY");
      expect(proofReportPayload.report.items.some((entry: { task: { id: string }; proofStatus: string; proofSource?: string; action: { verifyEndpoint?: string } }) =>
        entry.task.id === task.id &&
        entry.proofStatus === "verified" &&
        entry.proofSource === "test-mock" &&
        entry.action.verifyEndpoint === `/api/runs/${runPayload.run.id}/verify-steam-proof`
      )).toBe(true);

      const plannedSubmissionResponse = await fetch(`${baseUrl}/api/users/${user.id}/steam-proof-submissions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const plannedSubmissionPayload = await plannedSubmissionResponse.json();
      expect(plannedSubmissionResponse.status).toBe(201);
      expect(plannedSubmissionPayload.submission).toMatchObject({
        schemaVersion: "steambench.human-steam-proof-submission.v1",
        userId: user.id,
        entryPacket: {
          schemaVersion: "steambench.human-benchmark-entry-packet.v1",
          userId: user.id,
          readyForSubmission: true,
          status: "ready",
          evidence: {
            canonicalArtifact: "output/output.mp4",
            acceptedArtifactName: "output.mp4",
            forbiddenArtifactNames: ["output-test.mp4"]
          },
          endpoints: {
            createRun: `/api/users/${user.id}/runs`,
            submitProof: `/api/users/${user.id}/steam-proof-submissions`
          },
          submission: {
            method: "POST",
            endpoint: `/api/users/${user.id}/steam-proof-submissions`,
            body: {
              artifactPath: "output/output.mp4"
            }
          },
          blockers: []
        },
        scoreboardReady: true
      });
      expect(plannedSubmissionPayload.run).toMatchObject({
        competitor: "human:steam-proof-human",
        competitorType: "human",
        status: "scored"
      });
      expect(plannedSubmissionPayload.bundle).toMatchObject({
        schemaVersion: "steambench.evidence-bundle.v1",
        integrity: {
          verdict: "scoreboard-ready"
        }
      });
      expect(plannedSubmissionPayload.certificate).toMatchObject({
        schemaVersion: "steambench.result-certificate.v1",
        kind: "run",
        integrity: {
          readyForPublicShare: true
        }
      });

      const standingsResponse = await fetch(`${baseUrl}/api/standings`);
      const standingsPayload = await standingsResponse.json();
      expect(standingsPayload.standings.competitors.some((entry: { competitor: string }) => entry.competitor === "human:steam-proof-human")).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exposes and audits pending proof reviews", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-proof-review-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const task = buildFixtureTasks().find((entry) => entry.track === "capture");
      expect(task).toBeDefined();

      const runResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task!.id,
          competitor: "proof-review-agent",
          competitorType: "agent"
        })
      });
      const runPayload = await runResponse.json();

      const proofResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/proofs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "manual-review",
          summary: "Reviewer should inspect the score screen and route trace.",
          metadata: {
            metricName: task!.metricName,
            metricValue: 51
          }
        })
      });
      const proofPayload = await proofResponse.json();
      expect(proofResponse.status).toBe(201);
      expect(proofPayload.proof.status).toBe("pending");

      const reviewQueueResponse = await fetch(`${baseUrl}/api/proofs/review`);
      const reviewQueuePayload = await reviewQueueResponse.json();
      expect(reviewQueueResponse.status).toBe(200);
      expect(reviewQueuePayload.proofs[0]).toMatchObject({
        proof: {
          id: proofPayload.proof.id,
          status: "pending"
        },
        run: {
          id: runPayload.run.id
        },
        task: {
          id: task!.id
        }
      });

      const stateResponse = await fetch(`${baseUrl}/api/state`);
      const statePayload = await stateResponse.json();
      expect(statePayload.proofReviewQueue.some((entry: { proof: { id: string } }) => entry.proof.id === proofPayload.proof.id)).toBe(true);

      const auditResponse = await fetch(`${baseUrl}/api/proofs/${proofPayload.proof.id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "verified",
          reviewer: "qa-reviewer",
          reviewNotes: "Score screen and capture evidence are consistent."
        })
      });
      const auditPayload = await auditResponse.json();
      expect(auditResponse.status).toBe(200);
      expect(auditPayload.proof).toMatchObject({
        status: "verified",
        reviewer: "qa-reviewer",
        reviewNotes: "Score screen and capture evidence are consistent."
      });
      expect(auditPayload.proof.reviewedAt).toBeDefined();
      expect(auditPayload.event).toMatchObject({
        runId: runPayload.run.id,
        type: "proof"
      });

      const pendingAfter = await fetch(`${baseUrl}/api/proofs/review`);
      expect((await pendingAfter.json()).proofs.some((entry: { proof: { id: string } }) => entry.proof.id === proofPayload.proof.id)).toBe(false);
      const allAfter = await fetch(`${baseUrl}/api/proofs/review?status=all`);
      expect((await allAfter.json()).proofs.some((entry: { proof: { id: string } }) => entry.proof.id === proofPayload.proof.id)).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("registers agents, queues agent runs, and returns runtime execution packages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-agent-package-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const task = buildFixtureTasks().find((entry) => entry.track === "capture");
      expect(task).toBeDefined();

      const agentResponse = await fetch(`${baseUrl}/api/agents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: "codex-agent-profile",
          displayName: "Codex Agent Profile",
          provider: "local",
          command: "node scripts/runtime-worker.mjs --agent=codex-agent-profile",
          capabilities: ["keyboard-mouse", "controller", "turn-based-actions", "screen-capture", "stats-screen", "action-log", "seeded-save", "manual-review", "output.mp4"]
        })
      });
      const agentPayload = await agentResponse.json();
      expect(agentResponse.status).toBe(201);
      expect(agentPayload.agent).toMatchObject({
        handle: "codex-agent-profile",
        runtimeProvider: "local-sim",
        status: "active"
      });

      const runResponse = await fetch(`${baseUrl}/api/agents/${agentPayload.agent.id}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task!.id
        })
      });
      const runPayload = await runResponse.json();
      expect(runResponse.status).toBe(201);
      expect(runPayload.run).toMatchObject({
        competitor: "agent:codex-agent-profile",
        competitorType: "agent"
      });

      const dispatchResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "local",
          agentId: agentPayload.agent.id,
          workerId: "test-dispatch-worker"
        })
      });
      const dispatchPayload = await dispatchResponse.json();
      expect(dispatchResponse.status).toBe(201);
      expect(dispatchPayload.dispatch).toMatchObject({
        runId: runPayload.run.id,
        taskId: task!.id,
        agentId: agentPayload.agent.id,
        provider: "local",
        status: "planned",
        workerId: "test-dispatch-worker",
        manifestUrl: `/api/runs/${runPayload.run.id}/execution-manifest?agentId=${agentPayload.agent.id}`,
        runtimePackageUrl: `/api/runs/${runPayload.run.id}/runtime-package?agentId=${agentPayload.agent.id}`
      });
      expect(dispatchPayload.dispatch.command).toContain(`--run='${runPayload.run.id}'`);
      expect(dispatchPayload.dispatch.command).toContain(`--agent='${agentPayload.agent.id}'`);

      const duplicateDispatchResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "local",
          agentId: agentPayload.agent.id,
          workerId: "test-dispatch-worker"
        })
      });
      const duplicateDispatchPayload = await duplicateDispatchResponse.json();
      expect(duplicateDispatchPayload.dispatch.id).toBe(dispatchPayload.dispatch.id);

      const dispatchStatusResponse = await fetch(`${baseUrl}/api/dispatches/${dispatchPayload.dispatch.id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "launched",
          summary: "Test scheduler launched the worker command."
        })
      });
      const dispatchStatusPayload = await dispatchStatusResponse.json();
      expect(dispatchStatusResponse.status).toBe(200);
      expect(dispatchStatusPayload.dispatch).toMatchObject({
        id: dispatchPayload.dispatch.id,
        status: "launched",
        summary: "Test scheduler launched the worker command."
      });
      expect(dispatchStatusPayload.dispatch.launchedAt).toBeDefined();

      const dispatchListResponse = await fetch(`${baseUrl}/api/dispatches`);
      const dispatchListPayload = await dispatchListResponse.json();
      expect(dispatchListResponse.status).toBe(200);
      expect(dispatchListPayload.dispatches.some((entry: { dispatch: { id: string }; run?: { id: string }; agent?: { id: string } }) =>
        entry.dispatch.id === dispatchPayload.dispatch.id &&
        entry.run?.id === runPayload.run.id &&
        entry.agent?.id === agentPayload.agent.id
      )).toBe(true);

      const localModalPackageResponse = await fetch(`${baseUrl}/api/dispatches/${dispatchPayload.dispatch.id}/modal-package`);
      expect(localModalPackageResponse.status).toBe(409);

      const modalDispatchResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "modal",
          agentId: agentPayload.agent.id,
          workerId: "test-modal-worker"
        })
      });
      const modalDispatchPayload = await modalDispatchResponse.json();
      expect(modalDispatchResponse.status).toBe(201);
      expect(modalDispatchPayload.dispatch).toMatchObject({
        runId: runPayload.run.id,
        provider: "modal",
        workerId: "test-modal-worker",
        manifestUrl: `/api/runs/${runPayload.run.id}/execution-manifest?agentId=${agentPayload.agent.id}`
      });
      expect(modalDispatchPayload.dispatch.command).toContain("modal run modal/steambench_runtime.py");

      const modalPackageResponse = await fetch(`${baseUrl}/api/dispatches/${modalDispatchPayload.dispatch.id}/modal-package`);
      const modalPackagePayload = await modalPackageResponse.json();
      expect(modalPackageResponse.status).toBe(200);
      expect(modalPackagePayload.modalPackage).toMatchObject({
        schemaVersion: "steambench.modal-runtime-package.v1",
        dispatchId: modalDispatchPayload.dispatch.id,
        runId: runPayload.run.id,
        workerId: "test-modal-worker",
        entrypoint: {
          file: "modal/steambench_runtime.py",
          localEntrypoint: "main",
          remoteFunction: "run_steambench"
        },
        runtime: {
          targetArtifactName: "output.mp4",
          outputPath: "output/output.mp4",
          stage2StartPolicy: {
            preserveExistingOutputs: true
          }
        },
        modal: {
          appName: "steambench-runtime"
        }
      });
      expect(modalPackagePayload.modalPackage.runtime.stage2StartPolicy.forbiddenStartActions).toContain("session.run_file");
      expect(modalPackagePayload.modalPackage.modal.volumes[0]).toMatchObject({
        name: "steambench-steam-state",
        mountPath: "/steam-state"
      });

      const dispatchOpsResponse = await fetch(`${baseUrl}/api/dispatches/ops-report?limit=5`);
      const dispatchOpsPayload = await dispatchOpsResponse.json();
      expect(dispatchOpsResponse.status).toBe(200);
      expect(dispatchOpsPayload.report).toMatchObject({
        schemaVersion: "steambench.runtime-dispatch-ops-report.v1",
        totals: {
          selectedDispatches: 2,
          pendingLocal: 1,
          pendingModal: 1,
          proofMissing: 2
        }
      });
      expect(dispatchOpsPayload.report.tickets.some((ticket: { dispatch: { id: string }; run?: { id: string }; links: { audit?: string; resultCertificate?: string } }) =>
        ticket.dispatch.id === modalDispatchPayload.dispatch.id &&
        ticket.run?.id === runPayload.run.id &&
        ticket.links.audit === `/api/runs/${runPayload.run.id}/audit` &&
        ticket.links.resultCertificate === `/api/runs/${runPayload.run.id}/result-certificate`
      )).toBe(true);
      expect(dispatchOpsPayload.report.recommendedActions.map((action: { id: string }) => action.id)).toContain("drain-local-dispatches");
      expect(dispatchOpsPayload.report.recommendedActions.map((action: { id: string }) => action.id)).toContain("inspect-modal-package");

      const localDispatchOpsResponse = await fetch(`${baseUrl}/api/dispatches/ops-report?provider=local&status=launched`);
      const localDispatchOpsPayload = await localDispatchOpsResponse.json();
      expect(localDispatchOpsResponse.status).toBe(200);
      expect(localDispatchOpsPayload.report.totals).toMatchObject({
        selectedDispatches: 1,
        pendingLocal: 1,
        pendingModal: 0
      });

      const labResponse = await fetch(`${baseUrl}/api/agents/${agentPayload.agent.id}/lab`);
      const labPayload = await labResponse.json();
      expect(labResponse.status).toBe(200);
      expect(labPayload.lab).toMatchObject({
        agent: {
          id: agentPayload.agent.id
        },
        status: "ready",
        command: "node scripts/runtime-worker.mjs --agent=codex-agent-profile",
        queue: {
          nextRun: {
            id: runPayload.run.id
          }
        },
        totals: {
          runs: 1,
          queuedRuns: 1
        }
      });
      expect(labPayload.lab.recommendedTasks.some((entry: { readiness: { ready: boolean }; priority: string }) =>
        entry.readiness.ready && (entry.priority === "ready" || entry.priority === "review")
      )).toBe(true);
      expect(labPayload.lab.capabilities.missingAcrossRecommended).toEqual([]);

      const labByHandleResponse = await fetch(`${baseUrl}/api/agents/${agentPayload.agent.handle}/lab`);
      expect(labByHandleResponse.status).toBe(200);

      const agentOpsResponse = await fetch(`${baseUrl}/api/agents/ops-report?provider=local&limit=10`);
      const agentOpsPayload = await agentOpsResponse.json();
      expect(agentOpsResponse.status).toBe(200);
      expect(agentOpsPayload.report).toMatchObject({
        schemaVersion: "steambench.agent-ops-report.v1",
        filters: {
          provider: "local",
          limit: 10
        },
        totals: {
          agents: 1,
          active: 1,
          queuedAgents: 1,
          queuedRuns: 1
        }
      });
      expect(agentOpsPayload.report.tickets.some((ticket: { agent: { id: string }; status: string; links: { nextRunDispatch?: string } }) =>
        ticket.agent.id === agentPayload.agent.id &&
        ticket.status === "queued" &&
        ticket.links.nextRunDispatch === `/api/runs/${runPayload.run.id}/dispatch`
      )).toBe(true);
      expect(agentOpsPayload.report.recommendedActions.map((action: { id: string }) => action.id)).toContain("drain-dispatches");

      const packageResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/runtime-package?agentId=${agentPayload.agent.id}`);
      const packagePayload = await packageResponse.json();
      expect(packageResponse.status).toBe(200);
      expect(packagePayload.agent.handle).toBe("codex-agent-profile");
      expect(packagePayload.plan).toMatchObject({
        track: task!.track,
        targetArtifact: "output.mp4",
        metricName: task!.metricName
      });
      expect(packagePayload.plan.adapter).toMatchObject({
        launchUri: `steam://run/${task!.appid}`,
        captureMode: "screen-recording",
        saveStrategy: "seeded-save"
      });
      expect(packagePayload.plan.adapter.readinessChecks.length).toBeGreaterThan(0);
      expect(packagePayload.readiness).toMatchObject({
        ready: true,
        agentId: agentPayload.agent.id,
        taskId: task!.id,
        missingCapabilities: []
      });
      expect(packagePayload.artifactContract).toMatchObject({
        name: "output.mp4",
        path: "output/output.mp4",
        canonical: true
      });
      expect(packagePayload.proofRequirements.map((entry: { type: string }) => entry.type)).toEqual([
        "manual-review",
        "canonical-artifact"
      ]);
      expect(packagePayload.stage2Contract).toMatchObject({
        outputDirectory: "output",
        preserveExistingOutputs: true
      });
      expect(packagePayload.stage2Contract.forbiddenStartActions).toContain("session.run_file");
      expect(packagePayload.manifestUrl).toBe(`/api/runs/${runPayload.run.id}/execution-manifest`);
      expect(packagePayload.launch.command).toContain("runtime-worker");

      const manifestResponse = await fetch(`${baseUrl}/api/runs/${runPayload.run.id}/execution-manifest?agentId=${agentPayload.agent.id}`);
      const manifestPayload = await manifestResponse.json();
      expect(manifestResponse.status).toBe(200);
      expect(manifestPayload.manifest).toMatchObject({
        schemaVersion: "steambench.execution-manifest.v1",
        run: {
          id: runPayload.run.id
        },
        artifactContract: {
          name: "output.mp4",
          path: "output/output.mp4",
          forbiddenAlternates: ["output-test.mp4"]
        },
        readiness: {
          ready: true
        },
        stage2Contract: {
          preserveExistingOutputs: true
        }
      });
      expect(manifestPayload.manifest.launch.args).toContain(`--api=${baseUrl}`);
      expect(manifestPayload.manifest.proofRequirements.map((entry: { type: string }) => entry.type)).toEqual([
        "manual-review",
        "canonical-artifact"
      ]);

      const stateResponse = await fetch(`${baseUrl}/api/state`);
      const statePayload = await stateResponse.json();
      expect(statePayload.agentRuntimeLabs.some((lab: { agent: { id: string }; queue: { nextRun?: { id: string } }; totals: { queuedRuns: number } }) =>
        lab.agent.id === agentPayload.agent.id && lab.queue.nextRun?.id === runPayload.run.id && lab.totals.queuedRuns === 1
      )).toBe(true);
      expect(statePayload.runtimeDispatches.some((entry: { dispatch: { id: string; status: string } }) =>
        entry.dispatch.id === dispatchPayload.dispatch.id && entry.dispatch.status === "launched"
      )).toBe(true);

      const campaignPlanResponse = await fetch(`${baseUrl}/api/agents/${agentPayload.agent.id}/campaign-plan?limit=2&provider=local`);
      const campaignPlanPayload = await campaignPlanResponse.json();
      expect(campaignPlanResponse.status).toBe(200);
      expect(campaignPlanPayload.plan).toMatchObject({
        schemaVersion: "steambench.agent-campaign.v1",
        requestedTaskCount: 2,
        selectedTaskCount: 2,
        provider: "local"
      });

      const campaignResponse = await fetch(`${baseUrl}/api/agents/${agentPayload.agent.id}/campaigns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          limit: 2,
          provider: "local",
          dispatch: true
        })
      });
      const campaignPayload = await campaignResponse.json();
      expect(campaignResponse.status).toBe(201);
      expect(campaignPayload.campaign).toMatchObject({
        schemaVersion: "steambench.agent-campaign.v1",
        requestedTaskCount: 2,
        selectedTaskCount: 2,
        runCount: 2,
        dispatchCount: 2
      });
      expect(campaignPayload.campaign.record).toMatchObject({
        id: campaignPayload.campaign.id,
        agentId: agentPayload.agent.id,
        runIds: campaignPayload.campaign.items.map((entry: { run: { id: string } }) => entry.run.id)
      });
      expect(campaignPayload.campaign.report).toMatchObject({
        schemaVersion: "steambench.agent-campaign-report.v1",
        status: "planned",
        totals: {
          runs: 2,
          dispatches: 2
        }
      });
      expect(campaignPayload.campaign.items.every((entry: {
        run: { competitor: string; competitorType: string };
        dispatch: { provider: string; command: string };
        links: { playbookUrl: string; traceUrl: string; submissionUrl: string };
      }) =>
        entry.run.competitor === "agent:codex-agent-profile" &&
        entry.run.competitorType === "agent" &&
        entry.dispatch.provider === "local" &&
        entry.dispatch.command.includes("scripts/runtime-worker.mjs") &&
        entry.links.playbookUrl.includes("/agent-playbook") &&
        entry.links.traceUrl.includes("/agent-trace") &&
        entry.links.submissionUrl.endsWith("/submission")
      )).toBe(true);

      const labAfterCampaignResponse = await fetch(`${baseUrl}/api/agents/${agentPayload.agent.id}/lab`);
      const labAfterCampaignPayload = await labAfterCampaignResponse.json();
      expect(labAfterCampaignPayload.lab.totals.queuedRuns).toBeGreaterThanOrEqual(3);

      const campaignListResponse = await fetch(`${baseUrl}/api/agents/${agentPayload.agent.id}/campaigns`);
      const campaignListPayload = await campaignListResponse.json();
      expect(campaignListResponse.status).toBe(200);
      expect(campaignListPayload.campaigns.some((entry: { campaign: { id: string }; totals: { runs: number; dispatches: number } }) =>
        entry.campaign.id === campaignPayload.campaign.id && entry.totals.runs === 2 && entry.totals.dispatches === 2
      )).toBe(true);

      const campaignDetailResponse = await fetch(`${baseUrl}/api/campaigns/${campaignPayload.campaign.id}`);
      const campaignDetailPayload = await campaignDetailResponse.json();
      expect(campaignDetailResponse.status).toBe(200);
      expect(campaignDetailPayload.campaign).toMatchObject({
        schemaVersion: "steambench.agent-campaign-report.v1",
        campaign: {
          id: campaignPayload.campaign.id
        },
        totals: {
          tasks: 2,
          runs: 2,
          dispatches: 2
        }
      });

      const campaignRunResponse = await fetch(`${baseUrl}/api/campaigns/${campaignPayload.campaign.id}/run-local`, {
        method: "POST"
      });
      const campaignRunPayload = await campaignRunResponse.json();
      expect(campaignRunResponse.status).toBe(200);
      expect(campaignRunPayload.report).toMatchObject({
        schemaVersion: "steambench.agent-campaign-report.v1",
        status: "scoreboard-ready",
        totals: {
          tasks: 2,
          runs: 2,
          scored: 2,
          dispatches: 2,
          launchedDispatches: 2,
          canonicalArtifacts: 2,
          scoreboardRows: 2
        }
      });
      expect(campaignRunPayload.results.every((entry: { evaluation?: { passed: boolean }; run?: { status: string } }) =>
        entry.evaluation?.passed === true && entry.run?.status === "scored"
      )).toBe(true);
      expect(campaignRunPayload.report.items.every((entry: { dispatch?: { status: string }; scoreboardRow?: { runId: string } }) =>
        entry.dispatch?.status === "completed" && Boolean(entry.scoreboardRow?.runId)
      )).toBe(true);
      expect(campaignRunPayload.bundle).toMatchObject({
        schemaVersion: "steambench.agent-campaign-evidence-bundle.v1",
        campaignId: campaignPayload.campaign.id,
        standingsEntry: {
          campaignId: campaignPayload.campaign.id
        },
        integrity: {
          verdict: "scoreboard-ready",
          campaignScoreboardReady: true,
          allCampaignRunsPresent: true,
          allRunBundlesPresent: true,
          allRunBundlesScoreboardReady: true,
          allDispatchesCompleted: true,
          standingsPublished: true,
          runCount: 2,
          dispatchCount: 2,
          scoreboardRows: 2
        }
      });
      expect(campaignRunPayload.bundle.runBundles.every((entry: { bundle?: { schemaVersion: string; integrity: { verdict: string } } }) =>
        entry.bundle?.schemaVersion === "steambench.evidence-bundle.v1" &&
        entry.bundle.integrity.verdict === "scoreboard-ready"
      )).toBe(true);
      expect(campaignRunPayload.bundle.integrity.checklist.every((entry: { status: string }) => entry.status === "pass")).toBe(true);

      const campaignBundleResponse = await fetch(`${baseUrl}/api/campaigns/${campaignPayload.campaign.id}/evidence-bundle`);
      const campaignBundlePayload = await campaignBundleResponse.json();
      expect(campaignBundleResponse.status).toBe(200);
      expect(campaignBundlePayload.bundle).toMatchObject({
        schemaVersion: "steambench.agent-campaign-evidence-bundle.v1",
        campaignId: campaignPayload.campaign.id,
        integrity: {
          allRunBundlesScoreboardReady: true,
          allDispatchesCompleted: true,
          standingsPublished: true
        }
      });

      const campaignCertificateResponse = await fetch(`${baseUrl}/api/campaigns/${campaignPayload.campaign.id}/result-certificate`);
      const campaignCertificatePayload = await campaignCertificateResponse.json();
      expect(campaignCertificateResponse.status).toBe(200);
      expect(campaignCertificatePayload.certificate).toMatchObject({
        schemaVersion: "steambench.result-certificate.v1",
        kind: "agent-campaign",
        id: campaignPayload.campaign.id,
        status: "scoreboard-ready",
        verdict: "scoreboard-ready",
        result: {
          scoreboardRows: 2
        },
        evidence: {
          bundleReady: true
        },
        integrity: {
          readyForPublicShare: true
        }
      });
      expect(campaignCertificatePayload.certificate.participants[0]).toMatchObject({
        side: "agent",
        id: agentPayload.agent.id,
        score: campaignRunPayload.report.totals.totalScore
      });
      expect(campaignCertificatePayload.certificate.links.evidenceBundle).toBe(`${baseUrl}/api/campaigns/${campaignPayload.campaign.id}/evidence-bundle`);
      expect(campaignCertificatePayload.certificate.links.standings).toBe(`${baseUrl}/api/campaign-standings`);

      const campaignStandingsResponse = await fetch(`${baseUrl}/api/campaign-standings`);
      const campaignStandingsPayload = await campaignStandingsResponse.json();
      expect(campaignStandingsResponse.status).toBe(200);
      expect(campaignStandingsPayload.standings).toMatchObject({
        schemaVersion: "steambench.agent-campaign-standings.v1",
        totals: {
          campaigns: 1,
          scoreboardReadyCampaigns: 1,
          scoredRuns: 2,
          scoreboardRows: 2
        }
      });
      expect(campaignStandingsPayload.standings.leaderboard[0]).toMatchObject({
        rank: 1,
        campaignId: campaignPayload.campaign.id,
        agentId: agentPayload.agent.id,
        status: "scoreboard-ready",
        taskCount: 2,
        scoreboardRows: 2,
        completionRate: 100
      });
      expect(campaignStandingsPayload.standings.competitors[0]).toMatchObject({
        rank: 1,
        agentId: agentPayload.agent.id,
        campaigns: 1,
        scoreboardReadyCampaigns: 1
      });

      const stateAfterCampaignResponse = await fetch(`${baseUrl}/api/state`);
      const stateAfterCampaignPayload = await stateAfterCampaignResponse.json();
      expect(stateAfterCampaignPayload.agentCampaigns.some((entry: { campaign: { id: string }; schemaVersion: string; status: string }) =>
        entry.campaign.id === campaignPayload.campaign.id &&
        entry.schemaVersion === "steambench.agent-campaign-report.v1" &&
        entry.status === "scoreboard-ready"
      )).toBe(true);
      expect(stateAfterCampaignPayload.agentCampaignStandings.leaderboard.some((entry: { campaignId: string; rank: number }) =>
        entry.campaignId === campaignPayload.campaign.id && entry.rank === 1
      )).toBe(true);

      const human = await store.createUser({
        handle: "comparison-human",
        displayName: "Comparison Human",
        type: "human"
      });
      await store.linkSteamToUser(human.id, "76561198000000000", { proofConsent: true });
      const firstCampaignTaskId = campaignPayload.campaign.items[0].task.id;
      const humanCampaignPlanResponse = await fetch(`${baseUrl}/api/users/${human.id}/human-campaign-plan?campaignId=${campaignPayload.campaign.id}`);
      const humanCampaignPlanPayload = await humanCampaignPlanResponse.json();
      expect(humanCampaignPlanResponse.status).toBe(200);
      expect(humanCampaignPlanPayload.plan).toMatchObject({
        schemaVersion: "steambench.human-campaign-plan.v1",
        user: {
          id: human.id
        },
        status: "ready",
        source: {
          type: "agent-campaign",
          campaignId: campaignPayload.campaign.id,
          agentId: agentPayload.agent.id
        },
        totals: {
          tasks: 2,
          ready: 2,
          alreadyScored: 0,
          blocked: 0,
          agentScore: campaignRunPayload.report.totals.totalScore,
          humanScore: 0
        },
        links: {
          submitNext: `/api/users/${human.id}/steam-proof-submissions`,
          comparisonResultCertificate: `/api/comparisons/human-agent/result-certificate?humanUserId=${human.id}&campaignId=${campaignPayload.campaign.id}`
        }
      });
      expect(humanCampaignPlanPayload.plan.items.every((entry: { agentRunId?: string; agentScore?: number }) =>
        Boolean(entry.agentRunId) && typeof entry.agentScore === "number"
      )).toBe(true);

      const humanSubmissionResponse = await fetch(`${baseUrl}/api/users/${human.id}/steam-proof-submissions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: firstCampaignTaskId
        })
      });
      const humanSubmissionPayload = await humanSubmissionResponse.json();
      expect(humanSubmissionResponse.status).toBe(201);
      expect(humanSubmissionPayload.submission.scoreboardReady).toBe(true);

      const humanCampaignPlanAfterSubmissionResponse = await fetch(`${baseUrl}/api/users/${human.id}/human-campaign-plan?campaignId=${campaignPayload.campaign.id}`);
      const humanCampaignPlanAfterSubmissionPayload = await humanCampaignPlanAfterSubmissionResponse.json();
      expect(humanCampaignPlanAfterSubmissionPayload.plan).toMatchObject({
        schemaVersion: "steambench.human-campaign-plan.v1",
        status: "ready",
        totals: {
          tasks: 2,
          alreadyScored: 1,
          completionRate: 50
        }
      });

      const comparisonResponse = await fetch(`${baseUrl}/api/comparisons/human-agent?humanUserId=${human.id}&campaignId=${campaignPayload.campaign.id}`);
      const comparisonPayload = await comparisonResponse.json();
      expect(comparisonResponse.status).toBe(200);
      expect(comparisonPayload.comparison).toMatchObject({
        schemaVersion: "steambench.human-agent-comparison.v1",
        human: {
          id: human.id
        },
        campaign: {
          id: campaignPayload.campaign.id
        },
        totals: {
          tasks: 2,
          completeTasks: 1,
          humanMissing: 1,
          agentMissing: 0
        },
        status: "human-incomplete"
      });
      expect(comparisonPayload.comparison.items.some((entry: { task: { id: string }; status: string; humanRow?: { runId: string }; agentRow?: { runId: string } }) =>
        entry.task.id === firstCampaignTaskId &&
        entry.status === "complete" &&
        Boolean(entry.humanRow?.runId) &&
        Boolean(entry.agentRow?.runId)
      )).toBe(true);

      const comparisonBundleResponse = await fetch(`${baseUrl}/api/comparisons/human-agent/evidence-bundle?humanUserId=${human.id}&campaignId=${campaignPayload.campaign.id}`);
      const comparisonBundlePayload = await comparisonBundleResponse.json();
      expect(comparisonBundleResponse.status).toBe(200);
      expect(comparisonBundlePayload.bundle).toMatchObject({
        schemaVersion: "steambench.human-agent-comparison-evidence-bundle.v1",
        humanUserId: human.id,
        campaignId: campaignPayload.campaign.id,
        agentId: agentPayload.agent.id,
        comparison: {
          schemaVersion: "steambench.human-agent-comparison.v1",
          status: "human-incomplete"
        },
        campaignBundle: {
          schemaVersion: "steambench.agent-campaign-evidence-bundle.v1",
          campaignId: campaignPayload.campaign.id
        },
        integrity: {
          verdict: "human-incomplete",
          comparisonComplete: false,
          campaignBundleReady: true,
          allCompleteTasksHaveHumanBundle: true,
          allCompleteTasksHaveAgentBundle: true,
          taskCount: 2,
          completeTasks: 1,
          humanMissing: 1,
          agentMissing: 0,
          scoreboardRows: 3
        }
      });
      expect(comparisonBundlePayload.bundle.runBundles.some((entry: { taskId: string; humanBundle?: { schemaVersion: string }; agentBundle?: { schemaVersion: string } }) =>
        entry.taskId === firstCampaignTaskId &&
        entry.humanBundle?.schemaVersion === "steambench.evidence-bundle.v1" &&
        entry.agentBundle?.schemaVersion === "steambench.evidence-bundle.v1"
      )).toBe(true);

      const comparisonCertificateResponse = await fetch(`${baseUrl}/api/comparisons/human-agent/result-certificate?humanUserId=${human.id}&campaignId=${campaignPayload.campaign.id}`);
      const comparisonCertificatePayload = await comparisonCertificateResponse.json();
      expect(comparisonCertificateResponse.status).toBe(200);
      expect(comparisonCertificatePayload.certificate).toMatchObject({
        schemaVersion: "steambench.result-certificate.v1",
        kind: "human-agent-comparison",
        id: `${human.id}:${campaignPayload.campaign.id}`,
        status: "human-incomplete",
        verdict: "match-incomplete",
        result: {
          humanScore: comparisonPayload.comparison.totals.humanScore,
          agentScore: comparisonPayload.comparison.totals.agentScore,
          scoreboardRows: 3
        },
        evidence: {
          bundleReady: false
        },
        integrity: {
          readyForPublicShare: false
        },
        verification: {
          method: "sha256",
          signedFields: expect.arrayContaining(["kind", "id", "participants", "tasks", "result", "evidence", "links", "integrity"])
        }
      });
      expect(comparisonCertificatePayload.certificate.verification.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(comparisonCertificatePayload.certificate.links.evidenceBundle).toBe(`${baseUrl}/api/comparisons/human-agent/evidence-bundle?humanUserId=${human.id}&campaignId=${campaignPayload.campaign.id}`);

      const humanCampaignRunResponse = await fetch(`${baseUrl}/api/users/${human.id}/human-campaigns/run-local`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          campaignId: campaignPayload.campaign.id
        })
      });
      const humanCampaignRunPayload = await humanCampaignRunResponse.json();
      expect(humanCampaignRunResponse.status).toBe(200);
      expect(humanCampaignRunPayload).toMatchObject({
        schemaVersion: "steambench.human-campaign-run.v1",
        userId: human.id,
        campaignId: campaignPayload.campaign.id,
        planBefore: {
          schemaVersion: "steambench.human-campaign-plan.v1",
          totals: {
            alreadyScored: 1,
            ready: 1
          }
        },
        planAfter: {
          schemaVersion: "steambench.human-campaign-plan.v1",
          status: "complete",
          totals: {
            tasks: 2,
            alreadyScored: 2,
            ready: 0,
            completionRate: 100
          }
        },
        comparison: {
          schemaVersion: "steambench.human-agent-comparison.v1",
          status: "complete",
          totals: {
            tasks: 2,
            completeTasks: 2,
            humanMissing: 0,
            agentMissing: 0
          }
        },
        bundle: {
          schemaVersion: "steambench.human-agent-comparison-evidence-bundle.v1",
          integrity: {
            verdict: "complete",
            comparisonComplete: true,
            allCompleteTasksHaveHumanBundle: true,
            allCompleteTasksHaveAgentBundle: true,
            scoreboardRows: 4
          }
        },
        certificate: {
          schemaVersion: "steambench.result-certificate.v1",
          kind: "human-agent-comparison",
          status: "complete",
          verdict: "scoreboard-ready",
          evidence: {
            bundleReady: true
          },
          integrity: {
            readyForPublicShare: true
          },
          verification: {
            method: "sha256"
          }
        }
      });
      expect(humanCampaignRunPayload.certificate.verification.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(humanCampaignRunPayload.submissions).toHaveLength(1);
      expect(humanCampaignRunPayload.submissions[0]).toMatchObject({
        scoreboardReady: true,
        bundle: {
          schemaVersion: "steambench.evidence-bundle.v1"
        },
        certificate: {
          schemaVersion: "steambench.result-certificate.v1"
        }
      });

      await fetch(`${baseUrl}/api/competition-events/weekly/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participantType: "human",
          participantId: human.id
        })
      });
      await fetch(`${baseUrl}/api/competition-events/weekly/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participantType: "agent",
          participantId: agentPayload.agent.id
        })
      });
      const eventComparisonBundleResponse = await fetch(`${baseUrl}/api/competition-events/weekly/evidence-bundle`);
      const eventComparisonBundlePayload = await eventComparisonBundleResponse.json();
      expect(eventComparisonBundleResponse.status).toBe(200);
      expect(eventComparisonBundlePayload.bundle).toMatchObject({
        schemaVersion: "steambench.competition-event-evidence-bundle.v1",
        scope: "weekly",
        integrity: {
          registeredPairs: 1,
          campaignComparisonCount: 1,
          campaignComparisonReadyCount: 1,
          allCampaignComparisonsBundled: true,
          allCampaignComparisonsReady: true
        }
      });
      expect(eventComparisonBundlePayload.bundle.campaignComparisons[0]).toMatchObject({
        humanUserId: human.id,
        agentId: agentPayload.agent.id,
        campaignId: campaignPayload.campaign.id,
        bundle: {
          schemaVersion: "steambench.human-agent-comparison-evidence-bundle.v1",
          integrity: {
            comparisonComplete: true
          }
        }
      });

      const eventCampaignRunResponse = await fetch(`${baseUrl}/api/competition-events/weekly/run-campaign-comparisons-local`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          maxPairs: 2
        })
      });
      const eventCampaignRunPayload = await eventCampaignRunResponse.json();
      expect(eventCampaignRunResponse.status).toBe(200);
      expect(eventCampaignRunPayload.run).toMatchObject({
        schemaVersion: "steambench.event-campaign-comparison-run.v1",
        scope: "weekly",
        registeredHumans: 1,
        registeredAgents: 1,
        candidatePairs: 1,
        missingCampaigns: []
      });
      expect(eventCampaignRunPayload.run.executed).toHaveLength(1);
      expect(eventCampaignRunPayload.run.executed[0]).toMatchObject({
        humanUserId: human.id,
        agentId: agentPayload.agent.id,
        campaignId: campaignPayload.campaign.id,
        certificate: {
          kind: "human-agent-comparison",
          verdict: "scoreboard-ready",
          integrity: {
            readyForPublicShare: true
          }
        }
      });
      expect(eventCampaignRunPayload.run.bundle).toMatchObject({
        schemaVersion: "steambench.competition-event-evidence-bundle.v1",
        integrity: {
          campaignComparisonReadyCount: 1
        }
      });
      expect(eventCampaignRunPayload.run.certificate).toMatchObject({
        kind: "competition-event",
        verdict: "scoreboard-ready",
        integrity: {
          readyForPublicShare: true
        }
      });

      const completeComparisonCertificateResponse = await fetch(`${baseUrl}/api/comparisons/human-agent/result-certificate?humanUserId=${human.id}&campaignId=${campaignPayload.campaign.id}`);
      const completeComparisonCertificatePayload = await completeComparisonCertificateResponse.json();
      const completeComparisonCertificateAgainResponse = await fetch(`${baseUrl}/api/comparisons/human-agent/result-certificate?humanUserId=${human.id}&campaignId=${campaignPayload.campaign.id}`);
      const completeComparisonCertificateAgainPayload = await completeComparisonCertificateAgainResponse.json();
      expect(completeComparisonCertificateResponse.status).toBe(200);
      expect(completeComparisonCertificateAgainResponse.status).toBe(200);
      expect(completeComparisonCertificatePayload.certificate.verification).toMatchObject({
        method: "sha256",
        signedFields: expect.arrayContaining(["kind", "id", "participants", "tasks", "result", "evidence", "links", "integrity"])
      });
      expect(completeComparisonCertificatePayload.certificate.verification.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(completeComparisonCertificateAgainPayload.certificate.verification.fingerprint).toBe(completeComparisonCertificatePayload.certificate.verification.fingerprint);

      const certificateVerificationResponse = await fetch(`${baseUrl}/api/result-certificates/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ certificate: completeComparisonCertificatePayload.certificate })
      });
      const certificateVerificationPayload = await certificateVerificationResponse.json();
      expect(certificateVerificationResponse.status).toBe(200);
      expect(certificateVerificationPayload.verification).toMatchObject({
        schemaVersion: "steambench.result-certificate-verification.v1",
        valid: true,
        method: "sha256",
        expectedFingerprint: completeComparisonCertificatePayload.certificate.verification.fingerprint,
        actualFingerprint: completeComparisonCertificatePayload.certificate.verification.fingerprint,
        errors: [],
        certificate: {
          kind: "human-agent-comparison",
          id: `${human.id}:${campaignPayload.campaign.id}`,
          readyForPublicShare: true
        }
      });

      const certificateIndexResponse = await fetch(`${baseUrl}/api/result-certificates?kind=human-agent-comparison&limit=10`);
      const certificateIndexPayload = await certificateIndexResponse.json();
      expect(certificateIndexResponse.status).toBe(200);
      expect(certificateIndexPayload.index).toMatchObject({
        schemaVersion: "steambench.result-certificate-index.v1",
        requested: {
          kind: "human-agent-comparison",
          limit: 10,
          readyForPublicShare: true
        },
        totals: {
          readyForPublicShare: 1,
          humanAgentComparisons: 1
        },
        links: {
          verify: `${baseUrl}/api/result-certificates/verify`
        }
      });
      expect(certificateIndexPayload.index.certificates).toContainEqual(expect.objectContaining({
        kind: "human-agent-comparison",
        id: `${human.id}:${campaignPayload.campaign.id}`,
        status: "complete",
        verdict: "scoreboard-ready",
        readyForPublicShare: true,
        canonicalArtifactName: "output.mp4",
        fingerprint: completeComparisonCertificatePayload.certificate.verification.fingerprint,
        verificationMethod: "sha256",
        links: expect.objectContaining({
          resultCertificate: `${baseUrl}/api/comparisons/human-agent/result-certificate?humanUserId=${human.id}&campaignId=${campaignPayload.campaign.id}`,
          evidenceBundle: `${baseUrl}/api/comparisons/human-agent/evidence-bundle?humanUserId=${human.id}&campaignId=${campaignPayload.campaign.id}`
        })
      }));

      const publicSnapshotResponse = await fetch(`${baseUrl}/api/public/benchmark-snapshot?season=weekly&limit=20`);
      const publicSnapshotPayload = await publicSnapshotResponse.json();
      expect(publicSnapshotResponse.status).toBe(200);
      expect(publicSnapshotPayload.snapshot).toMatchObject({
        schemaVersion: "steambench.public-benchmark-snapshot.v1",
        scope: "weekly",
        canonicalArtifactName: "output.mp4",
        publicDataPolicy: {
          proofConsentRequiredBeforePublicRanking: true,
          officialSteamSourcesOnly: true
        },
        totals: {
          proofConsentedHumans: 1,
          activeAgents: 1,
          shareReadyCertificates: expect.any(Number)
        },
        season: {
          window: {
            scope: "weekly"
          },
          totals: expect.objectContaining({
            humanRuns: expect.any(Number),
            agentRuns: expect.any(Number)
          })
        },
        certificates: {
          totals: expect.objectContaining({
            readyForPublicShare: expect.any(Number),
            humanAgentComparisons: 1
          }),
          links: {
            verify: `${baseUrl}/api/result-certificates/verify`
          }
        },
        links: {
          standings: `${baseUrl}/api/standings?season=weekly`,
          certificateIndex: `${baseUrl}/api/result-certificates?kind=all&limit=20`,
          certificateVerify: `${baseUrl}/api/result-certificates/verify`
        }
      });
      expect(publicSnapshotPayload.snapshot.events).toContainEqual(expect.objectContaining({
        scope: "weekly",
        links: {
          detail: `${baseUrl}/api/competition-events/weekly`,
          evidenceBundle: `${baseUrl}/api/competition-events/weekly/evidence-bundle`,
          resultCertificate: `${baseUrl}/api/competition-events/weekly/result-certificate`
        }
      }));
      expect(publicSnapshotPayload.snapshot.certificates.certificates).toContainEqual(expect.objectContaining({
        kind: "human-agent-comparison",
        readyForPublicShare: true,
        canonicalArtifactName: "output.mp4"
      }));

      const invalidPublicSnapshotResponse = await fetch(`${baseUrl}/api/public/benchmark-snapshot?season=quarterly`);
      expect(invalidPublicSnapshotResponse.status).toBe(400);

      const tamperedCertificate = {
        ...completeComparisonCertificatePayload.certificate,
        result: {
          ...completeComparisonCertificatePayload.certificate.result,
          humanScore: completeComparisonCertificatePayload.certificate.result.humanScore + 1
        }
      };
      const tamperedVerificationResponse = await fetch(`${baseUrl}/api/result-certificates/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ certificate: tamperedCertificate })
      });
      const tamperedVerificationPayload = await tamperedVerificationResponse.json();
      expect(tamperedVerificationResponse.status).toBe(422);
      expect(tamperedVerificationPayload.verification).toMatchObject({
        schemaVersion: "steambench.result-certificate-verification.v1",
        valid: false,
        method: "sha256"
      });
      expect(tamperedVerificationPayload.verification.errors).toContain("fingerprint_mismatch");
      expect(tamperedVerificationPayload.verification.actualFingerprint).not.toBe(tamperedVerificationPayload.verification.expectedFingerprint);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks agent queueing when the runtime profile lacks task capabilities", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-agent-readiness-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const task = buildFixtureTasks().find((entry) => entry.track === "capture");
      expect(task).toBeDefined();

      const agentResponse = await fetch(`${baseUrl}/api/agents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: "underpowered-agent",
          displayName: "Underpowered Agent",
          provider: "local",
          command: "node scripts/runtime-worker.mjs --agent=underpowered-agent",
          capabilities: ["keyboard-mouse", "screen-capture"]
        })
      });
      const agentPayload = await agentResponse.json();
      expect(agentResponse.status).toBe(201);

      const runResponse = await fetch(`${baseUrl}/api/agents/${agentPayload.agent.id}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task!.id
        })
      });
      const runPayload = await runResponse.json();
      expect(runResponse.status).toBe(409);
      expect(runPayload).toMatchObject({
        error: "agent_not_ready_for_task",
        readiness: {
          ready: false,
          taskId: task!.id
        }
      });
      expect(runPayload.readiness.missingCapabilities).toContain("output.mp4");
      expect(runPayload.readiness.missingCapabilities).toContain("seeded-save");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("requires explicit Steam proof consent before public human runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-proof-consent-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const task = buildFixtureTasks()[0];

      const userResponse = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: "consent-human",
          type: "human"
        })
      });
      const userPayload = await userResponse.json();

      const linkResponse = await fetch(`${baseUrl}/api/users/${userPayload.user.id}/steam`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          steamid: "76561198000000000"
        })
      });
      expect(linkResponse.status).toBe(200);

      const blockedRunResponse = await fetch(`${baseUrl}/api/users/${userPayload.user.id}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task.id
        })
      });
      expect(blockedRunResponse.status).toBe(403);
      expect(await blockedRunResponse.json()).toMatchObject({
        error: "steam_proof_consent_required"
      });

      const consentResponse = await fetch(`${baseUrl}/api/users/${userPayload.user.id}/steam-proof-consent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consented: true
        })
      });
      const consentPayload = await consentResponse.json();
      expect(consentResponse.status).toBe(200);
      expect(consentPayload.user.proofConsentAt).toEqual(expect.any(String));

      const runResponse = await fetch(`${baseUrl}/api/users/${userPayload.user.id}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task.id
        })
      });
      expect(runResponse.status).toBe(201);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("runs a head-to-head human versus agent benchmark match", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-match-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const task = buildFixtureTasks()[0];

      const human = await store.createUser({
        handle: "match-human",
        displayName: "Match Human",
        type: "human"
      });
      await store.linkSteamToUser(human.id, "76561198000000000", { proofConsent: true });
      const agent = await store.createAgentProfile({
        handle: "match-agent",
        displayName: "Match Agent"
      });

      const matchResponse = await fetch(`${baseUrl}/api/matches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          humanUserId: human.id,
          agentId: agent.id
        })
      });
      const matchPayload = await matchResponse.json();
      expect(matchResponse.status).toBe(201);
      expect(matchPayload.match.status).toBe("scheduled");
      expect(matchPayload.eligibility).toMatchObject({
        status: "ready",
        ready: true,
        proofRequirements: ["steam-achievement", "canonical-artifact"]
      });

      const startResponse = await fetch(`${baseUrl}/api/matches/${matchPayload.match.id}/start`, {
        method: "POST"
      });
      const startPayload = await startResponse.json();
      expect(startResponse.status).toBe(200);
      expect(startPayload.match.status).toBe("running");
      expect(startPayload.humanRun.competitor).toBe("human:match-human");
      expect(startPayload.agentRun.competitor).toBe("agent:match-agent");

      await fetch(`${baseUrl}/api/runs/${startPayload.humanRun.id}/artifact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifactPath: "output/output.mp4" })
      });
      const humanProofResponse = await fetch(`${baseUrl}/api/runs/${startPayload.humanRun.id}/verify-steam-proof`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: human.id,
          allowMock: true
        })
      });
      expect(humanProofResponse.status).toBe(200);

      const agentSimResponse = await fetch(`${baseUrl}/api/runs/${startPayload.agentRun.id}/simulate-agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      expect(agentSimResponse.status).toBe(200);

      const evaluateResponse = await fetch(`${baseUrl}/api/matches/${matchPayload.match.id}/evaluate`, {
        method: "POST"
      });
      const evaluatePayload = await evaluateResponse.json();
      expect(evaluateResponse.status).toBe(200);
      expect(evaluatePayload.match.status).toBe("scored");
      expect(evaluatePayload.match.winner).toBe("tie");
      expect(evaluatePayload.match.margin).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preflights match eligibility and requires approval for controlled tasks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-match-preflight-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const task = buildFixtureTasks().find((entry) => entry.id === "646570:LDRB.SEED_A20_SCORE")!;

      const human = await store.createUser({
        handle: "preflight-human",
        type: "human"
      });
      await store.linkSteamToUser(human.id, "76561198000000000", { proofConsent: true });
      const agent = await store.createAgentProfile({
        handle: "preflight-agent"
      });

      const eligibilityResponse = await fetch(
        `${baseUrl}/api/tasks/${encodeURIComponent(task.id)}/eligibility?humanUserId=${human.id}&agentId=${agent.id}`
      );
      const eligibilityPayload = await eligibilityResponse.json();
      expect(eligibilityResponse.status).toBe(200);
      expect(eligibilityPayload.eligibility).toMatchObject({
        taskId: task.id,
        status: "controlled",
        proofRequirements: ["manual-review", "canonical-artifact"]
      });
      expect(eligibilityPayload.eligibility.controls.join(" ")).toContain("Snapshot leaderboard rules");

      const preflightResponse = await fetch(`${baseUrl}/api/matches/preflight`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          humanUserId: human.id,
          agentId: agent.id
        })
      });
      const preflightPayload = await preflightResponse.json();
      expect(preflightResponse.status).toBe(200);
      expect(preflightPayload.eligibility.status).toBe("controlled");

      const blockedMatchResponse = await fetch(`${baseUrl}/api/matches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          humanUserId: human.id,
          agentId: agent.id
        })
      });
      const blockedMatchPayload = await blockedMatchResponse.json();
      expect(blockedMatchResponse.status).toBe(409);
      expect(blockedMatchPayload).toMatchObject({
        error: "match_review_required",
        eligibility: {
          status: "controlled"
        }
      });

      const approvedMatchResponse = await fetch(`${baseUrl}/api/matches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          humanUserId: human.id,
          agentId: agent.id,
          reviewApproved: true
        })
      });
      const approvedMatchPayload = await approvedMatchResponse.json();
      expect(approvedMatchResponse.status).toBe(201);
      expect(approvedMatchPayload.match.status).toBe("scheduled");
      expect(approvedMatchPayload.eligibility.status).toBe("controlled");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("orchestrates and scores a local arena match in one API call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-local-match-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const task = buildFixtureTasks().find((entry) => entry.track === "capture");
      expect(task).toBeDefined();

      const human = await store.createUser({
        handle: "local-match-human",
        displayName: "Local Match Human",
        type: "human"
      });
      await store.linkSteamToUser(human.id, "76561198000000000", { proofConsent: true });
      const agent = await store.createAgentProfile({
        handle: "local-match-agent",
        displayName: "Local Match Agent"
      });

      const matchResponse = await fetch(`${baseUrl}/api/matches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task!.id,
          humanUserId: human.id,
          agentId: agent.id
        })
      });
      const matchPayload = await matchResponse.json();
      expect(matchPayload.arenaPacket).toMatchObject({
        schemaVersion: "steambench.match-arena-packet.v1",
        matchId: matchPayload.match.id,
        taskId: task!.id,
        status: "scheduled",
        readyForStart: true,
        readyForEvaluation: false,
        readyForPublicShare: false,
        human: {
          userId: human.id,
          status: "not-started",
          entryPacket: {
            schemaVersion: "steambench.human-benchmark-entry-packet.v1",
            endpoint: `/api/users/${human.id}/steam-proof-plan`,
            canonicalArtifact: "output/output.mp4"
          }
        },
        agent: {
          agentId: agent.id,
          status: "not-started",
          actionSpace: {
            schemaVersion: "steambench.runtime-action-space.v1"
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
          match: `/api/matches/${matchPayload.match.id}`,
          start: `/api/matches/${matchPayload.match.id}/start`,
          runLocal: `/api/matches/${matchPayload.match.id}/run-local`,
          evaluate: `/api/matches/${matchPayload.match.id}/evaluate`,
          resultCertificate: `/api/matches/${matchPayload.match.id}/result-certificate`,
          humanSubmission: `/api/users/${human.id}/steam-proof-submissions`
        }
      });
      expect(matchPayload.arenaPacket.nextActions.map((action: { id: string }) => action.id)).toEqual([
        "start-match",
        "submit-human-proof",
        "submit-agent-actions"
      ]);
      const arenaOpsBeforeResponse = await fetch(`${baseUrl}/api/matches/arena-ops-report?status=needs-start&limit=10`);
      const arenaOpsBeforePayload = await arenaOpsBeforeResponse.json();
      expect(arenaOpsBeforeResponse.status).toBe(200);
      expect(arenaOpsBeforePayload.report).toMatchObject({
        schemaVersion: "steambench.match-arena-ops-report.v1",
        status: "needs-execution",
        filters: {
          status: "needs-start",
          limit: 10
        },
        totals: {
          selectedTickets: 1,
          needsStart: 1
        }
      });
      expect(arenaOpsBeforePayload.report.tickets[0]).toMatchObject({
        status: "needs-start",
        blockers: expect.arrayContaining(["match_not_started"]),
        arenaPacket: {
          schemaVersion: "steambench.match-arena-packet.v1",
          readyForStart: true
        },
        links: {
          arenaPacket: `/api/matches/${matchPayload.match.id}/arena-packet`,
          runLocal: `/api/matches/${matchPayload.match.id}/run-local`
        }
      });
      expect(arenaOpsBeforePayload.report.recommendedActions.map((action: { id: string }) => action.id)).toContain("run-match-local");

      const runResponse = await fetch(`${baseUrl}/api/matches/${matchPayload.match.id}/run-local`, {
        method: "POST"
      });
      const runPayload = await runResponse.json();

      expect(runResponse.status).toBe(200);
      expect(runPayload.match.status).toBe("scored");
      expect(["human", "agent", "tie"]).toContain(runPayload.match.winner);
      expect(runPayload.humanRun.status).toBe("scored");
      expect(runPayload.agentRun.status).toBe("scored");
      expect(runPayload.human.detail.proofs.some((proof: { type: string; status: string }) => proof.type === "manual-review" && proof.status === "verified")).toBe(true);
      expect(runPayload.agent.detail.streams.some((stream: { status: string }) => stream.status === "ended")).toBe(true);
      expect(runPayload.arenaPacket).toMatchObject({
        schemaVersion: "steambench.match-arena-packet.v1",
        matchId: matchPayload.match.id,
        status: "scored",
        readyForEvaluation: true,
        readyForPublicShare: true,
        human: {
          runId: runPayload.humanRun.id,
          status: "scored"
        },
        agent: {
          runId: runPayload.agentRun.id,
          status: "scored"
        },
        endpoints: {
          humanRun: `/api/runs/${runPayload.humanRun.id}`,
          humanEvidenceBundle: `/api/runs/${runPayload.humanRun.id}/evidence-bundle`,
          humanResultCertificate: `/api/runs/${runPayload.humanRun.id}/result-certificate`,
          agentRun: `/api/runs/${runPayload.agentRun.id}`,
          agentHandoff: `/api/runs/${runPayload.agentRun.id}/agent-handoff?agentId=${agent.id}`,
          agentPlaybook: `/api/runs/${runPayload.agentRun.id}/agent-playbook?agentId=${agent.id}`,
          agentActionBatch: `/api/runs/${runPayload.agentRun.id}/action-batches`,
          agentTrace: `/api/runs/${runPayload.agentRun.id}/agent-trace`,
          agentTraceAudit: `/api/runs/${runPayload.agentRun.id}/agent-trace/audit`,
          agentSubmission: `/api/runs/${runPayload.agentRun.id}/submission`
        }
      });
      expect(runPayload.arenaPacket.nextActions.map((action: { id: string }) => action.id)).toEqual(["share-certificate"]);

      const arenaPacketResponse = await fetch(`${baseUrl}/api/matches/${matchPayload.match.id}/arena-packet`);
      const arenaPacketPayload = await arenaPacketResponse.json();
      expect(arenaPacketResponse.status).toBe(200);
      expect(arenaPacketPayload.arenaPacket).toMatchObject({
        schemaVersion: "steambench.match-arena-packet.v1",
        matchId: matchPayload.match.id,
        readyForPublicShare: true
      });
      const arenaOpsAfterResponse = await fetch(`${baseUrl}/api/matches/arena-ops-report?status=scoreboard-ready&limit=10`);
      const arenaOpsAfterPayload = await arenaOpsAfterResponse.json();
      expect(arenaOpsAfterResponse.status).toBe(200);
      expect(arenaOpsAfterPayload.report).toMatchObject({
        schemaVersion: "steambench.match-arena-ops-report.v1",
        status: "ready-to-share",
        totals: {
          selectedTickets: 1,
          scoreboardReady: 1,
          scoreboardRows: 2
        }
      });
      expect(arenaOpsAfterPayload.report.recommendedActions).toContainEqual(expect.objectContaining({
        id: "share-match-certificate",
        endpoint: `/api/matches/${matchPayload.match.id}/result-certificate`
      }));

      const repeatedResponse = await fetch(`${baseUrl}/api/matches/${matchPayload.match.id}/run-local`, {
        method: "POST"
      });
      expect(repeatedResponse.status).toBe(200);
      const snapshot = await store.read();
      const rowsForRuns = snapshot.scoreboard.filter((row) => row.runId === runPayload.humanRun.id || row.runId === runPayload.agentRun.id);
      expect(rowsForRuns).toHaveLength(2);

      const feedResponse = await fetch(`${baseUrl}/api/matches/feed?season=daily`);
      const feedPayload = await feedResponse.json();
      expect(feedResponse.status).toBe(200);
      expect(feedPayload.matchFeed.season.scope).toBe("daily");
      expect(feedPayload.matchFeed.matches[0]).toMatchObject({
        matchId: matchPayload.match.id,
        taskId: task!.id,
        status: "scored",
        human: {
          runId: runPayload.humanRun.id,
          status: "scored"
        },
        agent: {
          runId: runPayload.agentRun.id,
          status: "scored"
        }
      });
      expect(feedPayload.matchFeed.matches[0].human.score).toBeDefined();
      expect(feedPayload.matchFeed.matches[0].agent.score).toBeDefined();

      const certificateResponse = await fetch(`${baseUrl}/api/matches/${matchPayload.match.id}/result-certificate`);
      const certificatePayload = await certificateResponse.json();
      expect(certificateResponse.status).toBe(200);
      expect(certificatePayload.certificate).toMatchObject({
        schemaVersion: "steambench.result-certificate.v1",
        kind: "match",
        id: matchPayload.match.id,
        status: "scored",
        verdict: "scoreboard-ready",
        result: {
          scoreboardRows: 2
        },
        evidence: {
          bundleReady: true
        },
        integrity: {
          readyForPublicShare: true
        }
      });
      expect(certificatePayload.certificate.links.match).toBe(`${baseUrl}/api/matches/${matchPayload.match.id}`);

      const stateResponse = await fetch(`${baseUrl}/api/state`);
      const statePayload = await stateResponse.json();
      expect(statePayload.matchFeeds.map((feed: { season: { scope: string } }) => feed.season.scope)).toEqual([
        "all",
        "daily",
        "weekly"
      ]);
      expect(statePayload.matchFeeds.find((feed: { season: { scope: string } }) => feed.season.scope === "daily").matches).toHaveLength(1);

      const badFeedResponse = await fetch(`${baseUrl}/api/matches/feed?season=monthly`);
      expect(badFeedResponse.status).toBe(400);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("imports Steam achievement candidates, publishes one, and runs it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-import-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const policyResponse = await fetch(`${baseUrl}/api/steam/data-policy`);
      const policyPayload = await policyResponse.json();
      expect(policyResponse.status).toBe(200);
      expect(policyPayload.policy).toMatchObject({
        userData: {
          steamWebApiKeyServerSideOnly: true,
          proofConsentRequiredBeforePublicRanking: true
        },
        cache: {
          entries: []
        }
      });

      const ladderResponse = await fetch(`${baseUrl}/api/steam/apps/620/achievement-ladder?useFixture=true`);
      const ladderPayload = await ladderResponse.json();
      expect(ladderResponse.status).toBe(200);
      expect(ladderPayload).toMatchObject({
        source: "fixture",
        steamMeta: null,
        ladder: {
          schemaVersion: "steambench.steam-achievement-benchmark-ladder.v1",
          appid: 620,
          canonicalArtifactName: "output.mp4",
          links: {
            achievementTasks: "/api/steam/apps/620/achievement-tasks",
            importAchievements: "/api/steam/apps/620/import-achievements",
            coveragePlan: "/api/games/620/coverage-plan"
          }
        }
      });
      expect(ladderPayload.ladder.bands.some((band: { taskCount: number }) => band.taskCount > 0)).toBe(true);
      expect(ladderPayload.ladder.totals.active).toBeGreaterThan(0);
      expect(ladderPayload.ladder.recommendedImports.every((entry: { importStatus: string }) => entry.importStatus !== "active")).toBe(true);
      expect(ladderPayload.ladder.selectionRules.some((entry: string) => entry.includes("output.mp4"))).toBe(true);

      const recommendedImportResponse = await fetch(`${baseUrl}/api/steam/apps/620/achievement-ladder/import-recommended`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          useFixture: true,
          limit: 4,
          reviewNotes: "test recommended import"
        })
      });
      const recommendedImportPayload = await recommendedImportResponse.json();
      expect(recommendedImportResponse.status).toBe(201);
      expect(recommendedImportPayload.importRun).toMatchObject({
        schemaVersion: "steambench.steam-achievement-recommended-import.v1",
        appid: 620,
        source: "fixture",
        totals: {
          imported: 0,
          active: ladderPayload.ladder.totals.active
        },
        links: {
          achievementLadder: "/api/steam/apps/620/achievement-ladder",
          publishCandidates: "/api/steam/apps/620/publish-candidates"
        }
      });
      expect(recommendedImportPayload.importRun.skipped.every((entry: { importStatus: string }) => entry.importStatus === "active")).toBe(true);

      const onboardingResponse = await fetch(`${baseUrl}/api/steam/apps/620/onboarding?useFixture=true`);
      const onboardingPayload = await onboardingResponse.json();
      expect(onboardingResponse.status).toBe(200);
      expect(onboardingPayload.onboarding).toMatchObject({
        schemaVersion: "steambench.steam-app-onboarding.v1",
        appid: 620,
        gameName: "Portal 2",
        links: {
          achievementLadder: "/api/steam/apps/620/achievement-ladder",
          importRecommended: "/api/steam/apps/620/achievement-ladder/import-recommended",
          coveragePlan: "/api/games/620/coverage-plan",
          runOnboardingLocal: "/api/steam/apps/620/onboarding/run-local"
        }
      });
      expect(onboardingPayload.onboarding.stages.map((stage: { id: string }) => stage.id)).toEqual([
        "discovery",
        "achievement-ladder",
        "task-publication",
        "coverage",
        "competition"
      ]);
      expect(onboardingPayload.onboarding.stages.some((stage: { status: string }) => stage.status === "complete")).toBe(true);

      const onboardingAdvanceResponse = await fetch(`${baseUrl}/api/steam/apps/620/onboarding/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          useFixture: true,
          reviewApproved: true,
          reviewNotes: "test onboarding advance"
        })
      });
      const onboardingAdvancePayload = await onboardingAdvanceResponse.json();
      expect(onboardingAdvanceResponse.status).toBe(200);
      expect(onboardingAdvancePayload.advance).toMatchObject({
        schemaVersion: "steambench.steam-app-onboarding-advance.v1",
        appid: 620,
        links: {
          onboarding: "/api/steam/apps/620/onboarding",
          runCoverageLocal: "/api/games/620/coverage-plan/run-local",
          runOnboardingLocal: "/api/steam/apps/620/onboarding/run-local"
        }
      });
      expect(onboardingAdvancePayload.advance.steps.map((step: { id: string }) => step.id)).toEqual([
        "import-recommended",
        "publish-candidates",
        "coverage-plan"
      ]);
      expect(onboardingAdvancePayload.onboarding.schemaVersion).toBe("steambench.steam-app-onboarding.v1");

      const onboardingRunHuman = await store.createUser({
        handle: "onboarding-run-human",
        displayName: "Onboarding Run Human",
        type: "human"
      });
      await store.linkSteamToUser(onboardingRunHuman.id, "76561198000000062", { proofConsent: true });
      const onboardingRunAgent = await store.createAgentProfile({
        handle: "onboarding-run-agent",
        displayName: "Onboarding Run Agent"
      });
      const onboardingRunResponse = await fetch(`${baseUrl}/api/steam/apps/620/onboarding/run-local`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          useFixture: true,
          reviewApproved: true,
          reviewNotes: "test onboarding local run",
          humanUserId: onboardingRunHuman.id,
          agentId: onboardingRunAgent.id,
          limit: 2
        })
      });
      const onboardingRunPayload = await onboardingRunResponse.json();
      expect(onboardingRunResponse.status).toBe(201);
      expect(onboardingRunPayload.run).toMatchObject({
        schemaVersion: "steambench.steam-app-onboarding-local-run.v1",
        appid: 620,
        requestedSide: "both",
        links: {
          onboarding: "/api/steam/apps/620/onboarding",
          coveragePlan: "/api/games/620/coverage-plan",
          standings: "/api/games/620/standings"
        }
      });
      expect(onboardingRunPayload.run.steps.map((step: { id: string }) => step.id)).toEqual([
        "import-recommended",
        "publish-candidates",
        "coverage-local-run"
      ]);
      expect(onboardingRunPayload.coverage).toMatchObject({
        schemaVersion: "steambench.game-coverage-local-run.v1",
        appid: 620,
        selectedHuman: {
          id: onboardingRunHuman.id
        },
        selectedAgent: {
          id: onboardingRunAgent.id
        },
        links: {
          coverageRun: expect.stringContaining("/api/game-coverage-runs/"),
          coverageRuns: "/api/games/620/coverage-runs"
        }
      });
      expect(onboardingRunPayload.coverage.totals.completedRuns).toBeGreaterThan(0);
      expect(onboardingRunPayload.coverage.totals.scoreboardReady).toBe(onboardingRunPayload.coverage.totals.completedRuns);
      expect(onboardingRunPayload.onboarding.schemaVersion).toBe("steambench.steam-app-onboarding.v1");

      const discoverResponse = await fetch(`${baseUrl}/api/steam/apps/discover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "Portal",
          useFixture: true,
          limit: 3
        })
      });
      const discoverPayload = await discoverResponse.json();
      expect(discoverResponse.status).toBe(201);
      expect(discoverPayload).toMatchObject({
        source: "fixture",
        steamMeta: null
      });
      expect(discoverPayload.discoveries.some((entry: { appid: number; status: string }) => entry.appid === 620 && entry.status === "candidate")).toBe(true);
      const discovery = discoverPayload.discoveries.find((entry: { appid: number }) => entry.appid === 620);

      const shortlistResponse = await fetch(`${baseUrl}/api/steam/apps/discovery/${discovery.id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "shortlisted",
          reviewNotes: "ready for import"
        })
      });
      const shortlistPayload = await shortlistResponse.json();
      expect(shortlistResponse.status).toBe(200);
      expect(shortlistPayload.discovery.status).toBe("shortlisted");

      const discoveryImportResponse = await fetch(`${baseUrl}/api/steam/apps/discovery/${discovery.id}/import-achievements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          useFixture: true,
          limit: 2,
          reviewNotes: "test discovery import"
        })
      });
      const discoveryImportPayload = await discoveryImportResponse.json();
      expect(discoveryImportResponse.status).toBe(201);
      expect(discoveryImportPayload.discovery.status).toBe("imported");
      expect(discoveryImportPayload.imported).toHaveLength(2);

      const discoveryBlueprintResponse = await fetch(`${baseUrl}/api/steam/apps/discovery/${discovery.id}/benchmark-blueprint`);
      const discoveryBlueprintPayload = await discoveryBlueprintResponse.json();
      expect(discoveryBlueprintResponse.status).toBe(200);
      expect(discoveryBlueprintPayload.blueprint).toMatchObject({
        schemaVersion: "steambench.benchmark-blueprint.v1",
        appid: 620,
        game: {
          name: "Portal 2"
        },
        runtimePlan: {
          targetArtifactName: "output.mp4"
        },
        importPlan: {
          endpoint: `/api/steam/apps/discovery/${discovery.id}/import-achievements`
        }
      });
      expect(discoveryBlueprintPayload.blueprint.taskLadder.some((band: { recommendedTaskIds: string[] }) => band.recommendedTaskIds.length > 0)).toBe(true);

      const discoveriesResponse = await fetch(`${baseUrl}/api/steam/apps/discovery?status=imported`);
      const discoveriesPayload = await discoveriesResponse.json();
      expect(discoveriesResponse.status).toBe(200);
      expect(discoveriesPayload.discoveries.some((entry: { appid: number }) => entry.appid === 620)).toBe(true);

      const importResponse = await fetch(`${baseUrl}/api/steam/apps/620/import-achievements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          useFixture: true,
          limit: 2,
          reviewNotes: "test import"
        })
      });
      const importPayload = await importResponse.json();
      expect(importResponse.status).toBe(201);
      expect(importPayload.imported).toHaveLength(2);
      expect(importPayload.imported[0].status).toBe("candidate");
      expect(importPayload).toMatchObject({
        source: "fixture",
        steamMeta: null,
        policy: {
          cache: {
            defaultTtlSeconds: expect.any(Number)
          }
        }
      });

      const stateResponse = await fetch(`${baseUrl}/api/state`);
      const statePayload = await stateResponse.json();
      expect(statePayload.steamDataPolicy).toMatchObject({
        rateLimitPosture: expect.stringContaining("TTL cache")
      });
      expect(statePayload.steamAppDiscoveries.some((entry: { appid: number; status: string }) => entry.appid === 620 && entry.status === "imported")).toBe(true);
      expect(statePayload.benchmarkBlueprints.some((entry: { appid: number; schemaVersion: string }) => entry.appid === 620 && entry.schemaVersion === "steambench.benchmark-blueprint.v1")).toBe(true);

      const gameBlueprintResponse = await fetch(`${baseUrl}/api/games/620/benchmark-blueprint`);
      const gameBlueprintPayload = await gameBlueprintResponse.json();
      expect(gameBlueprintResponse.status).toBe(200);
      expect(gameBlueprintPayload.blueprint.competitionPlan.publicEndpoints).toContain("/api/games/620/benchmark-suites");
      expect(gameBlueprintPayload.blueprint.runtimePlan.stage2StartConstraints.some((entry: string) => entry.includes("Do not call session.run_file"))).toBe(true);
      expect(gameBlueprintPayload.blueprint.sourcePlan).toMatchObject({
        achievement: {
          endpoint: "/api/steam/apps/620/achievement-ladder",
          importEndpoint: "/api/steam/apps/620/achievement-ladder/import-recommended"
        },
        stat: {
          endpoint: "/api/steam/apps/620/stat-proposals",
          importEndpoint: "/api/steam/apps/620/stat-proposals/import-recommended"
        },
        leaderboard: {
          endpoint: "/api/steam/apps/620/leaderboard-proposals",
          importEndpoint: "/api/steam/apps/620/leaderboard-proposals/import-recommended"
        }
      });

      const sourceBlueprintResponse = await fetch(`${baseUrl}/api/games/620/benchmark-blueprint?useFixture=true&limit=2`);
      const sourceBlueprintPayload = await sourceBlueprintResponse.json();
      expect(sourceBlueprintResponse.status).toBe(200);
      expect(sourceBlueprintPayload.blueprint.sourcePlan).toMatchObject({
        stat: {
          source: "fixture",
          proposed: 2,
          canImportNow: true
        },
        leaderboard: {
          source: "fixture",
          proposed: 2,
          canImportNow: true
        }
      });
      expect(sourceBlueprintPayload.blueprint.sourcePlan.newImportsAvailable).toBeGreaterThanOrEqual(4);
      expect(sourceBlueprintPayload.blueprint.sourceActions.map((entry: { id: string }) => entry.id)).toEqual(expect.arrayContaining([
        "import-stat-proposals",
        "import-leaderboard-proposals"
      ]));
      expect(sourceBlueprintPayload.blueprint.sourceActions.find((entry: { id: string }) => entry.id === "import-stat-proposals")).toMatchObject({
        method: "POST",
        endpoint: "/api/steam/apps/620/stat-proposals/import-recommended",
        body: {
          useFixture: true,
          limit: 2
        }
      });
      expect(sourceBlueprintPayload.blueprint.sourceActions.find((entry: { id: string }) => entry.id === "import-leaderboard-proposals")).toMatchObject({
        method: "POST",
        endpoint: "/api/steam/apps/620/leaderboard-proposals/import-recommended",
        body: {
          useFixture: true,
          limit: 2
        }
      });

      const proposalResponse = await fetch(`${baseUrl}/api/steam/apps/620/task-proposals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: "CAP.TEST_ROUTE",
          title: "Test Route Proposal",
          track: "capture",
          level: 5,
          targetValue: "120 seconds",
          metricName: "completion_time_seconds",
          objective: "Complete a controlled Portal 2 route within 120 seconds.",
          estimatedRuntimeMinutes: 18,
          scoringRule: "Pass at <= 120 seconds; rank lower verified time higher.",
          reviewNotes: "test proposal"
        })
      });
      const proposalPayload = await proposalResponse.json();
      expect(proposalResponse.status).toBe(201);
      expect(proposalPayload.task).toMatchObject({
        id: "620:CAP.TEST_ROUTE",
        source: "manual",
        track: "capture",
        metricName: "completion_time_seconds",
        status: "candidate"
      });
      expect(proposalPayload.review.decision).toMatch(/ranked-ready|review-required/);
      expect(proposalPayload.blueprint.reviewPlan.rankedReadyTasks + proposalPayload.blueprint.reviewPlan.reviewRequiredTasks).toBeGreaterThan(0);

      const metricProposalResponse = await fetch(`${baseUrl}/api/steam/apps/620/metric-proposals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewNotes: "bulk metric proposal",
          proposals: [
            {
              key: "STAT.TEST_PORTALS",
              title: "Test Portal Count",
              track: "stat",
              level: 4,
              targetValue: "25 portals",
              metricName: "portal_count",
              objective: "Place at least 25 portals during a controlled benchmark segment.",
              estimatedRuntimeMinutes: 12,
              scoringRule: "Pass at >= 25 portals; rank higher verified count higher.",
              signalSource: "steam-stat"
            },
            {
              key: "LDRB.TEST_CHAMBER_SCORE",
              title: "Test Chamber Score",
              track: "leaderboard",
              level: 6,
              targetValue: "highest score",
              metricName: "score",
              objective: "Maximize score on a snapshotted chamber leaderboard ruleset.",
              estimatedRuntimeMinutes: 24,
              scoringRule: "Rank higher verified score higher.",
              signalSource: "steam-leaderboard",
              riskFlags: ["longHorizon"]
            }
          ]
        })
      });
      const metricProposalPayload = await metricProposalResponse.json();
      expect(metricProposalResponse.status).toBe(201);
      expect(metricProposalPayload.proposalRun).toMatchObject({
        schemaVersion: "steambench.steam-metric-proposal-run.v1",
        appid: 620,
        proposed: 2,
        candidates: 2
      });
      expect(metricProposalPayload.proposalRun.tracks.sort()).toEqual(["leaderboard", "stat"]);
      expect(metricProposalPayload.candidates.map((entry: { id: string }) => entry.id)).toEqual([
        "620:STAT.TEST_PORTALS",
        "620:LDRB.TEST_CHAMBER_SCORE"
      ]);
      expect(metricProposalPayload.reviews).toHaveLength(2);
      expect(metricProposalPayload.blueprint.schemaVersion).toBe("steambench.benchmark-blueprint.v1");

      const statProposalResponse = await fetch(`${baseUrl}/api/steam/apps/620/stat-proposals?useFixture=true&limit=2`);
      const statProposalPayload = await statProposalResponse.json();
      expect(statProposalResponse.status).toBe(200);
      expect(statProposalPayload.proposalRun).toMatchObject({
        schemaVersion: "steambench.steam-stat-proposal-run.v1",
        appid: 620,
        source: "fixture",
        requestedLimit: 2,
        proposed: 2
      });
      expect(statProposalPayload.proposalRun.links.importRecommended).toBe("/api/steam/apps/620/stat-proposals/import-recommended");
      expect(statProposalPayload.proposals.map((entry: { key: string }) => entry.key)).toEqual([
        "STAT.PORTALS_PLACED",
        "STAT.STEPS_TAKEN"
      ]);
      expect(statProposalPayload.tasks.every((entry: { source: string; track: string; signalSource: string }) =>
        entry.source === "fixture" && entry.track === "stat" && entry.signalSource === "steam-stat"
      )).toBe(true);

      const statImportResponse = await fetch(`${baseUrl}/api/steam/apps/620/stat-proposals/import-recommended`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          useFixture: true,
          limit: 2,
          reviewNotes: "schema stat import"
        })
      });
      const statImportPayload = await statImportResponse.json();
      expect(statImportResponse.status).toBe(201);
      expect(statImportPayload.importRun).toMatchObject({
        schemaVersion: "steambench.steam-stat-recommended-import.v1",
        appid: 620,
        source: "fixture",
        proposed: 2,
        imported: 2
      });
      expect(statImportPayload.imported.map((entry: { id: string }) => entry.id)).toEqual([
        "620:STAT.PORTALS_PLACED",
        "620:STAT.STEPS_TAKEN"
      ]);
      expect(statImportPayload.reviews).toHaveLength(2);
      expect(statImportPayload.blueprint.schemaVersion).toBe("steambench.benchmark-blueprint.v1");

      const leaderboardProposalResponse = await fetch(`${baseUrl}/api/steam/apps/620/leaderboard-proposals?useFixture=true&limit=2`);
      const leaderboardProposalPayload = await leaderboardProposalResponse.json();
      expect(leaderboardProposalResponse.status).toBe(200);
      expect(leaderboardProposalPayload.proposalRun).toMatchObject({
        schemaVersion: "steambench.steam-leaderboard-proposal-run.v1",
        appid: 620,
        source: "fixture",
        requestedLimit: 2,
        proposed: 2
      });
      expect(leaderboardProposalPayload.proposalRun.links.importRecommended).toBe("/api/steam/apps/620/leaderboard-proposals/import-recommended");
      expect(leaderboardProposalPayload.proposals.map((entry: { key: string }) => entry.key)).toEqual([
        "LDRB.CHALLENGE_MODE_TIME",
        "LDRB.LEAST_PORTALS"
      ]);
      expect(leaderboardProposalPayload.tasks.every((entry: { source: string; track: string; signalSource: string }) =>
        entry.source === "fixture" && entry.track === "leaderboard" && entry.signalSource === "steam-leaderboard"
      )).toBe(true);
      expect(leaderboardProposalPayload.reviews.every((entry: { decision: string }) => entry.decision === "review-required")).toBe(true);

      const leaderboardImportResponse = await fetch(`${baseUrl}/api/steam/apps/620/leaderboard-proposals/import-recommended`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          useFixture: true,
          limit: 2,
          reviewNotes: "leaderboard metadata import"
        })
      });
      const leaderboardImportPayload = await leaderboardImportResponse.json();
      expect(leaderboardImportResponse.status).toBe(201);
      expect(leaderboardImportPayload.importRun).toMatchObject({
        schemaVersion: "steambench.steam-leaderboard-recommended-import.v1",
        appid: 620,
        source: "fixture",
        proposed: 2,
        imported: 2,
        reviewRequired: 2
      });
      expect(leaderboardImportPayload.imported.map((entry: { id: string }) => entry.id)).toEqual([
        "620:LDRB.CHALLENGE_MODE_TIME",
        "620:LDRB.LEAST_PORTALS"
      ]);
      expect(leaderboardImportPayload.reviews).toHaveLength(2);
      expect(leaderboardImportPayload.blueprint.schemaVersion).toBe("steambench.benchmark-blueprint.v1");

      const taskSourceOpsResponse = await fetch(`${baseUrl}/api/steam/apps/620/task-source-ops?useFixture=true&limit=2`);
      const taskSourceOpsPayload = await taskSourceOpsResponse.json();
      expect(taskSourceOpsResponse.status).toBe(200);
      expect(taskSourceOpsPayload.ops).toMatchObject({
        schemaVersion: "steambench.steam-task-source-ops-report.v1",
        appid: 620,
        gameName: "Portal 2",
        status: "ready-to-publish",
        sources: {
          achievement: {
            source: "fixture"
          },
          stat: {
            source: "fixture",
            proposed: 2,
            newProposals: 0
          },
          leaderboard: {
            source: "fixture",
            proposed: 2,
            newProposals: 0,
            reviewRequired: 2
          }
        },
        links: {
          statProposals: "/api/steam/apps/620/stat-proposals",
          leaderboardProposals: "/api/steam/apps/620/leaderboard-proposals",
          publishCandidates: "/api/steam/apps/620/publish-candidates"
        }
      });
      expect(taskSourceOpsPayload.ops.registry.candidates).toBeGreaterThanOrEqual(4);
      expect(taskSourceOpsPayload.ops.recommendedActions.map((entry: { id: string }) => entry.id)).toContain("publish-candidates");
      expect(taskSourceOpsPayload.statProposalRun.schemaVersion).toBe("steambench.steam-stat-proposal-run.v1");
      expect(taskSourceOpsPayload.leaderboardProposalRun.schemaVersion).toBe("steambench.steam-leaderboard-proposal-run.v1");

      const publicSteamIntakeResponse = await fetch(`${baseUrl}/api/public/steam/apps/620/intake?useFixture=true&limit=2`);
      const publicSteamIntakePayload = await publicSteamIntakeResponse.json();
      expect(publicSteamIntakeResponse.status).toBe(200);
      expect(publicSteamIntakePayload.intake).toMatchObject({
        schemaVersion: "steambench.public-steam-app-intake.v1",
        appid: 620,
        canonicalArtifactName: "output.mp4",
        dataPolicy: {
          officialSteamSourcesOnly: true,
          proofConsentRequiredBeforePublicRanking: true
        },
        game: {
          appid: 620,
          name: "Portal 2"
        },
        intake: {
          sourceStatus: "ready-to-publish",
          blueprintStatus: expect.any(String)
        },
        sourceCoverage: {
          sources: {
            achievement: {
              source: "fixture"
            },
            stat: {
              source: "fixture"
            },
            leaderboard: {
              source: "fixture"
            }
          }
        },
        runtimeContract: {
          targetArtifactName: "output.mp4"
        },
	        publicEntrypoints: {
	          benchmarkPack: `${baseUrl}/api/public/games/620/benchmark-pack?season=all&limit=2`,
	          agentOnboarding: `${baseUrl}/api/public/agents/onboarding?taskId={taskId}&provider=external`,
	          taskActionSpaceTemplate: `${baseUrl}/api/public/tasks/{taskId}/action-space`,
	          runnerContractTemplate: `${baseUrl}/api/public/tasks/{taskId}/runner-contract`,
          publicWatchTemplate: `${baseUrl}/api/public/broadcasts/{streamId}/watch`,
          certificateVerify: `${baseUrl}/api/result-certificates/verify`
        },
        operatorEntrypoints: {
          importRecommended: `${baseUrl}/api/steam/apps/620/achievement-ladder/import-recommended`,
          publishCandidates: `${baseUrl}/api/steam/apps/620/publish-candidates`
        }
      });
      expect(["publication-ready", "competition-ready"]).toContain(publicSteamIntakePayload.intake.publicReadiness);
      expect(publicSteamIntakePayload.intake.dataPolicy.allowedSources).toContain("ISteamApps/GetAppList/v2");
      expect(publicSteamIntakePayload.intake.sourceCoverage.recommendedActions.map((entry: { id: string }) => entry.id)).toContain("publish-candidates");
      expect(publicSteamIntakePayload.intake.sourceCoverage.recommendedActions.every((entry: { endpoint: string }) => entry.endpoint.startsWith(baseUrl))).toBe(true);
      expect(publicSteamIntakePayload.intake.taskPipeline.taskLadder.map((band: { id: string }) => band.id)).toEqual([
        "starter",
        "ranked",
        "expert"
      ]);
      expect(publicSteamIntakePayload.intake.onboarding.stages.map((stage: { id: string }) => stage.id)).toEqual([
        "discovery",
        "achievement-ladder",
        "task-publication",
        "coverage",
        "competition"
      ]);
      expect(publicSteamIntakePayload.intake.runtimeContract.stage2StartConstraints.some((entry: string) => entry.includes("Do not call session.run_file"))).toBe(true);

      const invalidPublicSteamIntakeResponse = await fetch(`${baseUrl}/api/public/steam/apps/not-an-app/intake`);
      expect(invalidPublicSteamIntakeResponse.status).toBe(400);

      const bulkPublishResponse = await fetch(`${baseUrl}/api/steam/apps/620/publish-candidates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewApproved: true,
          reviewNotes: "bulk approved for smoke"
        })
      });
      const bulkPublishPayload = await bulkPublishResponse.json();
      expect(bulkPublishResponse.status).toBe(200);
      expect(bulkPublishPayload.publication).toMatchObject({
        schemaVersion: "steambench.task-publication.v1",
        appid: 620,
        totals: {
          blocked: 0
        }
      });
      expect(bulkPublishPayload.publication.published.length).toBeGreaterThanOrEqual(2);
      expect(bulkPublishPayload.publication.published.every((entry: { task: { status: string }; review: { decision: string } }) =>
        entry.task.status === "active" &&
        (entry.review.decision === "ranked-ready" || entry.review.decision === "review-required")
      )).toBe(true);
      expect(
        bulkPublishPayload.blueprint.taskLadder.reduce((total: number, band: { activeTasks: number }) => total + band.activeTasks, 0)
      ).toBeGreaterThanOrEqual(bulkPublishPayload.publication.published.length);

      const activeTasksAfterBulkPublish = await store.listTasks();
      expect(activeTasksAfterBulkPublish.some((entry) => entry.id === proposalPayload.task.id)).toBe(true);

      const externalProposalResponse = await fetch(`${baseUrl}/api/steam/apps/999999/task-proposals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gameName: "External Fixture",
          key: "CAP.STARTER_ROUTE",
          title: "Starter Route",
          track: "capture",
          level: 5,
          targetValue: "180 seconds",
          metricName: "completion_time_seconds",
          objective: "Complete the imported external-app benchmark route within the time cap.",
          estimatedRuntimeMinutes: 10,
          scoringRule: "Pass at <= 180 seconds; rank lower verified time higher.",
          reviewNotes: "external app proposal"
        })
      });
      const externalProposalPayload = await externalProposalResponse.json();
      expect(externalProposalResponse.status).toBe(201);
      expect(externalProposalPayload.task).toMatchObject({
        id: "999999:CAP.STARTER_ROUTE",
        appid: 999999,
        gameName: "External Fixture",
        status: "candidate"
      });

      const externalPublishResponse = await fetch(`${baseUrl}/api/steam/apps/999999/publish-candidates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewApproved: true,
          reviewNotes: "external app approved for smoke"
        })
      });
      const externalPublishPayload = await externalPublishResponse.json();
      expect(externalPublishResponse.status).toBe(200);
      expect(externalPublishPayload.publication.published).toHaveLength(1);

      const externalSuitesResponse = await fetch(`${baseUrl}/api/games/999999/benchmark-suites`);
      const externalSuitesPayload = await externalSuitesResponse.json();
      expect(externalSuitesResponse.status).toBe(200);
      expect(externalSuitesPayload.game).toMatchObject({
        appid: 999999,
        name: "External Fixture"
      });
      expect(externalSuitesPayload.suites.some((suite: { id: string; tier: string; taskCount: number }) =>
        suite.id === "999999:ranked" &&
        suite.tier === "ranked" &&
        suite.taskCount === 1
      )).toBe(true);

      const externalCompetitionResponse = await fetch(`${baseUrl}/api/games/999999/competition/run-local`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          humanUserId: onboardingRunHuman.id,
          agentId: onboardingRunAgent.id,
          suiteTier: "ranked",
          reviewApproved: true
        })
      });
      const externalCompetitionPayload = await externalCompetitionResponse.json();
      expect(externalCompetitionResponse.status).toBe(201);
      expect(externalCompetitionPayload.competitionRun).toMatchObject({
        schemaVersion: "steambench.game-competition-local-run.v1",
        appid: 999999,
        game: {
          name: "External Fixture"
        },
        suiteId: "999999:ranked",
        suiteTier: "ranked",
        status: "scored",
        complete: true
      });
      expect(externalCompetitionPayload.matches).toHaveLength(1);
      expect(externalCompetitionPayload.certificate.integrity.readyForPublicShare).toBe(true);

      const publishResponse = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(importPayload.imported[0].id)}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "active",
          reviewNotes: "approved for smoke"
        })
      });
      expect(publishResponse.status).toBe(200);

      const runResponse = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: importPayload.imported[0].id,
          competitor: "imported-task-agent",
          competitorType: "agent"
        })
      });
      const runPayload = await runResponse.json();
      expect(runResponse.status).toBe(201);
      expect(runPayload.run.taskId).toBe(importPayload.imported[0].id);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("gates imported non-fixture tasks until review publishes them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-task-gate-"));
    const store = new SteambenchStore(join(dir, "store.json"));

    try {
      const [candidate] = await store.upsertTaskCandidates([
        {
          id: "999999:ACH_IMPORTED_ONLY",
          appid: 999999,
          gameName: "Imported Only",
          title: "Imported Candidate",
          track: "achievement",
          level: 4,
          score: 4200,
          objective: "Unlock Imported Candidate in Imported Only.",
          proof: ["Steam achievement state for the linked SteamID", "Video capture artifact"],
          estimatedRuntimeMinutes: 30,
          suitability: "ranked",
          suitabilityScore: 82,
          reviewRequired: false,
          fairnessVerdict: "good",
          riskFlags: [],
          source: "manual"
        }
      ]);
      expect(candidate.status).toBe("candidate");

      const blockedRun = await store.createRun({
        taskId: candidate.id,
        competitor: "blocked-agent",
        competitorType: "agent"
      });
      expect(blockedRun).toBeNull();

      await store.updateTaskRegistryStatus(candidate.id, "active");
      const activeRun = await store.createRun({
        taskId: candidate.id,
        competitor: "active-agent",
        competitorType: "agent"
      });
      expect(activeRun?.taskId).toBe(candidate.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("requires explicit review approval before publishing controlled or rejected candidates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-review-gate-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      await store.upsertTaskCandidates([
        {
          id: "646570:LDRB.REVIEW_GATE",
          appid: 646570,
          gameName: "Slay the Spire",
          title: "Review Gate Leaderboard",
          track: "leaderboard",
          level: 6,
          score: 6500,
          objective: "Maximize a controlled leaderboard score.",
          proof: ["Score screen", "Canonical output.mp4 artifact"],
          estimatedRuntimeMinutes: 45,
          suitability: "expert",
          suitabilityScore: 70,
          reviewRequired: true,
          fairnessVerdict: "controlled",
          riskFlags: [],
          source: "manual",
          metricName: "seeded_run_score",
          targetValue: "highest score",
          scoringRule: "Rank by final score."
        },
        {
          id: "999999:ACH.REJECT_GATE",
          appid: 999999,
          gameName: "Risk Game",
          title: "Rejected Gate",
          track: "achievement",
          level: 9,
          score: 9000,
          objective: "Unlock a risky achievement.",
          proof: ["Steam achievement state"],
          estimatedRuntimeMinutes: 40,
          suitability: "needs-review",
          suitabilityScore: 20,
          reviewRequired: true,
          fairnessVerdict: "exclude",
          riskFlags: ["antiCheat"],
          source: "manual",
          achievementPercent: 1
        }
      ]);

      const blockedControlled = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent("646570:LDRB.REVIEW_GATE")}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "active" })
      });
      expect(blockedControlled.status).toBe(422);
      expect((await blockedControlled.json()).error).toBe("task_review_required");

      const approvedControlled = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent("646570:LDRB.REVIEW_GATE")}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "active",
          reviewApproved: true,
          reviewNotes: "Reviewed controlled leaderboard rules."
        })
      });
      expect(approvedControlled.status).toBe(200);
      expect((await approvedControlled.json()).task.status).toBe("active");

      const blockedRejected = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent("999999:ACH.REJECT_GATE")}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "active",
          reviewApproved: true,
          reviewNotes: "Still unsafe."
        })
      });
      expect(blockedRejected.status).toBe(422);
      expect((await blockedRejected.json()).error).toBe("task_review_rejected");

      const overriddenRejected = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent("999999:ACH.REJECT_GATE")}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "active",
          forceReviewOverride: true,
          reviewNotes: "Administrative override for isolated testing only."
        })
      });
      expect(overriddenRejected.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("verifies Steam OpenID callbacks and links the target user", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-openid-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store, {
      verifySteamOpenId: async () => ({
        steamid: "76561198000000000",
        claimedId: "https://steamcommunity.com/openid/id/76561198000000000"
      })
    });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const userResponse = await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: "steam-linked-human",
          type: "human"
        })
      });
      const userPayload = await userResponse.json();

      const intentResponse = await fetch(`${baseUrl}/api/steam/link-intents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          returnUrl: "http://127.0.0.1:5173",
          userId: userPayload.user.id
        })
      });
      const intentPayload = await intentResponse.json();

      const callbackResponse = await fetch(
        `${baseUrl}/api/steam/callback?state=${intentPayload.intent.state}&openid.mode=id_res&openid.claimed_id=https%3A%2F%2Fsteamcommunity.com%2Fopenid%2Fid%2F76561198000000000`,
        { redirect: "manual" }
      );

      expect(callbackResponse.status).toBe(302);
      const snapshot = await store.read();
      expect(snapshot.steamLinks[0]).toMatchObject({
        state: intentPayload.intent.state,
        status: "linked",
        steamid: "76561198000000000"
      });
      expect(snapshot.users[0].linkedSteamId).toBe("76561198000000000");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("requires Steam Web API configuration for linked-user achievement proof", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-proof-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const user = await store.createUser({
        handle: "proof-human",
        type: "human"
      });
      await store.linkSteamToUser(user.id, "76561198000000000", { proofConsent: true });

      const response = await fetch(`${baseUrl}/api/users/${user.id}/steam/apps/620/achievements`);
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({
        error: "steam_player_achievement_fetch_failed"
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("queues, accepts, and runs a human-vs-agent challenge", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-challenge-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const task = buildFixtureTasks().find((entry) => entry.id === "620:ACH.NO_BOAT");
      expect(task).toBeDefined();
      const human = await store.createUser({
        handle: "challenge-human",
        type: "human"
      });
      await store.linkSteamToUser(human.id, "76561198000000000", { proofConsent: true });
      const agent = await store.createAgentProfile({
        handle: "challenge-agent"
      });

      const challengeResponse = await fetch(`${baseUrl}/api/challenges`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: task!.id,
          humanUserId: human.id,
          agentId: agent.id,
          createdBy: "human",
          createdById: human.id
        })
      });
      const challengePayload = await challengeResponse.json();
      expect(challengeResponse.status).toBe(201);
      expect(challengePayload.challenge).toMatchObject({
        status: "open",
        taskId: task!.id,
        humanUserId: human.id,
        agentId: agent.id
      });
      expect(challengePayload.eligibility.status).toBe("ready");

      const openOpsResponse = await fetch(`${baseUrl}/api/challenges/ops-report?status=open&limit=10`);
      const openOpsPayload = await openOpsResponse.json();
      expect(openOpsResponse.status).toBe(200);
      expect(openOpsPayload.report).toMatchObject({
        schemaVersion: "steambench.challenge-ops-report.v1",
        status: "needs-acceptance",
        totals: {
          open: 1
        }
      });
      expect(openOpsPayload.report.tickets.some((entry: { challenge: { id: string }; status: string }) =>
        entry.challenge.id === challengePayload.challenge.id &&
        entry.status === "open"
      )).toBe(true);
      expect(openOpsPayload.report.recommendedActions.map((entry: { id: string }) => entry.id)).toEqual([
        "accept-open-challenge",
        "inspect-challenges"
      ]);

      const listResponse = await fetch(`${baseUrl}/api/challenges`);
      const listPayload = await listResponse.json();
      expect(listPayload.challenges[0]).toMatchObject({
        task: {
          id: task!.id
        },
        human: {
          id: human.id
        },
        agent: {
          id: agent.id
        }
      });

      const acceptResponse = await fetch(`${baseUrl}/api/challenges/${challengePayload.challenge.id}/accept`, {
        method: "POST"
      });
      const acceptPayload = await acceptResponse.json();
      expect(acceptResponse.status).toBe(200);
      expect(acceptPayload.challenge.status).toBe("accepted");
      expect(acceptPayload.match.status).toBe("scheduled");

      const acceptedOpsResponse = await fetch(`${baseUrl}/api/challenges/ops-report?status=accepted&limit=10`);
      const acceptedOpsPayload = await acceptedOpsResponse.json();
      expect(acceptedOpsResponse.status).toBe(200);
      expect(acceptedOpsPayload.report).toMatchObject({
        schemaVersion: "steambench.challenge-ops-report.v1",
        status: "needs-execution",
        totals: {
          accepted: 1
        }
      });
      expect(acceptedOpsPayload.report.tickets.some((entry: {
        challenge: { id: string };
        status: string;
        match?: { id: string };
      }) =>
        entry.challenge.id === challengePayload.challenge.id &&
        entry.status === "accepted" &&
        entry.match?.id === acceptPayload.match.id
      )).toBe(true);
      expect(acceptedOpsPayload.report.recommendedActions.map((entry: { id: string }) => entry.id)).toEqual([
        "run-challenge-local",
        "inspect-challenges"
      ]);

      const runResponse = await fetch(`${baseUrl}/api/challenges/${challengePayload.challenge.id}/run-local`, {
        method: "POST"
      });
      const runPayload = await runResponse.json();
      expect(runResponse.status).toBe(200);
      expect(runPayload.challenge.status).toBe("scored");
      expect(runPayload.match.status).toBe("scored");
      expect(runPayload.run.evaluated.match.id).toBe(acceptPayload.match.id);

      const readyOpsResponse = await fetch(`${baseUrl}/api/challenges/ops-report?status=scoreboard-ready&limit=10`);
      const readyOpsPayload = await readyOpsResponse.json();
      expect(readyOpsResponse.status).toBe(200);
      expect(readyOpsPayload.report).toMatchObject({
        schemaVersion: "steambench.challenge-ops-report.v1",
        status: "ready-to-share",
        totals: {
          scoreboardReady: 1,
          scoreboardRows: 2
        }
      });
      expect(readyOpsPayload.report.tickets.some((entry: {
        challenge: { id: string };
        status: string;
        scoreboardRows: number;
      }) =>
        entry.challenge.id === challengePayload.challenge.id &&
        entry.status === "scoreboard-ready" &&
        entry.scoreboardRows === 2
      )).toBe(true);
      expect(readyOpsPayload.report.recommendedActions.map((entry: { id: string }) => entry.id)).toEqual([
        "share-challenge-certificate",
        "inspect-challenges"
      ]);

      const certificateResponse = await fetch(`${baseUrl}/api/challenges/${challengePayload.challenge.id}/result-certificate`);
      const certificatePayload = await certificateResponse.json();
      expect(certificateResponse.status).toBe(200);
      expect(certificatePayload.certificate).toMatchObject({
        schemaVersion: "steambench.result-certificate.v1",
        kind: "challenge",
        id: challengePayload.challenge.id,
        status: "scored",
        verdict: "scoreboard-ready",
        canonicalArtifactName: "output.mp4",
        result: {
          winner: "tie",
          margin: 0,
          scoreboardRows: 2
        },
        evidence: {
          bundleReady: true
        },
        integrity: {
          readyForPublicShare: true
        }
      });
      expect(certificatePayload.certificate.links.evidenceBundle).toBe(`${baseUrl}/api/challenges/${challengePayload.challenge.id}/evidence-bundle`);
      expect(certificatePayload.certificate.participants.map((entry: { side: string }) => entry.side)).toEqual([
        "human",
        "agent"
      ]);

      const bundleResponse = await fetch(`${baseUrl}/api/challenges/${challengePayload.challenge.id}/evidence-bundle`);
      const bundlePayload = await bundleResponse.json();
      expect(bundleResponse.status).toBe(200);
      expect(bundlePayload.bundle).toMatchObject({
        schemaVersion: "steambench.challenge-evidence-bundle.v1",
        challengeId: challengePayload.challenge.id,
        taskId: task!.id,
        challenge: {
          status: "scored",
          matchId: acceptPayload.match.id
        },
        match: {
          id: acceptPayload.match.id,
          status: "scored"
        },
        integrity: {
          verdict: "scoreboard-ready",
          canonicalArtifactName: "output.mp4",
          challengeAccepted: true,
          matchScored: true,
          humanBundleReady: true,
          agentBundleReady: true,
          allRunBundlesScoreboardReady: true,
          scoreboardRows: 2
        }
      });
      expect(bundlePayload.bundle.runBundles.human).toMatchObject({
        schemaVersion: "steambench.evidence-bundle.v1",
        integrity: {
          verdict: "scoreboard-ready",
          canonicalArtifactPresent: true
        }
      });
      expect(bundlePayload.bundle.runBundles.agent).toMatchObject({
        schemaVersion: "steambench.evidence-bundle.v1",
        integrity: {
          verdict: "scoreboard-ready",
          canonicalArtifactPresent: true
        }
      });
      expect(bundlePayload.bundle.integrity.checklist.every((entry: { status: string }) => entry.status === "pass")).toBe(true);

      const stateResponse = await fetch(`${baseUrl}/api/state`);
      const statePayload = await stateResponse.json();
      expect(statePayload.challenges.some((entry: { challenge: { id: string; status: string }; match?: { status: string } }) =>
        entry.challenge.id === challengePayload.challenge.id && entry.challenge.status === "scored" && entry.match?.status === "scored"
      )).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exposes benchmark suites through state, global, and per-game APIs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-suites-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const stateResponse = await fetch(`${baseUrl}/api/state`);
      const statePayload = await stateResponse.json();
      expect(statePayload.benchmarkSuites.some((suite: { id: string; status: string }) => suite.id === "620:ranked" && suite.status === "ranked-ready")).toBe(true);

      const suitesResponse = await fetch(`${baseUrl}/api/benchmark-suites`);
      const suitesPayload = await suitesResponse.json();
      expect(suitesResponse.status).toBe(200);
      expect(suitesPayload.suites[0]).toMatchObject({
        taskCount: expect.any(Number),
        readinessScore: expect.any(Number)
      });
      expect(suitesPayload.suites.some((suite: { id: string; taskIds: string[] }) => suite.id === "646570:expert" && suite.taskIds.includes("646570:LDRB.SEED_A20_SCORE"))).toBe(true);

      const gameSuitesResponse = await fetch(`${baseUrl}/api/games/620/benchmark-suites`);
      const gameSuitesPayload = await gameSuitesResponse.json();
      expect(gameSuitesResponse.status).toBe(200);
      expect(gameSuitesPayload.game.name).toBe("Portal 2");
      expect(gameSuitesPayload.suites.every((suite: { appid: number }) => suite.appid === 620)).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates suite races as multi-match benchmark schedules after suite preflight", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-suite-race-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const human = await store.createUser({
        handle: "suite-race-human",
        type: "human"
      });
      await store.linkSteamToUser(human.id, "76561198000000000", { proofConsent: true });
      const agent = await store.createAgentProfile({
        handle: "suite-race-agent"
      });

      const preflightResponse = await fetch(`${baseUrl}/api/benchmark-suites/620:ranked/preflight`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          humanUserId: human.id,
          agentId: agent.id
        })
      });
      const preflightPayload = await preflightResponse.json();
      expect(preflightResponse.status).toBe(200);
      expect(preflightPayload.preflight).toMatchObject({
        status: "ready",
        suite: {
          id: "620:ranked"
        }
      });
      expect(preflightPayload.preflight.eligibility.every((entry: { status: string }) => entry.status === "ready")).toBe(true);

      const raceResponse = await fetch(`${baseUrl}/api/benchmark-suites/620:ranked/races`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          humanUserId: human.id,
          agentId: agent.id
        })
      });
      const racePayload = await raceResponse.json();
      expect(raceResponse.status).toBe(201);
      expect(racePayload.race).toMatchObject({
        suiteId: "620:ranked",
        status: "scheduled"
      });
      expect(racePayload.matches).toHaveLength(racePayload.preflight.suite.taskIds.length);
      expect(racePayload.race.matchIds).toHaveLength(racePayload.matches.length);

      const earlyEvaluateResponse = await fetch(`${baseUrl}/api/suite-races/${racePayload.race.id}/evaluate`, {
        method: "POST"
      });
      const earlyEvaluatePayload = await earlyEvaluateResponse.json();
      expect(earlyEvaluateResponse.status).toBe(422);
      expect(earlyEvaluatePayload.race.status).toBe("running");

      const pendingAuditResponse = await fetch(`${baseUrl}/api/suite-races/${racePayload.race.id}/audit`);
      const pendingAuditPayload = await pendingAuditResponse.json();
      expect(pendingAuditResponse.status).toBe(200);
      expect(pendingAuditPayload.audit).toMatchObject({
        verdict: "match-incomplete",
        evidenceCounts: {
          matches: racePayload.matches.length,
          scoredMatches: 0
        }
      });
      expect(pendingAuditPayload.audit.missing.length).toBeGreaterThan(0);

      const runSuiteResponse = await fetch(`${baseUrl}/api/suite-races/${racePayload.race.id}/run-local`, {
        method: "POST"
      });
      const runSuitePayload = await runSuiteResponse.json();
      expect(runSuiteResponse.status).toBe(200);
      expect(runSuitePayload.race).toMatchObject({
        status: "scored",
        winner: "tie",
        margin: 0
      });
      expect(runSuitePayload.childResults).toHaveLength(racePayload.matches.length);
      expect(runSuitePayload.incompleteMatches).toHaveLength(0);
      expect(runSuitePayload.race.humanScore).toBeGreaterThan(0);
      expect(runSuitePayload.race.agentScore).toBe(runSuitePayload.race.humanScore);
      expect(runSuitePayload.audit.verdict).toBe("scoreboard-ready");
      expect(runSuitePayload.bundle.integrity.allChildRunsScoreboardReady).toBe(true);

      const auditResponse = await fetch(`${baseUrl}/api/suite-races/${racePayload.race.id}/audit`);
      const auditPayload = await auditResponse.json();
      expect(auditResponse.status).toBe(200);
      expect(auditPayload.audit).toMatchObject({
        verdict: "scoreboard-ready",
        aggregate: {
          winner: "tie",
          margin: 0
        },
        evidenceCounts: {
          matches: racePayload.matches.length,
          scoredMatches: racePayload.matches.length
        }
      });
      expect(auditPayload.audit.matches.every((entry: { status: string; humanAudit?: { verdict: string }; agentAudit?: { verdict: string } }) =>
        entry.status === "scoreboard-ready" &&
        entry.humanAudit?.verdict === "scoreboard-ready" &&
        entry.agentAudit?.verdict === "scoreboard-ready"
      )).toBe(true);

      const bundleResponse = await fetch(`${baseUrl}/api/suite-races/${racePayload.race.id}/evidence-bundle`);
      const bundlePayload = await bundleResponse.json();
      expect(bundleResponse.status).toBe(200);
      expect(bundlePayload.bundle).toMatchObject({
        schemaVersion: "steambench.suite-race-evidence-bundle.v1",
        raceId: racePayload.race.id,
        suiteId: "620:ranked",
        integrity: {
          verdict: "scoreboard-ready",
          aggregateScored: true,
          allChildMatchesPresent: true,
          allChildMatchesScored: true,
          allChildRunsScoreboardReady: true,
          missingEvidenceCount: 0
        }
      });
      expect(bundlePayload.bundle.integrity.checklist.every((entry: { status: string }) => entry.status === "pass")).toBe(true);

      const certificateResponse = await fetch(`${baseUrl}/api/suite-races/${racePayload.race.id}/result-certificate`);
      const certificatePayload = await certificateResponse.json();
      expect(certificateResponse.status).toBe(200);
      expect(certificatePayload.certificate).toMatchObject({
        schemaVersion: "steambench.result-certificate.v1",
        kind: "suite-race",
        id: racePayload.race.id,
        status: "scored",
        verdict: "scoreboard-ready",
        result: {
          winner: "tie",
          margin: 0,
          scoreboardRows: racePayload.matches.length * 2
        },
        evidence: {
          bundleReady: true
        },
        integrity: {
          readyForPublicShare: true
        }
      });
      expect(certificatePayload.certificate.tasks).toHaveLength(racePayload.matches.length);

      const raceDetailResponse = await fetch(`${baseUrl}/api/suite-races/${racePayload.race.id}`);
      const raceDetailPayload = await raceDetailResponse.json();
      expect(raceDetailResponse.status).toBe(200);
      expect(raceDetailPayload).toMatchObject({
        race: {
          id: racePayload.race.id,
          status: "scored"
        },
        human: {
          id: human.id
        },
        agent: {
          id: agent.id
        }
      });
      expect(raceDetailPayload.matches).toHaveLength(racePayload.matches.length);

      const appCompetitionResponse = await fetch(`${baseUrl}/api/games/620/competition/run-local`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          humanUserId: human.id,
          agentId: agent.id,
          suiteTier: "ranked"
        })
      });
      const appCompetitionPayload = await appCompetitionResponse.json();
      expect(appCompetitionResponse.status).toBe(201);
      expect(appCompetitionPayload.competitionRun).toMatchObject({
        schemaVersion: "steambench.game-competition-local-run.v1",
        appid: 620,
        suiteId: "620:ranked",
        suiteTier: "ranked",
        status: "scored",
        complete: true,
        links: {
          suiteRace: expect.stringContaining("/api/suite-races/"),
          evidenceBundle: expect.stringContaining("/api/suite-races/"),
          resultCertificate: expect.stringContaining("/api/suite-races/"),
          gameStandings: "/api/games/620/standings"
        }
      });
      expect(appCompetitionPayload.race).toMatchObject({
        suiteId: "620:ranked",
        status: "scored",
        winner: "tie"
      });
      expect(appCompetitionPayload.matches).toHaveLength(appCompetitionPayload.preflight.suite.taskIds.length);
      expect(appCompetitionPayload.audit.verdict).toBe("scoreboard-ready");
      expect(appCompetitionPayload.bundle.integrity.allChildRunsScoreboardReady).toBe(true);
      expect(appCompetitionPayload.certificate).toMatchObject({
        kind: "suite-race",
        verdict: "scoreboard-ready",
        integrity: {
          readyForPublicShare: true
        }
      });
      expect(appCompetitionPayload.standings).toMatchObject({
        schemaVersion: "steambench.game-competition-standings.v1",
        game: {
          appid: 620
        }
      });

      const opsReportResponse = await fetch(`${baseUrl}/api/games/620/competition/ops-report?humanUserId=${human.id}&agentId=${agent.id}&suiteTier=ranked&season=all&limit=6`);
      const opsReportPayload = await opsReportResponse.json();
      expect(opsReportResponse.status).toBe(200);
      expect(opsReportPayload.report).toMatchObject({
        schemaVersion: "steambench.game-competition-ops-report.v1",
        appid: 620,
        selectedSuite: {
          id: "620:ranked",
          tier: "ranked"
        },
        totals: {
          activeTasks: expect.any(Number),
          suites: expect.any(Number),
          scoreboardRows: expect.any(Number)
        },
        standings: {
          summary: {
            activeTasks: expect.any(Number)
          }
        },
        links: {
          scheduleCoverage: "/api/games/620/coverage-plan/schedule",
          runCompetitionLocal: "/api/games/620/competition/run-local",
          resultCertificate: "/api/games/620/result-certificate"
        }
      });
      expect(opsReportPayload.report.recommendedActions.some((action: { id: string }) => action.id === "run-suite-race")).toBe(true);
      expect(opsReportPayload.report.recommendedActions.some((action: { id: string }) => action.id === "inspect-certificate")).toBe(true);
      if (opsReportPayload.report.totals.humanGaps === 0 && opsReportPayload.report.totals.agentGaps === 0) {
        expect(opsReportPayload.report.recommendedActions.some((action: { id: string }) => action.id === "schedule-coverage")).toBe(false);
      }

      const controlledResponse = await fetch(`${baseUrl}/api/benchmark-suites/646570:expert/races`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          humanUserId: human.id,
          agentId: agent.id
        })
      });
      const controlledPayload = await controlledResponse.json();
      expect(controlledResponse.status).toBe(409);
      expect(controlledPayload).toMatchObject({
        error: "suite_race_review_required",
        preflight: {
          status: "controlled"
        }
      });

      const listResponse = await fetch(`${baseUrl}/api/suite-races`);
      const listPayload = await listResponse.json();
      expect(listResponse.status).toBe(200);
      expect(listPayload.suiteRaces.some((entry: { race: { id: string } }) => entry.race.id === racePayload.race.id)).toBe(true);

      const stateResponse = await fetch(`${baseUrl}/api/state`);
      const statePayload = await stateResponse.json();
      expect(statePayload.suiteRaceAuditSummaries.some((audit: { raceId: string; verdict: string }) =>
        audit.raceId === racePayload.race.id && audit.verdict === "scoreboard-ready"
      )).toBe(true);
      expect(statePayload.competitionEvents.some((event: { scope: string; suiteRaces: { scored: number }; entrants: { runnablePairs: number } }) =>
        event.scope === "all" && event.suiteRaces.scored > 0 && event.entrants.runnablePairs > 0
      )).toBe(true);

      const eventsResponse = await fetch(`${baseUrl}/api/competition-events`);
      const eventsPayload = await eventsResponse.json();
      expect(eventsResponse.status).toBe(200);
      expect(eventsPayload.events).toHaveLength(3);

      const weeklyEventResponse = await fetch(`${baseUrl}/api/competition-events/weekly`);
      const weeklyEventPayload = await weeklyEventResponse.json();
      expect(weeklyEventResponse.status).toBe(200);
      expect(weeklyEventPayload.event).toMatchObject({
        scope: "weekly",
        entrants: {
          consentedHumans: 1,
          activeAgents: 1,
          runnablePairs: 1
        },
        suiteRaces: {
          scored: expect.any(Number)
        }
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("registers explicit competition event entrants behind Steam consent and active agent gates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "steambench-event-registration-"));
    const store = new SteambenchStore(join(dir, "store.json"));
    const app = createSteambenchApp(store);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to resolve test server address");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const human = await store.createUser({
        handle: "event-human",
        type: "human"
      });
      await store.linkSteamToUser(human.id, "76561198000000000");
      const agent = await store.createAgentProfile({
        handle: "event-agent"
      });

      const blockedHumanResponse = await fetch(`${baseUrl}/api/competition-events/weekly/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participantType: "human",
          participantId: human.id
        })
      });
      expect(blockedHumanResponse.status).toBe(409);
      expect(await blockedHumanResponse.json()).toMatchObject({
        error: "steam_proof_consent_required"
      });

      await store.updateSteamProofConsent(human.id, true);
      const humanRegistrationResponse = await fetch(`${baseUrl}/api/competition-events/weekly/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participantType: "human",
          participantId: human.id
        })
      });
      const humanRegistrationPayload = await humanRegistrationResponse.json();
      expect(humanRegistrationResponse.status).toBe(201);
      expect(humanRegistrationPayload.registration).toMatchObject({
        eventScope: "weekly",
        participantType: "human",
        participantId: human.id,
        status: "registered"
      });

      const agentRegistrationResponse = await fetch(`${baseUrl}/api/competition-events/weekly/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participantType: "agent",
          participantId: agent.id
        })
      });
      expect(agentRegistrationResponse.status).toBe(201);

      const weeklyEventResponse = await fetch(`${baseUrl}/api/competition-events/weekly`);
      const weeklyEventPayload = await weeklyEventResponse.json();
      expect(weeklyEventPayload.event).toMatchObject({
        entrants: {
          registeredHumans: 1,
          registeredAgents: 1,
          registeredPairs: 1
        }
      });

      const registrationsResponse = await fetch(`${baseUrl}/api/competition-events/registrations`);
      const registrationsPayload = await registrationsResponse.json();
      expect(registrationsResponse.status).toBe(200);
      expect(registrationsPayload.registrations).toHaveLength(2);

      const eventOpsBeforeScheduleResponse = await fetch(`${baseUrl}/api/competition-events/weekly/ops-report?suiteId=620:ranked`);
      const eventOpsBeforeSchedulePayload = await eventOpsBeforeScheduleResponse.json();
      expect(eventOpsBeforeScheduleResponse.status).toBe(200);
      expect(eventOpsBeforeSchedulePayload.report).toMatchObject({
        schemaVersion: "steambench.competition-event-ops-report.v1",
        scope: "weekly",
        status: "needs-scheduling",
        selectedSuite: {
          id: "620:ranked"
        },
        totals: {
          registeredPairs: 1,
          scheduledRaces: 0,
          readyForPublicShare: false
        },
        gaps: {
          unscheduledPairs: 1
        }
      });
      expect(eventOpsBeforeSchedulePayload.report.recommendedActions.map((action: { id: string }) => action.id)).toContain("schedule-suite");

      const scheduleResponse = await fetch(`${baseUrl}/api/competition-events/weekly/schedule-suite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          suiteId: "620:ranked"
        })
      });
      const schedulePayload = await scheduleResponse.json();
      expect(scheduleResponse.status).toBe(201);
      expect(schedulePayload.schedule).toMatchObject({
        scope: "weekly",
        entrants: {
          eligiblePairs: 1
        }
      });
      expect(schedulePayload.schedule.scheduled).toHaveLength(1);
      expect(schedulePayload.schedule.scheduled[0].race).toMatchObject({
        suiteId: "620:ranked",
        eventScope: "weekly",
        humanUserId: human.id,
        agentId: agent.id,
        status: "scheduled"
      });
      expect(schedulePayload.schedule.scheduled[0].matches.length).toBeGreaterThan(0);

      const eventRunResponse = await fetch(`${baseUrl}/api/competition-events/weekly/run-suite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          suiteId: "620:ranked",
          maxRaces: 1
        })
      });
      const eventRunPayload = await eventRunResponse.json();
      expect(eventRunResponse.status).toBe(200);
      expect(eventRunPayload.run).toMatchObject({
        scope: "weekly",
        suiteId: "620:ranked",
        candidateCount: 1,
        incomplete: []
      });
      expect(eventRunPayload.run.executed).toHaveLength(1);
      expect(eventRunPayload.run.executed[0].race).toMatchObject({
        suiteId: "620:ranked",
        eventScope: "weekly",
        status: "scored"
      });
      expect(eventRunPayload.run.executed[0].bundle.integrity).toMatchObject({
        verdict: "scoreboard-ready",
        allChildRunsScoreboardReady: true
      });

      const eventBundleResponse = await fetch(`${baseUrl}/api/competition-events/weekly/evidence-bundle`);
      const eventBundlePayload = await eventBundleResponse.json();
      expect(eventBundleResponse.status).toBe(200);
      expect(eventBundlePayload.bundle).toMatchObject({
        schemaVersion: "steambench.competition-event-evidence-bundle.v1",
        scope: "weekly",
        integrity: {
          registeredPairs: 1,
          scheduledRaces: 1,
          scoredRaces: 1,
          allScheduledRacesBundled: true,
          allScheduledRacesScored: true,
          allBundlesScoreboardReady: true
        }
      });
      expect(eventBundlePayload.bundle.integrity.checklist.every((entry: { status: string }) => entry.status === "pass")).toBe(true);

      const eventOpsAfterRunResponse = await fetch(`${baseUrl}/api/competition-events/weekly/ops-report?suiteId=620:ranked`);
      const eventOpsAfterRunPayload = await eventOpsAfterRunResponse.json();
      expect(eventOpsAfterRunResponse.status).toBe(200);
      expect(eventOpsAfterRunPayload.report).toMatchObject({
        schemaVersion: "steambench.competition-event-ops-report.v1",
        scope: "weekly",
        status: "ready-to-share",
        totals: {
          registeredPairs: 1,
          scheduledRaces: 1,
          scoredRaces: 1,
          readyRaceBundles: 1,
          readyForPublicShare: true
        },
        gaps: {
          unscoredRaces: 0,
          unreadyRaceBundles: 0
        }
      });
      expect(eventOpsAfterRunPayload.report.recommendedActions.map((action: { id: string }) => action.id)).toContain("inspect-event-certificate");

      const eventCertificateResponse = await fetch(`${baseUrl}/api/competition-events/weekly/result-certificate`);
      const eventCertificatePayload = await eventCertificateResponse.json();
      expect(eventCertificateResponse.status).toBe(200);
      expect(eventCertificatePayload.certificate).toMatchObject({
        schemaVersion: "steambench.result-certificate.v1",
        kind: "competition-event",
        id: "event:weekly",
        status: "active",
        verdict: "scoreboard-ready",
        result: {
          scoreboardRows: expect.any(Number)
        },
        evidence: {
          bundleReady: true
        },
        links: {
          evidenceBundle: `${baseUrl}/api/competition-events/weekly/evidence-bundle`,
          resultCertificate: `${baseUrl}/api/competition-events/weekly/result-certificate`
        },
        integrity: {
          readyForPublicShare: true
        }
      });
      expect(eventCertificatePayload.certificate.participants.length).toBeGreaterThanOrEqual(2);
      expect(eventCertificatePayload.certificate.tasks.length).toBeGreaterThan(0);

      const stateWithEventBundleResponse = await fetch(`${baseUrl}/api/state`);
      const stateWithEventBundlePayload = await stateWithEventBundleResponse.json();
      expect(stateWithEventBundleResponse.status).toBe(200);
      expect(stateWithEventBundlePayload.competitorProfiles.some((profile: { participant: { type: string; id: string }; suiteRaces: { scored: number } }) =>
        profile.participant.type === "human" && profile.participant.id === human.id && profile.suiteRaces.scored === 1
      )).toBe(true);
      expect(stateWithEventBundlePayload.competitionEventBundleSummaries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            scope: "weekly",
            registeredPairs: 1,
            scheduledRaces: 1,
            scoredRaces: 1,
            bundleCount: 1,
            readyBundleCount: 1,
            checklistPasses: 5,
            checklistTotal: 5
          })
        ])
      );

      const humanProfileResponse = await fetch(`${baseUrl}/api/competitors/human/${human.id}/profile`);
      const humanProfilePayload = await humanProfileResponse.json();
      expect(humanProfileResponse.status).toBe(200);
      expect(humanProfilePayload.profile).toMatchObject({
        participant: {
          type: "human",
          id: human.id,
          linkedSteamId: "76561198000000000"
        },
        registrations: [
          {
            eventScope: "weekly",
            status: "registered"
          }
        ],
        runs: {
          scored: expect.any(Number)
        },
        suiteRaces: {
          scored: 1,
          eventScoped: 1
        },
        evidence: {
          verifiedProofs: expect.any(Number)
        }
      });

      const agentProfileResponse = await fetch(`${baseUrl}/api/competitors/agent/${agent.id}/profile`);
      const agentProfilePayload = await agentProfileResponse.json();
      expect(agentProfileResponse.status).toBe(200);
      expect(agentProfilePayload.profile).toMatchObject({
        participant: {
          type: "agent",
          id: agent.id,
          status: "active"
        },
        suiteRaces: {
          scored: 1,
          eventScoped: 1
        }
      });

      const duplicateScheduleResponse = await fetch(`${baseUrl}/api/competition-events/weekly/schedule-suite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          suiteId: "620:ranked"
        })
      });
      const duplicateSchedulePayload = await duplicateScheduleResponse.json();
      expect(duplicateScheduleResponse.status).toBe(200);
      expect(duplicateSchedulePayload.schedule).toMatchObject({
        scheduled: [],
        skipped: [
          {
            reason: "suite_race_already_scheduled"
          }
        ]
      });

      const withdrawResponse = await fetch(`${baseUrl}/api/competition-events/registrations/${humanRegistrationPayload.registration.id}/withdraw`, {
        method: "POST"
      });
      expect(withdrawResponse.status).toBe(200);
      expect(await withdrawResponse.json()).toMatchObject({
        registration: {
          status: "withdrawn"
        }
      });

      const eventAfterWithdrawResponse = await fetch(`${baseUrl}/api/competition-events/weekly`);
      const eventAfterWithdrawPayload = await eventAfterWithdrawResponse.json();
      expect(eventAfterWithdrawPayload.event.entrants).toMatchObject({
        registeredHumans: 0,
        registeredAgents: 1,
        registeredPairs: 0
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });
});
