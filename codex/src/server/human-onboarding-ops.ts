import type { SeasonScope } from "../benchmark/standings";
import type { CompetitionEventRegistration, StoreSnapshot, UserAccount } from "./store";

export type HumanOnboardingOpsTicketStatus =
  | "event-registered"
  | "ready-for-event-registration"
  | "consent-required"
  | "steam-not-linked";

export type HumanOnboardingOpsTicket = {
  user: Pick<UserAccount, "id" | "handle" | "displayName" | "linkedSteamId" | "proofConsentAt" | "proofConsentRevokedAt">;
  status: HumanOnboardingOpsTicketStatus;
  readiness: "ready" | "blocked" | "complete";
  registration?: Pick<CompetitionEventRegistration, "id" | "eventScope" | "status" | "updatedAt" | "notes">;
  blockers: string[];
  links: {
    profile: string;
    steamLink: string;
    proofConsent: string;
    proofPlan: string;
    eventRegistration: string;
    eventRegistrations: "/api/competition-events/registrations";
    humanProofOps: "/api/human-proof/ops-report";
  };
};

export type HumanOnboardingOpsReport = {
  schemaVersion: "steambench.human-onboarding-ops-report.v1";
  generatedAt: string;
  status: "ready-to-register" | "needs-human-onboarding" | "event-covered" | "idle";
  filters: {
    scope: SeasonScope;
    limit: number;
  };
  totals: {
    humans: number;
    selectedHumans: number;
    linked: number;
    consented: number;
    registeredHumans: number;
    readyForRegistration: number;
    consentRequired: number;
    steamNotLinked: number;
  };
  tickets: HumanOnboardingOpsTicket[];
  recommendedActions: Array<{
    id: "create-human" | "link-steam" | "grant-proof-consent" | "register-event" | "inspect-event-registrations" | "inspect-human-proof-ops";
    label: string;
    priority: "high" | "medium" | "low";
    method: "GET" | "POST";
    endpoint: string;
    body?: Record<string, unknown>;
    reason: string;
  }>;
  links: {
    createHuman: "/api/users";
    eventRegistrations: "/api/competition-events/registrations";
    humanProofOps: "/api/human-proof/ops-report";
  };
};

function activeHumanRegistration(
  user: UserAccount,
  registrations: CompetitionEventRegistration[],
  scope: SeasonScope
): CompetitionEventRegistration | undefined {
  return registrations.find(
    (registration) =>
      registration.eventScope === scope &&
      registration.participantType === "human" &&
      registration.participantId === user.id &&
      registration.status === "registered"
  );
}

function ticketStatus(user: UserAccount, registration: CompetitionEventRegistration | undefined): HumanOnboardingOpsTicketStatus {
  if (registration) return "event-registered";
  if (!user.linkedSteamId) return "steam-not-linked";
  if (!user.proofConsentAt) return "consent-required";
  return "ready-for-event-registration";
}

function readiness(status: HumanOnboardingOpsTicketStatus): HumanOnboardingOpsTicket["readiness"] {
  if (status === "event-registered") return "complete";
  if (status === "ready-for-event-registration") return "ready";
  return "blocked";
}

function blockersFor(status: HumanOnboardingOpsTicketStatus): string[] {
  if (status === "steam-not-linked") return ["steam_not_linked"];
  if (status === "consent-required") return ["steam_proof_consent_required"];
  return [];
}

function reportStatus(totals: HumanOnboardingOpsReport["totals"]): HumanOnboardingOpsReport["status"] {
  if (totals.readyForRegistration > 0) return "ready-to-register";
  if (totals.steamNotLinked + totals.consentRequired > 0) return "needs-human-onboarding";
  if (totals.registeredHumans > 0) return "event-covered";
  return "idle";
}

function recommendedActions(
  tickets: HumanOnboardingOpsTicket[],
  totals: HumanOnboardingOpsReport["totals"],
  scope: SeasonScope
): HumanOnboardingOpsReport["recommendedActions"] {
  const actions: HumanOnboardingOpsReport["recommendedActions"] = [];
  const ready = tickets.find((ticket) => ticket.status === "ready-for-event-registration");
  if (ready) {
    actions.push({
      id: "register-event",
      label: "Register human for event",
      priority: "high",
      method: "POST",
      endpoint: ready.links.eventRegistration,
      body: {
        participantType: "human",
        participantId: ready.user.id
      },
      reason: `${ready.user.handle} is Steam-linked and consented for ${scope} event registration.`
    });
  }

  const consent = tickets.find((ticket) => ticket.status === "consent-required");
  if (consent) {
    actions.push({
      id: "grant-proof-consent",
      label: "Grant Steam proof consent",
      priority: actions.length === 0 ? "high" : "medium",
      method: "POST",
      endpoint: consent.links.proofConsent,
      body: { consented: true },
      reason: `${consent.user.handle} linked Steam but has not opted into public benchmark proof.`
    });
  }

  const unlinked = tickets.find((ticket) => ticket.status === "steam-not-linked");
  if (unlinked) {
    actions.push({
      id: "link-steam",
      label: "Link Steam account",
      priority: actions.length === 0 ? "high" : "medium",
      method: "POST",
      endpoint: unlinked.links.steamLink,
      reason: `${unlinked.user.handle} needs a linked SteamID before event registration.`
    });
  }

  if (totals.humans === 0) {
    actions.push({
      id: "create-human",
      label: "Create human competitor",
      priority: "high",
      method: "POST",
      endpoint: "/api/users",
      body: { type: "human" },
      reason: "No human competitors exist yet."
    });
  }

  actions.push({
    id: "inspect-event-registrations",
    label: "Inspect event registrations",
    priority: "low",
    method: "GET",
    endpoint: "/api/competition-events/registrations",
    reason: "Review explicit public event opt-ins before scheduling races."
  });
  actions.push({
    id: "inspect-human-proof-ops",
    label: "Inspect human proof ops",
    priority: "low",
    method: "GET",
    endpoint: "/api/human-proof/ops-report",
    reason: "Check proof submission readiness after humans are linked and consented."
  });
  return actions;
}

export function buildHumanOnboardingOpsReport(input: {
  snapshot: StoreSnapshot;
  scope?: SeasonScope;
  limit?: number;
  generatedAt?: string;
}): HumanOnboardingOpsReport {
  const scope = input.scope ?? "all";
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
  const humans = input.snapshot.users.filter((user) => user.type === "human");
  const selectedHumans = humans.slice(0, limit);
  const tickets = selectedHumans.map((user): HumanOnboardingOpsTicket => {
    const registration = activeHumanRegistration(user, input.snapshot.eventRegistrations, scope);
    const status = ticketStatus(user, registration);
    return {
      user: {
        id: user.id,
        handle: user.handle,
        displayName: user.displayName,
        linkedSteamId: user.linkedSteamId,
        proofConsentAt: user.proofConsentAt,
        proofConsentRevokedAt: user.proofConsentRevokedAt
      },
      status,
      readiness: readiness(status),
      registration: registration
        ? {
            id: registration.id,
            eventScope: registration.eventScope,
            status: registration.status,
            updatedAt: registration.updatedAt,
            notes: registration.notes
          }
        : undefined,
      blockers: blockersFor(status),
      links: {
        profile: `/api/competitors/human/${encodeURIComponent(user.id)}/profile`,
        steamLink: `/api/users/${encodeURIComponent(user.id)}/steam`,
        proofConsent: `/api/users/${encodeURIComponent(user.id)}/steam-proof-consent`,
        proofPlan: `/api/users/${encodeURIComponent(user.id)}/steam-proof-plan`,
        eventRegistration: `/api/competition-events/${scope}/register`,
        eventRegistrations: "/api/competition-events/registrations",
        humanProofOps: "/api/human-proof/ops-report"
      }
    };
  });
  const scopedRegisteredHumanIds = new Set(
    input.snapshot.eventRegistrations
      .filter((registration) => registration.eventScope === scope && registration.participantType === "human" && registration.status === "registered")
      .map((registration) => registration.participantId)
  );
  const totals = {
    humans: humans.length,
    selectedHumans: selectedHumans.length,
    linked: selectedHumans.filter((user) => Boolean(user.linkedSteamId)).length,
    consented: selectedHumans.filter((user) => Boolean(user.proofConsentAt)).length,
    registeredHumans: selectedHumans.filter((user) => scopedRegisteredHumanIds.has(user.id)).length,
    readyForRegistration: tickets.filter((ticket) => ticket.status === "ready-for-event-registration").length,
    consentRequired: tickets.filter((ticket) => ticket.status === "consent-required").length,
    steamNotLinked: tickets.filter((ticket) => ticket.status === "steam-not-linked").length
  };

  return {
    schemaVersion: "steambench.human-onboarding-ops-report.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: reportStatus(totals),
    filters: {
      scope,
      limit
    },
    totals,
    tickets,
    recommendedActions: recommendedActions(tickets, totals, scope),
    links: {
      createHuman: "/api/users",
      eventRegistrations: "/api/competition-events/registrations",
      humanProofOps: "/api/human-proof/ops-report"
    }
  };
}
