import { buildSuiteRaceStandings, type SuiteRaceStandings } from "../benchmark/suite-standings";
import type { SeasonScope } from "../benchmark/standings";
import type { CompetitionEventSummary } from "./competition-events";
import type { HumanAgentComparisonEvidenceBundle } from "./human-agent-comparison-evidence-bundle";
import type { SuiteRaceEvidenceBundle } from "./suite-race-evidence-bundle";
import type { AgentProfile, BenchmarkSuiteRace, CompetitionEventRegistration, UserAccount } from "./store";

export type CompetitionEventEvidenceChecklistItem = {
  id: string;
  label: string;
  status: "pass" | "fail";
};

export type CompetitionEventResolvedRegistration = {
  registration: CompetitionEventRegistration;
  human?: UserAccount;
  agent?: AgentProfile;
};

export type CompetitionEventEvidenceBundle = {
  schemaVersion: "steambench.competition-event-evidence-bundle.v1";
  generatedAt: string;
  scope: SeasonScope;
  event: CompetitionEventSummary;
  registrations: CompetitionEventResolvedRegistration[];
  suiteRaces: Array<{
    race: BenchmarkSuiteRace;
    bundle?: SuiteRaceEvidenceBundle;
  }>;
  campaignComparisons: Array<{
    humanUserId: string;
    agentId: string;
    campaignId: string;
    bundle?: HumanAgentComparisonEvidenceBundle;
  }>;
  standings: SuiteRaceStandings;
  integrity: {
    registeredPairs: number;
    scheduledRaces: number;
    scoredRaces: number;
    bundleCount: number;
    campaignComparisonCount: number;
    campaignComparisonReadyCount: number;
    allScheduledRacesBundled: boolean;
    allScheduledRacesScored: boolean;
    allBundlesScoreboardReady: boolean;
    allCampaignComparisonsBundled: boolean;
    allCampaignComparisonsReady: boolean;
    checklist: CompetitionEventEvidenceChecklistItem[];
  };
};

export type CompetitionEventEvidenceBundleSummary = {
  scope: SeasonScope;
  status: CompetitionEventSummary["status"];
  registeredPairs: number;
  scheduledRaces: number;
  scoredRaces: number;
  bundleCount: number;
  readyBundleCount: number;
  campaignComparisonCount: number;
  campaignComparisonReadyCount: number;
  allCampaignComparisonsBundled: boolean;
  allCampaignComparisonsReady: boolean;
  allScheduledRacesBundled: boolean;
  allScheduledRacesScored: boolean;
  allBundlesScoreboardReady: boolean;
  checklistPasses: number;
  checklistTotal: number;
  generatedAt: string;
};

export function buildCompetitionEventEvidenceBundle(input: {
  scope: SeasonScope;
  event: CompetitionEventSummary;
  registrations: CompetitionEventResolvedRegistration[];
  suiteRaces: Array<{
    race: BenchmarkSuiteRace;
    bundle?: SuiteRaceEvidenceBundle;
  }>;
  campaignComparisons?: CompetitionEventEvidenceBundle["campaignComparisons"];
  generatedAt?: string;
}): CompetitionEventEvidenceBundle {
  const standings = buildSuiteRaceStandings(input.suiteRaces.map((entry) => entry.race));
  const scheduledRaces = input.suiteRaces.length;
  const bundleCount = input.suiteRaces.filter((entry) => entry.bundle !== undefined).length;
  const scoredRaces = input.suiteRaces.filter((entry) => entry.race.status === "scored").length;
  const allScheduledRacesBundled = scheduledRaces > 0 && bundleCount === scheduledRaces;
  const allScheduledRacesScored = scheduledRaces > 0 && scoredRaces === scheduledRaces;
  const allBundlesScoreboardReady = scheduledRaces > 0 &&
    input.suiteRaces.every((entry) => entry.bundle?.integrity.verdict === "scoreboard-ready");
  const campaignComparisons = input.campaignComparisons ?? [];
  const campaignComparisonCount = campaignComparisons.length;
  const campaignComparisonReadyCount = campaignComparisons.filter((entry) =>
    entry.bundle?.integrity.checklist.every((item) => item.status === "pass")
  ).length;
  const allCampaignComparisonsBundled = campaignComparisonCount > 0 &&
    campaignComparisons.every((entry) => entry.bundle !== undefined);
  const allCampaignComparisonsReady = campaignComparisonCount > 0 &&
    campaignComparisonReadyCount === campaignComparisonCount;
  const checklist: CompetitionEventEvidenceChecklistItem[] = [
    {
      id: "registered-pairs",
      label: "Event has at least one eligible registered pair",
      status: input.event.entrants.registeredPairs > 0 ? "pass" : "fail"
    },
    {
      id: "scheduled-races",
      label: "Event has scheduled suite races",
      status: scheduledRaces > 0 ? "pass" : "fail"
    },
    {
      id: "race-bundles",
      label: "Every scheduled suite race has an evidence bundle",
      status: allScheduledRacesBundled ? "pass" : "fail"
    },
    {
      id: "scored-races",
      label: "Every scheduled suite race is scored",
      status: allScheduledRacesScored ? "pass" : "fail"
    },
    {
      id: "scoreboard-ready",
      label: "Every suite race bundle is scoreboard-ready",
      status: allBundlesScoreboardReady ? "pass" : "fail"
    }
  ];
  if (campaignComparisonCount > 0) {
    checklist.push({
      id: "campaign-comparisons-ready",
      label: "Every event campaign comparison is scoreboard-ready",
      status: allCampaignComparisonsReady ? "pass" : "fail"
    });
  }

  return {
    schemaVersion: "steambench.competition-event-evidence-bundle.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    scope: input.scope,
    event: input.event,
    registrations: input.registrations,
    suiteRaces: input.suiteRaces,
    campaignComparisons,
    standings,
    integrity: {
      registeredPairs: input.event.entrants.registeredPairs,
      scheduledRaces,
      scoredRaces,
      bundleCount,
      campaignComparisonCount,
      campaignComparisonReadyCount,
      allScheduledRacesBundled,
      allScheduledRacesScored,
      allBundlesScoreboardReady,
      allCampaignComparisonsBundled,
      allCampaignComparisonsReady,
      checklist
    }
  };
}

export function summarizeCompetitionEventEvidenceBundle(bundle: CompetitionEventEvidenceBundle): CompetitionEventEvidenceBundleSummary {
  return {
    scope: bundle.scope,
    status: bundle.event.status,
    registeredPairs: bundle.integrity.registeredPairs,
    scheduledRaces: bundle.integrity.scheduledRaces,
    scoredRaces: bundle.integrity.scoredRaces,
    bundleCount: bundle.integrity.bundleCount,
    readyBundleCount: bundle.suiteRaces.filter((entry) => entry.bundle?.integrity.verdict === "scoreboard-ready").length,
    campaignComparisonCount: bundle.integrity.campaignComparisonCount,
    campaignComparisonReadyCount: bundle.integrity.campaignComparisonReadyCount,
    allCampaignComparisonsBundled: bundle.integrity.allCampaignComparisonsBundled,
    allCampaignComparisonsReady: bundle.integrity.allCampaignComparisonsReady,
    allScheduledRacesBundled: bundle.integrity.allScheduledRacesBundled,
    allScheduledRacesScored: bundle.integrity.allScheduledRacesScored,
    allBundlesScoreboardReady: bundle.integrity.allBundlesScoreboardReady,
    checklistPasses: bundle.integrity.checklist.filter((entry) => entry.status === "pass").length,
    checklistTotal: bundle.integrity.checklist.length,
    generatedAt: bundle.generatedAt
  };
}
