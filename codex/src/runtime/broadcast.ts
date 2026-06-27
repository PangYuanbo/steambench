import type { BenchmarkTask } from "../benchmark/types";
import type { RuntimeRunEvent } from "./events";
import type { BenchmarkRun, LiveStreamSession, RunArtifact, RunProof } from "../server/store";

export type BroadcastTimelineItem = {
  id: string;
  at: string;
  label: string;
  eventType: RuntimeRunEvent["type"];
  message: string;
  importance: "low" | "normal" | "high";
  metadata?: RuntimeRunEvent["metadata"];
};

export type BroadcastPayload = {
  stream: LiveStreamSession;
  run: BenchmarkRun;
  task: BenchmarkTask;
  timeline: BroadcastTimelineItem[];
  artifacts: RunArtifact[];
  proofs: RunProof[];
  scoreboardReady: boolean;
};

const importantEvents = new Set<RuntimeRunEvent["type"]>(["launch", "checkpoint", "proof", "artifact", "score", "error"]);

export function buildBroadcastTimeline(events: RuntimeRunEvent[]): BroadcastTimelineItem[] {
  return events
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((event, index) => ({
      id: event.id,
      at: event.createdAt,
      label: `${String(index + 1).padStart(2, "0")} · ${event.type}`,
      eventType: event.type,
      message: event.message,
      importance: event.type === "error" ? "high" : importantEvents.has(event.type) ? "normal" : "low",
      metadata: event.metadata
    }));
}

export function buildBroadcastPayload(input: {
  stream: LiveStreamSession;
  run: BenchmarkRun;
  task: BenchmarkTask;
  events: RuntimeRunEvent[];
  artifacts: RunArtifact[];
  proofs: RunProof[];
}): BroadcastPayload {
  return {
    stream: input.stream,
    run: input.run,
    task: input.task,
    timeline: buildBroadcastTimeline(input.events),
    artifacts: input.artifacts,
    proofs: input.proofs,
    scoreboardReady: input.run.status === "scored"
  };
}
