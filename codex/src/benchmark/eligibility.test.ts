import { describe, expect, it } from "vitest";
import { buildRuntimeReadiness } from "../runtime/readiness";
import type { AgentProfile, UserAccount } from "../server/store";
import { buildRaceEligibility } from "./eligibility";
import { buildTaskReview } from "./task-review";
import { buildFixtureTasks } from "./task-generator";

const user: UserAccount = {
  id: "usr_ready",
  handle: "human-ready",
  displayName: "Human Ready",
  type: "human",
  createdAt: "2026-06-14T00:00:00.000Z",
  linkedSteamId: "76561198000000000",
  proofConsentAt: "2026-06-14T00:00:00.000Z"
};

const agent: AgentProfile = {
  id: "agent_ready",
  userId: "usr_agent",
  handle: "agent-ready",
  displayName: "Agent Ready",
  provider: "local",
  runtimeProvider: "local-sim",
  command: "node scripts/runtime-worker.mjs",
  capabilities: ["keyboard-mouse", "controller", "turn-based-actions", "screen-capture", "stats-screen", "action-log", "seeded-save", "manual-review", "output.mp4"],
  status: "active",
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z"
};

describe("race eligibility", () => {
  it("marks a linked human and capable active agent ready for ranked tasks", () => {
    const task = buildFixtureTasks().find((entry) => entry.id === "620:ACH.SAVE_CUBE")!;
    const eligibility = buildRaceEligibility({
      task,
      review: buildTaskReview(task),
      human: user,
      agent,
      agentReadiness: buildRuntimeReadiness(task, agent)
    });

    expect(eligibility).toMatchObject({
      status: "ready",
      ready: true,
      proofRequirements: ["steam-achievement", "canonical-artifact"],
      human: {
        ready: true,
        steamLinked: true,
        proofConsent: true
      },
      agent: {
        ready: true,
        missingCapabilities: []
      }
    });
  });

  it("blocks races when Steam proof or agent capabilities are missing", () => {
    const task = buildFixtureTasks().find((entry) => entry.id === "620:CAP.CHAMBER_01_90S")!;
    const unlinkedUser = { ...user, id: "usr_unlinked", linkedSteamId: undefined };
    const weakAgent = { ...agent, id: "agent_weak", capabilities: ["keyboard-mouse"] };
    const eligibility = buildRaceEligibility({
      task,
      review: buildTaskReview(task),
      human: unlinkedUser,
      agent: weakAgent,
      agentReadiness: buildRuntimeReadiness(task, weakAgent)
    });

    expect(eligibility.status).toBe("blocked");
    expect(eligibility.blockers).toContain("steam_not_linked");
    expect(eligibility.blockers).toContain("agent_missing_capabilities");
    expect(eligibility.agent.missingCapabilities).toContain("screen-capture");
  });

  it("blocks linked humans until Steam proof consent is explicit", () => {
    const task = buildFixtureTasks().find((entry) => entry.id === "620:ACH.SAVE_CUBE")!;
    const unconsentedUser = { ...user, id: "usr_unconsented", proofConsentAt: undefined };
    const eligibility = buildRaceEligibility({
      task,
      review: buildTaskReview(task),
      human: unconsentedUser,
      agent,
      agentReadiness: buildRuntimeReadiness(task, agent)
    });

    expect(eligibility.status).toBe("blocked");
    expect(eligibility.human).toMatchObject({
      steamLinked: true,
      proofConsent: false,
      ready: false
    });
    expect(eligibility.blockers).toContain("steam_proof_consent_required");
  });

  it("keeps review-required controlled tasks out of automatic match creation", () => {
    const task = buildFixtureTasks().find((entry) => entry.id === "646570:LDRB.SEED_A20_SCORE")!;
    const eligibility = buildRaceEligibility({
      task,
      review: buildTaskReview(task),
      human: user,
      agent,
      agentReadiness: buildRuntimeReadiness(task, agent)
    });

    expect(eligibility.status).toBe("controlled");
    expect(eligibility.ready).toBe(false);
    expect(eligibility.task.reviewDecision).toBe("review-required");
    expect(eligibility.controls.join(" ")).toContain("Snapshot leaderboard rules");
    expect(eligibility.proofRequirements).toEqual(["manual-review", "canonical-artifact"]);
  });
});
