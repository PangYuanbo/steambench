import type { BenchmarkTask } from "../benchmark/types";
import { buildHumanSteamProofPlan, type HumanSteamProofPlan } from "./human-steam-proof-plan";
import type { StoreSnapshot, UserAccount } from "./store";

export type HumanProofOpsTicketStatus =
  | "ready-to-submit"
  | "steam-not-linked"
  | "consent-required"
  | "already-scored"
  | "no-human-tasks";

export type HumanProofOpsTicket = {
  user: Pick<UserAccount, "id" | "handle" | "displayName" | "linkedSteamId" | "proofConsentAt" | "proofConsentRevokedAt">;
  status: HumanProofOpsTicketStatus;
  readiness: "ready" | "blocked" | "complete";
  plan: Pick<HumanSteamProofPlan, "schemaVersion" | "ready" | "steamid" | "totals">;
  nextTask?: Pick<BenchmarkTask, "id" | "appid" | "gameName" | "title" | "track" | "level">;
  blockers: string[];
  links: {
    proofPlan: string;
    steamLink: string;
    proofConsent: string;
    submitProof: string;
    proofReport?: string;
    comparison?: string;
  };
};

export type HumanProofOpsReport = {
  schemaVersion: "steambench.human-proof-ops-report.v1";
  generatedAt: string;
  status: "ready-to-submit" | "needs-human-onboarding" | "scoreboard-covered" | "idle";
  filters: {
    appid?: number;
    limit: number;
    userLimit: number;
  };
  totals: {
    humans: number;
    selectedHumans: number;
    linked: number;
    consented: number;
    readyTickets: number;
    consentRequired: number;
    steamNotLinked: number;
    alreadyScored: number;
    noHumanTasks: number;
    readyTasks: number;
    alreadyScoredTasks: number;
  };
  tickets: HumanProofOpsTicket[];
  recommendedActions: Array<{
    id: "submit-human-proof" | "grant-proof-consent" | "link-steam" | "inspect-human-proof-plan";
    label: string;
    priority: "high" | "medium" | "low";
    method: "GET" | "POST";
    endpoint: string;
    body?: Record<string, unknown>;
    reason: string;
  }>;
  links: {
    users: "/api/users";
    standings: "/api/standings";
    proofReview: "/api/proofs/review";
  };
};

function ticketStatus(plan: HumanSteamProofPlan): HumanProofOpsTicketStatus {
  if (plan.totals.ready > 0) return "ready-to-submit";
  if (!plan.user.linkedSteamId) return "steam-not-linked";
  if (!plan.user.proofConsentAt) return "consent-required";
  if (plan.totals.alreadyScored > 0) return "already-scored";
  return "no-human-tasks";
}

function readiness(status: HumanProofOpsTicketStatus): HumanProofOpsTicket["readiness"] {
  if (status === "ready-to-submit") return "ready";
  if (status === "already-scored") return "complete";
  return "blocked";
}

function blockersFor(status: HumanProofOpsTicketStatus): string[] {
  if (status === "steam-not-linked") return ["steam_not_linked"];
  if (status === "consent-required") return ["steam_proof_consent_required"];
  if (status === "no-human-tasks") return ["no_ready_human_tasks"];
  return [];
}

function reportStatus(totals: HumanProofOpsReport["totals"]): HumanProofOpsReport["status"] {
  if (totals.readyTickets > 0) return "ready-to-submit";
  if (totals.steamNotLinked + totals.consentRequired > 0) return "needs-human-onboarding";
  if (totals.alreadyScored > 0) return "scoreboard-covered";
  return "idle";
}

function recommendedActions(tickets: HumanProofOpsTicket[]): HumanProofOpsReport["recommendedActions"] {
  const actions: HumanProofOpsReport["recommendedActions"] = [];
  const ready = tickets.find((ticket) => ticket.status === "ready-to-submit");
  if (ready) {
    actions.push({
      id: "submit-human-proof",
      label: "Submit next human proof",
      priority: "high",
      method: "POST",
      endpoint: ready.links.submitProof,
      body: ready.nextTask ? { taskId: ready.nextTask.id } : undefined,
      reason: `${ready.user.handle} has ${ready.plan.totals.ready} ready proof submission(s).`
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
      reason: `${unlinked.user.handle} must link Steam before human benchmark proof can be submitted.`
    });
  }

  const ticket = tickets[0];
  if (ticket) {
    actions.push({
      id: "inspect-human-proof-plan",
      label: "Inspect human proof plan",
      priority: "low",
      method: "GET",
      endpoint: ticket.links.proofPlan,
      reason: "Review per-task proof readiness before creating manual or Steam achievement submissions."
    });
  }

  return actions;
}

export function buildHumanProofOpsReport(input: {
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
  appid?: number;
  limit?: number;
  userLimit?: number;
  campaignId?: string;
  generatedAt?: string;
}): HumanProofOpsReport {
  const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 8)));
  const userLimit = Math.max(1, Math.min(200, Math.floor(input.userLimit ?? 50)));
  const tasks = input.appid === undefined ? input.tasks : input.tasks.filter((task) => task.appid === input.appid);
  const humans = input.snapshot.users.filter((user) => user.type === "human");
  const selectedHumans = humans.slice(0, userLimit);
  const tickets = selectedHumans.map((user): HumanProofOpsTicket => {
    const plan = buildHumanSteamProofPlan({
      user,
      snapshot: input.snapshot,
      tasks,
      limit
    });
    const status = ticketStatus(plan);
    const nextItem = plan.items.find((item) => item.status === "ready");
    const proofReportQuery = input.appid === undefined ? undefined : `?appid=${input.appid}`;
    const comparisonQuery = input.campaignId === undefined
      ? undefined
      : `?humanUserId=${encodeURIComponent(user.id)}&campaignId=${encodeURIComponent(input.campaignId)}`;
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
      plan: {
        schemaVersion: plan.schemaVersion,
        ready: plan.ready,
        steamid: plan.steamid,
        totals: plan.totals
      },
      nextTask: nextItem
        ? {
            id: nextItem.task.id,
            appid: nextItem.task.appid,
            gameName: nextItem.task.gameName,
            title: nextItem.task.title,
            track: nextItem.task.track,
            level: nextItem.task.level
          }
        : undefined,
      blockers: blockersFor(status),
      links: {
        proofPlan: `/api/users/${user.id}/steam-proof-plan?limit=${limit}`,
        steamLink: `/api/users/${user.id}/steam`,
        proofConsent: `/api/users/${user.id}/steam-proof-consent`,
        submitProof: `/api/users/${user.id}/steam-proof-submissions`,
        proofReport: proofReportQuery ? `/api/users/${user.id}/steam-proof-report${proofReportQuery}` : undefined,
        comparison: comparisonQuery ? `/api/comparisons/human-agent${comparisonQuery}` : undefined
      }
    };
  });
  const totals = {
    humans: humans.length,
    selectedHumans: selectedHumans.length,
    linked: selectedHumans.filter((user) => Boolean(user.linkedSteamId)).length,
    consented: selectedHumans.filter((user) => Boolean(user.proofConsentAt)).length,
    readyTickets: tickets.filter((ticket) => ticket.status === "ready-to-submit").length,
    consentRequired: tickets.filter((ticket) => ticket.status === "consent-required").length,
    steamNotLinked: tickets.filter((ticket) => ticket.status === "steam-not-linked").length,
    alreadyScored: tickets.filter((ticket) => ticket.status === "already-scored").length,
    noHumanTasks: tickets.filter((ticket) => ticket.status === "no-human-tasks").length,
    readyTasks: tickets.reduce((total, ticket) => total + ticket.plan.totals.ready, 0),
    alreadyScoredTasks: tickets.reduce((total, ticket) => total + ticket.plan.totals.alreadyScored, 0)
  };

  return {
    schemaVersion: "steambench.human-proof-ops-report.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: reportStatus(totals),
    filters: {
      appid: input.appid,
      limit,
      userLimit
    },
    totals,
    tickets,
    recommendedActions: recommendedActions(tickets),
    links: {
      users: "/api/users",
      standings: "/api/standings",
      proofReview: "/api/proofs/review"
    }
  };
}
