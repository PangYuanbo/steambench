import { describe, expect, it } from "vitest";
import type { CompetitionEventRegistration, StoreSnapshot, UserAccount } from "./store";
import { buildHumanOnboardingOpsReport } from "./human-onboarding-ops";

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

function registration(input: {
  id: string;
  participantId: string;
  status?: CompetitionEventRegistration["status"];
}): CompetitionEventRegistration {
  return {
    id: input.id,
    eventScope: "weekly",
    participantType: "human",
    participantId: input.participantId,
    status: input.status ?? "registered",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:01:00.000Z"
  };
}

function snapshot(users: UserAccount[], eventRegistrations: CompetitionEventRegistration[] = []): StoreSnapshot {
  return {
    users,
    agents: [],
    matches: [],
    challenges: [],
    suiteRaces: [],
    agentCampaigns: [],
    gameCoverageRuns: [],
    eventRegistrations,
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

describe("human onboarding ops report", () => {
  it("surfaces the first platform registration action when no humans exist", () => {
    const report = buildHumanOnboardingOpsReport({
      snapshot: snapshot([]),
      scope: "weekly",
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report).toMatchObject({
      schemaVersion: "steambench.human-onboarding-ops-report.v1",
      status: "idle",
      totals: {
        humans: 0,
        registeredHumans: 0
      }
    });
    expect(report.recommendedActions.map((action) => action.id)).toEqual([
      "create-human",
      "inspect-event-registrations",
      "inspect-human-proof-ops"
    ]);
  });

  it("summarizes Steam-linked onboarding gates before event registration", () => {
    const users = [
      human("registered-human", {
        linkedSteamId: "76561198000000000",
        proofConsentAt: "2026-06-14T00:00:00.000Z"
      }),
      human("ready-human", {
        linkedSteamId: "76561198000000001",
        proofConsentAt: "2026-06-14T00:00:00.000Z"
      }),
      human("consent-human", {
        linkedSteamId: "76561198000000002"
      }),
      human("unlinked-human")
    ];
    const report = buildHumanOnboardingOpsReport({
      snapshot: snapshot(users, [registration({ id: "reg_weekly", participantId: "registered-human" })]),
      scope: "weekly",
      limit: 10,
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report).toMatchObject({
      status: "ready-to-register",
      filters: {
        scope: "weekly",
        limit: 10
      },
      totals: {
        humans: 4,
        selectedHumans: 4,
        linked: 3,
        consented: 2,
        registeredHumans: 1,
        readyForRegistration: 1,
        consentRequired: 1,
        steamNotLinked: 1
      }
    });
    expect(report.tickets.map((ticket) => ticket.status)).toEqual([
      "event-registered",
      "ready-for-event-registration",
      "consent-required",
      "steam-not-linked"
    ]);
    expect(report.recommendedActions.map((action) => action.id)).toEqual([
      "register-event",
      "grant-proof-consent",
      "link-steam",
      "inspect-event-registrations",
      "inspect-human-proof-ops"
    ]);
    expect(report.recommendedActions[0]).toMatchObject({
      endpoint: "/api/competition-events/weekly/register",
      body: {
        participantType: "human",
        participantId: "ready-human"
      }
    });
  });

  it("marks an event covered when selected humans are already registered", () => {
    const users = [
      human("registered-human", {
        linkedSteamId: "76561198000000000",
        proofConsentAt: "2026-06-14T00:00:00.000Z"
      })
    ];
    const report = buildHumanOnboardingOpsReport({
      snapshot: snapshot(users, [registration({ id: "reg_weekly", participantId: "registered-human" })]),
      scope: "weekly",
      generatedAt: "2026-06-14T00:00:00.000Z"
    });

    expect(report.status).toBe("event-covered");
    expect(report.tickets[0]).toMatchObject({
      status: "event-registered",
      readiness: "complete",
      registration: {
        id: "reg_weekly",
        eventScope: "weekly",
        status: "registered"
      }
    });
  });
});
