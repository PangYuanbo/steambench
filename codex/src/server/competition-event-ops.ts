import type { BenchmarkSuite } from "../benchmark/suites";
import type { SeasonScope } from "../benchmark/standings";
import type { CompetitionEventEvidenceBundle, CompetitionEventEvidenceBundleSummary } from "./competition-event-evidence-bundle";
import type { CompetitionEventSummary } from "./competition-events";

export type CompetitionEventOpsAction = {
  id: string;
  label: string;
  priority: "high" | "medium" | "low";
  method: "GET" | "POST";
  endpoint: string;
  body?: Record<string, unknown>;
  reason: string;
};

export type CompetitionEventOpsReport = {
  schemaVersion: "steambench.competition-event-ops-report.v1";
  generatedAt: string;
  scope: SeasonScope;
  status: "needs-registration" | "needs-scheduling" | "needs-execution" | "needs-campaign-comparison" | "ready-to-share" | "monitoring";
  event: CompetitionEventSummary;
  evidence: CompetitionEventEvidenceBundleSummary;
  selectedSuite?: {
    id: string;
    title: string;
    status: BenchmarkSuite["status"];
    tier: BenchmarkSuite["tier"];
    taskCount: number;
    readinessScore: number;
  };
  totals: {
    registeredHumans: number;
    registeredAgents: number;
    registeredPairs: number;
    scheduledRaces: number;
    scoredRaces: number;
    readyRaceBundles: number;
    campaignComparisons: number;
    readyCampaignComparisons: number;
    checklistPasses: number;
    checklistTotal: number;
    readyForPublicShare: boolean;
  };
  gaps: {
    needsHumanRegistration: boolean;
    needsAgentRegistration: boolean;
    unscheduledPairs: number;
    unscoredRaces: number;
    unreadyRaceBundles: number;
    unreadyCampaignComparisons: number;
  };
  recommendedActions: CompetitionEventOpsAction[];
  links: {
    event: string;
    registrations: string;
    scheduleSuite: string;
    runSuite: string;
    runCampaignComparisonsLocal: string;
    evidenceBundle: string;
    resultCertificate: string;
  };
};

function reportStatus(input: {
  totals: CompetitionEventOpsReport["totals"];
  gaps: CompetitionEventOpsReport["gaps"];
}): CompetitionEventOpsReport["status"] {
  if (input.gaps.needsHumanRegistration || input.gaps.needsAgentRegistration || input.totals.registeredPairs === 0) return "needs-registration";
  if (input.gaps.unscheduledPairs > 0 || input.totals.scheduledRaces === 0) return "needs-scheduling";
  if (input.gaps.unscoredRaces > 0 || input.gaps.unreadyRaceBundles > 0) return "needs-execution";
  if (input.gaps.unreadyCampaignComparisons > 0) return "needs-campaign-comparison";
  if (input.totals.readyForPublicShare) return "ready-to-share";
  return "monitoring";
}

function buildActions(input: {
  scope: SeasonScope;
  status: CompetitionEventOpsReport["status"];
  selectedSuite?: CompetitionEventOpsReport["selectedSuite"];
  totals: CompetitionEventOpsReport["totals"];
  gaps: CompetitionEventOpsReport["gaps"];
}): CompetitionEventOpsAction[] {
  const actions: CompetitionEventOpsAction[] = [];
  if (input.status === "needs-registration") {
    actions.push({
      id: "inspect-registrations",
      label: "Inspect event registrations",
      priority: "high",
      method: "GET",
      endpoint: "/api/competition-events/registrations",
      reason: "The event needs at least one consented human and one active agent registration."
    });
  }

  if ((input.status === "needs-scheduling" || input.gaps.unscheduledPairs > 0) && input.selectedSuite) {
    actions.push({
      id: "schedule-suite",
      label: "Schedule suite races",
      priority: "high",
      method: "POST",
      endpoint: `/api/competition-events/${input.scope}/schedule-suite`,
      body: {
        suiteId: input.selectedSuite.id,
        reviewApproved: input.selectedSuite.status !== "ranked-ready",
        maxPairs: Math.min(100, Math.max(1, input.gaps.unscheduledPairs || input.totals.registeredPairs))
      },
      reason: `${input.gaps.unscheduledPairs || input.totals.registeredPairs} registered pair(s) need suite race scheduling.`
    });
  }

  if (input.status === "needs-execution" || input.gaps.unscoredRaces > 0 || input.gaps.unreadyRaceBundles > 0) {
    actions.push({
      id: "run-suite-local",
      label: "Run scheduled suite races",
      priority: "high",
      method: "POST",
      endpoint: `/api/competition-events/${input.scope}/run-suite`,
      body: {
        suiteId: input.selectedSuite?.id,
        maxRaces: Math.min(25, Math.max(1, input.gaps.unscoredRaces || input.totals.scheduledRaces))
      },
      reason: `${input.gaps.unscoredRaces || input.gaps.unreadyRaceBundles} scheduled suite race(s) still need scored evidence.`
    });
  }

  if (input.status === "needs-campaign-comparison" || input.gaps.unreadyCampaignComparisons > 0) {
    actions.push({
      id: "run-campaign-comparisons-local",
      label: "Run campaign comparisons",
      priority: "medium",
      method: "POST",
      endpoint: `/api/competition-events/${input.scope}/run-campaign-comparisons-local`,
      body: {
        maxPairs: Math.min(25, Math.max(1, input.totals.registeredPairs))
      },
      reason: `${input.gaps.unreadyCampaignComparisons} human-agent campaign comparison(s) need complete evidence.`
    });
  }

  actions.push({
    id: "inspect-event-certificate",
    label: "Inspect event certificate",
    priority: input.totals.readyForPublicShare ? "low" : "medium",
    method: "GET",
    endpoint: `/api/competition-events/${input.scope}/result-certificate`,
    reason: "Use the public certificate before sharing the event externally."
  });

  return actions;
}

export function buildCompetitionEventOpsReport(input: {
  scope: SeasonScope;
  event: CompetitionEventSummary;
  bundle: CompetitionEventEvidenceBundle;
  evidence: CompetitionEventEvidenceBundleSummary;
  selectedSuite?: BenchmarkSuite;
  generatedAt?: string;
}): CompetitionEventOpsReport {
  const selectedSuite = input.selectedSuite
    ? {
        id: input.selectedSuite.id,
        title: input.selectedSuite.title,
        status: input.selectedSuite.status,
        tier: input.selectedSuite.tier,
        taskCount: input.selectedSuite.taskCount,
        readinessScore: input.selectedSuite.readinessScore
      }
    : undefined;
  const totals: CompetitionEventOpsReport["totals"] = {
    registeredHumans: input.event.entrants.registeredHumans,
    registeredAgents: input.event.entrants.registeredAgents,
    registeredPairs: input.event.entrants.registeredPairs,
    scheduledRaces: input.evidence.scheduledRaces,
    scoredRaces: input.evidence.scoredRaces,
    readyRaceBundles: input.evidence.readyBundleCount,
    campaignComparisons: input.evidence.campaignComparisonCount,
    readyCampaignComparisons: input.evidence.campaignComparisonReadyCount,
    checklistPasses: input.evidence.checklistPasses,
    checklistTotal: input.evidence.checklistTotal,
    readyForPublicShare:
      input.evidence.checklistTotal > 0 &&
      input.evidence.checklistPasses === input.evidence.checklistTotal &&
      (input.evidence.allScheduledRacesScored || input.evidence.allCampaignComparisonsReady)
  };
  const gaps: CompetitionEventOpsReport["gaps"] = {
    needsHumanRegistration: totals.registeredHumans === 0,
    needsAgentRegistration: totals.registeredAgents === 0,
    unscheduledPairs: Math.max(0, totals.registeredPairs - totals.scheduledRaces),
    unscoredRaces: Math.max(0, totals.scheduledRaces - totals.scoredRaces),
    unreadyRaceBundles: Math.max(0, totals.scheduledRaces - totals.readyRaceBundles),
    unreadyCampaignComparisons: Math.max(0, totals.campaignComparisons - totals.readyCampaignComparisons)
  };
  const status = reportStatus({ totals, gaps });
  return {
    schemaVersion: "steambench.competition-event-ops-report.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    scope: input.scope,
    status,
    event: input.event,
    evidence: input.evidence,
    selectedSuite,
    totals,
    gaps,
    recommendedActions: buildActions({
      scope: input.scope,
      status,
      selectedSuite,
      totals,
      gaps
    }),
    links: {
      event: `/api/competition-events/${input.scope}`,
      registrations: "/api/competition-events/registrations",
      scheduleSuite: `/api/competition-events/${input.scope}/schedule-suite`,
      runSuite: `/api/competition-events/${input.scope}/run-suite`,
      runCampaignComparisonsLocal: `/api/competition-events/${input.scope}/run-campaign-comparisons-local`,
      evidenceBundle: `/api/competition-events/${input.scope}/evidence-bundle`,
      resultCertificate: `/api/competition-events/${input.scope}/result-certificate`
    }
  };
}
