import type { BenchmarkBlueprint } from "./benchmark-blueprint";
import type { GameCoveragePlan } from "./game-coverage-plan";
import type { SteamAchievementBenchmarkLadder } from "./steam-achievement-ladder";
import type { SteamAppDiscoveryCandidate } from "./store";

export type SteamAppOnboardingStageId = "discovery" | "achievement-ladder" | "task-publication" | "coverage" | "competition";
export type SteamAppOnboardingStageStatus = "complete" | "ready" | "blocked" | "pending";

export type SteamAppOnboardingStage = {
  id: SteamAppOnboardingStageId;
  label: string;
  status: SteamAppOnboardingStageStatus;
  summary: string;
  metrics: Record<string, string | number | boolean>;
  action: {
    label: string;
    method: "GET" | "POST";
    endpoint: string;
  };
};

export type SteamAppOnboardingPipeline = {
  schemaVersion: "steambench.steam-app-onboarding.v1";
  generatedAt: string;
  appid: number;
  gameName: string;
  status: "competition-ready" | "coverage-ready" | "publication-ready" | "import-ready" | "discovery-needed";
  readinessScore: number;
  stages: SteamAppOnboardingStage[];
  nextActions: string[];
  links: {
    discovery: string;
    achievementLadder: string;
    importRecommended: string;
    publishCandidates: string;
    coveragePlan: string;
    runCoverageLocal: string;
    runOnboardingLocal: string;
    benchmarkBlueprint: string;
    standings: string;
  };
};

function stageStatusComplete(condition: boolean, readyCondition = false): SteamAppOnboardingStageStatus {
  if (condition) return "complete";
  if (readyCondition) return "ready";
  return "pending";
}

function overallStatus(input: {
  discovery?: SteamAppDiscoveryCandidate;
  ladder: SteamAchievementBenchmarkLadder;
  blueprint: BenchmarkBlueprint;
  coveragePlan: GameCoveragePlan;
}): SteamAppOnboardingPipeline["status"] {
  if (input.blueprint.competitionPlan.humanAgentRaceReady && input.coveragePlan.totals.fullyCoveredTasks > 0) return "competition-ready";
  if (input.coveragePlan.totals.readyHumanActions + input.coveragePlan.totals.readyAgentActions > 0) return "coverage-ready";
  if (input.blueprint.reviewPlan.rankedReadyTasks > 0 || input.blueprint.importPlan.importedAchievementTasks > 0) return "publication-ready";
  if (input.ladder.totals.recommendedImports > 0 || input.blueprint.importPlan.canImportNow) return "import-ready";
  if (!input.discovery && input.ladder.totals.achievements === 0) return "discovery-needed";
  return "publication-ready";
}

export function buildSteamAppOnboardingPipeline(input: {
  discovery?: SteamAppDiscoveryCandidate;
  ladder: SteamAchievementBenchmarkLadder;
  blueprint: BenchmarkBlueprint;
  coveragePlan: GameCoveragePlan;
  generatedAt?: string;
}): SteamAppOnboardingPipeline {
  const appid = input.blueprint.appid;
  const links = {
    discovery: "/api/steam/apps/discovery",
    achievementLadder: `/api/steam/apps/${appid}/achievement-ladder`,
    importRecommended: `/api/steam/apps/${appid}/achievement-ladder/import-recommended`,
    publishCandidates: `/api/steam/apps/${appid}/publish-candidates`,
    coveragePlan: `/api/games/${appid}/coverage-plan`,
    runCoverageLocal: `/api/games/${appid}/coverage-plan/run-local`,
    runOnboardingLocal: `/api/steam/apps/${appid}/onboarding/run-local`,
    benchmarkBlueprint: `/api/games/${appid}/benchmark-blueprint`,
    standings: `/api/games/${appid}/standings`
  };
  const stages: SteamAppOnboardingStage[] = [
    {
      id: "discovery",
      label: "Steam app discovery",
      status: input.discovery ? "complete" : "ready",
      summary: input.discovery
        ? `${input.discovery.name} is ${input.discovery.status} with ${input.discovery.benchmarkFit}/100 benchmark fit.`
        : "No stored discovery candidate yet; curated catalog or manual AppID can still proceed.",
      metrics: {
        discovered: Boolean(input.discovery),
        status: input.discovery?.status ?? "curated-or-manual",
        benchmarkFit: input.discovery?.benchmarkFit ?? input.blueprint.game.benchmarkFit,
        harnessRisk: input.discovery?.harnessRisk ?? input.blueprint.game.harnessRisk
      },
      action: {
        label: "Discover Steam app",
        method: "POST",
        endpoint: "/api/steam/apps/discover"
      }
    },
    {
      id: "achievement-ladder",
      label: "Achievement ladder",
      status: stageStatusComplete(input.ladder.totals.active > 0, input.ladder.totals.recommendedImports > 0),
      summary: `${input.ladder.totals.achievements} achievements mapped into benchmark bands; ${input.ladder.totals.recommendedImports} import recommendation(s).`,
      metrics: {
        achievements: input.ladder.totals.achievements,
        active: input.ladder.totals.active,
        new: input.ladder.totals.new,
        recommendedImports: input.ladder.totals.recommendedImports
      },
      action: {
        label: "Import recommended",
        method: "POST",
        endpoint: links.importRecommended
      }
    },
    {
      id: "task-publication",
      label: "Task publication",
      status: stageStatusComplete(input.blueprint.importPlan.importedAchievementTasks > 0, input.blueprint.importPlan.canImportNow),
      summary: `${input.blueprint.importPlan.importedAchievementTasks} achievement task(s) imported; ${input.blueprint.reviewPlan.rankedReadyTasks} ranked-ready task(s).`,
      metrics: {
        importedAchievementTasks: input.blueprint.importPlan.importedAchievementTasks,
        rankedReadyTasks: input.blueprint.reviewPlan.rankedReadyTasks,
        reviewRequiredTasks: input.blueprint.reviewPlan.reviewRequiredTasks,
        rejectedTasks: input.blueprint.reviewPlan.rejectedTasks
      },
      action: {
        label: "Publish candidates",
        method: "POST",
        endpoint: links.publishCandidates
      }
    },
    {
      id: "coverage",
      label: "Human and agent coverage",
      status: stageStatusComplete(
        input.coveragePlan.totals.fullyCoveredTasks > 0,
        input.coveragePlan.totals.readyHumanActions + input.coveragePlan.totals.readyAgentActions > 0
      ),
      summary: `${input.coveragePlan.totals.humanCoveredTasks} human-covered and ${input.coveragePlan.totals.agentCoveredTasks} agent-covered task(s).`,
      metrics: {
        activeTasks: input.coveragePlan.totals.activeTasks,
        fullyCoveredTasks: input.coveragePlan.totals.fullyCoveredTasks,
        humanGaps: input.coveragePlan.totals.humanGaps,
        agentGaps: input.coveragePlan.totals.agentGaps,
        readyActions: input.coveragePlan.totals.readyHumanActions + input.coveragePlan.totals.readyAgentActions
      },
      action: {
        label: "Run coverage",
        method: "POST",
        endpoint: links.runCoverageLocal
      }
    },
    {
      id: "competition",
      label: "Public competition",
      status: input.blueprint.competitionPlan.humanAgentRaceReady ? "complete" : "blocked",
      summary: input.blueprint.competitionPlan.humanAgentRaceReady
        ? "Ranked suites are ready for public human-vs-agent competition."
        : "Need ranked-ready tasks and coverage before public competition.",
      metrics: {
        readinessScore: input.blueprint.readinessScore,
        humanAgentRaceReady: input.blueprint.competitionPlan.humanAgentRaceReady,
        suiteCount: input.blueprint.competitionPlan.suiteIds.length
      },
      action: {
        label: "Open standings",
        method: "GET",
        endpoint: links.standings
      }
    }
  ];
  const status = overallStatus(input);

  return {
    schemaVersion: "steambench.steam-app-onboarding.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    appid,
    gameName: input.blueprint.game.name,
    status,
    readinessScore: input.blueprint.readinessScore,
    stages,
    nextActions: [
      ...stages.filter((stage) => stage.status === "ready").map((stage) => `${stage.action.label}: ${stage.action.endpoint}`),
      ...(status === "competition-ready" ? ["Share the game standings certificate and schedule more coverage runs."] : [])
    ],
    links
  };
}
