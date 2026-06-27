import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cors from "cors";
import express from "express";
import { achievementFixtures, gameCatalog, steamLeaderboardFixtures, steamStatFixtures } from "../benchmark/catalog";
import { buildRaceEligibility } from "../benchmark/eligibility";
import { simulatedMetricValue } from "../benchmark/scoring";
import { buildSeasonSnapshot, buildSeasonSnapshots, buildStandings, buildTaskLeaderboards, type SeasonScope } from "../benchmark/standings";
import { buildSuiteRaceStandings } from "../benchmark/suite-standings";
import { buildBenchmarkSuites, type BenchmarkSuiteTier } from "../benchmark/suites";
import { buildTaskReview, buildTaskReviews } from "../benchmark/task-review";
import { buildTaskReviewCatalog, type TaskReviewCatalogFilter } from "../benchmark/task-review-catalog";
import { buildManualBenchmarkTask, buildSteamLeaderboardMetricProposals, buildSteamStatMetricProposals, buildTasksForGame, buildTasksForGameEntry, inferGameCatalogEntry, type ManualBenchmarkTaskInput } from "../benchmark/task-generator";
import type { BenchmarkTask } from "../benchmark/types";
import { buildSteamDataPolicyReport, clearSteamMetadataCache, fetchGlobalAchievementPercentagesWithMeta, fetchPlayerAchievements, fetchPlayerAchievementsWithMeta, fetchSteamGameSchemaWithMeta, fetchSteamLeaderboardsForGameWithMeta, getSteamMetadataCacheSnapshot, searchSteamAppsWithMeta } from "../steam/steam-client";
import { verifySteamOpenId, type SteamOpenIdVerifier } from "../steam/openid";
import { buildBroadcastPayload } from "../runtime/broadcast";
import { actionLabel, normalizeAgentActions } from "../runtime/action-space";
import { compileControllerExecutionPlan } from "../runtime/controller-execution-plan";
import { buildRuntimeRunPlan, buildSimulatedRuntimeEvents, runtimeEventTypes } from "../runtime/events";
import { adaptersForCatalog } from "../runtime/game-adapters";
import { buildRuntimeReadiness } from "../runtime/readiness";
import { buildAgentActionTrace, buildAgentPlaybook } from "./agent-playbook";
import { buildAgentBenchmarkCampaignPlan, buildAgentCampaignLinks } from "./agent-campaign";
import { buildAgentCampaignEvidenceBundle } from "./agent-campaign-evidence-bundle";
import { buildAgentBenchmarkCampaignReport } from "./agent-campaign-report";
import { buildAgentCampaignStandings } from "./agent-campaign-standings";
import { buildAgentOpsReport } from "./agent-ops";
import { buildAgentRuntimeHandoff } from "./agent-runtime-handoff";
import { buildAgentTraceAuditReport, type AgentTraceAuditVerdict } from "./agent-trace-audit";
import { buildAgentTraceOpsReport } from "./agent-trace-ops";
import { buildBroadcastCenter } from "./broadcast-center";
import { buildBroadcastEvidenceBundle } from "./broadcast-evidence-bundle";
import { buildBroadcastOpsReport } from "./broadcast-ops";
import { buildAgentRuntimeLab, buildAgentRuntimeLabs } from "./agent-runtime-lab";
import { buildBenchmarkBlueprint } from "./benchmark-blueprint";
import { buildChallengeEvidenceBundle } from "./challenge-evidence-bundle";
import { buildChallengeOpsReport, type ChallengeOpsTicketStatus } from "./challenge-ops";
import { buildCompetitionEventEvidenceBundle, summarizeCompetitionEventEvidenceBundle } from "./competition-event-evidence-bundle";
import { buildCompetitionEventOpsReport } from "./competition-event-ops";
import { buildCompetitorProfile } from "./competitor-profile";
import { buildControlBridgeManifest } from "./control-bridge-manifest";
import { buildControlBridgeOpsReport } from "./control-bridge-ops";
import { buildRunEvidenceBundle } from "./evidence-bundle";
import { buildCompetitionEvents, buildCompetitionEventSummary } from "./competition-events";
import { buildExecutionManifest } from "./execution-manifest";
import { buildGameBenchmarkProfile, buildGameBenchmarkProfiles } from "./game-profile";
import { buildGameCompetitionEvidenceBundle } from "./game-competition-evidence-bundle";
import { buildGameCompetitionOpsReport } from "./game-competition-ops";
import { buildGameCompetitionStandings } from "./game-competition-standings";
import { buildGameCoverageRunEvidenceBundle } from "./game-coverage-run-evidence-bundle";
import { buildGameCoveragePlan } from "./game-coverage-plan";
import { buildHumanBenchmarkCampaignPlan } from "./human-campaign-plan";
import { buildHumanOnboardingOpsReport } from "./human-onboarding-ops";
import { buildHumanProofOpsReport } from "./human-proof-ops";
import { buildHumanAgentComparison } from "./human-agent-comparison";
import { buildHumanAgentComparisonEvidenceBundle } from "./human-agent-comparison-evidence-bundle";
import { buildHumanAgentComparisonOpsReport, buildHumanAgentComparisonStandings } from "./human-agent-comparison-standings";
import { buildHumanSteamProofPlan } from "./human-steam-proof-plan";
import { buildMatchFeed } from "./match-feed";
import { buildMatchArenaPacket } from "./match-arena-packet";
import { buildMatchArenaOpsReport, type MatchArenaOpsStatus } from "./match-arena-ops";
import { buildModalRuntimePackage } from "./modal-runtime-package";
import { buildPlatformOpsReport } from "./platform-ops";
import { buildRunAuditReport, summarizeRunAudit } from "./run-audit";
import { buildRuntimeControlAccessPacket } from "./runtime-control-access-packet";
import { buildRuntimeActionSpaceCatalog } from "./runtime-action-space-catalog";
import { buildSteamProofFetchReport } from "./steam-proof-fetch-report";
import { buildAgentCampaignResultCertificate, buildBroadcastResultCertificate, buildChallengeResultCertificate, buildCompetitionEventResultCertificate, buildGameCompetitionResultCertificate, buildGameCoverageRunResultCertificate, buildHumanAgentComparisonResultCertificate, buildMatchResultCertificate, buildRunResultCertificate, buildSuiteRaceResultCertificate, verifyResultCertificate, type ResultCertificate } from "./result-certificate";
import { buildRuntimeDispatchPlan } from "./runtime-dispatch";
import { buildRuntimeDispatchOpsReport } from "./runtime-dispatch-ops";
import { buildScoreboardOpsReport, type ScoreboardOpsTicketStatus } from "./scoreboard-ops";
import { buildSteamSourceQueue } from "./steam-source-queue";
import { buildSuiteRaceEvidenceBundle } from "./suite-race-evidence-bundle";
import { buildSuiteRaceAuditReport, summarizeSuiteRaceAudit } from "./suite-race-audit";
import { buildSteamAchievementBenchmarkLadder } from "./steam-achievement-ladder";
import { buildSteamAppOnboardingPipeline } from "./steam-app-onboarding";
import { buildSteamAppDiscoveryCandidates, searchFixtureSteamApps } from "./steam-app-discovery";
import { buildSteamTaskSourceOpsReport } from "./steam-task-source-ops";
import {
  SteambenchStore,
  type AgentProfile,
  type BenchmarkAgentCampaign,
  type BenchmarkChallenge,
  type CompetitionEventRegistration,
  type GameCoverageRunRecord,
  type LiveStreamSession,
  type RuntimeControlSession,
  type RunArtifact,
  type RuntimeDispatch,
  type SteamAppDiscoveryCandidate,
  type UserAccount
} from "./store";

export type SteambenchAppOptions = {
  verifySteamOpenId?: SteamOpenIdVerifier;
};

type ResultCertificateIndexKind = "all" | ResultCertificate["kind"];

const resultCertificateIndexKinds = new Set<ResultCertificateIndexKind>([
  "all",
  "run",
  "match",
  "challenge",
  "suite-race",
  "agent-campaign",
  "human-agent-comparison",
  "competition-event",
  "broadcast",
  "game-competition",
  "game-coverage-run"
]);

type ResultCertificateIndexEntry = {
  kind: ResultCertificate["kind"];
  id: string;
  title: string;
  generatedAt: string;
  status: string;
  verdict: ResultCertificate["verdict"];
  readyForPublicShare: boolean;
  canonicalArtifactName: "output.mp4";
  fingerprint: string;
  verificationMethod: "sha256";
  participants: ResultCertificate["participants"];
  tasks: ResultCertificate["tasks"];
  result: ResultCertificate["result"];
  links: ResultCertificate["links"];
};

export function createSteambenchApp(store = new SteambenchStore(), options: SteambenchAppOptions = {}) {
  const app = express();
  const openIdVerifier = options.verifySteamOpenId ?? verifySteamOpenId;

  app.use(cors());
  app.use(express.json());

  const staticDistPath = resolve(process.cwd(), "dist");
  if (process.env.NODE_ENV === "production" && existsSync(staticDistPath)) {
    app.use(express.static(staticDistPath));
  }

  async function buildProofReviewQueue(status?: "pending" | "verified" | "failed") {
    const snapshot = await store.read();
    const items = [];
    for (const proof of snapshot.proofs) {
      if (status && proof.status !== status) continue;
      const run = snapshot.runs.find((entry) => entry.id === proof.runId);
      const task = run ? await store.findTask(run.taskId) : null;
      items.push({ proof, run, task });
    }
    return items.sort((a, b) => b.proof.createdAt.localeCompare(a.proof.createdAt));
  }

  function parseSeasonScope(value: unknown): SeasonScope | null {
    const scope = value === undefined ? "all" : String(value);
    return scope === "all" || scope === "daily" || scope === "weekly" ? scope : null;
  }

  function parseSteamDiscoveryStatus(value: unknown): SteamAppDiscoveryCandidate["status"] | null {
    const status = String(value ?? "");
    return status === "candidate" || status === "shortlisted" || status === "imported" || status === "rejected" ? status : null;
  }

  function parseRuntimeDispatchOpsFilter(query: Record<string, unknown>): {
    provider?: RuntimeDispatch["provider"];
    statuses?: RuntimeDispatch["status"][];
    limit: number;
    error?: string;
  } {
    const provider = query.provider === undefined ? undefined : String(query.provider);
    if (provider !== undefined && provider !== "local" && provider !== "modal") {
      return { limit: 50, error: "invalid_provider" };
    }

    const validStatuses = new Set<RuntimeDispatch["status"]>(["planned", "launched", "claimed", "completed", "failed", "canceled"]);
    const statusInput = query.status === undefined ? undefined : String(query.status);
    const statuses = statusInput
      ? statusInput.split(",").map((entry) => entry.trim()).filter(Boolean)
      : undefined;
    if (statuses?.some((status) => !validStatuses.has(status as RuntimeDispatch["status"]))) {
      return { limit: 50, error: "invalid_status" };
    }

    const limitInput = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isFinite(limitInput) || limitInput < 1) {
      return { limit: 50, error: "invalid_limit" };
    }

    return {
      provider,
      statuses: statuses as RuntimeDispatch["status"][] | undefined,
      limit: Math.min(200, Math.floor(limitInput))
    };
  }

  function parseControlBridgeOpsFilter(query: Record<string, unknown>): {
    statuses?: RuntimeControlSession["status"][];
    transport?: RuntimeControlSession["actionSpace"]["transport"];
    limit: number;
    error?: string;
  } {
    const validStatuses = new Set<RuntimeControlSession["status"]>(["active", "expired", "revoked"]);
    const statusInput = query.status === undefined ? undefined : String(query.status);
    const statuses = statusInput
      ? statusInput.split(",").map((entry) => entry.trim()).filter(Boolean)
      : undefined;
    if (statuses?.some((status) => !validStatuses.has(status as RuntimeControlSession["status"]))) {
      return { limit: 50, error: "invalid_status" };
    }

    const transport = query.transport === undefined ? undefined : String(query.transport);
    if (transport !== undefined && transport !== "local-desktop" && transport !== "virtual-controller" && transport !== "structured-turn-api") {
      return { limit: 50, error: "invalid_transport" };
    }

    const limitInput = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isFinite(limitInput) || limitInput < 1) {
      return { limit: 50, error: "invalid_limit" };
    }

    return {
      statuses: statuses as RuntimeControlSession["status"][] | undefined,
      transport: transport as RuntimeControlSession["actionSpace"]["transport"] | undefined,
      limit: Math.min(200, Math.floor(limitInput))
    };
  }

  function parseMatchArenaOpsFilter(query: Record<string, unknown>): {
    status?: MatchArenaOpsStatus;
    limit: number;
    error?: string;
  } {
    const statusInput = query.status === undefined ? undefined : String(query.status);
    const validStatuses = new Set<MatchArenaOpsStatus>([
      "needs-start",
      "needs-human-proof",
      "needs-agent-evidence",
      "ready-to-evaluate",
      "scoreboard-ready",
      "evidence-missing",
      "failed",
      "canceled"
    ]);
    if (statusInput !== undefined && !validStatuses.has(statusInput as MatchArenaOpsStatus)) {
      return { limit: 50, error: "invalid_status" };
    }

    const limitInput = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isFinite(limitInput) || limitInput < 1) {
      return { limit: 50, error: "invalid_limit" };
    }

    return {
      status: statusInput as MatchArenaOpsStatus | undefined,
      limit: Math.min(200, Math.floor(limitInput))
    };
  }

  function parseMetricProposalDraft(value: unknown): { proposal?: ManualBenchmarkTaskInput; error?: string } {
    if (!value || typeof value !== "object") return { error: "invalid_metric_proposal" };
    const draft = value as Record<string, unknown>;
    const track = String(draft.track ?? "");
    if (track !== "stat" && track !== "leaderboard" && track !== "capture") {
      return { error: "invalid_metric_task_track" };
    }

    const title = String(draft.title ?? "").trim();
    const metricName = String(draft.metricName ?? "").trim();
    const targetValue = String(draft.targetValue ?? "").trim();
    const objective = String(draft.objective ?? "").trim();
    const scoringRule = String(draft.scoringRule ?? "").trim();
    const level = Number(draft.level ?? 5);
    const estimatedRuntimeMinutes = Number(draft.estimatedRuntimeMinutes ?? 30);
    if (!title || !metricName || !targetValue || !objective || !scoringRule || !Number.isFinite(level) || !Number.isFinite(estimatedRuntimeMinutes)) {
      return { error: "invalid_metric_task_contract" };
    }

    const proof = Array.isArray(draft.proof)
      ? draft.proof.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0)
      : undefined;
    const riskFlags = Array.isArray(draft.riskFlags)
      ? draft.riskFlags.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0)
      : undefined;
    const signalSource = draft.signalSource === "steam-stat" || draft.signalSource === "steam-leaderboard" || draft.signalSource === "run-capture"
      ? draft.signalSource
      : undefined;

    return {
      proposal: {
        key: draft.key === undefined ? undefined : String(draft.key),
        title,
        track,
        level,
        targetValue,
        metricName,
        objective,
        proof,
        estimatedRuntimeMinutes,
        scoringRule,
        signalSource,
        riskFlags
      }
    };
  }

  function parseTaskReviewCatalogFilter(query: Record<string, unknown>): { filter: TaskReviewCatalogFilter; error?: string } {
    const filter: TaskReviewCatalogFilter = {};
    const decision = typeof query.decision === "string" ? query.decision : undefined;
    const fairnessVerdict = typeof query.fairnessVerdict === "string" ? query.fairnessVerdict : undefined;
    const riskFlag = typeof query.riskFlag === "string" ? query.riskFlag : undefined;
    const registryStatus = typeof query.registryStatus === "string" ? query.registryStatus : undefined;

    if (decision !== undefined) {
      if (decision !== "ranked-ready" && decision !== "review-required" && decision !== "reject") return { filter, error: "invalid_decision" };
      filter.decision = decision;
    }
    if (fairnessVerdict !== undefined) {
      if (fairnessVerdict !== "good" && fairnessVerdict !== "controlled" && fairnessVerdict !== "not-comparable" && fairnessVerdict !== "exclude") {
        return { filter, error: "invalid_fairness_verdict" };
      }
      filter.fairnessVerdict = fairnessVerdict;
    }
    if (riskFlag !== undefined) {
      if (riskFlag !== "grind" && riskFlag !== "multiplayer" && riskFlag !== "dlc" && riskFlag !== "seasonal" && riskFlag !== "antiCheat" && riskFlag !== "longHorizon") {
        return { filter, error: "invalid_risk_flag" };
      }
      filter.riskFlag = riskFlag;
    }
    if (registryStatus !== undefined) {
      if (registryStatus !== "fixture-active" && registryStatus !== "candidate" && registryStatus !== "active" && registryStatus !== "rejected") {
        return { filter, error: "invalid_registry_status" };
      }
      filter.registryStatus = registryStatus;
    }

    const limitInput = query.limit === undefined ? undefined : Number(query.limit);
    if (limitInput !== undefined) {
      if (!Number.isFinite(limitInput) || limitInput < 1) return { filter, error: "invalid_limit" };
      filter.limit = Math.min(100, Math.floor(limitInput));
    }

    return { filter };
  }

  function resolveCompetitionEventRegistration(registration: CompetitionEventRegistration, snapshot: Awaited<ReturnType<SteambenchStore["read"]>>) {
    return {
      registration,
      human: registration.participantType === "human" ? snapshot.users.find((user) => user.id === registration.participantId) : undefined,
      agent: registration.participantType === "agent" ? snapshot.agents.find((agent) => agent.id === registration.participantId) : undefined
    };
  }

  async function resolveChallenge(challenge: BenchmarkChallenge, snapshot: Awaited<ReturnType<SteambenchStore["read"]>>) {
    return {
      challenge,
      task: await store.findTask(challenge.taskId),
      human: snapshot.users.find((user) => user.id === challenge.humanUserId),
      agent: snapshot.agents.find((agent) => agent.id === challenge.agentId),
      match: challenge.matchId ? snapshot.matches.find((match) => match.id === challenge.matchId) : undefined
    };
  }

  async function resolveRuntimeDispatch(dispatch: RuntimeDispatch, snapshot: Awaited<ReturnType<SteambenchStore["read"]>>) {
    return {
      dispatch,
      run: snapshot.runs.find((run) => run.id === dispatch.runId),
      task: await store.findTask(dispatch.taskId),
      agent: dispatch.agentId ? snapshot.agents.find((agent) => agent.id === dispatch.agentId) : undefined
    };
  }

  async function resolveGameCoverageRunRecord(record: GameCoverageRunRecord, snapshot: Awaited<ReturnType<SteambenchStore["read"]>>) {
    return {
      record,
      human: record.humanUserId ? snapshot.users.find((user) => user.id === record.humanUserId) : undefined,
      agent: record.agentId ? snapshot.agents.find((agent) => agent.id === record.agentId) : undefined,
      runs: await Promise.all(record.runIds.map(async (runId) => {
        const run = snapshot.runs.find((entry) => entry.id === runId);
        return {
          run,
          task: run ? await store.findTask(run.taskId) : undefined,
          side: record.humanRunIds.includes(runId) ? "human" : record.agentRunIds.includes(runId) ? "agent" : undefined,
          links: run
            ? {
                audit: `/api/runs/${run.id}/audit`,
                evidenceBundle: `/api/runs/${run.id}/evidence-bundle`,
                resultCertificate: `/api/runs/${run.id}/result-certificate`
              }
            : undefined
        };
      })),
      links: {
        coveragePlan: `/api/games/${record.appid}/coverage-plan`,
        gameCoverageRuns: `/api/games/${record.appid}/coverage-runs`,
        standings: `/api/games/${record.appid}/standings`,
        evidenceBundle: `/api/game-coverage-runs/${record.id}/evidence-bundle`,
        resultCertificate: `/api/game-coverage-runs/${record.id}/result-certificate`
      }
    };
  }

  function activeRunForCompetitor(
    snapshot: Awaited<ReturnType<SteambenchStore["read"]>>,
    input: { taskId: string; competitor: string; competitorType: "human" | "agent" }
  ) {
    return snapshot.runs.find((run) =>
      run.taskId === input.taskId &&
      run.competitor === input.competitor &&
      run.competitorType === input.competitorType &&
      (run.status === "queued" || run.status === "preparing" || run.status === "running")
    );
  }

  async function importSteamAchievementCandidates(input: {
    appid: number;
    gameName?: string;
    benchmarkFit?: number;
    harnessRisk?: "low" | "medium" | "high";
    limit?: number;
    useFixture?: boolean;
    refresh?: boolean;
    reviewNotes?: string;
  }) {
    const limit = Number.isFinite(input.limit) ? Math.min(100, Math.max(1, Math.floor(input.limit ?? 25))) : 25;
    const game = inferGameCatalogEntry({
      appid: input.appid,
      name: input.gameName,
      benchmarkFit: input.benchmarkFit,
      harnessRisk: input.harnessRisk ?? "medium"
    });

    try {
      const liveAchievements = input.useFixture
        ? null
        : await fetchGlobalAchievementPercentagesWithMeta(input.appid, {
            forceRefresh: Boolean(input.refresh)
          });
      const achievements = input.useFixture ? achievementFixtures[input.appid] ?? [] : liveAchievements?.data ?? [];
      const tasks = buildTasksForGameEntry(game, achievements.slice(0, limit), input.useFixture ? "fixture" : "steam-live");
      const imported = await store.upsertTaskCandidates(
        tasks,
        input.reviewNotes ?? "Imported from Steam achievement metadata."
      );
      return {
        appid: input.appid,
        source: input.useFixture ? "fixture" as const : "steam-live" as const,
        steamMeta: liveAchievements?.meta ?? null,
        policy: buildSteamDataPolicyReport(),
        imported
      };
    } catch (error) {
      const fallbackAchievements = achievementFixtures[input.appid] ?? [];
      if (fallbackAchievements.length === 0) throw error;

      const tasks = buildTasksForGameEntry(game, fallbackAchievements.slice(0, limit), "fixture");
      const imported = await store.upsertTaskCandidates(tasks, "Imported from fixture fallback after Steam request failed.");
      return {
        appid: input.appid,
        source: "fixture" as const,
        warning: error instanceof Error ? error.message : "Fell back to local fixtures",
        policy: buildSteamDataPolicyReport(),
        imported
      };
    }
  }

  async function buildSteamAchievementLadderPayload(input: {
    appid: number;
    useFixture?: boolean;
    refresh?: boolean;
    gameName?: string;
    benchmarkFit?: number;
    harnessRisk?: "low" | "medium" | "high";
  }) {
    const snapshot = await store.read();
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === input.appid);
    const game = inferGameCatalogEntry({
      appid: input.appid,
      name: input.gameName ?? discovery?.name,
      benchmarkFit: input.benchmarkFit ?? discovery?.benchmarkFit,
      harnessRisk: input.harnessRisk ?? discovery?.harnessRisk
    });
    const activeTasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();

    if (input.useFixture) {
      return {
        source: "fixture" as const,
        steamMeta: null,
        policy: buildSteamDataPolicyReport(),
        ladder: buildSteamAchievementBenchmarkLadder({
          game,
          achievements: achievementFixtures[input.appid] ?? [],
          activeTasks,
          taskRegistry,
          source: "fixture"
        })
      };
    }

    try {
      const liveAchievements = await fetchGlobalAchievementPercentagesWithMeta(input.appid, {
        forceRefresh: Boolean(input.refresh)
      });
      return {
        source: "steam-live" as const,
        steamMeta: liveAchievements.meta,
        policy: buildSteamDataPolicyReport(),
        ladder: buildSteamAchievementBenchmarkLadder({
          game,
          achievements: liveAchievements.data,
          activeTasks,
          taskRegistry,
          source: "steam-live"
        })
      };
    } catch (error) {
      return {
        source: "fixture" as const,
        warning: error instanceof Error ? error.message : "Fell back to local fixtures",
        steamMeta: null,
        policy: buildSteamDataPolicyReport(),
        ladder: buildSteamAchievementBenchmarkLadder({
          game,
          achievements: achievementFixtures[input.appid] ?? [],
          activeTasks,
          taskRegistry,
          source: "fixture"
        })
      };
    }
  }

  async function buildSteamStatProposalPayload(input: {
    appid: number;
    useFixture?: boolean;
    refresh?: boolean;
    limit?: number;
    gameName?: string;
    benchmarkFit?: number;
    harnessRisk?: "low" | "medium" | "high";
  }) {
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(50, Math.floor(input.limit ?? 12))) : 12;
    const snapshot = await store.read();
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === input.appid);
    let source: "fixture" | "steam-live" = input.useFixture ? "fixture" : "steam-live";
    let warning: string | undefined;
    let steamMeta = null;
    let schemaGameName: string | undefined;
    let schemaGameVersion: string | undefined;
    let stats = steamStatFixtures[input.appid] ?? [];

    if (!input.useFixture) {
      try {
        const liveSchema = await fetchSteamGameSchemaWithMeta(
          {
            appid: input.appid,
            apiKey: process.env.STEAM_WEB_API_KEY
          },
          {
            forceRefresh: Boolean(input.refresh)
          }
        );
        source = "steam-live";
        steamMeta = liveSchema.meta;
        schemaGameName = liveSchema.data.gameName;
        schemaGameVersion = liveSchema.data.gameVersion;
        stats = liveSchema.data.stats;
      } catch (error) {
        if ((steamStatFixtures[input.appid] ?? []).length === 0) throw error;
        source = "fixture";
        warning = error instanceof Error ? error.message : "Fell back to local Steam stat fixtures";
        steamMeta = null;
        stats = steamStatFixtures[input.appid] ?? [];
      }
    }

    const game = gameCatalog.find((entry) => entry.appid === input.appid) ?? inferGameCatalogEntry({
      appid: input.appid,
      name: input.gameName ?? schemaGameName ?? discovery?.name,
      benchmarkFit: input.benchmarkFit ?? discovery?.benchmarkFit,
      harnessRisk: input.harnessRisk ?? discovery?.harnessRisk
    });
    const proposals = buildSteamStatMetricProposals(game, stats, { limit });
    const tasks = proposals.map((proposal) => buildManualBenchmarkTask(game, proposal, source));
    const reviews = tasks.map((task) => buildTaskReview(task));
    const allTasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();

    return {
      proposalRun: {
        schemaVersion: "steambench.steam-stat-proposal-run.v1",
        appid: input.appid,
        game,
        source,
        requestedLimit: limit,
        stats: stats.length,
        proposed: proposals.length,
        reviewRequired: reviews.filter((review) => review.decision !== "ranked-ready").length,
        schemaGameName,
        schemaGameVersion,
        links: {
          importRecommended: `/api/steam/apps/${input.appid}/stat-proposals/import-recommended`,
          publishCandidates: `/api/steam/apps/${input.appid}/publish-candidates`,
          metricProposals: `/api/steam/apps/${input.appid}/metric-proposals`,
          benchmarkSuites: `/api/games/${input.appid}/benchmark-suites`,
          coveragePlan: `/api/games/${input.appid}/coverage-plan`
        }
      },
      source,
      steamMeta,
      warning,
      policy: buildSteamDataPolicyReport(),
      stats,
      proposals,
      tasks,
      reviews,
      blueprint: buildBenchmarkBlueprint({
        game,
        tasks: allTasks,
        taskRegistry,
        discovery
      })
    };
  }

  async function buildSteamLeaderboardProposalPayload(input: {
    appid: number;
    useFixture?: boolean;
    refresh?: boolean;
    limit?: number;
    gameName?: string;
    benchmarkFit?: number;
    harnessRisk?: "low" | "medium" | "high";
  }) {
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(50, Math.floor(input.limit ?? 12))) : 12;
    const snapshot = await store.read();
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === input.appid);
    let source: "fixture" | "steam-live" = input.useFixture ? "fixture" : "steam-live";
    let warning: string | undefined;
    let steamMeta = null;
    let leaderboards = steamLeaderboardFixtures[input.appid] ?? [];

    if (!input.useFixture) {
      try {
        const liveLeaderboards = await fetchSteamLeaderboardsForGameWithMeta(
          {
            appid: input.appid,
            apiKey: process.env.STEAM_WEB_API_KEY
          },
          {
            forceRefresh: Boolean(input.refresh)
          }
        );
        source = "steam-live";
        steamMeta = liveLeaderboards.meta;
        leaderboards = liveLeaderboards.data.leaderboards;
      } catch (error) {
        if ((steamLeaderboardFixtures[input.appid] ?? []).length === 0) throw error;
        source = "fixture";
        warning = error instanceof Error ? error.message : "Fell back to local Steam leaderboard fixtures";
        steamMeta = null;
        leaderboards = steamLeaderboardFixtures[input.appid] ?? [];
      }
    }

    const game = gameCatalog.find((entry) => entry.appid === input.appid) ?? inferGameCatalogEntry({
      appid: input.appid,
      name: input.gameName ?? discovery?.name,
      benchmarkFit: input.benchmarkFit ?? discovery?.benchmarkFit,
      harnessRisk: input.harnessRisk ?? discovery?.harnessRisk
    });
    const proposals = buildSteamLeaderboardMetricProposals(game, leaderboards, { limit });
    const tasks = proposals.map((proposal) => buildManualBenchmarkTask(game, proposal, source));
    const reviews = tasks.map((task) => buildTaskReview(task));
    const allTasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();

    return {
      proposalRun: {
        schemaVersion: "steambench.steam-leaderboard-proposal-run.v1",
        appid: input.appid,
        game,
        source,
        requestedLimit: limit,
        leaderboards: leaderboards.length,
        proposed: proposals.length,
        reviewRequired: reviews.filter((review) => review.decision !== "ranked-ready").length,
        links: {
          importRecommended: `/api/steam/apps/${input.appid}/leaderboard-proposals/import-recommended`,
          publishCandidates: `/api/steam/apps/${input.appid}/publish-candidates`,
          metricProposals: `/api/steam/apps/${input.appid}/metric-proposals`,
          benchmarkSuites: `/api/games/${input.appid}/benchmark-suites`,
          coveragePlan: `/api/games/${input.appid}/coverage-plan`
        }
      },
      source,
      steamMeta,
      warning,
      policy: buildSteamDataPolicyReport(),
      leaderboards,
      proposals,
      tasks,
      reviews,
      blueprint: buildBenchmarkBlueprint({
        game,
        tasks: allTasks,
        taskRegistry,
        discovery
      })
    };
  }

  async function buildSteamTaskSourceOpsPayload(input: {
    appid: number;
    useFixture?: boolean;
    refresh?: boolean;
    limit?: number;
    gameName?: string;
    benchmarkFit?: number;
    harnessRisk?: "low" | "medium" | "high";
  }) {
    const [ladderPayload, statPayload, leaderboardPayload] = await Promise.all([
      buildSteamAchievementLadderPayload({
        appid: input.appid,
        useFixture: input.useFixture,
        refresh: input.refresh,
        gameName: input.gameName,
        benchmarkFit: input.benchmarkFit,
        harnessRisk: input.harnessRisk
      }),
      buildSteamStatProposalPayload({
        appid: input.appid,
        useFixture: input.useFixture,
        refresh: input.refresh,
        limit: input.limit,
        gameName: input.gameName,
        benchmarkFit: input.benchmarkFit,
        harnessRisk: input.harnessRisk
      }),
      buildSteamLeaderboardProposalPayload({
        appid: input.appid,
        useFixture: input.useFixture,
        refresh: input.refresh,
        limit: input.limit,
        gameName: input.gameName,
        benchmarkFit: input.benchmarkFit,
        harnessRisk: input.harnessRisk
      })
    ]);
    const snapshot = await store.read();
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === input.appid);
    const activeTasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const game = statPayload.proposalRun.game ?? leaderboardPayload.proposalRun.game ?? ladderPayload.ladder.game;

    return {
      ops: buildSteamTaskSourceOpsReport({
        appid: input.appid,
        gameName: game.name,
        discovery,
        ladder: ladderPayload.ladder,
        achievementSource: ladderPayload.source,
        achievementWarning: ladderPayload.warning,
        statProposalRun: {
          source: statPayload.source,
          stats: statPayload.proposalRun.stats,
          proposed: statPayload.proposalRun.proposed,
          reviewRequired: statPayload.proposalRun.reviewRequired
        },
        statTasks: statPayload.tasks,
        statWarning: statPayload.warning,
        leaderboardProposalRun: {
          source: leaderboardPayload.source,
          leaderboards: leaderboardPayload.proposalRun.leaderboards,
          proposed: leaderboardPayload.proposalRun.proposed,
          reviewRequired: leaderboardPayload.proposalRun.reviewRequired
        },
        leaderboardTasks: leaderboardPayload.tasks,
        leaderboardWarning: leaderboardPayload.warning,
        activeTasks,
        taskRegistry
      }),
      ladder: ladderPayload.ladder,
      statProposalRun: statPayload.proposalRun,
      leaderboardProposalRun: leaderboardPayload.proposalRun,
      policy: ladderPayload.policy,
      warnings: [ladderPayload.warning, statPayload.warning, leaderboardPayload.warning].filter(Boolean)
    };
  }

  async function buildSteamSourceQueuePayload(input: {
    useFixture?: boolean;
    refresh?: boolean;
    limit?: number;
    proposalLimit?: number;
    discoveryStatus?: SteamAppDiscoveryCandidate["status"];
  }) {
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(20, Math.floor(input.limit ?? 8))) : 8;
    const proposalLimit = Number.isFinite(input.proposalLimit) ? Math.max(1, Math.min(50, Math.floor(input.proposalLimit ?? 8))) : 8;
    const snapshot = await store.read();
    const discoveries = snapshot.steamAppDiscoveries
      .filter((entry) => entry.status !== "rejected")
      .filter((entry) => !input.discoveryStatus || entry.status === input.discoveryStatus);
    const seenAppids = new Set(discoveries.map((entry) => entry.appid));
    const catalogBackfill = gameCatalog
      .filter((game) => !seenAppids.has(game.appid))
      .sort((left, right) => right.benchmarkFit - left.benchmarkFit || left.name.localeCompare(right.name))
      .slice(0, limit);
    const candidates = [
      ...discoveries
        .sort((left, right) => right.benchmarkFit - left.benchmarkFit || right.estimatedAchievementTasks - left.estimatedAchievementTasks || left.name.localeCompare(right.name))
        .slice(0, Math.max(limit, limit * 2))
        .map((discovery) => ({
          appid: discovery.appid,
          gameName: discovery.name,
          benchmarkFit: discovery.benchmarkFit,
          harnessRisk: discovery.harnessRisk,
          discovery
        })),
      ...catalogBackfill.map((game) => ({
        appid: game.appid,
        gameName: game.name,
        benchmarkFit: game.benchmarkFit,
        harnessRisk: game.harnessRisk,
        discovery: undefined
      }))
    ].slice(0, Math.max(limit, limit * 2));

    const entries = await Promise.all(candidates.map(async (candidate) => ({
      discovery: candidate.discovery,
      ops: (await buildSteamTaskSourceOpsPayload({
        appid: candidate.appid,
        useFixture: input.useFixture,
        refresh: input.refresh,
        limit: proposalLimit,
        gameName: candidate.gameName,
        benchmarkFit: candidate.benchmarkFit,
        harnessRisk: candidate.harnessRisk
      })).ops
    })));

    return {
      queue: buildSteamSourceQueue({
        entries,
        limit
      })
    };
  }

  async function publishSteamTaskCandidates(input: {
    appid: number;
    limit?: number;
    reviewNotes?: string;
    reviewApproved?: boolean;
    forceReviewOverride?: boolean;
    gameName?: string;
    benchmarkFit?: number;
    harnessRisk?: "low" | "medium" | "high";
  }) {
    const maxTasks = Number.isFinite(input.limit) ? Math.max(1, Math.min(100, Math.floor(input.limit ?? 25))) : 25;
    const reviewNotes = input.reviewNotes?.trim() ?? "";
    const reviewApproved = Boolean(input.reviewApproved);
    const forceOverride = Boolean(input.forceReviewOverride);
    const registry = (await store.listTaskRegistry()).filter((task) => task.appid === input.appid);
    const candidates = registry.filter((task) => task.status === "candidate").slice(0, maxTasks);
    const alreadyActive = registry.filter((task) => task.status === "active");
    const published = [];
    const blocked = [];

    for (const candidate of candidates) {
      const review = buildTaskReview(candidate);
      if (review.decision === "reject" && !forceOverride) {
        blocked.push({
          task: candidate,
          review,
          error: "task_review_rejected",
          message: "Rejected benchmark tasks require forceReviewOverride=true before publication."
        });
        continue;
      }
      if (review.decision === "review-required" && (!reviewApproved || reviewNotes.length === 0)) {
        blocked.push({
          task: candidate,
          review,
          error: "task_review_required",
          message: "This task requires reviewApproved=true and non-empty reviewNotes before publication."
        });
        continue;
      }
      const task = await store.updateTaskRegistryStatus(
        candidate.id,
        "active",
        reviewNotes || "Bulk published ranked-ready Steam task candidate."
      );
      if (task) {
        published.push({
          task,
          review
        });
      }
    }

    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const discovery = (await store.read()).steamAppDiscoveries.find((entry) => entry.appid === input.appid);
    const game = inferGameCatalogEntry({
      appid: input.appid,
      name: input.gameName,
      benchmarkFit: input.benchmarkFit,
      harnessRisk: input.harnessRisk
    });

    return {
      publication: {
        schemaVersion: "steambench.task-publication.v1",
        appid: input.appid,
        requestedLimit: maxTasks,
        reviewedCandidates: candidates.length,
        published,
        blocked,
        alreadyActive,
        totals: {
          registryRows: registry.length,
          candidates: candidates.length,
          published: published.length,
          blocked: blocked.length,
          alreadyActive: alreadyActive.length
        }
      },
      blueprint: buildBenchmarkBlueprint({
        game,
        tasks,
        taskRegistry,
        discovery
      })
    };
  }

  async function runLocalGameCoverage(input: {
    appid: number;
    side: "human" | "agent" | "both";
    human?: UserAccount;
    agent?: AgentProfile;
    limit: number;
    apiBaseUrl: string;
  }) {
    const snapshot = await store.read();
    const game = gameCatalog.find((entry) => entry.appid === input.appid);
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === input.appid);
    if (!game && !discovery) return null;
    const wantsHuman = input.side === "human" || input.side === "both";
    const wantsAgent = input.side === "agent" || input.side === "both";
    const resolvedGame = game ?? inferGameCatalogEntry({
      appid: input.appid,
      name: discovery?.name,
      benchmarkFit: discovery?.benchmarkFit,
      harnessRisk: discovery?.harnessRisk
    });
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const planBefore = buildGameCoveragePlan({
      game: resolvedGame,
      snapshot,
      tasks,
      taskRegistry,
      human: input.human,
      agent: input.agent,
      limit: 50
    });
    const submissions = [];
    const simulations = [];
    const skipped = [];
    let actionCount = 0;

    for (const item of planBefore.items) {
      if (actionCount >= input.limit) break;

      if (wantsHuman && input.human && item.gaps.includes("human")) {
        if (item.selectedHuman?.status === "ready") {
          const result = await runLocalHumanSteamProofSubmission({
            user: input.human,
            taskId: item.task.id,
            apiBaseUrl: input.apiBaseUrl
          });
          if (result) {
            submissions.push({
              side: "human" as const,
              task: item.task,
              run: result.run,
              evaluation: result.evaluation,
              bundle: result.bundle,
              certificate: result.certificate
            });
            actionCount += 1;
          }
        } else {
          skipped.push({
            side: "human" as const,
            task: item.task,
            status: item.selectedHuman?.status ?? "select-human",
            reason: item.selectedHuman?.reason ?? "No ready selected human action for this task."
          });
        }
      }

      if (actionCount >= input.limit) break;

      if (wantsAgent && input.agent && item.gaps.includes("agent")) {
        if (item.selectedAgent?.status === "ready") {
          const run = await store.createRun({
            taskId: item.task.id,
            competitor: `agent:${input.agent.handle}`,
            competitorType: "agent",
            runtimeProvider: input.agent.runtimeProvider
          });
          if (run) {
            await store.appendRunEvent({
              runId: run.id,
              type: "plan",
              message: `Game coverage local runner queued ${input.agent.displayName}.`,
              metadata: {
                appid: input.appid,
                agentId: input.agent.id,
                runtimeProvider: input.agent.runtimeProvider,
                scheduler: "game-coverage-local-run"
              }
            });
            const simulated = await simulateAgentAttempt(run.id, item.task.id);
            const bundle = await buildEvidenceBundle(run.id, input.apiBaseUrl);
            simulations.push({
              side: "agent" as const,
              task: item.task,
              run: simulated?.detail?.run ?? run,
              events: simulated?.events ?? [],
              stream: simulated?.stream,
              evaluation: simulated?.evaluation,
              bundle,
              certificate: bundle
                ? buildRunResultCertificate({
                    bundle,
                    baseUrl: input.apiBaseUrl
                  })
                : undefined
            });
            actionCount += 1;
          }
        } else {
          skipped.push({
            side: "agent" as const,
            task: item.task,
            status: item.selectedAgent?.status ?? "select-agent",
            reason: item.selectedAgent?.reason ?? "No ready selected agent action for this task.",
            readiness: item.selectedAgent?.readiness
          });
        }
      }
    }

    const refreshedSnapshot = await store.read();
    const planAfter = buildGameCoveragePlan({
      game: resolvedGame,
      snapshot: refreshedSnapshot,
      tasks,
      taskRegistry,
      human: input.human,
      agent: input.agent,
      limit: 50
    });
    const completedEntries = [...submissions, ...simulations];
    const record = await store.createGameCoverageRun({
      appid: input.appid,
      gameName: resolvedGame.name,
      requestedSide: input.side,
      humanUserId: input.human?.id,
      agentId: input.agent?.id,
      runIds: completedEntries.map((entry) => entry.run.id),
      humanRunIds: submissions.map((entry) => entry.run.id),
      agentRunIds: simulations.map((entry) => entry.run.id),
      scoreboardReady: completedEntries.filter((entry) => entry.evaluation?.passed === true).length,
      remainingHumanGaps: planAfter.totals.humanGaps,
      remainingAgentGaps: planAfter.totals.agentGaps,
      summary: `${resolvedGame.name} coverage local run completed ${completedEntries.length} run(s).`
    });
    const result = {
      schemaVersion: "steambench.game-coverage-local-run.v1" as const,
      record,
      appid: input.appid,
      game: resolvedGame,
      requestedSide: input.side,
      limit: input.limit,
      selectedHuman: input.human
        ? {
            id: input.human.id,
            handle: input.human.handle,
            displayName: input.human.displayName,
            linkedSteamId: input.human.linkedSteamId,
            proofConsentAt: input.human.proofConsentAt
          }
        : undefined,
      selectedAgent: input.agent
        ? {
            id: input.agent.id,
            handle: input.agent.handle,
            displayName: input.agent.displayName,
            status: input.agent.status,
            runtimeProvider: input.agent.runtimeProvider
          }
        : undefined,
      totals: {
        completedRuns: completedEntries.length,
        humanRuns: submissions.length,
        agentRuns: simulations.length,
        scoreboardReady: completedEntries.filter((entry) => entry.evaluation?.passed === true).length,
        skipped: skipped.length,
        remainingHumanGaps: planAfter.totals.humanGaps,
        remainingAgentGaps: planAfter.totals.agentGaps
      },
      submissions,
      simulations,
      skipped,
      links: {
        coveragePlan: `/api/games/${input.appid}/coverage-plan`,
        coverageRun: `/api/game-coverage-runs/${record.id}`,
        coverageRuns: `/api/games/${input.appid}/coverage-runs`,
        standings: `/api/games/${input.appid}/standings`,
        evidenceBundle: `/api/games/${input.appid}/evidence-bundle`,
        resultCertificate: `/api/games/${input.appid}/result-certificate`
      }
    };

    return {
      result,
      planBefore,
      planAfter
    };
  }

  async function buildRunAudit(runId: string) {
    const snapshot = await store.read();
    const detail = await store.getRun(runId);
    const task = detail ? await store.findTask(detail.run.taskId) : null;
    if (!detail || !task) return null;
    return buildRunAuditReport({
      run: detail.run,
      task,
      events: detail.events,
      artifacts: detail.artifacts,
      proofs: detail.proofs,
      streams: detail.streams,
      scoreboard: snapshot.scoreboard
    });
  }

  async function buildRunExecutionManifest(runId: string, apiBaseUrl: string, requestedAgent?: string) {
    const runPayload = await store.getRun(runId);
    const task = runPayload ? await store.findTask(runPayload.run.taskId) : null;
    if (!runPayload || !task) return null;
    const agent = requestedAgent
      ? await store.findAgentProfile(requestedAgent)
      : await store.findAgentProfile(runPayload.run.competitor);
    const plan = buildRuntimeRunPlan(task);
    const readiness = buildRuntimeReadiness(task, agent);
    return buildExecutionManifest({
      run: runPayload.run,
      task,
      agent,
      plan,
      readiness,
      apiBaseUrl
    });
  }

  async function buildTaskRaceEligibility(taskId: string, humanUserId?: string, agentId?: string) {
    const snapshot = await store.read();
    const task = await store.findTask(taskId);
    if (!task) return null;
    const review = buildTaskReview(task);
    const human = humanUserId ? snapshot.users.find((entry) => entry.id === humanUserId) ?? null : null;
    const agent = agentId ? await store.findAgentProfile(agentId) : null;
    return buildRaceEligibility({
      task,
      review,
      human,
      agent,
      agentReadiness: buildRuntimeReadiness(task, agent)
    });
  }

  async function buildCurrentBenchmarkSuites() {
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const taskReviews = buildTaskReviews([...tasks, ...taskRegistry.filter((entry) => !tasks.some((task) => task.id === entry.id))]);
    const gamesByAppid = new Map(gameCatalog.map((game) => [game.appid, game]));
    for (const discovery of snapshot.steamAppDiscoveries) {
      if (gamesByAppid.has(discovery.appid)) continue;
      if (!tasks.some((task) => task.appid === discovery.appid) && !taskRegistry.some((task) => task.appid === discovery.appid)) continue;
      gamesByAppid.set(discovery.appid, inferGameCatalogEntry({
        appid: discovery.appid,
        name: discovery.name,
        benchmarkFit: discovery.benchmarkFit,
        harnessRisk: discovery.harnessRisk
      }));
    }
    for (const task of [...tasks, ...taskRegistry]) {
      if (gamesByAppid.has(task.appid)) continue;
      gamesByAppid.set(task.appid, inferGameCatalogEntry({
        appid: task.appid,
        name: task.gameName
      }));
    }
    return buildBenchmarkSuites({ games: [...gamesByAppid.values()], tasks, reviews: taskReviews });
  }

  async function buildSuiteRacePreflight(suiteId: string, humanUserId: string, agentId: string) {
    const suites = await buildCurrentBenchmarkSuites();
    const suite = suites.find((entry) => entry.id === suiteId);
    if (!suite) return null;

    const eligibility = await Promise.all(
      suite.taskIds.map((taskId) => buildTaskRaceEligibility(taskId, humanUserId, agentId))
    );
    const entries = eligibility.filter((entry) => entry !== null);
    const status = entries.some((entry) => entry.status === "blocked")
      ? "blocked"
      : entries.some((entry) => entry.status === "controlled")
        ? "controlled"
        : "ready";
    return {
      suite,
      status,
      ready: status === "ready",
      eligibility: entries,
      blockers: entries.flatMap((entry) => entry.blockers),
      controls: [...new Set(entries.flatMap((entry) => entry.controls))].sort((a, b) => a.localeCompare(b))
    };
  }

  async function createSuiteRaceFromPreflight(input: {
    preflight: NonNullable<Awaited<ReturnType<typeof buildSuiteRacePreflight>>>;
    humanUserId: string;
    agentId: string;
    eventScope?: SeasonScope;
    summary?: string;
  }) {
    const matches = [];
    for (const taskId of input.preflight.suite.taskIds) {
      const match = await store.createMatch({
        taskId,
        humanUserId: input.humanUserId,
        agentId: input.agentId
      });
      if (match) matches.push(match);
    }
    if (matches.length !== input.preflight.suite.taskIds.length) return null;

    const race = await store.createSuiteRace({
      suiteId: input.preflight.suite.id,
      eventScope: input.eventScope,
      appid: input.preflight.suite.appid,
      title: input.preflight.suite.title,
      taskIds: input.preflight.suite.taskIds,
      matchIds: matches.map((match) => match.id),
      humanUserId: input.humanUserId,
      agentId: input.agentId,
      summary: input.summary ?? `${input.preflight.suite.title} scheduled ${matches.length} human-vs-agent matches.`
    });

    return {
      race,
      matches,
      preflight: input.preflight
    };
  }

  async function scheduleCompetitionEventSuite(input: {
    scope: SeasonScope;
    suiteId: string;
    reviewApproved?: boolean;
    maxPairs?: number;
  }) {
    const suites = await buildCurrentBenchmarkSuites();
    const suite = suites.find((entry) => entry.id === input.suiteId);
    if (!suite) return null;

    const snapshot = await store.read();
    const registrations = snapshot.eventRegistrations.filter(
      (registration) => registration.eventScope === input.scope && registration.status === "registered"
    );
    const registeredHumanIds = new Set(registrations.filter((registration) => registration.participantType === "human").map((registration) => registration.participantId));
    const registeredAgentIds = new Set(registrations.filter((registration) => registration.participantType === "agent").map((registration) => registration.participantId));
    const humans = snapshot.users.filter((user) => registeredHumanIds.has(user.id) && user.type === "human" && user.linkedSteamId && user.proofConsentAt);
    const agents = snapshot.agents.filter((agent) => registeredAgentIds.has(agent.id) && agent.status === "active");
    const maxPairs = Math.max(1, Math.min(100, Math.floor(input.maxPairs ?? 12)));
    const scheduled: Array<Record<string, unknown>> = [];
    const skipped: Array<Record<string, unknown>> = [];
    const blocked: Array<Record<string, unknown>> = [];
    const seenRaceKeys = new Set(
      snapshot.suiteRaces
        .filter((race) => race.suiteId === suite.id && race.eventScope === input.scope && race.status !== "blocked")
        .map((race) => `${race.humanUserId}:${race.agentId}`)
    );

    let consideredPairs = 0;
    for (const human of humans) {
      for (const agent of agents) {
        if (consideredPairs >= maxPairs) break;
        consideredPairs += 1;
        const raceKey = `${human.id}:${agent.id}`;
        if (seenRaceKeys.has(raceKey)) {
          skipped.push({
            human,
            agent,
            reason: "suite_race_already_scheduled"
          });
          continue;
        }

        const preflight = await buildSuiteRacePreflight(suite.id, human.id, agent.id);
        if (!preflight || preflight.status === "blocked" || (preflight.status === "controlled" && !input.reviewApproved)) {
          blocked.push({
            human,
            agent,
            preflight,
            reason: preflight?.status === "controlled" ? "suite_race_review_required" : "suite_race_not_eligible"
          });
          continue;
        }

        const matches = [];
        for (const taskId of suite.taskIds) {
          const match = await store.createMatch({
            taskId,
            humanUserId: human.id,
            agentId: agent.id
          });
          if (match) matches.push(match);
        }
        if (matches.length !== suite.taskIds.length) {
          blocked.push({
            human,
            agent,
            preflight,
            reason: "suite_race_match_creation_failed"
          });
          continue;
        }

        const race = await store.createSuiteRace({
          suiteId: suite.id,
          eventScope: input.scope,
          appid: suite.appid,
          title: suite.title,
          taskIds: suite.taskIds,
          matchIds: matches.map((match) => match.id),
          humanUserId: human.id,
          agentId: agent.id,
          summary: `${eventTitleForResponse(input.scope)} scheduled ${suite.title} for ${human.handle} vs ${agent.handle}.`
        });
        seenRaceKeys.add(raceKey);
        scheduled.push({
          race,
          matches,
          human,
          agent,
          preflight
        });
      }
      if (consideredPairs >= maxPairs) break;
    }

    return {
      scope: input.scope,
      suite,
      pairLimit: maxPairs,
      consideredPairs,
      entrants: {
        registeredHumans: registeredHumanIds.size,
        registeredAgents: registeredAgentIds.size,
        eligibleHumans: humans.length,
        eligibleAgents: agents.length,
        eligiblePairs: humans.length * agents.length
      },
      scheduled,
      skipped,
      blocked
    };
  }

  function eventTitleForResponse(scope: SeasonScope): string {
    if (scope === "daily") return "Daily event";
    if (scope === "weekly") return "Weekly event";
    return "All-time event";
  }

  function requestBaseUrl(request: express.Request): string {
    return `${request.protocol}://${request.get("host")}`;
  }

  async function buildEvidenceBundle(runId: string, apiBaseUrl: string, requestedAgent?: string) {
    const [audit, manifest] = await Promise.all([
      buildRunAudit(runId),
      buildRunExecutionManifest(runId, apiBaseUrl, requestedAgent)
    ]);
    if (!audit || !manifest) return null;
    return buildRunEvidenceBundle({ audit, manifest });
  }

  async function buildChallengeBundle(challengeId: string, apiBaseUrl: string) {
    const snapshot = await store.read();
    const challenge = snapshot.challenges.find((entry) => entry.id === challengeId);
    const task = challenge ? await store.findTask(challenge.taskId) : null;
    const match = challenge?.matchId ? snapshot.matches.find((entry) => entry.id === challenge.matchId) : undefined;
    if (!challenge || !task) return null;
    const [humanBundle, agentBundle] = await Promise.all([
      match?.humanRunId ? buildEvidenceBundle(match.humanRunId, apiBaseUrl) : Promise.resolve(null),
      match?.agentRunId ? buildEvidenceBundle(match.agentRunId, apiBaseUrl) : Promise.resolve(null)
    ]);
    return buildChallengeEvidenceBundle({
      challenge,
      task,
      human: snapshot.users.find((user) => user.id === challenge.humanUserId),
      agent: snapshot.agents.find((agent) => agent.id === challenge.agentId),
      match,
      humanBundle: humanBundle ?? undefined,
      agentBundle: agentBundle ?? undefined,
      baseUrl: apiBaseUrl
    });
  }

  async function buildGameCompetitionBundle(appid: number, scope: SeasonScope) {
    const snapshot = await store.read();
    const game = gameCatalog.find((entry) => entry.appid === appid);
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
    if (!game && !discovery) return null;
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const standings = buildGameCompetitionStandings({
      game: game ?? inferGameCatalogEntry({
        appid,
        name: discovery?.name,
        benchmarkFit: discovery?.benchmarkFit,
        harnessRisk: discovery?.harnessRisk
      }),
      tasks,
      taskRegistry,
      scoreboard: snapshot.scoreboard,
      scope
    });
    return buildGameCompetitionEvidenceBundle({
      standings,
      tasks
    });
  }

  async function buildGameCoverageRunBundle(recordId: string, apiBaseUrl: string) {
    const record = await store.getGameCoverageRun(recordId);
    if (!record) return null;
    const snapshot = await store.read();
    const human = record.humanUserId ? snapshot.users.find((user) => user.id === record.humanUserId) : undefined;
    const agent = record.agentId ? snapshot.agents.find((entry) => entry.id === record.agentId) : undefined;
    const runBundles = await Promise.all(record.runIds.map(async (runId) => {
      const run = snapshot.runs.find((entry) => entry.id === runId);
      return {
        runId,
        task: run ? await store.findTask(run.taskId) ?? undefined : undefined,
        bundle: await buildEvidenceBundle(runId, apiBaseUrl, agent?.id) ?? undefined
      };
    }));
    return buildGameCoverageRunEvidenceBundle({
      record,
      human,
      agent,
      runBundles,
      baseUrl: apiBaseUrl
    });
  }

  async function buildBroadcastBundle(streamId: string) {
    const snapshot = await store.read();
    const stream = snapshot.streams.find((entry) => entry.id === streamId);
    const run = stream ? snapshot.runs.find((entry) => entry.id === stream.runId) : null;
    const task = run ? await store.findTask(run.taskId) : null;
    if (!stream || !run || !task) return null;
    return buildBroadcastEvidenceBundle({
      broadcast: buildBroadcastPayload({
        stream,
        run,
        task,
        events: snapshot.events.filter((entry) => entry.runId === run.id),
        artifacts: snapshot.artifacts.filter((entry) => entry.runId === run.id),
        proofs: snapshot.proofs.filter((entry) => entry.runId === run.id)
      })
    });
  }

  async function buildSuiteRaceAudit(raceId: string) {
    const snapshot = await store.read();
    const race = snapshot.suiteRaces.find((entry) => entry.id === raceId);
    if (!race) return null;
    const tasks = await store.listTasks();
    return buildSuiteRaceAuditReport({
      race,
      matches: snapshot.matches,
      tasks,
      runs: snapshot.runs,
      events: snapshot.events,
      artifacts: snapshot.artifacts,
      proofs: snapshot.proofs,
      streams: snapshot.streams,
      scoreboard: snapshot.scoreboard
    });
  }

  async function buildSuiteRaceBundle(raceId: string) {
    const audit = await buildSuiteRaceAudit(raceId);
    return audit ? buildSuiteRaceEvidenceBundle({ audit }) : null;
  }

  async function buildCompetitionEventCampaignComparisons(scope: SeasonScope, snapshot: Awaited<ReturnType<SteambenchStore["read"]>>, apiBaseUrl: string) {
    const maxComparisons = 24;
    const consentedHumanIds = new Set(
      snapshot.users.filter((user) => user.type === "human" && user.linkedSteamId && user.proofConsentAt).map((user) => user.id)
    );
    const activeAgentIds = new Set(snapshot.agents.filter((agent) => agent.status === "active").map((agent) => agent.id));
    const registeredHumanIds = new Set(
      scope === "all"
        ? [...consentedHumanIds]
        : snapshot.eventRegistrations
            .filter((entry) => entry.eventScope === scope && entry.status === "registered" && entry.participantType === "human")
            .map((entry) => entry.participantId)
    );
    const registeredAgentIds = new Set(
      scope === "all"
        ? [...activeAgentIds]
        : snapshot.eventRegistrations
            .filter((entry) => entry.eventScope === scope && entry.status === "registered" && entry.participantType === "agent")
            .map((entry) => entry.participantId)
    );
    const humans = snapshot.users
      .filter((user) => user.type === "human" && registeredHumanIds.has(user.id) && consentedHumanIds.has(user.id))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const campaigns = snapshot.agentCampaigns
      .filter((campaign) => registeredAgentIds.has(campaign.agentId) && activeAgentIds.has(campaign.agentId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const comparisons = [];
    for (const human of humans) {
      for (const campaign of campaigns) {
        if (comparisons.length >= maxComparisons) return comparisons;
        comparisons.push({
          humanUserId: human.id,
          agentId: campaign.agentId,
          campaignId: campaign.id,
          bundle: await buildHumanAgentComparisonBundleFor({
            humanUserId: human.id,
            campaignId: campaign.id,
            apiBaseUrl
          }) ?? undefined
        });
      }
    }
    return comparisons;
  }

  async function buildCompetitionEventBundle(scope: SeasonScope, apiBaseUrl: string) {
    const snapshot = await store.read();
    const event = buildCompetitionEventSummary({
      scope,
      users: snapshot.users,
      agents: snapshot.agents,
      runs: snapshot.runs,
      matches: snapshot.matches,
      suiteRaces: snapshot.suiteRaces,
      scoreboard: snapshot.scoreboard,
      proofs: snapshot.proofs,
      streams: snapshot.streams,
      registrations: snapshot.eventRegistrations
    });
    const registrations = snapshot.eventRegistrations
      .filter((registration) => registration.eventScope === scope)
      .map((registration) => resolveCompetitionEventRegistration(registration, snapshot));
    const suiteRaces = await Promise.all(
      snapshot.suiteRaces
        .filter((race) => race.eventScope === scope)
        .map(async (race) => ({
          race,
          bundle: await buildSuiteRaceBundle(race.id) ?? undefined
        }))
    );
    return buildCompetitionEventEvidenceBundle({
      scope,
      event,
      registrations,
      suiteRaces,
      campaignComparisons: await buildCompetitionEventCampaignComparisons(scope, snapshot, apiBaseUrl)
    });
  }

  function buildProfileFromSnapshot(
    snapshot: Awaited<ReturnType<SteambenchStore["read"]>>,
    tasks: Awaited<ReturnType<SteambenchStore["listTasks"]>>,
    type: "human" | "agent",
    participantId: string
  ) {
    return buildCompetitorProfile({
      type,
      participantId,
      snapshot,
      tasks
    });
  }

  async function submitLocalHumanProof(runId: string, taskId: string, userId: string) {
    const task = await store.findTask(taskId);
    if (!task) return null;
    const detail = await store.getRun(runId);
    if (!detail) return null;
    if (detail.run.status === "scored") return { evaluation: { passed: true, missingProofs: [], run: detail.run, task }, detail };

    if (!detail.artifacts.some((artifact) => artifact.canonical && artifact.name === "output.mp4")) {
      await store.attachArtifact(runId, "output/output.mp4");
    }

    const refreshed = await store.getRun(runId);
    const requiredType = task.track === "achievement" ? "steam-achievement" : "manual-review";
    if (!refreshed?.proofs.some((proof) => proof.type === requiredType && proof.status === "verified")) {
      await store.createRunProof(
        task.track === "achievement"
          ? {
              runId,
              type: "steam-achievement",
              status: "verified",
              summary: `Local arena Steam achievement proof for ${task.title}.`,
              metadata: {
                appid: task.appid,
                taskId: task.id,
                userId,
                source: "arena-local"
              }
            }
          : {
              runId,
              type: "manual-review",
              status: "verified",
              summary: `Local arena manual review proof for ${task.title}.`,
              metadata: {
                appid: task.appid,
                taskId: task.id,
                userId,
                track: task.track,
                metricName: task.metricName ?? "",
                metricValue: simulatedMetricValue(task) ?? "",
                targetValue: task.targetValue ?? ""
              }
            }
      );
      await store.appendRunEvent({
        runId,
        type: "proof",
        message: `Local arena proof accepted for ${task.title}.`,
        metadata: {
          matchSide: "human",
          proofType: requiredType
        }
      });
    }

    return {
      evaluation: await store.evaluateRun(runId),
      detail: await store.getRun(runId)
    };
  }

  async function runLocalHumanSteamProofSubmission(input: {
    user: Awaited<ReturnType<SteambenchStore["read"]>>["users"][number];
    taskId: string;
    apiBaseUrl: string;
  }) {
    const task = await store.findTask(input.taskId);
    if (!task) return null;
    const run = await store.createRun({
      taskId: task.id,
      competitor: `human:${input.user.handle}`,
      competitorType: "human",
      runtimeProvider: "manual"
    });
    if (!run) return null;
    await store.appendRunEvent({
      runId: run.id,
      type: "plan",
      message: `Human Steam proof submission opened for ${input.user.displayName}.`,
      metadata: {
        userId: input.user.id,
        steamid: input.user.linkedSteamId ?? "",
        runtimeProvider: "manual",
        source: "human-steam-proof-plan"
      }
    });
    const submitted = await submitLocalHumanProof(run.id, task.id, input.user.id);
    const bundle = await buildEvidenceBundle(run.id, input.apiBaseUrl);
    return {
      run: submitted?.detail?.run ?? run,
      task,
      evaluation: submitted?.evaluation,
      detail: submitted?.detail,
      bundle,
      certificate: bundle
        ? buildRunResultCertificate({
            bundle,
            baseUrl: input.apiBaseUrl
          })
        : undefined
    };
  }

  async function simulateAgentAttempt(runId: string, taskId: string) {
    const task = await store.findTask(taskId);
    if (!task) return null;
    const detail = await store.getRun(runId);
    if (!detail) return null;
    if (detail.run.status === "scored") return { events: detail.events, stream: detail.streams[0], evaluation: { passed: true, missingProofs: [], run: detail.run, task }, detail };

    const events = [];
    for (const eventInput of buildSimulatedRuntimeEvents(runId, task)) {
      const event = await store.appendRunEvent(eventInput);
      if (event) events.push(event);
    }
    const stream = await store.createLiveStream(runId, `${detail.run.competitor} plays ${task.gameName}`);
    if (stream) {
      await store.updateLiveStreamStatus(stream.id, "live", {
        viewerCount: 1,
        currentScene: "Runtime booting"
      });
      await store.appendRunEvent({
        runId,
        type: "checkpoint",
        message: `Live broadcast opened at ${stream.playbackUrl}.`,
        metadata: {
          streamId: stream.id,
          playbackUrl: stream.playbackUrl
        }
      });
      await store.updateLiveStreamStatus(stream.id, "ended", {
        viewerCount: 0,
        currentScene: "Run complete"
      });
      await store.createRunProof({
        runId,
        type: "livestream",
        status: "verified",
        summary: `Livestream evidence captured at ${stream.playbackUrl}.`,
        metadata: {
          streamId: stream.id,
          playbackUrl: stream.playbackUrl
        }
      });
    }
    await store.createRunProof(
      task.track === "achievement"
        ? {
            runId,
            type: "steam-achievement",
            status: "verified",
            summary: `Simulated Steam achievement proof for ${task.title}.`,
            metadata: {
              appid: task.appid,
              taskId: task.id,
              achievement: task.title
            }
          }
        : {
            runId,
            type: "manual-review",
            status: "verified",
            summary: `Simulated benchmark review proof for ${task.track} task ${task.title}.`,
            metadata: {
              appid: task.appid,
              taskId: task.id,
              track: task.track,
              metricName: task.metricName ?? "",
              metricValue: simulatedMetricValue(task) ?? "",
              targetValue: task.targetValue ?? ""
            }
          }
    );
    await store.attachArtifact(runId, "output/output.mp4");
    const evaluation = await store.evaluateRun(runId);
    return {
      events,
      stream,
      evaluation,
      detail: await store.getRun(runId)
    };
  }

  async function buildAgentCampaignReportFor(campaign: BenchmarkAgentCampaign) {
    return buildAgentBenchmarkCampaignReport({
      campaign,
      snapshot: await store.read(),
      tasks: await store.listTasks()
    });
  }

  async function buildAgentCampaignBundle(campaignId: string, apiBaseUrl: string) {
    const campaign = await store.getAgentCampaign(campaignId);
    if (!campaign) return null;
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    const reports = snapshot.agentCampaigns.map((entry) =>
      buildAgentBenchmarkCampaignReport({
        campaign: entry,
        snapshot,
        tasks
      })
    );
    const report = reports.find((entry) => entry.campaign.id === campaign.id);
    if (!report) return null;
    const runBundles = await Promise.all(
      campaign.runIds.map(async (runId) => ({
        runId,
        bundle: await buildEvidenceBundle(runId, apiBaseUrl, campaign.agentId) ?? undefined
      }))
    );
    return buildAgentCampaignEvidenceBundle({
      report,
      runBundles,
      standings: buildAgentCampaignStandings(reports)
    });
  }

  async function buildDefaultHumanAgentComparison(input: {
    humanUserId?: string;
    campaignId?: string;
  } = {}) {
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    const human = input.humanUserId
      ? snapshot.users.find((entry) => entry.id === input.humanUserId)
      : snapshot.users.find((entry) => entry.type === "human" && entry.linkedSteamId && entry.proofConsentAt);
    const campaign = input.campaignId
      ? snapshot.agentCampaigns.find((entry) => entry.id === input.campaignId)
      : snapshot.agentCampaigns[0];
    if (!human || human.type !== "human" || !campaign) return null;
    const campaignReport = buildAgentBenchmarkCampaignReport({
      campaign,
      snapshot,
      tasks
    });
    return buildHumanAgentComparison({
      human,
      campaignReport,
      snapshot,
      tasks
    });
  }

  async function buildHumanAgentComparisonBundleFor(input: {
    humanUserId?: string;
    campaignId?: string;
    apiBaseUrl: string;
  }) {
    const comparison = await buildDefaultHumanAgentComparison({
      humanUserId: input.humanUserId,
      campaignId: input.campaignId
    });
    if (!comparison) return null;
    const campaignBundle = await buildAgentCampaignBundle(comparison.campaign.id, input.apiBaseUrl) ?? undefined;
    const runBundles = await Promise.all(
      comparison.items.map(async (item) => ({
        taskId: item.task.id,
        humanRunId: item.humanRun?.id,
        agentRunId: item.agentRun?.id,
        humanBundle: item.humanRun
          ? await buildEvidenceBundle(item.humanRun.id, input.apiBaseUrl) ?? undefined
          : undefined,
        agentBundle: item.agentRun
          ? await buildEvidenceBundle(item.agentRun.id, input.apiBaseUrl, comparison.campaign.agentId) ?? undefined
          : undefined
      }))
    );
    return buildHumanAgentComparisonEvidenceBundle({
      comparison,
      campaignBundle,
      runBundles
    });
  }

  function summarizeResultCertificate(certificate: ResultCertificate, links: Record<string, string> = {}): ResultCertificateIndexEntry {
    return {
      kind: certificate.kind,
      id: certificate.id,
      title: certificate.title,
      generatedAt: certificate.generatedAt,
      status: certificate.status,
      verdict: certificate.verdict,
      readyForPublicShare: certificate.integrity.readyForPublicShare,
      canonicalArtifactName: certificate.canonicalArtifactName,
      fingerprint: certificate.verification.fingerprint,
      verificationMethod: certificate.verification.method,
      participants: certificate.participants,
      tasks: certificate.tasks,
      result: certificate.result,
      links: {
        ...certificate.links,
        ...links
      }
    };
  }

  function parseResultCertificateIndexKind(value: unknown): ResultCertificateIndexKind | null {
    const kind = String(value ?? "all");
    return resultCertificateIndexKinds.has(kind as ResultCertificateIndexKind)
      ? kind as ResultCertificateIndexKind
      : null;
  }

  async function buildResultCertificateIndex(input: {
    kind: ResultCertificateIndexKind;
    limit: number;
    apiBaseUrl: string;
  }) {
    const snapshot = await store.read();
    const certificates: ResultCertificateIndexEntry[] = [];
    const shouldIndexKind = (kind: ResultCertificate["kind"]) => input.kind === "all" || input.kind === kind;
    const canAppendMore = () => certificates.length < input.limit;
    const appendCertificate = (certificate: ResultCertificate, links: Record<string, string> = {}) => {
      if (!canAppendMore() || !certificate.integrity.readyForPublicShare) return;
      certificates.push(summarizeResultCertificate(certificate, links));
    };

    if (shouldIndexKind("competition-event")) {
      const scopes: SeasonScope[] = ["weekly", "daily", "all"];
      for (const scope of scopes) {
        if (!canAppendMore()) break;
        appendCertificate(buildCompetitionEventResultCertificate({
          bundle: await buildCompetitionEventBundle(scope, input.apiBaseUrl),
          baseUrl: input.apiBaseUrl
        }));
      }
    }

    if (shouldIndexKind("game-coverage-run")) {
      const records = [...snapshot.gameCoverageRuns]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      for (const record of records) {
        if (!canAppendMore()) break;
        const bundle = await buildGameCoverageRunBundle(record.id, input.apiBaseUrl);
        if (!bundle) continue;
        appendCertificate(buildGameCoverageRunResultCertificate({
          bundle,
          baseUrl: input.apiBaseUrl
        }));
      }
    }

    if (shouldIndexKind("game-competition")) {
      const taskAppids = new Set((await store.listTasks()).map((task) => task.appid));
      const candidateAppids = [
        ...new Set([
          ...snapshot.scoreboard.flatMap((row) => row.appid ? [row.appid] : []),
          ...snapshot.gameCoverageRuns.map((record) => record.appid),
          ...taskAppids
        ])
      ].sort((left, right) => left - right);
      const scopes: SeasonScope[] = ["weekly", "daily", "all"];
      for (const appid of candidateAppids) {
        for (const scope of scopes) {
          if (!canAppendMore()) break;
          const bundle = await buildGameCompetitionBundle(appid, scope);
          if (!bundle) continue;
          appendCertificate(buildGameCompetitionResultCertificate({
            bundle,
            baseUrl: input.apiBaseUrl
          }));
        }
        if (!canAppendMore()) break;
      }
    }

    if (shouldIndexKind("human-agent-comparison")) {
      const humans = snapshot.users
        .filter((user) => user.type === "human" && user.linkedSteamId && user.proofConsentAt)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      const campaigns = [...snapshot.agentCampaigns]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      for (const human of humans) {
        for (const campaign of campaigns) {
          if (!canAppendMore()) break;
          const bundle = await buildHumanAgentComparisonBundleFor({
            humanUserId: human.id,
            campaignId: campaign.id,
            apiBaseUrl: input.apiBaseUrl
          });
          if (!bundle) continue;
          const certificate = buildHumanAgentComparisonResultCertificate({
            bundle,
            baseUrl: input.apiBaseUrl
          });
          appendCertificate(certificate);
        }
        if (!canAppendMore()) break;
      }
    }

    if (shouldIndexKind("suite-race")) {
      const races = [...snapshot.suiteRaces]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      for (const race of races) {
        if (!canAppendMore()) break;
        const bundle = await buildSuiteRaceBundle(race.id);
        if (!bundle) continue;
        appendCertificate(buildSuiteRaceResultCertificate({
          bundle,
          baseUrl: input.apiBaseUrl
        }), {
          resultCertificate: `${input.apiBaseUrl}/api/suite-races/${race.id}/result-certificate`
        });
      }
    }

    if (shouldIndexKind("agent-campaign")) {
      const campaigns = [...snapshot.agentCampaigns]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      for (const campaign of campaigns) {
        if (!canAppendMore()) break;
        const bundle = await buildAgentCampaignBundle(campaign.id, input.apiBaseUrl);
        if (!bundle) continue;
        appendCertificate(buildAgentCampaignResultCertificate({
          bundle,
          baseUrl: input.apiBaseUrl
        }));
      }
    }

    if (shouldIndexKind("broadcast")) {
      const streams = [...snapshot.streams]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      for (const stream of streams) {
        if (!canAppendMore()) break;
        const bundle = await buildBroadcastBundle(stream.id);
        if (!bundle) continue;
        appendCertificate(buildBroadcastResultCertificate({
          bundle,
          baseUrl: input.apiBaseUrl
        }));
      }
    }

    if (shouldIndexKind("match")) {
      const matches = [...snapshot.matches]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      for (const match of matches) {
        if (!canAppendMore()) break;
        const task = await store.findTask(match.taskId);
        if (!task) continue;
        const humanAudit = match.humanRunId ? await buildRunAudit(match.humanRunId) : undefined;
        const agentAudit = match.agentRunId ? await buildRunAudit(match.agentRunId) : undefined;
        appendCertificate(buildMatchResultCertificate({
          match,
          task,
          human: snapshot.users.find((entry) => entry.id === match.humanUserId),
          agent: snapshot.agents.find((entry) => entry.id === match.agentId),
          humanAudit: humanAudit ?? undefined,
          agentAudit: agentAudit ?? undefined,
          baseUrl: input.apiBaseUrl
        }));
      }
    }

    if (shouldIndexKind("challenge")) {
      const challenges = [...snapshot.challenges]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      for (const challenge of challenges) {
        if (!canAppendMore()) break;
        const task = await store.findTask(challenge.taskId);
        const match = challenge.matchId ? snapshot.matches.find((entry) => entry.id === challenge.matchId) : undefined;
        if (!task) continue;
        const humanAudit = match?.humanRunId ? await buildRunAudit(match.humanRunId) : undefined;
        const agentAudit = match?.agentRunId ? await buildRunAudit(match.agentRunId) : undefined;
        appendCertificate(buildChallengeResultCertificate({
          challenge,
          task,
          human: snapshot.users.find((user) => user.id === challenge.humanUserId),
          agent: snapshot.agents.find((agent) => agent.id === challenge.agentId),
          match,
          humanAudit: humanAudit ?? undefined,
          agentAudit: agentAudit ?? undefined,
          baseUrl: input.apiBaseUrl
        }));
      }
    }

    if (shouldIndexKind("run")) {
      const runs = [...snapshot.runs]
        .filter((run) => run.status === "scored")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      for (const run of runs) {
        if (!canAppendMore()) break;
        const requestedAgent = snapshot.agents.find((agent) => run.competitor === `agent:${agent.handle}`)?.id;
        const bundle = await buildEvidenceBundle(run.id, input.apiBaseUrl, requestedAgent);
        if (!bundle) continue;
        appendCertificate(buildRunResultCertificate({
          bundle,
          baseUrl: input.apiBaseUrl
        }), {
          resultCertificate: `${input.apiBaseUrl}/api/runs/${run.id}/result-certificate${requestedAgent ? `?agentId=${encodeURIComponent(requestedAgent)}` : ""}`
        });
      }
    }

    const byKind = certificates.reduce<Record<string, number>>((totals, certificate) => {
      totals[certificate.kind] = (totals[certificate.kind] ?? 0) + 1;
      return totals;
    }, {});

    return {
      schemaVersion: "steambench.result-certificate-index.v1",
      generatedAt: new Date().toISOString(),
      requested: {
        kind: input.kind,
        limit: input.limit,
        readyForPublicShare: true
      },
      totals: {
        certificates: certificates.length,
        readyForPublicShare: certificates.length,
        runs: byKind.run ?? 0,
        matches: byKind.match ?? 0,
        challenges: byKind.challenge ?? 0,
        suiteRaces: byKind["suite-race"] ?? 0,
        agentCampaigns: byKind["agent-campaign"] ?? 0,
        humanAgentComparisons: byKind["human-agent-comparison"] ?? 0,
        competitionEvents: byKind["competition-event"] ?? 0,
        broadcasts: byKind.broadcast ?? 0,
        gameCompetitions: byKind["game-competition"] ?? 0,
        gameCoverageRuns: byKind["game-coverage-run"] ?? 0,
        byKind
      },
      certificates,
      links: {
        verify: `${input.apiBaseUrl}/api/result-certificates/verify`
      }
    };
  }

  async function buildPublicBenchmarkSnapshot(input: {
    scope: SeasonScope;
    limit: number;
    apiBaseUrl: string;
  }) {
    const generatedAt = new Date().toISOString();
    const now = new Date(generatedAt);
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    const season = buildSeasonSnapshot(snapshot.scoreboard, input.scope, now);
    const seasons = buildSeasonSnapshots(snapshot.scoreboard, now);
    const events = buildCompetitionEvents({
      users: snapshot.users,
      agents: snapshot.agents,
      runs: snapshot.runs,
      matches: snapshot.matches,
      suiteRaces: snapshot.suiteRaces,
      scoreboard: snapshot.scoreboard,
      proofs: snapshot.proofs,
      streams: snapshot.streams,
      registrations: snapshot.eventRegistrations,
      now
    });
    const broadcastCenter = buildBroadcastCenter({
      snapshot,
      tasks,
      generatedAt,
      limit: input.limit
    });
    const certificateIndex = await buildResultCertificateIndex({
      kind: "all",
      limit: input.limit,
      apiBaseUrl: input.apiBaseUrl
    });
    const tasksByTrack = tasks.reduce<Record<string, number>>((totals, task) => {
      totals[task.track] = (totals[task.track] ?? 0) + 1;
      return totals;
    }, {});
    const summarizeBroadcast = (row: NonNullable<typeof broadcastCenter.featured>) => ({
      streamId: row.stream.id,
      status: row.stream.status,
      title: row.stream.title,
      viewerCount: row.viewerCount,
      scoreboardReady: row.scoreboardReady,
      proofReady: row.proofReady,
      runId: row.run.id,
      task: {
        id: row.task.id,
        appid: row.task.appid,
        gameName: row.task.gameName,
        title: row.task.title,
        track: row.task.track,
        level: row.task.level
      },
      links: {
        detail: `${input.apiBaseUrl}/api/broadcasts/${row.stream.id}`,
        publicWatch: `${input.apiBaseUrl}/api/public/broadcasts/${row.stream.id}/watch`,
        evidenceBundle: `${input.apiBaseUrl}/api/broadcasts/${row.stream.id}/evidence-bundle`,
        resultCertificate: `${input.apiBaseUrl}/api/broadcasts/${row.stream.id}/result-certificate`
      }
    });

    return {
      schemaVersion: "steambench.public-benchmark-snapshot.v1",
      generatedAt,
      scope: input.scope,
      canonicalArtifactName: "output.mp4",
      publicDataPolicy: {
        steamLiveEnabled: Boolean(process.env.STEAM_WEB_API_KEY),
        proofConsentRequiredBeforePublicRanking: true,
        officialSteamSourcesOnly: true
      },
      totals: {
        activeTasks: tasks.length,
        activeGames: new Set(tasks.map((task) => task.appid)).size,
        tasksByTrack,
        humans: snapshot.users.filter((user) => user.type === "human").length,
        steamLinkedHumans: snapshot.users.filter((user) => user.type === "human" && user.linkedSteamId).length,
        proofConsentedHumans: snapshot.users.filter((user) => user.type === "human" && user.linkedSteamId && user.proofConsentAt).length,
        agents: snapshot.agents.length,
        activeAgents: snapshot.agents.filter((agent) => agent.status === "active").length,
        scoredRuns: snapshot.runs.filter((run) => run.status === "scored").length,
        scoreboardRows: snapshot.scoreboard.length,
        broadcasts: broadcastCenter.totals.broadcasts,
        shareReadyCertificates: certificateIndex.totals.readyForPublicShare
      },
      season: {
        window: season.window,
        totals: season.standings.totals,
        topCompetitors: season.standings.competitors.slice(0, input.limit),
        topGames: season.standings.games.slice(0, input.limit),
        taskLeaderboards: season.leaderboards.slice(0, input.limit).map((leaderboard) => ({
          taskKey: leaderboard.taskKey,
          taskId: leaderboard.taskId,
          appid: leaderboard.appid,
          game: leaderboard.game,
          task: leaderboard.task,
          track: leaderboard.track,
          metricName: leaderboard.metricName,
          leader: leaderboard.leader,
          humanLeader: leaderboard.humanLeader,
          agentLeader: leaderboard.agentLeader,
          entries: leaderboard.entries.slice(0, 3)
        }))
      },
      seasons: seasons.map((entry) => ({
        window: entry.window,
        totals: entry.standings.totals,
        leaders: entry.standings.competitors.slice(0, 3)
      })),
      events: events.map((event) => ({
        id: event.id,
        scope: event.scope,
        title: event.title,
        window: event.window,
        status: event.status,
        entrants: event.entrants,
        score: event.score,
        matches: event.matches,
        suiteRaces: event.suiteRaces,
        leaders: event.leaders.slice(0, input.limit),
        links: {
          detail: `${input.apiBaseUrl}/api/competition-events/${event.scope}`,
          evidenceBundle: `${input.apiBaseUrl}/api/competition-events/${event.scope}/evidence-bundle`,
          resultCertificate: `${input.apiBaseUrl}/api/competition-events/${event.scope}/result-certificate`
        }
      })),
      broadcasts: {
        totals: broadcastCenter.totals,
        featured: broadcastCenter.featured ? summarizeBroadcast(broadcastCenter.featured) : undefined,
        live: broadcastCenter.live.slice(0, input.limit).map(summarizeBroadcast),
        scoreboardReady: broadcastCenter.scoreboardReady.slice(0, input.limit).map(summarizeBroadcast)
      },
      certificates: {
        totals: certificateIndex.totals,
        certificates: certificateIndex.certificates,
        links: certificateIndex.links
      },
      links: {
        state: `${input.apiBaseUrl}/api/state`,
        standings: `${input.apiBaseUrl}/api/standings?season=${input.scope}`,
        leaderboards: `${input.apiBaseUrl}/api/leaderboards?season=${input.scope}`,
        events: `${input.apiBaseUrl}/api/competition-events`,
        broadcasts: `${input.apiBaseUrl}/api/broadcasts/center`,
        certificateIndex: `${input.apiBaseUrl}/api/result-certificates?kind=all&limit=${input.limit}`,
        certificateVerify: `${input.apiBaseUrl}/api/result-certificates/verify`
      }
    };
  }

  async function buildPublicStandings(input: {
    scope: SeasonScope;
    appid?: number;
    track?: BenchmarkTask["track"];
    competitor?: "human" | "agent";
    limit?: number;
    apiBaseUrl: string;
  }) {
    const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 25)));
    const generatedAt = new Date().toISOString();
    const now = new Date(generatedAt);
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const taskById = new Map([...tasks, ...taskRegistry].map((task) => [task.id, task]));
    const filteredScoreboard = snapshot.scoreboard
      .filter((row) => input.appid === undefined || row.appid === input.appid)
      .filter((row) => input.track === undefined || row.track === input.track)
      .filter((row) => input.competitor === undefined || row.type === input.competitor);
    const season = buildSeasonSnapshot(filteredScoreboard, input.scope, now);
    const selectedGame = input.appid === undefined
      ? undefined
      : gameCatalog.find((entry) => entry.appid === input.appid) ??
        inferGameCatalogEntry({
          appid: input.appid,
          name: tasks.find((task) => task.appid === input.appid)?.gameName ??
            taskRegistry.find((task) => task.appid === input.appid)?.gameName ??
            snapshot.scoreboard.find((row) => row.appid === input.appid)?.game
        });
    const summarizeTask = (leaderboard: (typeof season.leaderboards)[number]) => {
      const task = leaderboard.taskId ? taskById.get(leaderboard.taskId) : undefined;
      const taskId = leaderboard.taskId ?? task?.id;
      return {
        taskKey: leaderboard.taskKey,
        taskId,
        appid: leaderboard.appid,
        game: leaderboard.game,
        task: leaderboard.task,
        track: leaderboard.track,
        metricName: leaderboard.metricName,
        leader: leaderboard.leader,
        humanLeader: leaderboard.humanLeader,
        agentLeader: leaderboard.agentLeader,
        entries: leaderboard.entries.slice(0, Math.min(5, limit)),
        runnable: task ? tasks.some((entry) => entry.id === task.id) : undefined,
        links: taskId
          ? {
              taskScoreboard: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(taskId)}/scoreboard?season=${input.scope}&limit=${limit}`,
              raceEntry: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(taskId)}/race-entry?limit=${limit}`,
              actionSpace: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(taskId)}/action-space`,
              quickstart: `${input.apiBaseUrl}/api/public/quickstart?season=${input.scope}${leaderboard.appid ? `&appid=${leaderboard.appid}` : ""}&taskId=${encodeURIComponent(taskId)}&provider=external&limit=${limit}`,
              runnerContract: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(taskId)}/runner-contract`
            }
          : undefined
      };
    };

    return {
      schemaVersion: "steambench.public-standings.v1",
      generatedAt,
      scope: input.scope,
      canonicalArtifactName: "output.mp4",
      filters: {
        season: input.scope,
        appid: input.appid,
        track: input.track,
        competitor: input.competitor,
        limit
      },
      selectedGame: selectedGame
        ? {
            appid: selectedGame.appid,
            name: selectedGame.name,
            benchmarkFit: selectedGame.benchmarkFit,
            harnessRisk: selectedGame.harnessRisk,
            tracks: selectedGame.tracks
          }
        : undefined,
      window: season.window,
      totals: {
        ...season.standings.totals,
        rows: season.window.rowCount,
        games: new Set(filteredScoreboard.map((row) => row.appid ?? row.game)).size,
        tasks: new Set(filteredScoreboard.map((row) => row.taskId ?? `${row.game}:${row.task}`)).size,
        humanRows: filteredScoreboard.filter((row) => row.type === "human").length,
        agentRows: filteredScoreboard.filter((row) => row.type === "agent").length
      },
      leaders: {
        competitors: season.standings.competitors.slice(0, limit),
        humans: season.standings.competitors.filter((entry) => entry.type === "human").slice(0, limit),
        agents: season.standings.competitors.filter((entry) => entry.type === "agent").slice(0, limit)
      },
      games: season.standings.games.slice(0, limit).map((entry) => ({
        ...entry,
        links: entry.leader.appid
          ? {
              catalog: `${input.apiBaseUrl}/api/public/catalog?season=${input.scope}&appid=${entry.leader.appid}&limit=${limit}`,
              benchmarkPack: `${input.apiBaseUrl}/api/public/games/${entry.leader.appid}/benchmark-pack?season=${input.scope}&limit=${limit}`,
              publicStandings: `${input.apiBaseUrl}/api/public/standings?season=${input.scope}&appid=${entry.leader.appid}&limit=${limit}`
            }
          : undefined
      })),
      matchups: season.standings.matchups.slice(0, limit),
      taskLeaderboards: season.leaderboards.slice(0, limit).map(summarizeTask),
      entrypoints: {
        publicCatalog: `${input.apiBaseUrl}/api/public/catalog?season=${input.scope}&limit=${limit}`,
        publicSnapshot: `${input.apiBaseUrl}/api/public/benchmark-snapshot?season=${input.scope}&limit=${limit}`,
        publicStandings: `${input.apiBaseUrl}/api/public/standings?season=${input.scope}&limit=${limit}`,
        publicStandingsTemplate: `${input.apiBaseUrl}/api/public/standings?season=${input.scope}&appid={appid}&track={track}&competitor={human_or_agent}&limit=${limit}`,
        taskScoreboardTemplate: `${input.apiBaseUrl}/api/public/tasks/{taskId}/scoreboard?season=${input.scope}&limit=${limit}`,
        taskRaceEntryTemplate: `${input.apiBaseUrl}/api/public/tasks/{taskId}/race-entry?humanUserId={userId}&agentId={agentId}&provider=external&limit=${limit}`,
        quickstartTemplate: `${input.apiBaseUrl}/api/public/quickstart?season=${input.scope}&appid={appid}&taskId={taskId}&provider=external&limit=${limit}`,
        resultCertificateIndex: `${input.apiBaseUrl}/api/result-certificates?kind=all&limit=${limit}`
      },
      links: {
        catalog: `${input.apiBaseUrl}/api/public/catalog?season=${input.scope}${input.appid ? `&appid=${input.appid}` : ""}&limit=${limit}`,
        snapshot: `${input.apiBaseUrl}/api/public/benchmark-snapshot?season=${input.scope}&limit=${limit}`,
        rawStandings: `${input.apiBaseUrl}/api/standings?season=${input.scope}`,
        rawLeaderboards: `${input.apiBaseUrl}/api/leaderboards?season=${input.scope}`
      },
      nextActions: [
        "Use task leaderboards to pick a human-vs-agent matchup.",
        "Open the public task scoreboard before displaying task-level results.",
        "Use race-entry and quickstart links before creating runs or matches."
      ]
    };
  }

  async function buildPublicCatalog(input: {
    scope: SeasonScope;
    appid?: number;
    track?: BenchmarkTask["track"];
    transport?: RuntimeControlSession["actionSpace"]["transport"];
    bridgeable?: boolean;
    provider?: AgentProfile["provider"];
    limit?: number;
    apiBaseUrl: string;
  }) {
    const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 24)));
    const generatedAt = new Date().toISOString();
    const now = new Date(generatedAt);
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const activeTaskIds = new Set(tasks.map((task) => task.id));
    const registryById = new Map(taskRegistry.map((task) => [task.id, task]));
    const allTaskRows = [
      ...tasks.map((task) => ({
        task,
        taskStatus: registryById.get(task.id)?.status ?? "active",
        runnable: true
      })),
      ...taskRegistry
        .filter((task) => !activeTaskIds.has(task.id) && task.status !== "rejected")
        .map((task) => ({
          task,
          taskStatus: task.status,
          runnable: false
        }))
    ];
    const season = buildSeasonSnapshot(snapshot.scoreboard, input.scope, now);
    const seasonLeaderboardByTaskId = new Map(season.leaderboards.map((leaderboard) => [leaderboard.taskId, leaderboard]));
    const isBridgeable = (task: BenchmarkTask) => {
      const plan = buildRuntimeRunPlan(task);
      return (
        plan.actionSpace.inputMode === "controller" &&
        plan.actionSpace.transport === "virtual-controller" &&
        plan.actionSpace.permissions.controller &&
        !plan.actionSpace.permissions.privilegedSystemInput
      );
    };
    const filteredRows = allTaskRows
      .map((entry) => {
        const plan = buildRuntimeRunPlan(entry.task);
        const bridgeable = isBridgeable(entry.task);
        return { ...entry, plan, bridgeable };
      })
      .filter((entry) => input.appid === undefined || entry.task.appid === input.appid)
      .filter((entry) => input.track === undefined || entry.task.track === input.track)
      .filter((entry) => input.transport === undefined || entry.plan.actionSpace.transport === input.transport)
      .filter((entry) => input.bridgeable === undefined || entry.bridgeable === input.bridgeable);
    const sortedRows = filteredRows.sort((left, right) =>
      Number(right.bridgeable) - Number(left.bridgeable) ||
      Number(right.runnable) - Number(left.runnable) ||
      right.task.score - left.task.score ||
      left.task.level - right.task.level ||
      left.task.gameName.localeCompare(right.task.gameName) ||
      left.task.title.localeCompare(right.task.title)
    );
    const gameAppids = [...new Set(filteredRows.map((entry) => entry.task.appid))];
    const games = gameAppids
      .map((appid) => {
        const gameTasks = filteredRows.filter((entry) => entry.task.appid === appid);
        const game = gameCatalog.find((entry) => entry.appid === appid) ??
          inferGameCatalogEntry({
            appid,
            name: gameTasks[0]?.task.gameName,
            benchmarkFit: snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid)?.benchmarkFit,
            harnessRisk: snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid)?.harnessRisk
          });
        const scoreRows = snapshot.scoreboard.filter((row) => row.appid === appid);
        const bestTask = gameTasks
          .sort((left, right) =>
            Number(right.bridgeable) - Number(left.bridgeable) ||
            Number(right.runnable) - Number(left.runnable) ||
            right.task.score - left.task.score ||
            left.task.level - right.task.level
          )[0];
        return {
          appid,
          name: game.name,
          benchmarkFit: game.benchmarkFit,
          harnessRisk: game.harnessRisk,
          tracks: [...new Set(gameTasks.map((entry) => entry.task.track))],
          activeTasks: gameTasks.filter((entry) => entry.runnable).length,
          candidateTasks: gameTasks.filter((entry) => entry.taskStatus === "candidate").length,
          bridgeableTasks: gameTasks.filter((entry) => entry.bridgeable).length,
          scoreboardRows: scoreRows.length,
          humanRows: scoreRows.filter((row) => row.type === "human").length,
          agentRows: scoreRows.filter((row) => row.type === "agent").length,
          bestTask: bestTask
            ? {
                id: bestTask.task.id,
                title: bestTask.task.title,
                track: bestTask.task.track,
                level: bestTask.task.level,
                runnable: bestTask.runnable,
                bridgeable: bestTask.bridgeable,
                transport: bestTask.plan.actionSpace.transport
              }
            : undefined,
          links: {
            catalog: `${input.apiBaseUrl}/api/public/catalog?season=${input.scope}&appid=${appid}&provider=${encodeURIComponent(input.provider ?? "external")}&limit=${limit}`,
            benchmarkPack: `${input.apiBaseUrl}/api/public/games/${appid}/benchmark-pack?season=${input.scope}&limit=${limit}`,
            steamIntake: `${input.apiBaseUrl}/api/public/steam/apps/${appid}/intake?limit=${limit}`,
            hub: `${input.apiBaseUrl}/api/public/competition-hub?season=${input.scope}&appid=${appid}&provider=${encodeURIComponent(input.provider ?? "external")}&limit=${limit}`,
            eventEntry: `${input.apiBaseUrl}/api/public/events/${input.scope}/entry?appid=${appid}&provider=${encodeURIComponent(input.provider ?? "external")}&limit=${limit}`,
            quickstart: `${input.apiBaseUrl}/api/public/quickstart?season=${input.scope}&appid=${appid}&provider=${encodeURIComponent(input.provider ?? "external")}&limit=${limit}`,
            standings: `${input.apiBaseUrl}/api/games/${appid}/standings?season=${input.scope}`
          }
        };
      })
      .sort((left, right) =>
        right.bridgeableTasks - left.bridgeableTasks ||
        right.scoreboardRows - left.scoreboardRows ||
        right.activeTasks - left.activeTasks ||
        right.benchmarkFit - left.benchmarkFit ||
        left.name.localeCompare(right.name)
      )
      .slice(0, limit);
    const taskRows = sortedRows.slice(0, limit).map((entry) => {
      const leaderboard = seasonLeaderboardByTaskId.get(entry.task.id);
      return {
        id: entry.task.id,
        appid: entry.task.appid,
        gameName: entry.task.gameName,
        title: entry.task.title,
        track: entry.task.track,
        level: entry.task.level,
        score: entry.task.score,
        taskStatus: entry.taskStatus,
        runnable: entry.runnable,
        suitability: entry.task.suitability,
        fairnessVerdict: entry.task.fairnessVerdict,
        riskFlags: entry.task.riskFlags,
        estimatedRuntimeMinutes: entry.task.estimatedRuntimeMinutes,
        actionSpace: {
          schemaVersion: entry.plan.actionSpace.schemaVersion,
          inputMode: entry.plan.actionSpace.inputMode,
          transport: entry.plan.actionSpace.transport,
          allowedActionTypes: entry.plan.actionSpace.allowedActionTypes,
          privilegedSystemInput: false,
          bridgeable: entry.bridgeable,
          requiresControlSession: entry.bridgeable
        },
        standings: leaderboard
          ? {
              rows: leaderboard.entries.length,
              leader: leaderboard.leader,
              humanLeader: leaderboard.humanLeader,
              agentLeader: leaderboard.agentLeader
            }
          : {
              rows: 0
            },
        evidence: {
          canonicalArtifactName: "output.mp4",
          canonicalArtifact: "output/output.mp4",
          proofRequirements: entry.task.track === "achievement"
            ? ["steam-achievement", "canonical-artifact"]
            : ["manual-review", "canonical-artifact"]
        },
        links: {
          eventEntry: `${input.apiBaseUrl}/api/public/events/${input.scope}/entry?appid=${entry.task.appid}&taskId=${encodeURIComponent(entry.task.id)}&provider=${encodeURIComponent(input.provider ?? "external")}&limit=${limit}`,
          quickstart: `${input.apiBaseUrl}/api/public/quickstart?season=${input.scope}&appid=${entry.task.appid}&taskId=${encodeURIComponent(entry.task.id)}&provider=${encodeURIComponent(input.provider ?? "external")}&limit=${limit}`,
          raceEntry: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(entry.task.id)}/race-entry?provider=${encodeURIComponent(input.provider ?? "external")}&limit=${limit}`,
          actionSpace: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(entry.task.id)}/action-space`,
          bridgeHandoff: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(entry.task.id)}/bridge-handoff?provider=${encodeURIComponent(input.provider ?? "external")}`,
          runnerContract: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(entry.task.id)}/runner-contract`,
          scoreboard: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(entry.task.id)}/scoreboard?season=${input.scope}&limit=${limit}`
        }
      };
    });

    return {
      schemaVersion: "steambench.public-catalog.v1",
      generatedAt,
      scope: input.scope,
      canonicalArtifactName: "output.mp4",
      publicDataPolicy: {
        steamLiveEnabled: Boolean(process.env.STEAM_WEB_API_KEY),
        proofConsentRequiredBeforePublicRanking: true,
        officialSteamSourcesOnly: true
      },
      filters: {
        season: input.scope,
        appid: input.appid,
        track: input.track,
        transport: input.transport,
        bridgeable: input.bridgeable,
        provider: input.provider ?? "external",
        limit
      },
      totals: {
        games: gameAppids.length,
        tasks: filteredRows.length,
        activeTasks: filteredRows.filter((entry) => entry.runnable).length,
        candidateTasks: filteredRows.filter((entry) => entry.taskStatus === "candidate").length,
        bridgeableTasks: filteredRows.filter((entry) => entry.bridgeable).length,
        scoreboardRows: snapshot.scoreboard.filter((row) =>
          filteredRows.some((entry) => entry.task.id === row.taskId || entry.task.appid === row.appid)
        ).length,
        humanRows: snapshot.scoreboard.filter((row) =>
          row.type === "human" && filteredRows.some((entry) => entry.task.id === row.taskId || entry.task.appid === row.appid)
        ).length,
        agentRows: snapshot.scoreboard.filter((row) =>
          row.type === "agent" && filteredRows.some((entry) => entry.task.id === row.taskId || entry.task.appid === row.appid)
        ).length
      },
      games,
      tasks: taskRows,
      entrypoints: {
        publicCatalog: `${input.apiBaseUrl}/api/public/catalog?season=${input.scope}&provider=${encodeURIComponent(input.provider ?? "external")}&limit=${limit}`,
        publicHub: `${input.apiBaseUrl}/api/public/competition-hub?season=${input.scope}&provider=${encodeURIComponent(input.provider ?? "external")}&limit=${limit}`,
        gameBenchmarkPackTemplate: `${input.apiBaseUrl}/api/public/games/{appid}/benchmark-pack?season=${input.scope}&limit=${limit}`,
        steamIntakeTemplate: `${input.apiBaseUrl}/api/public/steam/apps/{appid}/intake?limit=${limit}`,
        eventEntryTemplate: `${input.apiBaseUrl}/api/public/events/${input.scope}/entry?appid={appid}&taskId={taskId}&provider=${encodeURIComponent(input.provider ?? "external")}&limit=${limit}`,
        quickstartTemplate: `${input.apiBaseUrl}/api/public/quickstart?season=${input.scope}&appid={appid}&taskId={taskId}&provider=${encodeURIComponent(input.provider ?? "external")}&limit=${limit}`,
        actionSpaceTemplate: `${input.apiBaseUrl}/api/public/tasks/{taskId}/action-space?agentId={agentId}`,
        bridgeHandoffTemplate: `${input.apiBaseUrl}/api/public/tasks/{taskId}/bridge-handoff?agentId={agentId}&provider=${encodeURIComponent(input.provider ?? "external")}`,
        raceEntryTemplate: `${input.apiBaseUrl}/api/public/tasks/{taskId}/race-entry?humanUserId={userId}&agentId={agentId}&provider=${encodeURIComponent(input.provider ?? "external")}&limit=${limit}`,
        runnerContractTemplate: `${input.apiBaseUrl}/api/public/tasks/{taskId}/runner-contract?humanUserId={userId}&agentId={agentId}`,
        scoreboardTemplate: `${input.apiBaseUrl}/api/public/tasks/{taskId}/scoreboard?season=${input.scope}&limit=${limit}`
      },
      nextActions: [
        "Pick a catalog task, then inspect its public action-space.",
        "Use bridge-handoff before granting a GeForce NOW virtual-controller lease.",
        "Use quickstart for the end-to-end human Steam proof plus agent run-session checklist.",
        "Use race-entry and match preflight before creating a human-vs-agent match."
      ]
    };
  }

  async function buildPublicGameBenchmarkPack(input: {
    appid: number;
    scope: SeasonScope;
    limit: number;
    apiBaseUrl: string;
  }) {
    const generatedAt = new Date().toISOString();
    const snapshot = await store.read();
    const catalogGame = gameCatalog.find((entry) => entry.appid === input.appid);
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === input.appid);
    if (!catalogGame && !discovery) return null;

    const game = catalogGame ?? inferGameCatalogEntry({
      appid: input.appid,
      name: discovery?.name,
      benchmarkFit: discovery?.benchmarkFit,
      harnessRisk: discovery?.harnessRisk
    });
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const gameTasks = tasks.filter((task) => task.appid === input.appid);
    const gameRegistry = taskRegistry.filter((task) => task.appid === input.appid);
    const taskReviews = buildTaskReviews([
      ...tasks,
      ...gameRegistry.filter((entry) => !tasks.some((task) => task.id === entry.id))
    ]);
    const reviewsByTask = new Map(taskReviews.map((review) => [review.taskId, review]));
    const suites = buildBenchmarkSuites({
      games: [game],
      tasks,
      reviews: taskReviews
    });
    const broadcastCenter = buildBroadcastCenter({
      snapshot,
      tasks,
      generatedAt,
      limit: 100
    });
    const standings = buildGameCompetitionStandings({
      game,
      tasks,
      taskRegistry,
      scoreboard: snapshot.scoreboard,
      scope: input.scope,
      generatedAt
    });
    const coveragePlan = buildGameCoveragePlan({
      game,
      snapshot,
      tasks,
      taskRegistry,
      limit: Math.max(input.limit, 12)
    });
    const profile = buildGameBenchmarkProfile({
      game,
      tasks,
      taskRegistry,
      reviews: taskReviews,
      suites,
      scoreboard: snapshot.scoreboard,
      broadcasts: broadcastCenter.recent
    });
    const gameBundle = await buildGameCompetitionBundle(input.appid, input.scope);
    if (!gameBundle) return null;
    const certificate = buildGameCompetitionResultCertificate({
      bundle: gameBundle,
      baseUrl: input.apiBaseUrl
    });

    return {
      schemaVersion: "steambench.public-game-benchmark-pack.v1",
      generatedAt,
      appid: input.appid,
      scope: input.scope,
      canonicalArtifactName: "output.mp4",
      game,
      source: {
        catalog: catalogGame ? "curated" : "discovery",
        discoveryId: discovery?.id,
        discoveryStatus: discovery?.status,
        steamDataSources: ["app-list", "global-achievements", "schema-stats", "leaderboards", "linked-user-proof"]
      },
      profile: {
        totals: profile.totals,
        competition: profile.competition,
        levelRange: profile.levelRange,
        tracks: profile.tracks,
        topTasks: profile.topTasks.slice(0, input.limit).map((entry) => ({
          task: entry.task,
          review: entry.review
            ? {
                decision: entry.review.decision,
                fairnessVerdict: entry.review.fairnessVerdict,
                risks: entry.review.risks,
                controls: entry.review.controls
              }
            : undefined
        })),
        recentRows: profile.recentRows.slice(0, input.limit)
      },
      tasks: gameTasks
        .slice()
        .sort((left, right) => left.level - right.level || right.score - left.score || left.title.localeCompare(right.title))
        .slice(0, input.limit)
        .map((task) => {
          const review = reviewsByTask.get(task.id);
          return {
            id: task.id,
            appid: task.appid,
            gameName: task.gameName,
            title: task.title,
            track: task.track,
            level: task.level,
            score: task.score,
            objective: task.objective,
            proof: task.proof,
            estimatedRuntimeMinutes: task.estimatedRuntimeMinutes,
            suitability: task.suitability,
            fairnessVerdict: task.fairnessVerdict,
            source: task.source,
            metricName: task.metricName,
            targetValue: task.targetValue,
            scoringRule: task.scoringRule,
            review: review
              ? {
                  decision: review.decision,
                  fairnessVerdict: review.fairnessVerdict,
                  risks: review.risks,
                  controls: review.controls
                }
              : undefined,
            links: {
              review: `${input.apiBaseUrl}/api/tasks/${encodeURIComponent(task.id)}/review`,
              leaderboard: `${input.apiBaseUrl}/api/tasks/${encodeURIComponent(task.id)}/leaderboard?season=${input.scope}`,
              publicScoreboard: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/scoreboard?season=${input.scope}`,
              eligibility: `${input.apiBaseUrl}/api/tasks/${encodeURIComponent(task.id)}/eligibility`
            }
          };
        }),
      taskRegistry: {
        candidates: gameRegistry.filter((task) => task.status === "candidate").length,
        rejected: gameRegistry.filter((task) => task.status === "rejected").length,
        activeImports: gameRegistry.filter((task) => task.status === "active").length
      },
      suites: suites.slice(0, input.limit).map((suite) => ({
        id: suite.id,
        tier: suite.tier,
        title: suite.title,
        status: suite.status,
        taskCount: suite.taskCount,
        tracks: suite.tracks,
        levelRange: suite.levelRange,
        estimatedRuntimeMinutes: suite.estimatedRuntimeMinutes,
        readinessScore: suite.readinessScore,
        requiredControls: suite.requiredControls,
        riskFlags: suite.riskFlags,
        links: {
          preflight: `${input.apiBaseUrl}/api/benchmark-suites/${encodeURIComponent(suite.id)}/preflight`,
          race: `${input.apiBaseUrl}/api/benchmark-suites/${encodeURIComponent(suite.id)}/races`
        }
      })),
      standings: {
        season: standings.season,
        summary: standings.summary,
        totals: standings.totals,
        leaders: standings.leaders,
        competitors: standings.competitors.slice(0, input.limit),
        taskCoverage: standings.taskCoverage.slice(0, input.limit),
        taskLeaderboards: standings.taskLeaderboards.slice(0, input.limit).map((leaderboard) => ({
          taskKey: leaderboard.taskKey,
          taskId: leaderboard.taskId,
          game: leaderboard.game,
          task: leaderboard.task,
          track: leaderboard.track,
          leader: leaderboard.leader,
          humanLeader: leaderboard.humanLeader,
          agentLeader: leaderboard.agentLeader,
          entries: leaderboard.entries.slice(0, 3)
        }))
      },
      coverage: {
        totals: coveragePlan.totals,
        nextGaps: coveragePlan.items
          .filter((item) => item.priority !== "covered")
          .slice(0, input.limit)
          .map((item) => ({
            task: {
              id: item.task.id,
              title: item.task.title,
              track: item.task.track,
              level: item.task.level
            },
            gaps: item.gaps,
            priority: item.priority,
            nextActions: item.nextActions
          })),
        links: {
          coveragePlan: `${input.apiBaseUrl}/api/games/${input.appid}/coverage-plan`,
          scheduleCoverage: `${input.apiBaseUrl}/api/games/${input.appid}/coverage-plan/schedule`,
          runLocalCoverage: `${input.apiBaseUrl}/api/games/${input.appid}/coverage-plan/run-local`
        }
      },
      broadcasts: {
        totals: {
          broadcasts: profile.totals.broadcasts,
          scoreboardReady: profile.totals.scoreboardReadyBroadcasts,
          proofReady: profile.totals.proofReadyBroadcasts
        },
        recent: profile.broadcasts.slice(0, input.limit).map((row) => ({
          streamId: row.stream.id,
          title: row.stream.title,
          status: row.stream.status,
          viewerCount: row.viewerCount,
          scoreboardReady: row.scoreboardReady,
          proofReady: row.proofReady,
          links: {
            detail: `${input.apiBaseUrl}/api/broadcasts/${row.stream.id}`,
            publicWatch: `${input.apiBaseUrl}/api/public/broadcasts/${row.stream.id}/watch`,
            evidenceBundle: `${input.apiBaseUrl}/api/broadcasts/${row.stream.id}/evidence-bundle`,
            resultCertificate: `${input.apiBaseUrl}/api/broadcasts/${row.stream.id}/result-certificate`
          }
        }))
      },
      certificate: summarizeResultCertificate(certificate),
      runnerEntrypoints: {
        humanProofPlanTemplate: `${input.apiBaseUrl}/api/users/{userId}/steam-proof-plan?appid=${input.appid}`,
        humanSubmissionTemplate: `${input.apiBaseUrl}/api/users/{userId}/steam-proof-submissions`,
        agentActionSpaces: `${input.apiBaseUrl}/api/runtime/action-spaces?appid=${input.appid}&inputMode=controller&transport=virtual-controller&limit=${input.limit}`,
        agentRunSessionTemplate: `${input.apiBaseUrl}/api/agents/{agentId}/run-session`,
        matchPreflight: `${input.apiBaseUrl}/api/matches/preflight`,
        gameCompetitionRunLocal: `${input.apiBaseUrl}/api/games/${input.appid}/competition/run-local`
      },
      links: {
        profile: `${input.apiBaseUrl}/api/games/${input.appid}/profile`,
        standings: `${input.apiBaseUrl}/api/games/${input.appid}/standings?season=${input.scope}`,
        evidenceBundle: `${input.apiBaseUrl}/api/games/${input.appid}/evidence-bundle?season=${input.scope}`,
        resultCertificate: `${input.apiBaseUrl}/api/games/${input.appid}/result-certificate?season=${input.scope}`,
        benchmarkSuites: `${input.apiBaseUrl}/api/games/${input.appid}/benchmark-suites`,
        benchmarkBlueprint: `${input.apiBaseUrl}/api/games/${input.appid}/benchmark-blueprint`,
        coveragePlan: `${input.apiBaseUrl}/api/games/${input.appid}/coverage-plan`
      }
    };
  }

  function publicApiUrl(baseUrl: string, endpoint: string): string {
    if (/^https?:\/\//.test(endpoint)) return endpoint;
    return `${baseUrl.replace(/\/$/, "")}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  }

  function publicAction(input: {
    id: string;
    label: string;
    priority?: string;
    method: "GET" | "POST";
    endpoint: string;
    body?: Record<string, unknown>;
    reason?: string;
  }, apiBaseUrl: string) {
    return {
      id: input.id,
      label: input.label,
      priority: input.priority,
      method: input.method,
      endpoint: publicApiUrl(apiBaseUrl, input.endpoint),
      body: input.body,
      reason: input.reason
    };
  }

  async function buildPublicSteamAppIntake(input: {
    appid: number;
    useFixture?: boolean;
    refresh?: boolean;
    limit: number;
    gameName?: string;
    benchmarkFit?: number;
    harnessRisk?: "low" | "medium" | "high";
    apiBaseUrl: string;
  }) {
    const generatedAt = new Date().toISOString();
    const sourcePayload = await buildSteamTaskSourceOpsPayload({
      appid: input.appid,
      useFixture: input.useFixture,
      refresh: input.refresh,
      limit: input.limit,
      gameName: input.gameName,
      benchmarkFit: input.benchmarkFit,
      harnessRisk: input.harnessRisk
    });
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === input.appid);
    const game = gameCatalog.find((entry) => entry.appid === input.appid) ?? inferGameCatalogEntry({
      appid: input.appid,
      name: input.gameName ?? sourcePayload.ops.gameName ?? discovery?.name,
      benchmarkFit: input.benchmarkFit ?? discovery?.benchmarkFit,
      harnessRisk: input.harnessRisk ?? discovery?.harnessRisk
    });
    const blueprint = buildBenchmarkBlueprint({
      game,
      tasks,
      taskRegistry,
      discovery,
      taskSourceOps: sourcePayload.ops,
      generatedAt
    });
    const coveragePlan = buildGameCoveragePlan({
      game,
      snapshot,
      tasks,
      taskRegistry,
      limit: Math.max(input.limit, 12)
    });
    const onboarding = buildSteamAppOnboardingPipeline({
      discovery,
      ladder: sourcePayload.ladder,
      blueprint,
      coveragePlan,
      generatedAt
    });
    const activeTasks = tasks.filter((task) => task.appid === input.appid);
    const registryTasks = taskRegistry.filter((task) => task.appid === input.appid);
    const publicReadiness =
      onboarding.status === "competition-ready"
        ? "competition-ready"
        : onboarding.status === "coverage-ready"
          ? "coverage-ready"
          : sourcePayload.ops.status === "ready-to-publish"
            ? "publication-ready"
            : sourcePayload.ops.status === "ready-to-import"
              ? "import-ready"
              : "needs-source-data";

    return {
      schemaVersion: "steambench.public-steam-app-intake.v1",
      generatedAt,
      appid: input.appid,
      canonicalArtifactName: "output.mp4",
      publicReadiness,
      request: {
        useFixture: Boolean(input.useFixture),
        refresh: Boolean(input.refresh),
        limit: input.limit
      },
      dataPolicy: {
        steamLiveEnabled: Boolean(process.env.STEAM_WEB_API_KEY),
        officialSteamSourcesOnly: true,
        proofConsentRequiredBeforePublicRanking: true,
        cache: sourcePayload.policy.cache,
        allowedSources: sourcePayload.policy.allowedSources
      },
      game: {
        appid: game.appid,
        name: game.name,
        benchmarkFit: game.benchmarkFit,
        harnessRisk: game.harnessRisk,
        tracks: game.tracks
      },
      discovery: discovery
        ? {
            id: discovery.id,
            status: discovery.status,
            source: discovery.source,
            benchmarkFit: discovery.benchmarkFit,
            harnessRisk: discovery.harnessRisk,
            estimatedAchievementTasks: discovery.estimatedAchievementTasks
          }
        : undefined,
      intake: {
        status: onboarding.status,
        readinessScore: onboarding.readinessScore,
        sourceStatus: sourcePayload.ops.status,
        blueprintStatus: blueprint.status,
        nextActions: onboarding.nextActions,
        warnings: sourcePayload.warnings
      },
      sourceCoverage: {
        totals: sourcePayload.ops.totals,
        missingTracks: sourcePayload.ops.registry.missingCandidateTracks,
        sources: sourcePayload.ops.sources,
        recommendedActions: sourcePayload.ops.recommendedActions.map((action) => publicAction(action, input.apiBaseUrl))
      },
      taskPipeline: {
        activeTasks: activeTasks.length,
        candidateTasks: registryTasks.filter((task) => task.status === "candidate").length,
        rejectedTasks: registryTasks.filter((task) => task.status === "rejected").length,
        rankedReadyTasks: blueprint.reviewPlan.rankedReadyTasks,
        reviewRequiredTasks: blueprint.reviewPlan.reviewRequiredTasks,
        suites: blueprint.suites.map((suite) => ({
          id: suite.id,
          tier: suite.tier,
          title: suite.title,
          status: suite.status,
          taskCount: suite.taskCount,
          readinessScore: suite.readinessScore
        })),
        taskLadder: blueprint.taskLadder.map((band) => ({
          id: band.id,
          label: band.label,
          levelRange: band.levelRange,
          taskCount: band.taskCount,
          activeTasks: band.activeTasks,
          candidateTasks: band.candidateTasks,
          rankedReadyTasks: band.rankedReadyTasks,
          reviewRequiredTasks: band.reviewRequiredTasks,
          recommendedTaskIds: band.recommendedTaskIds,
          gaps: band.gaps
        }))
      },
      onboarding: {
        status: onboarding.status,
        readinessScore: onboarding.readinessScore,
        stages: onboarding.stages.map((stage) => ({
          id: stage.id,
          label: stage.label,
          status: stage.status,
          summary: stage.summary,
          metrics: stage.metrics,
          action: publicAction({
            id: stage.id,
            label: stage.action.label,
            method: stage.action.method,
            endpoint: stage.action.endpoint
          }, input.apiBaseUrl)
        })),
        nextActions: onboarding.nextActions
      },
      runtimeContract: {
        targetArtifactName: blueprint.runtimePlan.targetArtifactName,
        stage2StartConstraints: blueprint.runtimePlan.stage2StartConstraints,
        proofRequirements: blueprint.runtimePlan.proofRequirements,
        readinessChecks: blueprint.runtimePlan.readinessChecks,
        agentLoopHints: blueprint.runtimePlan.agentLoopHints,
        adapter: blueprint.runtimePlan.adapter
      },
      publicEntrypoints: {
	        benchmarkPack: `${input.apiBaseUrl}/api/public/games/${input.appid}/benchmark-pack?season=all&limit=${input.limit}`,
	        agentOnboarding: `${input.apiBaseUrl}/api/public/agents/onboarding?taskId={taskId}&provider=external`,
	        taskScoreboardTemplate: `${input.apiBaseUrl}/api/public/tasks/{taskId}/scoreboard?season=all`,
	        taskActionSpaceTemplate: `${input.apiBaseUrl}/api/public/tasks/{taskId}/action-space`,
	        raceEntryTemplate: `${input.apiBaseUrl}/api/public/tasks/{taskId}/race-entry`,
	        runnerContractTemplate: `${input.apiBaseUrl}/api/public/tasks/{taskId}/runner-contract`,
	        publicWatchTemplate: `${input.apiBaseUrl}/api/public/broadcasts/{streamId}/watch`,
        publicSnapshot: `${input.apiBaseUrl}/api/public/benchmark-snapshot?season=all&limit=${input.limit}`,
        certificateVerify: `${input.apiBaseUrl}/api/result-certificates/verify`
      },
      operatorEntrypoints: {
        taskSourceOps: `${input.apiBaseUrl}/api/steam/apps/${input.appid}/task-source-ops?useFixture=${Boolean(input.useFixture)}&limit=${input.limit}`,
        onboarding: `${input.apiBaseUrl}/api/steam/apps/${input.appid}/onboarding?useFixture=${Boolean(input.useFixture)}&limit=${input.limit}`,
        achievementLadder: `${input.apiBaseUrl}/api/steam/apps/${input.appid}/achievement-ladder?useFixture=${Boolean(input.useFixture)}`,
        importRecommended: `${input.apiBaseUrl}/api/steam/apps/${input.appid}/achievement-ladder/import-recommended`,
        publishCandidates: `${input.apiBaseUrl}/api/steam/apps/${input.appid}/publish-candidates`,
        runCoverageLocal: `${input.apiBaseUrl}/api/games/${input.appid}/coverage-plan/run-local`,
        runOnboardingLocal: `${input.apiBaseUrl}/api/steam/apps/${input.appid}/onboarding/run-local`
      },
      links: {
        blueprint: `${input.apiBaseUrl}/api/games/${input.appid}/benchmark-blueprint?includeSourcePlan=true&useFixture=${Boolean(input.useFixture)}&limit=${input.limit}`,
        coveragePlan: `${input.apiBaseUrl}/api/games/${input.appid}/coverage-plan`,
        standings: `${input.apiBaseUrl}/api/games/${input.appid}/standings?season=all`,
        resultCertificate: `${input.apiBaseUrl}/api/games/${input.appid}/result-certificate?season=all`
      }
    };
  }

  async function buildPublicTaskScoreboard(input: {
    taskId: string;
    scope: SeasonScope;
    limit: number;
    apiBaseUrl: string;
  }) {
    const snapshot = await store.read();
    const activeTask = await store.findTask(input.taskId);
    const registryTask = activeTask ? undefined : (await store.listTaskRegistry()).find((entry) => entry.id === input.taskId);
    const task = activeTask ?? registryTask;
    if (!task) return null;

    const season = buildSeasonSnapshot(snapshot.scoreboard, input.scope);
    const leaderboard = season.leaderboards.find((entry) => entry.taskId === task.id)
      ?? season.leaderboards.find((entry) => entry.taskKey === task.id)
      ?? season.leaderboards.find((entry) => entry.game === task.gameName && entry.task === task.title);
    const entries = (leaderboard?.entries ?? []).slice(0, input.limit);
    const humanEntries = (leaderboard?.entries ?? []).filter((entry) => entry.type === "human").slice(0, input.limit);
    const agentEntries = (leaderboard?.entries ?? []).filter((entry) => entry.type === "agent").slice(0, input.limit);
    const humanLeader = humanEntries[0];
    const agentLeader = agentEntries[0];
    const leader = entries[0] ?? leaderboard?.leader;
    const winnerType =
      humanLeader && agentLeader
        ? humanLeader.score > agentLeader.score
          ? "human"
          : agentLeader.score > humanLeader.score
            ? "agent"
            : "tie"
        : humanLeader
          ? "human"
          : agentLeader
            ? "agent"
            : undefined;
    const matchupStatus =
      humanLeader && agentLeader
        ? "complete"
        : humanLeader
          ? "human-only"
          : agentLeader
            ? "agent-only"
            : "empty";
    const withLinks = (entry: typeof entries[number]) => ({
      ...entry,
      canonicalArtifactName: "output.mp4" as const,
      links: {
        run: entry.runId ? `${input.apiBaseUrl}/api/runs/${encodeURIComponent(entry.runId)}` : undefined,
        audit: entry.runId ? `${input.apiBaseUrl}/api/runs/${encodeURIComponent(entry.runId)}/audit` : undefined,
        evidenceBundle: entry.runId ? `${input.apiBaseUrl}/api/runs/${encodeURIComponent(entry.runId)}/evidence-bundle` : undefined,
        resultCertificate: entry.runId ? `${input.apiBaseUrl}/api/runs/${encodeURIComponent(entry.runId)}/result-certificate` : undefined
      }
    });

    return {
      schemaVersion: "steambench.public-task-scoreboard.v1",
      generatedAt: new Date().toISOString(),
      scope: input.scope,
      canonicalArtifactName: "output.mp4",
      taskStatus: activeTask ? "active" : registryTask?.status ?? "unknown",
      runnable: Boolean(activeTask),
      task: {
        id: task.id,
        appid: task.appid,
        gameName: task.gameName,
        title: task.title,
        track: task.track,
        level: task.level,
        score: task.score,
        metricName: task.metricName,
        targetValue: task.targetValue,
        scoringRule: task.scoringRule
      },
      season: season.window,
      totals: {
        rows: leaderboard?.entries.length ?? 0,
        humanRows: leaderboard?.entries.filter((entry) => entry.type === "human").length ?? 0,
        agentRows: leaderboard?.entries.filter((entry) => entry.type === "agent").length ?? 0,
        hasHumanLeader: Boolean(humanLeader),
        hasAgentLeader: Boolean(agentLeader)
      },
      matchup: {
        status: matchupStatus,
        winnerType,
        margin: humanLeader && agentLeader ? Math.abs(humanLeader.score - agentLeader.score) : 0,
        leader: leader ? withLinks(leader) : undefined,
        humanLeader: humanLeader ? withLinks(humanLeader) : undefined,
        agentLeader: agentLeader ? withLinks(agentLeader) : undefined
      },
      entries: entries.map(withLinks),
      humanEntries: humanEntries.map(withLinks),
      agentEntries: agentEntries.map(withLinks),
      entrypoints: {
        runnerContract: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/runner-contract`,
        submitRunTemplate: `${input.apiBaseUrl}/api/runs/{runId}/submission`,
        humanProofSubmissionTemplate: `${input.apiBaseUrl}/api/users/{userId}/steam-proof-submissions`,
        agentRunSessionTemplate: `${input.apiBaseUrl}/api/agents/{agentId}/run-session`
      },
      links: {
        taskLeaderboard: `${input.apiBaseUrl}/api/tasks/${encodeURIComponent(task.id)}/leaderboard?season=${input.scope}`,
        runnerContract: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/runner-contract`,
        gameBenchmarkPack: `${input.apiBaseUrl}/api/public/games/${task.appid}/benchmark-pack?season=${input.scope}`,
        resultCertificates: `${input.apiBaseUrl}/api/result-certificates?kind=run&limit=${input.limit}`,
        certificateVerify: `${input.apiBaseUrl}/api/result-certificates/verify`
      }
    };
  }

  function buildPublicBroadcastWatch(input: {
    bundle: NonNullable<Awaited<ReturnType<typeof buildBroadcastBundle>>>;
    apiBaseUrl: string;
    timelineLimit?: number;
  }) {
    const { bundle } = input;
    const certificate = buildBroadcastResultCertificate({
      bundle,
      baseUrl: input.apiBaseUrl
    });
    const timelineLimit = Math.max(1, Math.min(50, Math.floor(input.timelineLimit ?? 8)));
    const timelinePreview = bundle.broadcast.timeline
      .filter((event) => event.importance !== "low")
      .slice(-timelineLimit)
      .map((event) => ({
        id: event.id,
        at: event.at,
        label: event.label,
        eventType: event.eventType,
        message: event.message,
        importance: event.importance
      }));

    return {
      schemaVersion: "steambench.public-broadcast-watch.v1",
      generatedAt: new Date().toISOString(),
      canonicalArtifactName: "output.mp4",
      stream: {
        id: bundle.broadcast.stream.id,
        runId: bundle.broadcast.stream.runId,
        status: bundle.broadcast.stream.status,
        provider: bundle.broadcast.stream.provider,
        title: bundle.broadcast.stream.title,
        playbackUrl: bundle.broadcast.stream.playbackUrl,
        viewerCount: bundle.broadcast.stream.viewerCount,
        currentScene: bundle.broadcast.stream.currentScene,
        createdAt: bundle.broadcast.stream.createdAt,
        startedAt: bundle.broadcast.stream.startedAt,
        endedAt: bundle.broadcast.stream.endedAt
      },
      run: {
        id: bundle.broadcast.run.id,
        status: bundle.broadcast.run.status,
        competitor: bundle.broadcast.run.competitor,
        competitorType: bundle.broadcast.run.competitorType,
        runtimeProvider: bundle.broadcast.run.runtimeProvider,
        score: bundle.broadcast.run.score,
        artifactName: bundle.broadcast.run.artifactName,
        updatedAt: bundle.broadcast.run.updatedAt
      },
      task: {
        id: bundle.broadcast.task.id,
        appid: bundle.broadcast.task.appid,
        gameName: bundle.broadcast.task.gameName,
        title: bundle.broadcast.task.title,
        track: bundle.broadcast.task.track,
        level: bundle.broadcast.task.level,
        score: bundle.broadcast.task.score
      },
      watch: {
        playable: bundle.integrity.streamPlayable,
        publicShareReady: certificate.integrity.readyForPublicShare,
        scoreboardReady: bundle.integrity.scoreboardPublished,
        proofReady: bundle.integrity.requiredProofsVerified,
        timelinePresent: bundle.integrity.timelinePresent,
        viewerCount: bundle.integrity.viewerCount,
        highImportanceEvents: bundle.integrity.highImportanceEvents,
        timelinePreview
      },
      evidence: {
        verdict: bundle.integrity.verdict,
        eventCount: bundle.integrity.eventCount,
        artifactCount: bundle.integrity.artifactCount,
        proofCount: bundle.integrity.proofCount,
        checkpointCount: bundle.broadcast.timeline.filter((event) => event.eventType === "checkpoint").length,
        executorReportCount: bundle.integrity.executorReportCount,
        latestExecutorReport: bundle.integrity.latestExecutorReport,
        canonicalArtifactPresent: bundle.integrity.canonicalArtifactPresent,
        requiredProofsVerified: bundle.integrity.requiredProofsVerified,
        scoreboardPublished: bundle.integrity.scoreboardPublished,
        checklist: bundle.integrity.checklist
      },
      certificate: summarizeResultCertificate(certificate),
      certificatePayload: certificate,
      verification: {
        method: certificate.verification.method,
        fingerprint: certificate.verification.fingerprint,
        endpoint: `${input.apiBaseUrl}/api/result-certificates/verify`,
        requestBodyTemplate: {
          certificate: "<steambench.result-certificate.v1>"
        }
      },
      entrypoints: {
        taskScoreboard: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(bundle.broadcast.task.id)}/scoreboard`,
        runnerContract: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(bundle.broadcast.task.id)}/runner-contract`,
        agentRunSessionTemplate: `${input.apiBaseUrl}/api/agents/{agentId}/run-session`
      },
      links: {
        broadcast: `${input.apiBaseUrl}/api/broadcasts/${bundle.streamId}`,
        evidenceBundle: `${input.apiBaseUrl}/api/broadcasts/${bundle.streamId}/evidence-bundle`,
        resultCertificate: `${input.apiBaseUrl}/api/broadcasts/${bundle.streamId}/result-certificate`,
        taskScoreboard: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(bundle.broadcast.task.id)}/scoreboard`,
        gameBenchmarkPack: `${input.apiBaseUrl}/api/public/games/${bundle.broadcast.task.appid}/benchmark-pack`,
        certificateVerify: `${input.apiBaseUrl}/api/result-certificates/verify`
      }
    };
  }

	  async function buildPublicTaskRunnerContract(input: {
	    taskId: string;
	    humanUserId?: string;
	    agentId?: string;
	    apiBaseUrl: string;
  }) {
    const snapshot = await store.read();
    const activeTask = await store.findTask(input.taskId);
    const registryTask = activeTask ? undefined : (await store.listTaskRegistry()).find((entry) => entry.id === input.taskId);
    const task = activeTask ?? registryTask;
    if (!task) return null;

    const human = input.humanUserId
      ? snapshot.users.find((user) => user.id === input.humanUserId && user.type === "human")
      : undefined;
    const agent = input.agentId
      ? snapshot.agents.find((entry) => entry.id === input.agentId)
      : undefined;
    const review = buildTaskReview(task);
    const plan = buildRuntimeRunPlan(task);
    const selectedAgentReadiness = buildRuntimeReadiness(task, agent);
    const eligibility = buildRaceEligibility({
      task,
      review,
      human,
      agent,
      agentReadiness: selectedAgentReadiness
    });
    const compatibleAgents = snapshot.agents
      .filter((entry) => entry.status === "active")
      .map((entry) => {
        const readiness = buildRuntimeReadiness(task, entry);
        return {
          id: entry.id,
          handle: entry.handle,
          displayName: entry.displayName,
          provider: entry.provider,
          runtimeProvider: entry.runtimeProvider,
          ready: readiness.ready,
          missingCapabilities: readiness.missingCapabilities
        };
      })
      .sort((left, right) =>
        Number(right.ready) - Number(left.ready) ||
        left.missingCapabilities.length - right.missingCapabilities.length ||
        left.handle.localeCompare(right.handle)
      );
    const taskRows = snapshot.scoreboard
      .filter((row) => row.taskId === task.id || (!row.taskId && row.appid === task.appid && row.task === task.title))
      .sort((left, right) => right.score - left.score || left.completedAt.localeCompare(right.completedAt));
    const active = Boolean(activeTask);
    const bridgeable =
      plan.actionSpace.inputMode === "controller" &&
      plan.actionSpace.transport === "virtual-controller" &&
      plan.actionSpace.permissions.controller &&
      !plan.actionSpace.permissions.privilegedSystemInput;
    const exampleExecutionPlan = compileControllerExecutionPlan(plan.actionSpace.examples, plan.actionSpace);
    const actionBatchEndpoint = `/api/runs/<run_id>/action-batches`;
    const actionBatchBodyTemplate = {
      controlSessionId: bridgeable ? "<active_control_session_id>" : undefined,
      observation: "Describe the visible game state before acting.",
      actions: plan.actionSpace.examples,
      confidence: 0.75,
      idempotencyKey: "agent:<run_id>:step-1"
    };

    return {
      schemaVersion: "steambench.public-task-runner-contract.v1",
      generatedAt: new Date().toISOString(),
      taskStatus: active ? "active" : registryTask?.status ?? "unknown",
      runnable: active,
      canonicalArtifactName: "output.mp4",
      task: {
        id: task.id,
        appid: task.appid,
        gameName: task.gameName,
        title: task.title,
        track: task.track,
        level: task.level,
        score: task.score,
        objective: task.objective,
        metricName: task.metricName,
        targetValue: task.targetValue,
        scoringRule: task.scoringRule,
        estimatedRuntimeMinutes: task.estimatedRuntimeMinutes,
        source: task.source
      },
      review: {
        decision: review.decision,
        reviewRequired: review.reviewRequired,
        fairnessVerdict: review.fairnessVerdict,
        controls: review.controls,
        risks: review.risks,
        recommendations: review.recommendations
      },
      scoring: {
        score: task.score,
        metricName: task.metricName,
        targetValue: task.targetValue,
        scoringRule: task.scoringRule,
        leaderboard: {
          rows: taskRows.length,
          leader: taskRows[0],
          humanLeader: taskRows.find((row) => row.type === "human"),
          agentLeader: taskRows.find((row) => row.type === "agent")
        }
      },
      proof: {
        requirements: eligibility.proofRequirements,
        canonicalArtifactPath: "output/output.mp4",
        artifactName: "output.mp4",
        captureHints: plan.adapter.evidenceHints
      },
      runtime: {
        plan,
        adapter: plan.adapter,
        actionSpace: plan.actionSpace,
        selectedAgentReadiness,
        compatibleAgents,
        bridge: {
          provider: "geforce-now",
          bridgeable,
          manifestRequired: "steambench.control-bridge-manifest.v1",
          executorRequest: "steambench.controller-executor-request.v1",
          executorReport: "steambench.controller-executor-report.v1",
          reason: bridgeable
            ? "Create a bounded control run session before handing actions to a virtual gamepad bridge."
            : "Use the declared action space transport; this task is not a virtual-controller bridge target."
        }
      },
      agentActionContract: {
        schemaVersion: "steambench.agent-action-contract.v1",
        observeBeforeAct: true,
        actionBatch: {
          method: "POST",
          endpoint: actionBatchEndpoint,
          requestBodyTemplate: actionBatchBodyTemplate,
          receiptSchemaVersion: "steambench.agent-action-batch-receipt.v1",
          acceptedActionLabels: plan.actionSpace.examples.map(actionLabel)
        },
        permissions: {
          inputMode: plan.actionSpace.inputMode,
          transport: plan.actionSpace.transport,
          allowedActionTypes: plan.actionSpace.allowedActionTypes,
          controller: plan.actionSpace.controller,
          constraints: plan.actionSpace.constraints,
          privilegedSystemInput: false
        },
        bridge: {
          required: bridgeable,
          provider: "geforce-now",
          prerequisites: bridgeable
            ? [
                "Create an agent run session with createControlSession=true.",
                "Fetch the runtime-control-access-packet or bridge manifest for the active lease.",
                "POST an action batch with controlSessionId before sending input to the executor.",
                "Submit the returned controller executor report to the run."
              ]
            : [
                "Use the declared action batch endpoint for this non-controller action space."
              ],
          executionPlanPreview: exampleExecutionPlan
            ? {
                schemaVersion: exampleExecutionPlan.schemaVersion,
                target: exampleExecutionPlan.target,
                timing: exampleExecutionPlan.timing,
                neutralOnCompletion: exampleExecutionPlan.neutralOnCompletion,
                stepCount: exampleExecutionPlan.steps.length,
                totalDurationMs: exampleExecutionPlan.totalDurationMs,
                maxBatchDurationMs: exampleExecutionPlan.maxBatchDurationMs
              }
            : undefined,
          executorRequest: bridgeable
            ? {
                availableAfter: "POST an action batch with an active controlSessionId.",
                schemaVersion: "steambench.controller-executor-request.v1",
                executor: "geforce-now",
                provider: "geforce-now-external",
                command: "npm run executor:geforce-now",
                reportSchemaVersion: "steambench.controller-executor-report.v1",
                reportEndpoint: "/api/runs/<run_id>/controller-executor-reports"
              }
            : undefined
        },
        evidence: {
          canonicalArtifact: "output/output.mp4",
          acceptedArtifactName: "output.mp4",
          forbiddenArtifactNames: ["output-test.mp4"]
        }
      },
      eligibility,
      runnerFlow: [
        "Inspect this runner contract and confirm the task is active.",
        "For humans, submit Steam/manual proof plus output/output.mp4 through the user proof entrypoint.",
        "For agents, create a run session or run, then use the action-space endpoint before submitting action batches.",
        "Attach canonical evidence and submit the run for scoring.",
        "Verify the result certificate before public sharing."
      ],
      entrypoints: {
        human: {
          createRun: active && human ? `${input.apiBaseUrl}/api/users/${human.id}/runs` : undefined,
          proofPlan: human ? `${input.apiBaseUrl}/api/users/${human.id}/steam-proof-plan?appid=${task.appid}` : undefined,
          proofSubmission: human ? `${input.apiBaseUrl}/api/users/${human.id}/steam-proof-submissions` : undefined,
          requiredBody: {
            taskId: task.id
          }
        },
	        agent: {
	          createRun: active && agent ? `${input.apiBaseUrl}/api/agents/${agent.id}/runs` : undefined,
	          runSession: active && agent ? `${input.apiBaseUrl}/api/agents/${agent.id}/run-session` : undefined,
	          publicActionSpace: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/action-space${agent ? `?agentId=${encodeURIComponent(agent.id)}` : ""}`,
	          actionSpaces: `${input.apiBaseUrl}/api/runtime/action-spaces?appid=${task.appid}&agentId=${agent?.id ?? ""}&limit=12`,
	          requiredBody: {
	            taskId: task.id,
	            createControlSession: bridgeable,
            ttlSeconds: 900
          }
        },
        match: {
          preflight: `${input.apiBaseUrl}/api/matches/preflight`,
          createMatch: `${input.apiBaseUrl}/api/matches`,
          requiredBody: {
            taskId: task.id
          }
        }
      },
	      links: {
	        taskReview: `${input.apiBaseUrl}/api/tasks/${encodeURIComponent(task.id)}/review`,
	        taskEligibility: `${input.apiBaseUrl}/api/tasks/${encodeURIComponent(task.id)}/eligibility`,
	        taskLeaderboard: `${input.apiBaseUrl}/api/tasks/${encodeURIComponent(task.id)}/leaderboard`,
	        taskActionSpace: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/action-space`,
	        gameBenchmarkPack: `${input.apiBaseUrl}/api/public/games/${task.appid}/benchmark-pack`,
	        gameStandings: `${input.apiBaseUrl}/api/games/${task.appid}/standings`,
	        resultCertificates: `${input.apiBaseUrl}/api/result-certificates?kind=run&limit=20`
	      }
	    };
	  }

	  async function buildPublicTaskActionSpace(input: {
	    taskId: string;
	    agentId?: string;
	    apiBaseUrl: string;
	  }) {
	    const snapshot = await store.read();
	    const activeTask = await store.findTask(input.taskId);
	    const registryTask = activeTask ? undefined : (await store.listTaskRegistry()).find((entry) => entry.id === input.taskId);
	    const task = activeTask ?? registryTask;
	    if (!task) return null;

	    const agent = input.agentId
	      ? snapshot.agents.find((entry) => entry.id === input.agentId || entry.handle === input.agentId)
	      : undefined;
	    const plan = buildRuntimeRunPlan(task);
	    const readiness = buildRuntimeReadiness(task, agent);
	    const active = Boolean(activeTask);
	    const bridgeable =
	      plan.actionSpace.inputMode === "controller" &&
	      plan.actionSpace.transport === "virtual-controller" &&
	      plan.actionSpace.permissions.controller &&
	      !plan.actionSpace.permissions.privilegedSystemInput;
	    const exampleExecutionPlan = compileControllerExecutionPlan(plan.actionSpace.examples, plan.actionSpace);
	    const publicActionSpaceUrl = `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/action-space`;

	    return {
	      schemaVersion: "steambench.public-task-action-space.v1",
	      generatedAt: new Date().toISOString(),
	      taskStatus: active ? "active" : registryTask?.status ?? "unknown",
	      runnable: active,
	      canonicalArtifactName: "output.mp4",
	      task: {
	        id: task.id,
	        appid: task.appid,
	        gameName: task.gameName,
	        title: task.title,
	        track: task.track,
	        level: task.level,
	        estimatedRuntimeMinutes: task.estimatedRuntimeMinutes
	      },
	      runtime: {
	        runtime: plan.runtime,
	        targetArtifact: plan.targetArtifact,
	        controlSurface: plan.controlSurface,
	        adapter: plan.adapter,
	        actionSpace: plan.actionSpace
	      },
	      permissions: {
	        schemaVersion: plan.actionSpace.schemaVersion,
	        inputMode: plan.actionSpace.inputMode,
	        transport: plan.actionSpace.transport,
	        allowedActionTypes: plan.actionSpace.allowedActionTypes,
	        controller: plan.actionSpace.controller,
	        constraints: plan.actionSpace.constraints,
	        privilegedSystemInput: false,
	        observeBeforeAct: true
	      },
	      selectedAgent: agent
	        ? {
	            id: agent.id,
	            handle: agent.handle,
	            displayName: agent.displayName,
	            provider: agent.provider,
	            runtimeProvider: agent.runtimeProvider,
	            status: agent.status,
	            readiness
	          }
	        : undefined,
	      bridge: {
	        provider: "geforce-now",
	        bridgeable,
	        required: bridgeable,
	        manifestRequired: "steambench.control-bridge-manifest.v1",
	        executorRequest: "steambench.controller-executor-request.v1",
	        executorReport: "steambench.controller-executor-report.v1",
	        reason: bridgeable
	          ? "This task can be driven through a bounded virtual-controller lease before a GeForce NOW bridge sends input."
	          : "Use this task's declared transport; it is not a virtual-controller bridge target."
	      },
	      exampleActionBatch: {
	        schemaVersion: "steambench.public-agent-action-batch-template.v1",
	        endpoint: "/api/runs/<run_id>/action-batches",
	        requiresControlSessionId: bridgeable,
	        requestBodyTemplate: {
	          controlSessionId: bridgeable ? "<active_control_session_id>" : undefined,
	          observation: "Describe the visible game state before acting.",
	          actions: plan.actionSpace.examples,
	          confidence: 0.75,
	          idempotencyKey: "agent:<run_id>:step-1"
	        },
	        acceptedActionLabels: plan.actionSpace.examples.map(actionLabel),
	        executionPlanPreview: exampleExecutionPlan
	          ? {
	              schemaVersion: exampleExecutionPlan.schemaVersion,
	              target: exampleExecutionPlan.target,
	              timing: exampleExecutionPlan.timing,
	              neutralOnCompletion: exampleExecutionPlan.neutralOnCompletion,
	              stepCount: exampleExecutionPlan.steps.length,
	              totalDurationMs: exampleExecutionPlan.totalDurationMs,
	              maxBatchDurationMs: exampleExecutionPlan.maxBatchDurationMs
	            }
	          : undefined
	      },
	      controlSession: {
	        requiredBeforeHostInput: bridgeable,
	        ttlSecondsDefault: 900,
	        createRunSessionBody: {
	          taskId: task.id,
	          createControlSession: bridgeable,
	          ttlSeconds: 900
	        },
	        accessPacketSchemaVersion: "steambench.runtime-control-access-packet.v1",
	        bridgeManifestSchemaVersion: "steambench.control-bridge-manifest.v1"
	      },
	      evidence: {
	        canonicalArtifact: "output/output.mp4",
	        acceptedArtifactName: "output.mp4",
	        forbiddenArtifactNames: ["output-test.mp4"]
	      },
	      entrypoints: {
	        publicActionSpace: publicActionSpaceUrl,
	        runnerContract: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/runner-contract`,
	        createRun: active && agent ? `${input.apiBaseUrl}/api/agents/${agent.id}/runs` : undefined,
	        runSession: active && agent ? `${input.apiBaseUrl}/api/agents/${agent.id}/run-session` : undefined,
	        actionBatch: "/api/runs/<run_id>/action-batches",
	        controlSessions: "/api/runs/<run_id>/control-sessions",
	        executorReport: "/api/runs/<run_id>/controller-executor-reports"
	      },
	      links: {
	        runtimeActionSpaceCatalog: `${input.apiBaseUrl}/api/runtime/action-spaces?appid=${task.appid}${agent ? `&agentId=${encodeURIComponent(agent.id)}` : ""}&limit=12`,
	        controlBridgeOps: `${input.apiBaseUrl}/api/control-sessions/ops-report?transport=virtual-controller`,
	        taskLeaderboard: `${input.apiBaseUrl}/api/tasks/${encodeURIComponent(task.id)}/leaderboard`,
	        gameBenchmarkPack: `${input.apiBaseUrl}/api/public/games/${task.appid}/benchmark-pack`
	      }
	    };
	  }

	  async function buildPublicAgentOnboarding(input: {
	    taskId?: string;
	    agentId?: string;
	    provider?: AgentProfile["provider"];
	    apiBaseUrl: string;
	    limit?: number;
	  }) {
	    const snapshot = await store.read();
	    const tasks = await store.listTasks();
	    const registryTask = input.taskId
	      ? (await store.listTaskRegistry()).find((entry) => entry.id === input.taskId)
	      : undefined;
	    const selectedTask = input.taskId
	      ? (tasks.find((task) => task.id === input.taskId) ?? registryTask)
	      : (tasks.find((task) => buildRuntimeRunPlan(task).actionSpace.transport === "virtual-controller") ?? tasks[0]);
	    if (!selectedTask) return null;

	    const agent = input.agentId
	      ? snapshot.agents.find((entry) => entry.id === input.agentId || entry.handle === input.agentId)
	      : undefined;
	    const provider = input.provider ?? agent?.provider ?? "external";
	    const runtimeProvider = provider === "modal" ? "modal" : "local-sim";
	    const plan = buildRuntimeRunPlan(selectedTask);
	    const readiness = buildRuntimeReadiness(selectedTask, agent);
	    const selectedActionSpace = plan.actionSpace;
	    const bridgeable =
	      selectedActionSpace.inputMode === "controller" &&
	      selectedActionSpace.transport === "virtual-controller" &&
	      selectedActionSpace.permissions.controller &&
	      !selectedActionSpace.permissions.privilegedSystemInput;
	    const limit = Math.max(1, Math.min(20, Math.floor(input.limit ?? 6)));
	    const recommendations = tasks
	      .map((task) => {
	        const taskPlan = buildRuntimeRunPlan(task);
	        const taskReadiness = buildRuntimeReadiness(task, agent);
	        const taskBridgeable = taskPlan.actionSpace.transport === "virtual-controller" &&
	          taskPlan.actionSpace.permissions.controller &&
	          !taskPlan.actionSpace.permissions.privilegedSystemInput;
	        return {
	          task: {
	            id: task.id,
	            appid: task.appid,
	            gameName: task.gameName,
	            title: task.title,
	            track: task.track,
	            level: task.level,
	            estimatedRuntimeMinutes: task.estimatedRuntimeMinutes
	          },
	          readiness: taskReadiness,
	          actionSpace: {
	            inputMode: taskPlan.actionSpace.inputMode,
	            transport: taskPlan.actionSpace.transport,
	            allowedActionTypes: taskPlan.actionSpace.allowedActionTypes
	          },
	          bridgeable: taskBridgeable,
	          links: {
	            publicActionSpace: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/action-space${agent ? `?agentId=${encodeURIComponent(agent.id)}` : ""}`,
	            runnerContract: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/runner-contract${agent ? `?agentId=${encodeURIComponent(agent.id)}` : ""}`,
	            scoreboard: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/scoreboard?season=all&limit=12`
	          }
	        };
	      })
	      .sort((left, right) =>
	        Number(right.readiness.ready) - Number(left.readiness.ready) ||
	        Number(right.bridgeable) - Number(left.bridgeable) ||
	        left.task.level - right.task.level ||
	        left.task.title.localeCompare(right.task.title)
	      )
	      .slice(0, limit);

	    return {
	      schemaVersion: "steambench.public-agent-onboarding.v1",
	      generatedAt: new Date().toISOString(),
	      status: agent
	        ? readiness.ready
	          ? "ready-to-run"
	          : "missing-capabilities"
	        : "ready-to-register",
	      selectedTask: {
	        id: selectedTask.id,
	        appid: selectedTask.appid,
	        gameName: selectedTask.gameName,
	        title: selectedTask.title,
	        track: selectedTask.track,
	        level: selectedTask.level,
	        taskStatus: tasks.some((task) => task.id === selectedTask.id) ? "active" : registryTask?.status ?? "unknown",
	        runnable: tasks.some((task) => task.id === selectedTask.id)
	      },
	      selectedAgent: agent
	        ? {
	            id: agent.id,
	            handle: agent.handle,
	            displayName: agent.displayName,
	            provider: agent.provider,
	            runtimeProvider: agent.runtimeProvider,
	            status: agent.status,
	            capabilities: agent.capabilities
	          }
	        : undefined,
	      registration: {
	        endpoint: `${input.apiBaseUrl}/api/agents`,
	        method: "POST",
	        provider,
	        runtimeProvider,
	        requiredCapabilities: readiness.requiredCapabilities,
	        recommendedCapabilities: [...new Set([
	          ...readiness.requiredCapabilities,
	          ...selectedActionSpace.allowedActionTypes.map((type) => `action:${type}`),
	          ...(bridgeable ? ["virtual-controller", "geforce-now-bridge"] : [])
	        ])],
	        requestBodyTemplate: {
	          handle: "external-agent",
	          displayName: "External Runtime Agent",
	          provider,
	          runtimeProvider,
	          command: provider === "external"
	            ? "external-runner consumes public action-space and submits action batches"
	            : "node scripts/runtime-worker.mjs",
	          capabilities: readiness.requiredCapabilities
	        }
	      },
	      readiness,
	      actionSpace: {
	        publicPacket: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(selectedTask.id)}/action-space${agent ? `?agentId=${encodeURIComponent(agent.id)}` : ""}`,
	        schemaVersion: selectedActionSpace.schemaVersion,
	        inputMode: selectedActionSpace.inputMode,
	        transport: selectedActionSpace.transport,
	        allowedActionTypes: selectedActionSpace.allowedActionTypes,
	        bridgeable,
	        requiresControlSession: bridgeable,
	        exampleActions: selectedActionSpace.examples.map(actionLabel)
	      },
	      runEntry: {
	        runnerContract: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(selectedTask.id)}/runner-contract${agent ? `?agentId=${encodeURIComponent(agent.id)}` : ""}`,
	        runSession: agent ? `${input.apiBaseUrl}/api/agents/${agent.id}/run-session` : undefined,
	        createRun: agent ? `${input.apiBaseUrl}/api/agents/${agent.id}/runs` : undefined,
	        runSessionBodyTemplate: {
	          taskId: selectedTask.id,
	          createControlSession: bridgeable,
	          ttlSeconds: 900
	        }
	      },
	      taskRecommendations: recommendations,
	      nextActions: agent
	        ? readiness.ready
	          ? [
	              "Fetch the public task action-space packet.",
	              "Open a run session with createControlSession=true when bridgeable.",
	              "Submit observe-before-act batches and canonical output/output.mp4 evidence."
	            ]
	          : [
	              "Update the agent profile with the missing capabilities before queueing runs."
	            ]
	        : [
	            "Register an agent profile with the request body template.",
	            "Refresh this onboarding packet with agentId.",
	            "Validate the public action-space packet before opening a run session."
	          ],
	      links: {
	        agents: `${input.apiBaseUrl}/api/agents`,
	        agentOps: `${input.apiBaseUrl}/api/agents/ops-report`,
	        runtimeActionSpaces: `${input.apiBaseUrl}/api/runtime/action-spaces`,
	        publicActionSpace: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(selectedTask.id)}/action-space`,
	        publicRunner: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(selectedTask.id)}/runner-contract`
	      }
	    };
	  }

	  async function buildPublicTaskRaceEntry(input: {
	    taskId: string;
	    humanUserId?: string;
	    agentId?: string;
	    provider?: AgentProfile["provider"];
	    apiBaseUrl: string;
	    limit?: number;
	  }) {
	    const snapshot = await store.read();
	    const tasks = await store.listTasks();
	    const registryTask = (await store.listTaskRegistry()).find((entry) => entry.id === input.taskId);
	    const activeTask = tasks.find((entry) => entry.id === input.taskId);
	    const task = activeTask ?? registryTask;
	    if (!task) return null;

	    const limit = Math.max(1, Math.min(20, Math.floor(input.limit ?? 6)));
	    const human = input.humanUserId
	      ? snapshot.users.find((entry) => entry.id === input.humanUserId && entry.type === "human")
	      : undefined;
	    const agent = input.agentId
	      ? snapshot.agents.find((entry) => entry.id === input.agentId || entry.handle === input.agentId)
	      : undefined;
	    const humanProofPlan = human
	      ? buildHumanSteamProofPlan({
	          user: human,
	          snapshot,
	          tasks,
	          limit: Math.max(limit, tasks.length)
	        })
	      : undefined;
	    const humanEntry = humanProofPlan?.items.find((entry) => entry.task.id === task.id);
	    const actionSpace = await buildPublicTaskActionSpace({
	      taskId: task.id,
	      agentId: agent?.id,
	      apiBaseUrl: input.apiBaseUrl
	    });
	    const agentOnboarding = await buildPublicAgentOnboarding({
	      taskId: task.id,
	      agentId: agent?.id,
	      provider: input.provider ?? agent?.provider ?? "external",
	      limit,
	      apiBaseUrl: input.apiBaseUrl
	    });
	    const eligibility = activeTask && human && agent
	      ? await buildTaskRaceEligibility(task.id, human.id, agent.id)
	      : undefined;
	    const humanStatus = human
	      ? humanEntry?.status ?? "unsupported"
	      : "missing-human";
	    const humanReady = humanEntry?.entryPacket.readyForSubmission === true;
	    const agentReady = agentOnboarding?.status === "ready-to-run";
	    const readyForMatch = Boolean(activeTask && humanReady && agentReady && eligibility?.ready);
	    const humanNextActions = !human
	      ? [
	          "Create or select a human user.",
	          "Link Steam and grant proof consent before public ranking.",
	          "Refresh this race-entry packet with humanUserId."
	        ]
	      : humanReady
	        ? ["Human proof packet is ready for this task."]
	        : (humanEntry?.entryPacket.blockers.map((blocker) => blocker.label) ?? [
	            "This human cannot submit proof for the selected task yet."
	          ]);
	    const agentNextActions = !agent
	      ? [
	          "Register or select an agent.",
	          "Refresh this race-entry packet with agentId.",
	          "Open the public action-space before sending input."
	        ]
	      : agentReady
	        ? ["Agent onboarding is ready for this task."]
	        : ["Update the agent profile with missing capabilities before queueing a match."];
	    const matchNextActions = readyForMatch
	      ? [
	          "POST the preflight body to confirm eligibility.",
	          "POST the same participants to /api/matches to create the race.",
	          "Start the match and use the arena packet for live execution."
	        ]
	      : [
	          "Resolve human and agent blockers before creating a match."
	        ];

	    return {
	      schemaVersion: "steambench.public-task-race-entry.v1",
	      generatedAt: new Date().toISOString(),
	      taskStatus: activeTask ? "active" : registryTask?.status ?? "unknown",
	      runnable: Boolean(activeTask),
	      readyForMatch,
	      canonicalArtifactName: "output.mp4",
	      task: {
	        id: task.id,
	        appid: task.appid,
	        gameName: task.gameName,
	        title: task.title,
	        track: task.track,
	        level: task.level,
	        score: task.score,
	        objective: task.objective,
	        metricName: task.metricName,
	        targetValue: task.targetValue,
	        scoringRule: task.scoringRule,
	        estimatedRuntimeMinutes: task.estimatedRuntimeMinutes
	      },
	      human: {
	        status: humanStatus,
	        ready: humanReady,
	        selectedUser: human
	          ? {
	              id: human.id,
	              handle: human.handle,
	              displayName: human.displayName,
	              linkedSteamId: human.linkedSteamId,
	              proofConsentAt: human.proofConsentAt
	            }
	          : undefined,
	        entryPacket: humanEntry?.entryPacket,
	        proofPlan: human ? `${input.apiBaseUrl}/api/users/${human.id}/steam-proof-plan?limit=${limit}` : undefined,
	        proofSubmission: human ? `${input.apiBaseUrl}/api/users/${human.id}/steam-proof-submissions` : undefined,
	        linkSteam: human ? `${input.apiBaseUrl}/api/users/${human.id}/steam` : undefined,
	        proofConsent: human ? `${input.apiBaseUrl}/api/users/${human.id}/steam-proof-consent` : undefined,
	        nextActions: humanNextActions
	      },
	      agent: {
	        status: agentOnboarding?.status,
	        ready: agentReady,
	        selectedAgent: agentOnboarding?.selectedAgent,
	        onboarding: agentOnboarding,
	        nextActions: agentNextActions
	      },
	      actionSpace,
	      runnerContract: {
	        endpoint: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/runner-contract${agent ? `?agentId=${encodeURIComponent(agent.id)}` : ""}`,
	        method: "GET"
	      },
	      match: {
	        preflight: {
	          endpoint: `${input.apiBaseUrl}/api/matches/preflight`,
	          method: "POST",
	          bodyTemplate: {
	            taskId: task.id,
	            humanUserId: human?.id ?? "<human_user_id>",
	            agentId: agent?.id ?? "<agent_id>"
	          },
	          eligibility
	        },
	        createMatch: {
	          endpoint: `${input.apiBaseUrl}/api/matches`,
	          method: "POST",
	          bodyTemplate: {
	            taskId: task.id,
	            humanUserId: human?.id ?? "<human_user_id>",
	            agentId: agent?.id ?? "<agent_id>",
	            reviewApproved: "<true_when_preflight_requires_review>"
	          }
	        },
	        arenaPacketTemplate: `${input.apiBaseUrl}/api/matches/{matchId}/arena-packet`,
	        nextActions: matchNextActions
	      },
	      scoreboard: {
	        endpoint: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/scoreboard?season=all&limit=${limit}`,
	        season: "all"
	      },
	      links: {
	        taskScoreboard: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/scoreboard?season=all&limit=${limit}`,
	        actionSpace: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/action-space${agent ? `?agentId=${encodeURIComponent(agent.id)}` : ""}`,
	        agentOnboarding: `${input.apiBaseUrl}/api/public/agents/onboarding?taskId=${encodeURIComponent(task.id)}${agent ? `&agentId=${encodeURIComponent(agent.id)}` : ""}&provider=${encodeURIComponent(input.provider ?? agent?.provider ?? "external")}&limit=${limit}`,
	        runnerContract: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/runner-contract${agent ? `?agentId=${encodeURIComponent(agent.id)}` : ""}`,
	        humanProofPlan: human ? `${input.apiBaseUrl}/api/users/${human.id}/steam-proof-plan?limit=${limit}` : undefined,
	        matchPreflight: `${input.apiBaseUrl}/api/matches/preflight`
	      },
	      nextActions: [
	        ...humanNextActions,
	        ...agentNextActions,
	        ...matchNextActions
	      ]
	    };
	  }

	  async function buildPublicCompetitionHub(input: {
	    scope: SeasonScope;
	    appid?: number;
	    taskId?: string;
	    provider?: AgentProfile["provider"];
	    apiBaseUrl: string;
	    limit?: number;
	  }) {
	    const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 12)));
	    const generatedAt = new Date().toISOString();
	    const snapshot = await store.read();
	    const tasks = await store.listTasks();
	    const taskRegistry = await store.listTaskRegistry();
	    if (tasks.length === 0) return null;

	    const selectedActiveTask = input.taskId
	      ? tasks.find((task) => task.id === input.taskId)
	      : undefined;
	    const selectedRegistryTask = input.taskId
	      ? taskRegistry.find((task) => task.id === input.taskId)
	      : undefined;
	    const defaultTask = input.appid
	      ? tasks.find((task) => task.appid === input.appid)
	      : tasks.find((task) => buildRuntimeRunPlan(task).actionSpace.transport === "virtual-controller") ?? tasks[0];
	    const selectedTask = selectedActiveTask ?? selectedRegistryTask ?? defaultTask;
	    if (!selectedTask) return null;
	    const selectedAppid = input.appid ?? selectedTask.appid;
	    const selectedGame = gameCatalog.find((entry) => entry.appid === selectedAppid) ??
	      inferGameCatalogEntry({
	        appid: selectedAppid,
	        name: selectedTask.gameName,
	        benchmarkFit: snapshot.steamAppDiscoveries.find((entry) => entry.appid === selectedAppid)?.benchmarkFit,
	        harnessRisk: snapshot.steamAppDiscoveries.find((entry) => entry.appid === selectedAppid)?.harnessRisk
	      });
	    const publicSnapshot = await buildPublicBenchmarkSnapshot({
	      scope: input.scope,
	      limit,
	      apiBaseUrl: input.apiBaseUrl
	    });
	    const gamePack = await buildPublicGameBenchmarkPack({
	      appid: selectedAppid,
	      scope: input.scope,
	      limit,
	      apiBaseUrl: input.apiBaseUrl
	    });
	    const actionSpace = await buildPublicTaskActionSpace({
	      taskId: selectedTask.id,
	      apiBaseUrl: input.apiBaseUrl
	    });
	    const raceEntry = await buildPublicTaskRaceEntry({
	      taskId: selectedTask.id,
	      provider: input.provider ?? "external",
	      limit,
	      apiBaseUrl: input.apiBaseUrl
	    });
	    const gameRows = [...new Set(tasks.map((task) => task.appid))]
	      .map((appid) => {
	        const gameTasks = tasks.filter((task) => task.appid === appid);
	        const game = gameCatalog.find((entry) => entry.appid === appid) ??
	          inferGameCatalogEntry({
	            appid,
	            name: gameTasks[0]?.gameName,
	            benchmarkFit: snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid)?.benchmarkFit,
	            harnessRisk: snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid)?.harnessRisk
	          });
	        const scoreRows = snapshot.scoreboard.filter((row) => row.appid === appid);
	        const tracks = [...new Set(gameTasks.map((task) => task.track))];
	        return {
	          appid,
	          name: game.name,
	          benchmarkFit: game.benchmarkFit,
	          harnessRisk: game.harnessRisk,
	          activeTasks: gameTasks.length,
	          tracks,
	          scoreboardRows: scoreRows.length,
	          humanRows: scoreRows.filter((row) => row.type === "human").length,
	          agentRows: scoreRows.filter((row) => row.type === "agent").length,
	          links: {
	            benchmarkPack: `${input.apiBaseUrl}/api/public/games/${appid}/benchmark-pack?season=${input.scope}&limit=${limit}`,
	            steamIntake: `${input.apiBaseUrl}/api/public/steam/apps/${appid}/intake?limit=${limit}`,
	            standings: `${input.apiBaseUrl}/api/games/${appid}/standings?season=${input.scope}`
	          }
	        };
	      })
	      .sort((left, right) =>
	        right.scoreboardRows - left.scoreboardRows ||
	        right.activeTasks - left.activeTasks ||
	        left.name.localeCompare(right.name)
	      )
	      .slice(0, limit);
	    const featuredTasks = (gamePack?.tasks ?? [])
	      .slice(0, limit)
	      .map((task) => ({
	        id: task.id,
	        appid: task.appid,
	        gameName: task.gameName,
	        title: task.title,
	        track: task.track,
	        level: task.level,
	        score: task.score,
	        review: task.review,
	        links: {
	          raceEntry: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/race-entry?provider=${encodeURIComponent(input.provider ?? "external")}&limit=${limit}`,
	          actionSpace: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/action-space`,
	          runnerContract: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/runner-contract`,
	          scoreboard: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/scoreboard?season=${input.scope}&limit=${limit}`
	        }
	      }));

	    return {
	      schemaVersion: "steambench.public-competition-hub.v1",
	      generatedAt,
	      scope: input.scope,
	      canonicalArtifactName: "output.mp4",
	      publicDataPolicy: publicSnapshot.publicDataPolicy,
	      selected: {
	        game: {
	          appid: selectedGame.appid,
	          name: selectedGame.name,
	          benchmarkFit: selectedGame.benchmarkFit,
	          harnessRisk: selectedGame.harnessRisk,
	          tracks: selectedGame.tracks
	        },
	        task: {
	          id: selectedTask.id,
	          appid: selectedTask.appid,
	          gameName: selectedTask.gameName,
	          title: selectedTask.title,
	          track: selectedTask.track,
	          level: selectedTask.level,
	          runnable: tasks.some((task) => task.id === selectedTask.id)
	        },
	        gamePack,
	        actionSpace,
	        raceEntry
	      },
	      platform: {
	        totals: publicSnapshot.totals,
	        season: publicSnapshot.season,
	        events: publicSnapshot.events,
	        certificates: publicSnapshot.certificates
	      },
	      games: gameRows,
	      featuredTasks,
	      broadcasts: publicSnapshot.broadcasts,
	      entrypoints: {
	        publicSnapshot: `${input.apiBaseUrl}/api/public/benchmark-snapshot?season=${input.scope}&limit=${limit}`,
	        eventEntryTemplate: `${input.apiBaseUrl}/api/public/events/${input.scope}/entry?taskId={taskId}&humanUserId={userId}&agentId={agentId}&provider=${encodeURIComponent(input.provider ?? "external")}`,
	        gameBenchmarkPackTemplate: `${input.apiBaseUrl}/api/public/games/{appid}/benchmark-pack?season=${input.scope}&limit=${limit}`,
	        steamIntakeTemplate: `${input.apiBaseUrl}/api/public/steam/apps/{appid}/intake?limit=${limit}`,
	        agentOnboardingTemplate: `${input.apiBaseUrl}/api/public/agents/onboarding?taskId={taskId}&provider=${encodeURIComponent(input.provider ?? "external")}`,
	        humanProofPlanTemplate: `${input.apiBaseUrl}/api/users/{userId}/steam-proof-plan?limit=${limit}`,
	        taskRaceEntryTemplate: `${input.apiBaseUrl}/api/public/tasks/{taskId}/race-entry?humanUserId={userId}&agentId={agentId}&provider=${encodeURIComponent(input.provider ?? "external")}`,
	        taskActionSpaceTemplate: `${input.apiBaseUrl}/api/public/tasks/{taskId}/action-space?agentId={agentId}`,
	        bridgeHandoffTemplate: `${input.apiBaseUrl}/api/public/tasks/{taskId}/bridge-handoff?agentId={agentId}&provider=${encodeURIComponent(input.provider ?? "external")}`,
	        runnerContractTemplate: `${input.apiBaseUrl}/api/public/tasks/{taskId}/runner-contract?humanUserId={userId}&agentId={agentId}`,
	        quickstartTemplate: `${input.apiBaseUrl}/api/public/quickstart?season=${input.scope}&taskId={taskId}&humanUserId={userId}&agentId={agentId}&provider=${encodeURIComponent(input.provider ?? "external")}`,
	        matchPreflight: `${input.apiBaseUrl}/api/matches/preflight`,
	        createMatch: `${input.apiBaseUrl}/api/matches`,
	        publicWatchTemplate: `${input.apiBaseUrl}/api/public/broadcasts/{streamId}/watch`
	      },
	      links: {
	        selectedGamePack: `${input.apiBaseUrl}/api/public/games/${selectedAppid}/benchmark-pack?season=${input.scope}&limit=${limit}`,
	        selectedEventEntry: `${input.apiBaseUrl}/api/public/events/${input.scope}/entry?appid=${selectedAppid}&taskId=${encodeURIComponent(selectedTask.id)}&provider=${encodeURIComponent(input.provider ?? "external")}&limit=${limit}`,
	        selectedTaskRaceEntry: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(selectedTask.id)}/race-entry?provider=${encodeURIComponent(input.provider ?? "external")}&limit=${limit}`,
	        selectedQuickstart: `${input.apiBaseUrl}/api/public/quickstart?season=${input.scope}&appid=${selectedAppid}&taskId=${encodeURIComponent(selectedTask.id)}&provider=${encodeURIComponent(input.provider ?? "external")}&limit=${limit}`,
	        selectedTaskScoreboard: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(selectedTask.id)}/scoreboard?season=${input.scope}&limit=${limit}`,
	        selectedTaskActionSpace: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(selectedTask.id)}/action-space`,
	        selectedTaskBridgeHandoff: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(selectedTask.id)}/bridge-handoff?provider=${encodeURIComponent(input.provider ?? "external")}`,
	        certificateIndex: `${input.apiBaseUrl}/api/result-certificates?kind=all&limit=${limit}`,
	        certificateVerify: `${input.apiBaseUrl}/api/result-certificates/verify`
	      },
	      nextActions: [
	        "Render the public competition hub.",
	        "Let humans bind Steam and select a race-entry packet.",
	        "Let agents register from onboarding, inspect action-space, then open a run session.",
	        "Use match preflight before creating human-vs-agent races.",
	        "Surface public watch packets for live or replay broadcasts."
	      ]
	    };
	  }

	  async function buildPublicQuickstart(input: {
	    scope: SeasonScope;
	    appid?: number;
	    taskId?: string;
	    humanUserId?: string;
	    agentId?: string;
	    provider?: AgentProfile["provider"];
	    apiBaseUrl: string;
	    limit?: number;
	  }) {
	    const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 12)));
	    const provider = input.provider ?? "external";
	    const hub = await buildPublicCompetitionHub({
	      scope: input.scope,
	      appid: input.appid,
	      taskId: input.taskId,
	      provider,
	      limit,
	      apiBaseUrl: input.apiBaseUrl
	    });
	    if (!hub) return null;

	    const taskId = hub.selected.task.id;
	    const appid = hub.selected.game.appid;
	    const raceEntry = await buildPublicTaskRaceEntry({
	      taskId,
	      humanUserId: input.humanUserId,
	      agentId: input.agentId,
	      provider,
	      limit,
	      apiBaseUrl: input.apiBaseUrl
	    });
	    if (!raceEntry) return null;

	    const actionSpace = raceEntry.actionSpace;
	    const agentOnboarding = raceEntry.agent.onboarding;
	    const actionSpaceQuery = input.agentId ? `?agentId=${encodeURIComponent(input.agentId)}` : "";
	    const hubQuery = new URLSearchParams();
	    hubQuery.set("season", input.scope);
	    hubQuery.set("appid", String(appid));
	    hubQuery.set("taskId", taskId);
	    hubQuery.set("provider", provider);
	    hubQuery.set("limit", String(limit));
	    const quickstartQuery = new URLSearchParams();
	    quickstartQuery.set("season", input.scope);
	    quickstartQuery.set("appid", String(appid));
	    quickstartQuery.set("taskId", taskId);
	    if (input.humanUserId) quickstartQuery.set("humanUserId", input.humanUserId);
	    if (input.agentId) quickstartQuery.set("agentId", input.agentId);
	    quickstartQuery.set("provider", provider);
	    quickstartQuery.set("limit", String(limit));
	    const raceQuery = new URLSearchParams();
	    if (input.humanUserId) raceQuery.set("humanUserId", input.humanUserId);
	    if (input.agentId) raceQuery.set("agentId", input.agentId);
	    raceQuery.set("provider", provider);
	    raceQuery.set("limit", String(limit));
	    const agentQuery = new URLSearchParams();
	    agentQuery.set("taskId", taskId);
	    if (input.agentId) agentQuery.set("agentId", input.agentId);
	    agentQuery.set("provider", provider);
	    agentQuery.set("limit", String(Math.min(20, limit)));

	    const humanId = input.humanUserId ?? "<human_user_id>";
	    const agentId = input.agentId ?? "<agent_id>";
	    const streamId = "<stream_id>";
	    const runId = "<run_id>";
	    const controlSessionId = "<active_control_session_id>";
	    const registerAgentBody = agentOnboarding?.registration?.requestBodyTemplate ?? {
	      handle: "external-agent",
	      displayName: "External Runtime Agent",
	      provider,
	      runtimeProvider: provider === "modal" ? "modal" : "local-sim",
	      command: "external-runner consumes public action-space and submits action batches",
	      capabilities: raceEntry.agent.onboarding?.registration?.requiredCapabilities ?? []
	    };
	    const runSessionBody = agentOnboarding?.runEntry?.runSessionBodyTemplate ?? actionSpace?.controlSession?.createRunSessionBody ?? {
	      taskId,
	      createControlSession: Boolean(actionSpace?.bridge?.bridgeable),
	      ttlSeconds: 900
	    };
	    const actionBatchBody = {
	      ...(actionSpace?.exampleActionBatch?.requestBodyTemplate ?? {}),
	      controlSessionId: actionSpace?.exampleActionBatch?.requiresControlSessionId ? controlSessionId : undefined
	    };

	    const steps = [
	      {
	        id: "inspect-hub",
	        actor: "any",
	        method: "GET",
	        endpoint: `${input.apiBaseUrl}/api/public/competition-hub?${hubQuery}`,
	        cli: `npm run public:hub -- --season=${input.scope} --appid=${appid} --task-id=${taskId} --provider=${provider} --limit=${limit}`,
	        purpose: "Choose the public game/task surface and render the public benchmark hub."
	      },
	      {
	        id: "create-human",
	        actor: "human",
	        method: "POST",
	        endpoint: `${input.apiBaseUrl}/api/users`,
	        bodyTemplate: {
	          handle: "steam-human",
	          displayName: "Steam Human Player",
	          type: "human"
	        },
	        purpose: "Create a human competitor profile when one is not already selected."
	      },
	      {
	        id: "link-steam",
	        actor: "human",
	        method: "POST",
	        endpoint: `${input.apiBaseUrl}/api/users/${humanId}/steam`,
	        bodyTemplate: {
	          steamid: "<17_digit_steamid>",
	          proofConsent: true
	        },
	        purpose: "Bind the public human profile to Steam with explicit proof consent."
	      },
	      {
	        id: "grant-proof-consent",
	        actor: "human",
	        method: "POST",
	        endpoint: `${input.apiBaseUrl}/api/users/${humanId}/steam-proof-consent`,
	        bodyTemplate: {
	          proofConsent: true
	        },
	        purpose: "Grant or refresh consent for public Steam proof use."
	      },
	      {
	        id: "inspect-human-proof-plan",
	        actor: "human",
	        method: "GET",
	        endpoint: `${input.apiBaseUrl}/api/users/${humanId}/steam-proof-plan?limit=${Math.min(20, limit)}`,
	        purpose: "Check task-level proof blockers and the canonical output/output.mp4 evidence contract."
	      },
	      {
	        id: "inspect-agent-onboarding",
	        actor: "agent",
	        method: "GET",
	        endpoint: `${input.apiBaseUrl}/api/public/agents/onboarding?${agentQuery}`,
	        cli: `npm run public:agent -- --task-id=${taskId} --provider=${provider} --limit=${Math.min(20, limit)}`,
	        purpose: "Read required capabilities and the agent registration template."
	      },
	      {
	        id: "register-agent",
	        actor: "agent",
	        method: "POST",
	        endpoint: `${input.apiBaseUrl}/api/agents`,
	        bodyTemplate: registerAgentBody,
	        cli: `npm run public:agent -- --task-id=${taskId} --provider=${provider} --execute=register --handle=<agent_handle> --limit=${Math.min(20, limit)}`,
	        purpose: "Register an external, local, or Modal agent profile from the advertised capability template."
	      },
	      {
	        id: "inspect-action-space",
	        actor: "agent",
	        method: "GET",
	        endpoint: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(taskId)}/action-space${actionSpaceQuery}`,
	        cli: `npm run public:action-space -- --task-id=${taskId}${input.agentId ? ` --agent-id=${input.agentId}` : ""}`,
	        purpose: "Load allowed actions, controller permissions, bridge requirements, and forbidden privileged input."
	      },
	      {
	        id: "inspect-bridge-handoff",
	        actor: "agent",
	        method: "GET",
	        endpoint: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(taskId)}/bridge-handoff${input.agentId ? `?agentId=${encodeURIComponent(input.agentId)}&provider=${provider}` : `?provider=${provider}`}`,
	        cli: `npm run public:bridge-handoff -- --task-id=${taskId}${input.agentId ? ` --agent-id=${input.agentId}` : ""} --provider=${provider}`,
	        purpose: "Validate the read-only bridge grant contract before opening a GeForce NOW control lease."
	      },
	      {
	        id: "inspect-race-entry",
	        actor: "both",
	        method: "GET",
	        endpoint: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(taskId)}/race-entry?${raceQuery}`,
	        cli: `npm run public:race-entry -- --task-id=${taskId} --human-user-id=${humanId} --agent-id=${agentId} --provider=${provider} --limit=${Math.min(20, limit)}`,
	        purpose: "Join human proof readiness, agent readiness, action-space, scoreboard, and match templates."
	      },
	      {
	        id: "match-preflight",
	        actor: "both",
	        method: "POST",
	        endpoint: `${input.apiBaseUrl}/api/matches/preflight`,
	        bodyTemplate: raceEntry.match.preflight.bodyTemplate,
	        purpose: "Check race eligibility immediately before creating a human-vs-agent match."
	      },
	      {
	        id: "create-match",
	        actor: "both",
	        method: "POST",
	        endpoint: `${input.apiBaseUrl}/api/matches`,
	        bodyTemplate: raceEntry.match.createMatch.bodyTemplate,
	        cli: `npm run public:match -- --task-id=${taskId} --human-user-id=${humanId} --agent-id=${agentId} --execute=advance-public-match`,
	        purpose: "Create and advance a public race after preflight and review approval when needed."
	      },
	      {
	        id: "agent-run-session",
	        actor: "agent",
	        method: "POST",
	        endpoint: `${input.apiBaseUrl}/api/agents/${agentId}/run-session`,
	        bodyTemplate: runSessionBody,
	        cli: `npm run agent:run-session -- --agent-id=${agentId} --task-id=${taskId} --ttl-seconds=900`,
	        purpose: "Queue the agent run and grant a bounded control lease for bridgeable controller tasks."
	      },
	      {
	        id: "submit-action-batch",
	        actor: "agent",
	        method: "POST",
	        endpoint: `${input.apiBaseUrl}/api/runs/${runId}/action-batches`,
	        bodyTemplate: actionBatchBody,
	        purpose: "Submit observe-before-act action batches using the public action-space template."
	      },
	      {
	        id: "submit-evidence",
	        actor: "agent",
	        method: "POST",
	        endpoint: `${input.apiBaseUrl}/api/runs/${runId}/submission`,
	        bodyTemplate: {
	          artifactPath: "output/output.mp4",
	          allowMock: false
	        },
	        purpose: "Submit the canonical evaluated artifact; output-test.mp4 is intentionally not accepted."
	      },
	      {
	        id: "watch-broadcast",
	        actor: "viewer",
	        method: "GET",
	        endpoint: `${input.apiBaseUrl}/api/public/broadcasts/${streamId}/watch`,
	        cli: `npm run public:watch -- --stream-id=${streamId} --execute=verify-public-watch`,
	        purpose: "Open the public watch/replay packet when a livestream or replay exists."
	      }
	    ];
	    const humanReady = raceEntry.human.ready === true;
	    const agentReady = raceEntry.agent.ready === true;
	    const actionSpaceBridgeable = actionSpace?.bridge?.bridgeable === true;
	    const nextActions = [
	      ...(input.humanUserId
	        ? humanReady
	          ? ["Human proof is ready for the selected task."]
	          : ["Resolve the selected human's Steam proof blockers."]
	        : ["Create a human profile, link Steam, and grant proof consent."]),
	      ...(input.agentId
	        ? agentReady
	          ? ["Agent profile is ready to run the selected task."]
	          : ["Update the selected agent with missing capabilities."]
	        : ["Register an agent profile from the onboarding template."]),
	      actionSpaceBridgeable
	        ? "Use run-session with createControlSession=true before sending GeForce NOW controller input."
	        : "Use the declared local transport and public action-space before sending input.",
	      raceEntry.readyForMatch
	        ? "Run match preflight and create the public race."
	        : "Refresh race-entry after human and agent blockers are cleared."
	    ];

	    return {
	      schemaVersion: "steambench.public-quickstart.v1",
	      generatedAt: new Date().toISOString(),
	      scope: input.scope,
	      canonicalArtifactName: "output.mp4",
	      selected: {
	        game: hub.selected.game,
	        task: hub.selected.task,
	        human: raceEntry.human.selectedUser,
	        agent: raceEntry.agent.selectedAgent
	      },
	      readiness: {
	        human: {
	          status: raceEntry.human.status,
	          ready: humanReady,
	          selected: Boolean(input.humanUserId)
	        },
	        agent: {
	          status: raceEntry.agent.status,
	          ready: agentReady,
	          selected: Boolean(input.agentId),
	          missingCapabilities: raceEntry.agent.onboarding?.readiness?.missingCapabilities ?? []
	        },
	        actionSpace: {
	          inputMode: actionSpace?.permissions?.inputMode,
	          transport: actionSpace?.permissions?.transport,
	          bridgeable: actionSpaceBridgeable,
	          requiresControlSession: actionSpace?.controlSession?.requiredBeforeHostInput === true,
	          privilegedSystemInput: false
	        },
	        match: {
	          readyForMatch: raceEntry.readyForMatch,
	          preflightRequired: true
	        }
	      },
	      packets: {
	        hub: {
	          schemaVersion: hub.schemaVersion,
	          endpoint: `${input.apiBaseUrl}/api/public/competition-hub?${hubQuery}`
	        },
	        raceEntry: {
	          schemaVersion: raceEntry.schemaVersion,
	          endpoint: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(taskId)}/race-entry?${raceQuery}`
	        },
	        actionSpace: {
	          schemaVersion: actionSpace?.schemaVersion,
	          endpoint: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(taskId)}/action-space${actionSpaceQuery}`
	        },
	        agentOnboarding: {
	          schemaVersion: agentOnboarding?.schemaVersion,
	          endpoint: `${input.apiBaseUrl}/api/public/agents/onboarding?${agentQuery}`
	        }
	      },
	      commands: {
	        inspectHub: `npm run public:hub -- --season=${input.scope} --appid=${appid} --task-id=${taskId} --provider=${provider} --limit=${limit}`,
	        registerAgent: `npm run public:agent -- --task-id=${taskId} --provider=${provider} --execute=register --handle=<agent_handle> --limit=${Math.min(20, limit)}`,
	        inspectRaceEntry: `npm run public:race-entry -- --task-id=${taskId} --human-user-id=${humanId} --agent-id=${agentId} --provider=${provider} --limit=${Math.min(20, limit)}`,
	        inspectBridgeHandoff: `npm run public:bridge-handoff -- --task-id=${taskId} --agent-id=${agentId} --provider=${provider}`,
	        runPublicMatch: `npm run public:match -- --task-id=${taskId} --human-user-id=${humanId} --agent-id=${agentId} --execute=advance-public-match`,
	        runAgentSession: `npm run agent:run-session -- --agent-id=${agentId} --task-id=${taskId} --ttl-seconds=900`,
	        watchBroadcast: `npm run public:watch -- --stream-id=${streamId} --execute=verify-public-watch`
	      },
	      steps,
	      links: {
	        self: `${input.apiBaseUrl}/api/public/quickstart?${quickstartQuery}`,
	        hub: `${input.apiBaseUrl}/api/public/competition-hub?${hubQuery}`,
	        raceEntry: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(taskId)}/race-entry?${raceQuery}`,
	        actionSpace: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(taskId)}/action-space${actionSpaceQuery}`,
	        bridgeHandoff: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(taskId)}/bridge-handoff${input.agentId ? `?agentId=${encodeURIComponent(input.agentId)}&provider=${provider}` : `?provider=${provider}`}`,
	        runnerContract: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(taskId)}/runner-contract${input.agentId ? `?agentId=${encodeURIComponent(input.agentId)}` : ""}`,
	        taskScoreboard: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(taskId)}/scoreboard?season=${input.scope}&limit=${limit}`,
	        publicWatchTemplate: `${input.apiBaseUrl}/api/public/broadcasts/{streamId}/watch`
	      },
	      nextActions
	    };
	  }

	  async function buildPublicBridgeHandoff(input: {
	    taskId: string;
	    agentId?: string;
	    provider?: AgentProfile["provider"];
	    ttlSeconds?: number;
	    apiBaseUrl: string;
	  }) {
	    const snapshot = await store.read();
	    const activeTask = await store.findTask(input.taskId);
	    const registryTask = activeTask ? undefined : (await store.listTaskRegistry()).find((entry) => entry.id === input.taskId);
	    const task = activeTask ?? registryTask;
	    if (!task) return null;

	    const agent = input.agentId
	      ? snapshot.agents.find((entry) => entry.id === input.agentId || entry.handle === input.agentId)
	      : undefined;
	    const plan = buildRuntimeRunPlan(task);
	    const readiness = buildRuntimeReadiness(task, agent);
	    const bridgeable =
	      plan.actionSpace.inputMode === "controller" &&
	      plan.actionSpace.transport === "virtual-controller" &&
	      plan.actionSpace.permissions.controller &&
	      !plan.actionSpace.permissions.privilegedSystemInput;
	    const ttlSeconds = Math.max(30, Math.min(3600, Math.floor(input.ttlSeconds ?? 900)));
	    const status = !activeTask
	      ? "task-not-runnable"
	      : !bridgeable
	        ? "not-bridgeable"
	        : !agent
	          ? "missing-agent"
	          : readiness.ready
	            ? "ready-to-grant"
	            : "missing-capabilities";
	    const runSessionBody = {
	      taskId: task.id,
	      createControlSession: bridgeable,
	      ttlSeconds
	    };
	    const agentToken = agent?.id ?? "<agent_id>";
	    const runToken = "<run_id>";
	    const sessionToken = "<control_session_id>";
	    const actionBatchEndpoint = `/api/runs/${runToken}/action-batches`;
	    const actionBatchTemplate = {
	      controlSessionId: bridgeable ? sessionToken : undefined,
	      observation: "Describe the visible game state before acting.",
	      actions: plan.actionSpace.examples,
	      confidence: 0.75,
	      idempotencyKey: "agent:<run_id>:step-1"
	    };
	    const executionPlan = bridgeable ? compileControllerExecutionPlan(plan.actionSpace.examples, plan.actionSpace) : undefined;

	    return {
	      schemaVersion: "steambench.public-bridge-handoff.v1",
	      generatedAt: new Date().toISOString(),
	      status,
	      runnable: Boolean(activeTask),
	      bridgeable,
	      canonicalArtifactName: "output.mp4",
	      task: {
	        id: task.id,
	        appid: task.appid,
	        gameName: task.gameName,
	        title: task.title,
	        track: task.track,
	        level: task.level,
	        estimatedRuntimeMinutes: task.estimatedRuntimeMinutes
	      },
	      selectedAgent: agent
	        ? {
	            id: agent.id,
	            handle: agent.handle,
	            displayName: agent.displayName,
	            provider: agent.provider,
	            runtimeProvider: agent.runtimeProvider,
	            status: agent.status,
	            capabilities: agent.capabilities,
	            readiness
	          }
	        : undefined,
	      registrationHint: agent
	        ? undefined
	        : {
	            endpoint: `${input.apiBaseUrl}/api/agents`,
	            method: "POST",
	            provider: input.provider ?? "external",
	            runtimeProvider: input.provider === "modal" ? "modal" : "local-sim",
	            requiredCapabilities: readiness.requiredCapabilities,
	            bodyTemplate: {
	              handle: "geforce-now-agent",
	              displayName: "GeForce NOW Bridge Agent",
	              provider: input.provider ?? "external",
	              runtimeProvider: input.provider === "modal" ? "modal" : "local-sim",
	              command: "external-runner consumes public bridge handoff and submits action batches",
	              capabilities: readiness.requiredCapabilities
	            }
	          },
	      permissions: {
	        schemaVersion: plan.actionSpace.schemaVersion,
	        inputMode: plan.actionSpace.inputMode,
	        transport: plan.actionSpace.transport,
	        allowedActionTypes: plan.actionSpace.allowedActionTypes,
	        controller: plan.actionSpace.controller,
	        constraints: plan.actionSpace.constraints,
	        privilegedSystemInput: false,
	        observeBeforeAct: true
	      },
	      grant: {
	        method: "POST",
	        endpoint: agent && activeTask ? `${input.apiBaseUrl}/api/agents/${agent.id}/run-session` : `${input.apiBaseUrl}/api/agents/${agentToken}/run-session`,
	        bodyTemplate: runSessionBody,
	        responseSchemaVersion: "steambench.agent-run-session.v1",
	        createsRun: true,
	        createsControlSession: bridgeable,
	        ttlSeconds
	      },
	      postGrantPackets: {
	        accessPacket: {
	          schemaVersion: "steambench.runtime-control-access-packet.v1",
	          endpoint: `${input.apiBaseUrl}/api/control-sessions/${sessionToken}/access-packet`
	        },
	        bridgeManifest: {
	          schemaVersion: "steambench.control-bridge-manifest.v1",
	          endpoint: `${input.apiBaseUrl}/api/control-sessions/${sessionToken}/bridge-manifest`
	        },
	        agentTrace: `${input.apiBaseUrl}/api/runs/${runToken}/agent-trace`,
	        traceAudit: `${input.apiBaseUrl}/api/runs/${runToken}/agent-trace/audit`
	      },
	      actionBatch: {
	        method: "POST",
	        endpoint: actionBatchEndpoint,
	        bodyTemplate: actionBatchTemplate,
	        receiptSchemaVersion: "steambench.agent-action-batch-receipt.v1",
	        acceptedActionLabels: plan.actionSpace.examples.map(actionLabel),
	        executionPlanPreview: executionPlan
	          ? {
	              schemaVersion: executionPlan.schemaVersion,
	              target: executionPlan.target,
	              timing: executionPlan.timing,
	              neutralOnCompletion: executionPlan.neutralOnCompletion,
	              stepCount: executionPlan.steps.length,
	              totalDurationMs: executionPlan.totalDurationMs,
	              maxBatchDurationMs: executionPlan.maxBatchDurationMs
	            }
	          : undefined
	      },
	      executor: {
	        provider: "geforce-now",
	        command: "npm run executor:geforce-now",
	        bridgeRunnerCommand: `npm run bridge:control -- --session=${sessionToken}`,
	        requestSchemaVersion: "steambench.controller-executor-request.v1",
	        reportSchemaVersion: "steambench.controller-executor-report.v1",
	        reportEndpoint: `${input.apiBaseUrl}/api/runs/${runToken}/controller-executor-reports`,
	        required: bridgeable,
	        sideEffectsMustBeFalseForAudit: true
	      },
	      evidence: {
	        canonicalArtifact: "output/output.mp4",
	        acceptedArtifactName: "output.mp4",
	        forbiddenArtifactNames: ["output-test.mp4"],
	        submissionEndpoint: `${input.apiBaseUrl}/api/runs/${runToken}/submission`
	      },
	      links: {
	        publicActionSpace: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/action-space${agent ? `?agentId=${encodeURIComponent(agent.id)}` : ""}`,
	        runnerContract: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(task.id)}/runner-contract${agent ? `?agentId=${encodeURIComponent(agent.id)}` : ""}`,
	        agentOnboarding: `${input.apiBaseUrl}/api/public/agents/onboarding?taskId=${encodeURIComponent(task.id)}${agent ? `&agentId=${encodeURIComponent(agent.id)}` : ""}&provider=${encodeURIComponent(input.provider ?? agent?.provider ?? "external")}`,
	        quickstart: `${input.apiBaseUrl}/api/public/quickstart?taskId=${encodeURIComponent(task.id)}${agent ? `&agentId=${encodeURIComponent(agent.id)}` : ""}&provider=${encodeURIComponent(input.provider ?? agent?.provider ?? "external")}`,
	        controlBridgeOps: `${input.apiBaseUrl}/api/control-sessions/ops-report?transport=virtual-controller`
	      },
	      nextActions: status === "ready-to-grant"
	        ? [
	            "POST the grant body to open a bounded run session.",
	            "Read the access packet or bridge manifest returned by the run session.",
	            "Submit observe-before-act action batches with the active controlSessionId.",
	            "Run the bridge executor and POST its controller executor report.",
	            "Submit canonical output/output.mp4 evidence."
	          ]
	        : status === "missing-agent"
	          ? [
	              "Register an agent with the required capabilities.",
	              "Refresh this bridge handoff with agentId before granting a run session."
	            ]
	          : status === "missing-capabilities"
	            ? ["Update the selected agent with the missing capabilities before granting control."]
	            : status === "not-bridgeable"
	              ? ["Use this task's declared non-bridge action-space; no GeForce NOW controller lease is required."]
	              : ["Publish or activate this task before granting a run session."]
	    };
	  }

	  async function buildPublicEventEntry(input: {
	    scope: SeasonScope;
	    taskId?: string;
	    appid?: number;
	    humanUserId?: string;
	    agentId?: string;
	    provider?: AgentProfile["provider"];
	    suiteId?: string;
	    limit?: number;
	    apiBaseUrl: string;
	  }) {
	    const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 12)));
	    const provider = input.provider ?? "external";
	    const snapshot = await store.read();
	    const tasks = await store.listTasks();
	    const taskRegistry = await store.listTaskRegistry();
	    const selectedActiveTask = input.taskId ? tasks.find((task) => task.id === input.taskId) : undefined;
	    const selectedRegistryTask = input.taskId ? taskRegistry.find((task) => task.id === input.taskId) : undefined;
	    const selectedTask = selectedActiveTask
	      ?? selectedRegistryTask
	      ?? (input.appid ? tasks.find((task) => task.appid === input.appid) : undefined)
	      ?? tasks.find((task) => buildRuntimeRunPlan(task).actionSpace.transport === "virtual-controller")
	      ?? tasks[0];
	    if (!selectedTask) return null;

	    const human = input.humanUserId
	      ? snapshot.users.find((entry) => entry.id === input.humanUserId && entry.type === "human")
	      : undefined;
	    const agent = input.agentId
	      ? snapshot.agents.find((entry) => entry.id === input.agentId || entry.handle === input.agentId)
	      : undefined;
	    const registrations = snapshot.eventRegistrations.filter((registration) => registration.eventScope === input.scope);
	    const humanRegistration = human
	      ? registrations.find((registration) =>
	          registration.participantType === "human" &&
	          registration.participantId === human.id &&
	          registration.status === "registered"
	        )
	      : undefined;
	    const agentRegistration = agent
	      ? registrations.find((registration) =>
	          registration.participantType === "agent" &&
	          registration.participantId === agent.id &&
	          registration.status === "registered"
	        )
	      : undefined;
	    const event = buildCompetitionEventSummary({
	      scope: input.scope,
	      users: snapshot.users,
	      agents: snapshot.agents,
	      runs: snapshot.runs,
	      matches: snapshot.matches,
	      suiteRaces: snapshot.suiteRaces,
	      scoreboard: snapshot.scoreboard,
	      proofs: snapshot.proofs,
	      streams: snapshot.streams,
	      registrations: snapshot.eventRegistrations
	    });
	    const bundle = await buildCompetitionEventBundle(input.scope, input.apiBaseUrl);
	    const suites = await buildCurrentBenchmarkSuites();
	    const selectedSuite = input.suiteId
	      ? suites.find((suite) => suite.id === input.suiteId)
	      : suites.find((suite) => suite.status === "ranked-ready" && suite.tier === "ranked")
	        ?? suites.find((suite) => suite.status === "ranked-ready")
	        ?? suites[0];
	    const evidence = summarizeCompetitionEventEvidenceBundle(bundle);
	    const opsReport = buildCompetitionEventOpsReport({
	      scope: input.scope,
	      event,
	      bundle,
	      evidence,
	      selectedSuite
	    });
	    const raceEntry = await buildPublicTaskRaceEntry({
	      taskId: selectedTask.id,
	      humanUserId: human?.id,
	      agentId: agent?.id,
	      provider,
	      limit: Math.min(20, limit),
	      apiBaseUrl: input.apiBaseUrl
	    });
	    const quickstart = await buildPublicQuickstart({
	      scope: input.scope,
	      appid: input.appid ?? selectedTask.appid,
	      taskId: selectedTask.id,
	      humanUserId: human?.id,
	      agentId: agent?.id,
	      provider,
	      limit,
	      apiBaseUrl: input.apiBaseUrl
	    });
	    const bridgeHandoff = await buildPublicBridgeHandoff({
	      taskId: selectedTask.id,
	      agentId: agent?.id,
	      provider,
	      ttlSeconds: 900,
	      apiBaseUrl: input.apiBaseUrl
	    });
	    const humanCanRegister = Boolean(human?.linkedSteamId && human.proofConsentAt);
	    const agentCanRegister = Boolean(agent && agent.status === "active");
	    const pairReady = humanCanRegister && agentCanRegister;
	    const humanStatus = !human
	      ? "missing-human"
	      : humanRegistration
	        ? "registered"
	        : humanCanRegister
	          ? "ready-to-register"
	          : !human.linkedSteamId
	            ? "steam-not-linked"
	            : "proof-consent-required";
	    const agentStatus = !agent
	      ? "missing-agent"
	      : agentRegistration
	        ? "registered"
	        : agentCanRegister
	          ? "ready-to-register"
	          : "agent-not-active";
	    const registerEndpoint = `${input.apiBaseUrl}/api/competition-events/${input.scope}/register`;

	    return {
	      schemaVersion: "steambench.public-event-entry.v1",
	      generatedAt: new Date().toISOString(),
	      scope: input.scope,
	      canonicalArtifactName: "output.mp4",
	      event: {
	        id: event.id,
	        title: event.title,
	        status: event.status,
	        window: event.window,
	        entrants: event.entrants,
	        score: event.score,
	        matches: event.matches,
	        suiteRaces: event.suiteRaces
	      },
	      selected: {
	        task: {
	          id: selectedTask.id,
	          appid: selectedTask.appid,
	          gameName: selectedTask.gameName,
	          title: selectedTask.title,
	          track: selectedTask.track,
	          level: selectedTask.level,
	          runnable: tasks.some((task) => task.id === selectedTask.id)
	        },
	        suite: selectedSuite
	          ? {
	              id: selectedSuite.id,
	              title: selectedSuite.title,
	              status: selectedSuite.status,
	              tier: selectedSuite.tier,
	              taskCount: selectedSuite.taskCount,
	              readinessScore: selectedSuite.readinessScore
	            }
	          : undefined,
	        human: human
	          ? {
	              id: human.id,
	              handle: human.handle,
	              displayName: human.displayName,
	              linkedSteamId: human.linkedSteamId,
	              proofConsentAt: human.proofConsentAt
	            }
	          : undefined,
	        agent: agent
	          ? {
	              id: agent.id,
	              handle: agent.handle,
	              displayName: agent.displayName,
	              provider: agent.provider,
	              runtimeProvider: agent.runtimeProvider,
	              status: agent.status
	            }
	          : undefined
	      },
	      readiness: {
	        human: {
	          status: humanStatus,
	          canRegister: humanCanRegister,
	          registrationId: humanRegistration?.id,
	          blockers: human
	            ? [
	                ...(!human.linkedSteamId ? ["steam_not_linked"] : []),
	                ...(!human.proofConsentAt ? ["steam_proof_consent_required"] : [])
	              ]
	            : ["human_required"]
	        },
	        agent: {
	          status: agentStatus,
	          canRegister: agentCanRegister,
	          registrationId: agentRegistration?.id,
	          blockers: agent ? (agent.status === "active" ? [] : ["agent_not_active"]) : ["agent_required"]
	        },
	        pair: {
	          ready: pairReady,
	          registered: Boolean(humanRegistration && agentRegistration),
	          readyForRaceEntry: raceEntry?.readyForMatch === true
	        },
	        eventOps: {
	          status: opsReport.status,
	          registeredPairs: opsReport.totals.registeredPairs,
	          scheduledRaces: opsReport.totals.scheduledRaces,
	          scoredRaces: opsReport.totals.scoredRaces,
	          readyForPublicShare: opsReport.totals.readyForPublicShare,
	          recommendedActionIds: opsReport.recommendedActions.map((action) => action.id)
	        }
	      },
	      registration: {
	        endpoint: registerEndpoint,
	        method: "POST",
	        human: {
	          bodyTemplate: {
	            participantType: "human",
	            participantId: human?.id ?? "<human_user_id>",
	            notes: "public-event-entry"
	          },
	          ready: humanCanRegister,
	          alreadyRegistered: Boolean(humanRegistration)
	        },
	        agent: {
	          bodyTemplate: {
	            participantType: "agent",
	            participantId: agent?.id ?? "<agent_id>",
	            notes: "public-event-entry"
	          },
	          ready: agentCanRegister,
	          alreadyRegistered: Boolean(agentRegistration)
	        }
	      },
	      packets: {
	        quickstart: {
	          schemaVersion: quickstart?.schemaVersion,
	          endpoint: `${input.apiBaseUrl}/api/public/quickstart?season=${input.scope}&taskId=${encodeURIComponent(selectedTask.id)}${human ? `&humanUserId=${encodeURIComponent(human.id)}` : ""}${agent ? `&agentId=${encodeURIComponent(agent.id)}` : ""}&provider=${encodeURIComponent(provider)}&limit=${limit}`
	        },
	        raceEntry: {
	          schemaVersion: raceEntry?.schemaVersion,
	          readyForMatch: raceEntry?.readyForMatch,
	          endpoint: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(selectedTask.id)}/race-entry${human || agent ? `?${new URLSearchParams({
	            ...(human ? { humanUserId: human.id } : {}),
	            ...(agent ? { agentId: agent.id } : {}),
	            provider,
	            limit: String(Math.min(20, limit))
	          })}` : `?provider=${encodeURIComponent(provider)}&limit=${Math.min(20, limit)}`}`
	        },
	        bridgeHandoff: {
	          schemaVersion: bridgeHandoff?.schemaVersion,
	          status: bridgeHandoff?.status,
	          bridgeable: bridgeHandoff?.bridgeable,
	          endpoint: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(selectedTask.id)}/bridge-handoff${agent ? `?agentId=${encodeURIComponent(agent.id)}&provider=${encodeURIComponent(provider)}` : `?provider=${encodeURIComponent(provider)}`}`
	        },
	        opsReport: {
	          schemaVersion: opsReport.schemaVersion,
	          endpoint: `${input.apiBaseUrl}/api/competition-events/${input.scope}/ops-report${selectedSuite ? `?suiteId=${encodeURIComponent(selectedSuite.id)}` : ""}`
	        }
	      },
	      commands: {
	        inspectEntry: `npm run public:event-entry -- --scope=${input.scope} --task-id=${selectedTask.id}${human ? ` --human-user-id=${human.id}` : ""}${agent ? ` --agent-id=${agent.id}` : ""} --provider=${provider}`,
	        registerHuman: `curl -X POST ${registerEndpoint} -H 'content-type: application/json' -d '{"participantType":"human","participantId":"${human?.id ?? "<human_user_id>"}","notes":"public-event-entry"}'`,
	        registerAgent: `curl -X POST ${registerEndpoint} -H 'content-type: application/json' -d '{"participantType":"agent","participantId":"${agent?.id ?? "<agent_id>"}","notes":"public-event-entry"}'`,
	        inspectEventOps: `npm run event:ops -- --scope=${input.scope}${selectedSuite ? ` --suite-id=${selectedSuite.id}` : ""}`,
	        scheduleSuite: selectedSuite ? `npm run event:ops -- --scope=${input.scope} --suite-id=${selectedSuite.id} --execute=schedule-suite` : undefined
	      },
	      links: {
	        event: `${input.apiBaseUrl}/api/competition-events/${input.scope}`,
	        registrations: `${input.apiBaseUrl}/api/competition-events/registrations`,
	        evidenceBundle: `${input.apiBaseUrl}/api/competition-events/${input.scope}/evidence-bundle`,
	        resultCertificate: `${input.apiBaseUrl}/api/competition-events/${input.scope}/result-certificate`,
	        selectedTaskScoreboard: `${input.apiBaseUrl}/api/public/tasks/${encodeURIComponent(selectedTask.id)}/scoreboard?season=${input.scope}&limit=${limit}`,
	        publicHub: `${input.apiBaseUrl}/api/public/competition-hub?season=${input.scope}&appid=${selectedTask.appid}&taskId=${encodeURIComponent(selectedTask.id)}&provider=${encodeURIComponent(provider)}&limit=${limit}`
	      },
	      nextActions: [
	        ...(humanStatus === "missing-human" ? ["Create a human profile and link Steam with proof consent."] : []),
	        ...(humanStatus === "steam-not-linked" ? ["Link Steam before event registration."] : []),
	        ...(humanStatus === "proof-consent-required" ? ["Grant Steam proof consent before event registration."] : []),
	        ...(humanStatus === "ready-to-register" ? ["POST the human registration body to enter the event."] : []),
	        ...(agentStatus === "missing-agent" ? ["Register an active agent before event registration."] : []),
	        ...(agentStatus === "ready-to-register" ? ["POST the agent registration body to enter the event."] : []),
	        ...(humanRegistration && agentRegistration ? ["Inspect event ops and schedule suite races for registered pairs."] : []),
	        ...(opsReport.totals.readyForPublicShare ? ["Share the event result certificate."] : ["Use the event ops report to advance scheduling, execution, or campaign comparisons."])
	      ]
	    };
	  }

	  async function buildHumanCampaignPlanFor(input: {
    user: Awaited<ReturnType<SteambenchStore["read"]>>["users"][number];
    campaignId?: string;
    limit?: number;
  }) {
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    const campaign = input.campaignId
      ? snapshot.agentCampaigns.find((entry) => entry.id === input.campaignId)
      : snapshot.agentCampaigns[0];
    if (input.campaignId && !campaign) return null;
    const campaignReport = campaign
      ? buildAgentBenchmarkCampaignReport({
          campaign,
          snapshot,
          tasks
        })
      : undefined;
    return buildHumanBenchmarkCampaignPlan({
      user: input.user,
      snapshot,
      tasks,
      campaignReport,
      limit: input.limit ?? 8
    });
  }

  async function buildSteamProofReportFor(input: {
    user: Awaited<ReturnType<SteambenchStore["read"]>>["users"][number];
    appid?: number;
    live?: boolean;
    forceRefresh?: boolean;
  }) {
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    let fetchedAchievements;
    let fetchMeta;
    let fetchError;
    if (input.live && input.appid !== undefined && input.user.linkedSteamId && input.user.proofConsentAt) {
      if (!process.env.STEAM_WEB_API_KEY) {
        fetchError = "STEAM_WEB_API_KEY is required for live linked-player achievement proof fetches.";
      } else {
        try {
          const result = await fetchPlayerAchievementsWithMeta(
            {
              appid: input.appid,
              steamid: input.user.linkedSteamId,
              apiKey: process.env.STEAM_WEB_API_KEY
            },
            {
              forceRefresh: input.forceRefresh,
              ttlMs: 5 * 60 * 1000
            }
          );
          fetchedAchievements = result.data;
          fetchMeta = result.meta;
        } catch (error) {
          fetchError = error instanceof Error ? error.message : "Unknown Steam player achievement fetch error";
        }
      }
    }
    return buildSteamProofFetchReport({
      user: input.user,
      snapshot,
      tasks,
      appid: input.appid,
      cache: getSteamMetadataCacheSnapshot(),
      liveProofEnabled: Boolean(process.env.STEAM_WEB_API_KEY),
      fetchedAchievements,
      fetchMeta,
      fetchError
    });
  }

  async function runLocalHumanCampaign(input: {
    user: Awaited<ReturnType<SteambenchStore["read"]>>["users"][number];
    campaignId?: string;
    limit?: number;
    apiBaseUrl: string;
  }) {
    const planBefore = await buildHumanCampaignPlanFor({
      user: input.user,
      campaignId: input.campaignId,
      limit: input.limit
    });
    if (!planBefore) return null;
    const submissions = [];
    for (const item of planBefore.items.filter((entry) => entry.status === "ready")) {
      const result = await runLocalHumanSteamProofSubmission({
        user: input.user,
        taskId: item.task.id,
        apiBaseUrl: input.apiBaseUrl
      });
      if (result) {
        submissions.push({
          taskId: item.task.id,
          runId: result.run.id,
          scoreboardReady: result.evaluation?.passed === true,
          run: result.run,
          task: result.task,
          evaluation: result.evaluation,
          bundle: result.bundle,
          certificate: result.certificate
        });
      }
    }
    const planAfter = await buildHumanCampaignPlanFor({
      user: input.user,
      campaignId: input.campaignId,
      limit: input.limit
    });
    const comparisonBundle = planAfter?.source.campaignId
      ? await buildHumanAgentComparisonBundleFor({
          humanUserId: input.user.id,
          campaignId: planAfter.source.campaignId,
          apiBaseUrl: input.apiBaseUrl
        })
      : null;
    const comparisonCertificate = comparisonBundle
      ? buildHumanAgentComparisonResultCertificate({
          bundle: comparisonBundle,
          baseUrl: input.apiBaseUrl
        })
      : undefined;
    return {
      schemaVersion: "steambench.human-campaign-run.v1",
      userId: input.user.id,
      campaignId: planAfter?.source.campaignId,
      planBefore,
      submissions,
      planAfter,
      comparison: comparisonBundle?.comparison,
      bundle: comparisonBundle,
      certificate: comparisonCertificate
    };
  }

  async function runLocalAgentCampaign(campaignId: string) {
    const campaign = await store.getAgentCampaign(campaignId);
    if (!campaign) return null;
    const results = [];
    for (const runId of campaign.runIds) {
      const detail = await store.getRun(runId);
      if (!detail) {
        results.push({ runId, error: "run_not_found" });
        continue;
      }
      const snapshot = await store.read();
      const runDispatch = snapshot.dispatches.find((entry) => campaign.dispatchIds.includes(entry.id) && entry.runId === runId);
      if (runDispatch && runDispatch.status === "planned") {
        await store.updateRuntimeDispatchStatus(runDispatch.id, "launched", `Local campaign runner launched ${runId}.`);
      }
      const simulated = await simulateAgentAttempt(detail.run.id, detail.run.taskId);
      if (runDispatch) {
        await store.updateRuntimeDispatchStatus(
          runDispatch.id,
          simulated?.evaluation?.passed ? "completed" : "failed",
          simulated?.evaluation?.passed
            ? `Local campaign runner completed ${runId}.`
            : `Local campaign runner could not score ${runId}.`
        );
      }
      results.push({
        runId,
        taskId: detail.run.taskId,
        events: simulated?.events ?? [],
        stream: simulated?.stream,
        evaluation: simulated?.evaluation,
        run: simulated?.evaluation?.run ?? simulated?.detail?.run
      });
    }
    const report = await buildAgentCampaignReportFor(campaign);
    const synced = await store.updateAgentCampaignStatus(
      campaign.id,
      report.status,
      report.status === "scoreboard-ready"
        ? `Campaign scored ${report.totals.scored}/${report.totals.tasks} runs for ${report.totals.totalScore} points.`
        : `Campaign has ${report.totals.scored}/${report.totals.tasks} scored runs.`
    );
    return {
      results,
      report: synced ? await buildAgentCampaignReportFor(synced) : report
    };
  }

  async function runLocalMatch(matchId: string) {
    const started = await store.startMatch(matchId);
    if (!started) return null;

    await store.appendRunEvent({
      runId: started.humanRun.id,
      type: "plan",
      message: `Local arena human side prepared for match ${started.match.id}.`,
      metadata: {
        matchId: started.match.id,
        side: "human"
      }
    });
    await store.appendRunEvent({
      runId: started.agentRun.id,
      type: "plan",
      message: `Local arena agent side prepared for match ${started.match.id}.`,
      metadata: {
        matchId: started.match.id,
        side: "agent"
      }
    });

    const human = await submitLocalHumanProof(started.humanRun.id, started.match.taskId, started.match.humanUserId);
    const agent = await simulateAgentAttempt(started.agentRun.id, started.match.taskId);
    const evaluated = await store.evaluateMatch(started.match.id);
    return {
      started,
      human,
      agent,
      evaluated,
      complete: Boolean(evaluated && human && agent)
    };
  }

  async function resolveMatchArenaPacket(matchId: string) {
    const snapshot = await store.read();
    const match = snapshot.matches.find((entry) => entry.id === matchId);
    const task = match ? await store.findTask(match.taskId) : null;
    if (!match || !task) return null;
    return buildMatchArenaPacket({
      match,
      task,
      human: snapshot.users.find((entry) => entry.id === match.humanUserId),
      agent: snapshot.agents.find((entry) => entry.id === match.agentId),
      humanRun: match.humanRunId ? snapshot.runs.find((entry) => entry.id === match.humanRunId) : undefined,
      agentRun: match.agentRunId ? snapshot.runs.find((entry) => entry.id === match.agentRunId) : undefined
    });
  }

  async function runLocalSuiteRace(raceId: string) {
    const snapshot = await store.read();
    const race = snapshot.suiteRaces.find((entry) => entry.id === raceId);
    if (!race) return null;

    const childResults: Array<Record<string, unknown>> = [];
    const incompleteMatches: string[] = [];
    for (const matchId of race.matchIds) {
      const localRun = await runLocalMatch(matchId);
      if (!localRun || !localRun.complete || localRun.evaluated?.match.status !== "scored") {
        incompleteMatches.push(matchId);
      }
      if (localRun) {
        childResults.push({
          matchId,
          match: localRun.evaluated?.match ?? localRun.started.match,
          humanRun: localRun.evaluated?.humanRun ?? localRun.started.humanRun,
          agentRun: localRun.evaluated?.agentRun ?? localRun.started.agentRun,
          human: localRun.human,
          agent: localRun.agent
        });
      } else {
        childResults.push({ matchId, error: "match_not_found_or_unstartable" });
      }
    }

    const evaluated = await store.evaluateSuiteRace(raceId);
    const audit = await buildSuiteRaceAudit(raceId);
    const bundle = await buildSuiteRaceBundle(raceId);
    return {
      race,
      evaluated,
      childResults,
      incompleteMatches,
      audit,
      bundle,
      complete: Boolean(evaluated && audit && bundle && evaluated.race.status === "scored" && incompleteMatches.length === 0)
    };
  }

  async function resolveRuntimeControlSession(session: RuntimeControlSession) {
    const snapshot = await store.read();
    return {
      session,
      run: snapshot.runs.find((run) => run.id === session.runId),
      task: await store.findTask(session.taskId),
      agent: session.agentId ? snapshot.agents.find((agent) => agent.id === session.agentId) : undefined,
      links: {
        playbook: `/api/runs/${session.runId}/agent-playbook${session.agentId ? `?agentId=${encodeURIComponent(session.agentId)}` : ""}`,
        actionBatch: `/api/runs/${session.runId}/action-batches`,
        heartbeat: `/api/control-sessions/${session.id}/heartbeat`,
        revoke: `/api/control-sessions/${session.id}/revoke`,
        trace: `/api/runs/${session.runId}/agent-trace`,
        accessPacket: `/api/control-sessions/${session.id}/access-packet`,
        bridgeManifest: `/api/control-sessions/${session.id}/bridge-manifest`,
        executorReport: `/api/runs/${session.runId}/controller-executor-reports`
      }
    };
  }

  async function buildControlBridgeManifestPayload(session: RuntimeControlSession) {
    const snapshot = await store.read();
    const run = snapshot.runs.find((entry) => entry.id === session.runId);
    const task = await store.findTask(session.taskId);
    if (!run || !task) return null;
    return buildControlBridgeManifest({
      session,
      run,
      task,
      agent: session.agentId ? snapshot.agents.find((agent) => agent.id === session.agentId) : undefined,
      events: snapshot.events.filter((event) => event.runId === session.runId)
    });
  }

  async function buildRuntimeControlAccessPacketPayload(session: RuntimeControlSession) {
    const snapshot = await store.read();
    const run = snapshot.runs.find((entry) => entry.id === session.runId);
    const task = await store.findTask(session.taskId);
    if (!run || !task) return null;
    return buildRuntimeControlAccessPacket({
      session,
      run,
      task,
      agent: session.agentId ? snapshot.agents.find((agent) => agent.id === session.agentId) : undefined
    });
  }

  function controllerExecutorReportMetadata(input: {
    report: Record<string, unknown>;
    runId: string;
    taskId: string;
    sessionId?: string;
  }): { metadata?: Record<string, string | number | boolean>; error?: string } {
    const report = input.report;
    if (report.schemaVersion !== "steambench.controller-executor-report.v1") return { error: "invalid_executor_report_schema" };
    if (report.executor !== "geforce-now" && report.executor !== "audit") return { error: "invalid_executor" };
    if (report.status !== "validated" && report.status !== "executed") return { error: "invalid_executor_status" };
    if (report.planSchemaVersion !== "steambench.controller-execution-plan.v1") return { error: "invalid_plan_schema" };
    if (report.runId !== undefined && report.runId !== input.runId) return { error: "executor_report_run_mismatch" };
    if (report.taskId !== undefined && report.taskId !== input.taskId) return { error: "executor_report_task_mismatch" };
    if (input.sessionId && report.sessionId !== undefined && report.sessionId !== input.sessionId) {
      return { error: "executor_report_session_mismatch" };
    }
    const plannedStepCount = Number(report.plannedStepCount);
    const executedStepCount = Number(report.executedStepCount ?? 0);
    const totalDurationMs = Number(report.totalDurationMs ?? 0);
    if (!Number.isFinite(plannedStepCount) || plannedStepCount <= 0) return { error: "invalid_planned_step_count" };
    if (!Number.isFinite(executedStepCount) || executedStepCount < 0 || executedStepCount > plannedStepCount) {
      return { error: "invalid_executed_step_count" };
    }
    if (!Number.isFinite(totalDurationMs) || totalDurationMs < 0) return { error: "invalid_total_duration_ms" };
    if (report.sideEffects !== false) return { error: "executor_report_side_effects_not_allowed" };

    return {
      metadata: {
        executorReport: "steambench.controller-executor-report.v1",
        controlSessionId: input.sessionId ?? String(report.sessionId ?? ""),
        executor: String(report.executor),
        executorProvider: String(report.provider ?? ""),
        executorStatus: String(report.status),
        planSchemaVersion: String(report.planSchemaVersion),
        target: String(report.target ?? ""),
        timing: String(report.timing ?? ""),
        totalDurationMs,
        plannedStepCount,
        executedStepCount,
        sideEffects: false,
        adapterProtocol: String(report.adapterProtocol ?? ""),
        backendProtocol: String(report.backendProtocol ?? "")
      }
    };
  }

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      service: "steambench-api",
      steamLiveEnabled: Boolean(process.env.STEAM_WEB_API_KEY),
      canonicalCaptureArtifact: "output.mp4"
    });
  });

  app.post("/api/result-certificates/verify", (request, response) => {
    const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    const verification = verifyResultCertificate(body.certificate ?? body);
    response.status(verification.valid ? 200 : 422).json({ verification });
  });

  app.get("/api/result-certificates", async (request, response) => {
    const kind = parseResultCertificateIndexKind(request.query.kind);
    if (!kind) {
      response.status(400).json({ error: "invalid_certificate_kind" });
      return;
    }
    const requestedLimit = Number(request.query.limit ?? 50);
    if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
      response.status(400).json({ error: "invalid_limit" });
      return;
    }
    response.json({
      index: await buildResultCertificateIndex({
        kind,
        limit: Math.min(200, Math.floor(requestedLimit)),
        apiBaseUrl: requestBaseUrl(request)
      })
    });
  });

	  app.get("/api/public/benchmark-snapshot", async (request, response) => {
	    const scope = parseSeasonScope(request.query.season);
	    if (!scope) {
	      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const requestedLimit = Number(request.query.limit ?? 12);
    if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
      response.status(400).json({ error: "invalid_limit" });
      return;
    }
    const limit = Math.min(50, Math.floor(requestedLimit));
    response.json({
      snapshot: await buildPublicBenchmarkSnapshot({
        scope,
        limit,
        apiBaseUrl: requestBaseUrl(request)
	      })
	    });
	  });

  app.get("/api/public/standings", async (request, response) => {
    const scope = parseSeasonScope(request.query.season ?? "weekly");
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const requestedLimit = Number(request.query.limit ?? 25);
    if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
      response.status(400).json({ error: "invalid_limit" });
      return;
    }
    const requestedAppid = request.query.appid === undefined ? undefined : Number(request.query.appid);
    if (request.query.appid !== undefined && (typeof requestedAppid !== "number" || !Number.isInteger(requestedAppid) || requestedAppid <= 0)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const track = request.query.track === undefined ? undefined : String(request.query.track);
    if (track !== undefined && track !== "achievement" && track !== "leaderboard" && track !== "stat" && track !== "capture") {
      response.status(400).json({ error: "invalid_track" });
      return;
    }
    const competitor = request.query.competitor === undefined ? undefined : String(request.query.competitor);
    if (competitor !== undefined && competitor !== "human" && competitor !== "agent") {
      response.status(400).json({ error: "invalid_competitor" });
      return;
    }
    response.json({
      standings: await buildPublicStandings({
        scope,
        appid: requestedAppid,
        track: track as BenchmarkTask["track"] | undefined,
        competitor: competitor as "human" | "agent" | undefined,
        limit: Math.min(100, Math.floor(requestedLimit)),
        apiBaseUrl: requestBaseUrl(request)
      })
    });
  });

	  app.get("/api/public/competition-hub", async (request, response) => {
	    const scope = parseSeasonScope(request.query.season);
	    if (!scope) {
	      response.status(400).json({ error: "invalid_season_scope" });
	      return;
	    }
	    const requestedLimit = Number(request.query.limit ?? 12);
	    if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
	      response.status(400).json({ error: "invalid_limit" });
	      return;
	    }
	    const appid = request.query.appid === undefined ? undefined : Number(request.query.appid);
	    if (request.query.appid !== undefined && !Number.isFinite(appid)) {
	      response.status(400).json({ error: "invalid_appid" });
	      return;
	    }
	    const provider = request.query.provider === undefined ? undefined : String(request.query.provider);
	    if (provider !== undefined && provider !== "local" && provider !== "modal" && provider !== "external") {
	      response.status(400).json({ error: "invalid_provider" });
	      return;
	    }
	    const hub = await buildPublicCompetitionHub({
	      scope,
	      appid,
	      taskId: request.query.taskId === undefined ? undefined : String(request.query.taskId),
	      provider: provider as AgentProfile["provider"] | undefined,
	      limit: Math.min(50, Math.floor(requestedLimit)),
	      apiBaseUrl: requestBaseUrl(request)
	    });
	    if (!hub) {
	      response.status(404).json({ error: "competition_hub_not_found" });
	      return;
	    }
	    response.json({ hub });
	  });

  app.get("/api/public/catalog", async (request, response) => {
    const scope = parseSeasonScope(request.query.season ?? "weekly");
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const requestedLimit = Number(request.query.limit ?? 24);
    if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
      response.status(400).json({ error: "invalid_limit" });
      return;
    }
    const requestedAppid = request.query.appid === undefined ? undefined : Number(request.query.appid);
    if (request.query.appid !== undefined && (typeof requestedAppid !== "number" || !Number.isInteger(requestedAppid) || requestedAppid <= 0)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const track = request.query.track === undefined ? undefined : String(request.query.track);
    if (track !== undefined && track !== "achievement" && track !== "leaderboard" && track !== "stat" && track !== "capture") {
      response.status(400).json({ error: "invalid_track" });
      return;
    }
    const transport = request.query.transport === undefined ? undefined : String(request.query.transport);
    if (transport !== undefined && transport !== "local-desktop" && transport !== "virtual-controller" && transport !== "structured-turn-api") {
      response.status(400).json({ error: "invalid_transport" });
      return;
    }
    const bridgeable = request.query.bridgeable === undefined
      ? undefined
      : request.query.bridgeable === "true" || request.query.bridgeable === "1"
        ? true
        : request.query.bridgeable === "false" || request.query.bridgeable === "0"
          ? false
          : null;
    if (bridgeable === null) {
      response.status(400).json({ error: "invalid_bridgeable" });
      return;
    }
    const provider = request.query.provider === undefined ? undefined : String(request.query.provider);
    if (provider !== undefined && provider !== "local" && provider !== "modal" && provider !== "external") {
      response.status(400).json({ error: "invalid_provider" });
      return;
    }
    response.json({
      catalog: await buildPublicCatalog({
        scope,
        appid: requestedAppid,
        track: track as BenchmarkTask["track"] | undefined,
        transport: transport as RuntimeControlSession["actionSpace"]["transport"] | undefined,
        bridgeable: bridgeable ?? undefined,
        provider: provider as AgentProfile["provider"] | undefined,
        limit: Math.min(100, Math.floor(requestedLimit)),
        apiBaseUrl: requestBaseUrl(request)
      })
    });
  });

	  app.get("/api/public/quickstart", async (request, response) => {
	    const scope = parseSeasonScope(request.query.season ?? "weekly");
	    if (!scope) {
	      response.status(400).json({ error: "invalid_season_scope" });
	      return;
	    }
	    const requestedLimit = Number(request.query.limit ?? 12);
	    if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
	      response.status(400).json({ error: "invalid_limit" });
	      return;
	    }
	    const appid = request.query.appid === undefined ? undefined : Number(request.query.appid);
	    if (request.query.appid !== undefined && !Number.isFinite(appid)) {
	      response.status(400).json({ error: "invalid_appid" });
	      return;
	    }
	    const provider = request.query.provider === undefined ? undefined : String(request.query.provider);
	    if (provider !== undefined && provider !== "local" && provider !== "modal" && provider !== "external") {
	      response.status(400).json({ error: "invalid_provider" });
	      return;
	    }
	    const quickstart = await buildPublicQuickstart({
	      scope,
	      appid,
	      taskId: request.query.taskId === undefined ? undefined : String(request.query.taskId),
	      humanUserId: request.query.humanUserId === undefined ? undefined : String(request.query.humanUserId),
	      agentId: request.query.agentId === undefined ? undefined : String(request.query.agentId),
	      provider: provider as AgentProfile["provider"] | undefined,
	      limit: Math.min(50, Math.floor(requestedLimit)),
	      apiBaseUrl: requestBaseUrl(request)
	    });
	    if (!quickstart) {
	      response.status(404).json({ error: "quickstart_not_found" });
	      return;
	    }
	    response.json({ quickstart });
	  });

	  app.get("/api/public/events/:scope/entry", async (request, response) => {
	    const scope = parseSeasonScope(request.params.scope);
	    if (!scope) {
	      response.status(400).json({ error: "invalid_season_scope" });
	      return;
	    }
	    const requestedLimit = Number(request.query.limit ?? 12);
	    if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
	      response.status(400).json({ error: "invalid_limit" });
	      return;
	    }
	    const appid = request.query.appid === undefined ? undefined : Number(request.query.appid);
	    if (request.query.appid !== undefined && !Number.isFinite(appid)) {
	      response.status(400).json({ error: "invalid_appid" });
	      return;
	    }
	    const provider = request.query.provider === undefined ? undefined : String(request.query.provider);
	    if (provider !== undefined && provider !== "local" && provider !== "modal" && provider !== "external") {
	      response.status(400).json({ error: "invalid_provider" });
	      return;
	    }
	    const humanUserId = request.query.humanUserId === undefined ? undefined : String(request.query.humanUserId);
	    const agentId = request.query.agentId === undefined ? undefined : String(request.query.agentId);
	    const snapshot = await store.read();
	    if (humanUserId && !snapshot.users.some((user) => user.id === humanUserId && user.type === "human")) {
	      response.status(404).json({ error: "human_user_not_found" });
	      return;
	    }
	    if (agentId && !snapshot.agents.some((agent) => agent.id === agentId || agent.handle === agentId)) {
	      response.status(404).json({ error: "agent_not_found" });
	      return;
	    }
	    const entry = await buildPublicEventEntry({
	      scope,
	      taskId: request.query.taskId === undefined ? undefined : String(request.query.taskId),
	      appid,
	      humanUserId,
	      agentId,
	      provider: provider as AgentProfile["provider"] | undefined,
	      suiteId: request.query.suiteId === undefined ? undefined : String(request.query.suiteId),
	      limit: Math.min(50, Math.floor(requestedLimit)),
	      apiBaseUrl: requestBaseUrl(request)
	    });
	    if (!entry) {
	      response.status(404).json({ error: "event_entry_not_found" });
	      return;
	    }
	    response.json({ entry });
	  });

	  app.get("/api/public/steam/apps/:appid/intake", async (request, response) => {
	    const appid = Number(request.params.appid);
	    if (!Number.isFinite(appid)) {
	      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const requestedLimit = Number(request.query.limit ?? 12);
    if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
      response.status(400).json({ error: "invalid_limit" });
      return;
    }
    const harnessRisk =
      request.query.harnessRisk === "low" || request.query.harnessRisk === "medium" || request.query.harnessRisk === "high"
        ? request.query.harnessRisk
        : undefined;
    try {
      response.json({
        intake: await buildPublicSteamAppIntake({
          appid,
          useFixture: request.query.useFixture === "true",
          refresh: request.query.refresh === "true",
          limit: Math.min(50, Math.floor(requestedLimit)),
          gameName: request.query.gameName === undefined ? undefined : String(request.query.gameName),
          benchmarkFit: request.query.benchmarkFit === undefined ? undefined : Number(request.query.benchmarkFit),
          harnessRisk,
          apiBaseUrl: requestBaseUrl(request)
        })
      });
    } catch (error) {
      response.status(502).json({
        error: "public_steam_app_intake_failed",
        message: error instanceof Error ? error.message : "Unknown Steam app intake error"
      });
	    }
	  });

	  app.get("/api/public/agents/onboarding", async (request, response) => {
	    const provider = request.query.provider === undefined ? undefined : String(request.query.provider);
	    if (provider !== undefined && provider !== "local" && provider !== "modal" && provider !== "external") {
	      response.status(400).json({ error: "invalid_provider" });
	      return;
	    }
	    const agentId = request.query.agentId === undefined ? undefined : String(request.query.agentId);
	    const snapshot = await store.read();
	    if (agentId && !snapshot.agents.some((agent) => agent.id === agentId || agent.handle === agentId)) {
	      response.status(404).json({ error: "agent_not_found" });
	      return;
	    }
	    const requestedLimit = request.query.limit === undefined ? 6 : Number(request.query.limit);
	    if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
	      response.status(400).json({ error: "invalid_limit" });
	      return;
	    }
	    const onboarding = await buildPublicAgentOnboarding({
	      taskId: request.query.taskId === undefined ? undefined : String(request.query.taskId),
	      agentId,
	      provider: provider as AgentProfile["provider"] | undefined,
	      limit: Math.min(20, Math.floor(requestedLimit)),
	      apiBaseUrl: requestBaseUrl(request)
	    });
	    if (!onboarding) {
	      response.status(404).json({ error: "task_not_found" });
	      return;
	    }
	    response.json({ onboarding });
	  });

	  app.get("/api/public/games/:appid/benchmark-pack", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const scope = parseSeasonScope(request.query.season);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const requestedLimit = Number(request.query.limit ?? 12);
    if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
      response.status(400).json({ error: "invalid_limit" });
      return;
    }
    const pack = await buildPublicGameBenchmarkPack({
      appid,
      scope,
      limit: Math.min(50, Math.floor(requestedLimit)),
      apiBaseUrl: requestBaseUrl(request)
    });
    if (!pack) {
      response.status(404).json({ error: "game_or_discovery_not_found" });
      return;
    }
    response.json({ pack });
  });

  app.get("/api/public/broadcasts/:streamId/watch", async (request, response) => {
    const requestedLimit = Number(request.query.timelineLimit ?? request.query.limit ?? 8);
    if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
      response.status(400).json({ error: "invalid_limit" });
      return;
    }
    const bundle = await buildBroadcastBundle(request.params.streamId);
    if (!bundle) {
      response.status(404).json({ error: "broadcast_not_found" });
      return;
    }
    response.json({
      watch: buildPublicBroadcastWatch({
        bundle,
        apiBaseUrl: requestBaseUrl(request),
        timelineLimit: Math.min(50, Math.floor(requestedLimit))
      })
    });
  });

	  app.get("/api/public/tasks/:taskId/scoreboard", async (request, response) => {
	    const scope = parseSeasonScope(request.query.season);
	    if (!scope) {
	      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const requestedLimit = Number(request.query.limit ?? 12);
    if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
      response.status(400).json({ error: "invalid_limit" });
      return;
    }
    const scoreboard = await buildPublicTaskScoreboard({
      taskId: request.params.taskId,
      scope,
      limit: Math.min(50, Math.floor(requestedLimit)),
      apiBaseUrl: requestBaseUrl(request)
    });
    if (!scoreboard) {
      response.status(404).json({ error: "task_not_found" });
      return;
	    }
	    response.json({ scoreboard });
	  });

	  app.get("/api/public/tasks/:taskId/action-space", async (request, response) => {
	    const agentId = request.query.agentId === undefined ? undefined : String(request.query.agentId);
	    const snapshot = await store.read();
	    if (agentId && !snapshot.agents.some((agent) => agent.id === agentId || agent.handle === agentId)) {
	      response.status(404).json({ error: "agent_not_found" });
	      return;
	    }
	    const actionSpace = await buildPublicTaskActionSpace({
	      taskId: request.params.taskId,
	      agentId,
	      apiBaseUrl: requestBaseUrl(request)
	    });
	    if (!actionSpace) {
	      response.status(404).json({ error: "task_not_found" });
	      return;
	    }
	    response.json({ actionSpace });
	  });

	  app.get("/api/public/tasks/:taskId/bridge-handoff", async (request, response) => {
	    const agentId = request.query.agentId === undefined ? undefined : String(request.query.agentId);
	    const provider = request.query.provider === undefined ? undefined : String(request.query.provider);
	    if (provider !== undefined && provider !== "local" && provider !== "modal" && provider !== "external") {
	      response.status(400).json({ error: "invalid_provider" });
	      return;
	    }
	    const requestedTtl = request.query.ttlSeconds === undefined ? 900 : Number(request.query.ttlSeconds);
	    if (!Number.isFinite(requestedTtl) || requestedTtl < 30) {
	      response.status(400).json({ error: "invalid_ttl_seconds" });
	      return;
	    }
	    const snapshot = await store.read();
	    if (agentId && !snapshot.agents.some((agent) => agent.id === agentId || agent.handle === agentId)) {
	      response.status(404).json({ error: "agent_not_found" });
	      return;
	    }
	    const handoff = await buildPublicBridgeHandoff({
	      taskId: request.params.taskId,
	      agentId,
	      provider: provider as AgentProfile["provider"] | undefined,
	      ttlSeconds: Math.min(3600, Math.floor(requestedTtl)),
	      apiBaseUrl: requestBaseUrl(request)
	    });
	    if (!handoff) {
	      response.status(404).json({ error: "task_not_found" });
	      return;
	    }
	    response.json({ handoff });
	  });

	  app.get("/api/public/tasks/:taskId/race-entry", async (request, response) => {
	    const humanUserId = request.query.humanUserId === undefined ? undefined : String(request.query.humanUserId);
	    const agentId = request.query.agentId === undefined ? undefined : String(request.query.agentId);
	    const provider = request.query.provider === undefined ? undefined : String(request.query.provider);
	    if (provider !== undefined && provider !== "local" && provider !== "modal" && provider !== "external") {
	      response.status(400).json({ error: "invalid_provider" });
	      return;
	    }
	    const requestedLimit = request.query.limit === undefined ? 6 : Number(request.query.limit);
	    if (!Number.isFinite(requestedLimit) || requestedLimit < 1) {
	      response.status(400).json({ error: "invalid_limit" });
	      return;
	    }
	    const snapshot = await store.read();
	    if (humanUserId && !snapshot.users.some((user) => user.id === humanUserId && user.type === "human")) {
	      response.status(404).json({ error: "human_user_not_found" });
	      return;
	    }
	    if (agentId && !snapshot.agents.some((agent) => agent.id === agentId || agent.handle === agentId)) {
	      response.status(404).json({ error: "agent_not_found" });
	      return;
	    }
	    const raceEntry = await buildPublicTaskRaceEntry({
	      taskId: request.params.taskId,
	      humanUserId,
	      agentId,
	      provider: provider as AgentProfile["provider"] | undefined,
	      limit: Math.min(20, Math.floor(requestedLimit)),
	      apiBaseUrl: requestBaseUrl(request)
	    });
	    if (!raceEntry) {
	      response.status(404).json({ error: "task_not_found" });
	      return;
	    }
	    response.json({ raceEntry });
	  });

	  app.get("/api/public/tasks/:taskId/runner-contract", async (request, response) => {
	    const humanUserId = request.query.humanUserId === undefined ? undefined : String(request.query.humanUserId);
	    const agentId = request.query.agentId === undefined ? undefined : String(request.query.agentId);
    const snapshot = await store.read();
    if (humanUserId && !snapshot.users.some((user) => user.id === humanUserId && user.type === "human")) {
      response.status(404).json({ error: "human_user_not_found" });
      return;
    }
    if (agentId && !snapshot.agents.some((agent) => agent.id === agentId)) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }
    const contract = await buildPublicTaskRunnerContract({
      taskId: request.params.taskId,
      humanUserId,
      agentId,
      apiBaseUrl: requestBaseUrl(request)
    });
    if (!contract) {
      response.status(404).json({ error: "task_not_found" });
      return;
    }
    response.json({ contract });
  });

  app.get("/api/catalog", async (_request, response) => {
    const snapshot = await store.read();
    response.json({
      games: gameCatalog,
      scoreboard: snapshot.scoreboard
    });
  });

  app.get("/api/platform/ops-report", async (request, response) => {
    const scope = parseSeasonScope(request.query.scope);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const requestedLimit = Number(request.query.limit ?? 50);
    const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.floor(requestedLimit))) : 50;
    const tasks = await store.listTasks();
    const eventEvidence = summarizeCompetitionEventEvidenceBundle(
      await buildCompetitionEventBundle(scope, requestBaseUrl(request))
    );
    const steamSourceQueue = (await buildSteamSourceQueuePayload({
      useFixture: true,
      limit: 6,
      proposalLimit: 4
    })).queue;
    response.json({
      report: buildPlatformOpsReport({
        snapshot: await store.read(),
        tasks,
        suites: buildBenchmarkSuites({
          games: gameCatalog,
          tasks,
          reviews: buildTaskReviews(tasks)
        }),
        eventEvidence,
        steamSourceQueue,
        scope,
        limit
      })
    });
  });

  app.get("/api/state", async (request, response) => {
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    const taskCandidates = await store.listTaskRegistry("candidate");
    const taskRegistry = await store.listTaskRegistry();
    const taskReviews = buildTaskReviews([...tasks, ...taskRegistry.filter((entry) => !tasks.some((task) => task.id === entry.id))]);
    const taskReviewCatalog = buildTaskReviewCatalog({ tasks, taskRegistry });
    const benchmarkSuites = buildBenchmarkSuites({ games: gameCatalog, tasks, reviews: taskReviews });
    const standings = buildStandings(snapshot.scoreboard);
    const leaderboards = buildTaskLeaderboards(snapshot.scoreboard);
    const suiteRaceStandings = buildSuiteRaceStandings(snapshot.suiteRaces);
    const competitionEvents = buildCompetitionEvents({
      users: snapshot.users,
      agents: snapshot.agents,
      runs: snapshot.runs,
      matches: snapshot.matches,
      suiteRaces: snapshot.suiteRaces,
      scoreboard: snapshot.scoreboard,
      proofs: snapshot.proofs,
      streams: snapshot.streams,
      registrations: snapshot.eventRegistrations
    });
    const competitionEventBundleSummaries = (
      await Promise.all((["all", "daily", "weekly"] as const).map(async (scope) =>
        summarizeCompetitionEventEvidenceBundle(await buildCompetitionEventBundle(scope, requestBaseUrl(request)))
      ))
    );
    const broadcastCenter = buildBroadcastCenter({
      snapshot,
      tasks,
      limit: 12
    });
    const gameProfiles = buildGameBenchmarkProfiles({
      games: gameCatalog,
      tasks,
      taskRegistry,
      reviews: taskReviews,
      suites: benchmarkSuites,
      scoreboard: snapshot.scoreboard,
      broadcasts: broadcastCenter.recent
    }).slice(0, 6);
    const steamAppDiscoveries = snapshot.steamAppDiscoveries.slice(0, 12);
    const benchmarkBlueprints = gameCatalog.slice(0, 6).map((game) =>
      buildBenchmarkBlueprint({
        game,
        tasks,
        taskRegistry,
        discovery: snapshot.steamAppDiscoveries.find((entry) => entry.appid === game.appid)
      })
    );
    const competitorProfiles = [
      ...snapshot.users
        .filter((user) => user.type === "human")
        .slice(0, 6)
        .flatMap((user) => {
          const profile = buildProfileFromSnapshot(snapshot, tasks, "human", user.id);
          return profile ? [profile] : [];
        }),
      ...snapshot.agents.slice(0, 6).flatMap((agent) => {
        const profile = buildProfileFromSnapshot(snapshot, tasks, "agent", agent.id);
        return profile ? [profile] : [];
      })
    ];
    const agentRuntimeLabs = buildAgentRuntimeLabs({
      agents: snapshot.agents.slice(0, 6),
      snapshot,
      tasks,
      limit: 6
    });
    const agentCampaigns = snapshot.agentCampaigns.slice(0, 8).map((campaign) =>
      buildAgentBenchmarkCampaignReport({
        campaign,
        snapshot,
        tasks
      })
    );
    const allAgentCampaignReports = snapshot.agentCampaigns.map((campaign) =>
      buildAgentBenchmarkCampaignReport({
        campaign,
        snapshot,
        tasks
      })
    );
    const agentCampaignStandings = buildAgentCampaignStandings(allAgentCampaignReports);
    const humanAgentComparison = await buildDefaultHumanAgentComparison();
    const challenges = await Promise.all(snapshot.challenges.slice(0, 12).map((challenge) => resolveChallenge(challenge, snapshot)));
    const seasons = buildSeasonSnapshots(snapshot.scoreboard);
    const matchFeed = buildMatchFeed({
      matches: snapshot.matches,
      runs: snapshot.runs,
      users: snapshot.users,
      agents: snapshot.agents,
      tasks,
      scoreboard: snapshot.scoreboard
    });
    const matchFeeds = (["all", "daily", "weekly"] as const).map((seasonScope) =>
      buildMatchFeed({
        matches: snapshot.matches,
        runs: snapshot.runs,
        users: snapshot.users,
        agents: snapshot.agents,
        tasks,
        scoreboard: snapshot.scoreboard,
        seasonScope
      })
    );
    const workerQueue = await store.listWorkerQueue();
    const runtimeDispatches = await Promise.all(snapshot.dispatches.slice(0, 12).map((dispatch) => resolveRuntimeDispatch(dispatch, snapshot)));
    const rawRuntimeControlSessions = await store.listRuntimeControlSessions();
    const runtimeControlSessions = await Promise.all(rawRuntimeControlSessions.slice(0, 12).map((session) => resolveRuntimeControlSession(session)));
    const controlBridgeOps = buildControlBridgeOpsReport({
      sessions: rawRuntimeControlSessions,
      runs: snapshot.runs,
      tasks,
      agents: snapshot.agents,
      events: snapshot.events,
      limit: 12
    });
    const proofReviewQueue = await buildProofReviewQueue("pending");
    const auditSummaries = (
      await Promise.all(
        snapshot.runs.slice(0, 8).map(async (run) => {
          const audit = await buildRunAudit(run.id);
          return audit ? summarizeRunAudit(audit) : null;
        })
      )
    ).filter((entry) => entry !== null);
    const suiteRaceAuditSummaries = (
      await Promise.all(
        snapshot.suiteRaces.slice(0, 6).map(async (race) => {
          const audit = await buildSuiteRaceAudit(race.id);
          return audit ? summarizeSuiteRaceAudit(audit) : null;
        })
      )
    ).filter((entry) => entry !== null);
    const runtimeReadiness = snapshot.agents
      .filter((agent) => agent.status === "active")
      .flatMap((agent) =>
        tasks.map((task) => ({
          agentId: agent.id,
          taskId: task.id,
          readiness: buildRuntimeReadiness(task, agent)
        }))
      );
    const defaultHuman = snapshot.users.find((user) => user.type === "human" && user.linkedSteamId && user.proofConsentAt);
    const defaultAgent = snapshot.agents.find((agent) => agent.status === "active");
    const humanCampaignPlan = defaultHuman
      ? buildHumanBenchmarkCampaignPlan({
          user: defaultHuman,
          snapshot,
          tasks,
          campaignReport: allAgentCampaignReports[0],
          limit: 8
        })
      : null;
    const steamProofReport = defaultHuman
      ? await buildSteamProofReportFor({
          user: defaultHuman,
          appid: humanCampaignPlan?.items.find((item) => item.task.track === "achievement")?.task.appid
        })
      : null;
    const raceEligibility = defaultHuman && defaultAgent
      ? tasks.slice(0, 8).map((task) =>
          buildRaceEligibility({
            task,
            review: buildTaskReview(task),
            human: defaultHuman,
            agent: defaultAgent,
            agentReadiness: buildRuntimeReadiness(task, defaultAgent)
          })
        )
      : [];
    const manifestSummaries = (
      await Promise.all(
        snapshot.runs.slice(0, 8).map(async (run) => {
          const manifest = await buildRunExecutionManifest(run.id, `${request.protocol}://${request.get("host")}`);
          return manifest
            ? {
                runId: manifest.run.id,
                taskId: manifest.task.id,
                schemaVersion: manifest.schemaVersion,
                readiness: manifest.readiness.ready,
                artifactName: manifest.artifactContract.name,
                launchProvider: manifest.launch.provider,
                runtimeProvider: manifest.launch.runtimeProvider
              }
            : null;
        })
      )
    ).filter((entry) => entry !== null);
    const gameCoverageRuns = await Promise.all(
      snapshot.gameCoverageRuns.slice(0, 8).map((record) => resolveGameCoverageRunRecord(record, snapshot))
    );
    response.json({
      games: gameCatalog,
      adapters: adaptersForCatalog(gameCatalog),
      tasks,
      taskCandidates,
      taskRegistry,
      steamAppDiscoveries,
      taskReviews,
      taskReviewCatalog,
      benchmarkSuites,
      workerQueue,
      runtimeDispatches,
      runtimeControlSessions,
      controlBridgeOps,
      proofReviewQueue,
      auditSummaries,
      suiteRaceAuditSummaries,
      runtimeReadiness,
      raceEligibility,
      manifestSummaries,
      users: snapshot.users,
      agents: snapshot.agents,
      agentRuntimeLabs,
      agentCampaigns,
      gameCoverageRuns,
      agentCampaignStandings,
      humanCampaignPlan,
      steamProofReport,
      humanAgentComparison,
      challenges,
      matches: snapshot.matches,
      suiteRaces: snapshot.suiteRaces,
      eventRegistrations: snapshot.eventRegistrations,
      steamLinks: snapshot.steamLinks,
      runs: snapshot.runs,
      events: snapshot.events.slice(-30).reverse(),
      artifacts: snapshot.artifacts.slice(-30).reverse(),
      streams: snapshot.streams.slice(0, 12),
      broadcastCenter,
      gameProfiles,
      benchmarkBlueprints,
      proofs: snapshot.proofs.slice(-30).reverse(),
      scoreboard: snapshot.scoreboard,
      standings,
      seasons,
      matchFeed,
      matchFeeds,
      leaderboards,
      suiteRaceStandings,
      suiteRaceLeaderboards: suiteRaceStandings.leaderboards,
      competitionEvents,
      competitionEventBundleSummaries,
      competitorProfiles,
      steamDataPolicy: buildSteamDataPolicyReport()
    });
  });

  app.get("/api/competition-events", async (_request, response) => {
    const snapshot = await store.read();
    response.json({
      events: buildCompetitionEvents({
        users: snapshot.users,
        agents: snapshot.agents,
        runs: snapshot.runs,
        matches: snapshot.matches,
        suiteRaces: snapshot.suiteRaces,
        scoreboard: snapshot.scoreboard,
        proofs: snapshot.proofs,
        streams: snapshot.streams,
        registrations: snapshot.eventRegistrations
      })
    });
  });

  app.get("/api/competition-events/registrations", async (_request, response) => {
    const snapshot = await store.read();
    response.json({
      registrations: snapshot.eventRegistrations.map((registration) => resolveCompetitionEventRegistration(registration, snapshot))
    });
  });

  app.post("/api/competition-events/registrations/:registrationId/withdraw", async (request, response) => {
    const registration = await store.withdrawCompetitionEventRegistration(request.params.registrationId);
    if (!registration) {
      response.status(404).json({ error: "competition_event_registration_not_found" });
      return;
    }
    response.json({ registration });
  });

  app.get("/api/competition-events/:scope", async (request, response) => {
    const scope = parseSeasonScope(request.params.scope);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const snapshot = await store.read();
    response.json({
      event: buildCompetitionEventSummary({
        scope,
        users: snapshot.users,
        agents: snapshot.agents,
        runs: snapshot.runs,
        matches: snapshot.matches,
        suiteRaces: snapshot.suiteRaces,
        scoreboard: snapshot.scoreboard,
        proofs: snapshot.proofs,
        streams: snapshot.streams,
        registrations: snapshot.eventRegistrations
      })
    });
  });

  app.get("/api/competition-events/:scope/evidence-bundle", async (request, response) => {
    const scope = parseSeasonScope(request.params.scope);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    response.json({
      bundle: await buildCompetitionEventBundle(scope, requestBaseUrl(request))
    });
  });

  app.get("/api/competition-events/:scope/ops-report", async (request, response) => {
    const scope = parseSeasonScope(request.params.scope);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const bundle = await buildCompetitionEventBundle(scope, requestBaseUrl(request));
    const suites = await buildCurrentBenchmarkSuites();
    const requestedSuiteId = typeof request.query.suiteId === "string" ? request.query.suiteId : undefined;
    const selectedSuite = requestedSuiteId
      ? suites.find((suite) => suite.id === requestedSuiteId)
      : suites.find((suite) => suite.status === "ranked-ready" && suite.tier === "ranked")
        ?? suites.find((suite) => suite.status === "ranked-ready")
        ?? suites[0];
    if (requestedSuiteId && !selectedSuite) {
      response.status(404).json({ error: "suite_not_found" });
      return;
    }
    response.json({
      report: buildCompetitionEventOpsReport({
        scope,
        event: bundle.event,
        bundle,
        evidence: summarizeCompetitionEventEvidenceBundle(bundle),
        selectedSuite
      })
    });
  });

  app.get("/api/competition-events/:scope/result-certificate", async (request, response) => {
    const scope = parseSeasonScope(request.params.scope);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    response.json({
      certificate: buildCompetitionEventResultCertificate({
        bundle: await buildCompetitionEventBundle(scope, requestBaseUrl(request)),
        baseUrl: requestBaseUrl(request)
      })
    });
  });

  app.post("/api/competition-events/:scope/register", async (request, response) => {
    const scope = parseSeasonScope(request.params.scope);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const participantType = String(request.body.participantType ?? "");
    const participantId = String(request.body.participantId ?? "");
    if (participantType !== "human" && participantType !== "agent") {
      response.status(400).json({ error: "invalid_participant_type" });
      return;
    }
    if (!participantId) {
      response.status(400).json({ error: "participant_required" });
      return;
    }

    const snapshot = await store.read();
    if (participantType === "human") {
      const user = snapshot.users.find((entry) => entry.id === participantId);
      if (!user || user.type !== "human") {
        response.status(404).json({ error: "human_not_found" });
        return;
      }
      if (!user.linkedSteamId) {
        response.status(409).json({ error: "steam_not_linked" });
        return;
      }
      if (!user.proofConsentAt) {
        response.status(409).json({ error: "steam_proof_consent_required" });
        return;
      }
    } else {
      const agent = snapshot.agents.find((entry) => entry.id === participantId);
      if (!agent) {
        response.status(404).json({ error: "agent_not_found" });
        return;
      }
      if (agent.status !== "active") {
        response.status(409).json({ error: "agent_not_active" });
        return;
      }
    }

    const registration = await store.registerCompetitionEvent({
      eventScope: scope,
      participantType,
      participantId,
      notes: typeof request.body.notes === "string" ? request.body.notes : undefined
    });
    const updatedSnapshot = await store.read();
    response.status(201).json({
      ...resolveCompetitionEventRegistration(registration, updatedSnapshot)
    });
  });

  app.post("/api/competition-events/:scope/schedule-suite", async (request, response) => {
    const scope = parseSeasonScope(request.params.scope);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const suiteId = String(request.body.suiteId ?? "");
    if (!suiteId) {
      response.status(400).json({ error: "suite_required" });
      return;
    }

    const schedule = await scheduleCompetitionEventSuite({
      scope,
      suiteId,
      reviewApproved: Boolean(request.body.reviewApproved),
      maxPairs: request.body.maxPairs === undefined ? undefined : Number(request.body.maxPairs)
    });
    if (!schedule) {
      response.status(404).json({ error: "suite_not_found" });
      return;
    }
    response.status(schedule.scheduled.length > 0 ? 201 : 200).json({ schedule });
  });

  app.post("/api/competition-events/:scope/run-suite", async (request, response) => {
    const scope = parseSeasonScope(request.params.scope);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const suiteId = typeof request.body.suiteId === "string" ? request.body.suiteId : undefined;
    const includeScored = Boolean(request.body.includeScored);
    const maxRacesInput = Number(request.body.maxRaces ?? 5);
    const maxRaces = Number.isFinite(maxRacesInput) ? Math.max(1, Math.min(25, Math.floor(maxRacesInput))) : 5;
    const snapshot = await store.read();
    const candidates = snapshot.suiteRaces
      .filter((race) => race.eventScope === scope)
      .filter((race) => !suiteId || race.suiteId === suiteId)
      .filter((race) => includeScored || race.status !== "scored")
      .slice(0, maxRaces);

    const executed = [];
    const incomplete = [];
    for (const race of candidates) {
      const result = await runLocalSuiteRace(race.id);
      if (!result) {
        incomplete.push({ raceId: race.id, error: "suite_race_not_found" });
        continue;
      }
      const payload = {
        race: result.evaluated?.race ?? result.race,
        childResults: result.childResults,
        incompleteMatches: result.incompleteMatches,
        audit: result.audit,
        bundle: result.bundle
      };
      if (result.complete) {
        executed.push(payload);
      } else {
        incomplete.push(payload);
      }
    }

    response.status(incomplete.length === 0 ? 200 : 207).json({
      run: {
        scope,
        suiteId,
        requestedMaxRaces: maxRaces,
        candidateCount: candidates.length,
        executed,
        incomplete
      }
    });
  });

  app.post("/api/competition-events/:scope/run-campaign-comparisons-local", async (request, response) => {
    const scope = parseSeasonScope(request.params.scope);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const maxPairsInput = Number(request.body.maxPairs ?? 10);
    const maxPairs = Number.isFinite(maxPairsInput) ? Math.max(1, Math.min(25, Math.floor(maxPairsInput))) : 10;
    const snapshot = await store.read();
    const registeredHumans = snapshot.eventRegistrations
      .filter((entry) => entry.eventScope === scope && entry.status === "registered" && entry.participantType === "human")
      .flatMap((entry) => {
        const human = snapshot.users.find((user) => user.id === entry.participantId);
        return human?.type === "human" && human.linkedSteamId && human.proofConsentAt ? [human] : [];
      });
    const registeredAgents = snapshot.eventRegistrations
      .filter((entry) => entry.eventScope === scope && entry.status === "registered" && entry.participantType === "agent")
      .flatMap((entry) => {
        const agent = snapshot.agents.find((agentEntry) => agentEntry.id === entry.participantId);
        return agent?.status === "active" ? [agent] : [];
      });
    const pairs = registeredHumans.flatMap((human) =>
      registeredAgents.map((agent) => ({ human, agent }))
    ).slice(0, maxPairs);
    const executed = [];
    const missingCampaigns = [];
    const incomplete = [];
    for (const pair of pairs) {
      const freshSnapshot = await store.read();
      const campaign = freshSnapshot.agentCampaigns
        .filter((entry) => entry.agentId === pair.agent.id)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      if (!campaign) {
        missingCampaigns.push({
          humanUserId: pair.human.id,
          agentId: pair.agent.id,
          error: "campaign_not_found",
          createCampaignEndpoint: `/api/agents/${pair.agent.id}/campaigns`
        });
        continue;
      }
      const agentRun = await runLocalAgentCampaign(campaign.id);
      const humanRun = await runLocalHumanCampaign({
        user: pair.human,
        campaignId: campaign.id,
        apiBaseUrl: requestBaseUrl(request)
      });
      const comparisonBundle = await buildHumanAgentComparisonBundleFor({
        humanUserId: pair.human.id,
        campaignId: campaign.id,
        apiBaseUrl: requestBaseUrl(request)
      });
      const certificate = comparisonBundle
        ? buildHumanAgentComparisonResultCertificate({
            bundle: comparisonBundle,
            baseUrl: requestBaseUrl(request)
          })
        : undefined;
      const payload = {
        humanUserId: pair.human.id,
        agentId: pair.agent.id,
        campaignId: campaign.id,
        agentRun,
        humanRun,
        comparison: comparisonBundle?.comparison,
        bundle: comparisonBundle,
        certificate
      };
      if (certificate?.integrity.readyForPublicShare) {
        executed.push(payload);
      } else {
        incomplete.push(payload);
      }
    }
    const bundle = await buildCompetitionEventBundle(scope, requestBaseUrl(request));
    response.status(incomplete.length === 0 && missingCampaigns.length === 0 ? 200 : 207).json({
      run: {
        schemaVersion: "steambench.event-campaign-comparison-run.v1",
        scope,
        requestedMaxPairs: maxPairs,
        registeredHumans: registeredHumans.length,
        registeredAgents: registeredAgents.length,
        candidatePairs: pairs.length,
        executed,
        incomplete,
        missingCampaigns,
        bundle,
        certificate: buildCompetitionEventResultCertificate({
          bundle,
          baseUrl: requestBaseUrl(request)
        })
      }
    });
  });

  app.get("/api/benchmark-suites", async (_request, response) => {
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const taskReviews = buildTaskReviews([...tasks, ...taskRegistry.filter((entry) => !tasks.some((task) => task.id === entry.id))]);
    response.json({
      suites: buildBenchmarkSuites({ games: gameCatalog, tasks, reviews: taskReviews })
    });
  });

  app.get("/api/suite-races", async (_request, response) => {
    const snapshot = await store.read();
    response.json({
      suiteRaces: snapshot.suiteRaces.map((race) => ({
        race,
        matches: race.matchIds.map((matchId) => snapshot.matches.find((match) => match.id === matchId)).filter(Boolean),
        human: snapshot.users.find((user) => user.id === race.humanUserId),
        agent: snapshot.agents.find((agent) => agent.id === race.agentId)
      }))
    });
  });

  app.get("/api/suite-races/standings", async (_request, response) => {
    const snapshot = await store.read();
    const suiteRaceStandings = buildSuiteRaceStandings(snapshot.suiteRaces);
    response.json({
      standings: suiteRaceStandings,
      leaderboards: suiteRaceStandings.leaderboards
    });
  });

  app.get("/api/suite-races/:raceId", async (request, response) => {
    const snapshot = await store.read();
    const race = snapshot.suiteRaces.find((entry) => entry.id === request.params.raceId);
    if (!race) {
      response.status(404).json({ error: "suite_race_not_found" });
      return;
    }
    response.json({
      race,
      matches: race.matchIds.map((matchId) => snapshot.matches.find((match) => match.id === matchId)).filter(Boolean),
      human: snapshot.users.find((user) => user.id === race.humanUserId),
      agent: snapshot.agents.find((agent) => agent.id === race.agentId)
    });
  });

  app.get("/api/suite-races/:raceId/audit", async (request, response) => {
    const audit = await buildSuiteRaceAudit(request.params.raceId);
    if (!audit) {
      response.status(404).json({ error: "suite_race_not_found" });
      return;
    }
    response.json({ audit });
  });

  app.get("/api/suite-races/:raceId/evidence-bundle", async (request, response) => {
    const bundle = await buildSuiteRaceBundle(request.params.raceId);
    if (!bundle) {
      response.status(404).json({ error: "suite_race_not_found" });
      return;
    }
    response.json({ bundle });
  });

  app.get("/api/suite-races/:raceId/result-certificate", async (request, response) => {
    const bundle = await buildSuiteRaceBundle(request.params.raceId);
    if (!bundle) {
      response.status(404).json({ error: "suite_race_not_found" });
      return;
    }
    response.json({
      certificate: buildSuiteRaceResultCertificate({
        bundle,
        baseUrl: requestBaseUrl(request)
      })
    });
  });

  app.post("/api/suite-races/:raceId/run-local", async (request, response) => {
    const result = await runLocalSuiteRace(request.params.raceId);
    if (!result) {
      response.status(404).json({ error: "suite_race_not_found" });
      return;
    }
    if (!result.evaluated || !result.audit || !result.bundle) {
      response.status(422).json({
        error: "suite_race_run_incomplete",
        childResults: result.childResults,
        incompleteMatches: result.incompleteMatches,
        audit: result.audit,
        bundle: result.bundle
      });
      return;
    }

    response.status(result.complete ? 200 : 422).json({
      ...result.evaluated,
      childResults: result.childResults,
      incompleteMatches: result.incompleteMatches,
      audit: result.audit,
      bundle: result.bundle
    });
  });

  app.post("/api/suite-races/:raceId/evaluate", async (request, response) => {
    const evaluated = await store.evaluateSuiteRace(request.params.raceId);
    if (!evaluated) {
      response.status(404).json({ error: "suite_race_not_found" });
      return;
    }
    response.status(evaluated.race.status === "scored" ? 200 : 422).json(evaluated);
  });

  app.post("/api/benchmark-suites/:suiteId/preflight", async (request, response) => {
    const preflight = await buildSuiteRacePreflight(
      request.params.suiteId,
      String(request.body.humanUserId ?? ""),
      String(request.body.agentId ?? "")
    );
    if (!preflight) {
      response.status(404).json({ error: "suite_not_found" });
      return;
    }
    response.json({ preflight });
  });

  app.post("/api/benchmark-suites/:suiteId/races", async (request, response) => {
    const humanUserId = String(request.body.humanUserId ?? "");
    const agentId = String(request.body.agentId ?? "");
    const preflight = await buildSuiteRacePreflight(request.params.suiteId, humanUserId, agentId);
    if (!preflight) {
      response.status(404).json({ error: "suite_not_found" });
      return;
    }
    if (preflight.status === "blocked") {
      response.status(409).json({
        error: "suite_race_not_eligible",
        preflight
      });
      return;
    }
    if (preflight.status === "controlled" && !Boolean(request.body.reviewApproved)) {
      response.status(409).json({
        error: "suite_race_review_required",
        preflight,
        message: "Controlled suite races need reviewApproved=true before match creation."
      });
      return;
    }

    const scheduled = await createSuiteRaceFromPreflight({
      preflight,
      humanUserId,
      agentId
    });
    if (!scheduled) {
      response.status(409).json({
        error: "suite_race_match_creation_failed",
        preflight
      });
      return;
    }

    response.status(201).json(scheduled);
  });

  app.get("/api/games/:appid/benchmark-suites", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const initialSnapshot = await store.read();
    const discovery = initialSnapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
    const tasks = (await store.listTasks()).filter((task) => task.appid === appid);
    const taskRegistry = (await store.listTaskRegistry()).filter((task) => task.appid === appid);
    const game = gameCatalog.find((entry) => entry.appid === appid) ?? (
      discovery || tasks.length > 0 || taskRegistry.length > 0
        ? inferGameCatalogEntry({
            appid,
            name: discovery?.name ?? tasks[0]?.gameName ?? taskRegistry[0]?.gameName,
            benchmarkFit: discovery?.benchmarkFit,
            harnessRisk: discovery?.harnessRisk
          })
        : null
    );
    if (!game) {
      response.status(404).json({ error: "game_not_found" });
      return;
    }
    const taskReviews = buildTaskReviews([...tasks, ...taskRegistry.filter((entry) => !tasks.some((task) => task.id === entry.id))]);
    response.json({
      game,
      suites: buildBenchmarkSuites({ games: [game], tasks, reviews: taskReviews })
    });
  });

  app.post("/api/games/:appid/competition/run-local", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const initialSnapshot = await store.read();
    const discovery = initialSnapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
    const gameTasks = (await store.listTasks()).filter((task) => task.appid === appid);
    const gameTaskRegistry = (await store.listTaskRegistry()).filter((task) => task.appid === appid);
    const game = gameCatalog.find((entry) => entry.appid === appid) ?? (
      discovery || gameTasks.length > 0 || gameTaskRegistry.length > 0
        ? inferGameCatalogEntry({
            appid,
            name: discovery?.name ?? gameTasks[0]?.gameName ?? gameTaskRegistry[0]?.gameName,
            benchmarkFit: discovery?.benchmarkFit,
            harnessRisk: discovery?.harnessRisk
          })
        : null
    );
    if (!game) {
      response.status(404).json({ error: "game_not_found" });
      return;
    }
    const humanUserId = String(request.body.humanUserId ?? "");
    const agentId = String(request.body.agentId ?? "");
    if (!humanUserId) {
      response.status(400).json({ error: "human_user_required" });
      return;
    }
    if (!agentId) {
      response.status(400).json({ error: "agent_required" });
      return;
    }

    const requestedTier = String(request.body.suiteTier ?? "ranked");
    if (requestedTier !== "starter" && requestedTier !== "ranked" && requestedTier !== "expert" && requestedTier !== "marathon") {
      response.status(400).json({ error: "invalid_suite_tier" });
      return;
    }
    const suiteTier = requestedTier as BenchmarkSuiteTier;
    const requestedSuiteId = request.body.suiteId === undefined ? undefined : String(request.body.suiteId);
    const appSuites = (await buildCurrentBenchmarkSuites()).filter((suite) => suite.appid === appid);
    const selectedSuite = requestedSuiteId
      ? appSuites.find((suite) => suite.id === requestedSuiteId)
      : appSuites.find((suite) => suite.tier === suiteTier && suite.status === "ranked-ready")
        ?? appSuites.find((suite) => suite.tier === suiteTier)
        ?? appSuites.find((suite) => suite.status === "ranked-ready")
        ?? appSuites[0];
    if (!selectedSuite) {
      response.status(404).json({
        error: "suite_not_found",
        appid,
        availableSuites: appSuites
      });
      return;
    }

    const preflight = await buildSuiteRacePreflight(selectedSuite.id, humanUserId, agentId);
    if (!preflight) {
      response.status(404).json({ error: "suite_not_found" });
      return;
    }
    if (preflight.status === "blocked") {
      response.status(409).json({
        error: "suite_race_not_eligible",
        preflight
      });
      return;
    }
    if (preflight.status === "controlled" && !Boolean(request.body.reviewApproved)) {
      response.status(409).json({
        error: "suite_race_review_required",
        preflight,
        message: "Controlled app competitions need reviewApproved=true before local execution."
      });
      return;
    }

    const scheduled = await createSuiteRaceFromPreflight({
      preflight,
      humanUserId,
      agentId,
      summary: `${game.name} app competition scheduled ${preflight.suite.title}.`
    });
    if (!scheduled) {
      response.status(409).json({
        error: "suite_race_match_creation_failed",
        preflight
      });
      return;
    }

    const localRun = await runLocalSuiteRace(scheduled.race.id);
    if (!localRun || !localRun.evaluated || !localRun.audit || !localRun.bundle) {
      response.status(422).json({
        error: "app_competition_run_incomplete",
        scheduled,
        run: localRun
      });
      return;
    }

    const snapshot = await store.read();
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const standings = buildGameCompetitionStandings({
      game,
      tasks,
      taskRegistry,
      scoreboard: snapshot.scoreboard,
      scope: "all"
    });
    const certificate = buildSuiteRaceResultCertificate({
      bundle: localRun.bundle,
      baseUrl: requestBaseUrl(request)
    });

    response.status(localRun.complete ? 201 : 422).json({
      competitionRun: {
        schemaVersion: "steambench.game-competition-local-run.v1",
        appid,
        game,
        suiteId: selectedSuite.id,
        suiteTier: selectedSuite.tier,
        raceId: scheduled.race.id,
        matchCount: scheduled.matches.length,
        status: localRun.evaluated.race.status,
        complete: localRun.complete,
        links: {
          suiteRace: `/api/suite-races/${scheduled.race.id}`,
          audit: `/api/suite-races/${scheduled.race.id}/audit`,
          evidenceBundle: `/api/suite-races/${scheduled.race.id}/evidence-bundle`,
          resultCertificate: `/api/suite-races/${scheduled.race.id}/result-certificate`,
          gameStandings: `/api/games/${appid}/standings`,
          gameCertificate: `/api/games/${appid}/result-certificate`
        }
      },
      race: localRun.evaluated.race,
      matches: scheduled.matches,
      preflight,
      childResults: localRun.childResults,
      incompleteMatches: localRun.incompleteMatches,
      audit: localRun.audit,
      bundle: localRun.bundle,
      certificate,
      standings
    });
  });

  app.get("/api/games/:appid/profile", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const game = gameCatalog.find((entry) => entry.appid === appid);
    if (!game) {
      response.status(404).json({ error: "game_not_found" });
      return;
    }

    const snapshot = await store.read();
    const tasks = await store.listTasks();
    const taskRegistry = (await store.listTaskRegistry()).filter((task) => task.appid === appid);
    const taskReviews = buildTaskReviews([...tasks, ...taskRegistry.filter((entry) => !tasks.some((task) => task.id === entry.id))]);
    const suites = buildBenchmarkSuites({ games: [game], tasks, reviews: taskReviews });
    const broadcastCenter = buildBroadcastCenter({
      snapshot,
      tasks,
      limit: 100
    });

    response.json({
      profile: buildGameBenchmarkProfile({
        game,
        tasks,
        taskRegistry,
        reviews: taskReviews,
        suites,
        scoreboard: snapshot.scoreboard,
        broadcasts: broadcastCenter.recent
      })
    });
  });

  app.get("/api/games/:appid/standings", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const scope = parseSeasonScope(request.query.season);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const snapshot = await store.read();
    const game = gameCatalog.find((entry) => entry.appid === appid);
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
    if (!game && !discovery) {
      response.status(404).json({ error: "game_or_discovery_not_found" });
      return;
    }
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    response.json({
      standings: buildGameCompetitionStandings({
        game: game ?? inferGameCatalogEntry({
          appid,
          name: discovery?.name,
          benchmarkFit: discovery?.benchmarkFit,
          harnessRisk: discovery?.harnessRisk
        }),
        tasks,
        taskRegistry,
        scoreboard: snapshot.scoreboard,
        scope
      })
    });
  });

  app.get("/api/games/:appid/competition/ops-report", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const scope = parseSeasonScope(request.query.season);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const requestedTier = String(request.query.suiteTier ?? "ranked");
    if (requestedTier !== "starter" && requestedTier !== "ranked" && requestedTier !== "expert" && requestedTier !== "marathon") {
      response.status(400).json({ error: "invalid_suite_tier" });
      return;
    }
    const suiteTier = requestedTier as BenchmarkSuiteTier;
    const snapshot = await store.read();
    const game = gameCatalog.find((entry) => entry.appid === appid);
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
    if (!game && !discovery) {
      response.status(404).json({ error: "game_or_discovery_not_found" });
      return;
    }
    const resolvedGame = game ?? inferGameCatalogEntry({
      appid,
      name: discovery?.name,
      benchmarkFit: discovery?.benchmarkFit,
      harnessRisk: discovery?.harnessRisk
    });
    const limitInput = request.query.limit === undefined ? 12 : Number(request.query.limit);
    const limit = Number.isFinite(limitInput) ? Math.max(1, Math.min(50, Math.floor(limitInput))) : 12;
    const humanUserId = typeof request.query.humanUserId === "string" ? request.query.humanUserId : undefined;
    const agentId = typeof request.query.agentId === "string" ? request.query.agentId : undefined;
    const human = humanUserId ? snapshot.users.find((user) => user.id === humanUserId && user.type === "human") : undefined;
    const agent = agentId ? snapshot.agents.find((entry) => entry.id === agentId) : undefined;
    if (humanUserId && !human) {
      response.status(404).json({ error: "human_user_not_found" });
      return;
    }
    if (agentId && !agent) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const standings = buildGameCompetitionStandings({
      game: resolvedGame,
      tasks,
      taskRegistry,
      scoreboard: snapshot.scoreboard,
      scope
    });
    const coveragePlan = buildGameCoveragePlan({
      game: resolvedGame,
      snapshot,
      tasks,
      taskRegistry,
      human,
      agent,
      limit
    });
    const suites = (await buildCurrentBenchmarkSuites()).filter((suite) => suite.appid === appid);
    const coverageRuns = (await store.listGameCoverageRuns(appid)).slice(0, 8);

    response.json({
      report: buildGameCompetitionOpsReport({
        game: resolvedGame,
        standings,
        coveragePlan,
        suites,
        coverageRuns,
        suiteTier,
        selectedHumanId: human?.id,
        selectedAgentId: agent?.id
      })
    });
  });

  app.get("/api/games/:appid/coverage-plan", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const snapshot = await store.read();
    const game = gameCatalog.find((entry) => entry.appid === appid);
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
    if (!game && !discovery) {
      response.status(404).json({ error: "game_or_discovery_not_found" });
      return;
    }
    const limitInput = request.query.limit === undefined ? 12 : Number(request.query.limit);
    const limit = Number.isFinite(limitInput) ? Math.max(1, Math.min(50, Math.floor(limitInput))) : 12;
    const humanUserId = typeof request.query.humanUserId === "string" ? request.query.humanUserId : undefined;
    const agentId = typeof request.query.agentId === "string" ? request.query.agentId : undefined;
    const human = humanUserId ? snapshot.users.find((user) => user.id === humanUserId && user.type === "human") : undefined;
    const agent = agentId ? snapshot.agents.find((entry) => entry.id === agentId) : undefined;
    if (humanUserId && !human) {
      response.status(404).json({ error: "human_user_not_found" });
      return;
    }
    if (agentId && !agent) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }
    response.json({
      plan: buildGameCoveragePlan({
        game: game ?? inferGameCatalogEntry({
          appid,
          name: discovery?.name,
          benchmarkFit: discovery?.benchmarkFit,
          harnessRisk: discovery?.harnessRisk
        }),
        snapshot,
        tasks: await store.listTasks(),
        taskRegistry: await store.listTaskRegistry(),
        human,
        agent,
        limit
      })
    });
  });

  app.post("/api/games/:appid/coverage-plan/schedule", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const snapshot = await store.read();
    const game = gameCatalog.find((entry) => entry.appid === appid);
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
    if (!game && !discovery) {
      response.status(404).json({ error: "game_or_discovery_not_found" });
      return;
    }

    const side = String(request.body.side ?? "both");
    if (side !== "human" && side !== "agent" && side !== "both") {
      response.status(400).json({ error: "invalid_side" });
      return;
    }
    const wantsHuman = side === "human" || side === "both";
    const wantsAgent = side === "agent" || side === "both";
    const humanUserId = request.body.humanUserId === undefined ? undefined : String(request.body.humanUserId);
    const agentId = request.body.agentId === undefined ? undefined : String(request.body.agentId);
    if (wantsHuman && !humanUserId) {
      response.status(400).json({ error: "human_user_required" });
      return;
    }
    if (wantsAgent && !agentId) {
      response.status(400).json({ error: "agent_required" });
      return;
    }
    const human = humanUserId ? snapshot.users.find((user) => user.id === humanUserId && user.type === "human") : undefined;
    const agent = agentId ? snapshot.agents.find((entry) => entry.id === agentId) : undefined;
    if (humanUserId && !human) {
      response.status(404).json({ error: "human_user_not_found" });
      return;
    }
    if (agentId && !agent) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }

    const requestedLimit = Number(request.body.limit ?? 6);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(20, Math.floor(requestedLimit))) : 6;
    const provider: RuntimeDispatch["provider"] = request.body.provider === "modal" ? "modal" : "local";
    const dispatchAgentRuns = request.body.dispatch === undefined ? true : Boolean(request.body.dispatch);
    const resolvedGame = game ?? inferGameCatalogEntry({
      appid,
      name: discovery?.name,
      benchmarkFit: discovery?.benchmarkFit,
      harnessRisk: discovery?.harnessRisk
    });
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const plan = buildGameCoveragePlan({
      game: resolvedGame,
      snapshot,
      tasks,
      taskRegistry,
      human,
      agent,
      limit: 50
    });
    const scheduleItems = [];
    const skipped = [];
    let actionCount = 0;

    for (const item of plan.items) {
      if (actionCount >= limit) break;

      if (wantsHuman && human && item.gaps.includes("human")) {
        const competitor = `human:${human.handle}`;
        const activeRun = activeRunForCompetitor(snapshot, {
          taskId: item.task.id,
          competitor,
          competitorType: "human"
        });
        if (activeRun) {
          skipped.push({
            task: item.task,
            side: "human",
            reason: "An active human run is already queued for this task.",
            activeRun
          });
        } else if (item.selectedHuman?.status === "ready") {
          const run = await store.createRun({
            taskId: item.task.id,
            competitor,
            competitorType: "human",
            runtimeProvider: "manual"
          });
          if (run) {
            const event = await store.appendRunEvent({
              runId: run.id,
              type: "plan",
              message: `Game coverage scheduler opened a human proof run for ${human.displayName}.`,
              metadata: {
                appid,
                userId: human.id,
                steamid: human.linkedSteamId ?? "",
                scheduler: "game-coverage-plan"
              }
            });
            scheduleItems.push({
              task: item.task,
              side: "human",
              run,
              event,
              links: {
                submission: `/api/runs/${run.id}/submission`,
                proofPlan: `/api/users/${human.id}/steam-proof-plan`
              }
            });
            actionCount += 1;
          }
        } else {
          skipped.push({
            task: item.task,
            side: "human",
            reason: item.selectedHuman?.reason ?? "No ready selected human action for this task.",
            status: item.selectedHuman?.status ?? "select-human"
          });
        }
      }

      if (actionCount >= limit) break;

      if (wantsAgent && agent && item.gaps.includes("agent")) {
        const competitor = `agent:${agent.handle}`;
        const activeRun = activeRunForCompetitor(snapshot, {
          taskId: item.task.id,
          competitor,
          competitorType: "agent"
        });
        if (activeRun) {
          skipped.push({
            task: item.task,
            side: "agent",
            reason: "An active agent run is already queued for this task.",
            activeRun
          });
        } else if (item.selectedAgent?.status === "ready") {
          const run = await store.createRun({
            taskId: item.task.id,
            competitor,
            competitorType: "agent",
            runtimeProvider: agent.runtimeProvider
          });
          if (run) {
            const event = await store.appendRunEvent({
              runId: run.id,
              type: "plan",
              message: `Game coverage scheduler queued ${agent.displayName} for missing agent coverage.`,
              metadata: {
                appid,
                agentId: agent.id,
                provider: agent.provider,
                runtimeProvider: agent.runtimeProvider,
                scheduler: "game-coverage-plan"
              }
            });
            let dispatch: RuntimeDispatch | null = null;
            let dispatchPlan: ReturnType<typeof buildRuntimeDispatchPlan> | undefined;
            if (dispatchAgentRuns) {
              dispatchPlan = buildRuntimeDispatchPlan({
                run,
                agent,
                provider,
                apiBaseUrl: requestBaseUrl(request),
                workerId: `${provider}-coverage-${run.id}`
              });
              dispatch = await store.createRuntimeDispatch({
                runId: run.id,
                agentId: agent.id,
                provider,
                workerId: dispatchPlan.workerId,
                command: dispatchPlan.command,
                manifestUrl: dispatchPlan.manifestUrl,
                runtimePackageUrl: dispatchPlan.runtimePackageUrl,
                idempotencyKey: `coverage:${appid}:${agent.id}:${run.id}:${provider}`,
                summary: dispatchPlan.summary
              });
              if (dispatch) {
                await store.appendRunEvent({
                  runId: run.id,
                  type: "plan",
                  message: `Game coverage scheduler planned ${provider} dispatch.`,
                  idempotencyKey: `coverage-dispatch-event:${dispatch.id}`,
                  metadata: {
                    appid,
                    dispatchId: dispatch.id,
                    provider,
                    workerId: dispatch.workerId,
                    agentId: agent.id
                  }
                });
              }
            }
            scheduleItems.push({
              task: item.task,
              side: "agent",
              run,
              event,
              dispatch,
              dispatchPlan,
              links: {
                manifestUrl: `/api/runs/${run.id}/execution-manifest?agentId=${encodeURIComponent(agent.id)}`,
                runtimePackageUrl: `/api/runs/${run.id}/runtime-package?agentId=${encodeURIComponent(agent.id)}`,
                playbookUrl: `/api/runs/${run.id}/agent-playbook?agentId=${encodeURIComponent(agent.id)}`,
                traceUrl: `/api/runs/${run.id}/agent-trace`,
                submission: `/api/runs/${run.id}/submission`
              }
            });
            actionCount += 1;
          }
        } else {
          skipped.push({
            task: item.task,
            side: "agent",
            reason: item.selectedAgent?.reason ?? "No ready selected agent action for this task.",
            status: item.selectedAgent?.status ?? "select-agent",
            readiness: item.selectedAgent?.readiness
          });
        }
      }
    }

    const refreshedSnapshot = await store.read();
    const refreshedPlan = buildGameCoveragePlan({
      game: resolvedGame,
      snapshot: refreshedSnapshot,
      tasks,
      taskRegistry,
      human,
      agent,
      limit: 50
    });
    const schedule = {
      schemaVersion: "steambench.game-coverage-schedule.v1",
      appid,
      game: resolvedGame,
      requestedSide: side,
      limit,
      provider,
      dispatch: dispatchAgentRuns,
      selectedHuman: human
        ? {
            id: human.id,
            handle: human.handle,
            displayName: human.displayName,
            linkedSteamId: human.linkedSteamId,
            proofConsentAt: human.proofConsentAt
          }
        : undefined,
      selectedAgent: agent
        ? {
            id: agent.id,
            handle: agent.handle,
            displayName: agent.displayName,
            status: agent.status,
            runtimeProvider: agent.runtimeProvider
          }
        : undefined,
      totals: {
        queuedRuns: scheduleItems.length,
        humanRuns: scheduleItems.filter((entry) => entry.side === "human").length,
        agentRuns: scheduleItems.filter((entry) => entry.side === "agent").length,
        dispatches: scheduleItems.filter((entry) => entry.dispatch).length,
        skipped: skipped.length,
        remainingHumanGaps: refreshedPlan.totals.humanGaps,
        remainingAgentGaps: refreshedPlan.totals.agentGaps
      },
      items: scheduleItems,
      skipped,
      links: {
        coveragePlan: `/api/games/${appid}/coverage-plan`,
        standings: `/api/games/${appid}/standings`,
        dispatches: "/api/dispatches",
        workerQueue: "/api/worker/queue"
      }
    };

    response.status(scheduleItems.length > 0 ? 201 : 422).json({
      schedule,
      plan: refreshedPlan
    });
  });

  app.post("/api/games/:appid/coverage-plan/run-local", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const snapshot = await store.read();
    const game = gameCatalog.find((entry) => entry.appid === appid);
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
    if (!game && !discovery) {
      response.status(404).json({ error: "game_or_discovery_not_found" });
      return;
    }

    const side = String(request.body.side ?? "both");
    if (side !== "human" && side !== "agent" && side !== "both") {
      response.status(400).json({ error: "invalid_side" });
      return;
    }
    const wantsHuman = side === "human" || side === "both";
    const wantsAgent = side === "agent" || side === "both";
    const humanUserId = request.body.humanUserId === undefined ? undefined : String(request.body.humanUserId);
    const agentId = request.body.agentId === undefined ? undefined : String(request.body.agentId);
    if (wantsHuman && !humanUserId) {
      response.status(400).json({ error: "human_user_required" });
      return;
    }
    if (wantsAgent && !agentId) {
      response.status(400).json({ error: "agent_required" });
      return;
    }
    const human = humanUserId ? snapshot.users.find((user) => user.id === humanUserId && user.type === "human") : undefined;
    const agent = agentId ? snapshot.agents.find((entry) => entry.id === agentId) : undefined;
    if (humanUserId && !human) {
      response.status(404).json({ error: "human_user_not_found" });
      return;
    }
    if (agentId && !agent) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }

    const requestedLimit = Number(request.body.limit ?? 4);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(12, Math.floor(requestedLimit))) : 4;
    const run = await runLocalGameCoverage({
      appid,
      side,
      human,
      agent,
      limit,
      apiBaseUrl: requestBaseUrl(request)
    });
    if (!run) {
      response.status(404).json({ error: "game_or_discovery_not_found" });
      return;
    }

    response.status(run.result.totals.completedRuns > 0 ? 201 : 422).json(run);
  });

  app.get("/api/games/:appid/coverage-runs", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const snapshot = await store.read();
    const game = gameCatalog.find((entry) => entry.appid === appid);
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
    if (!game && !discovery) {
      response.status(404).json({ error: "game_or_discovery_not_found" });
      return;
    }
    const requestedLimit = Number(request.query.limit ?? 12);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50, Math.floor(requestedLimit))) : 12;
    const records = (await store.listGameCoverageRuns(appid)).slice(0, limit);
    response.json({
      schemaVersion: "steambench.game-coverage-runs.v1",
      game: game ?? inferGameCatalogEntry({
        appid,
        name: discovery?.name,
        benchmarkFit: discovery?.benchmarkFit,
        harnessRisk: discovery?.harnessRisk
      }),
      totals: {
        records: records.length,
        scoreboardReady: records.filter((record) => record.status === "scoreboard-ready").length,
        completedRuns: records.reduce((total, record) => total + record.completedRuns, 0)
      },
      coverageRuns: await Promise.all(records.map((record) => resolveGameCoverageRunRecord(record, snapshot))),
      links: {
        coveragePlan: `/api/games/${appid}/coverage-plan`,
        standings: `/api/games/${appid}/standings`
      }
    });
  });

  app.get("/api/game-coverage-runs/:recordId", async (request, response) => {
    const record = await store.getGameCoverageRun(request.params.recordId);
    if (!record) {
      response.status(404).json({ error: "game_coverage_run_not_found" });
      return;
    }
    const snapshot = await store.read();
    response.json({
      schemaVersion: "steambench.game-coverage-run-detail.v1",
      coverageRun: await resolveGameCoverageRunRecord(record, snapshot)
    });
  });

  app.get("/api/game-coverage-runs/:recordId/evidence-bundle", async (request, response) => {
    const bundle = await buildGameCoverageRunBundle(request.params.recordId, requestBaseUrl(request));
    if (!bundle) {
      response.status(404).json({ error: "game_coverage_run_not_found" });
      return;
    }
    response.json({ bundle });
  });

  app.get("/api/game-coverage-runs/:recordId/result-certificate", async (request, response) => {
    const bundle = await buildGameCoverageRunBundle(request.params.recordId, requestBaseUrl(request));
    if (!bundle) {
      response.status(404).json({ error: "game_coverage_run_not_found" });
      return;
    }
    response.json({
      certificate: buildGameCoverageRunResultCertificate({
        bundle,
        baseUrl: requestBaseUrl(request)
      })
    });
  });

  app.get("/api/games/:appid/evidence-bundle", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const scope = parseSeasonScope(request.query.season);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const bundle = await buildGameCompetitionBundle(appid, scope);
    if (!bundle) {
      response.status(404).json({ error: "game_or_discovery_not_found" });
      return;
    }
    response.json({ bundle });
  });

  app.get("/api/games/:appid/result-certificate", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const scope = parseSeasonScope(request.query.season);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const bundle = await buildGameCompetitionBundle(appid, scope);
    if (!bundle) {
      response.status(404).json({ error: "game_or_discovery_not_found" });
      return;
    }
    response.json({
      certificate: buildGameCompetitionResultCertificate({
        bundle,
        baseUrl: requestBaseUrl(request)
      })
    });
  });

  app.get("/api/games/:appid/benchmark-blueprint", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const snapshot = await store.read();
    const game = gameCatalog.find((entry) => entry.appid === appid);
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
    if (!game && !discovery) {
      response.status(404).json({ error: "game_or_discovery_not_found" });
      return;
    }
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const includeSourcePlan = request.query.includeSourcePlan === "true" || request.query.useFixture === "true";
    const taskSourceOps = includeSourcePlan
      ? (await buildSteamTaskSourceOpsPayload({
          appid,
          useFixture: request.query.useFixture === "true",
          refresh: request.query.refresh === "true",
          limit: request.query.limit === undefined ? 12 : Number(request.query.limit),
          gameName: request.query.gameName === undefined ? undefined : String(request.query.gameName),
          benchmarkFit: request.query.benchmarkFit === undefined ? undefined : Number(request.query.benchmarkFit),
          harnessRisk:
            request.query.harnessRisk === "low" || request.query.harnessRisk === "medium" || request.query.harnessRisk === "high"
              ? request.query.harnessRisk
              : undefined
        })).ops
      : undefined;
    response.json({
      blueprint: buildBenchmarkBlueprint({
        game: game ?? inferGameCatalogEntry({
          appid,
          name: discovery?.name,
          benchmarkFit: discovery?.benchmarkFit,
          harnessRisk: discovery?.harnessRisk
        }),
        tasks,
        taskRegistry,
        discovery,
        taskSourceOps
      })
    });
  });

  app.get("/api/seasons", async (_request, response) => {
    const snapshot = await store.read();
    response.json({ seasons: buildSeasonSnapshots(snapshot.scoreboard) });
  });

  app.get("/api/standings", async (request, response) => {
    const scope = parseSeasonScope(request.query.season);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const snapshot = await store.read();
    const season = buildSeasonSnapshot(snapshot.scoreboard, scope);
    response.json({ standings: season.standings, season: season.window });
  });

  app.get("/api/scoreboard/ops-report", async (request, response) => {
    const validStatuses = new Set<ScoreboardOpsTicketStatus>([
      "scoreboard-ready",
      "proof-missing",
      "scoreboard-missing",
      "row-inconsistent",
      "orphan-row",
      "in-progress",
      "failed"
    ]);
    const status = request.query.status === undefined ? undefined : String(request.query.status);
    if (status !== undefined && !validStatuses.has(status as ScoreboardOpsTicketStatus)) {
      response.status(400).json({ error: "invalid_scoreboard_ops_status" });
      return;
    }
    const appid = request.query.appid === undefined ? undefined : Number(request.query.appid);
    if (appid !== undefined && (!Number.isInteger(appid) || appid <= 0)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
    if (!Number.isFinite(limit) || limit < 1) {
      response.status(400).json({ error: "invalid_limit" });
      return;
    }
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    response.json({
      report: buildScoreboardOpsReport({
        snapshot,
        tasks,
        status: status as ScoreboardOpsTicketStatus | undefined,
        appid,
        limit
      })
    });
  });

  app.get("/api/leaderboards", async (request, response) => {
    const scope = parseSeasonScope(request.query.season);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const snapshot = await store.read();
    const season = buildSeasonSnapshot(snapshot.scoreboard, scope);
    response.json({ leaderboards: season.leaderboards, season: season.window });
  });

  app.get("/api/tasks/:taskId/leaderboard", async (request, response) => {
    const scope = parseSeasonScope(request.query.season);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const snapshot = await store.read();
    const task = await store.findTask(request.params.taskId);
    if (!task) {
      response.status(404).json({ error: "task_not_found" });
      return;
    }
    const season = buildSeasonSnapshot(snapshot.scoreboard, scope);
    const leaderboards = season.leaderboards;
    const leaderboard = leaderboards.find((entry) => entry.taskId === task.id)
      ?? leaderboards.find((entry) => entry.taskKey === task.id)
      ?? leaderboards.find((entry) => entry.game === task.gameName && entry.task === task.title)
      ?? {
      taskKey: task.id,
      taskId: task.id,
      appid: task.appid,
      game: task.gameName,
      task: task.title,
      track: task.track,
      metricName: task.metricName,
      leader: undefined,
      humanLeader: undefined,
      agentLeader: undefined,
      entries: []
    };
    response.json({ task, leaderboard, season: season.window });
  });

  app.get("/api/competitors/:participantType/:participantId/profile", async (request, response) => {
    const participantType = request.params.participantType;
    if (participantType !== "human" && participantType !== "agent") {
      response.status(400).json({ error: "invalid_participant_type" });
      return;
    }
    const snapshot = await store.read();
    const profile = buildProfileFromSnapshot(snapshot, await store.listTasks(), participantType, request.params.participantId);
    if (!profile) {
      response.status(404).json({ error: "competitor_not_found" });
      return;
    }
    response.json({ profile });
  });

  app.get("/api/matches/feed", async (request, response) => {
    const scope = parseSeasonScope(request.query.season);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    response.json({
      matchFeed: buildMatchFeed({
        matches: snapshot.matches,
        runs: snapshot.runs,
        users: snapshot.users,
        agents: snapshot.agents,
        tasks,
        scoreboard: snapshot.scoreboard,
        seasonScope: scope
      })
    });
  });

  app.get("/api/broadcasts", async (_request, response) => {
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    const center = buildBroadcastCenter({
      snapshot,
      tasks,
      limit: 24
    });
    response.json({
      center,
      broadcasts: center.recent
    });
  });

  app.get("/api/broadcasts/center", async (_request, response) => {
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    response.json({
      center: buildBroadcastCenter({
        snapshot,
        tasks,
        limit: 24
      })
    });
  });

  app.get("/api/broadcasts/ops-report", async (request, response) => {
    const status = request.query.status === undefined ? undefined : String(request.query.status);
    const validStatuses = new Set(["live", "scheduled", "scoreboard-ready", "proof-ready", "proof-missing", "incomplete", "failed"]);
    if (status !== undefined && !validStatuses.has(status)) {
      response.status(400).json({ error: "invalid_broadcast_ops_status" });
      return;
    }
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    const center = buildBroadcastCenter({
      snapshot,
      tasks,
      limit: 200
    });
    response.json({
      report: buildBroadcastOpsReport({
        rows: center.recent,
        status: status as Parameters<typeof buildBroadcastOpsReport>[0]["status"],
        limit: request.query.limit === undefined ? 50 : Number(request.query.limit)
      }),
      center
    });
  });

  app.get("/api/broadcasts/:streamId/evidence-bundle", async (request, response) => {
    const bundle = await buildBroadcastBundle(request.params.streamId);
    if (!bundle) {
      response.status(404).json({ error: "broadcast_not_found" });
      return;
    }
    response.json({ bundle });
  });

  app.get("/api/broadcasts/:streamId/result-certificate", async (request, response) => {
    const bundle = await buildBroadcastBundle(request.params.streamId);
    if (!bundle) {
      response.status(404).json({ error: "broadcast_not_found" });
      return;
    }
    response.json({
      certificate: buildBroadcastResultCertificate({
        bundle,
        baseUrl: requestBaseUrl(request)
      })
    });
  });

  app.get("/api/broadcasts/:streamId", async (request, response) => {
    const bundle = await buildBroadcastBundle(request.params.streamId);
    if (!bundle) {
      response.status(404).json({ error: "broadcast_not_found" });
      return;
    }

    response.json({
      broadcast: bundle.broadcast
    });
  });

  app.get("/api/tasks", (_request, response) => {
    void store.listTasks().then((tasks) => response.json({ tasks }));
  });

  app.get("/api/tasks/review-catalog", async (request, response) => {
    const { filter, error } = parseTaskReviewCatalogFilter(request.query);
    if (error) {
      response.status(400).json({ error });
      return;
    }
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    response.json({
      catalog: buildTaskReviewCatalog({
        tasks,
        taskRegistry,
        filter
      })
    });
  });

  app.get("/api/tasks/:taskId/review", async (request, response) => {
    const task = await store.findTask(request.params.taskId);
    const registryTask = task ?? (await store.listTaskRegistry()).find((entry) => entry.id === request.params.taskId);
    if (!registryTask) {
      response.status(404).json({ error: "task_not_found" });
      return;
    }
    response.json({
      task: registryTask,
      review: buildTaskReview(registryTask)
    });
  });

  app.get("/api/tasks/:taskId/eligibility", async (request, response) => {
    const eligibility = await buildTaskRaceEligibility(
      request.params.taskId,
      request.query.humanUserId === undefined ? undefined : String(request.query.humanUserId),
      request.query.agentId === undefined ? undefined : String(request.query.agentId)
    );
    if (!eligibility) {
      response.status(404).json({ error: "task_not_found" });
      return;
    }
    response.json({ eligibility });
  });

  app.get("/api/challenges", async (_request, response) => {
    const snapshot = await store.read();
    response.json({
      challenges: await Promise.all(snapshot.challenges.map((challenge) => resolveChallenge(challenge, snapshot)))
    });
  });

  app.get("/api/challenges/ops-report", async (request, response) => {
    const validStatuses = new Set<ChallengeOpsTicketStatus>([
      "open",
      "accepted",
      "running",
      "scoreboard-ready",
      "evidence-missing",
      "blocked",
      "declined",
      "canceled",
      "failed"
    ]);
    const status = request.query.status === undefined ? undefined : String(request.query.status);
    if (status !== undefined && !validStatuses.has(status as ChallengeOpsTicketStatus)) {
      response.status(400).json({ error: "invalid_challenge_ops_status" });
      return;
    }
    const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
    if (!Number.isFinite(limit) || limit < 1) {
      response.status(400).json({ error: "invalid_limit" });
      return;
    }
    const snapshot = await store.read();
    response.json({
      report: buildChallengeOpsReport({
        snapshot,
        tasks: await store.listTasks(),
        status: status as ChallengeOpsTicketStatus | undefined,
        limit
      })
    });
  });

  app.post("/api/challenges", async (request, response) => {
    const taskId = String(request.body.taskId ?? "");
    const humanUserId = String(request.body.humanUserId ?? "");
    const agentId = String(request.body.agentId ?? "");
    const createdBy = request.body.createdBy === "agent" || request.body.createdBy === "system" ? request.body.createdBy : "human";
    const createdById = String(request.body.createdById ?? (createdBy === "agent" ? agentId : humanUserId));
    const eligibility = await buildTaskRaceEligibility(taskId, humanUserId, agentId);
    if (!eligibility) {
      response.status(400).json({ error: "invalid_challenge_contract" });
      return;
    }
    if (eligibility.status === "blocked") {
      response.status(409).json({
        error: "challenge_not_eligible",
        eligibility
      });
      return;
    }
    if (eligibility.status === "controlled" && !Boolean(request.body.reviewApproved)) {
      response.status(409).json({
        error: "challenge_review_required",
        eligibility,
        message: "Controlled or review-required challenges need reviewApproved=true before entering the queue."
      });
      return;
    }

    const challenge = await store.createChallenge({
      taskId,
      humanUserId,
      agentId,
      createdBy,
      createdById,
      summary: request.body.summary === undefined ? undefined : String(request.body.summary)
    });
    if (!challenge) {
      response.status(400).json({ error: "invalid_challenge_contract" });
      return;
    }
    const snapshot = await store.read();
    response.status(201).json({
      ...(await resolveChallenge(challenge, snapshot)),
      eligibility
    });
  });

  app.get("/api/challenges/:challengeId", async (request, response) => {
    const snapshot = await store.read();
    const challenge = snapshot.challenges.find((entry) => entry.id === request.params.challengeId);
    if (!challenge) {
      response.status(404).json({ error: "challenge_not_found" });
      return;
    }
    response.json(await resolveChallenge(challenge, snapshot));
  });

  app.get("/api/challenges/:challengeId/result-certificate", async (request, response) => {
    const snapshot = await store.read();
    const challenge = snapshot.challenges.find((entry) => entry.id === request.params.challengeId);
    const task = challenge ? await store.findTask(challenge.taskId) : null;
    const match = challenge?.matchId ? snapshot.matches.find((entry) => entry.id === challenge.matchId) : undefined;
    if (!challenge || !task) {
      response.status(404).json({ error: "challenge_not_found" });
      return;
    }
    const humanAudit = match?.humanRunId ? await buildRunAudit(match.humanRunId) : undefined;
    const agentAudit = match?.agentRunId ? await buildRunAudit(match.agentRunId) : undefined;
    response.json({
      certificate: buildChallengeResultCertificate({
        challenge,
        task,
        human: snapshot.users.find((user) => user.id === challenge.humanUserId),
        agent: snapshot.agents.find((agent) => agent.id === challenge.agentId),
        match,
        humanAudit: humanAudit ?? undefined,
        agentAudit: agentAudit ?? undefined,
        baseUrl: requestBaseUrl(request)
      })
    });
  });

  app.get("/api/challenges/:challengeId/evidence-bundle", async (request, response) => {
    const bundle = await buildChallengeBundle(request.params.challengeId, requestBaseUrl(request));
    if (!bundle) {
      response.status(404).json({ error: "challenge_not_found" });
      return;
    }
    response.json({ bundle });
  });

  app.post("/api/challenges/:challengeId/accept", async (request, response) => {
    const accepted = await store.acceptChallenge(request.params.challengeId);
    if (!accepted) {
      response.status(409).json({ error: "challenge_not_acceptable" });
      return;
    }
    const snapshot = await store.read();
    response.json({
      ...(await resolveChallenge(accepted.challenge, snapshot)),
      match: accepted.match
    });
  });

  app.post("/api/challenges/:challengeId/run-local", async (request, response) => {
    const accepted = await store.acceptChallenge(request.params.challengeId);
    if (!accepted) {
      response.status(409).json({ error: "challenge_not_runnable" });
      return;
    }
    const localRun = await runLocalMatch(accepted.match.id);
    await store.syncChallengeFromMatch(request.params.challengeId);
    const snapshot = await store.read();
    const challenge = snapshot.challenges.find((entry) => entry.id === request.params.challengeId);
    if (!challenge || !localRun) {
      response.status(422).json({ error: "challenge_run_incomplete" });
      return;
    }
    response.status(localRun.evaluated?.match.status === "scored" ? 200 : 422).json({
      ...(await resolveChallenge(challenge, snapshot)),
      run: localRun
    });
  });

  app.post("/api/challenges/:challengeId/status", async (request, response) => {
    const status = String(request.body.status ?? "");
    if (status !== "declined" && status !== "canceled" && status !== "blocked") {
      response.status(400).json({ error: "invalid_challenge_status" });
      return;
    }
    const challenge = await store.updateChallengeStatus(
      request.params.challengeId,
      status,
      request.body.summary === undefined ? undefined : String(request.body.summary)
    );
    if (!challenge) {
      response.status(404).json({ error: "challenge_not_found_or_terminal" });
      return;
    }
    const snapshot = await store.read();
    response.json(await resolveChallenge(challenge, snapshot));
  });

  app.get("/api/matches", async (_request, response) => {
    const snapshot = await store.read();
    response.json({
      matches: await Promise.all(
        snapshot.matches.map(async (match) => ({
          match,
          task: await store.findTask(match.taskId),
          human: snapshot.users.find((entry) => entry.id === match.humanUserId),
          agent: snapshot.agents.find((entry) => entry.id === match.agentId),
          humanRun: match.humanRunId ? snapshot.runs.find((entry) => entry.id === match.humanRunId) : undefined,
          agentRun: match.agentRunId ? snapshot.runs.find((entry) => entry.id === match.agentRunId) : undefined
        }))
      )
    });
  });

  app.get("/api/matches/arena-ops-report", async (request, response) => {
    const filter = parseMatchArenaOpsFilter(request.query);
    if (filter.error) {
      response.status(400).json({ error: filter.error });
      return;
    }
    const snapshot = await store.read();
    response.json({
      report: buildMatchArenaOpsReport({
        matches: snapshot.matches,
        tasks: await store.listTasks(),
        users: snapshot.users,
        agents: snapshot.agents,
        runs: snapshot.runs,
        scoreboard: snapshot.scoreboard,
        status: filter.status,
        limit: filter.limit
      })
    });
  });

  app.get("/api/matches/:matchId", async (request, response) => {
    const snapshot = await store.read();
    const match = await store.getMatch(request.params.matchId);
    const task = match ? await store.findTask(match.taskId) : null;
    if (!match || !task) {
      response.status(404).json({ error: "match_not_found" });
      return;
    }
    response.json({
      match,
      task,
      human: snapshot.users.find((entry) => entry.id === match.humanUserId),
      agent: snapshot.agents.find((entry) => entry.id === match.agentId),
      humanRun: match.humanRunId ? await store.getRun(match.humanRunId) : undefined,
      agentRun: match.agentRunId ? await store.getRun(match.agentRunId) : undefined,
      arenaPacket: await resolveMatchArenaPacket(match.id)
    });
  });

  app.get("/api/matches/:matchId/arena-packet", async (request, response) => {
    const arenaPacket = await resolveMatchArenaPacket(request.params.matchId);
    if (!arenaPacket) {
      response.status(404).json({ error: "match_not_found" });
      return;
    }
    response.json({ arenaPacket });
  });

  app.get("/api/matches/:matchId/result-certificate", async (request, response) => {
    const snapshot = await store.read();
    const match = await store.getMatch(request.params.matchId);
    const task = match ? await store.findTask(match.taskId) : null;
    if (!match || !task) {
      response.status(404).json({ error: "match_not_found" });
      return;
    }
    const humanAudit = match.humanRunId ? await buildRunAudit(match.humanRunId) : undefined;
    const agentAudit = match.agentRunId ? await buildRunAudit(match.agentRunId) : undefined;
    response.json({
      certificate: buildMatchResultCertificate({
        match,
        task,
        human: snapshot.users.find((entry) => entry.id === match.humanUserId),
        agent: snapshot.agents.find((entry) => entry.id === match.agentId),
        humanAudit: humanAudit ?? undefined,
        agentAudit: agentAudit ?? undefined,
        baseUrl: requestBaseUrl(request)
      })
    });
  });

  app.post("/api/matches", async (request, response) => {
    const taskId = String(request.body.taskId ?? "");
    const humanUserId = String(request.body.humanUserId ?? "");
    const agentId = String(request.body.agentId ?? "");
    const eligibility = await buildTaskRaceEligibility(taskId, humanUserId, agentId);
    if (!eligibility) {
      response.status(400).json({ error: "invalid_match_contract" });
      return;
    }
    if (eligibility.status === "blocked") {
      response.status(409).json({
        error: "match_not_eligible",
        eligibility
      });
      return;
    }
    if (eligibility.status === "controlled" && !Boolean(request.body.reviewApproved)) {
      response.status(409).json({
        error: "match_review_required",
        eligibility,
        message: "Controlled or review-required tasks need reviewApproved=true before match creation."
      });
      return;
    }
    const match = await store.createMatch({
      taskId,
      humanUserId,
      agentId
    });
    if (!match) {
      response.status(400).json({ error: "invalid_match_contract" });
      return;
    }
    response.status(201).json({ match, eligibility, arenaPacket: await resolveMatchArenaPacket(match.id) });
  });

  app.post("/api/matches/preflight", async (request, response) => {
    const eligibility = await buildTaskRaceEligibility(
      String(request.body.taskId ?? ""),
      String(request.body.humanUserId ?? ""),
      String(request.body.agentId ?? "")
    );
    if (!eligibility) {
      response.status(404).json({ error: "task_not_found" });
      return;
    }
    response.json({ eligibility });
  });

  app.post("/api/matches/:matchId/start", async (request, response) => {
    const started = await store.startMatch(request.params.matchId);
    if (!started) {
      response.status(404).json({ error: "match_not_found_or_unstartable" });
      return;
    }

    await store.appendRunEvent({
      runId: started.humanRun.id,
      type: "plan",
      message: `Human side started for match ${started.match.id}.`,
      metadata: {
        matchId: started.match.id,
        side: "human"
      }
    });
    await store.appendRunEvent({
      runId: started.agentRun.id,
      type: "plan",
      message: `Agent side started for match ${started.match.id}.`,
      metadata: {
        matchId: started.match.id,
        side: "agent"
      }
    });

    response.json({
      ...started,
      arenaPacket: await resolveMatchArenaPacket(started.match.id)
    });
  });

  app.post("/api/matches/:matchId/evaluate", async (request, response) => {
    const evaluated = await store.evaluateMatch(request.params.matchId);
    if (!evaluated) {
      response.status(404).json({ error: "match_not_found" });
      return;
    }
    response.status(evaluated.match.status === "scored" ? 200 : 422).json(evaluated);
  });

  app.post("/api/matches/:matchId/run-local", async (request, response) => {
    const localRun = await runLocalMatch(request.params.matchId);
    if (!localRun) {
      response.status(404).json({ error: "match_not_found_or_unstartable" });
      return;
    }

    if (!localRun.evaluated || !localRun.human || !localRun.agent) {
      response.status(422).json({
        error: "match_run_incomplete",
        match: localRun.started.match,
        human: localRun.human,
        agent: localRun.agent
      });
      return;
    }

    response.status(localRun.evaluated.match.status === "scored" ? 200 : 422).json({
      ...localRun.evaluated,
      human: localRun.human,
      agent: localRun.agent,
      arenaPacket: await resolveMatchArenaPacket(localRun.evaluated.match.id)
    });
  });

  app.post("/api/users", async (request, response) => {
    const handle = String(request.body.handle ?? "");
    if (handle.trim().length < 2) {
      response.status(400).json({ error: "invalid_handle" });
      return;
    }

    const user = await store.createUser({
      handle,
      displayName: String(request.body.displayName ?? handle),
      type: request.body.type === "agent" ? "agent" : "human"
    });
    response.status(201).json({ user });
  });

  app.get("/api/agents", async (_request, response) => {
    response.json({ agents: await store.listAgentProfiles() });
  });

  app.get("/api/agents/ops-report", async (request, response) => {
    const provider = request.query.provider === undefined ? undefined : String(request.query.provider);
    if (provider !== undefined && provider !== "local" && provider !== "modal") {
      response.status(400).json({ error: "invalid_provider" });
      return;
    }
    const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
    const snapshot = await store.read();
    response.json({
      report: buildAgentOpsReport({
        agents: snapshot.agents,
        snapshot,
        tasks: await store.listTasks(),
        provider,
        limit
      })
    });
  });

  app.post("/api/agents", async (request, response) => {
    const handle = String(request.body.handle ?? "");
    if (handle.trim().length < 2) {
      response.status(400).json({ error: "invalid_handle" });
      return;
    }

    const provider: AgentProfile["provider"] =
      request.body.provider === "modal" || request.body.provider === "external" ? request.body.provider : "local";
    const runtimeProvider =
      request.body.runtimeProvider === "modal" || request.body.runtimeProvider === "manual" || request.body.runtimeProvider === "local-sim"
        ? request.body.runtimeProvider
        : provider === "modal"
          ? "modal"
          : "local-sim";
    const capabilities = Array.isArray(request.body.capabilities)
      ? request.body.capabilities.map((entry: unknown) => String(entry)).filter((entry: string) => entry.trim().length > 0)
      : undefined;

    const agent = await store.createAgentProfile({
      handle,
      displayName: request.body.displayName === undefined ? undefined : String(request.body.displayName),
      provider,
      runtimeProvider,
      command: request.body.command === undefined ? undefined : String(request.body.command),
      capabilities
    });
    response.status(201).json({ agent });
  });

  app.post("/api/agents/:agentId/status", async (request, response) => {
    const status = String(request.body.status ?? "");
    if (status !== "active" && status !== "paused") {
      response.status(400).json({ error: "invalid_agent_status" });
      return;
    }
    const agent = await store.updateAgentProfileStatus(request.params.agentId, status);
    if (!agent) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }
    response.json({ agent });
  });

  app.get("/api/agents/:agentId/lab", async (request, response) => {
    const snapshot = await store.read();
    const agent = snapshot.agents.find((entry) => entry.id === request.params.agentId || entry.handle === request.params.agentId);
    if (!agent) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }
    response.json({
      lab: buildAgentRuntimeLab({
        agent,
        snapshot,
        tasks: await store.listTasks(),
        limit: 10
      })
    });
  });

  app.get("/api/agents/:agentId/campaign-plan", async (request, response) => {
    const agent = await store.findAgentProfile(request.params.agentId);
    if (!agent) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }
    const requestedLimit = Number(request.query.limit ?? 3);
    const limit = Number.isFinite(requestedLimit) ? Math.min(10, Math.max(1, Math.floor(requestedLimit))) : 3;
    const provider: RuntimeDispatch["provider"] = request.query.provider === "modal" ? "modal" : "local";
    const reviewApproved = request.query.reviewApproved === "true" || request.query.reviewApproved === "1";
    const snapshot = await store.read();
    const plan = buildAgentBenchmarkCampaignPlan({
      agent,
      snapshot,
      tasks: await store.listTasks(),
      provider,
      requestedTaskCount: limit,
      reviewApproved,
      dispatch: true
    });
    response.json({ plan });
  });

  app.get("/api/campaign-standings", async (_request, response) => {
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    const reports = snapshot.agentCampaigns.map((campaign) =>
      buildAgentBenchmarkCampaignReport({
        campaign,
        snapshot,
        tasks
      })
    );
    response.json({
      standings: buildAgentCampaignStandings(reports)
    });
  });

  app.get("/api/comparisons/human-agent/standings", async (request, response) => {
    const validStatuses = new Set(["complete", "human-incomplete", "agent-incomplete", "incomplete"]);
    const status = request.query.status === undefined ? undefined : String(request.query.status);
    if (status !== undefined && !validStatuses.has(status)) {
      response.status(400).json({ error: "invalid_human_agent_comparison_status" });
      return;
    }
    const requestedLimit = Number(request.query.limit ?? 50);
    const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.floor(requestedLimit))) : 50;
    const snapshot = await store.read();
    response.json({
      standings: buildHumanAgentComparisonStandings({
        snapshot,
        tasks: await store.listTasks(),
        status: status as ReturnType<typeof buildHumanAgentComparisonStandings>["filters"]["status"],
        humanUserId: request.query.humanUserId === undefined ? undefined : String(request.query.humanUserId),
        agentId: request.query.agentId === undefined ? undefined : String(request.query.agentId),
        campaignId: request.query.campaignId === undefined ? undefined : String(request.query.campaignId),
        limit
      })
    });
  });

  app.get("/api/comparisons/human-agent/ops-report", async (request, response) => {
    const validStatuses = new Set(["complete", "human-incomplete", "agent-incomplete", "incomplete"]);
    const status = request.query.status === undefined ? undefined : String(request.query.status);
    if (status !== undefined && !validStatuses.has(status)) {
      response.status(400).json({ error: "invalid_human_agent_comparison_status" });
      return;
    }
    const requestedLimit = Number(request.query.limit ?? 50);
    const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.floor(requestedLimit))) : 50;
    const snapshot = await store.read();
    response.json({
      report: buildHumanAgentComparisonOpsReport({
        snapshot,
        tasks: await store.listTasks(),
        status: status as ReturnType<typeof buildHumanAgentComparisonStandings>["filters"]["status"],
        humanUserId: request.query.humanUserId === undefined ? undefined : String(request.query.humanUserId),
        agentId: request.query.agentId === undefined ? undefined : String(request.query.agentId),
        campaignId: request.query.campaignId === undefined ? undefined : String(request.query.campaignId),
        limit
      })
    });
  });

  app.get("/api/comparisons/human-agent", async (request, response) => {
    const comparison = await buildDefaultHumanAgentComparison({
      humanUserId: request.query.humanUserId === undefined ? undefined : String(request.query.humanUserId),
      campaignId: request.query.campaignId === undefined ? undefined : String(request.query.campaignId)
    });
    if (!comparison) {
      response.status(404).json({ error: "comparison_not_available" });
      return;
    }
    response.json({ comparison });
  });

  app.get("/api/comparisons/human-agent/evidence-bundle", async (request, response) => {
    const bundle = await buildHumanAgentComparisonBundleFor({
      humanUserId: request.query.humanUserId === undefined ? undefined : String(request.query.humanUserId),
      campaignId: request.query.campaignId === undefined ? undefined : String(request.query.campaignId),
      apiBaseUrl: requestBaseUrl(request)
    });
    if (!bundle) {
      response.status(404).json({ error: "comparison_not_available" });
      return;
    }
    response.json({ bundle });
  });

  app.get("/api/comparisons/human-agent/result-certificate", async (request, response) => {
    const bundle = await buildHumanAgentComparisonBundleFor({
      humanUserId: request.query.humanUserId === undefined ? undefined : String(request.query.humanUserId),
      campaignId: request.query.campaignId === undefined ? undefined : String(request.query.campaignId),
      apiBaseUrl: requestBaseUrl(request)
    });
    if (!bundle) {
      response.status(404).json({ error: "comparison_not_available" });
      return;
    }
    response.json({
      certificate: buildHumanAgentComparisonResultCertificate({
        bundle,
        baseUrl: requestBaseUrl(request)
      })
    });
  });

  app.get("/api/agents/:agentId/campaigns", async (request, response) => {
    const agent = await store.findAgentProfile(request.params.agentId);
    if (!agent) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    response.json({
      campaigns: snapshot.agentCampaigns
        .filter((campaign) => campaign.agentId === agent.id)
        .map((campaign) =>
          buildAgentBenchmarkCampaignReport({
            campaign,
            snapshot,
            tasks
          })
        )
    });
  });

  app.post("/api/agents/:agentId/campaigns", async (request, response) => {
    const agent = await store.findAgentProfile(request.params.agentId);
    if (!agent) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }
    if (agent.status !== "active") {
      response.status(409).json({ error: "agent_not_active" });
      return;
    }

    const requestedLimit = Number(request.body.limit ?? 3);
    const limit = Number.isFinite(requestedLimit) ? Math.min(10, Math.max(1, Math.floor(requestedLimit))) : 3;
    const provider: RuntimeDispatch["provider"] = request.body.provider === "modal" ? "modal" : "local";
    const shouldDispatch = request.body.dispatch === undefined ? true : Boolean(request.body.dispatch);
    const reviewApproved = Boolean(request.body.reviewApproved);
    const snapshot = await store.read();
    const plan = buildAgentBenchmarkCampaignPlan({
      agent,
      snapshot,
      tasks: await store.listTasks(),
      provider,
      requestedTaskCount: limit,
      reviewApproved,
      dispatch: shouldDispatch
    });

    if (plan.items.length === 0) {
      response.status(409).json({
        error: "no_campaign_tasks_available",
        plan
      });
      return;
    }

    const items = [];
    for (const item of plan.items) {
      const run = await store.createRun({
        taskId: item.task.id,
        competitor: `agent:${agent.handle}`,
        competitorType: "agent",
        runtimeProvider: agent.runtimeProvider
      });
      if (!run) continue;

      const planEvent = await store.appendRunEvent({
        runId: run.id,
        type: "plan",
        message: `Agent ${agent.displayName} queued by benchmark campaign.`,
        metadata: {
          agentId: agent.id,
          provider: agent.provider,
          runtimeProvider: agent.runtimeProvider,
          campaignProvider: provider,
          reviewDecision: item.reviewDecision
        }
      });

      const links = buildAgentCampaignLinks(run.id, agent.id);
      let dispatch: RuntimeDispatch | null = null;
      let command: string | undefined;
      if (shouldDispatch) {
        const dispatchPlan = buildRuntimeDispatchPlan({
          run,
          agent,
          provider,
          apiBaseUrl: requestBaseUrl(request),
          workerId: `${provider}-campaign-${run.id}`
        });
        command = dispatchPlan.command;
        dispatch = await store.createRuntimeDispatch({
          runId: run.id,
          agentId: agent.id,
          provider,
          workerId: dispatchPlan.workerId,
          command: dispatchPlan.command,
          manifestUrl: dispatchPlan.manifestUrl,
          runtimePackageUrl: dispatchPlan.runtimePackageUrl,
          idempotencyKey: `campaign:${agent.id}:${run.id}:${provider}`,
          summary: dispatchPlan.summary
        });
        if (dispatch) {
          await store.appendRunEvent({
            runId: run.id,
            type: "plan",
            message: `Benchmark campaign planned ${provider} dispatch.`,
            idempotencyKey: `campaign-dispatch-event:${dispatch.id}`,
            metadata: {
              dispatchId: dispatch.id,
              provider,
              workerId: dispatch.workerId,
              agentId: agent.id
            }
          });
        }
      }

      items.push({
        ...item,
        run,
        dispatch,
        event: planEvent,
        command,
        links
      });
    }

    const record = await store.createAgentCampaign({
      agentId: agent.id,
      provider,
      requestedTaskCount: plan.requestedTaskCount,
      taskIds: items.map((item) => item.task.id),
      runIds: items.map((item) => item.run.id),
      dispatchIds: items.flatMap((item) => item.dispatch ? [item.dispatch.id] : []),
      reviewApproved,
      summary: `Agent ${agent.displayName} campaign queued ${items.length} runs.`
    });
    const report = record
      ? buildAgentBenchmarkCampaignReport({
          campaign: record,
          snapshot: await store.read(),
          tasks: await store.listTasks()
        })
      : undefined;

    response.status(201).json({
      campaign: {
        ...plan,
        id: record?.id,
        record,
        report,
        selectedTaskCount: items.length,
        runCount: items.length,
        dispatchCount: items.filter((item) => item.dispatch).length,
        items
      }
    });
  });

  app.get("/api/campaigns/:campaignId", async (request, response) => {
    const campaign = await store.getAgentCampaign(request.params.campaignId);
    if (!campaign) {
      response.status(404).json({ error: "campaign_not_found" });
      return;
    }
    response.json({
      campaign: buildAgentBenchmarkCampaignReport({
        campaign,
        snapshot: await store.read(),
        tasks: await store.listTasks()
      })
    });
  });

  app.get("/api/campaigns/:campaignId/evidence-bundle", async (request, response) => {
    const bundle = await buildAgentCampaignBundle(request.params.campaignId, requestBaseUrl(request));
    if (!bundle) {
      response.status(404).json({ error: "campaign_not_found" });
      return;
    }
    response.json({ bundle });
  });

  app.get("/api/campaigns/:campaignId/result-certificate", async (request, response) => {
    const bundle = await buildAgentCampaignBundle(request.params.campaignId, requestBaseUrl(request));
    if (!bundle) {
      response.status(404).json({ error: "campaign_not_found" });
      return;
    }
    response.json({
      certificate: buildAgentCampaignResultCertificate({
        bundle,
        baseUrl: requestBaseUrl(request)
      })
    });
  });

  app.post("/api/campaigns/:campaignId/run-local", async (request, response) => {
    const result = await runLocalAgentCampaign(request.params.campaignId);
    if (!result) {
      response.status(404).json({ error: "campaign_not_found" });
      return;
    }
    response.json({
      ...result,
      bundle: await buildAgentCampaignBundle(request.params.campaignId, requestBaseUrl(request))
    });
  });

  app.post("/api/users/:userId/steam", async (request, response) => {
    const steamid = String(request.body.steamid ?? "");
    if (!/^\d{17}$/.test(steamid)) {
      response.status(400).json({ error: "invalid_steamid" });
      return;
    }

    const user = await store.linkSteamToUser(request.params.userId, steamid, {
      proofConsent: Boolean(request.body.proofConsent)
    });
    if (!user) {
      response.status(404).json({ error: "user_not_found" });
      return;
    }
    response.json({ user });
  });

  app.post("/api/users/:userId/steam-proof-consent", async (request, response) => {
    const consented = request.body.consented === undefined ? true : Boolean(request.body.consented);
    const snapshot = await store.read();
    const existingUser = snapshot.users.find((entry) => entry.id === request.params.userId);
    if (!existingUser) {
      response.status(404).json({ error: "user_not_found" });
      return;
    }
    if (consented && !existingUser.linkedSteamId) {
      response.status(409).json({
        error: "steam_not_linked",
        user: existingUser
      });
      return;
    }
    const user = await store.updateSteamProofConsent(request.params.userId, consented);
    response.json({ user });
  });

  app.get("/api/human-onboarding/ops-report", async (request, response) => {
    const scope = parseSeasonScope(request.query.scope);
    if (!scope) {
      response.status(400).json({ error: "invalid_season_scope" });
      return;
    }
    const requestedLimit = Number(request.query.limit ?? 50);
    const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.floor(requestedLimit))) : 50;
    response.json({
      report: buildHumanOnboardingOpsReport({
        snapshot: await store.read(),
        scope,
        limit
      })
    });
  });

  app.get("/api/human-proof/ops-report", async (request, response) => {
    const appid = request.query.appid === undefined ? undefined : Number(request.query.appid);
    if (appid !== undefined && !Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const limit = request.query.limit === undefined ? 8 : Number(request.query.limit);
    const userLimit = request.query.userLimit === undefined ? 50 : Number(request.query.userLimit);
    const campaignId = request.query.campaignId === undefined ? undefined : String(request.query.campaignId);
    const snapshot = await store.read();

    response.json({
      report: buildHumanProofOpsReport({
        snapshot,
        tasks: await store.listTasks(),
        appid,
        limit,
        userLimit,
        campaignId
      })
    });
  });

  app.get("/api/users/:userId/steam-proof-plan", async (request, response) => {
    const snapshot = await store.read();
    const user = snapshot.users.find((entry) => entry.id === request.params.userId);
    if (!user) {
      response.status(404).json({ error: "user_not_found" });
      return;
    }
    if (user.type !== "human") {
      response.status(400).json({ error: "user_is_not_human" });
      return;
    }
    const requestedLimit = Number(request.query.limit ?? 8);
    const limit = Number.isFinite(requestedLimit) ? Math.min(50, Math.max(1, Math.floor(requestedLimit))) : 8;
    response.json({
      plan: buildHumanSteamProofPlan({
        user,
        snapshot,
        tasks: await store.listTasks(),
        limit
      })
    });
  });

  app.get("/api/users/:userId/steam-proof-report", async (request, response) => {
    const snapshot = await store.read();
    const user = snapshot.users.find((entry) => entry.id === request.params.userId);
    if (!user) {
      response.status(404).json({ error: "user_not_found" });
      return;
    }
    if (user.type !== "human") {
      response.status(400).json({ error: "user_is_not_human" });
      return;
    }
    const appid = request.query.appid === undefined ? undefined : Number(request.query.appid);
    if (request.query.appid !== undefined && !Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    response.json({
      report: await buildSteamProofReportFor({
        user,
        appid,
        live: request.query.live === "true",
        forceRefresh: request.query.refresh === "true"
      })
    });
  });

  app.get("/api/users/:userId/human-campaign-plan", async (request, response) => {
    const snapshot = await store.read();
    const user = snapshot.users.find((entry) => entry.id === request.params.userId);
    if (!user) {
      response.status(404).json({ error: "user_not_found" });
      return;
    }
    if (user.type !== "human") {
      response.status(400).json({ error: "user_is_not_human" });
      return;
    }
    const requestedLimit = Number(request.query.limit ?? 8);
    const limit = Number.isFinite(requestedLimit) ? Math.min(50, Math.max(1, Math.floor(requestedLimit))) : 8;
    const campaignId = request.query.campaignId === undefined ? undefined : String(request.query.campaignId);
    const plan = await buildHumanCampaignPlanFor({ user, campaignId, limit });
    if (!plan) {
      response.status(404).json({ error: "campaign_not_found" });
      return;
    }
    response.json({ plan });
  });

  app.post("/api/users/:userId/human-campaigns/run-local", async (request, response) => {
    const snapshot = await store.read();
    const user = snapshot.users.find((entry) => entry.id === request.params.userId);
    if (!user) {
      response.status(404).json({ error: "user_not_found" });
      return;
    }
    if (user.type !== "human") {
      response.status(400).json({ error: "user_is_not_human" });
      return;
    }
    if (!user.linkedSteamId) {
      response.status(400).json({ error: "steam_not_linked" });
      return;
    }
    if (!user.proofConsentAt) {
      response.status(403).json({ error: "steam_proof_consent_required" });
      return;
    }
    const requestedLimit = Number(request.body.limit ?? 8);
    const limit = Number.isFinite(requestedLimit) ? Math.min(50, Math.max(1, Math.floor(requestedLimit))) : 8;
    const result = await runLocalHumanCampaign({
      user,
      campaignId: request.body.campaignId === undefined ? undefined : String(request.body.campaignId),
      limit,
      apiBaseUrl: requestBaseUrl(request)
    });
    if (!result) {
      response.status(404).json({ error: "campaign_not_found" });
      return;
    }
    if (result.planBefore.status === "blocked" && result.submissions.length === 0) {
      response.status(409).json({
        error: "human_campaign_blocked",
        ...result
      });
      return;
    }
    response.json(result);
  });

  app.post("/api/steam/link-intents", async (request, response) => {
    const returnUrl = String(request.body.returnUrl ?? "http://127.0.0.1:5173");
    const userId = request.body.userId === undefined ? undefined : String(request.body.userId);
    const intent = await store.createSteamLinkIntent(returnUrl, userId);
    const openIdUrl = new URL("https://steamcommunity.com/openid/login");
    openIdUrl.searchParams.set("openid.ns", "http://specs.openid.net/auth/2.0");
    openIdUrl.searchParams.set("openid.mode", "checkid_setup");
    openIdUrl.searchParams.set("openid.return_to", `${returnUrl.replace(/\/$/, "")}/steam/callback?state=${intent.state}`);
    openIdUrl.searchParams.set("openid.realm", returnUrl);
    openIdUrl.searchParams.set("openid.identity", "http://specs.openid.net/auth/2.0/identifier_select");
    openIdUrl.searchParams.set("openid.claimed_id", "http://specs.openid.net/auth/2.0/identifier_select");

    response.json({
      intent,
      openIdUrl: openIdUrl.toString()
    });
  });

  app.post("/api/steam/link-intents/:state/mock-complete", async (request, response) => {
    const steamid = String(request.body.steamid ?? "76561198000000000");
    const intent = await store.markSteamLinked(
      request.params.state,
      steamid,
      `https://steamcommunity.com/openid/id/${steamid}`
    );
    if (!intent) {
      response.status(404).json({ error: "steam_link_intent_not_found" });
      return;
    }
    response.json({ intent });
  });

  app.get("/api/steam/callback", async (request, response) => {
    const state = String(request.query.state ?? "");
    if (!state) {
      response.status(400).json({ error: "missing_state" });
      return;
    }

    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(request.query)) {
        if (Array.isArray(value)) {
          for (const item of value) params.append(key, String(item));
        } else if (value !== undefined) {
          params.set(key, String(value));
        }
      }

      const claim = await openIdVerifier(params);
      const intent = await store.markSteamLinked(state, claim.steamid, claim.claimedId);
      if (!intent) {
        response.status(404).json({ error: "steam_link_intent_not_found" });
        return;
      }

      const redirectUrl = new URL(intent.returnUrl);
      redirectUrl.searchParams.set("steamLinked", "1");
      redirectUrl.searchParams.set("steamid", claim.steamid);
      response.redirect(302, redirectUrl.toString());
    } catch (error) {
      response.status(400).json({
        error: "steam_openid_verification_failed",
        message: error instanceof Error ? error.message : "Unknown Steam OpenID verification error"
      });
    }
  });

  app.post("/api/runs", async (request, response) => {
    const taskId = String(request.body.taskId ?? "");
    const competitor = String(request.body.competitor ?? "Runtime Agent");
    const competitorType = request.body.competitorType === "human" ? "human" : "agent";
    const runtimeProvider =
      request.body.runtimeProvider === "manual" || request.body.runtimeProvider === "modal" || request.body.runtimeProvider === "local-sim"
        ? request.body.runtimeProvider
        : competitorType === "human"
          ? "manual"
          : "local-sim";
    const run = await store.createRun({ taskId, competitor, competitorType, runtimeProvider });
    if (!run) {
      response.status(404).json({ error: "task_not_found" });
      return;
    }
    response.status(201).json({ run });
  });

  app.post("/api/users/:userId/runs", async (request, response) => {
    const snapshot = await store.read();
    const user = snapshot.users.find((entry) => entry.id === request.params.userId);
    if (!user) {
      response.status(404).json({ error: "user_not_found" });
      return;
    }
    if (user.type !== "human") {
      response.status(400).json({ error: "user_is_not_human" });
      return;
    }
    if (!user.linkedSteamId) {
      response.status(400).json({ error: "steam_not_linked" });
      return;
    }
    if (!user.proofConsentAt) {
      response.status(403).json({ error: "steam_proof_consent_required" });
      return;
    }

    const taskId = String(request.body.taskId ?? "");
    const run = await store.createRun({
      taskId,
      competitor: `human:${user.handle}`,
      competitorType: "human",
      runtimeProvider: "manual"
    });
    if (!run) {
      response.status(404).json({ error: "task_not_found" });
      return;
    }

    const event = await store.appendRunEvent({
      runId: run.id,
      type: "plan",
      message: `Human submission opened for ${user.displayName}.`,
      metadata: {
        userId: user.id,
        steamid: user.linkedSteamId,
        runtimeProvider: "manual"
      }
    });
    response.status(201).json({ run, user, event });
  });

  app.post("/api/users/:userId/steam-proof-submissions", async (request, response) => {
    const snapshot = await store.read();
    const user = snapshot.users.find((entry) => entry.id === request.params.userId);
    if (!user) {
      response.status(404).json({ error: "user_not_found" });
      return;
    }
    if (user.type !== "human") {
      response.status(400).json({ error: "user_is_not_human" });
      return;
    }
    if (!user.linkedSteamId) {
      response.status(400).json({ error: "steam_not_linked" });
      return;
    }
    if (!user.proofConsentAt) {
      response.status(403).json({ error: "steam_proof_consent_required" });
      return;
    }
    const tasks = await store.listTasks();
    const requestedTaskId = request.body.taskId === undefined ? undefined : String(request.body.taskId);
    const plan = buildHumanSteamProofPlan({
      user,
      snapshot,
      tasks,
      limit: tasks.length
    });
    const selected = requestedTaskId
      ? plan.items.find((item) => item.task.id === requestedTaskId)
      : plan.items.find((item) => item.status === "ready");
    if (!selected) {
      response.status(404).json({ error: "task_not_found_or_not_ready", plan });
      return;
    }
    if (selected.status !== "ready") {
      response.status(409).json({
        error: "human_task_not_ready",
        item: selected,
        plan
      });
      return;
    }

    const result = await runLocalHumanSteamProofSubmission({
      user,
      taskId: selected.task.id,
      apiBaseUrl: requestBaseUrl(request)
    });
    if (!result) {
      response.status(404).json({ error: "task_not_found" });
      return;
    }
    response.status(result.evaluation?.passed ? 201 : 202).json({
      submission: {
        schemaVersion: "steambench.human-steam-proof-submission.v1",
        userId: user.id,
        taskId: selected.task.id,
        runId: result.run.id,
        proofType: selected.proofType,
        entryPacket: selected.entryPacket,
        scoreboardReady: result.evaluation?.passed === true,
        links: {
          run: `/api/runs/${result.run.id}`,
          evidenceBundle: `/api/runs/${result.run.id}/evidence-bundle`,
          resultCertificate: `/api/runs/${result.run.id}/result-certificate`,
          plan: `/api/users/${user.id}/steam-proof-plan`
        }
      },
      plan,
      run: result.run,
      task: result.task,
      evaluation: result.evaluation,
      bundle: result.bundle,
      certificate: result.certificate
    });
  });

  app.post("/api/agents/:agentId/runs", async (request, response) => {
    const agent = await store.findAgentProfile(request.params.agentId);
    if (!agent) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }
    if (agent.status !== "active") {
      response.status(409).json({ error: "agent_not_active" });
      return;
    }

    const taskId = String(request.body.taskId ?? "");
    const task = await store.findTask(taskId);
    if (!task) {
      response.status(404).json({ error: "task_not_found" });
      return;
    }
    const readiness = buildRuntimeReadiness(task, agent);
    if (!readiness.ready) {
      response.status(409).json({
        error: "agent_not_ready_for_task",
        readiness
      });
      return;
    }
    const run = await store.createRun({
      taskId,
      competitor: `agent:${agent.handle}`,
      competitorType: "agent",
      runtimeProvider: agent.runtimeProvider
    });
    if (!run) {
      response.status(404).json({ error: "task_not_found" });
      return;
    }

    const event = await store.appendRunEvent({
      runId: run.id,
      type: "plan",
      message: `Agent ${agent.displayName} queued for benchmark execution.`,
      metadata: {
        agentId: agent.id,
        provider: agent.provider,
        runtimeProvider: agent.runtimeProvider,
        capabilityCount: agent.capabilities.length
      }
    });
    response.status(201).json({ run, agent, event });
  });

  app.post("/api/agents/:agentId/run-session", async (request, response) => {
    const agent = await store.findAgentProfile(request.params.agentId);
    if (!agent) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }
    if (agent.status !== "active") {
      response.status(409).json({ error: "agent_not_active" });
      return;
    }

    const taskId = String(request.body.taskId ?? "");
    const task = await store.findTask(taskId);
    if (!task) {
      response.status(404).json({ error: "task_not_found" });
      return;
    }
    const readiness = buildRuntimeReadiness(task, agent);
    if (!readiness.ready) {
      response.status(409).json({
        error: "agent_not_ready_for_task",
        readiness
      });
      return;
    }
    const shouldCreateLivestream = Boolean(request.body.createLivestream);
    const requestedLivestreamStatus = request.body.livestreamStatus === undefined ? "scheduled" : String(request.body.livestreamStatus);
    if (shouldCreateLivestream && requestedLivestreamStatus !== "scheduled" && requestedLivestreamStatus !== "live") {
      response.status(400).json({ error: "invalid_livestream_status" });
      return;
    }

    const run = await store.createRun({
      taskId,
      competitor: `agent:${agent.handle}`,
      competitorType: "agent",
      runtimeProvider: agent.runtimeProvider
    });
    if (!run) {
      response.status(404).json({ error: "task_not_found" });
      return;
    }

    const plan = buildRuntimeRunPlan(task);
    const event = await store.appendRunEvent({
      runId: run.id,
      type: "plan",
      message: `Agent ${agent.displayName} runtime session opened for benchmark execution.`,
      metadata: {
        agentId: agent.id,
        provider: agent.provider,
        runtimeProvider: agent.runtimeProvider,
        inputMode: plan.actionSpace.inputMode,
        transport: plan.actionSpace.transport,
        capabilityCount: agent.capabilities.length
      }
    });

    const requestedControl = request.body.createControlSession;
    const shouldCreateControlSession = requestedControl === undefined
      ? plan.actionSpace.transport === "virtual-controller"
      : Boolean(requestedControl);
    const requestedTtl = Number(request.body.ttlSeconds ?? 900);
    const ttlSeconds = Number.isFinite(requestedTtl) ? Math.max(30, Math.min(3600, Math.floor(requestedTtl))) : 900;
    const controlSession = shouldCreateControlSession
      ? await store.createRuntimeControlSession({
          runId: run.id,
          agentId: agent.id,
          ttlSeconds,
          actionSpace: plan.actionSpace,
          idempotencyKey: request.body.idempotencyKey === undefined ? undefined : `agent-run-session:${agent.id}:${run.id}:${String(request.body.idempotencyKey)}`,
          summary: `Agent ${agent.displayName} runtime session granted ${plan.actionSpace.transport} control.`
        })
      : null;
    if (controlSession) {
      await store.appendRunEvent({
        runId: run.id,
        type: "plan",
        message: `Runtime session ${controlSession.id} granted for ${plan.actionSpace.transport}.`,
        idempotencyKey: `agent-run-session-control:${controlSession.id}`,
        metadata: {
          controlSessionId: controlSession.id,
          agentId: agent.id,
          inputMode: controlSession.actionSpace.inputMode,
          transport: controlSession.actionSpace.transport,
          ttlSeconds
        }
      });
    }

    let livestream: LiveStreamSession | null = null;
    if (shouldCreateLivestream) {
      const requestedTitle = String(request.body.livestreamTitle ?? "").trim();
      livestream = await store.createLiveStream(
        run.id,
        requestedTitle || `Agent ${agent.displayName} plays ${task.gameName}`
      );
      if (livestream) {
        await store.appendRunEvent({
          runId: run.id,
          type: "livestream",
          message: `Agent run-session livestream scheduled at ${livestream.playbackUrl}.`,
          idempotencyKey: `agent-run-session-livestream:${livestream.id}:scheduled`,
          metadata: {
            streamId: livestream.id,
            playbackUrl: livestream.playbackUrl,
            agentId: agent.id
          }
        });
        if (requestedLivestreamStatus === "live") {
          const requestedViewerCount = Number(request.body.viewerCount);
          livestream = await store.updateLiveStreamStatus(livestream.id, "live", {
            viewerCount: Number.isFinite(requestedViewerCount) ? requestedViewerCount : undefined,
            currentScene: request.body.currentScene === undefined ? "Runtime session ready for bridge" : String(request.body.currentScene)
          });
          if (livestream) {
            await store.appendRunEvent({
              runId: run.id,
              type: "livestream",
              message: `Agent run-session livestream is live at ${livestream.playbackUrl}.`,
              idempotencyKey: `agent-run-session-livestream:${livestream.id}:live`,
              metadata: {
                streamId: livestream.id,
                playbackUrl: livestream.playbackUrl,
                agentId: agent.id,
                status: livestream.status
              }
            });
          }
        }
      }
    }

    const updated = await store.getRun(run.id);
    const events = updated?.events ?? [];
    const playbook = buildAgentPlaybook({ run, task, agent });
    const trace = buildAgentActionTrace({ run, task, events });
    const controlSessions = await store.listRuntimeControlSessions(run.id);
    const handoff = buildAgentRuntimeHandoff({
      run,
      task,
      agent,
      playbook,
      trace,
      controlSessions,
      streams: updated?.streams ?? []
    });
    const accessPacket = controlSession ? await buildRuntimeControlAccessPacketPayload(controlSession) : null;
    const bridgeManifest = controlSession && controlSession.actionSpace.transport === "virtual-controller"
      ? await buildControlBridgeManifestPayload(controlSession)
      : null;

    response.status(201).json({
      schemaVersion: "steambench.agent-run-session.v1",
      run,
      agent,
      event,
      controlSession: controlSession ? await resolveRuntimeControlSession(controlSession) : undefined,
      livestream: livestream ?? undefined,
      handoff,
      accessPacket,
      bridgeManifest,
      links: {
        handoff: `/api/runs/${run.id}/agent-handoff?agentId=${encodeURIComponent(agent.id)}`,
        playbook: `/api/runs/${run.id}/agent-playbook?agentId=${encodeURIComponent(agent.id)}`,
        trace: `/api/runs/${run.id}/agent-trace`,
        actionBatch: `/api/runs/${run.id}/action-batches`,
        controlSessions: `/api/runs/${run.id}/control-sessions`,
        accessPacket: controlSession ? `/api/control-sessions/${controlSession.id}/access-packet` : undefined,
        bridgeManifest: controlSession ? `/api/control-sessions/${controlSession.id}/bridge-manifest` : undefined,
        executorReport: controlSession ? `/api/runs/${run.id}/controller-executor-reports` : undefined,
        livestreamStatus: livestream ? `/api/livestreams/${livestream.id}/status` : undefined,
        broadcast: livestream ? `/api/broadcasts/${livestream.id}` : undefined,
        broadcastEvidenceBundle: livestream ? `/api/broadcasts/${livestream.id}/evidence-bundle` : undefined,
        broadcastResultCertificate: livestream ? `/api/broadcasts/${livestream.id}/result-certificate` : undefined,
        evidenceBundle: `/api/runs/${run.id}/evidence-bundle`,
        resultCertificate: `/api/runs/${run.id}/result-certificate`
      }
    });
  });

  app.get("/api/dispatches", async (_request, response) => {
    const snapshot = await store.read();
    response.json({
      dispatches: await Promise.all(snapshot.dispatches.map((dispatch) => resolveRuntimeDispatch(dispatch, snapshot)))
    });
  });

  app.get("/api/dispatches/ops-report", async (request, response) => {
    const filter = parseRuntimeDispatchOpsFilter(request.query);
    if (filter.error) {
      response.status(400).json({ error: filter.error });
      return;
    }

    const snapshot = await store.read();
    const queue = await store.listWorkerQueue();
    const dispatches = await Promise.all(snapshot.dispatches.map(async (dispatch) => {
      const resolved = await resolveRuntimeDispatch(dispatch, snapshot);
      const audit = resolved.run ? await buildRunAudit(resolved.run.id) : null;
      return {
        ...resolved,
        audit: audit ? summarizeRunAudit(audit) : undefined
      };
    }));
    response.json({
      report: buildRuntimeDispatchOpsReport({
        dispatches,
        provider: filter.provider,
        statuses: filter.statuses,
        limit: filter.limit,
        workerQueueTotals: {
          queued: queue.queued.length,
          leased: queue.leased.length,
          expired: queue.expired.length
        }
      })
    });
  });

  app.post("/api/runs/:runId/dispatch", async (request, response) => {
    const detail = await store.getRun(request.params.runId);
    if (!detail) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    if (detail.run.status !== "queued" && detail.run.status !== "preparing" && detail.run.status !== "running") {
      response.status(409).json({
        error: "run_not_dispatchable",
        run: detail.run
      });
      return;
    }

    const task = await store.findTask(detail.run.taskId);
    if (!task) {
      response.status(404).json({ error: "task_not_found" });
      return;
    }
    const provider: RuntimeDispatch["provider"] = request.body.provider === "modal" ? "modal" : "local";
    const requestedAgentId = request.body.agentId === undefined ? undefined : String(request.body.agentId);
    const agent = requestedAgentId
      ? await store.findAgentProfile(requestedAgentId)
      : detail.run.competitorType === "agent"
        ? await store.findAgentProfile(detail.run.competitor)
        : null;
    if (requestedAgentId && !agent) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }
    if (agent?.status === "paused") {
      response.status(409).json({ error: "agent_not_active" });
      return;
    }

    const plan = buildRuntimeDispatchPlan({
      run: detail.run,
      agent,
      provider,
      apiBaseUrl: requestBaseUrl(request),
      workerId: request.body.workerId === undefined ? undefined : String(request.body.workerId)
    });
    const dispatch = await store.createRuntimeDispatch({
      runId: detail.run.id,
      agentId: agent?.id,
      provider,
      workerId: plan.workerId,
      command: plan.command,
      manifestUrl: plan.manifestUrl,
      runtimePackageUrl: plan.runtimePackageUrl,
      idempotencyKey: request.body.idempotencyKey === undefined
        ? `dispatch:${provider}:${detail.run.id}:${agent?.id ?? "generic"}`
        : String(request.body.idempotencyKey),
      summary: plan.summary
    });
    if (!dispatch) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    const event = await store.appendRunEvent({
      runId: detail.run.id,
      type: "plan",
      message: `Runtime dispatch planned with ${provider} provider.`,
      idempotencyKey: `dispatch-event:${dispatch.id}`,
      metadata: {
        dispatchId: dispatch.id,
        provider,
        workerId: dispatch.workerId,
        agentId: agent?.id ?? ""
      }
    });
    const snapshot = await store.read();
    response.status(201).json({
      ...(await resolveRuntimeDispatch(dispatch, snapshot)),
      plan,
      event
    });
  });

  app.post("/api/dispatches/:dispatchId/status", async (request, response) => {
    const status = String(request.body.status ?? "");
    if (status !== "planned" && status !== "launched" && status !== "claimed" && status !== "completed" && status !== "failed" && status !== "canceled") {
      response.status(400).json({ error: "invalid_dispatch_status" });
      return;
    }
    const dispatch = await store.updateRuntimeDispatchStatus(
      request.params.dispatchId,
      status,
      request.body.summary === undefined ? undefined : String(request.body.summary)
    );
    if (!dispatch) {
      response.status(404).json({ error: "dispatch_not_found" });
      return;
    }
    const snapshot = await store.read();
    response.json(await resolveRuntimeDispatch(dispatch, snapshot));
  });

  app.get("/api/dispatches/:dispatchId/modal-package", async (request, response) => {
    const snapshot = await store.read();
    const dispatch = snapshot.dispatches.find((entry) => entry.id === request.params.dispatchId);
    const run = dispatch ? snapshot.runs.find((entry) => entry.id === dispatch.runId) : undefined;
    const task = dispatch ? await store.findTask(dispatch.taskId) : null;
    const agent = dispatch?.agentId ? snapshot.agents.find((entry) => entry.id === dispatch.agentId) : undefined;
    if (!dispatch || !run || !task) {
      response.status(404).json({ error: "dispatch_not_found" });
      return;
    }
    if (dispatch.provider !== "modal") {
      response.status(409).json({
        error: "dispatch_not_modal",
        dispatch
      });
      return;
    }
    response.json({
      modalPackage: buildModalRuntimePackage({
        dispatch,
        run,
        task,
        agent,
        apiBaseUrl: requestBaseUrl(request)
      })
    });
  });

  app.get("/api/worker/queue", async (_request, response) => {
    const queue = await store.listWorkerQueue();
    response.json({
      queue,
      totals: {
        queued: queue.queued.length,
        leased: queue.leased.length,
        expired: queue.expired.length
      }
    });
  });

  app.post("/api/worker/requeue-expired", async (request, response) => {
    const maxRuns = request.body.maxRuns === undefined ? undefined : Number(request.body.maxRuns);
    if (maxRuns !== undefined && (!Number.isFinite(maxRuns) || maxRuns < 0)) {
      response.status(400).json({ error: "invalid_max_runs" });
      return;
    }

    const requeued = await store.requeueExpiredRuns({
      reason: request.body.reason === undefined ? undefined : String(request.body.reason),
      maxRuns
    });
    response.json({
      requeued,
      count: requeued.length
    });
  });

  app.post("/api/worker/claim", async (request, response) => {
    const workerId = String(request.body.workerId ?? "");
    if (workerId.trim().length < 2) {
      response.status(400).json({ error: "invalid_worker_id" });
      return;
    }

    const runtimeProvider = request.body.runtimeProvider === "modal" || request.body.runtimeProvider === "manual"
      ? request.body.runtimeProvider
      : "local-sim";
    const run = await store.claimNextRun({
      workerId,
      runtimeProvider,
      leaseMinutes: request.body.leaseMinutes === undefined ? undefined : Number(request.body.leaseMinutes)
    });
    if (!run) {
      response.status(404).json({ error: "no_queued_runs" });
      return;
    }

    const task = await store.findTask(run.taskId);
    if (!task) {
      response.status(404).json({ error: "task_not_found" });
      return;
    }

    response.json({
      run,
      task,
      plan: buildRuntimeRunPlan(task),
      workerToken: `local-dev-token:${workerId}:${run.id}`
    });
  });

  app.post("/api/runs/:runId/claim", async (request, response) => {
    const workerId = String(request.body.workerId ?? "");
    if (workerId.trim().length < 2) {
      response.status(400).json({ error: "invalid_worker_id" });
      return;
    }

    const runtimeProvider = request.body.runtimeProvider === "modal" || request.body.runtimeProvider === "manual"
      ? request.body.runtimeProvider
      : "local-sim";
    const run = await store.claimRun(request.params.runId, {
      workerId,
      runtimeProvider,
      leaseMinutes: request.body.leaseMinutes === undefined ? undefined : Number(request.body.leaseMinutes)
    });
    if (!run) {
      response.status(404).json({ error: "run_not_found_or_not_queued" });
      return;
    }

    const task = await store.findTask(run.taskId);
    if (!task) {
      response.status(404).json({ error: "task_not_found" });
      return;
    }

    response.json({
      run,
      task,
      plan: buildRuntimeRunPlan(task),
      workerToken: `local-dev-token:${workerId}:${run.id}`
    });
  });

  app.get("/api/runs/:runId", async (request, response) => {
    const run = await store.getRun(request.params.runId);
    if (!run) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    response.json(run);
  });

  app.get("/api/runs/:runId/audit", async (request, response) => {
    const audit = await buildRunAudit(request.params.runId);
    if (!audit) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    response.json({ audit });
  });

  app.get("/api/runs/:runId/evidence-bundle", async (request, response) => {
    const requestedAgent = request.query.agentId === undefined ? undefined : String(request.query.agentId);
    const bundle = await buildEvidenceBundle(
      request.params.runId,
      requestBaseUrl(request),
      requestedAgent
    );
    if (!bundle) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    response.json({ bundle });
  });

  app.get("/api/runs/:runId/result-certificate", async (request, response) => {
    const requestedAgent = request.query.agentId === undefined ? undefined : String(request.query.agentId);
    const bundle = await buildEvidenceBundle(
      request.params.runId,
      requestBaseUrl(request),
      requestedAgent
    );
    if (!bundle) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    response.json({
      certificate: buildRunResultCertificate({
        bundle,
        baseUrl: requestBaseUrl(request)
      })
    });
  });

  app.get("/api/runs/:runId/agent-playbook", async (request, response) => {
    const runPayload = await store.getRun(request.params.runId);
    const task = runPayload ? await store.findTask(runPayload.run.taskId) : null;
    if (!runPayload || !task) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    const requestedAgent = request.query.agentId === undefined ? undefined : String(request.query.agentId);
    const agent = requestedAgent
      ? await store.findAgentProfile(requestedAgent)
      : await store.findAgentProfile(runPayload.run.competitor);
    response.json({
      playbook: buildAgentPlaybook({
        run: runPayload.run,
        task,
        agent
      })
    });
  });

  app.get("/api/runtime/action-spaces", async (request, response) => {
    const inputMode = request.query.inputMode === undefined ? undefined : String(request.query.inputMode);
    if (inputMode !== undefined && inputMode !== "keyboard-mouse" && inputMode !== "controller" && inputMode !== "turn-based-actions") {
      response.status(400).json({ error: "invalid_input_mode" });
      return;
    }
    const transport = request.query.transport === undefined ? undefined : String(request.query.transport);
    if (transport !== undefined && transport !== "local-desktop" && transport !== "virtual-controller" && transport !== "structured-turn-api") {
      response.status(400).json({ error: "invalid_action_transport" });
      return;
    }
    const appid = request.query.appid === undefined ? undefined : Number(request.query.appid);
    if (appid !== undefined && (!Number.isInteger(appid) || appid <= 0)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const requestedLimit = Number(request.query.limit ?? 50);
    const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.floor(requestedLimit))) : 50;
    const snapshot = await store.read();
    response.json({
      catalog: buildRuntimeActionSpaceCatalog({
        tasks: await store.listTasks(),
        agents: snapshot.agents,
        agentId: request.query.agentId === undefined ? undefined : String(request.query.agentId),
        appid,
        inputMode: inputMode as Parameters<typeof buildRuntimeActionSpaceCatalog>[0]["inputMode"],
        transport: transport as Parameters<typeof buildRuntimeActionSpaceCatalog>[0]["transport"],
        limit
      })
    });
  });

  app.get("/api/runs/:runId/agent-handoff", async (request, response) => {
    const runPayload = await store.getRun(request.params.runId);
    const task = runPayload ? await store.findTask(runPayload.run.taskId) : null;
    if (!runPayload || !task) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    const requestedAgent = request.query.agentId === undefined ? undefined : String(request.query.agentId);
    const agent = requestedAgent
      ? await store.findAgentProfile(requestedAgent)
      : await store.findAgentProfile(runPayload.run.competitor);
    if (requestedAgent && !agent) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }
    const playbook = buildAgentPlaybook({
      run: runPayload.run,
      task,
      agent
    });
    const trace = buildAgentActionTrace({
      run: runPayload.run,
      task,
      events: runPayload.events
    });
    response.json({
      handoff: buildAgentRuntimeHandoff({
        run: runPayload.run,
        task,
        agent,
        playbook,
        trace,
        controlSessions: await store.listRuntimeControlSessions(request.params.runId),
        streams: runPayload.streams
      })
    });
  });

  app.get("/api/runs/:runId/control-sessions", async (request, response) => {
    const runPayload = await store.getRun(request.params.runId);
    if (!runPayload) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    const sessions = await store.listRuntimeControlSessions(request.params.runId);
    response.json({
      schemaVersion: "steambench.runtime-control-sessions.v1",
      runId: request.params.runId,
      controlSessions: await Promise.all(sessions.map((session) => resolveRuntimeControlSession(session)))
    });
  });

  app.post("/api/runs/:runId/control-sessions", async (request, response) => {
    const runPayload = await store.getRun(request.params.runId);
    const task = runPayload ? await store.findTask(runPayload.run.taskId) : null;
    if (!runPayload || !task) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    const requestedAgentId = request.body.agentId === undefined ? undefined : String(request.body.agentId);
    const agent = requestedAgentId
      ? await store.findAgentProfile(requestedAgentId)
      : runPayload.run.competitorType === "agent"
        ? await store.findAgentProfile(runPayload.run.competitor)
        : null;
    if (requestedAgentId && !agent) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }
    const plan = buildRuntimeRunPlan(task);
    const requestedTtl = Number(request.body.ttlSeconds ?? 900);
    const ttlSeconds = Number.isFinite(requestedTtl) ? Math.max(30, Math.min(3600, Math.floor(requestedTtl))) : 900;
    const session = await store.createRuntimeControlSession({
      runId: request.params.runId,
      agentId: agent?.id,
      ttlSeconds,
      actionSpace: plan.actionSpace,
      idempotencyKey: request.body.idempotencyKey === undefined ? undefined : String(request.body.idempotencyKey),
      summary: request.body.summary === undefined ? undefined : String(request.body.summary)
    });
    if (!session) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    await store.appendRunEvent({
      runId: request.params.runId,
      type: "plan",
      message: `Runtime control session ${session.id} granted for ${plan.actionSpace.transport}.`,
      idempotencyKey: `control-session:${session.id}:grant`,
      metadata: {
        controlSessionId: session.id,
        inputMode: session.actionSpace.inputMode,
        transport: session.actionSpace.transport,
        ttlSeconds
      }
    });
    response.status(201).json({
      schemaVersion: "steambench.runtime-control-session.v1",
      ...(await resolveRuntimeControlSession(session))
    });
  });

  app.get("/api/control-sessions/ops-report", async (request, response) => {
    const filter = parseControlBridgeOpsFilter(request.query);
    if (filter.error) {
      response.status(400).json({ error: filter.error });
      return;
    }
    const sessions = await store.listRuntimeControlSessions();
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    response.json({
      report: buildControlBridgeOpsReport({
        sessions,
        runs: snapshot.runs,
        tasks,
        agents: snapshot.agents,
        events: snapshot.events,
        statuses: filter.statuses,
        transport: filter.transport,
        limit: filter.limit
      })
    });
  });

  app.post("/api/control-sessions/:sessionId/heartbeat", async (request, response) => {
    const session = await store.heartbeatRuntimeControlSession(request.params.sessionId);
    if (!session) {
      response.status(404).json({ error: "control_session_not_found" });
      return;
    }
    response.status(session.status === "active" ? 200 : 409).json({
      schemaVersion: "steambench.runtime-control-session.v1",
      ...(await resolveRuntimeControlSession(session))
    });
  });

  app.post("/api/control-sessions/:sessionId/revoke", async (request, response) => {
    const session = await store.revokeRuntimeControlSession(
      request.params.sessionId,
      request.body.summary === undefined ? undefined : String(request.body.summary)
    );
    if (!session) {
      response.status(404).json({ error: "control_session_not_found" });
      return;
    }
    response.json({
      schemaVersion: "steambench.runtime-control-session.v1",
      ...(await resolveRuntimeControlSession(session))
    });
  });

  app.get("/api/control-sessions/:sessionId/bridge-manifest", async (request, response) => {
    const session = await store.getRuntimeControlSession(request.params.sessionId);
    if (!session) {
      response.status(404).json({ error: "control_session_not_found" });
      return;
    }
    const manifest = await buildControlBridgeManifestPayload(session);
    if (!manifest) {
      response.status(404).json({ error: "control_session_target_not_found" });
      return;
    }
    response.status(session.status === "active" ? 200 : 409).json({ manifest });
  });

  app.get("/api/control-sessions/:sessionId/access-packet", async (request, response) => {
    const session = await store.getRuntimeControlSession(request.params.sessionId);
    if (!session) {
      response.status(404).json({ error: "control_session_not_found" });
      return;
    }
    const packet = await buildRuntimeControlAccessPacketPayload(session);
    if (!packet) {
      response.status(404).json({ error: "control_session_target_not_found" });
      return;
    }
    response.status(session.status === "active" ? 200 : 409).json({ packet });
  });

  app.get("/api/agent-traces/ops-report", async (request, response) => {
    const validVerdicts = new Set<AgentTraceAuditVerdict>([
      "trace-ready",
      "needs-actions",
      "needs-control-session",
      "needs-executor-report",
      "invalid"
    ]);
    const verdict = request.query.verdict === undefined ? undefined : String(request.query.verdict);
    if (verdict !== undefined && !validVerdicts.has(verdict as AgentTraceAuditVerdict)) {
      response.status(400).json({ error: "invalid_agent_trace_verdict" });
      return;
    }
    const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
    if (!Number.isFinite(limit) || limit < 1) {
      response.status(400).json({ error: "invalid_limit" });
      return;
    }
    const snapshot = await store.read();
    const tasks = await store.listTasks();
    response.json({
      report: buildAgentTraceOpsReport({
        runs: snapshot.runs,
        tasks,
        events: snapshot.events,
        controlSessions: snapshot.controlSessions,
        verdict: verdict as AgentTraceAuditVerdict | undefined,
        limit
      })
    });
  });

  app.get("/api/runs/:runId/agent-trace", async (request, response) => {
    const runPayload = await store.getRun(request.params.runId);
    const task = runPayload ? await store.findTask(runPayload.run.taskId) : null;
    if (!runPayload || !task) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    response.json({
      trace: buildAgentActionTrace({
        run: runPayload.run,
        task,
        events: runPayload.events
      })
    });
  });

  app.get("/api/runs/:runId/agent-trace/audit", async (request, response) => {
    const runPayload = await store.getRun(request.params.runId);
    const task = runPayload ? await store.findTask(runPayload.run.taskId) : null;
    if (!runPayload || !task) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    response.json({
      audit: buildAgentTraceAuditReport({
        run: runPayload.run,
        task,
        events: runPayload.events,
        controlSessions: await store.listRuntimeControlSessions(request.params.runId)
      })
    });
  });

  app.post("/api/runs/:runId/action-batches", async (request, response) => {
    const runPayload = await store.getRun(request.params.runId);
    const task = runPayload ? await store.findTask(runPayload.run.taskId) : null;
    if (!runPayload || !task) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    const plan = buildRuntimeRunPlan(task);
    const controlSessionId = request.body.controlSessionId === undefined ? undefined : String(request.body.controlSessionId);
    const controlSession = controlSessionId ? await store.getRuntimeControlSession(controlSessionId) : null;
    if (controlSessionId && !controlSession) {
      response.status(404).json({ error: "control_session_not_found" });
      return;
    }
    if (controlSession && controlSession.runId !== request.params.runId) {
      response.status(409).json({
        error: "control_session_run_mismatch",
        controlSession
      });
      return;
    }
    if (controlSession && controlSession.status !== "active") {
      response.status(409).json({
        error: "control_session_not_active",
        controlSession
      });
      return;
    }
    const actionSpace = controlSession?.actionSpace ?? plan.actionSpace;
    const requestedActions = Array.isArray(request.body.actions) ? request.body.actions : [];
    const actions = normalizeAgentActions(requestedActions, actionSpace);
    if (actions.length === 0) {
      response.status(400).json({
        error: "action_batch_empty",
        actionSpace
      });
      return;
    }
    const executionPlan = compileControllerExecutionPlan(actions, actionSpace);
    if (executionPlan && executionPlan.totalDurationMs > actionSpace.constraints.maxBatchDurationMs) {
      response.status(400).json({
        error: "action_batch_duration_exceeded",
        actionSpace,
        executionPlan
      });
      return;
    }
    const actionLabels = actions.map(actionLabel);
    const step = request.body.step === undefined ? runPayload.events.filter((event) => event.type === "act").length + 1 : Number(request.body.step);
    const confidence = request.body.confidence === undefined ? undefined : Number(request.body.confidence);
    const observationText = String(request.body.observation ?? "Runtime observed game state before action batch.");
    const idempotencyKey = request.body.idempotencyKey === undefined ? undefined : String(request.body.idempotencyKey);

    const observation = await store.appendRunEvent({
      runId: request.params.runId,
      type: "observe",
      message: observationText,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:observe` : undefined,
      metadata: {
        step: Number.isFinite(step) ? step : 1,
        source: String(request.body.source ?? "agent-action-batch"),
        screenRef: request.body.screenRef === undefined ? "" : String(request.body.screenRef),
        confidence: typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 0
      }
    });
    const act = await store.appendRunEvent({
      runId: request.params.runId,
      type: "act",
      message: String(request.body.summary ?? `Agent submitted ${actions.length} action(s).`),
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:act` : undefined,
      metadata: {
        step: Number.isFinite(step) ? step : 1,
        inputMode: plan.adapter.inputMode,
        actionSpace: actionSpace.schemaVersion,
        controlSessionId: controlSession?.id ?? "",
        actionCount: actions.length,
        actions: JSON.stringify(actionLabels.slice(0, 12)),
        executionPlan: executionPlan?.schemaVersion ?? "",
        executionPlanStepCount: executionPlan?.steps.length ?? 0,
        executionPlanDurationMs: executionPlan?.totalDurationMs ?? 0,
        durationMs: request.body.durationMs === undefined ? 0 : Number(request.body.durationMs),
        confidence: typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 0
      }
    });
    if (!observation || !act) {
      response.status(500).json({ error: "action_batch_event_append_failed" });
      return;
    }
    const checkpoint = request.body.checkpoint === undefined
      ? null
      : await store.appendRunEvent({
          runId: request.params.runId,
          type: "checkpoint",
          message: String(request.body.checkpoint),
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:checkpoint` : undefined,
          metadata: {
            step: Number.isFinite(step) ? step : 1,
            actionCount: actions.length
          }
        });
    const updated = await store.getRun(request.params.runId);
    const actionTypes = [...new Set(actions.map((action) => action.type))];
    const controllerExecutorRequest = executionPlan && controlSession
      ? {
          schemaVersion: "steambench.controller-executor-request.v1",
          executor: "geforce-now",
          provider: "geforce-now-external",
          sessionId: controlSession.id,
          runId: runPayload.run.id,
          taskId: task.id,
          plan: executionPlan
        }
      : null;
    const receipt = {
      schemaVersion: "steambench.agent-action-batch-receipt.v1",
      runId: runPayload.run.id,
      taskId: task.id,
      controlSessionId: controlSession?.id ?? null,
      inputMode: actionSpace.inputMode,
      transport: actionSpace.transport,
      acceptedActions: actions.length,
      rejectedActions: Math.max(0, requestedActions.length - actions.length),
      actionTypes,
      normalizedActionLabels: actionLabels,
      events: {
        observationId: observation.id,
        actId: act.id,
        checkpointId: checkpoint?.id ?? null
      },
      executionPlan: executionPlan
        ? {
            schemaVersion: executionPlan.schemaVersion,
            target: executionPlan.target,
            stepCount: executionPlan.steps.length,
            totalDurationMs: executionPlan.totalDurationMs,
            neutralOnCompletion: executionPlan.neutralOnCompletion
          }
        : null,
      controllerExecutorRequest: controllerExecutorRequest
        ? {
            schemaVersion: controllerExecutorRequest.schemaVersion,
            executor: controllerExecutorRequest.executor,
            provider: controllerExecutorRequest.provider,
            sessionId: controllerExecutorRequest.sessionId,
            runId: controllerExecutorRequest.runId,
            taskId: controllerExecutorRequest.taskId,
            planSchemaVersion: controllerExecutorRequest.plan.schemaVersion,
            stepCount: controllerExecutorRequest.plan.steps.length,
            totalDurationMs: controllerExecutorRequest.plan.totalDurationMs,
            command: "npm run executor:geforce-now"
          }
        : null,
      audit: {
        readyForTraceAudit: true,
        executorReportRequired: actionSpace.transport === "virtual-controller",
        canonicalCaptureRequired: actionSpace.constraints.requireCanonicalCapture,
        canonicalArtifact: "output/output.mp4",
        acceptedArtifactName: "output.mp4",
        forbiddenArtifactNames: ["output-test.mp4"]
      },
      endpoints: {
        actionBatch: `/api/runs/${runPayload.run.id}/action-batches`,
        trace: `/api/runs/${runPayload.run.id}/agent-trace`,
        traceAudit: `/api/runs/${runPayload.run.id}/agent-trace/audit`,
        submission: `/api/runs/${runPayload.run.id}/submission`,
        evidenceBundle: `/api/runs/${runPayload.run.id}/evidence-bundle`,
        resultCertificate: `/api/runs/${runPayload.run.id}/result-certificate`,
        bridgeManifest: controlSession ? `/api/control-sessions/${controlSession.id}/bridge-manifest` : undefined
      }
    };
    response.status(201).json({
      receipt,
      events: [observation, act, checkpoint].filter(Boolean),
      controlSession,
      actionSpace,
      normalizedActions: actions,
      normalizedActionLabels: actionLabels,
      executionPlan,
      controllerExecutorRequest,
      trace: updated
        ? buildAgentActionTrace({
            run: updated.run,
            task,
            events: updated.events
          })
        : undefined
    });
  });

  app.get("/api/runs/:runId/plan", async (request, response) => {
    const runPayload = await store.getRun(request.params.runId);
    const task = runPayload ? await store.findTask(runPayload.run.taskId) : null;
    if (!runPayload || !task) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    response.json({ plan: buildRuntimeRunPlan(task) });
  });

  app.get("/api/runs/:runId/execution-manifest", async (request, response) => {
    const requestedAgent = request.query.agentId === undefined ? undefined : String(request.query.agentId);
    const manifest = await buildRunExecutionManifest(
      request.params.runId,
      `${request.protocol}://${request.get("host")}`,
      requestedAgent
    );
    if (!manifest) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    response.json({ manifest });
  });

  app.get("/api/runs/:runId/runtime-package", async (request, response) => {
    const requestedAgent = request.query.agentId === undefined ? undefined : String(request.query.agentId);
    const manifest = await buildRunExecutionManifest(
      request.params.runId,
      `${request.protocol}://${request.get("host")}`,
      requestedAgent
    );
    if (!manifest) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }

    response.json({
      run: manifest.run,
      task: manifest.task,
      agent: manifest.agent,
      plan: manifest.plan,
      readiness: manifest.readiness,
      launch: manifest.launch,
      artifactContract: manifest.artifactContract,
      proofRequirements: manifest.proofRequirements,
      livestream: manifest.livestream,
      stage2Contract: manifest.stage2Contract,
      manifestUrl: `/api/runs/${manifest.run.id}/execution-manifest`
    });
  });

  app.post("/api/runs/:runId/events", async (request, response) => {
    const type = String(request.body.type ?? "");
    if (!runtimeEventTypes.includes(type as never)) {
      response.status(400).json({ error: "invalid_event_type" });
      return;
    }

    const event = await store.appendRunEvent({
      runId: request.params.runId,
      type: type as never,
      message: String(request.body.message ?? ""),
      idempotencyKey: request.body.idempotencyKey === undefined ? undefined : String(request.body.idempotencyKey),
      metadata: request.body.metadata
    });
    if (!event) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    response.status(201).json({ event });
  });

  app.post("/api/runs/:runId/controller-executor-reports", async (request, response) => {
    const runPayload = await store.getRun(request.params.runId);
    const task = runPayload ? await store.findTask(runPayload.run.taskId) : null;
    if (!runPayload || !task) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    const rawReport = request.body.report ?? request.body.controllerExecutorReport ?? request.body.executorReport;
    if (!rawReport || typeof rawReport !== "object" || Array.isArray(rawReport)) {
      response.status(400).json({ error: "missing_controller_executor_report" });
      return;
    }
    const requestedSessionId = request.body.controlSessionId === undefined
      ? (rawReport as Record<string, unknown>).sessionId
      : request.body.controlSessionId;
    const sessionId = requestedSessionId === undefined ? undefined : String(requestedSessionId);
    const session = sessionId ? await store.getRuntimeControlSession(sessionId) : null;
    if (sessionId && !session) {
      response.status(404).json({ error: "control_session_not_found" });
      return;
    }
    if (session && session.runId !== request.params.runId) {
      response.status(409).json({ error: "control_session_run_mismatch", controlSession: session });
      return;
    }
    const normalized = controllerExecutorReportMetadata({
      report: rawReport as Record<string, unknown>,
      runId: runPayload.run.id,
      taskId: task.id,
      sessionId: session?.id ?? sessionId
    });
    if (normalized.error || !normalized.metadata) {
      response.status(400).json({ error: normalized.error ?? "invalid_controller_executor_report" });
      return;
    }
    const plannedStepCount = normalized.metadata.plannedStepCount;
    const event = await store.appendRunEvent({
      runId: request.params.runId,
      type: "checkpoint",
      message: String(request.body.message ?? `Controller executor ${normalized.metadata.executorStatus} ${plannedStepCount} planned step(s).`),
      idempotencyKey: request.body.idempotencyKey === undefined ? undefined : String(request.body.idempotencyKey),
      metadata: normalized.metadata
    });
    if (!event) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    const updated = await store.getRun(request.params.runId);
    const trace = updated
      ? buildAgentActionTrace({ run: updated.run, task, events: updated.events })
      : undefined;
    const controlSessions = await store.listRuntimeControlSessions(request.params.runId);
    const audit = updated
      ? buildAgentTraceAuditReport({
          run: updated.run,
          task,
          events: updated.events,
          controlSessions
        })
      : undefined;
    response.status(201).json({
      schemaVersion: "steambench.controller-executor-report-submission.v1",
      event,
      report: rawReport,
      controlSession: session,
      trace,
      audit,
      links: {
        trace: `/api/runs/${request.params.runId}/agent-trace`,
        traceAudit: `/api/runs/${request.params.runId}/agent-trace/audit`,
        bridgeManifest: session ? `/api/control-sessions/${session.id}/bridge-manifest` : undefined,
        evidenceBundle: `/api/runs/${request.params.runId}/evidence-bundle`,
        resultCertificate: `/api/runs/${request.params.runId}/result-certificate`
      }
    });
  });

  app.post("/api/runs/:runId/heartbeat", async (request, response) => {
    const workerId = String(request.body.workerId ?? "");
    const run = await store.heartbeatRun(
      request.params.runId,
      workerId,
      request.body.leaseMinutes === undefined ? undefined : Number(request.body.leaseMinutes)
    );
    if (!run) {
      response.status(404).json({ error: "run_not_found_or_worker_mismatch" });
      return;
    }

    const event = await store.appendRunEvent({
      runId: request.params.runId,
      type: "heartbeat",
      message: `Worker ${workerId} heartbeat accepted.`,
      idempotencyKey: request.body.idempotencyKey === undefined ? undefined : String(request.body.idempotencyKey),
      metadata: {
        workerId,
        leaseExpiresAt: run.leaseExpiresAt ?? ""
      }
    });
    response.json({ run, event });
  });

  app.post("/api/runs/:runId/fail", async (request, response) => {
    const code = String(request.body.code ?? "worker_failed");
    const message = String(request.body.message ?? "Worker marked the run as failed.");
    const workerId = request.body.workerId === undefined ? undefined : String(request.body.workerId);
    const run = await store.failRun(request.params.runId, {
      code,
      message,
      workerId
    });
    if (!run) {
      response.status(404).json({ error: "run_not_found_or_worker_mismatch" });
      return;
    }

    const event = await store.appendRunEvent({
      runId: request.params.runId,
      type: "error",
      message,
      idempotencyKey: request.body.idempotencyKey === undefined ? undefined : String(request.body.idempotencyKey),
      metadata: {
        code,
        workerId: workerId ?? ""
      }
    });
    response.json({ run, event });
  });

  app.post("/api/runs/:runId/simulate-agent", async (request, response) => {
    const runPayload = await store.getRun(request.params.runId);
    const task = runPayload ? await store.findTask(runPayload.run.taskId) : null;
    if (!runPayload || !task) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }

    const simulated = await simulateAgentAttempt(runPayload.run.id, task.id);
    response.json({
      events: simulated?.events ?? [],
      stream: simulated?.stream,
      evaluation: simulated?.evaluation,
      run: simulated?.evaluation?.run ?? simulated?.detail?.run,
      row: simulated?.evaluation && "row" in simulated.evaluation ? simulated.evaluation.row : undefined,
      task
    });
  });

  app.get("/api/runs/:runId/proofs", async (request, response) => {
    const runPayload = await store.getRun(request.params.runId);
    if (!runPayload) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    response.json({ proofs: runPayload.proofs });
  });

  app.post("/api/runs/:runId/proofs", async (request, response) => {
    const type = String(request.body.type ?? "");
    if (type !== "steam-achievement" && type !== "canonical-artifact" && type !== "livestream" && type !== "manual-review") {
      response.status(400).json({ error: "invalid_proof_type" });
      return;
    }

    const status = String(request.body.status ?? "pending");
    if (status !== "pending" && status !== "verified" && status !== "failed") {
      response.status(400).json({ error: "invalid_proof_status" });
      return;
    }

    const proof = await store.createRunProof({
      runId: request.params.runId,
      type,
      status,
      summary: String(request.body.summary ?? `${type} proof submitted.`),
      metadata: request.body.metadata
    });
    if (!proof) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    response.status(201).json({ proof });
  });

  app.post("/api/runs/:runId/submission", async (request, response) => {
    const runPayload = await store.getRun(request.params.runId);
    const task = runPayload ? await store.findTask(runPayload.run.taskId) : null;
    if (!runPayload || !task) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }

    const artifactPath = String(request.body.artifactPath ?? "output/output.mp4");
    if (!artifactPath.endsWith("output.mp4")) {
      response.status(400).json({
        error: "invalid_artifact_name",
        message: "The canonical evaluated artifact must be named output.mp4."
      });
      return;
    }

    const runWithArtifact = await store.attachArtifact(request.params.runId, artifactPath);
    if (!runWithArtifact) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    await store.appendRunEvent({
      runId: request.params.runId,
      type: "artifact",
      message: `Submission attached canonical artifact ${artifactPath}.`,
      idempotencyKey: request.body.idempotencyKey === undefined ? undefined : `${String(request.body.idempotencyKey)}:artifact`,
      metadata: {
        artifactPath,
        canonicalArtifactName: "output.mp4"
      }
    });

    const proofs = [];
    if (task.track === "achievement") {
      const steamProof = typeof request.body.steamProof === "object" && request.body.steamProof !== null ? request.body.steamProof as Record<string, unknown> : {};
      const achieved = steamProof.achieved === undefined ? Boolean(request.body.allowMock ?? true) : Boolean(steamProof.achieved);
      const userId = steamProof.userId === undefined ? request.body.userId === undefined ? undefined : String(request.body.userId) : String(steamProof.userId);
      const achievementApiName = task.id.startsWith(`${task.appid}:`) ? task.id.slice(String(task.appid).length + 1) : task.title;
      const proof = await store.createRunProof({
        runId: request.params.runId,
        type: "steam-achievement",
        status: achieved ? "verified" : "failed",
        summary: achieved
          ? `Submission verified Steam achievement ${achievementApiName}.`
          : `Submission did not verify Steam achievement ${achievementApiName}.`,
        metadata: {
          appid: task.appid,
          taskId: task.id,
          achievementApiName,
          source: String(steamProof.source ?? "submission"),
          userId: userId ?? "",
          steamid: steamProof.steamid === undefined ? "" : String(steamProof.steamid)
        }
      });
      if (proof) proofs.push(proof);
    } else {
      const metricValue = request.body.metricValue === undefined ? undefined : Number(request.body.metricValue);
      const proof = await store.createRunProof({
        runId: request.params.runId,
        type: "manual-review",
        status: request.body.manualReviewStatus === "pending" || request.body.manualReviewStatus === "failed" ? request.body.manualReviewStatus : "verified",
        summary: String(request.body.summary ?? `Submission manual review proof for ${task.title}.`),
        metadata: {
          appid: task.appid,
          taskId: task.id,
          track: task.track,
          metricName: task.metricName ?? "",
          metricValue: typeof metricValue === "number" && Number.isFinite(metricValue) ? metricValue : "",
          targetValue: task.targetValue ?? "",
          reviewer: request.body.reviewer === undefined ? "submission" : String(request.body.reviewer)
        }
      });
      if (proof) proofs.push(proof);
    }

    for (const proof of proofs) {
      await store.appendRunEvent({
        runId: request.params.runId,
        type: proof.status === "verified" ? "proof" : "error",
        message: proof.summary,
        idempotencyKey: request.body.idempotencyKey === undefined ? undefined : `${String(request.body.idempotencyKey)}:${proof.type}`,
        metadata: {
          proofId: proof.id,
          proofType: proof.type,
          proofStatus: proof.status
        }
      });
    }

    const evaluation = request.body.evaluate === false ? undefined : await store.evaluateRun(request.params.runId);
    const bundle = await buildEvidenceBundle(request.params.runId, requestBaseUrl(request));
    const audit = bundle?.audit ?? await buildRunAudit(request.params.runId);
    const certificate = bundle
      ? buildRunResultCertificate({
          bundle,
          baseUrl: requestBaseUrl(request)
        })
      : undefined;
    const detail = await store.getRun(request.params.runId);

    response.status(evaluation && !evaluation.passed ? 202 : 201).json({
      receipt: {
        schemaVersion: "steambench.run-submission-receipt.v1",
        runId: request.params.runId,
        taskId: task.id,
        canonicalArtifactName: "output.mp4",
        artifactPath,
        proofCount: proofs.length,
        evaluated: Boolean(evaluation),
        scoreboardReady: evaluation?.passed === true && detail?.run.status === "scored",
        links: {
          run: `/api/runs/${request.params.runId}`,
          audit: `/api/runs/${request.params.runId}/audit`,
          evidenceBundle: `/api/runs/${request.params.runId}/evidence-bundle`,
          resultCertificate: `/api/runs/${request.params.runId}/result-certificate`
        }
      },
      run: detail?.run,
      task,
      proofs,
      evaluation,
      audit,
      bundle,
      certificate
    });
  });

  app.get("/api/proofs/review", async (request, response) => {
    const requestedStatus = request.query.status === undefined ? "pending" : String(request.query.status);
    if (requestedStatus !== "pending" && requestedStatus !== "verified" && requestedStatus !== "failed" && requestedStatus !== "all") {
      response.status(400).json({ error: "invalid_proof_status" });
      return;
    }

    response.json({
      proofs: await buildProofReviewQueue(requestedStatus === "all" ? undefined : requestedStatus)
    });
  });

  app.post("/api/proofs/:proofId/status", async (request, response) => {
    const status = String(request.body.status ?? "");
    if (status !== "pending" && status !== "verified" && status !== "failed") {
      response.status(400).json({ error: "invalid_proof_status" });
      return;
    }

    const proof = await store.updateRunProofStatus(
      request.params.proofId,
      status,
      {
        summary: request.body.summary === undefined ? undefined : String(request.body.summary),
        reviewer: request.body.reviewer === undefined ? undefined : String(request.body.reviewer),
        reviewNotes: request.body.reviewNotes === undefined ? undefined : String(request.body.reviewNotes)
      }
    );
    if (!proof) {
      response.status(404).json({ error: "proof_not_found" });
      return;
    }

    const event = await store.appendRunEvent({
      runId: proof.runId,
      type: "proof",
      message: `Proof ${proof.type} marked ${proof.status}.`,
      metadata: {
        proofId: proof.id,
        proofType: proof.type,
        proofStatus: proof.status,
        reviewer: proof.reviewer ?? ""
      }
    });
    response.json({ proof, event });
  });

  app.post("/api/runs/:runId/verify-steam-proof", async (request, response) => {
    const runPayload = await store.getRun(request.params.runId);
    const task = runPayload ? await store.findTask(runPayload.run.taskId) : null;
    if (!runPayload || !task) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    if (task.track !== "achievement") {
      response.status(400).json({ error: "unsupported_proof_track" });
      return;
    }

    const snapshot = await store.read();
    const requestedUserId = request.body.userId === undefined ? undefined : String(request.body.userId);
    const user = requestedUserId
      ? snapshot.users.find((entry) => entry.id === requestedUserId)
      : snapshot.users.find(
          (entry) =>
            `human:${entry.handle}` === runPayload.run.competitor ||
            entry.handle === runPayload.run.competitor ||
            entry.displayName === runPayload.run.competitor
        );
    if (!user) {
      response.status(400).json({ error: "user_required_for_steam_proof" });
      return;
    }
    if (!user.linkedSteamId) {
      response.status(400).json({ error: "steam_not_linked" });
      return;
    }
    if (!user.proofConsentAt) {
      response.status(403).json({ error: "steam_proof_consent_required" });
      return;
    }

    const achievementApiName = task.id.startsWith(`${task.appid}:`) ? task.id.slice(String(task.appid).length + 1) : task.title;
    const allowMock = Boolean(request.body.allowMock);
    let source: "steam-web-api" | "mock" = "steam-web-api";
    let achieved = false;
    let unlockTime: number | undefined;

    try {
      if (process.env.STEAM_WEB_API_KEY) {
        const achievements = await fetchPlayerAchievements({
          appid: task.appid,
          steamid: user.linkedSteamId,
          apiKey: process.env.STEAM_WEB_API_KEY
        });
        const achievement = achievements.find((entry) => entry.apiName === achievementApiName);
        achieved = Boolean(achievement?.achieved);
        unlockTime = achievement?.unlockTime;
      } else if (allowMock) {
        source = "mock";
        achieved = request.body.achieved === undefined ? true : Boolean(request.body.achieved);
        unlockTime = achieved ? Math.floor(Date.now() / 1000) : undefined;
      } else {
        response.status(503).json({
          error: "steam_web_api_key_required",
          message: "Set STEAM_WEB_API_KEY for live proof checks or pass allowMock=true in local smoke tests."
        });
        return;
      }
    } catch (error) {
      response.status(502).json({
        error: "steam_player_achievement_fetch_failed",
        message: error instanceof Error ? error.message : "Unknown Steam player achievement error"
      });
      return;
    }

    const metadata: Record<string, string | number | boolean> = {
      appid: task.appid,
      userId: user.id,
      steamid: user.linkedSteamId,
      achievementApiName,
      source
    };
    if (unlockTime !== undefined) metadata.unlockTime = unlockTime;

    const proof = await store.createRunProof({
      runId: runPayload.run.id,
      type: "steam-achievement",
      status: achieved ? "verified" : "failed",
      summary: achieved
        ? `Steam achievement ${achievementApiName} verified for ${user.displayName}.`
        : `Steam achievement ${achievementApiName} is not unlocked for ${user.displayName}.`,
      metadata
    });
    if (!proof) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }

    await store.appendRunEvent({
      runId: runPayload.run.id,
      type: achieved ? "proof" : "error",
      message: proof.summary,
      metadata: {
        proofId: proof.id,
        proofType: proof.type,
        status: proof.status
      }
    });

    if (!achieved) {
      response.status(422).json({ verified: false, proof });
      return;
    }

    const evaluation = request.body.evaluate === false ? undefined : await store.evaluateRun(runPayload.run.id);
    response.json({
      verified: true,
      proof,
      evaluation
    });
  });

  app.post("/api/runs/:runId/evaluate", async (request, response) => {
    const evaluation = await store.evaluateRun(request.params.runId);
    if (!evaluation) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    response.status(evaluation.passed ? 200 : 422).json({ evaluation });
  });

  app.get("/api/runs/:runId/artifacts", async (request, response) => {
    const runPayload = await store.getRun(request.params.runId);
    if (!runPayload) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    response.json({ artifacts: runPayload.artifacts });
  });

  app.post("/api/runs/:runId/artifacts", async (request, response) => {
    const name = String(request.body.name ?? "");
    const uri = String(request.body.uri ?? "");
    const canonical = Boolean(request.body.canonical);
    if (canonical && name !== "output.mp4") {
      response.status(400).json({
        error: "invalid_artifact_name",
        message: "The canonical evaluated artifact must be named output.mp4."
      });
      return;
    }
    if (!name || !uri) {
      response.status(400).json({ error: "invalid_artifact" });
      return;
    }

    const kind: RunArtifact["kind"] =
      request.body.kind === "log" ||
      request.body.kind === "replay" ||
      request.body.kind === "save" ||
      request.body.kind === "screenshot"
        ? request.body.kind
        : "video";

    const artifact = await store.createArtifact({
      runId: request.params.runId,
      kind,
      name,
      uri,
      sizeBytes: request.body.sizeBytes === undefined ? undefined : Number(request.body.sizeBytes),
      sha256: request.body.sha256 === undefined ? undefined : String(request.body.sha256),
      idempotencyKey: request.body.idempotencyKey === undefined ? undefined : String(request.body.idempotencyKey),
      canonical
    });
    if (!artifact) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    await store.appendRunEvent({
      runId: request.params.runId,
      type: "artifact",
      message: `Registered ${artifact.name} artifact.`,
      idempotencyKey: request.body.idempotencyKey === undefined ? undefined : String(request.body.idempotencyKey),
      metadata: {
        artifactId: artifact.id,
        kind: artifact.kind,
        canonical: artifact.canonical
      }
    });
    response.status(201).json({ artifact });
  });

  app.post("/api/runs/:runId/artifacts/presign", async (request, response) => {
    const name = String(request.body.name ?? "output.mp4");
    const canonical = Boolean(request.body.canonical ?? name === "output.mp4");
    if (canonical && name !== "output.mp4") {
      response.status(400).json({
        error: "invalid_artifact_name",
        message: "The canonical evaluated artifact must be named output.mp4."
      });
      return;
    }

    const runPayload = await store.getRun(request.params.runId);
    if (!runPayload) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }

    response.json({
      upload: {
        method: "PUT",
        url: `local-artifact://${request.params.runId}/${encodeURIComponent(name)}`,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
      },
      artifact: {
        runId: request.params.runId,
        name,
        canonical,
        uri: `output/${name}`
      }
    });
  });

  app.post("/api/runs/:runId/artifact", async (request, response) => {
    const artifactPath = String(request.body.artifactPath ?? "output/output.mp4");
    if (!artifactPath.endsWith("output.mp4")) {
      response.status(400).json({
        error: "invalid_artifact_name",
        message: "The canonical evaluated artifact must be named output.mp4."
      });
      return;
    }

    const run = await store.attachArtifact(request.params.runId, artifactPath);
    if (!run) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    response.json({ run });
  });

  app.post("/api/runs/:runId/livestreams", async (request, response) => {
    const stream = await store.createLiveStream(request.params.runId, String(request.body.title ?? ""));
    if (!stream) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    await store.appendRunEvent({
      runId: request.params.runId,
      type: "livestream",
      message: `Livestream scheduled at ${stream.playbackUrl}.`,
      metadata: {
        streamId: stream.id,
        playbackUrl: stream.playbackUrl
      }
    });
    response.status(201).json({ stream });
  });

  app.post("/api/livestreams/:streamId/status", async (request, response) => {
    const status = String(request.body.status ?? "");
    if (status !== "scheduled" && status !== "live" && status !== "ended" && status !== "failed") {
      response.status(400).json({ error: "invalid_stream_status" });
      return;
    }

    const stream = await store.updateLiveStreamStatus(request.params.streamId, status, {
      viewerCount: request.body.viewerCount === undefined ? undefined : Number(request.body.viewerCount),
      currentScene: request.body.currentScene === undefined ? undefined : String(request.body.currentScene)
    });
    if (!stream) {
      response.status(404).json({ error: "stream_not_found" });
      return;
    }
    if (status === "ended") {
      await store.createRunProof({
        runId: stream.runId,
        type: "livestream",
        status: "verified",
        summary: `Livestream ended with playback ${stream.playbackUrl}.`,
        metadata: {
          streamId: stream.id,
          playbackUrl: stream.playbackUrl,
          provider: stream.provider
        }
      });
    }
    response.json({ stream });
  });

  app.post("/api/runs/:runId/score", async (request, response) => {
    const requestedScore = request.body.score === undefined ? undefined : Number(request.body.score);
    const scored = await store.scoreRun(request.params.runId, Number.isFinite(requestedScore) ? requestedScore : undefined);
    if (!scored) {
      response.status(404).json({ error: "run_not_found" });
      return;
    }
    response.json(scored);
  });

  app.get("/api/steam/data-policy", (_request, response) => {
    response.json({ policy: buildSteamDataPolicyReport() });
  });

  app.get("/api/steam/cache", (_request, response) => {
    response.json({ entries: getSteamMetadataCacheSnapshot() });
  });

  app.post("/api/steam/cache/clear", (_request, response) => {
    clearSteamMetadataCache();
    response.json({ entries: getSteamMetadataCacheSnapshot() });
  });

  app.get("/api/steam/apps/search", async (request, response) => {
    const query = String(request.query.q ?? "");
    if (query.trim().length < 2) {
      response.json({ apps: [], steamMeta: null, policy: buildSteamDataPolicyReport() });
      return;
    }

    try {
      const result = await searchSteamAppsWithMeta(query, 20, {
        forceRefresh: request.query.refresh === "true"
      });
      response.json({ apps: result.data, steamMeta: result.meta, policy: buildSteamDataPolicyReport() });
    } catch (error) {
      response.status(502).json({
        error: "steam_app_search_failed",
        message: error instanceof Error ? error.message : "Unknown Steam API error"
      });
    }
  });

  app.get("/api/steam/apps/discovery", async (request, response) => {
    let status: SteamAppDiscoveryCandidate["status"] | undefined;
    if (request.query.status !== undefined) {
      const parsedStatus = parseSteamDiscoveryStatus(request.query.status);
      if (!parsedStatus) {
        response.status(400).json({ error: "invalid_steam_app_discovery_status" });
        return;
      }
      status = parsedStatus;
    }

    response.json({
      discoveries: await store.listSteamAppDiscoveryCandidates(status)
    });
  });

  app.get("/api/steam/source-queue", async (request, response) => {
    let discoveryStatus: SteamAppDiscoveryCandidate["status"] | undefined;
    if (request.query.discoveryStatus !== undefined) {
      const parsedStatus = parseSteamDiscoveryStatus(request.query.discoveryStatus);
      if (!parsedStatus) {
        response.status(400).json({ error: "invalid_steam_app_discovery_status" });
        return;
      }
      discoveryStatus = parsedStatus;
    }

    const useFixture = request.query.useFixture === "true";
    const refresh = request.query.refresh === "true";
    const limitInput = Number(request.query.limit ?? 8);
    const proposalLimitInput = Number(request.query.proposalLimit ?? 8);
    const limit = Number.isFinite(limitInput) ? Math.max(1, Math.min(20, Math.floor(limitInput))) : 8;
    const proposalLimit = Number.isFinite(proposalLimitInput) ? Math.max(1, Math.min(50, Math.floor(proposalLimitInput))) : 8;

    try {
      response.json(await buildSteamSourceQueuePayload({
        useFixture,
        refresh,
        limit,
        proposalLimit,
        discoveryStatus
      }));
    } catch (error) {
      response.status(502).json({
        error: "steam_source_queue_failed",
        message: error instanceof Error ? error.message : "Unknown Steam source queue error"
      });
    }
  });

  app.post("/api/steam/apps/discover", async (request, response) => {
    const query = String(request.body.query ?? "");
    if (query.trim().length < 2) {
      response.status(400).json({ error: "steam_app_discovery_query_too_short" });
      return;
    }

    const limitInput = Number(request.body.limit ?? 20);
    const limit = Number.isFinite(limitInput) ? Math.min(50, Math.max(1, Math.floor(limitInput))) : 20;
    const useFixture = Boolean(request.body.useFixture);

    try {
      const result = useFixture
        ? { apps: searchFixtureSteamApps(query, limit), steamMeta: null }
        : await searchSteamAppsWithMeta(query, limit, {
            forceRefresh: Boolean(request.body.refresh)
          }).then((entry) => ({ apps: entry.data, steamMeta: entry.meta }));
      const candidates = buildSteamAppDiscoveryCandidates({
        apps: result.apps,
        query,
        source: useFixture ? "fixture" : "steam-live"
      });
      const discoveries = await store.upsertSteamAppDiscoveryCandidates(candidates);
      response.status(201).json({
        source: useFixture ? "fixture" : "steam-live",
        steamMeta: result.steamMeta,
        policy: buildSteamDataPolicyReport(),
        discoveries
      });
    } catch (error) {
      const fixtureApps = searchFixtureSteamApps(query, limit);
      if (fixtureApps.length === 0) {
        response.status(502).json({
          error: "steam_app_discovery_failed",
          message: error instanceof Error ? error.message : "Unknown Steam app discovery error"
        });
        return;
      }

      const discoveries = await store.upsertSteamAppDiscoveryCandidates(
        buildSteamAppDiscoveryCandidates({
          apps: fixtureApps,
          query,
          source: "fixture"
        })
      );
      response.status(201).json({
        source: "fixture",
        warning: error instanceof Error ? error.message : "Fell back to local Steam app fixtures",
        steamMeta: null,
        policy: buildSteamDataPolicyReport(),
        discoveries
      });
    }
  });

  app.post("/api/steam/apps/discovery/:candidateId/status", async (request, response) => {
    const status = parseSteamDiscoveryStatus(request.body.status);
    if (!status) {
      response.status(400).json({ error: "invalid_steam_app_discovery_status" });
      return;
    }

    const discovery = await store.updateSteamAppDiscoveryStatus(
      request.params.candidateId,
      status,
      request.body.reviewNotes === undefined ? undefined : String(request.body.reviewNotes)
    );
    if (!discovery) {
      response.status(404).json({ error: "steam_app_discovery_not_found" });
      return;
    }
    response.json({ discovery });
  });

  app.post("/api/steam/apps/discovery/:candidateId/import-achievements", async (request, response) => {
    const snapshot = await store.read();
    const discovery = snapshot.steamAppDiscoveries.find(
      (entry) => entry.id === request.params.candidateId || String(entry.appid) === request.params.candidateId
    );
    if (!discovery) {
      response.status(404).json({ error: "steam_app_discovery_not_found" });
      return;
    }

    const limit = request.body.limit === undefined ? 25 : Number(request.body.limit);
    const useFixture = request.body.useFixture === undefined ? discovery.source === "fixture" : Boolean(request.body.useFixture);
    try {
      const imported = await importSteamAchievementCandidates({
        appid: discovery.appid,
        gameName: discovery.name,
        benchmarkFit: discovery.benchmarkFit,
        harnessRisk: discovery.harnessRisk,
        limit,
        useFixture,
        refresh: Boolean(request.body.refresh),
        reviewNotes:
          request.body.reviewNotes === undefined
            ? `Imported from Steam app discovery candidate ${discovery.name}.`
            : String(request.body.reviewNotes)
      });
      const updated = await store.updateSteamAppDiscoveryStatus(
        discovery.id,
        "imported",
        request.body.reviewNotes === undefined ? "Imported achievement task candidates." : String(request.body.reviewNotes)
      );
      response.status(201).json({
        discovery: updated,
        ...imported
      });
    } catch (error) {
      response.status(502).json({
        error: "steam_app_discovery_import_failed",
        message: error instanceof Error ? error.message : "Unknown Steam app discovery import error"
      });
    }
  });

  app.get("/api/steam/apps/discovery/:candidateId/benchmark-blueprint", async (request, response) => {
    const snapshot = await store.read();
    const discovery = snapshot.steamAppDiscoveries.find(
      (entry) => entry.id === request.params.candidateId || String(entry.appid) === request.params.candidateId
    );
    if (!discovery) {
      response.status(404).json({ error: "steam_app_discovery_not_found" });
      return;
    }
    const game = gameCatalog.find((entry) => entry.appid === discovery.appid) ?? inferGameCatalogEntry({
      appid: discovery.appid,
      name: discovery.name,
      benchmarkFit: discovery.benchmarkFit,
      harnessRisk: discovery.harnessRisk
    });
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const includeSourcePlan = request.query.includeSourcePlan === "true" || request.query.useFixture === "true";
    const taskSourceOps = includeSourcePlan
      ? (await buildSteamTaskSourceOpsPayload({
          appid: discovery.appid,
          useFixture: request.query.useFixture === "true",
          refresh: request.query.refresh === "true",
          limit: request.query.limit === undefined ? 12 : Number(request.query.limit),
          gameName: request.query.gameName === undefined ? discovery.name : String(request.query.gameName),
          benchmarkFit: request.query.benchmarkFit === undefined ? discovery.benchmarkFit : Number(request.query.benchmarkFit),
          harnessRisk:
            request.query.harnessRisk === "low" || request.query.harnessRisk === "medium" || request.query.harnessRisk === "high"
              ? request.query.harnessRisk
              : discovery.harnessRisk
        })).ops
      : undefined;
    response.json({
      blueprint: buildBenchmarkBlueprint({
        game,
        tasks,
        taskRegistry,
        discovery,
        taskSourceOps
      })
    });
  });

  app.get("/api/users/:userId/steam/apps/:appid/achievements", async (request, response) => {
    const snapshot = await store.read();
    const user = snapshot.users.find((entry) => entry.id === request.params.userId);
    if (!user) {
      response.status(404).json({ error: "user_not_found" });
      return;
    }
    if (!user.linkedSteamId) {
      response.status(400).json({ error: "steam_not_linked" });
      return;
    }
    if (!user.proofConsentAt) {
      response.status(403).json({ error: "steam_proof_consent_required" });
      return;
    }

    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }

    try {
      const result = await fetchPlayerAchievementsWithMeta({
        appid,
        steamid: user.linkedSteamId,
        apiKey: process.env.STEAM_WEB_API_KEY
      });
      response.json({
        userId: user.id,
        steamid: user.linkedSteamId,
        appid,
        achievements: result.data,
        meta: result.meta
      });
    } catch (error) {
      response.status(502).json({
        error: "steam_player_achievement_fetch_failed",
        message: error instanceof Error ? error.message : "Unknown Steam player achievement error"
      });
    }
  });

  app.post("/api/steam/apps/:appid/task-proposals", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const track = String(request.body.track ?? "");
    if (track !== "stat" && track !== "leaderboard" && track !== "capture") {
      response.status(400).json({ error: "invalid_manual_task_track" });
      return;
    }

    const title = String(request.body.title ?? "").trim();
    const metricName = String(request.body.metricName ?? "").trim();
    const targetValue = String(request.body.targetValue ?? "").trim();
    const objective = String(request.body.objective ?? "").trim();
    const scoringRule = String(request.body.scoringRule ?? "").trim();
    const level = Number(request.body.level ?? 5);
    const estimatedRuntimeMinutes = Number(request.body.estimatedRuntimeMinutes ?? 30);
    if (!title || !metricName || !targetValue || !objective || !scoringRule || !Number.isFinite(level) || !Number.isFinite(estimatedRuntimeMinutes)) {
      response.status(400).json({ error: "invalid_manual_task_contract" });
      return;
    }

    const snapshot = await store.read();
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
    const game = gameCatalog.find((entry) => entry.appid === appid) ?? inferGameCatalogEntry({
      appid,
      name: request.body.gameName === undefined ? discovery?.name : String(request.body.gameName),
      benchmarkFit: request.body.benchmarkFit === undefined ? discovery?.benchmarkFit : Number(request.body.benchmarkFit),
      harnessRisk:
        request.body.harnessRisk === "low" || request.body.harnessRisk === "medium" || request.body.harnessRisk === "high"
          ? request.body.harnessRisk
          : discovery?.harnessRisk
    });
    const proof = Array.isArray(request.body.proof)
      ? request.body.proof.map((entry: unknown) => String(entry)).filter((entry: string) => entry.trim().length > 0)
      : undefined;
    const riskFlags = Array.isArray(request.body.riskFlags)
      ? request.body.riskFlags.map((entry: unknown) => String(entry)).filter((entry: string) => entry.trim().length > 0)
      : undefined;

    const task = buildManualBenchmarkTask(game, {
      key: request.body.key === undefined ? undefined : String(request.body.key),
      title,
      track,
      level,
      targetValue,
      metricName,
      objective,
      proof,
      estimatedRuntimeMinutes,
      scoringRule,
      signalSource:
        request.body.signalSource === "steam-stat" ||
        request.body.signalSource === "steam-leaderboard" ||
        request.body.signalSource === "run-capture"
          ? request.body.signalSource
          : undefined,
      riskFlags
    });
    const [candidate] = await store.upsertTaskCandidates(
      [task],
      request.body.reviewNotes === undefined ? "Proposed from manual Steam benchmark task design." : String(request.body.reviewNotes)
    );
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    response.status(201).json({
      task: candidate,
      review: buildTaskReview(candidate),
      blueprint: buildBenchmarkBlueprint({
        game,
        tasks,
        taskRegistry,
        discovery
      })
    });
  });

  app.post("/api/steam/apps/:appid/metric-proposals", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }
    const proposalInputs = Array.isArray(request.body.proposals) ? request.body.proposals : [];
    if (proposalInputs.length === 0 || proposalInputs.length > 50) {
      response.status(400).json({ error: "invalid_metric_proposals" });
      return;
    }

    const parsed: Array<{ index: number; proposal?: ManualBenchmarkTaskInput; error?: string }> = proposalInputs.map((entry: unknown, index: number) => ({
      index,
      ...parseMetricProposalDraft(entry)
    }));
    const invalid = parsed.find((entry) => entry.error || !entry.proposal);
    if (invalid) {
      response.status(400).json({
        error: invalid.error ?? "invalid_metric_proposal",
        index: invalid.index
      });
      return;
    }

    const snapshot = await store.read();
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
    const game = gameCatalog.find((entry) => entry.appid === appid) ?? inferGameCatalogEntry({
      appid,
      name: request.body.gameName === undefined ? discovery?.name : String(request.body.gameName),
      benchmarkFit: request.body.benchmarkFit === undefined ? discovery?.benchmarkFit : Number(request.body.benchmarkFit),
      harnessRisk:
        request.body.harnessRisk === "low" || request.body.harnessRisk === "medium" || request.body.harnessRisk === "high"
          ? request.body.harnessRisk
          : discovery?.harnessRisk
    });
    const tasks = parsed.map((entry) => buildManualBenchmarkTask(game, entry.proposal!));
    const candidates = await store.upsertTaskCandidates(
      tasks,
      request.body.reviewNotes === undefined ? "Imported from Steam metric proposal manifest." : String(request.body.reviewNotes)
    );
    const allTasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const reviews = candidates.map((candidate) => buildTaskReview(candidate));

    response.status(201).json({
      proposalRun: {
        schemaVersion: "steambench.steam-metric-proposal-run.v1",
        appid,
        game,
        proposed: proposalInputs.length,
        candidates: candidates.length,
        tracks: [...new Set(candidates.map((candidate) => candidate.track))],
        reviewRequired: reviews.filter((review) => review.decision !== "ranked-ready").length,
        reviewNotes: request.body.reviewNotes === undefined ? "Imported from Steam metric proposal manifest." : String(request.body.reviewNotes),
        links: {
          publishCandidates: `/api/steam/apps/${appid}/publish-candidates`,
          benchmarkSuites: `/api/games/${appid}/benchmark-suites`,
          coveragePlan: `/api/games/${appid}/coverage-plan`,
          standings: `/api/games/${appid}/standings`
        }
      },
      candidates,
      reviews,
      blueprint: buildBenchmarkBlueprint({
        game,
        tasks: allTasks,
        taskRegistry,
        discovery
      })
    });
  });

  app.get("/api/steam/apps/:appid/stat-proposals", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }

    try {
      response.json(await buildSteamStatProposalPayload({
        appid,
        useFixture: request.query.useFixture === "true",
        refresh: request.query.refresh === "true",
        limit: request.query.limit === undefined ? 12 : Number(request.query.limit),
        gameName: request.query.gameName === undefined ? undefined : String(request.query.gameName),
        benchmarkFit: request.query.benchmarkFit === undefined ? undefined : Number(request.query.benchmarkFit),
        harnessRisk:
          request.query.harnessRisk === "low" || request.query.harnessRisk === "medium" || request.query.harnessRisk === "high"
            ? request.query.harnessRisk
            : undefined
      }));
    } catch (error) {
      response.status(502).json({
        error: "steam_stat_schema_fetch_failed",
        message: error instanceof Error ? error.message : "Unknown Steam stat schema error"
      });
    }
  });

  app.post("/api/steam/apps/:appid/stat-proposals/import-recommended", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }

    try {
      const payload = await buildSteamStatProposalPayload({
        appid,
        useFixture: Boolean(request.body.useFixture),
        refresh: Boolean(request.body.refresh),
        limit: request.body.limit === undefined ? 12 : Number(request.body.limit),
        gameName: request.body.gameName === undefined ? undefined : String(request.body.gameName),
        benchmarkFit: request.body.benchmarkFit === undefined ? undefined : Number(request.body.benchmarkFit),
        harnessRisk:
          request.body.harnessRisk === "low" || request.body.harnessRisk === "medium" || request.body.harnessRisk === "high"
            ? request.body.harnessRisk
            : undefined
      });
      const reviewNotes = request.body.reviewNotes === undefined
        ? "Imported from Steam stat schema recommendations."
        : String(request.body.reviewNotes);
      const imported = payload.tasks.length > 0 ? await store.upsertTaskCandidates(payload.tasks, reviewNotes) : [];
      const refreshedTasks = await store.listTasks();
      const refreshedRegistry = await store.listTaskRegistry();
      const snapshot = await store.read();
      const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
      const reviews = imported.map((candidate) => buildTaskReview(candidate));

      response.status(201).json({
        importRun: {
          schemaVersion: "steambench.steam-stat-recommended-import.v1",
          appid,
          source: payload.source,
          requestedLimit: payload.proposalRun.requestedLimit,
          proposed: payload.proposalRun.proposed,
          imported: imported.length,
          reviewRequired: reviews.filter((review) => review.decision !== "ranked-ready").length,
          skipped: Math.max(0, payload.stats.length - imported.length),
          reviewNotes,
          links: payload.proposalRun.links
        },
        imported,
        reviews,
        blueprint: buildBenchmarkBlueprint({
          game: payload.proposalRun.game,
          tasks: refreshedTasks,
          taskRegistry: refreshedRegistry,
          discovery
        }),
        steamMeta: payload.steamMeta,
        policy: payload.policy,
        warning: payload.warning
      });
    } catch (error) {
      response.status(502).json({
        error: "steam_stat_schema_import_failed",
        message: error instanceof Error ? error.message : "Unknown Steam stat schema import error"
      });
    }
  });

  app.get("/api/steam/apps/:appid/leaderboard-proposals", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }

    try {
      response.json(await buildSteamLeaderboardProposalPayload({
        appid,
        useFixture: request.query.useFixture === "true",
        refresh: request.query.refresh === "true",
        limit: request.query.limit === undefined ? 12 : Number(request.query.limit),
        gameName: request.query.gameName === undefined ? undefined : String(request.query.gameName),
        benchmarkFit: request.query.benchmarkFit === undefined ? undefined : Number(request.query.benchmarkFit),
        harnessRisk:
          request.query.harnessRisk === "low" || request.query.harnessRisk === "medium" || request.query.harnessRisk === "high"
            ? request.query.harnessRisk
            : undefined
      }));
    } catch (error) {
      response.status(502).json({
        error: "steam_leaderboard_metadata_fetch_failed",
        message: error instanceof Error ? error.message : "Unknown Steam leaderboard metadata error"
      });
    }
  });

  app.post("/api/steam/apps/:appid/leaderboard-proposals/import-recommended", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }

    try {
      const payload = await buildSteamLeaderboardProposalPayload({
        appid,
        useFixture: Boolean(request.body.useFixture),
        refresh: Boolean(request.body.refresh),
        limit: request.body.limit === undefined ? 12 : Number(request.body.limit),
        gameName: request.body.gameName === undefined ? undefined : String(request.body.gameName),
        benchmarkFit: request.body.benchmarkFit === undefined ? undefined : Number(request.body.benchmarkFit),
        harnessRisk:
          request.body.harnessRisk === "low" || request.body.harnessRisk === "medium" || request.body.harnessRisk === "high"
            ? request.body.harnessRisk
            : undefined
      });
      const reviewNotes = request.body.reviewNotes === undefined
        ? "Imported from Steam leaderboard metadata recommendations."
        : String(request.body.reviewNotes);
      const imported = payload.tasks.length > 0 ? await store.upsertTaskCandidates(payload.tasks, reviewNotes) : [];
      const refreshedTasks = await store.listTasks();
      const refreshedRegistry = await store.listTaskRegistry();
      const snapshot = await store.read();
      const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
      const reviews = imported.map((candidate) => buildTaskReview(candidate));

      response.status(201).json({
        importRun: {
          schemaVersion: "steambench.steam-leaderboard-recommended-import.v1",
          appid,
          source: payload.source,
          requestedLimit: payload.proposalRun.requestedLimit,
          proposed: payload.proposalRun.proposed,
          imported: imported.length,
          reviewRequired: reviews.filter((review) => review.decision !== "ranked-ready").length,
          skipped: Math.max(0, payload.leaderboards.length - imported.length),
          reviewNotes,
          links: payload.proposalRun.links
        },
        imported,
        reviews,
        blueprint: buildBenchmarkBlueprint({
          game: payload.proposalRun.game,
          tasks: refreshedTasks,
          taskRegistry: refreshedRegistry,
          discovery
        }),
        steamMeta: payload.steamMeta,
        policy: payload.policy,
        warning: payload.warning
      });
    } catch (error) {
      response.status(502).json({
        error: "steam_leaderboard_metadata_import_failed",
        message: error instanceof Error ? error.message : "Unknown Steam leaderboard metadata import error"
      });
    }
  });

  app.get("/api/steam/apps/:appid/task-source-ops", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }

    try {
      const useFixture = request.query.useFixture === "true";
      const refresh = request.query.refresh === "true";
      const limit = request.query.limit === undefined ? 12 : Number(request.query.limit);
      const gameName = request.query.gameName === undefined ? undefined : String(request.query.gameName);
      const benchmarkFit = request.query.benchmarkFit === undefined ? undefined : Number(request.query.benchmarkFit);
      const harnessRisk =
        request.query.harnessRisk === "low" || request.query.harnessRisk === "medium" || request.query.harnessRisk === "high"
          ? request.query.harnessRisk
          : undefined;
      response.json(await buildSteamTaskSourceOpsPayload({
        appid,
        useFixture,
        refresh,
        limit,
        gameName,
        benchmarkFit,
        harnessRisk
      }));
    } catch (error) {
      response.status(502).json({
        error: "steam_task_source_ops_failed",
        message: error instanceof Error ? error.message : "Unknown Steam task source ops error"
      });
    }
  });

  app.get("/api/steam/apps/:appid/achievement-tasks", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }

    try {
      const liveAchievements = await fetchGlobalAchievementPercentagesWithMeta(appid, {
        forceRefresh: request.query.refresh === "true"
      });
      response.json({
        source: "steam-live",
        steamMeta: liveAchievements.meta,
        policy: buildSteamDataPolicyReport(),
        tasks: buildTasksForGame(appid, liveAchievements.data, "steam-live")
      });
    } catch (error) {
      const fixtureAchievements = achievementFixtures[appid] ?? [];
      response.json({
        source: "fixture",
        warning: error instanceof Error ? error.message : "Fell back to local fixtures",
        policy: buildSteamDataPolicyReport(),
        tasks: buildTasksForGame(appid, fixtureAchievements, "fixture")
      });
    }
  });

  app.get("/api/steam/apps/:appid/achievement-ladder", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }

    response.json(await buildSteamAchievementLadderPayload({
      appid,
      useFixture: request.query.useFixture === "true",
      refresh: request.query.refresh === "true"
    }));
  });

  app.post("/api/steam/apps/:appid/achievement-ladder/import-recommended", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }

    const maxTasksInput = request.body.limit === undefined ? 12 : Number(request.body.limit);
    const maxTasks = Number.isFinite(maxTasksInput) ? Math.max(1, Math.min(50, Math.floor(maxTasksInput))) : 12;
    const ladderPayload = await buildSteamAchievementLadderPayload({
      appid,
      useFixture: Boolean(request.body.useFixture),
      refresh: Boolean(request.body.refresh),
      gameName: request.body.gameName === undefined ? undefined : String(request.body.gameName),
      benchmarkFit: request.body.benchmarkFit === undefined ? undefined : Number(request.body.benchmarkFit),
      harnessRisk:
        request.body.harnessRisk === "low" || request.body.harnessRisk === "medium" || request.body.harnessRisk === "high"
          ? request.body.harnessRisk
          : undefined
    });
    const importable = ladderPayload.ladder.recommendedImports
      .filter((entry) => entry.recommendation === "import-candidate" && entry.importStatus === "new")
      .slice(0, maxTasks);
    const imported = importable.length > 0
      ? await store.upsertTaskCandidates(
          importable.map((entry) => entry.task),
          request.body.reviewNotes === undefined ? "Imported from Steam achievement ladder recommendations." : String(request.body.reviewNotes)
        )
      : [];
    const skipped = ladderPayload.ladder.bands
      .flatMap((band) => band.items)
      .filter((entry) => !importable.some((item) => item.task.id === entry.task.id))
      .map((entry) => ({
        taskId: entry.task.id,
        title: entry.task.title,
        importStatus: entry.importStatus,
        recommendation: entry.recommendation,
        reviewDecision: entry.review.decision
      }));

    response.status(201).json({
      importRun: {
        schemaVersion: "steambench.steam-achievement-recommended-import.v1",
        appid,
        source: ladderPayload.source,
        requestedLimit: maxTasks,
        imported,
        skipped,
        totals: {
          imported: imported.length,
          skipped: skipped.length,
          recommended: ladderPayload.ladder.totals.recommendedImports,
          active: ladderPayload.ladder.totals.active,
          candidates: ladderPayload.ladder.totals.candidates,
          rejected: ladderPayload.ladder.totals.rejected,
          new: ladderPayload.ladder.totals.new
        },
        links: {
          achievementLadder: `/api/steam/apps/${appid}/achievement-ladder`,
          publishCandidates: `/api/steam/apps/${appid}/publish-candidates`,
          coveragePlan: `/api/games/${appid}/coverage-plan`
        }
      },
      ladder: ladderPayload.ladder,
      steamMeta: ladderPayload.steamMeta,
      policy: ladderPayload.policy,
      warning: ladderPayload.warning
    });
  });

  app.get("/api/steam/apps/:appid/onboarding", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }

    const snapshot = await store.read();
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
    const game = inferGameCatalogEntry({
      appid,
      name: discovery?.name,
      benchmarkFit: discovery?.benchmarkFit,
      harnessRisk: discovery?.harnessRisk
    });
    const humanUserId = typeof request.query.humanUserId === "string" ? request.query.humanUserId : undefined;
    const agentId = typeof request.query.agentId === "string" ? request.query.agentId : undefined;
    const human = humanUserId ? snapshot.users.find((user) => user.id === humanUserId && user.type === "human") : undefined;
    const agent = agentId ? snapshot.agents.find((entry) => entry.id === agentId) : undefined;
    if (humanUserId && !human) {
      response.status(404).json({ error: "human_user_not_found" });
      return;
    }
    if (agentId && !agent) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }
    const limitInput = request.query.limit === undefined ? 12 : Number(request.query.limit);
    const limit = Number.isFinite(limitInput) ? Math.max(1, Math.min(50, Math.floor(limitInput))) : 12;
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const ladderPayload = await buildSteamAchievementLadderPayload({
      appid,
      useFixture: request.query.useFixture === "true",
      refresh: request.query.refresh === "true"
    });
    const blueprint = buildBenchmarkBlueprint({
      game,
      tasks,
      taskRegistry,
      discovery
    });
    const coveragePlan = buildGameCoveragePlan({
      game,
      snapshot,
      tasks,
      taskRegistry,
      human,
      agent,
      limit
    });

    response.json({
      onboarding: buildSteamAppOnboardingPipeline({
        discovery,
        ladder: ladderPayload.ladder,
        blueprint,
        coveragePlan
      }),
      ladder: ladderPayload.ladder,
      blueprint,
      coveragePlan,
      steamMeta: ladderPayload.steamMeta,
      policy: ladderPayload.policy,
      warning: ladderPayload.warning
    });
  });

  app.post("/api/steam/apps/:appid/onboarding/advance", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }

    const maxTasksInput = request.body.limit === undefined ? 12 : Number(request.body.limit);
    const maxTasks = Number.isFinite(maxTasksInput) ? Math.max(1, Math.min(50, Math.floor(maxTasksInput))) : 12;
    const useFixture = Boolean(request.body.useFixture);
    const reviewNotes = request.body.reviewNotes === undefined
      ? "Advanced through Steam app onboarding."
      : String(request.body.reviewNotes);
    const initialLadderPayload = await buildSteamAchievementLadderPayload({
      appid,
      useFixture,
      refresh: Boolean(request.body.refresh),
      gameName: request.body.gameName === undefined ? undefined : String(request.body.gameName),
      benchmarkFit: request.body.benchmarkFit === undefined ? undefined : Number(request.body.benchmarkFit),
      harnessRisk:
        request.body.harnessRisk === "low" || request.body.harnessRisk === "medium" || request.body.harnessRisk === "high"
          ? request.body.harnessRisk
          : undefined
    });
    const importable = initialLadderPayload.ladder.recommendedImports
      .filter((entry) => entry.recommendation === "import-candidate" && entry.importStatus === "new")
      .slice(0, maxTasks);
    const imported = importable.length > 0
      ? await store.upsertTaskCandidates(importable.map((entry) => entry.task), reviewNotes)
      : [];
    const publicationResult = await publishSteamTaskCandidates({
      appid,
      limit: maxTasks,
      reviewNotes,
      reviewApproved: request.body.reviewApproved === undefined ? true : Boolean(request.body.reviewApproved),
      forceReviewOverride: Boolean(request.body.forceReviewOverride),
      gameName: request.body.gameName === undefined ? undefined : String(request.body.gameName),
      benchmarkFit: request.body.benchmarkFit === undefined ? undefined : Number(request.body.benchmarkFit),
      harnessRisk:
        request.body.harnessRisk === "low" || request.body.harnessRisk === "medium" || request.body.harnessRisk === "high"
          ? request.body.harnessRisk
          : undefined
    });
    const snapshot = await store.read();
    const discovery = snapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
    const game = inferGameCatalogEntry({
      appid,
      name: request.body.gameName === undefined ? discovery?.name : String(request.body.gameName),
      benchmarkFit: request.body.benchmarkFit === undefined ? discovery?.benchmarkFit : Number(request.body.benchmarkFit),
      harnessRisk:
        request.body.harnessRisk === "low" || request.body.harnessRisk === "medium" || request.body.harnessRisk === "high"
          ? request.body.harnessRisk
          : discovery?.harnessRisk
    });
    const humanUserId = request.body.humanUserId === undefined ? undefined : String(request.body.humanUserId);
    const agentId = request.body.agentId === undefined ? undefined : String(request.body.agentId);
    const human = humanUserId ? snapshot.users.find((user) => user.id === humanUserId && user.type === "human") : undefined;
    const agent = agentId ? snapshot.agents.find((entry) => entry.id === agentId) : undefined;
    if (humanUserId && !human) {
      response.status(404).json({ error: "human_user_not_found" });
      return;
    }
    if (agentId && !agent) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const ladderPayload = await buildSteamAchievementLadderPayload({
      appid,
      useFixture,
      refresh: false,
      gameName: game.name,
      benchmarkFit: game.benchmarkFit,
      harnessRisk: game.harnessRisk
    });
    const blueprint = buildBenchmarkBlueprint({
      game,
      tasks,
      taskRegistry,
      discovery
    });
    const coveragePlan = buildGameCoveragePlan({
      game,
      snapshot,
      tasks,
      taskRegistry,
      human,
      agent,
      limit: maxTasks
    });
    const onboarding = buildSteamAppOnboardingPipeline({
      discovery,
      ladder: ladderPayload.ladder,
      blueprint,
      coveragePlan
    });

    response.status(imported.length > 0 || publicationResult.publication.totals.published > 0 ? 201 : 200).json({
      advance: {
        schemaVersion: "steambench.steam-app-onboarding-advance.v1",
        appid,
        requestedLimit: maxTasks,
        steps: [
          {
            id: "import-recommended",
            status: imported.length > 0 ? "changed" : "skipped",
            imported: imported.length,
            skipped: initialLadderPayload.ladder.totals.achievements - imported.length
          },
          {
            id: "publish-candidates",
            status: publicationResult.publication.totals.published > 0
              ? "changed"
              : publicationResult.publication.totals.blocked > 0
                ? "blocked"
                : "skipped",
            published: publicationResult.publication.totals.published,
            blocked: publicationResult.publication.totals.blocked,
            alreadyActive: publicationResult.publication.totals.alreadyActive
          },
          {
            id: "coverage-plan",
            status: coveragePlan.totals.readyHumanActions + coveragePlan.totals.readyAgentActions > 0 ? "ready" : "skipped",
            readyActions: coveragePlan.totals.readyHumanActions + coveragePlan.totals.readyAgentActions,
            humanGaps: coveragePlan.totals.humanGaps,
            agentGaps: coveragePlan.totals.agentGaps
          }
        ],
        links: {
          onboarding: `/api/steam/apps/${appid}/onboarding`,
          importRecommended: `/api/steam/apps/${appid}/achievement-ladder/import-recommended`,
          publishCandidates: `/api/steam/apps/${appid}/publish-candidates`,
          coveragePlan: `/api/games/${appid}/coverage-plan`,
          runCoverageLocal: `/api/games/${appid}/coverage-plan/run-local`,
          runOnboardingLocal: `/api/steam/apps/${appid}/onboarding/run-local`
        }
      },
      imported,
      publication: publicationResult.publication,
      onboarding,
      ladder: ladderPayload.ladder,
      blueprint,
      coveragePlan,
      policy: ladderPayload.policy,
      warning: ladderPayload.warning ?? initialLadderPayload.warning
    });
  });

  app.post("/api/steam/apps/:appid/onboarding/run-local", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }

    const side = String(request.body.side ?? "both");
    if (side !== "human" && side !== "agent" && side !== "both") {
      response.status(400).json({ error: "invalid_side" });
      return;
    }
    const wantsHuman = side === "human" || side === "both";
    const wantsAgent = side === "agent" || side === "both";
    const humanUserId = request.body.humanUserId === undefined ? undefined : String(request.body.humanUserId);
    const agentId = request.body.agentId === undefined ? undefined : String(request.body.agentId);
    if (wantsHuman && !humanUserId) {
      response.status(400).json({ error: "human_user_required" });
      return;
    }
    if (wantsAgent && !agentId) {
      response.status(400).json({ error: "agent_required" });
      return;
    }

    const maxTasksInput = request.body.limit === undefined ? 4 : Number(request.body.limit);
    const maxTasks = Number.isFinite(maxTasksInput) ? Math.max(1, Math.min(12, Math.floor(maxTasksInput))) : 4;
    const useFixture = Boolean(request.body.useFixture);
    const reviewNotes = request.body.reviewNotes === undefined
      ? "Advanced through Steam app onboarding local run."
      : String(request.body.reviewNotes);
    const ladderOptions = {
      appid,
      useFixture,
      refresh: Boolean(request.body.refresh),
      gameName: request.body.gameName === undefined ? undefined : String(request.body.gameName),
      benchmarkFit: request.body.benchmarkFit === undefined ? undefined : Number(request.body.benchmarkFit),
      harnessRisk:
        request.body.harnessRisk === "low" || request.body.harnessRisk === "medium" || request.body.harnessRisk === "high"
          ? request.body.harnessRisk
          : undefined
    };
    const initialLadderPayload = await buildSteamAchievementLadderPayload(ladderOptions);
    const importable = initialLadderPayload.ladder.recommendedImports
      .filter((entry) => entry.recommendation === "import-candidate" && entry.importStatus === "new")
      .slice(0, maxTasks);
    const imported = importable.length > 0
      ? await store.upsertTaskCandidates(importable.map((entry) => entry.task), reviewNotes)
      : [];
    const publicationResult = await publishSteamTaskCandidates({
      appid,
      limit: maxTasks,
      reviewNotes,
      reviewApproved: request.body.reviewApproved === undefined ? true : Boolean(request.body.reviewApproved),
      forceReviewOverride: Boolean(request.body.forceReviewOverride),
      gameName: ladderOptions.gameName,
      benchmarkFit: ladderOptions.benchmarkFit,
      harnessRisk: ladderOptions.harnessRisk
    });

    const snapshot = await store.read();
    const human = humanUserId ? snapshot.users.find((user) => user.id === humanUserId && user.type === "human") : undefined;
    const agent = agentId ? snapshot.agents.find((entry) => entry.id === agentId) : undefined;
    if (humanUserId && !human) {
      response.status(404).json({ error: "human_user_not_found" });
      return;
    }
    if (agentId && !agent) {
      response.status(404).json({ error: "agent_not_found" });
      return;
    }

    const coverageRun = await runLocalGameCoverage({
      appid,
      side,
      human,
      agent,
      limit: maxTasks,
      apiBaseUrl: requestBaseUrl(request)
    });
    if (!coverageRun) {
      response.status(404).json({ error: "game_or_discovery_not_found" });
      return;
    }

    const refreshedSnapshot = await store.read();
    const discovery = refreshedSnapshot.steamAppDiscoveries.find((entry) => entry.appid === appid);
    const game = inferGameCatalogEntry({
      appid,
      name: ladderOptions.gameName ?? discovery?.name,
      benchmarkFit: ladderOptions.benchmarkFit ?? discovery?.benchmarkFit,
      harnessRisk: ladderOptions.harnessRisk ?? discovery?.harnessRisk
    });
    const tasks = await store.listTasks();
    const taskRegistry = await store.listTaskRegistry();
    const ladderPayload = await buildSteamAchievementLadderPayload({
      appid,
      useFixture,
      refresh: false,
      gameName: game.name,
      benchmarkFit: game.benchmarkFit,
      harnessRisk: game.harnessRisk
    });
    const blueprint = buildBenchmarkBlueprint({
      game,
      tasks,
      taskRegistry,
      discovery
    });
    const coveragePlan = buildGameCoveragePlan({
      game,
      snapshot: refreshedSnapshot,
      tasks,
      taskRegistry,
      human,
      agent,
      limit: maxTasks
    });
    const onboarding = buildSteamAppOnboardingPipeline({
      discovery,
      ladder: ladderPayload.ladder,
      blueprint,
      coveragePlan
    });
    const changed = imported.length > 0
      || publicationResult.publication.totals.published > 0
      || coverageRun.result.totals.completedRuns > 0;

    response.status(changed ? 201 : 200).json({
      run: {
        schemaVersion: "steambench.steam-app-onboarding-local-run.v1",
        appid,
        requestedSide: side,
        requestedLimit: maxTasks,
        steps: [
          {
            id: "import-recommended",
            status: imported.length > 0 ? "changed" : "skipped",
            imported: imported.length,
            skipped: initialLadderPayload.ladder.totals.achievements - imported.length
          },
          {
            id: "publish-candidates",
            status: publicationResult.publication.totals.published > 0
              ? "changed"
              : publicationResult.publication.totals.blocked > 0
                ? "blocked"
                : "skipped",
            published: publicationResult.publication.totals.published,
            blocked: publicationResult.publication.totals.blocked,
            alreadyActive: publicationResult.publication.totals.alreadyActive
          },
          {
            id: "coverage-local-run",
            status: coverageRun.result.totals.completedRuns > 0 ? "changed" : "skipped",
            completedRuns: coverageRun.result.totals.completedRuns,
            humanRuns: coverageRun.result.totals.humanRuns,
            agentRuns: coverageRun.result.totals.agentRuns,
            remainingHumanGaps: coverageRun.result.totals.remainingHumanGaps,
            remainingAgentGaps: coverageRun.result.totals.remainingAgentGaps
          }
        ],
        links: {
          onboarding: `/api/steam/apps/${appid}/onboarding`,
          coveragePlan: `/api/games/${appid}/coverage-plan`,
          coverageRun: coverageRun.result.links.coverageRun,
          coverageRuns: coverageRun.result.links.coverageRuns,
          evidenceBundle: coverageRun.result.links.evidenceBundle,
          resultCertificate: coverageRun.result.links.resultCertificate,
          standings: `/api/games/${appid}/standings`
        }
      },
      imported,
      publication: publicationResult.publication,
      coverage: coverageRun.result,
      onboarding,
      ladder: ladderPayload.ladder,
      blueprint,
      coveragePlan,
      policy: ladderPayload.policy,
      warning: ladderPayload.warning ?? initialLadderPayload.warning
    });
  });

  app.post("/api/steam/apps/:appid/import-achievements", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }

    const limit = request.body.limit === undefined ? 25 : Number(request.body.limit);
    try {
      response.status(201).json(await importSteamAchievementCandidates({
        appid,
        gameName: request.body.gameName === undefined ? undefined : String(request.body.gameName),
        benchmarkFit: request.body.benchmarkFit === undefined ? undefined : Number(request.body.benchmarkFit),
        harnessRisk:
          request.body.harnessRisk === "low" || request.body.harnessRisk === "medium" || request.body.harnessRisk === "high"
            ? request.body.harnessRisk
            : "medium",
        limit,
        useFixture: Boolean(request.body.useFixture),
        refresh: Boolean(request.body.refresh),
        reviewNotes: request.body.reviewNotes === undefined ? "Imported from Steam achievement metadata." : String(request.body.reviewNotes)
      }));
    } catch (error) {
      response.status(502).json({
        error: "steam_achievement_import_failed",
        message: error instanceof Error ? error.message : "Unknown Steam achievement import error"
      });
    }
  });

  app.post("/api/steam/apps/:appid/publish-candidates", async (request, response) => {
    const appid = Number(request.params.appid);
    if (!Number.isFinite(appid)) {
      response.status(400).json({ error: "invalid_appid" });
      return;
    }

    const result = await publishSteamTaskCandidates({
      appid,
      gameName: request.body.gameName === undefined ? undefined : String(request.body.gameName),
      benchmarkFit: request.body.benchmarkFit === undefined ? undefined : Number(request.body.benchmarkFit),
      harnessRisk:
        request.body.harnessRisk === "low" || request.body.harnessRisk === "medium" || request.body.harnessRisk === "high"
          ? request.body.harnessRisk
          : undefined,
      limit: request.body.limit === undefined ? 25 : Number(request.body.limit),
      reviewNotes: request.body.reviewNotes === undefined ? "" : String(request.body.reviewNotes),
      reviewApproved: Boolean(request.body.reviewApproved),
      forceReviewOverride: Boolean(request.body.forceReviewOverride)
    });

    response.status(result.publication.blocked.length === 0 ? 200 : result.publication.published.length > 0 ? 207 : 422).json(result);
  });

  app.post("/api/tasks/:taskId/status", async (request, response) => {
    const status = String(request.body.status ?? "");
    if (status !== "candidate" && status !== "active" && status !== "rejected") {
      response.status(400).json({ error: "invalid_task_status" });
      return;
    }

    const registryTask = (await store.listTaskRegistry()).find((entry) => entry.id === request.params.taskId);
    if (status === "active" && registryTask) {
      const review = buildTaskReview(registryTask);
      const reviewNotes = request.body.reviewNotes === undefined ? "" : String(request.body.reviewNotes).trim();
      const reviewApproved = Boolean(request.body.reviewApproved);
      const forceOverride = Boolean(request.body.forceReviewOverride);
      if (review.decision === "reject" && !forceOverride) {
        response.status(422).json({
          error: "task_review_rejected",
          review,
          message: "Rejected benchmark tasks require forceReviewOverride=true before publication."
        });
        return;
      }
      if (review.decision === "review-required" && (!reviewApproved || reviewNotes.length === 0)) {
        response.status(422).json({
          error: "task_review_required",
          review,
          message: "This task requires reviewApproved=true and non-empty reviewNotes before publication."
        });
        return;
      }
    }

    const task = await store.updateTaskRegistryStatus(
      request.params.taskId,
      status,
      request.body.reviewNotes === undefined ? undefined : String(request.body.reviewNotes)
    );
    if (!task) {
      response.status(404).json({ error: "task_not_found" });
      return;
    }
    response.json({ task });
  });

  return app;
}
