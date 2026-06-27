import { describe, expect, it } from "vitest";
import type { BenchmarkTask } from "../benchmark/types";
import type { RuntimeRunEvent } from "../runtime/events";
import { buildAgentActionTrace, buildAgentPlaybook } from "./agent-playbook";
import { buildAgentRuntimeHandoff } from "./agent-runtime-handoff";
import type { BenchmarkRun, LiveStreamSession, RuntimeControlSession } from "./store";

const task: BenchmarkTask = {
  id: "1145360:ESCAPE_TARTARUS",
  appid: 1145360,
  gameName: "Hades",
  title: "Escaped Tartarus",
  track: "achievement",
  level: 4,
  score: 4800,
  objective: "Reach the first biome clear state.",
  proof: ["Canonical output/output.mp4 video artifact.", "Steam achievement proof."],
  estimatedRuntimeMinutes: 18,
  suitability: "ranked",
  suitabilityScore: 86,
  reviewRequired: false,
  fairnessVerdict: "good",
  riskFlags: [],
  source: "fixture",
  signalSource: "steam-achievement"
};

const run: BenchmarkRun = {
  id: "run_handoff",
  taskId: task.id,
  competitor: "agent:handoff",
  competitorType: "agent",
  status: "queued",
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
  runtimeProvider: "local-sim",
  artifactName: "output.mp4",
  eventCount: 0
};

function session(): RuntimeControlSession {
  const playbook = buildAgentPlaybook({ run, task, generatedAt: "2026-06-14T00:00:00.000Z" });
  return {
    id: "control_handoff",
    runId: run.id,
    taskId: task.id,
    status: "active",
    actionSpace: playbook.control.actionSpace,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    expiresAt: "2026-06-14T00:15:00.000Z"
  };
}

function stream(status: LiveStreamSession["status"] = "live"): LiveStreamSession {
  return {
    id: "stream_handoff",
    runId: run.id,
    status,
    provider: "hls",
    title: "Handoff bridge stream",
    ingestUrl: `rtmp://localhost/steambench/${run.id}`,
    playbackUrl: `/streams/${run.id}.m3u8`,
    thumbnailUrl: `/streams/${run.id}.jpg`,
    viewerCount: 4,
    currentScene: "Runtime live",
    createdAt: "2026-06-14T00:00:03.000Z",
    startedAt: status === "live" || status === "ended" ? "2026-06-14T00:00:04.000Z" : undefined,
    endedAt: status === "ended" ? "2026-06-14T00:12:00.000Z" : undefined
  };
}

describe("agent runtime handoff", () => {
  it("requires a control session for virtual-controller runs", () => {
    const playbook = buildAgentPlaybook({ run, task, generatedAt: "2026-06-14T00:00:00.000Z" });
    const trace = buildAgentActionTrace({ run, task, events: [], generatedAt: "2026-06-14T00:00:00.000Z" });

    const handoff = buildAgentRuntimeHandoff({
      run,
      task,
      playbook,
      trace,
      controlSessions: [],
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(handoff).toMatchObject({
      schemaVersion: "steambench.agent-runtime-handoff.v1",
      status: "needs-control-session",
      control: {
        inputMode: "controller",
        transport: "virtual-controller",
        requiresControlSession: true
      },
      blockers: ["control_session_required"],
      endpoints: {
        playbook: `/api/runs/${run.id}/agent-playbook`,
        actionBatch: `/api/runs/${run.id}/action-batches`,
        controlSessions: `/api/runs/${run.id}/control-sessions`,
        livestreams: `/api/runs/${run.id}/livestreams`
      }
    });
    expect(handoff.recommendedActions.map((action) => action.id)).toEqual([
      "create-control-session",
      "open-livestream",
      "submit-action-batch",
      "run-agent-probe",
      "inspect-trace"
    ]);
    expect(handoff.recommendedActions.find((action) => action.id === "run-agent-probe")?.command).toContain("--execute=advance-probe");
  });

  it("marks a leased run with action coverage ready for submission", () => {
    const activeSession = session();
    const events: RuntimeRunEvent[] = [
      {
        id: "evt_observe",
        runId: run.id,
        type: "observe" as const,
        message: "Screen observed",
        createdAt: "2026-06-14T00:00:01.000Z",
        metadata: { step: 1 }
      },
      {
        id: "evt_act",
        runId: run.id,
        type: "act" as const,
        message: "Actions accepted",
        createdAt: "2026-06-14T00:00:02.000Z",
        metadata: { actionCount: 2, controlSessionId: activeSession.id }
      }
    ];
    const playbook = buildAgentPlaybook({ run, task, generatedAt: "2026-06-14T00:00:00.000Z" });
    const trace = buildAgentActionTrace({ run, task, events, generatedAt: "2026-06-14T00:00:00.000Z" });

    const handoff = buildAgentRuntimeHandoff({
      run,
      task,
      playbook,
      trace,
      controlSessions: [activeSession],
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(handoff.status).toBe("ready-for-submission");
    expect(handoff.control.activeSession).toMatchObject({
      id: activeSession.id,
      accessPacket: `/api/control-sessions/${activeSession.id}/access-packet`,
      bridgeManifest: `/api/control-sessions/${activeSession.id}/bridge-manifest`,
      executorReport: `/api/runs/${run.id}/controller-executor-reports`
    });
    expect(handoff.endpoints).toMatchObject({
      activeAccessPacket: `/api/control-sessions/${activeSession.id}/access-packet`,
      activeBridgeManifest: `/api/control-sessions/${activeSession.id}/bridge-manifest`,
      activeExecutorReport: `/api/runs/${run.id}/controller-executor-reports`
    });
    expect(handoff.trace.coverage.readyForSubmission).toBe(true);
    expect(handoff.recommendedActions.map((action) => action.id)).toEqual([
      "inspect-bridge-manifest",
      "submit-run",
      "inspect-trace"
    ]);
  });

  it("exposes active broadcast links when a livestream is attached", () => {
    const activeSession = session();
    const activeStream = stream("live");
    const playbook = buildAgentPlaybook({ run, task, generatedAt: "2026-06-14T00:00:00.000Z" });
    const trace = buildAgentActionTrace({ run, task, events: [], generatedAt: "2026-06-14T00:00:00.000Z" });

    const handoff = buildAgentRuntimeHandoff({
      run,
      task,
      playbook,
      trace,
      controlSessions: [activeSession],
      streams: [activeStream],
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(handoff.broadcast.activeStream).toMatchObject({
      id: activeStream.id,
      status: "live",
      playbackUrl: `/streams/${run.id}.m3u8`,
      detail: `/api/broadcasts/${activeStream.id}`,
      evidenceBundle: `/api/broadcasts/${activeStream.id}/evidence-bundle`,
      resultCertificate: `/api/broadcasts/${activeStream.id}/result-certificate`,
      statusEndpoint: `/api/livestreams/${activeStream.id}/status`
    });
    expect(handoff.endpoints).toMatchObject({
      activeBroadcast: `/api/broadcasts/${activeStream.id}`,
      activeBroadcastEvidenceBundle: `/api/broadcasts/${activeStream.id}/evidence-bundle`,
      activeBroadcastResultCertificate: `/api/broadcasts/${activeStream.id}/result-certificate`,
      activeLivestreamStatus: `/api/livestreams/${activeStream.id}/status`
    });
    expect(handoff.recommendedActions.map((action) => action.id)).toContain("inspect-broadcast");
    expect(handoff.recommendedActions.map((action) => action.id)).not.toContain("open-livestream");
  });
});
