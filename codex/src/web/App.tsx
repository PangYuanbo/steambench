import {
  Activity,
  Ban,
  Bot,
  Cable,
  CheckCircle2,
  CircleGauge,
  Clock3,
  Eye,
  FileText,
  Filter,
  Gamepad2,
  Link2,
  LockKeyhole,
  Play,
  Radio,
  Search,
  ShieldCheck,
  Terminal,
  Trophy,
  UserRound
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RaceEligibility } from "../benchmark/eligibility";
import type { SeasonScope, SeasonSnapshot, Standings, TaskLeaderboard } from "../benchmark/standings";
import type { SuiteRaceLeaderboard, SuiteRaceStandings } from "../benchmark/suite-standings";
import type { BenchmarkSuite } from "../benchmark/suites";
import type { TaskReview } from "../benchmark/task-review";
import type { TaskReviewCatalog } from "../benchmark/task-review-catalog";
import type { BenchmarkTask, GameCatalogEntry, ScoreboardRow } from "../benchmark/types";
import type { RuntimeActionSpace } from "../runtime/action-space";
import type { RuntimeRunEvent } from "../runtime/events";
import { buildRuntimeRunPlan } from "../runtime/events";
import type { RuntimeGameAdapter } from "../runtime/game-adapters";
import type { RuntimeReadiness } from "../runtime/readiness";
import type { BroadcastCenter } from "../server/broadcast-center";
import type { AgentBenchmarkCampaignPlan } from "../server/agent-campaign";
import type { AgentBenchmarkCampaignReport } from "../server/agent-campaign-report";
import type { AgentCampaignStandings } from "../server/agent-campaign-standings";
import type { AgentRuntimeLab } from "../server/agent-runtime-lab";
import type { BenchmarkBlueprint } from "../server/benchmark-blueprint";
import type { CompetitionEventEvidenceBundleSummary } from "../server/competition-event-evidence-bundle";
import type { CompetitorProfile } from "../server/competitor-profile";
import type { GameBenchmarkProfile } from "../server/game-profile";
import type { HumanAgentComparison } from "../server/human-agent-comparison";
import type { HumanBenchmarkCampaignPlan } from "../server/human-campaign-plan";
import type { HumanSteamProofPlan } from "../server/human-steam-proof-plan";
import type { MatchFeed } from "../server/match-feed";
import type { CompetitionEventSummary } from "../server/competition-events";
import type { RunAuditSummary } from "../server/run-audit";
import type { SteamAchievementBenchmarkLadder } from "../server/steam-achievement-ladder";
import type { SteamAppOnboardingPipeline } from "../server/steam-app-onboarding";
import type { SteamProofFetchReport } from "../server/steam-proof-fetch-report";
import type { SuiteRaceAuditSummary } from "../server/suite-race-audit";
import type {
  AgentProfile,
  BenchmarkChallenge,
  BenchmarkMatch,
  BenchmarkRun,
  BenchmarkSuiteRace,
  CompetitionEventRegistration,
  GameCoverageRunRecord,
  LiveStreamSession,
  RunArtifact,
  RunProof,
  RuntimeControlSession,
  RuntimeDispatch,
  SteamAppDiscoveryCandidate,
  SteamLinkIntent,
  TaskRegistryEntry,
  UserAccount
} from "../server/store";

type CatalogPayload = {
  games: GameCatalogEntry[];
  adapters: RuntimeGameAdapter[];
  tasks: BenchmarkTask[];
  taskCandidates: TaskRegistryEntry[];
  taskRegistry: TaskRegistryEntry[];
  steamAppDiscoveries: SteamAppDiscoveryCandidate[];
  taskReviews: TaskReview[];
  taskReviewCatalog: TaskReviewCatalog;
  benchmarkSuites: BenchmarkSuite[];
  workerQueue: {
    queued: BenchmarkRun[];
    leased: BenchmarkRun[];
    expired: BenchmarkRun[];
  };
  runtimeDispatches: {
    dispatch: RuntimeDispatch;
    run?: BenchmarkRun;
    task?: BenchmarkTask;
    agent?: AgentProfile;
  }[];
  runtimeControlSessions?: RuntimeControlSessionEntry[];
  proofReviewQueue: {
    proof: RunProof;
    run?: BenchmarkRun;
    task?: BenchmarkTask;
  }[];
  auditSummaries: RunAuditSummary[];
  suiteRaceAuditSummaries: SuiteRaceAuditSummary[];
  manifestSummaries: {
    runId: string;
    taskId: string;
    schemaVersion: string;
    readiness: boolean;
    artifactName: string;
    launchProvider: string;
    runtimeProvider: string;
  }[];
  runtimeReadiness: {
    agentId: string;
    taskId: string;
    readiness: RuntimeReadiness;
  }[];
  raceEligibility: RaceEligibility[];
  users: UserAccount[];
  agents: AgentProfile[];
  agentRuntimeLabs: AgentRuntimeLab[];
  agentCampaigns: AgentBenchmarkCampaignReport[];
  gameCoverageRuns: {
    record: GameCoverageRunRecord;
    human?: UserAccount;
    agent?: AgentProfile;
    runs: {
      run?: BenchmarkRun;
      task?: BenchmarkTask;
      side?: "human" | "agent";
      links?: {
        audit: string;
        evidenceBundle: string;
        resultCertificate: string;
      };
    }[];
    links: {
      coveragePlan: string;
      gameCoverageRuns: string;
      standings: string;
      evidenceBundle: string;
      resultCertificate: string;
    };
  }[];
  agentCampaignStandings: AgentCampaignStandings;
  humanCampaignPlan?: HumanBenchmarkCampaignPlan | null;
  steamProofReport?: SteamProofFetchReport | null;
  humanAgentComparison?: HumanAgentComparison | null;
  challenges: {
    challenge: BenchmarkChallenge;
    task?: BenchmarkTask;
    human?: UserAccount;
    agent?: AgentProfile;
    match?: BenchmarkMatch;
  }[];
  matches: BenchmarkMatch[];
  suiteRaces: BenchmarkSuiteRace[];
  eventRegistrations: CompetitionEventRegistration[];
  steamLinks: SteamLinkIntent[];
  runs: BenchmarkRun[];
  events: RuntimeRunEvent[];
  artifacts: RunArtifact[];
  streams: LiveStreamSession[];
  proofs: RunProof[];
  scoreboard: ScoreboardRow[];
  standings: Standings;
  seasons: SeasonSnapshot[];
  matchFeed: MatchFeed;
  matchFeeds: MatchFeed[];
  leaderboards: TaskLeaderboard[];
  suiteRaceStandings: SuiteRaceStandings;
  suiteRaceLeaderboards: SuiteRaceLeaderboard[];
  competitionEvents: CompetitionEventSummary[];
  competitionEventBundleSummaries: CompetitionEventEvidenceBundleSummary[];
  competitorProfiles: CompetitorProfile[];
  broadcastCenter: BroadcastCenter;
  gameProfiles: GameBenchmarkProfile[];
  benchmarkBlueprints: BenchmarkBlueprint[];
  steamDataPolicy: {
    cache: {
      defaultTtlSeconds: number;
      entries: Array<{
        key: string;
        source: string;
        fetchedAt: string;
        expiresAt: string;
        ttlSeconds: number;
        expired: boolean;
      }>;
    };
    rateLimitPosture: string;
    userData: {
      steamWebApiKeyServerSideOnly: boolean;
      proofConsentRequiredBeforePublicRanking: boolean;
    };
  };
};

type ResultCertificateIndexKind =
  | "all"
  | "run"
  | "match"
  | "challenge"
  | "suite-race"
  | "agent-campaign"
  | "human-agent-comparison"
  | "competition-event"
  | "broadcast"
  | "game-competition"
  | "game-coverage-run";

type PublicCertificateEntry = {
  kind: Exclude<ResultCertificateIndexKind, "all">;
  id: string;
  title: string;
  generatedAt: string;
  status: string;
  verdict: string;
  readyForPublicShare: boolean;
  canonicalArtifactName: "output.mp4";
  fingerprint: string;
  verificationMethod: "sha256";
  participants: Array<{
    side: "human" | "agent" | "competitor";
    id: string;
    handle: string;
    displayName: string;
    score?: number;
  }>;
  tasks: Array<{
    id: string;
    appid: number;
    gameName: string;
    title: string;
    track: BenchmarkTask["track"];
    level: number;
    score: number;
  }>;
  result: {
    winner?: "human" | "agent" | "tie";
    margin?: number;
    score?: number;
    humanScore?: number;
    agentScore?: number;
    scoreboardRows: number;
  };
  links: Record<string, string>;
};

type PublicCertificateIndexPayload = {
  index: {
    schemaVersion: "steambench.result-certificate-index.v1";
    generatedAt: string;
    requested: {
      kind: ResultCertificateIndexKind;
      limit: number;
      readyForPublicShare: boolean;
    };
    totals: {
      certificates: number;
      readyForPublicShare: number;
      runs: number;
      matches: number;
      challenges: number;
      suiteRaces: number;
      agentCampaigns: number;
      humanAgentComparisons: number;
      competitionEvents: number;
      broadcasts: number;
      gameCompetitions: number;
      gameCoverageRuns: number;
      byKind: Record<string, number>;
    };
    certificates: PublicCertificateEntry[];
    links: {
      verify: string;
    };
  };
};

type PublicCompetitionHubPayload = {
  hub: {
    schemaVersion: "steambench.public-competition-hub.v1";
    scope: SeasonScope;
    canonicalArtifactName: "output.mp4";
    selected: {
      game: {
        appid: number;
        name: string;
        benchmarkFit?: number;
        harnessRisk?: string;
      };
      task: {
        id: string;
        appid: number;
        gameName: string;
        title: string;
        track: BenchmarkTask["track"];
        level: number;
        runnable: boolean;
      };
      actionSpace?: {
        permissions?: {
          inputMode?: string;
          transport?: string;
          allowedActionTypes?: string[];
          privilegedSystemInput?: boolean;
        };
        bridge?: {
          bridgeable?: boolean;
        };
      };
      raceEntry?: {
        readyForMatch?: boolean;
        human?: {
          status?: string;
          ready?: boolean;
        };
        agent?: {
          status?: string;
          ready?: boolean;
        };
        match?: {
          preflight?: {
            endpoint?: string;
          };
        };
      };
    };
    platform: {
      totals: {
        activeTasks: number;
        activeGames: number;
        proofConsentedHumans: number;
        activeAgents: number;
        scoreboardRows: number;
        broadcasts: number;
        shareReadyCertificates: number;
      };
    };
    games: Array<{
      appid: number;
      name: string;
      activeTasks: number;
      scoreboardRows: number;
      humanRows: number;
      agentRows: number;
      tracks: string[];
      links: {
        benchmarkPack: string;
        steamIntake: string;
      };
    }>;
    featuredTasks: Array<{
      id: string;
      appid: number;
      gameName: string;
      title: string;
      track: BenchmarkTask["track"];
      level: number;
      score: number;
      links: {
        raceEntry: string;
        actionSpace: string;
        runnerContract: string;
        scoreboard: string;
      };
    }>;
    broadcasts: {
      totals: {
        broadcasts: number;
        live?: number;
        scoreboardReady?: number;
      };
      featured?: {
        streamId: string;
        status: string;
        title: string;
        viewerCount: number;
        scoreboardReady: boolean;
        proofReady: boolean;
        links: {
          publicWatch: string;
        };
      };
    };
    entrypoints: {
      taskRaceEntryTemplate: string;
      agentOnboardingTemplate: string;
      humanProofPlanTemplate: string;
      steamIntakeTemplate: string;
      matchPreflight: string;
      publicWatchTemplate: string;
    };
    links: {
      selectedGamePack: string;
      selectedTaskRaceEntry: string;
      selectedTaskScoreboard: string;
      selectedTaskActionSpace: string;
      certificateIndex: string;
    };
  };
};

type ResultCertificateVerificationPayload = {
  verification: {
    schemaVersion: "steambench.result-certificate-verification.v1";
    valid: boolean;
    method: "sha256";
    expectedFingerprint?: string;
    actualFingerprint?: string;
    errors: string[];
    certificate?: {
      kind?: string;
      id?: string;
      readyForPublicShare?: boolean;
    };
  };
};

type RuntimeControlSessionEntry = {
  session: RuntimeControlSession;
  run?: BenchmarkRun;
  task?: BenchmarkTask;
  agent?: AgentProfile;
  links: {
    playbook: string;
    actionBatch: string;
    heartbeat: string;
    revoke: string;
    trace: string;
  };
};

type RuntimeControlSessionPayload = RuntimeControlSessionEntry & {
  schemaVersion: "steambench.runtime-control-session.v1";
};

type AchievementLadderPayload = {
  source: "fixture" | "steam-live";
  steamMeta?: unknown;
  warning?: string;
  ladder: SteamAchievementBenchmarkLadder;
};

type SteamAppOnboardingPayload = {
  onboarding: SteamAppOnboardingPipeline;
  ladder: SteamAchievementBenchmarkLadder;
};

type SteamAppOnboardingAdvancePayload = {
  advance: {
    schemaVersion: "steambench.steam-app-onboarding-advance.v1";
    steps: Array<{
      id: string;
      status: string;
    }>;
  };
  onboarding: SteamAppOnboardingPipeline;
  ladder: SteamAchievementBenchmarkLadder;
};

type SteamAppOnboardingLocalRunPayload = {
  run: {
    schemaVersion: "steambench.steam-app-onboarding-local-run.v1";
    steps: Array<{
      id: string;
      status: string;
      completedRuns?: number;
    }>;
  };
  coverage: {
    totals: {
      completedRuns: number;
      humanRuns: number;
      agentRuns: number;
      scoreboardReady: number;
    };
    links: {
      coverageRun: string;
      evidenceBundle: string;
      resultCertificate: string;
    };
  };
  onboarding: SteamAppOnboardingPipeline;
  ladder: SteamAchievementBenchmarkLadder;
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed ${response.status}: ${url}`);
  return response.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Request failed ${response.status}: ${url}`);
  return response.json() as Promise<T>;
}

function defaultMetricValue(task?: BenchmarkTask): number | undefined {
  if (!task?.targetValue) return undefined;
  const target = Number(task.targetValue.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0]);
  if (!Number.isFinite(target)) return undefined;
  const descriptor = `${task.metricName ?? ""} ${task.targetValue} ${task.scoringRule ?? ""}`.toLowerCase();
  return descriptor.includes("lower") || descriptor.includes("shorter") || descriptor.includes("seconds") || descriptor.includes("time")
    ? Math.round(target * 0.92)
    : Math.round(target * 1.05);
}

function formatCertificateKind(kind: string) {
  return kind.replaceAll("-", " ");
}

function shortFingerprint(value: string) {
  if (value.length <= 22) return value;
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function certificateAuditKey(entry: PublicCertificateEntry) {
  return `${entry.kind}:${entry.id}`;
}

export function App() {
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [publicHub, setPublicHub] = useState<PublicCompetitionHubPayload["hub"] | null>(null);
  const [publicHubStatus, setPublicHubStatus] = useState("Loading public competition hub");
  const [query, setQuery] = useState("");
  const [trackFilter, setTrackFilter] = useState<"all" | BenchmarkTask["suitability"]>("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [competitor, setCompetitor] = useState("Codex Runner");
  const [newHandle, setNewHandle] = useState("human-astra");
  const [agentHandle, setAgentHandle] = useState("codex-runner");
  const [importAppId, setImportAppId] = useState("620");
  const [discoverQuery, setDiscoverQuery] = useState("Portal");
  const [proposalTrack, setProposalTrack] = useState<"capture" | "leaderboard" | "stat">("capture");
  const [proposalTitle, setProposalTitle] = useState("Controlled Score Sprint");
  const [proposalMetric, setProposalMetric] = useState("score");
  const [proposalTarget, setProposalTarget] = useState("highest verified score");
  const [seasonScope, setSeasonScope] = useState<SeasonScope>("all");
  const [achievementLadder, setAchievementLadder] = useState<SteamAchievementBenchmarkLadder | null>(null);
  const [steamAppOnboarding, setSteamAppOnboarding] = useState<SteamAppOnboardingPipeline | null>(null);
  const [certificateKind, setCertificateKind] = useState<ResultCertificateIndexKind>("all");
  const [certificateIndex, setCertificateIndex] = useState<PublicCertificateIndexPayload["index"] | null>(null);
  const [certificateLoadStatus, setCertificateLoadStatus] = useState("Loading public certificate index");
  const [certificateAuditState, setCertificateAuditState] = useState<Record<string, "idle" | "checking" | "verified" | "failed">>({});
  const [status, setStatus] = useState("Ready");

  async function loadPublicHubFromState(state: CatalogPayload, taskId?: string, scope: SeasonScope = seasonScope) {
    const task = state.tasks.find((entry) => entry.id === taskId) ?? state.tasks[0];
    const params = new URLSearchParams();
    params.set("season", scope);
    params.set("provider", "external");
    params.set("limit", "8");
    if (task) {
      params.set("appid", String(task.appid));
      params.set("taskId", task.id);
    }
    try {
      const result = await readJson<PublicCompetitionHubPayload>(`/api/public/competition-hub?${params}`);
      setPublicHub(result.hub);
      setPublicHubStatus(`${result.hub.selected.game.name} · ${result.hub.selected.task.title}`);
    } catch (error) {
      setPublicHub(null);
      setPublicHubStatus(error instanceof Error ? error.message : "Public competition hub failed to load");
    }
  }

  const refreshState = async () => {
    const state = await readJson<CatalogPayload>("/api/state");
    setCatalog(state);
    const nextTaskId = selectedTaskId || state.tasks[0]?.id || "";
    setSelectedTaskId((existing) => existing || nextTaskId);
    await loadPublicHubFromState(state, nextTaskId);
  };

  async function loadCertificateIndex(kind: ResultCertificateIndexKind = certificateKind) {
    setCertificateLoadStatus("Loading public certificate index");
    const result = await readJson<PublicCertificateIndexPayload>(
      `/api/result-certificates?kind=${encodeURIComponent(kind)}&limit=12`
    );
    setCertificateIndex(result.index);
    setCertificateLoadStatus(`${result.index.certificates.length} share-ready certificates indexed`);
  }

  useEffect(() => {
    void refreshState();
  }, []);

  useEffect(() => {
    if (!catalog || !selectedTaskId) return;
    void loadPublicHubFromState(catalog, selectedTaskId, seasonScope);
  }, [catalog, selectedTaskId, seasonScope]);

  useEffect(() => {
    let cancelled = false;
    setCertificateLoadStatus("Loading public certificate index");
    void readJson<PublicCertificateIndexPayload>(
      `/api/result-certificates?kind=${encodeURIComponent(certificateKind)}&limit=12`
    )
      .then((result) => {
        if (cancelled) return;
        setCertificateIndex(result.index);
        setCertificateLoadStatus(`${result.index.certificates.length} share-ready certificates indexed`);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setCertificateIndex(null);
        setCertificateLoadStatus(error instanceof Error ? error.message : "Certificate index failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [certificateKind]);

  const tasks = catalog?.tasks ?? [];
  const taskCandidates = catalog?.taskCandidates ?? [];
  const taskRegistry = catalog?.taskRegistry ?? [];
  const steamAppDiscoveries = catalog?.steamAppDiscoveries ?? [];
  const taskReviews = catalog?.taskReviews ?? [];
  const taskReviewCatalog = catalog?.taskReviewCatalog;
  const benchmarkSuites = catalog?.benchmarkSuites ?? [];
  const benchmarkBlueprints = catalog?.benchmarkBlueprints ?? [];
  const reviewByTask = useMemo(() => new Map(taskReviews.map((review) => [review.taskId, review])), [taskReviews]);
  const filteredTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return tasks
      .filter((task) => trackFilter === "all" || task.suitability === trackFilter)
      .filter((task) => {
        if (!normalized) return true;
        return `${task.gameName} ${task.title} ${task.objective}`.toLowerCase().includes(normalized);
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 9);
  }, [query, tasks, trackFilter]);

  const topGames = catalog?.games ?? [];
  const gameProfiles = catalog?.gameProfiles ?? [];
  const runtimeAdapters = catalog?.adapters ?? [];
  const scoreboard = catalog?.scoreboard ?? [];
  const certificateEntries = certificateIndex?.certificates ?? [];
  const certificateKindOptions: ResultCertificateIndexKind[] = [
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
  ];
  const seasons = catalog?.seasons ?? [];
  const activeSeason = seasons.find((season) => season.window.scope === seasonScope);
  const matchFeeds = catalog?.matchFeeds ?? [];
  const activeMatchFeed = matchFeeds.find((feed) => feed.season.scope === seasonScope) ?? catalog?.matchFeed;
  const standings = activeSeason?.standings ?? catalog?.standings;
  const leaderboards = activeSeason?.leaderboards ?? catalog?.leaderboards ?? [];
  const suiteRaceStandings = catalog?.suiteRaceStandings;
  const suiteRaceLeaderboards = catalog?.suiteRaceLeaderboards ?? [];
  const competitionEvents = catalog?.competitionEvents ?? [];
  const activeCompetitionEvent = competitionEvents.find((event) => event.scope === seasonScope) ?? competitionEvents.find((event) => event.scope === "weekly");
  const competitionEventBundleSummaries = catalog?.competitionEventBundleSummaries ?? [];
  const activeCompetitionEventBundle = activeCompetitionEvent
    ? competitionEventBundleSummaries.find((summary) => summary.scope === activeCompetitionEvent.scope)
    : undefined;
  const eventRegistrations = catalog?.eventRegistrations ?? [];
  const runs = catalog?.runs ?? [];
  const events = catalog?.events ?? [];
  const artifacts = catalog?.artifacts ?? [];
  const streams = catalog?.streams ?? [];
  const latestStream = streams[0];
  const broadcastCenter = catalog?.broadcastCenter;
  const proofs = catalog?.proofs ?? [];
  const workerQueue = catalog?.workerQueue ?? { queued: [], leased: [], expired: [] };
  const runtimeDispatches = catalog?.runtimeDispatches ?? [];
  const proofReviewQueue = catalog?.proofReviewQueue ?? [];
  const auditSummaries = catalog?.auditSummaries ?? [];
  const suiteRaceAuditSummaries = catalog?.suiteRaceAuditSummaries ?? [];
  const manifestSummaries = catalog?.manifestSummaries ?? [];
  const runtimeReadiness = catalog?.runtimeReadiness ?? [];
  const raceEligibility = catalog?.raceEligibility ?? [];
  const users = catalog?.users ?? [];
  const agents = catalog?.agents ?? [];
  const agentRuntimeLabs = catalog?.agentRuntimeLabs ?? [];
  const agentCampaigns = catalog?.agentCampaigns ?? [];
  const gameCoverageRuns = catalog?.gameCoverageRuns ?? [];
  const agentCampaignStandings = catalog?.agentCampaignStandings;
  const humanCampaignPlan = catalog?.humanCampaignPlan;
  const steamProofReport = catalog?.steamProofReport;
  const humanAgentComparison = catalog?.humanAgentComparison;
  const challenges = catalog?.challenges ?? [];
  const matches = catalog?.matches ?? [];
  const suiteRaces = catalog?.suiteRaces ?? [];
  const competitorProfiles = catalog?.competitorProfiles ?? [];
  const steamDataPolicy = catalog?.steamDataPolicy;
  const latestSteamLink = catalog?.steamLinks[0];
  const importableSteamDiscovery = steamAppDiscoveries.find((entry) => entry.status !== "imported" && entry.estimatedAchievementTasks > 0) ?? steamAppDiscoveries[0];
  const importAppCandidateCount = taskCandidates.filter((candidate) => String(candidate.appid) === importAppId.trim()).length;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const activeAgent = agents.find((agent) => agent.status === "active");
  const taskPlans = useMemo(() => tasks.map((task) => ({ task, plan: buildRuntimeRunPlan(task) })), [tasks]);
  const controllerTaskPlans = useMemo(
    () => taskPlans.filter((entry) => entry.plan.controlSurface === "controller"),
    [taskPlans]
  );
  const selectedTaskPlan = selectedTask ? buildRuntimeRunPlan(selectedTask) : undefined;
  const selectedControllerPlan = selectedTaskPlan?.controlSurface === "controller"
    ? { task: selectedTask, plan: selectedTaskPlan }
    : controllerTaskPlans[0];
  const runtimeControlSessions = catalog?.runtimeControlSessions ?? [];
  const activeControlSession = runtimeControlSessions.find((entry) => entry.session.status === "active");
  const controlActionSpace: RuntimeActionSpace | undefined = activeControlSession?.session.actionSpace ?? selectedControllerPlan?.plan.actionSpace;
  const controlTask = activeControlSession?.task ?? selectedControllerPlan?.task;
  const controlRun = activeControlSession?.run ?? runs.find((run) => run.competitorType === "agent" && run.taskId === controlTask?.id);
  const bridgeReady = activeControlSession?.session.status === "active";
  const controllerReportEvents = events
    .filter((event) => event.metadata?.executorReport === "steambench.controller-executor-report.v1")
    .filter((event) => !controlRun || event.runId === controlRun.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latestControllerReport = controllerReportEvents.at(-1);
  const normalizedControllerActions = [
    ...(controlActionSpace?.controller?.buttons ?? []),
    ...(controlActionSpace?.controller?.sticks ?? []),
    ...(controlActionSpace?.controller?.triggers ?? [])
  ].slice(0, 14);
  const forbiddenActionCount = controlActionSpace?.constraints.forbiddenActions.length ?? 0;
  const leaseExpiry = activeControlSession?.session.expiresAt
    ? new Date(activeControlSession.session.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "not issued";
  const canonicalArtifacts = artifacts.filter((artifact) => artifact.canonical && artifact.name === "output.mp4").length;
  const importAppIdNumber = Number(importAppId);
  const readinessByTask = useMemo(() => {
    const entries = runtimeReadiness.filter((entry) => !activeAgent || entry.agentId === activeAgent.id);
    return new Map(entries.map((entry) => [entry.taskId, entry.readiness]));
  }, [activeAgent, runtimeReadiness]);
  const steamLinkedHuman = users.find((user) => user.type === "human" && user.linkedSteamId);
  const linkedHuman = users.find((user) => user.type === "human" && user.linkedSteamId && user.proofConsentAt);
  const latestAppCoverageRun = Number.isFinite(importAppIdNumber)
    ? gameCoverageRuns.find((entry) => entry.record.appid === importAppIdNumber)
    : undefined;
  const nextOnboardingStage = steamAppOnboarding?.stages.find((stage) => stage.status !== "complete") ?? steamAppOnboarding?.stages.at(-1);
  const readyOnboardingActions = steamAppOnboarding?.stages.filter((stage) => stage.status === "ready").length ?? 0;
  const activeHumanRegistration = activeCompetitionEvent && linkedHuman
    ? eventRegistrations.find(
        (registration) =>
          registration.eventScope === activeCompetitionEvent.scope &&
          registration.participantType === "human" &&
          registration.participantId === linkedHuman.id &&
          registration.status === "registered"
      )
    : undefined;
  const activeAgentRegistration = activeCompetitionEvent && activeAgent
    ? eventRegistrations.find(
        (registration) =>
          registration.eventScope === activeCompetitionEvent.scope &&
          registration.participantType === "agent" &&
          registration.participantId === activeAgent.id &&
          registration.status === "registered"
      )
    : undefined;
  const decidedMatchups = (standings?.totals.humanWins ?? 0) + (standings?.totals.agentWins ?? 0) + (standings?.totals.ties ?? 0);
  const agentWinRate = decidedMatchups > 0 ? Math.round(((standings?.totals.agentWins ?? 0) / decidedMatchups) * 100) : 0;
  const humanWinRate = decidedMatchups > 0 ? Math.round(((standings?.totals.humanWins ?? 0) / decidedMatchups) * 100) : 0;
  const hubSelected = publicHub?.selected;
  const hubTotals = publicHub?.platform.totals;
  const hubRaceEntry = hubSelected?.raceEntry;
  const hubActionSpace = hubSelected?.actionSpace;
  const hubFeaturedTasks = publicHub?.featuredTasks ?? [];
  const hubTopGames = publicHub?.games ?? [];
  const hubBroadcast = publicHub?.broadcasts.featured;

  async function createSteamLink() {
    setStatus("Creating Steam link intent");
    const result = await postJson<{ intent: SteamLinkIntent; openIdUrl: string }>("/api/steam/link-intents", {
      returnUrl: window.location.origin,
      userId: users[0]?.id
    });
    setStatus(`Steam OpenID URL generated for state ${result.intent.state}`);
    await refreshState();
  }

  async function completeMockSteamLink() {
    if (!latestSteamLink) return;
    const linked = await postJson<{ intent: SteamLinkIntent }>(`/api/steam/link-intents/${latestSteamLink.state}/mock-complete`, {
      steamid: "76561198000000000"
    });
    if (linked.intent.userId) {
      await postJson(`/api/users/${linked.intent.userId}/steam-proof-consent`, {
        consented: true
      });
    }
    setStatus("Local Steam link completed with mock SteamID");
    await refreshState();
  }

  async function consentSteamProof() {
    const user = steamLinkedHuman ?? users.find((entry) => entry.type === "human");
    if (!user) {
      setStatus("Register and bind a human before proof consent");
      return;
    }
    if (!user.linkedSteamId) {
      setStatus("Bind Steam before proof consent");
      return;
    }
    await postJson(`/api/users/${user.id}/steam-proof-consent`, {
      consented: true
    });
    setStatus(`${user.handle} consented to Steam proof ranking`);
    await refreshState();
  }

  async function createRuntimeRun() {
    if (!selectedTaskId) return;
    setStatus("Creating runtime run");
    const created = await postJson<{ run: BenchmarkRun }>("/api/runs", {
      taskId: selectedTaskId,
      competitor,
      competitorType: "agent"
    });
    await postJson(`/api/runs/${created.run.id}/simulate-agent`, {});
    setStatus("Run simulated, event-audited, and scored with output.mp4 artifact proof");
    await refreshState();
  }

  async function grantControllerLease() {
    if (!activeAgent) {
      setStatus("Register an active agent before granting controller input");
      return;
    }
    const targetTask = selectedControllerPlan?.task;
    if (!targetTask) {
      setStatus("No controller task is available for a virtual gamepad lease");
      return;
    }
    setStatus(`Granting controller lease for ${targetTask.gameName}`);
    const created = await postJson<{ run: BenchmarkRun }>("/api/runs", {
      taskId: targetTask.id,
      competitor: `agent:${activeAgent.handle}`,
      competitorType: "agent",
      runtimeProvider: activeAgent.runtimeProvider
    });
    const lease = await postJson<RuntimeControlSessionPayload>(`/api/runs/${created.run.id}/control-sessions`, {
      agentId: activeAgent.id,
      ttlSeconds: 900,
      idempotencyKey: `dashboard:${created.run.id}:controller`
    });
    setSelectedTaskId(targetTask.id);
    setStatus(`Controller lease active: ${lease.session.id}`);
    await refreshState();
  }

  async function createAgentProfile() {
    setStatus("Registering runtime agent");
    const created = await postJson<{ agent: AgentProfile }>("/api/agents", {
      handle: agentHandle,
      displayName: agentHandle,
      provider: "local",
      command: `node scripts/runtime-worker.mjs --agent=${agentHandle}`,
      capabilities: ["keyboard-mouse", "controller", "turn-based-actions", "screen-capture", "stats-screen", "action-log", "seeded-save", "manual-review", "output.mp4"]
    });
    setCompetitor(`agent:${created.agent.handle}`);
    setStatus(`Agent ${created.agent.handle} registered`);
    await refreshState();
  }

  async function queueAgentProfileRun() {
    if (!selectedTaskId || !activeAgent) {
      setStatus("Register an active agent before queueing an agent profile run");
      return;
    }
    setStatus(`Queueing ${activeAgent.handle}`);
    const created = await postJson<{ run: BenchmarkRun }>(`/api/agents/${activeAgent.id}/runs`, {
      taskId: selectedTaskId
    });
    await readJson(`/api/runs/${created.run.id}/runtime-package?agentId=${activeAgent.id}`);
    await postJson(`/api/runs/${created.run.id}/simulate-agent`, {});
    setStatus(`Agent ${activeAgent.handle} ran with a runtime package`);
    await refreshState();
  }

  async function runFirstAgentLabTask() {
    const lab = agentRuntimeLabs.find((entry) => entry.status === "ready");
    const recommendation = lab?.recommendedTasks.find((entry) => entry.priority === "ready" && entry.readiness.ready);
    if (!lab || !recommendation) {
      setStatus("No agent lab has a ready recommended task");
      return;
    }
    setStatus(`Running ${lab.agent.handle} lab task`);
    const created = await postJson<{ run: BenchmarkRun }>(`/api/agents/${lab.agent.id}/runs`, {
      taskId: recommendation.task.id
    });
    await readJson(`/api/agents/${lab.agent.id}/lab`);
    await readJson(`/api/runs/${created.run.id}/runtime-package?agentId=${lab.agent.id}`);
    await postJson(`/api/runs/${created.run.id}/simulate-agent`, {});
    setStatus(`Agent lab run scored ${recommendation.task.title}`);
    await refreshState();
  }

  async function startAgentCampaign() {
    if (!activeAgent) {
      setStatus("Register an active agent before starting a campaign");
      return;
    }
    setStatus(`Planning ${activeAgent.handle} benchmark campaign`);
    const result = await postJson<{
      campaign: AgentBenchmarkCampaignPlan & {
        id?: string;
        report?: AgentBenchmarkCampaignReport;
        runCount: number;
        dispatchCount: number;
      };
    }>(`/api/agents/${activeAgent.id}/campaigns`, {
      limit: 3,
      provider: "local",
      dispatch: true
    });
    setStatus(`Campaign queued ${result.campaign.runCount} runs and ${result.campaign.dispatchCount} dispatches`);
    await refreshState();
  }

  async function dispatchFirstQueuedRun(provider: "local" | "modal" = "local") {
    const run = workerQueue.queued.find((entry) => entry.competitorType === "agent") ?? workerQueue.queued[0];
    if (!run) {
      setStatus("No queued run is ready for dispatch");
      return;
    }
    const agent = agents.find((entry) => run.competitor === `agent:${entry.handle}` || run.competitor === entry.handle);
    const result = await postJson<{ dispatch: RuntimeDispatch }>(`/api/runs/${run.id}/dispatch`, {
      provider,
      agentId: agent?.id,
      workerId: `${provider}-dashboard-worker-${run.id}`
    });
    setStatus(`${provider} dispatch planned: ${result.dispatch.workerId}`);
    await refreshState();
  }

  async function runLatestAgentCampaign() {
    const campaign = agentCampaigns.find((entry) => entry.status !== "scoreboard-ready") ?? agentCampaigns[0];
    if (!campaign) {
      setStatus("Create an agent campaign before running one locally");
      return;
    }
    setStatus(`Running campaign ${campaign.campaign.id}`);
    const result = await postJson<{ report: AgentBenchmarkCampaignReport }>(`/api/campaigns/${campaign.campaign.id}/run-local`, {});
    setStatus(`Campaign ${result.report.status}: ${result.report.totals.scored}/${result.report.totals.tasks} scored`);
    await refreshState();
  }

  async function createHeadToHeadMatch() {
    if (!selectedTaskId || !linkedHuman || !activeAgent) {
      setStatus("Register a linked human and active agent before creating a match");
      return;
    }
    setStatus("Creating head-to-head match");
    const created = await postJson<{ match: BenchmarkMatch }>("/api/matches", {
      taskId: selectedTaskId,
      humanUserId: linkedHuman.id,
      agentId: activeAgent.id
    });
    const resolved = await postJson<{ match: BenchmarkMatch }>(`/api/matches/${created.match.id}/run-local`, {});
    setStatus(`Match ${resolved.match.id} scored: ${resolved.match.winner ?? "pending"}`);
    await refreshState();
  }

  async function createChallenge() {
    if (!selectedTaskId || !linkedHuman || !activeAgent) {
      setStatus("Register a linked human and active agent before creating a challenge");
      return;
    }
    setStatus("Creating challenge");
    const created = await postJson<{ challenge: BenchmarkChallenge }>("/api/challenges", {
      taskId: selectedTaskId,
      humanUserId: linkedHuman.id,
      agentId: activeAgent.id,
      createdBy: "human",
      createdById: linkedHuman.id,
      summary: `${linkedHuman.handle} challenged ${activeAgent.handle}.`,
      reviewApproved: true
    });
    setStatus(`Challenge ${created.challenge.id} opened`);
    await refreshState();
  }

  async function runFirstChallenge() {
    const entry = challenges.find((item) => item.challenge.status === "open" || item.challenge.status === "accepted");
    if (!entry) {
      setStatus("No open challenge is ready to run");
      return;
    }
    const result = await postJson<{ challenge: BenchmarkChallenge; match?: BenchmarkMatch }>(`/api/challenges/${entry.challenge.id}/run-local`, {});
    setStatus(`Challenge ${result.challenge.id} ${result.challenge.status}${result.match?.winner ? `: ${result.match.winner}` : ""}`);
    await refreshState();
  }

  async function runBenchmarkSuite() {
    if (!linkedHuman || !activeAgent) {
      setStatus("Register a linked human and active agent before running a suite");
      return;
    }
    const suite = benchmarkSuites.find((entry) => entry.status === "ranked-ready") ?? benchmarkSuites[0];
    if (!suite) {
      setStatus("No benchmark suite is available");
      return;
    }
    setStatus(`Running ${suite.title}`);
    const created = await postJson<{ race: BenchmarkSuiteRace }>(`/api/benchmark-suites/${suite.id}/races`, {
      humanUserId: linkedHuman.id,
      agentId: activeAgent.id
    });
    const resolved = await postJson<{
      race: BenchmarkSuiteRace;
      bundle: {
        integrity: {
          verdict: string;
          allChildRunsScoreboardReady: boolean;
        };
      };
    }>(`/api/suite-races/${created.race.id}/run-local`, {});
    setStatus(`Suite ${resolved.race.title} ${resolved.bundle.integrity.verdict}: ${resolved.race.winner ?? "pending"}`);
    await refreshState();
  }

  async function registerActiveEventParticipant(participantType: "human" | "agent") {
    const scope = activeCompetitionEvent?.scope ?? seasonScope;
    const participantId = participantType === "human" ? linkedHuman?.id : activeAgent?.id;
    if (!participantId) {
      setStatus(participantType === "human" ? "Bind Steam and consent before event registration" : "Register an active agent before event registration");
      return;
    }
    const result = await postJson<{ registration: CompetitionEventRegistration }>(`/api/competition-events/${scope}/register`, {
      participantType,
      participantId
    });
    setStatus(`${participantType === "human" ? "Human" : "Agent"} registered for ${result.registration.eventScope}`);
    await refreshState();
  }

  async function scheduleActiveEventSuite() {
    const scope = activeCompetitionEvent?.scope ?? seasonScope;
    const suite = benchmarkSuites.find((entry) => entry.status === "ranked-ready") ?? benchmarkSuites[0];
    if (!suite) {
      setStatus("No benchmark suite is available for event scheduling");
      return;
    }
    const result = await postJson<{
      schedule: {
        scheduled: unknown[];
        skipped: unknown[];
        blocked: unknown[];
      };
    }>(`/api/competition-events/${scope}/schedule-suite`, {
      suiteId: suite.id
    });
    setStatus(`Event schedule: ${result.schedule.scheduled.length} created, ${result.schedule.skipped.length} skipped, ${result.schedule.blocked.length} blocked`);
    await refreshState();
  }

  async function runActiveEventSuite() {
    const scope = activeCompetitionEvent?.scope ?? seasonScope;
    const suite = benchmarkSuites.find((entry) => entry.status === "ranked-ready") ?? benchmarkSuites[0];
    if (!suite) {
      setStatus("No benchmark suite is available for event execution");
      return;
    }
    const result = await postJson<{
      run: {
        executed: unknown[];
        incomplete: unknown[];
        candidateCount: number;
      };
    }>(`/api/competition-events/${scope}/run-suite`, {
      suiteId: suite.id,
      maxRaces: 3
    });
    setStatus(`Event run: ${result.run.executed.length}/${result.run.candidateCount} completed, ${result.run.incomplete.length} incomplete`);
    await refreshState();
  }

  async function runActiveEventCampaignComparisons() {
    const scope = activeCompetitionEvent?.scope ?? seasonScope;
    const result = await postJson<{
      run: {
        executed: unknown[];
        incomplete: unknown[];
        missingCampaigns: unknown[];
        candidatePairs: number;
      };
    }>(`/api/competition-events/${scope}/run-campaign-comparisons-local`, {
      maxPairs: 6
    });
    setStatus(`Event campaigns: ${result.run.executed.length}/${result.run.candidatePairs} ready, ${result.run.incomplete.length} incomplete, ${result.run.missingCampaigns.length} missing campaigns`);
    await refreshState();
  }

  async function submitHumanProofRun() {
    if (!selectedTaskId || !linkedHuman) {
      setStatus("Register and bind a human Steam user before submitting proof");
      return;
    }
    setStatus("Creating human submission");
    const created = await postJson<{ run: BenchmarkRun }>(`/api/users/${linkedHuman.id}/runs`, {
      taskId: selectedTaskId
    });
    const submission = await postJson<{
      receipt: {
        scoreboardReady: boolean;
      };
      run?: BenchmarkRun;
    }>(`/api/runs/${created.run.id}/submission`, {
      artifactPath: "output/output.mp4",
      userId: linkedHuman.id,
      allowMock: selectedTask?.track === "achievement",
      metricValue: selectedTask?.track === "achievement" ? undefined : defaultMetricValue(selectedTask),
      summary: `Dashboard submission for ${selectedTask?.title ?? "selected task"}.`
    });
    setStatus(submission.receipt.scoreboardReady ? "Submission scored with output.mp4 receipt" : "Submission captured but still needs review");
    await refreshState();
  }

  async function submitPlannedSteamProofRun() {
    if (!linkedHuman) {
      setStatus("Link Steam and grant proof consent before planned proof submission");
      return;
    }
    const result = await postJson<{
      submission: {
        runId: string;
        scoreboardReady: boolean;
      };
      plan: HumanSteamProofPlan;
    }>(`/api/users/${linkedHuman.id}/steam-proof-submissions`, {
      taskId: selectedTaskId
    });
    setStatus(`Steam proof plan submitted ${result.submission.runId}: ${result.submission.scoreboardReady ? "scoreboard-ready" : "needs review"}`);
    await refreshState();
  }

  async function runHumanCampaignPack() {
    if (!linkedHuman || !humanCampaignPlan?.source.campaignId) {
      setStatus("Create an agent campaign and link a human before running the human pack");
      return;
    }
    const result = await postJson<{
      schemaVersion: "steambench.human-campaign-run.v1";
      submissions: Array<{ runId: string; scoreboardReady: boolean }>;
      planAfter?: HumanBenchmarkCampaignPlan;
      certificate?: { integrity: { readyForPublicShare: boolean } };
    }>(`/api/users/${linkedHuman.id}/human-campaigns/run-local`, {
      campaignId: humanCampaignPlan.source.campaignId
    });
    setStatus(`Human pack ${result.planAfter?.status ?? "updated"}: ${result.submissions.length} submissions, ${result.planAfter?.totals.alreadyScored ?? 0}/${result.planAfter?.totals.tasks ?? 0} scored`);
    await refreshState();
  }

  async function createHumanUser() {
    setStatus("Registering human competitor");
    const created = await postJson<{ user: UserAccount }>("/api/users", {
      handle: newHandle,
      displayName: newHandle,
      type: "human"
    });
    await postJson(`/api/users/${created.user.id}/steam`, {
      steamid: "76561198000000000",
      proofConsent: true
    });
    setCompetitor(`human:${created.user.handle}`);
    setStatus("Human competitor registered and linked to a SteamID");
    await refreshState();
  }

  async function importSteamTasks() {
    setStatus(`Importing Steam achievements for app ${importAppId}`);
    const result = await postJson<{ imported: TaskRegistryEntry[] }>(`/api/steam/apps/${encodeURIComponent(importAppId)}/import-achievements`, {
      useFixture: importAppId === "620",
      limit: 4,
      reviewNotes: "Imported from dashboard review flow"
    });
    setStatus(`Imported ${result.imported.length} task candidates`);
    await refreshState();
  }

  async function discoverSteamApps() {
    setStatus(`Discovering Steam apps for ${discoverQuery}`);
    const result = await postJson<{ discoveries: SteamAppDiscoveryCandidate[] }>("/api/steam/apps/discover", {
      query: discoverQuery,
      limit: 6,
      useFixture: true
    });
    setStatus(`Discovered ${result.discoveries.length} Steam app candidate(s)`);
    await refreshState();
  }

  async function importFirstDiscovery() {
    const discovery = importableSteamDiscovery;
    if (!discovery) return;
    const result = await postJson<{ imported: TaskRegistryEntry[] }>(
      `/api/steam/apps/discovery/${encodeURIComponent(discovery.id)}/import-achievements`,
      {
        useFixture: discovery.source === "fixture",
        limit: 4,
        reviewNotes: `Imported from dashboard discovery flow for ${discovery.name}`
      }
    );
    setStatus(`Imported ${result.imported.length} task candidate(s) from ${discovery.name}`);
    await refreshState();
  }

  async function proposeManualTask() {
    setStatus(`Proposing ${proposalTrack} benchmark task for app ${importAppId}`);
    const result = await postJson<{ task: TaskRegistryEntry; review: TaskReview }>(
      `/api/steam/apps/${encodeURIComponent(importAppId)}/task-proposals`,
      {
        title: proposalTitle,
        track: proposalTrack,
        level: proposalTrack === "leaderboard" ? 7 : 5,
        targetValue: proposalTarget,
        metricName: proposalMetric,
        objective: `Complete ${proposalTitle} in Steam app ${importAppId} and submit reviewable metric proof.`,
        estimatedRuntimeMinutes: proposalTrack === "leaderboard" ? 45 : 20,
        scoringRule:
          proposalTrack === "capture"
            ? `Pass when ${proposalMetric} reaches ${proposalTarget}; rank lower verified time or stronger completion evidence higher.`
            : `Rank by ${proposalTarget} for verified ${proposalMetric}.`,
        reviewNotes: "Proposed from dashboard non-achievement task design"
      }
    );
    setStatus(`Proposed ${result.task.title} with ${result.review.decision} review state`);
    await refreshState();
  }

  async function publishFirstCandidate() {
    const candidate = taskCandidates[0];
    if (!candidate) return;
    const review = reviewByTask.get(candidate.id);
    await postJson(`/api/tasks/${encodeURIComponent(candidate.id)}/status`, {
      status: "active",
      reviewApproved: review?.decision !== "ranked-ready",
      reviewNotes:
        review?.decision === "ranked-ready"
          ? "Published from dashboard review flow"
          : `Dashboard review accepted ${review?.decision ?? "review-required"} task with ${review?.risks.length ?? 0} risks.`
    });
    setStatus(`Published ${candidate.title}`);
    await refreshState();
  }

  async function publishAppCandidates() {
    setStatus(`Publishing review-cleared candidates for app ${importAppId}`);
    const result = await postJson<{
      publication: {
        totals: {
          published: number;
          blocked: number;
          alreadyActive: number;
        };
      };
    }>(`/api/steam/apps/${encodeURIComponent(importAppId)}/publish-candidates`, {
      limit: 12,
      reviewApproved: true,
      reviewNotes: `Dashboard bulk publication for Steam app ${importAppId}`
    });
    setStatus(`Published ${result.publication.totals.published} app task(s), ${result.publication.totals.blocked} blocked, ${result.publication.totals.alreadyActive} already active`);
    await refreshState();
  }

  function openGameCoveragePlan() {
    window.open(`/api/games/${encodeURIComponent(importAppId)}/coverage-plan`, "_blank", "noreferrer");
  }

  function openAchievementLadder() {
    window.open(`/api/steam/apps/${encodeURIComponent(importAppId)}/achievement-ladder`, "_blank", "noreferrer");
  }

  async function loadAchievementLadder() {
    setStatus(`Loading achievement ladder for app ${importAppId}`);
    const useFixture = importAppId.trim() === "620" ? "?useFixture=true" : "";
    const result = await readJson<AchievementLadderPayload>(
      `/api/steam/apps/${encodeURIComponent(importAppId)}/achievement-ladder${useFixture}`
    );
    setAchievementLadder(result.ladder);
    setStatus(`Loaded ${result.ladder.totals.achievements} achievements: ${result.ladder.totals.recommendedImports} import recommendation(s)`);
  }

  async function importRecommendedAchievements() {
    if (!achievementLadder) {
      await loadAchievementLadder();
    }
    setStatus(`Importing recommended achievements for app ${importAppId}`);
    const result = await postJson<{
      importRun: {
        totals: {
          imported: number;
          skipped: number;
          recommended: number;
        };
      };
      ladder: SteamAchievementBenchmarkLadder;
    }>(`/api/steam/apps/${encodeURIComponent(importAppId)}/achievement-ladder/import-recommended`, {
      useFixture: importAppId.trim() === "620",
      limit: 12,
      reviewNotes: `Dashboard imported recommended achievement ladder tasks for Steam app ${importAppId}`
    });
    setAchievementLadder(result.ladder);
    setStatus(`Recommended import: ${result.importRun.totals.imported} imported, ${result.importRun.totals.skipped} skipped, ${result.importRun.totals.recommended} recommended`);
    await refreshState();
  }

  async function loadSteamAppOnboarding() {
    setStatus(`Loading onboarding pipeline for app ${importAppId}`);
    const params = new URLSearchParams();
    if (importAppId.trim() === "620") params.set("useFixture", "true");
    if (linkedHuman) params.set("humanUserId", linkedHuman.id);
    if (activeAgent) params.set("agentId", activeAgent.id);
    const query = params.toString();
    const result = await readJson<SteamAppOnboardingPayload>(
      `/api/steam/apps/${encodeURIComponent(importAppId)}/onboarding${query ? `?${query}` : ""}`
    );
    setAchievementLadder(result.ladder);
    setSteamAppOnboarding(result.onboarding);
    setStatus(`Onboarding ${result.onboarding.status}: ${result.onboarding.nextActions.length} next action(s)`);
  }

  async function advanceSteamAppOnboarding() {
    setStatus(`Advancing onboarding for app ${importAppId}`);
    const result = await postJson<SteamAppOnboardingAdvancePayload>(
      `/api/steam/apps/${encodeURIComponent(importAppId)}/onboarding/advance`,
      {
        useFixture: importAppId.trim() === "620",
        limit: 12,
        reviewApproved: true,
        reviewNotes: `Dashboard advanced Steam app ${importAppId} onboarding`,
        humanUserId: linkedHuman?.id,
        agentId: activeAgent?.id
      }
    );
    setAchievementLadder(result.ladder);
    setSteamAppOnboarding(result.onboarding);
    setStatus(`Advanced onboarding: ${result.advance.steps.map((step) => `${step.id} ${step.status}`).join(", ")}`);
    await refreshState();
  }

  async function runSteamAppOnboardingLocal() {
    if (!linkedHuman || !activeAgent) {
      setStatus("Link a consented human and register an active agent before running onboarding locally");
      return;
    }
    setStatus(`Running onboarding local match for app ${importAppId}`);
    const result = await postJson<SteamAppOnboardingLocalRunPayload>(
      `/api/steam/apps/${encodeURIComponent(importAppId)}/onboarding/run-local`,
      {
        useFixture: importAppId.trim() === "620",
        limit: 4,
        reviewApproved: true,
        reviewNotes: `Dashboard ran Steam app ${importAppId} onboarding locally`,
        humanUserId: linkedHuman.id,
        agentId: activeAgent.id
      }
    );
    setAchievementLadder(result.ladder);
    setSteamAppOnboarding(result.onboarding);
    setStatus(`Local match: ${result.coverage.totals.completedRuns} run(s), ${result.coverage.totals.scoreboardReady} scoreboard-ready`);
    await refreshState();
  }

  async function scheduleGameCoverage() {
    if (!linkedHuman || !activeAgent) {
      setStatus("Link a consented human and register an active agent before scheduling game coverage");
      return;
    }
    setStatus(`Scheduling missing coverage for app ${importAppId}`);
    const result = await postJson<{
      schedule: {
        totals: {
          queuedRuns: number;
          humanRuns: number;
          agentRuns: number;
          dispatches: number;
        };
      };
    }>(`/api/games/${encodeURIComponent(importAppId)}/coverage-plan/schedule`, {
      humanUserId: linkedHuman.id,
      agentId: activeAgent.id,
      limit: 4,
      provider: "local",
      dispatch: true
    });
    setStatus(`Queued ${result.schedule.totals.queuedRuns} coverage run(s): ${result.schedule.totals.humanRuns} human, ${result.schedule.totals.agentRuns} agent, ${result.schedule.totals.dispatches} dispatches`);
    await refreshState();
  }

  async function runGameCoverageLocal() {
    if (!linkedHuman || !activeAgent) {
      setStatus("Link a consented human and register an active agent before running local game coverage");
      return;
    }
    setStatus(`Running local coverage for app ${importAppId}`);
    const result = await postJson<{
      result: {
        totals: {
          completedRuns: number;
          humanRuns: number;
          agentRuns: number;
          scoreboardReady: number;
        };
      };
    }>(`/api/games/${encodeURIComponent(importAppId)}/coverage-plan/run-local`, {
      humanUserId: linkedHuman.id,
      agentId: activeAgent.id,
      limit: 4
    });
    setStatus(`Completed ${result.result.totals.completedRuns} local coverage run(s): ${result.result.totals.humanRuns} human, ${result.result.totals.agentRuns} agent, ${result.result.totals.scoreboardReady} scoreboard-ready`);
    await refreshState();
  }

  async function requeueExpiredRuns() {
    const result = await postJson<{ count: number }>("/api/worker/requeue-expired", {
      reason: "Dashboard recovered an expired worker lease."
    });
    setStatus(`Recovered ${result.count} expired worker lease${result.count === 1 ? "" : "s"}`);
    await refreshState();
  }

  async function reviewFirstPendingProof(status: "verified" | "failed") {
    const item = proofReviewQueue[0];
    if (!item) {
      setStatus("No pending proofs to review");
      return;
    }
    await postJson(`/api/proofs/${item.proof.id}/status`, {
      status,
      reviewer: "dashboard-reviewer",
      reviewNotes: status === "verified" ? "Accepted from operations dashboard." : "Rejected from operations dashboard."
    });
    setStatus(`${item.proof.type} proof marked ${status}`);
    await refreshState();
  }

  async function verifyPublicCertificate(entry: PublicCertificateEntry) {
    const key = certificateAuditKey(entry);
    const certificateUrl = entry.links.resultCertificate;
    if (!certificateUrl) {
      setCertificateAuditState((existing) => ({ ...existing, [key]: "failed" }));
      setStatus(`Missing certificate link for ${entry.kind} ${entry.id}`);
      return;
    }

    setCertificateAuditState((existing) => ({ ...existing, [key]: "checking" }));
    try {
      const certificatePayload = await readJson<{ certificate: unknown }>(certificateUrl);
      const verification = await postJson<ResultCertificateVerificationPayload>("/api/result-certificates/verify", {
        certificate: certificatePayload.certificate
      });
      const fingerprintMatches = verification.verification.actualFingerprint === entry.fingerprint;
      const ready = verification.verification.certificate?.readyForPublicShare === true;
      const verified = verification.verification.valid && fingerprintMatches && ready;
      setCertificateAuditState((existing) => ({ ...existing, [key]: verified ? "verified" : "failed" }));
      setStatus(
        verified
          ? `Verified ${formatCertificateKind(entry.kind)} ${shortFingerprint(entry.fingerprint)}`
          : `Certificate verification mismatch for ${entry.id}`
      );
    } catch (error) {
      setCertificateAuditState((existing) => ({ ...existing, [key]: "failed" }));
      setStatus(error instanceof Error ? error.message : `Certificate verification failed for ${entry.id}`);
    }
  }

  return (
    <main>
      <nav className="topbar">
        <div className="brand">
          <Gamepad2 size={28} />
          <span>Steambench</span>
        </div>
        <div className="nav-actions">
          <button type="button" aria-label="Open benchmark runs">
            <Activity size={18} />
          </button>
          <button type="button" aria-label="Connect runtime">
            <Cable size={18} />
          </button>
          <button type="button" className="primary-action" onClick={createSteamLink}>
            <Link2 size={17} />
            Bind Steam
          </button>
        </div>
      </nav>

      <section className="public-hub" aria-label="Public competition hub">
        <div className="hub-lead">
          <div>
            <p className="eyebrow">Public Competition Hub</p>
            <h1>Steam benchmark arena.</h1>
          </div>
          <div className="hub-status">
            <span>{publicHubStatus}</span>
            <a href={publicHub?.links.certificateIndex ?? "/api/result-certificates?kind=all&limit=8"} target="_blank" rel="noreferrer">
              <ShieldCheck size={16} />
              Certificates
            </a>
          </div>
        </div>

        <div className="hub-grid">
          <section className="hub-primary" aria-label="Selected public task">
            <div className="hub-game-line">
              <span>App {hubSelected?.game.appid ?? selectedTask?.appid ?? "..."}</span>
              <strong>{hubSelected?.game.name ?? selectedTask?.gameName ?? "Loading Steam game"}</strong>
              <em>{hubSelected?.game.benchmarkFit ?? "?"}% benchmark fit</em>
            </div>
            <div className="hub-task-line">
              <div>
                <span>{hubSelected?.task.track ?? selectedTask?.track ?? "task"}</span>
                <strong>{hubSelected?.task.title ?? selectedTask?.title ?? "Select a benchmark task"}</strong>
                <em>Lv {hubSelected?.task.level ?? selectedTask?.level ?? 0} · {hubSelected?.task.runnable ? "runnable" : "public template"}</em>
              </div>
              <a href={publicHub?.links.selectedTaskRaceEntry ?? "#"} target="_blank" rel="noreferrer" aria-disabled={!publicHub}>
                <Play size={16} />
                Race entry
              </a>
            </div>
            <div className="hub-readiness" aria-label="Race readiness">
              <div>
                <UserRound size={20} />
                <span>Human</span>
                <strong>{hubRaceEntry?.human?.status ?? "missing-human"}</strong>
                <em>{hubRaceEntry?.human?.ready ? "Steam proof ready" : "Steam proof gate"}</em>
              </div>
              <div>
                <Bot size={20} />
                <span>Agent</span>
                <strong>{hubRaceEntry?.agent?.status ?? "ready-to-register"}</strong>
                <em>{hubRaceEntry?.agent?.ready ? "runtime ready" : "profile required"}</em>
              </div>
              <div>
                <Gamepad2 size={20} />
                <span>Action space</span>
                <strong>{hubActionSpace?.permissions?.transport ?? "loading"}</strong>
                <em>{hubActionSpace?.bridge?.bridgeable ? "GeForce NOW bridgeable" : "local or non-bridge"}</em>
              </div>
              <div>
                <Trophy size={20} />
                <span>Match</span>
                <strong>{hubRaceEntry?.readyForMatch ? "ready" : "preflight"}</strong>
                <em>{hubRaceEntry?.match?.preflight?.endpoint ?? "/api/matches/preflight"}</em>
              </div>
            </div>
          </section>

          <aside className="hub-metrics" aria-label="Public platform metrics">
            <div>
              <span>Tasks</span>
              <strong>{hubTotals?.activeTasks ?? tasks.length}</strong>
            </div>
            <div>
              <span>Games</span>
              <strong>{hubTotals?.activeGames ?? topGames.length}</strong>
            </div>
            <div>
              <span>Humans</span>
              <strong>{hubTotals?.proofConsentedHumans ?? users.filter((user) => user.proofConsentAt).length}</strong>
            </div>
            <div>
              <span>Agents</span>
              <strong>{hubTotals?.activeAgents ?? agents.filter((agent) => agent.status === "active").length}</strong>
            </div>
            <div>
              <span>Rows</span>
              <strong>{hubTotals?.scoreboardRows ?? scoreboard.length}</strong>
            </div>
            <div>
              <span>Broadcasts</span>
              <strong>{hubTotals?.broadcasts ?? streams.length}</strong>
            </div>
          </aside>
        </div>

        <div className="hub-lower-grid">
          <section className="hub-list" aria-label="Featured public tasks">
            <div className="hub-list-head">
              <span>Featured tasks</span>
              <a href={publicHub?.links.selectedGamePack ?? "#"} target="_blank" rel="noreferrer" aria-disabled={!publicHub}>Game pack</a>
            </div>
            {hubFeaturedTasks.slice(0, 4).map((task) => (
              <a key={task.id} href={task.links.raceEntry} target="_blank" rel="noreferrer">
                <strong>{task.title}</strong>
                <span>{task.gameName} · {task.track} · Lv {task.level}</span>
                <b>{task.score}</b>
              </a>
            ))}
          </section>

          <section className="hub-list" aria-label="Public games">
            <div className="hub-list-head">
              <span>Games</span>
              <a href={publicHub?.entrypoints.steamIntakeTemplate.replace("{appid}", String(hubSelected?.game.appid ?? 620)) ?? "#"} target="_blank" rel="noreferrer" aria-disabled={!publicHub}>Steam intake</a>
            </div>
            {hubTopGames.slice(0, 4).map((game) => (
              <a key={game.appid} href={game.links.benchmarkPack} target="_blank" rel="noreferrer">
                <strong>{game.name}</strong>
                <span>{game.activeTasks} tasks · {game.tracks.slice(0, 3).join(" / ")}</span>
                <b>{game.agentRows}A / {game.humanRows}H</b>
              </a>
            ))}
          </section>

          <section className="hub-broadcast" aria-label="Public broadcast">
            <div className="hub-list-head">
              <span>Live and replay</span>
              <a href={hubBroadcast?.links.publicWatch ?? publicHub?.entrypoints.publicWatchTemplate ?? "#"} target="_blank" rel="noreferrer" aria-disabled={!hubBroadcast}>Watch packet</a>
            </div>
            <div className="broadcast-slate">
              <Radio size={22} />
              <strong>{hubBroadcast?.title ?? "No featured broadcast yet"}</strong>
              <span>{hubBroadcast ? `${hubBroadcast.status} · ${hubBroadcast.viewerCount} viewers` : "Run an agent session with livestream enabled"}</span>
              <em>{hubBroadcast?.scoreboardReady ? "scoreboard-ready" : "waiting for public replay"}</em>
            </div>
          </section>
        </div>
      </section>

      <section className="control-console" aria-label="Steambench runtime control console">
        <div className="console-status-row">
          <div>
            <p className="eyebrow">Agent Control / Action-Space Authorization</p>
            <h1>One bounded lease. One controller surface. One audit trail.</h1>
          </div>
          <div className="console-status-pills" aria-label="Platform readiness">
            <span className={controlTask ? "ready" : ""}>{controlTask ? "Controller task ready" : "No controller task"}</span>
            <span className={bridgeReady ? "ready" : ""}>{bridgeReady ? "Lease active" : "Bridge waiting"}</span>
            <span className={controllerReportEvents.length > 0 ? "ready" : ""}>{controllerReportEvents.length} executor reports</span>
          </div>
        </div>

        <div className="contract-summary" aria-label="Selected control target">
          <div>
            <Gamepad2 size={28} />
            <span>Steam task</span>
            <strong>{controlTask ? controlTask.title : "Select a controller task"}</strong>
            <em>{controlTask ? `${controlTask.gameName} · App ${controlTask.appid}` : "No controller task selected"}</em>
          </div>
          <div>
            <Bot size={28} />
            <span>Agent</span>
            <strong>{activeAgent?.displayName ?? activeAgent?.handle ?? "No active agent"}</strong>
            <em>{activeAgent ? `${activeAgent.provider} · ${activeAgent.runtimeProvider}` : "Register an agent first"}</em>
          </div>
          <div>
            <Clock3 size={28} />
            <span>Action lease</span>
            <strong>{activeControlSession?.session.id ?? "not granted"}</strong>
            <em>{bridgeReady ? `expires ${leaseExpiry}` : "bounded lease required"}</em>
          </div>
        </div>

        <div className="console-grid">
          <aside className="console-panel task-queue" aria-label="Steam task queue">
            <div className="console-panel-head">
              <span>Steam Tasks</span>
              <b>{controllerTaskPlans.length} controller</b>
            </div>
            <div className="console-task-list">
              {(controllerTaskPlans.length > 0 ? controllerTaskPlans : taskPlans).slice(0, 5).map(({ task, plan }) => (
                <button
                  key={task.id}
                  type="button"
                  className={task.id === controlTask?.id ? "console-task active" : "console-task"}
                  onClick={() => setSelectedTaskId(task.id)}
                >
                  <span>{task.gameName}</span>
                  <strong>{task.title}</strong>
                  <em>{plan.controlSurface} · Lv {task.level}</em>
                </button>
              ))}
            </div>
          </aside>

          <section className="console-panel lease-panel" aria-label="Controller lease">
            <div className="console-panel-head">
              <span>Agent Action-Space Contract</span>
              <b>{bridgeReady ? "enforceable" : "draft"}</b>
            </div>
            <div className="contract-clauses" aria-label="Runtime contract clauses">
              <div>
                <span>Clause 1</span>
                <Gamepad2 size={21} />
                <strong>Gamepad only</strong>
                <em>Controller inputs are authorized; keyboard, mouse, and touch are not.</em>
              </div>
              <div>
                <span>Clause 2</span>
                <Eye size={21} />
                <strong>Read-only observation</strong>
                <em>The agent can observe the game state, not mutate the host session.</em>
              </div>
              <div>
                <span>Clause 3</span>
                <FileText size={21} />
                <strong>Evidence required</strong>
                <em>Every scored attempt must produce output.mp4 and a validated executor report.</em>
              </div>
              <div>
                <span>Clause 4</span>
                <LockKeyhole size={21} />
                <strong>No OS control</strong>
                <em>Window management, shell commands, and privileged device control are denied.</em>
              </div>
              <div>
                <span>Clause 5</span>
                <Ban size={21} />
                <strong>No side effects</strong>
                <em>No file writes, installs, uploads, downloads, or network actions through the executor.</em>
              </div>
              <div>
                <span>Clause 6</span>
                <ShieldCheck size={21} />
                <strong>Policy conflicts stop</strong>
                <em>Unsafe or uncertain actions are rejected and recorded in the audit trail.</em>
              </div>
            </div>
            <div className="contract-footer">
              <div>
                <LockKeyhole size={18} />
                <span>{bridgeReady ? "Lease is active and bounded by this action space." : "Grant a lease to make this contract active."}</span>
              </div>
              <b>{activeControlSession?.session.status ?? "not granted"}</b>
            </div>
          </section>

          <aside className="console-panel evidence-panel" aria-label="Bridge and evidence">
            <div className="console-panel-head">
              <span>Execution Bridge</span>
              <b>{activeControlSession ? activeControlSession.session.actionSpace.transport : "virtual-controller"}</b>
            </div>
            <div className="bridge-stack">
              <div>
                <Radio size={17} />
                <span>GeForce NOW</span>
                <strong>{bridgeReady ? "Lease ready" : "Awaiting lease"}</strong>
              </div>
              <div>
                <Terminal size={17} />
                <span>Manifest</span>
                <strong>{activeControlSession ? "signed bridge manifest" : "not issued"}</strong>
              </div>
              <div>
                <FileText size={17} />
                <span>Capture</span>
                <strong>{canonicalArtifacts} output.mp4</strong>
              </div>
              <div>
                <Clock3 size={17} />
                <span>Heartbeat</span>
                <strong>{activeControlSession?.session.heartbeatAt ? "seen" : "not started"}</strong>
              </div>
              <div>
                <ShieldCheck size={17} />
                <span>Latest report</span>
                <strong>{latestControllerReport ? String(latestControllerReport.metadata?.executorStatus ?? "recorded") : "none"}</strong>
              </div>
            </div>
            <button type="button" className="primary-action wide-action" onClick={grantControllerLease} disabled={!activeAgent || !controlTask}>
              <Gamepad2 size={17} />
              Grant lease
            </button>
            <div className="permission-row" aria-label="Input permissions">
              <span className={controlActionSpace?.permissions.controller ? "enabled" : ""}>controller</span>
              <span>{forbiddenActionCount} forbidden actions</span>
              <span>neutral-on-completion</span>
              <span>read-only observation</span>
            </div>
            <div className="console-links">
              <a href={activeControlSession?.links.playbook ?? "#"} aria-disabled={!activeControlSession} target="_blank" rel="noreferrer">
                Playbook
              </a>
              <a href={activeControlSession?.links.trace ?? "#"} aria-disabled={!activeControlSession} target="_blank" rel="noreferrer">
                Trace
              </a>
            </div>
          </aside>
        </div>

        <div className="action-preview" aria-label="Normalized action preview">
          <div>
            <span>Authorized action preview</span>
            <strong>{normalizedControllerActions.length || 0} normalized controls</strong>
          </div>
          <div className="action-chip-row">
            {(normalizedControllerActions.length > 0 ? normalizedControllerActions : ["PAD_A", "LEFT_STICK", "RT", "WAIT"]).map((action) => (
              <span key={action}>{action}</span>
            ))}
          </div>
          <div className="report-count">
            <FileText size={20} />
            <strong>{controllerReportEvents.length}</strong>
            <span>executor reports</span>
          </div>
        </div>
      </section>

      <section className="certificate-transparency" aria-label="Public result certificate transparency">
        <div className="certificate-ledger">
          <div className="certificate-ledger-head">
            <div>
              <p className="eyebrow">Public Ledger</p>
              <h2>Share-ready result certificates</h2>
              <span>{certificateLoadStatus}</span>
            </div>
            <div className="certificate-controls">
              <label>
                <span>Kind</span>
                <select value={certificateKind} onChange={(event) => setCertificateKind(event.target.value as ResultCertificateIndexKind)}>
                  {certificateKindOptions.map((kind) => (
                    <option key={kind} value={kind}>
                      {formatCertificateKind(kind)}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => void loadCertificateIndex()}>
                <Search size={16} />
                Refresh
              </button>
              <a href="/api/result-certificates?kind=all&limit=50" target="_blank" rel="noreferrer">
                <Link2 size={16} />
                Index
              </a>
            </div>
          </div>

          <div className="certificate-summary-row" aria-label="Certificate index summary">
            <div>
              <span>Indexed</span>
              <strong>{certificateIndex?.totals.certificates ?? 0}</strong>
            </div>
            <div>
              <span>Public-ready</span>
              <strong>{certificateIndex?.totals.readyForPublicShare ?? 0}</strong>
            </div>
            <div>
              <span>Artifact</span>
              <strong>output.mp4</strong>
            </div>
            <div>
              <span>Verify</span>
              <strong>{certificateIndex?.links.verify ?? "/api/result-certificates/verify"}</strong>
            </div>
          </div>

          <div className="certificate-table" role="table" aria-label="Public result certificates">
            <div className="certificate-row certificate-row-head" role="row">
              <span>Certificate</span>
              <span>Result</span>
              <span>Fingerprint</span>
              <span>Actions</span>
            </div>
            {certificateEntries.length === 0 && (
              <div className="certificate-empty" role="row">
                No share-ready certificates found for {formatCertificateKind(certificateKind)}.
              </div>
            )}
            {certificateEntries.map((entry) => {
              const auditKey = certificateAuditKey(entry);
              const auditState = certificateAuditState[auditKey] ?? "idle";
              const topTask = entry.tasks[0];
              const participantLabel = entry.participants.map((participant) => participant.displayName).join(" vs ") || "public result";
              return (
                <div className="certificate-row" key={auditKey} role="row">
                  <div>
                    <span className="certificate-kind">{formatCertificateKind(entry.kind)}</span>
                    <strong>{entry.title}</strong>
                    <em>{topTask ? `${topTask.gameName} · ${topTask.title}` : participantLabel}</em>
                  </div>
                  <div>
                    <span className={`certificate-verdict ${entry.verdict}`}>{entry.verdict}</span>
                    <strong>
                      {entry.result.winner
                        ? `${entry.result.winner} winner`
                        : `${entry.result.scoreboardRows} scoreboard row${entry.result.scoreboardRows === 1 ? "" : "s"}`}
                    </strong>
                    <em>{entry.canonicalArtifactName} · {new Date(entry.generatedAt).toLocaleDateString()}</em>
                  </div>
                  <code title={entry.fingerprint}>{shortFingerprint(entry.fingerprint)}</code>
                  <div className="certificate-actions">
                    <button type="button" onClick={() => void verifyPublicCertificate(entry)} disabled={auditState === "checking"}>
                      <ShieldCheck size={15} />
                      {auditState === "checking" ? "Checking" : auditState === "verified" ? "Verified" : "Verify"}
                    </button>
                    <a href={entry.links.resultCertificate ?? "#"} target="_blank" rel="noreferrer" aria-disabled={!entry.links.resultCertificate}>
                      <FileText size={15} />
                      Open
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">Human vs Agent Benchmark Arena</p>
          <h1>Steam achievements become live benchmark levels.</h1>
          <p>
            Rank humans and runtime agents on the same game tasks with Steam proof, run capture artifacts, and
            reproducible scoring.
          </p>
          <div className="hero-actions">
            <button type="button" className="primary-action" onClick={createRuntimeRun}>
              <Play size={17} />
              Start Runtime Run
            </button>
            <button type="button" onClick={submitHumanProofRun} disabled={!linkedHuman}>
              <ShieldCheck size={17} />
              Submit Human Proof
            </button>
          </div>
        </div>
        <div className="arena-panel" aria-label="Live arena summary">
          <div className="arena-header">
            <div>
              <span className="status-dot" />
              Live Ladder
            </div>
            <span>output.mp4 required</span>
          </div>
          <div className="status-line">{status}</div>
          {activeCompetitionEvent && (
            <div className="event-band" aria-label="Active competition event">
              <div>
                <strong>{activeCompetitionEvent.title}</strong>
                <span>{activeCompetitionEvent.window.label} · {activeCompetitionEvent.status}</span>
                <div className="event-actions">
                  <button type="button" onClick={() => registerActiveEventParticipant("human")} disabled={!linkedHuman}>
                    <UserRound size={14} />
                    {activeHumanRegistration ? "Human Registered" : "Register Human"}
                  </button>
                  <button type="button" onClick={() => registerActiveEventParticipant("agent")} disabled={!activeAgent}>
                    <Bot size={14} />
                    {activeAgentRegistration ? "Agent Registered" : "Register Agent"}
                  </button>
                  <button type="button" onClick={scheduleActiveEventSuite} disabled={!activeCompetitionEvent || activeCompetitionEvent.entrants.registeredPairs === 0}>
                    <Trophy size={14} />
                    Schedule Suite
                  </button>
                  <button type="button" onClick={runActiveEventSuite} disabled={!activeCompetitionEvent || activeCompetitionEvent.suiteRaces.total === 0}>
                    <Play size={14} />
                    Run Event
                  </button>
                  <button type="button" onClick={runActiveEventCampaignComparisons} disabled={!activeCompetitionEvent || activeCompetitionEvent.entrants.registeredPairs === 0}>
                    <Play size={14} />
                    Run Campaigns
                  </button>
                  <a href={`/api/competition-events/${activeCompetitionEvent.scope}/evidence-bundle`} target="_blank" rel="noreferrer">
                    <ShieldCheck size={14} />
                    Event Bundle
                  </a>
                  <a href={`/api/competition-events/${activeCompetitionEvent.scope}/result-certificate`} target="_blank" rel="noreferrer">
                    <Trophy size={14} />
                    Certificate
                  </a>
                </div>
              </div>
              <div>
                <b>{activeCompetitionEvent.entrants.registeredPairs}</b>
                <span>registered pairs</span>
              </div>
              <div>
                <b>{activeCompetitionEvent.entrants.runnablePairs}</b>
                <span>runnable pairs</span>
              </div>
              <div>
                <b>{activeCompetitionEvent.matches.scored}/{activeCompetitionEvent.matches.total}</b>
                <span>matches scored</span>
              </div>
              <div>
                <b>{activeCompetitionEvent.suiteRaces.scored}</b>
                <span>suite races</span>
              </div>
              <div>
                <b>{activeCompetitionEventBundle ? `${activeCompetitionEventBundle.readyBundleCount}/${activeCompetitionEventBundle.bundleCount}` : "0/0"}</b>
                <span>ready bundles</span>
              </div>
              <div>
                <b>{activeCompetitionEventBundle ? `${activeCompetitionEventBundle.campaignComparisonReadyCount}/${activeCompetitionEventBundle.campaignComparisonCount}` : "0/0"}</b>
                <span>campaign comparisons</span>
              </div>
            </div>
          )}
          <div className="profile-strip" aria-label="Competitor profiles">
            {competitorProfiles.slice(0, 4).map((profile) => (
              <a
                key={`${profile.participant.type}-${profile.participant.id}`}
                href={`/api/competitors/${profile.participant.type}/${profile.participant.id}/profile`}
                target="_blank"
                rel="noreferrer"
              >
                <strong>{profile.participant.displayName}</strong>
                <span>{profile.participant.type} · {profile.runs.scored} scored runs</span>
                <b>{profile.scoreboard.totalScore}</b>
              </a>
            ))}
          </div>
          <div className="duel-score">
            <div>
              <Bot size={24} />
              <strong>{agentWinRate}%</strong>
              <span>Agent wins</span>
            </div>
            <div>
              <UserRound size={24} />
              <strong>{humanWinRate}%</strong>
              <span>Human wins</span>
            </div>
          </div>
          <div className="score-list">
            {scoreboard.slice(0, 6).map((row) => (
              <div key={`${row.rank}-${row.competitor}`} className="score-row">
                <span>#{row.rank}</span>
                <strong>{row.competitor}</strong>
                <em>{row.game}</em>
                <b>{row.score}</b>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="catalog-strip">
        {(gameProfiles.length > 0 ? gameProfiles : topGames.map((game) => ({ game, totals: undefined }))).map((profile) => (
          <a key={profile.game.appid} className="game-tile" href={`/api/games/${profile.game.appid}/result-certificate`} target="_blank" rel="noreferrer">
            <img src={profile.game.headerUrl} alt={`${profile.game.name} Steam header`} />
            <div>
              <strong>{profile.game.name}</strong>
              <span>{profile.game.benchmarkFit}% fit</span>
              {profile.totals && (
                <em>
                  {profile.totals.activeTasks} tasks · {profile.totals.rankedReady} ranked · {profile.totals.scoreboardReadyBroadcasts} replays
                </em>
              )}
              {"competition" in profile && profile.competition && (
                <em>
                  H {profile.competition.humanScore} / A {profile.competition.agentScore} · {profile.competition.coveragePercent}% covered
                </em>
              )}
            </div>
          </a>
        ))}
      </section>

      {gameCoverageRuns.length > 0 && (
        <section className="suite-section" aria-label="Game coverage runs">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Coverage Runs</p>
              <h2>Recent game coverage executions with scored run evidence.</h2>
            </div>
            <span>{gameCoverageRuns.length} recent</span>
          </div>
          <div className="suite-grid">
            {gameCoverageRuns.slice(0, 4).map((entry) => (
              <article key={entry.record.id} className={`suite-card ${entry.record.status === "scoreboard-ready" ? "ranked-ready" : "review-required"}`}>
                <div className="suite-title">
                  <strong>{entry.record.gameName}</strong>
                  <span>{entry.record.status}</span>
                </div>
                <p>{entry.record.summary}</p>
                <div className="suite-meta">
                  <span>{entry.record.completedRuns} runs</span>
                  <span>{entry.record.scoreboardReady} ready</span>
                  <span>H gap {entry.record.remainingHumanGaps}</span>
                  <span>A gap {entry.record.remainingAgentGaps}</span>
                </div>
                <div className="suite-links">
                  <a href={entry.links.resultCertificate} target="_blank" rel="noreferrer">certificate</a>
                  <a href={entry.links.evidenceBundle} target="_blank" rel="noreferrer">evidence</a>
                  <a href={entry.links.coveragePlan} target="_blank" rel="noreferrer">plan</a>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="suite-section" aria-label="Benchmark suites">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Benchmark Packs</p>
            <h2>Game task suites ready for human-agent races.</h2>
          </div>
          <span>{benchmarkSuites.length} generated suites</span>
        </div>
        <div className="suite-grid">
          {benchmarkSuites.slice(0, 6).map((suite) => (
            <article key={suite.id} className={`suite-card ${suite.status}`}>
              <div className="suite-title">
                <strong>{suite.title}</strong>
                <span>{suite.status}</span>
              </div>
              <div className="suite-score">
                <CircleGauge size={18} />
                <b>{suite.readinessScore}</b>
                <span>readiness</span>
              </div>
              <div className="suite-meta">
                <span>{suite.taskCount} tasks</span>
                <span>Lv {suite.levelRange.min}-{suite.levelRange.max}</span>
                <span>{suite.tracks.join(" / ")}</span>
              </div>
              <div className="suite-controls">
                <span>{suite.rankedReadyTasks} ranked</span>
                <span>{suite.controlledTasks} controlled</span>
                <span>{suite.estimatedRuntimeMinutes} min</span>
              </div>
            </article>
          ))}
        </div>
        <div className="blueprint-strip" aria-label="Benchmark blueprint queue">
          {benchmarkBlueprints.slice(0, 4).map((blueprint) => (
            <a key={blueprint.appid} href={`/api/games/${blueprint.appid}/benchmark-blueprint`} target="_blank" rel="noreferrer">
              <strong>{blueprint.game.name}</strong>
              <span>{blueprint.status}</span>
              <span>{blueprint.importPlan.importedAchievementTasks}/{blueprint.importPlan.availableAchievementTasks} achievements</span>
              <b>{blueprint.readinessScore}</b>
            </a>
          ))}
        </div>
        <div className="suite-race-strip" aria-label="Suite race schedule">
          {suiteRaces.slice(0, 4).map((race) => (
            <div key={race.id} className="suite-race-row">
              <strong>{race.title}</strong>
              <span>{race.status}</span>
              <span>{race.winner ?? `${race.matchIds.length} matches`}</span>
              <b>{race.humanScore !== undefined && race.agentScore !== undefined ? `${race.humanScore}-${race.agentScore}` : `${race.taskIds.length} tasks`}</b>
            </div>
          ))}
        </div>
        <div className="suite-leaderboard-strip" aria-label="Suite race leaderboards">
          <div className="suite-leaderboard-total">
            <strong>{suiteRaceStandings?.totals.scoredRaces ?? 0}</strong>
            <span>scored suite races</span>
            <b>H {suiteRaceStandings?.totals.humanWins ?? 0} / A {suiteRaceStandings?.totals.agentWins ?? 0}</b>
          </div>
          {suiteRaceLeaderboards.slice(0, 3).map((leaderboard) => (
            <div key={leaderboard.suiteId} className="suite-leaderboard-row">
              <strong>{leaderboard.title}</strong>
              <span>{leaderboard.raceCount} races</span>
              <b>{leaderboard.leader.humanScore}-{leaderboard.leader.agentScore}</b>
            </div>
          ))}
        </div>
        <div className="suite-audit-strip" aria-label="Suite race audit summaries">
          {suiteRaceAuditSummaries.slice(0, 4).map((audit) => (
            <a key={audit.raceId} className={`suite-audit-row ${audit.verdict}`} href={`/api/suite-races/${audit.raceId}/result-certificate`} target="_blank" rel="noreferrer">
              <strong>{audit.title}</strong>
              <span>{audit.verdict}</span>
              <span>{audit.scoredMatches}/{audit.totalMatches} scored</span>
              <b>{audit.humanScore !== undefined && audit.agentScore !== undefined ? `${audit.humanScore}-${audit.agentScore}` : `${audit.missingCount} gaps`}</b>
            </a>
          ))}
        </div>
      </section>

      <section className="eligibility-section" aria-label="Race eligibility">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Race Preflight</p>
            <h2>Task gates before humans and agents compete.</h2>
          </div>
          <span>{raceEligibility.filter((entry) => entry.status === "ready").length} ready</span>
        </div>
        <div className="eligibility-grid">
          {raceEligibility.slice(0, 6).map((entry) => {
            const task = tasks.find((candidate) => candidate.id === entry.taskId);
            return (
              <article key={entry.taskId} className={`eligibility-card ${entry.status}`}>
                <div className="eligibility-title">
                  <strong>{task?.title ?? entry.taskId}</strong>
                  <span>{entry.status}</span>
                </div>
                <div className="eligibility-meta">
                  <span>{task?.gameName ?? "Steam game"}</span>
                  <span>{entry.proofRequirements.join(" + ")}</span>
                </div>
                <div className="eligibility-checks">
                  <span>{entry.human.ready ? "human ready" : entry.human.blockers.join(", ")}</span>
                  <span>{entry.agent.ready ? "agent ready" : entry.agent.blockers.join(", ")}</span>
                  <span>{entry.task.reviewDecision}</span>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="workbench">
        <aside className="control-rail">
          <div className="control-block">
            <div className="block-title">
              <Search size={17} />
              Task Search
            </div>
            <label>
              <span>Game or achievement</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Portal, Ascend, Hades" />
            </label>
          </div>

          <div className="control-block">
            <div className="block-title">
              <Filter size={17} />
              Suitability
            </div>
            <div className="segmented">
              {(["all", "baseline", "ranked", "expert", "needs-review"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={trackFilter === option ? "active" : ""}
                  onClick={() => setTrackFilter(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="control-block">
            <div className="block-title">
              <Trophy size={17} />
              Season
            </div>
            <div className="segmented">
              {(["all", "daily", "weekly"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={seasonScope === option ? "active" : ""}
                  onClick={() => setSeasonScope(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="control-block steam-link">
            <div className="block-title">
              <Link2 size={17} />
              Steam Proof
            </div>
            <p>SteamID binding, achievement checks, and replay artifacts are treated as separate proof channels.</p>
            <div className="policy-mini">
              <span>{steamDataPolicy?.cache.entries.length ?? 0} cached Steam sources</span>
              <span>TTL {Math.round((steamDataPolicy?.cache.defaultTtlSeconds ?? 0) / 3600)}h</span>
              <span>{steamDataPolicy?.userData.steamWebApiKeyServerSideOnly ? "server key" : "no key policy"}</span>
              <span>{linkedHuman ? "proof consented" : steamLinkedHuman ? "consent needed" : "steam unbound"}</span>
            </div>
            <button type="button" onClick={createSteamLink}>
              <CheckCircle2 size={17} />
              {latestSteamLink?.status === "linked" ? "Linked" : "Create Link"}
            </button>
            <button type="button" onClick={completeMockSteamLink} disabled={!latestSteamLink || latestSteamLink.status === "linked"}>
              <ShieldCheck size={17} />
              Mock Verify
            </button>
            <button type="button" onClick={consentSteamProof} disabled={!steamLinkedHuman || Boolean(linkedHuman)}>
              <ShieldCheck size={17} />
              Consent Proof
            </button>
          </div>

          <div className="control-block">
            <div className="block-title">
              <UserRound size={17} />
              Human Signup
            </div>
            <label>
              <span>Handle</span>
              <input value={newHandle} onChange={(event) => setNewHandle(event.target.value)} />
            </label>
            <button type="button" onClick={createHumanUser}>
              <CheckCircle2 size={17} />
              Register
            </button>
          </div>

          <div className="control-block">
            <div className="block-title">
              <Bot size={17} />
              Agent Profile
            </div>
            <label>
              <span>Handle</span>
              <input value={agentHandle} onChange={(event) => setAgentHandle(event.target.value)} />
            </label>
            <button type="button" onClick={createAgentProfile}>
              <CheckCircle2 size={17} />
              Register Agent
            </button>
          </div>

          <div className="control-block">
            <div className="block-title">
              <Gamepad2 size={17} />
              Task Import
            </div>
            <label>
              <span>Steam AppID</span>
              <input value={importAppId} onChange={(event) => setImportAppId(event.target.value)} />
            </label>
            <button type="button" onClick={importSteamTasks}>
              <Search size={17} />
              Import
            </button>
            <button type="button" onClick={publishFirstCandidate} disabled={taskCandidates.length === 0}>
              <CheckCircle2 size={17} />
              Publish One
            </button>
            <button type="button" onClick={publishAppCandidates} disabled={importAppCandidateCount === 0}>
              <CheckCircle2 size={17} />
              Publish App
            </button>
            <button type="button" onClick={openGameCoveragePlan}>
              <CircleGauge size={17} />
              Coverage Plan
            </button>
            <button type="button" onClick={openAchievementLadder}>
              <CircleGauge size={17} />
              Achievement Ladder
            </button>
            <button type="button" onClick={loadAchievementLadder}>
              <Filter size={17} />
              Load Ladder
            </button>
            <button type="button" onClick={loadSteamAppOnboarding}>
              <CircleGauge size={17} />
              Load Onboarding
            </button>
            <button type="button" onClick={advanceSteamAppOnboarding}>
              <Play size={17} />
              Advance
            </button>
            <button type="button" onClick={runSteamAppOnboardingLocal} disabled={!linkedHuman || !activeAgent}>
              <Play size={17} />
              Run Match
            </button>
            <button type="button" onClick={importRecommendedAchievements} disabled={!achievementLadder}>
              <CheckCircle2 size={17} />
              Import Recommended
            </button>
            <button type="button" onClick={scheduleGameCoverage} disabled={!linkedHuman || !activeAgent}>
              <Play size={17} />
              Schedule Coverage
            </button>
            <button type="button" onClick={runGameCoverageLocal} disabled={!linkedHuman || !activeAgent}>
              <Play size={17} />
              Run Coverage
            </button>
            <label>
              <span>Discover Steam</span>
              <input value={discoverQuery} onChange={(event) => setDiscoverQuery(event.target.value)} />
            </label>
            <button type="button" onClick={discoverSteamApps}>
              <Search size={17} />
              Discover
            </button>
            <button type="button" onClick={importFirstDiscovery} disabled={!importableSteamDiscovery}>
              <CheckCircle2 size={17} />
              Import Candidate
            </button>
            <label>
              <span>Proposal Track</span>
              <select value={proposalTrack} onChange={(event) => setProposalTrack(event.target.value as typeof proposalTrack)}>
                <option value="capture">Capture</option>
                <option value="leaderboard">Leaderboard</option>
                <option value="stat">Stat</option>
              </select>
            </label>
            <label>
              <span>Proposal Title</span>
              <input value={proposalTitle} onChange={(event) => setProposalTitle(event.target.value)} />
            </label>
            <label>
              <span>Metric</span>
              <input value={proposalMetric} onChange={(event) => setProposalMetric(event.target.value)} />
            </label>
            <label>
              <span>Target</span>
              <input value={proposalTarget} onChange={(event) => setProposalTarget(event.target.value)} />
            </label>
            <button type="button" onClick={proposeManualTask}>
              <CheckCircle2 size={17} />
              Propose Task
            </button>
          </div>
        </aside>

        <section className="task-board" aria-label="Benchmark task board">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Task Catalog</p>
              <h2>Ranked achievement benchmarks</h2>
            </div>
            <div className="metric-pill">
              <CircleGauge size={17} />
              {tasks.length} active / {taskCandidates.length} candidates
            </div>
          </div>

          <div className="registry-strip">
            <span>{taskRegistry.length} imported registry rows</span>
            <span>{taskCandidates.length} awaiting review</span>
            <span>{steamAppDiscoveries.length} Steam app discoveries</span>
            <span>{activeSeason?.window.label ?? "All Time"} · {activeSeason?.window.rowCount ?? scoreboard.length} scored rows</span>
          </div>

          {steamAppDiscoveries.length > 0 && (
            <div className="discovery-strip" aria-label="Steam app discovery queue">
              {steamAppDiscoveries.slice(0, 4).map((entry) => (
                <a key={entry.id} href="/api/steam/apps/discovery" target="_blank" rel="noreferrer">
                  <strong>{entry.name}</strong>
                  <span>{entry.status}</span>
                  <span>{entry.benchmarkFit}/100 fit</span>
                  <b>{entry.estimatedAchievementTasks} achievements</b>
                </a>
              ))}
            </div>
          )}

          {steamAppOnboarding && (
            <div className="onboarding-panel" aria-label="Steam app onboarding pipeline">
              <div className="onboarding-control-row">
                <div className="onboarding-cell status-cell">
                  <span>Status</span>
                  <strong>{steamAppOnboarding.status}</strong>
                  <b>{steamAppOnboarding.readinessScore}/100</b>
                </div>
                <div className="onboarding-cell">
                  <span>Next</span>
                  <strong>{nextOnboardingStage?.label ?? "Standings"}</strong>
                  <b>{readyOnboardingActions} ready</b>
                </div>
                <div className="onboarding-cell">
                  <span>Competitors</span>
                  <strong>{linkedHuman ? "human linked" : "human needed"}</strong>
                  <b>{activeAgent ? "agent linked" : "agent needed"}</b>
                </div>
                <div className="onboarding-cell">
                  <span>Last run</span>
                  <strong>{latestAppCoverageRun ? latestAppCoverageRun.record.status : "none"}</strong>
                  <b>{latestAppCoverageRun ? `${latestAppCoverageRun.record.completedRuns} run(s)` : steamAppOnboarding.gameName}</b>
                </div>
                <div className="onboarding-cell onboarding-primary">
                  <button type="button" className="primary-action" onClick={runSteamAppOnboardingLocal} disabled={!linkedHuman || !activeAgent}>
                    <Play size={17} />
                    Run local match
                  </button>
                  <button type="button" onClick={advanceSteamAppOnboarding}>
                    <CheckCircle2 size={17} />
                    Advance
                  </button>
                </div>
              </div>
              <div className="onboarding-stage-strip">
                {steamAppOnboarding.stages.map((stage) => (
                  <a key={stage.id} className={`onboarding-chip ${stage.status}`} href={stage.action.endpoint} target="_blank" rel="noreferrer">
                    <span>{stage.label}</span>
                    <b>{stage.status}</b>
                  </a>
                ))}
              </div>
              <div className="onboarding-link-row">
                <a href={steamAppOnboarding.links.coveragePlan} target="_blank" rel="noreferrer">
                  <Link2 size={15} />
                  plan
                </a>
                <a href={latestAppCoverageRun?.links.evidenceBundle ?? steamAppOnboarding.links.standings} target="_blank" rel="noreferrer">
                  <ShieldCheck size={15} />
                  evidence
                </a>
                <a href={latestAppCoverageRun?.links.resultCertificate ?? steamAppOnboarding.links.standings} target="_blank" rel="noreferrer">
                  <Trophy size={15} />
                  certificate
                </a>
              </div>
            </div>
          )}

          {achievementLadder && (
            <div className="achievement-ladder-panel" aria-label="Steam achievement benchmark ladder">
              <div className="ladder-heading">
                <div>
                  <p className="eyebrow">Achievement Ladder</p>
                  <h3>{achievementLadder.game.name} benchmark import map</h3>
                </div>
                <span>{achievementLadder.totals.achievements} achievements · {achievementLadder.source}</span>
              </div>
              <div className="ladder-totals">
                <span>{achievementLadder.totals.active} active</span>
                <span>{achievementLadder.totals.candidates} candidates</span>
                <span>{achievementLadder.totals.new} new</span>
                <span>{achievementLadder.totals.recommendedImports} recommended</span>
              </div>
              <div className="ladder-band-grid">
                {achievementLadder.bands.map((band) => (
                  <article key={band.id} className={`ladder-band ${band.id}`}>
                    <div>
                      <strong>{band.label}</strong>
                      <span>{band.levelRange} · {band.percentRange}</span>
                    </div>
                    <b>{band.taskCount}</b>
                    <em>{band.rankedReady} ranked / {band.reviewRequired} review</em>
                  </article>
                ))}
              </div>
              {achievementLadder.recommendedImports.length > 0 && (
                <div className="ladder-recommendations">
                  {achievementLadder.recommendedImports.slice(0, 4).map((entry) => (
                    <a
                      key={entry.task.id}
                      href={entry.importStatus === "new" ? achievementLadder.links.achievementTasks : `/api/tasks/${encodeURIComponent(entry.task.id)}/review`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <strong>{entry.task.title}</strong>
                      <span>{entry.recommendation}</span>
                      <span>Lv {entry.task.level} · {entry.importStatus}</span>
                      <b>{entry.review.score}</b>
                    </a>
                  ))}
                </div>
              )}
              <div className="suite-links">
                <a href={achievementLadder.links.importAchievements} target="_blank" rel="noreferrer">import</a>
                <a href={achievementLadder.links.publishCandidates} target="_blank" rel="noreferrer">publish</a>
                <a href={achievementLadder.links.coveragePlan} target="_blank" rel="noreferrer">coverage</a>
              </div>
            </div>
          )}

          {taskReviewCatalog && (
            <div className="review-catalog-strip" aria-label="Task review catalog health">
              <div>
                <strong>{taskReviewCatalog.totals.rankedReady}</strong>
                <span>ranked ready</span>
              </div>
              <div>
                <strong>{taskReviewCatalog.totals.reviewRequired}</strong>
                <span>needs review</span>
              </div>
              <div>
                <strong>{taskReviewCatalog.totals.blocked}</strong>
                <span>blocked</span>
              </div>
              <div>
                <strong>{taskReviewCatalog.fairness.controlled}</strong>
                <span>controlled fairness</span>
              </div>
            </div>
          )}

          {taskReviewCatalog && taskReviewCatalog.reviewQueue.length > 0 && (
            <div className="review-queue-strip" aria-label="Benchmark review queue">
              {taskReviewCatalog.reviewQueue.slice(0, 4).map((entry) => (
                <a key={entry.task.id} href={`/api/tasks/${encodeURIComponent(entry.task.id)}/review`} target="_blank" rel="noreferrer">
                  <strong>{entry.task.title}</strong>
                  <span>{entry.review.decision}</span>
                  <span>{entry.review.fairnessVerdict}</span>
                  <b>{entry.review.score}</b>
                </a>
              ))}
            </div>
          )}

          <div className="run-composer">
            <label>
              <span>Competitor</span>
              <input value={competitor} onChange={(event) => setCompetitor(event.target.value)} />
            </label>
            <label>
              <span>Task</span>
              <select value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)}>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.gameName} - {task.title}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="primary-action" onClick={createRuntimeRun}>
              <Play size={17} />
              Agent Run
            </button>
            <button type="button" onClick={queueAgentProfileRun} disabled={!activeAgent}>
              <Bot size={17} />
              Profile Run
            </button>
            <button type="button" onClick={startAgentCampaign} disabled={!activeAgent}>
              <Bot size={17} />
              Campaign
            </button>
            <button type="button" onClick={submitHumanProofRun} disabled={!linkedHuman}>
              <ShieldCheck size={17} />
              Human Proof
            </button>
            <button type="button" onClick={submitPlannedSteamProofRun} disabled={!linkedHuman}>
              <ShieldCheck size={17} />
              Steam Proof
            </button>
            <button type="button" onClick={runHumanCampaignPack} disabled={!linkedHuman || !humanCampaignPlan?.source.campaignId || humanCampaignPlan.totals.ready === 0}>
              <ShieldCheck size={17} />
              Human Pack
            </button>
            <button type="button" onClick={createHeadToHeadMatch} disabled={!linkedHuman || !activeAgent}>
              <Trophy size={17} />
              Match
            </button>
            <button type="button" onClick={createChallenge} disabled={!linkedHuman || !activeAgent}>
              <Trophy size={17} />
              Challenge
            </button>
            <button type="button" onClick={runFirstChallenge} disabled={!challenges.some((entry) => entry.challenge.status === "open" || entry.challenge.status === "accepted")}>
              <Play size={17} />
              Run Challenge
            </button>
            <button type="button" onClick={runBenchmarkSuite} disabled={!linkedHuman || !activeAgent || benchmarkSuites.length === 0}>
              <CircleGauge size={17} />
              Suite
            </button>
            <button type="button" onClick={runFirstAgentLabTask} disabled={!agentRuntimeLabs.some((lab) => lab.status === "ready")}>
              <Bot size={17} />
              Lab Run
            </button>
          </div>

          {challenges.length > 0 && (
            <div className="challenge-strip" aria-label="Challenge queue">
              {challenges.slice(0, 4).map((entry) => (
                <a
                  key={entry.challenge.id}
                  href={entry.challenge.status === "scored" ? `/api/challenges/${entry.challenge.id}/evidence-bundle` : `/api/challenges/${entry.challenge.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <strong>{entry.task?.title ?? entry.challenge.taskId}</strong>
                  <span>{entry.human?.handle ?? entry.challenge.humanUserId} vs {entry.agent?.handle ?? entry.challenge.agentId}</span>
                  <b>{entry.challenge.status}</b>
                </a>
              ))}
            </div>
          )}

          <div className="task-grid">
            {filteredTasks.map((task) => (
              <article key={task.id} className={`task-card ${task.suitability}`}>
                {(() => {
                  const review = reviewByTask.get(task.id);
                  return review ? (
                    <div className={`review-badge ${review.decision}`}>
                      <span>{review.decision}</span>
                      <b>{review.score}</b>
                    </div>
                  ) : null;
                })()}
                <div className="task-topline">
                  <span>{task.gameName}</span>
                  <b>Lv {task.level}</b>
                </div>
                <h3>{task.title}</h3>
                <p>{task.objective}</p>
                <div className="task-meta">
                  <span>{task.track}</span>
                  <span>{task.suitability}</span>
                  <span>{task.fairnessVerdict}</span>
                  <span>{task.estimatedRuntimeMinutes}m</span>
                  <span>{task.score} pts</span>
                </div>
                {task.metricName && (
                  <div className="task-rule">
                    <span>{task.metricName}</span>
                    <strong>{task.targetValue}</strong>
                  </div>
                )}
                {reviewByTask.get(task.id) && (
                  <div className="review-detail">
                    <span>{reviewByTask.get(task.id)?.fairnessVerdict}</span>
                    <span>{reviewByTask.get(task.id)?.risks.length ?? 0} risks</span>
                    <span>{reviewByTask.get(task.id)?.reviewRequired ? "review" : "auto-rank"}</span>
                  </div>
                )}
                {readinessByTask.get(task.id) && (
                  <div className={`readiness-detail ${readinessByTask.get(task.id)?.ready ? "ready" : "blocked"}`}>
                    <span>{readinessByTask.get(task.id)?.ready ? "runtime-ready" : "missing runtime"}</span>
                    <span>{readinessByTask.get(task.id)?.missingCapabilities.length ?? 0} gaps</span>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      </section>

      <section className="runs-band">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Submission Queue</p>
            <h2>Recent runtime and human attempts</h2>
          </div>
          <div className="metric-pill">{runs.length} runs / {users.length} users / {agents.length} agents / {matches.length} matches</div>
        </div>
        <div className="run-list">
          {runs.slice(0, 6).map((run) => (
            <div key={run.id} className="run-row">
              <strong>{run.competitor}</strong>
              <span>{run.status}</span>
              <span>{run.workerId ?? run.runtimeProvider}</span>
              <span>{run.eventCount} events</span>
              <b>{run.score ?? "pending"}</b>
              <a href={`/api/runs/${run.id}/agent-trace`} target="_blank" rel="noreferrer">Trace</a>
            </div>
          ))}
        </div>
        {agentRuntimeLabs.length > 0 && (
          <div className="agent-lab-grid" aria-label="Agent runtime labs">
            {agentRuntimeLabs.slice(0, 4).map((lab) => {
              const readyTask = lab.recommendedTasks.find((entry) => entry.priority === "ready") ?? lab.recommendedTasks[0];
              return (
                <a key={lab.agent.id} className={`agent-lab-card ${lab.status}`} href={`/api/agents/${lab.agent.id}/lab`} target="_blank" rel="noreferrer">
                  <div className="agent-lab-title">
                    <strong>{lab.agent.displayName}</strong>
                    <span>{lab.status}</span>
                  </div>
                  <div className="agent-lab-metrics">
                    <span>{lab.totals.scoredRuns} scored</span>
                    <span>{lab.totals.openChallenges} challenges</span>
                    <span>{lab.totals.activeRuns + lab.totals.queuedRuns} queued/live</span>
                    <span>{lab.totals.totalScore} pts</span>
                  </div>
                  {readyTask && (
                    <div className="agent-lab-task">
                      <b>{readyTask.task.title}</b>
                      <span>{readyTask.priority} · {readyTask.task.gameName}</span>
                    </div>
                  )}
                  <em>{lab.capabilities.missingAcrossRecommended.length ? lab.capabilities.missingAcrossRecommended.slice(0, 3).join(", ") : lab.command}</em>
                </a>
              );
            })}
          </div>
        )}
        {agentCampaigns.length > 0 && (
          <div className="agent-lab-grid" aria-label="Agent benchmark campaigns">
            {agentCampaigns.slice(0, 4).map((report) => (
              <a key={report.campaign.id} className={`agent-lab-card ${report.status === "scoreboard-ready" ? "ready" : report.status === "needs-attention" ? "blocked" : "paused"}`} href={`/api/campaigns/${report.campaign.id}/result-certificate`} target="_blank" rel="noreferrer">
                <div className="agent-lab-title">
                  <strong>{report.agent?.displayName ?? report.campaign.agentId}</strong>
                  <span>{report.status}</span>
                </div>
                <div className="agent-lab-metrics">
                  <span>{report.totals.runs} runs</span>
                  <span>{report.totals.dispatches} dispatches</span>
                  <span>{report.totals.scored} scored</span>
                  <span>{report.totals.totalScore} pts</span>
                </div>
                <div className="agent-lab-task">
                  <b>{report.items[0]?.task?.title ?? "Campaign"}</b>
                  <span>{report.totals.scoreboardRows}/{report.totals.tasks} scoreboard rows</span>
                </div>
                <em>{report.nextActions[0] ?? report.campaign.summary}</em>
              </a>
            ))}
          </div>
        )}
        {agentCampaignStandings && agentCampaignStandings.leaderboard.length > 0 && (
          <div className="leaderboard-panel" aria-label="Agent campaign standings">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Campaign Standings</p>
                <h2>Agent benchmark campaign totals.</h2>
              </div>
              <span>{agentCampaignStandings.totals.scoreboardReadyCampaigns}/{agentCampaignStandings.totals.campaigns} ready</span>
            </div>
            {agentCampaignStandings.leaderboard.slice(0, 5).map((entry) => (
              <div key={entry.campaignId} className="leaderboard-row">
                <span>#{entry.rank}</span>
                <strong>{entry.agentName}</strong>
                <span>{entry.status}</span>
                <span>{entry.scoreboardRows}/{entry.taskCount} tasks</span>
                <b>{entry.totalScore}</b>
              </div>
            ))}
          </div>
        )}
        {humanCampaignPlan && (
          <div className="leaderboard-panel" aria-label="Human benchmark campaign plan">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Human Campaign</p>
                <h2>{humanCampaignPlan.user.displayName} benchmark pack.</h2>
              </div>
              <span>{humanCampaignPlan.status}</span>
            </div>
            <div className="ops-summary">
              <span>{humanCampaignPlan.totals.alreadyScored}/{humanCampaignPlan.totals.tasks} scored</span>
              <span>{humanCampaignPlan.totals.ready} ready</span>
              <span>human {humanCampaignPlan.totals.humanScore}</span>
              <span>agent {humanCampaignPlan.totals.agentScore}</span>
              {humanCampaignPlan.links.comparisonResultCertificate && (
                <a href={humanCampaignPlan.links.comparisonResultCertificate} target="_blank" rel="noreferrer">certificate</a>
              )}
            </div>
            {humanCampaignPlan.items.slice(0, 4).map((entry) => (
              <a
                key={entry.task.id}
                className="leaderboard-row"
                href={entry.status === "ready" ? humanCampaignPlan.links.submitNext : humanCampaignPlan.links.proofPlan}
                target="_blank"
                rel="noreferrer"
              >
                <span>{entry.status}</span>
                <strong>{entry.task.title}</strong>
                <span>{entry.existingScore ?? "-"}</span>
                <span>{entry.agentScore ?? "-"}</span>
                <b>{entry.proofType}</b>
              </a>
            ))}
          </div>
        )}
        {steamProofReport && (
          <div className="leaderboard-panel" aria-label="Steam proof fetch report">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Steam Proof</p>
                <h2>{steamProofReport.user.displayName} proof fetch report.</h2>
              </div>
              <a href={`/api/users/${steamProofReport.user.id}/steam-proof-report${steamProofReport.appid ? `?appid=${steamProofReport.appid}` : ""}`} target="_blank" rel="noreferrer">{steamProofReport.status}</a>
            </div>
            <div className="ops-summary">
              <span>{steamProofReport.liveProofEnabled ? "live enabled" : "live blocked"}</span>
              <span>{steamProofReport.totals.verifiedProofs}/{steamProofReport.totals.achievementTasks} verified</span>
              <span>{steamProofReport.totals.mockProofs} mock</span>
              <span>{steamProofReport.totals.steamWebApiProofs} web api</span>
              <span>{steamProofReport.totals.cacheEntries} cache</span>
            </div>
            {steamProofReport.items.slice(0, 4).map((entry) => (
              <a key={entry.task.id} className="leaderboard-row" href={entry.action.verifyEndpoint ?? `/api/users/${steamProofReport.user.id}/steam-proof-plan`} target="_blank" rel="noreferrer">
                <span>{entry.proofStatus}</span>
                <strong>{entry.task.title}</strong>
                <span>{entry.proofSource ?? "-"}</span>
                <span>{entry.unlockTime ?? "-"}</span>
                <b>{entry.achievementApiName}</b>
              </a>
            ))}
          </div>
        )}
        {humanAgentComparison && (
          <div className="leaderboard-panel" aria-label="Human agent comparison">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Human vs Agent</p>
                <h2>{humanAgentComparison.human.displayName} vs {humanAgentComparison.agent?.displayName ?? humanAgentComparison.campaign.agentId}</h2>
              </div>
              <a href={humanAgentComparison.links.resultCertificate} target="_blank" rel="noreferrer">{humanAgentComparison.status}</a>
            </div>
            <div className="ops-summary">
              <span>{humanAgentComparison.totals.completeTasks}/{humanAgentComparison.totals.tasks} tasks</span>
              <span>human {humanAgentComparison.totals.humanScore}</span>
              <span>agent {humanAgentComparison.totals.agentScore}</span>
              <span>{humanAgentComparison.winner ?? "pending"}</span>
              <a href={humanAgentComparison.links.evidenceBundle} target="_blank" rel="noreferrer">evidence</a>
            </div>
            {humanAgentComparison.items.slice(0, 4).map((entry) => (
              <a key={entry.task.id} className="leaderboard-row" href={humanAgentComparison.links.resultCertificate} target="_blank" rel="noreferrer">
                <span>{entry.winner ?? entry.status}</span>
                <strong>{entry.task.title}</strong>
                <span>{entry.humanRow?.score ?? "-"}</span>
                <span>{entry.agentRow?.score ?? "-"}</span>
                <b>{entry.margin}</b>
              </a>
            ))}
          </div>
        )}
        <div className="ops-panel" aria-label="Runtime operations">
          <div className="ops-summary">
            <span>{workerQueue.queued.length} queued</span>
            <span>{workerQueue.leased.length} leased</span>
            <span>{workerQueue.expired.length} expired</span>
            <span>{proofReviewQueue.length} proofs pending</span>
          </div>
          <div className="ops-actions">
            <button type="button" onClick={requeueExpiredRuns} disabled={workerQueue.expired.length === 0}>
              <ShieldCheck size={17} />
              Recover Leases
            </button>
            <button type="button" onClick={() => dispatchFirstQueuedRun("local")} disabled={workerQueue.queued.length === 0}>
              <Cable size={17} />
              Dispatch Run
            </button>
            <button type="button" onClick={() => dispatchFirstQueuedRun("modal")} disabled={workerQueue.queued.length === 0}>
              <Cable size={17} />
              Modal Plan
            </button>
            <button type="button" onClick={runLatestAgentCampaign} disabled={agentCampaigns.length === 0}>
              <Play size={17} />
              Run Campaign
            </button>
            <button type="button" onClick={() => reviewFirstPendingProof("verified")} disabled={proofReviewQueue.length === 0}>
              <CheckCircle2 size={17} />
              Verify Proof
            </button>
            <button type="button" onClick={() => reviewFirstPendingProof("failed")} disabled={proofReviewQueue.length === 0}>
              Reject Proof
            </button>
          </div>
          {proofReviewQueue[0] && (
            <div className="review-queue-row">
              <strong>{proofReviewQueue[0].proof.type}</strong>
              <span>{proofReviewQueue[0].task?.title ?? proofReviewQueue[0].run?.taskId ?? "unknown task"}</span>
              <em>{proofReviewQueue[0].proof.summary}</em>
            </div>
          )}
        </div>
        {runtimeDispatches.length > 0 && (
          <div className="dispatch-strip" aria-label="Runtime dispatch tickets">
            {runtimeDispatches.slice(0, 4).map((entry) => (
              <a
                key={entry.dispatch.id}
                href={entry.dispatch.provider === "modal" ? `/api/dispatches/${entry.dispatch.id}/modal-package` : entry.dispatch.manifestUrl}
                target="_blank"
                rel="noreferrer"
              >
                <strong>{entry.task?.title ?? entry.dispatch.taskId}</strong>
                <span>{entry.dispatch.provider} · {entry.dispatch.status} · {entry.dispatch.workerId}</span>
                <em>{entry.dispatch.command}</em>
              </a>
            ))}
          </div>
        )}
        {latestStream && (
          <div className="broadcast-strip" aria-label="Latest broadcast">
            <div>
              <strong>{latestStream.title}</strong>
              <span>{latestStream.currentScene}</span>
            </div>
            <div>
              <span>{latestStream.status}</span>
              <b>{latestStream.viewerCount} watching</b>
              <em>{latestStream.playbackUrl}</em>
            </div>
          </div>
        )}
        {broadcastCenter && (
          <div className="broadcast-center" aria-label="Broadcast center">
            <div className="broadcast-feature">
              <strong>{broadcastCenter.featured?.stream.title ?? "No broadcasts yet"}</strong>
              <span>{broadcastCenter.featured?.task.title ?? "Waiting for runtime evidence"}</span>
              <b>{broadcastCenter.featured?.stream.status ?? "idle"}</b>
            </div>
            <div className="broadcast-metrics">
              <span>{broadcastCenter.totals.live} live</span>
              <span>{broadcastCenter.totals.viewers} viewers</span>
              <span>{broadcastCenter.totals.scoreboardReady} scoreboard-ready</span>
              <span>{broadcastCenter.totals.proofReady} proof-ready</span>
            </div>
            <div className="broadcast-replays">
              {broadcastCenter.scoreboardReady.slice(0, 3).map((row) => (
                <a key={row.stream.id} href={`/api/broadcasts/${row.stream.id}/result-certificate`} target="_blank" rel="noreferrer">
                  <strong>{row.task.gameName}</strong>
                  <span>{row.run.competitor}</span>
                  <b>{row.run.score ?? "-"}</b>
                </a>
              ))}
            </div>
          </div>
        )}
        <div className="proof-grid">
          <div>
            <strong>Matches</strong>
            {(activeMatchFeed?.matches ?? []).slice(0, 5).map((match) => (
              <span key={match.matchId}>
                {match.status} · {match.winner ?? "pending"}
              </span>
            ))}
          </div>
          <div>
            <strong>Standings</strong>
            {(standings?.competitors ?? []).slice(0, 5).map((entry) => (
              <span key={`${entry.type}-${entry.competitor}`}>
                #{entry.rank} {entry.competitor} · {entry.totalScore}
              </span>
            ))}
          </div>
          <div>
            <strong>Artifacts</strong>
            {artifacts.slice(0, 5).map((artifact) => (
              <span key={artifact.id}>
                {artifact.name} · {artifact.kind}
              </span>
            ))}
          </div>
          <div>
            <strong>Livestreams</strong>
            {streams.slice(0, 5).map((stream) => (
              <span key={stream.id}>
                {stream.status} · {stream.currentScene}
              </span>
            ))}
          </div>
          <div>
            <strong>Proofs</strong>
            {proofs.slice(0, 5).map((proof) => (
              <span key={proof.id}>
                {proof.status} · {proof.type}
              </span>
            ))}
          </div>
        </div>
        <div className="match-feed" aria-label="Human versus agent match feed">
          {(activeMatchFeed?.matches ?? []).slice(0, 4).map((match) => (
            <article key={match.matchId} className={`match-card ${match.winner ?? "pending"}`}>
              <div className="match-card-title">
                <strong>{match.task ?? match.taskId}</strong>
                <span>{match.game ?? "Steam task"} · {match.status}</span>
              </div>
              <div className="match-sides">
                <div>
                  <UserRound size={17} />
                  <span>{match.human.competitor}</span>
                  <b>{match.human.score ?? "-"}</b>
                </div>
                <div>
                  <Bot size={17} />
                  <span>{match.agent.competitor}</span>
                  <b>{match.agent.score ?? "-"}</b>
                </div>
              </div>
              <div className="match-card-meta">
                <span>{match.winner ?? "pending"}</span>
                <span>margin {match.margin ?? "-"}</span>
                <span>{match.track ?? "benchmark"}</span>
                <a href={`/api/matches/${match.matchId}/result-certificate`} target="_blank" rel="noreferrer">
                  certificate
                </a>
              </div>
            </article>
          ))}
        </div>
        <div className="audit-grid" aria-label="Run audit summaries">
          {auditSummaries.slice(0, 4).map((audit) => (
            <article key={audit.runId} className={`audit-card ${audit.verdict}`}>
              <div>
                <strong>{audit.competitor}</strong>
                <span>{audit.status}</span>
              </div>
              <b>{audit.score ?? "pending"}</b>
              <em>{audit.verdict}</em>
              <span>{audit.missingProofs.length ? audit.missingProofs.join(", ") : "proof complete"}</span>
              <a href={`/api/runs/${audit.runId}/evidence-bundle`} target="_blank" rel="noreferrer">
                evidence bundle
              </a>
              <a href={`/api/runs/${audit.runId}/result-certificate`} target="_blank" rel="noreferrer">
                certificate
              </a>
            </article>
          ))}
        </div>
        <div className="manifest-strip" aria-label="Execution manifests">
          {manifestSummaries.slice(0, 4).map((manifest) => (
            <div key={manifest.runId} className="manifest-row">
              <strong>{manifest.schemaVersion.replace("steambench.", "")}</strong>
              <span>{manifest.readiness ? "ready" : "blocked"}</span>
              <span>{manifest.launchProvider}/{manifest.runtimeProvider}</span>
              <b>{manifest.artifactName}</b>
            </div>
          ))}
        </div>
        <div className="leaderboard-grid" aria-label="Task leaderboards">
          {leaderboards.slice(0, 6).map((leaderboard) => (
            <article key={leaderboard.taskKey} className="leaderboard-card">
              <div className="leaderboard-title">
                <strong>{leaderboard.task}</strong>
                <span>{leaderboard.game}</span>
              </div>
              <div className="leaderboard-leader">
                <Trophy size={18} />
                <div>
                  <b>{leaderboard.leader.competitor}</b>
                  <span>{leaderboard.leader.score} pts</span>
                </div>
              </div>
              <div className="leaderboard-meta">
                <span>{leaderboard.track ?? "benchmark"}</span>
                {leaderboard.leader.metricValue !== undefined && (
                  <span>
                    {leaderboard.metricName}: {leaderboard.leader.metricValue}
                  </span>
                )}
                <span>H {leaderboard.humanLeader?.score ?? "-"}</span>
                <span>A {leaderboard.agentLeader?.score ?? "-"}</span>
              </div>
            </article>
          ))}
        </div>
        <div className="event-log" aria-label="Recent runtime evidence events">
          {events.slice(0, 8).map((event) => (
            <div key={event.id} className="event-row">
              <span>{event.type}</span>
              <strong>{event.message}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="runtime-band">
        <div>
          <p className="eyebrow">Runtime Harness</p>
          <h2>Agent runs need structured proof, not just screenshots.</h2>
        </div>
        <div className="runtime-steps">
          {[
            ["Plan", "Select app, account state, and target achievement."],
            ["Play", "Launch Steam runtime with event logging and recording."],
            ["Prove", "Validate Steam state plus canonical output.mp4 artifact."],
            ["Rank", "Normalize score against human and agent submissions."]
          ].map(([title, body]) => (
            <div key={title} className="runtime-step">
              <Trophy size={18} />
              <strong>{title}</strong>
              <span>{body}</span>
            </div>
          ))}
        </div>
        <div className="adapter-grid" aria-label="Steam runtime adapters">
          {runtimeAdapters.slice(0, 6).map((adapter) => (
            <article key={adapter.appid} className="adapter-card">
              <div className="adapter-topline">
                <strong>{adapter.gameName}</strong>
                <span>{adapter.launchUri}</span>
              </div>
              <div className="adapter-meta">
                <span>{adapter.inputMode}</span>
                <span>{adapter.captureMode}</span>
                <span>{adapter.saveStrategy}</span>
              </div>
              <p>{adapter.readinessChecks[0]}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
