import { describe, expect, it } from "vitest";
import type { BenchmarkTask } from "../benchmark/types";
import type { StoreSnapshot, UserAccount } from "./store";
import { buildHumanProofOpsReport } from "./human-proof-ops";

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

function human(id: string, overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    id,
    handle: id,
    displayName: id,
    type: "human",
    createdAt: "2026-06-14T00:00:00.000Z",
    ...overrides
  };
}

function snapshot(users: UserAccount[]): StoreSnapshot {
  return {
    users,
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

describe("human proof ops report", () => {
  it("summarizes human Steam proof onboarding and ready submissions", () => {
    const users = [
      human("ready-human", {
        linkedSteamId: "76561198000000000",
        proofConsentAt: "2026-06-14T00:00:00.000Z"
      }),
      human("consent-human", {
        linkedSteamId: "76561198000000001"
      }),
      human("unlinked-human")
    ];

    const report = buildHumanProofOpsReport({
      snapshot: snapshot(users),
      tasks: [task],
      appid: 620,
      limit: 4,
      userLimit: 10,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report).toMatchObject({
      schemaVersion: "steambench.human-proof-ops-report.v1",
      status: "ready-to-submit",
      filters: {
        appid: 620,
        limit: 4,
        userLimit: 10
      },
      totals: {
        humans: 3,
        selectedHumans: 3,
        linked: 2,
        consented: 1,
        readyTickets: 1,
        consentRequired: 1,
        steamNotLinked: 1,
        readyTasks: 1
      }
    });
    expect(report.tickets.map((ticket) => ticket.status)).toEqual([
      "ready-to-submit",
      "consent-required",
      "steam-not-linked"
    ]);
    expect(report.tickets[0].nextTask?.id).toBe(task.id);
    expect(report.recommendedActions.map((action) => action.id)).toEqual([
      "submit-human-proof",
      "grant-proof-consent",
      "link-steam",
      "inspect-human-proof-plan"
    ]);
  });

  it("marks users complete after an existing scored run", () => {
    const user = human("scored-human", {
      linkedSteamId: "76561198000000000",
      proofConsentAt: "2026-06-14T00:00:00.000Z"
    });
    const store = snapshot([user]);
    store.runs.push({
      id: "run_scored",
      taskId: task.id,
      competitor: "human:scored-human",
      competitorType: "human",
      status: "scored",
      score: 4100,
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:01:00.000Z",
      runtimeProvider: "manual",
      artifactName: "output.mp4",
      eventCount: 2
    });

    const report = buildHumanProofOpsReport({
      snapshot: store,
      tasks: [task],
      appid: 620,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.status).toBe("scoreboard-covered");
    expect(report.tickets[0]).toMatchObject({
      status: "already-scored",
      readiness: "complete",
      plan: {
        totals: {
          alreadyScored: 1
        }
      }
    });
    expect(report.recommendedActions.map((action) => action.id)).toEqual(["inspect-human-proof-plan"]);
  });
});
