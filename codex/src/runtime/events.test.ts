import { describe, expect, it } from "vitest";
import { buildFixtureTasks } from "../benchmark/task-generator";
import { buildRuntimeRunPlan, buildSimulatedRuntimeEvents } from "./events";
import { buildRuntimeReadiness } from "./readiness";

describe("runtime event planning", () => {
  it("builds a Steam runtime plan with the canonical output artifact", () => {
    const task = buildFixtureTasks()[0];
    const plan = buildRuntimeRunPlan(task);

    expect(plan.appid).toBe(task.appid);
    expect(plan.targetArtifact).toBe("output.mp4");
    expect(plan.evidenceRequired).toContain("Steam achievement state for the linked SteamID");
    expect(plan.adapter.launchUri).toBe(`steam://run/${task.appid}`);
    expect(plan.adapter.readinessChecks.length).toBeGreaterThan(0);
    expect(plan.controlSurface).toBe(plan.adapter.inputMode);
  });

  it("creates an auditable simulated event chain for agent attempts", () => {
    const task = buildFixtureTasks()[0];
    const events = buildSimulatedRuntimeEvents("run_test", task);

    expect(events.map((event) => event.type)).toEqual(["plan", "launch", "observe", "act", "proof"]);
    expect(events.find((event) => event.type === "launch")?.metadata?.launchUri).toBe(`steam://run/${task.appid}`);
    expect(events.at(-1)?.metadata?.artifactName).toBe("output.mp4");
  });

  it("checks agent capabilities against task adapter requirements", () => {
    const task = buildFixtureTasks().find((entry) => entry.track === "capture")!;
    const blocked = buildRuntimeReadiness(task, {
      id: "agent_weak",
      userId: "usr_agent",
      handle: "weak-agent",
      displayName: "Weak Agent",
      provider: "local",
      runtimeProvider: "local-sim",
      command: "node scripts/runtime-worker.mjs",
      capabilities: ["keyboard-mouse", "screen-capture"],
      status: "active",
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z"
    });
    expect(blocked.ready).toBe(false);
    expect(blocked.missingCapabilities).toContain("output.mp4");
    expect(blocked.missingCapabilities).toContain("seeded-save");

    const ready = buildRuntimeReadiness(task, {
      id: "agent_ready",
      userId: "usr_agent",
      handle: "ready-agent",
      displayName: "Ready Agent",
      provider: "local",
      runtimeProvider: "local-sim",
      command: "node scripts/runtime-worker.mjs",
      capabilities: ["keyboard-mouse", "screen-capture", "seeded-save", "manual-review", "output.mp4"],
      status: "active",
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z"
    });
    expect(ready.ready).toBe(true);
    expect(ready.missingCapabilities).toEqual([]);
  });
});
