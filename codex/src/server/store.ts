import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { scoreRunAttempt, type RunScoreMetadata } from "../benchmark/scoring";
import { buildFixtureTasks } from "../benchmark/task-generator";
import type { BenchmarkTask, CompetitorType, ScoreboardRow } from "../benchmark/types";
import { scoreboardFixture } from "../benchmark/catalog";
import type { SeasonScope } from "../benchmark/standings";
import type { RuntimeActionSpace } from "../runtime/action-space";
import type { RuntimeRunEvent, RuntimeEventType } from "../runtime/events";

export type SteamLinkIntent = {
  state: string;
  returnUrl: string;
  createdAt: string;
  status: "pending" | "linked";
  userId?: string;
  steamid?: string;
  claimedId?: string;
  verifiedAt?: string;
};

export type BenchmarkRun = {
  id: string;
  taskId: string;
  competitor: string;
  competitorType: CompetitorType;
  status: "queued" | "preparing" | "running" | "artifact-submitted" | "evaluating" | "scored" | "failed" | "canceled";
  createdAt: string;
  updatedAt: string;
  runtimeProvider: "manual" | "local-sim" | "modal";
  workerId?: string;
  claimedAt?: string;
  leaseExpiresAt?: string;
  heartbeatAt?: string;
  artifactName: string;
  artifactPath?: string;
  eventCount: number;
  score?: number;
  scoreMetadata?: RunScoreMetadata;
  failureCode?: string;
  failureMessage?: string;
};

export type RuntimeDispatch = {
  id: string;
  runId: string;
  taskId: string;
  agentId?: string;
  provider: "local" | "modal";
  status: "planned" | "launched" | "claimed" | "completed" | "failed" | "canceled";
  workerId: string;
  command: string;
  manifestUrl: string;
  runtimePackageUrl: string;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
  launchedAt?: string;
  completedAt?: string;
  summary?: string;
};

export type RuntimeControlSession = {
  id: string;
  runId: string;
  taskId: string;
  agentId?: string;
  status: "active" | "expired" | "revoked";
  actionSpace: RuntimeActionSpace;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  heartbeatAt?: string;
  summary?: string;
};

export type RunArtifact = {
  id: string;
  runId: string;
  kind: "video" | "replay" | "log" | "save" | "screenshot";
  name: string;
  uri: string;
  sizeBytes?: number;
  sha256?: string;
  idempotencyKey?: string;
  createdAt: string;
  canonical: boolean;
};

export type LiveStreamSession = {
  id: string;
  runId: string;
  status: "scheduled" | "live" | "ended" | "failed";
  provider: "hls" | "modal" | "webrtc" | "rtmp";
  title: string;
  ingestUrl: string;
  playbackUrl: string;
  thumbnailUrl: string;
  viewerCount: number;
  currentScene: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
};

export type RunProof = {
  id: string;
  runId: string;
  type: "steam-achievement" | "canonical-artifact" | "livestream" | "manual-review";
  status: "pending" | "verified" | "failed";
  createdAt: string;
  verifiedAt?: string;
  reviewedAt?: string;
  reviewer?: string;
  reviewNotes?: string;
  summary: string;
  metadata?: Record<string, string | number | boolean>;
};

export type TaskRegistryEntry = BenchmarkTask & {
  status: "candidate" | "active" | "rejected";
  importedAt: string;
  updatedAt: string;
  reviewNotes?: string;
};

export type SteamAppDiscoveryCandidate = {
  id: string;
  appid: number;
  name: string;
  query: string;
  source: "fixture" | "steam-live";
  status: "candidate" | "shortlisted" | "imported" | "rejected";
  benchmarkFit: number;
  harnessRisk: "low" | "medium" | "high";
  tracks: BenchmarkTask["track"][];
  estimatedAchievementTasks: number;
  reasons: string[];
  riskNotes: string[];
  discoveredAt: string;
  updatedAt: string;
  importedAt?: string;
  reviewNotes?: string;
};

export type UserAccount = {
  id: string;
  handle: string;
  displayName: string;
  type: CompetitorType;
  createdAt: string;
  linkedSteamId?: string;
  proofConsentAt?: string;
  proofConsentRevokedAt?: string;
};

export type AgentProfile = {
  id: string;
  userId: string;
  handle: string;
  displayName: string;
  provider: "local" | "modal" | "external";
  runtimeProvider: BenchmarkRun["runtimeProvider"];
  command: string;
  capabilities: string[];
  status: "active" | "paused";
  createdAt: string;
  updatedAt: string;
};

export type BenchmarkMatch = {
  id: string;
  taskId: string;
  humanUserId: string;
  agentId: string;
  humanRunId?: string;
  agentRunId?: string;
  status: "scheduled" | "running" | "scored" | "failed" | "canceled";
  createdAt: string;
  updatedAt: string;
  winner?: "human" | "agent" | "tie";
  margin?: number;
  summary?: string;
};

export type BenchmarkChallenge = {
  id: string;
  taskId: string;
  humanUserId: string;
  agentId: string;
  createdBy: "human" | "agent" | "system";
  createdById: string;
  status: "open" | "accepted" | "running" | "scored" | "declined" | "canceled" | "blocked";
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
  resolvedAt?: string;
  matchId?: string;
  summary?: string;
};

export type BenchmarkSuiteRace = {
  id: string;
  suiteId: string;
  eventScope?: SeasonScope;
  appid: number;
  title: string;
  taskIds: string[];
  matchIds: string[];
  humanUserId: string;
  agentId: string;
  status: "scheduled" | "running" | "scored" | "blocked";
  createdAt: string;
  updatedAt: string;
  winner?: "human" | "agent" | "tie";
  margin?: number;
  humanScore?: number;
  agentScore?: number;
  summary?: string;
};

export type BenchmarkAgentCampaign = {
  id: string;
  agentId: string;
  provider: RuntimeDispatch["provider"];
  status: "planned" | "running" | "scoreboard-ready" | "needs-attention";
  requestedTaskCount: number;
  taskIds: string[];
  runIds: string[];
  dispatchIds: string[];
  reviewApproved: boolean;
  createdAt: string;
  updatedAt: string;
  summary?: string;
};

export type GameCoverageRunRecord = {
  id: string;
  appid: number;
  gameName: string;
  requestedSide: "human" | "agent" | "both";
  humanUserId?: string;
  agentId?: string;
  runIds: string[];
  humanRunIds: string[];
  agentRunIds: string[];
  completedRuns: number;
  scoreboardReady: number;
  remainingHumanGaps: number;
  remainingAgentGaps: number;
  status: "scoreboard-ready" | "partial" | "empty";
  createdAt: string;
  updatedAt: string;
  summary?: string;
};

export type CompetitionEventRegistration = {
  id: string;
  eventScope: SeasonScope;
  participantType: "human" | "agent";
  participantId: string;
  status: "registered" | "withdrawn";
  createdAt: string;
  updatedAt: string;
  notes?: string;
};

export type StoreSnapshot = {
  users: UserAccount[];
  agents: AgentProfile[];
  matches: BenchmarkMatch[];
  challenges: BenchmarkChallenge[];
  suiteRaces: BenchmarkSuiteRace[];
  agentCampaigns: BenchmarkAgentCampaign[];
  gameCoverageRuns: GameCoverageRunRecord[];
  eventRegistrations: CompetitionEventRegistration[];
  steamLinks: SteamLinkIntent[];
  runs: BenchmarkRun[];
  dispatches: RuntimeDispatch[];
  controlSessions: RuntimeControlSession[];
  events: RuntimeRunEvent[];
  artifacts: RunArtifact[];
  streams: LiveStreamSession[];
  proofs: RunProof[];
  taskRegistry: TaskRegistryEntry[];
  steamAppDiscoveries: SteamAppDiscoveryCandidate[];
  scoreboard: ScoreboardRow[];
};

const defaultStorePath = resolve(process.cwd(), "data", "steambench-store.json");

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isoInMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export class SteambenchStore {
  private snapshot: StoreSnapshot | null = null;

  constructor(private readonly storePath = process.env.STEAMBENCH_STORE_PATH ?? defaultStorePath) {}

  async read(): Promise<StoreSnapshot> {
    if (this.snapshot) return this.snapshot;

    try {
      const raw = await readFile(this.storePath, "utf-8");
      this.snapshot = JSON.parse(raw) as StoreSnapshot;
      this.snapshot.users ??= [];
      this.snapshot.agents ??= [];
      this.snapshot.matches ??= [];
      this.snapshot.challenges ??= [];
      this.snapshot.suiteRaces ??= [];
      this.snapshot.agentCampaigns ??= [];
      this.snapshot.gameCoverageRuns ??= [];
      this.snapshot.eventRegistrations ??= [];
      this.snapshot.steamLinks ??= [];
      this.snapshot.runs ??= [];
      this.snapshot.dispatches ??= [];
      this.snapshot.controlSessions ??= [];
      for (const run of this.snapshot.runs) {
        run.runtimeProvider ??= "local-sim";
      }
      this.snapshot.events ??= [];
      this.snapshot.artifacts ??= [];
      this.snapshot.streams ??= [];
      for (const stream of this.snapshot.streams) {
        const provider = stream.provider as string | undefined;
        stream.provider = provider === "local-hls" ? "hls" : stream.provider ?? "hls";
        stream.thumbnailUrl ??= `/streams/${stream.runId}.jpg`;
        stream.viewerCount ??= 0;
        stream.currentScene ??= stream.status === "ended" ? "Run complete" : "Waiting for runtime";
      }
      this.snapshot.proofs ??= [];
      this.snapshot.taskRegistry ??= [];
      this.snapshot.steamAppDiscoveries ??= [];
      this.snapshot.scoreboard ??= scoreboardFixture;
    } catch {
      this.snapshot = {
        users: [],
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
        scoreboard: scoreboardFixture
      };
      await this.write();
    }

    return this.snapshot;
  }

  async createSteamLinkIntent(returnUrl: string, userId?: string): Promise<SteamLinkIntent> {
    const snapshot = await this.read();
    const intent: SteamLinkIntent = {
      state: newId("steam"),
      returnUrl,
      createdAt: nowIso(),
      status: "pending",
      userId
    };
    snapshot.steamLinks.unshift(intent);
    await this.write();
    return intent;
  }

  async createUser(input: { handle: string; displayName?: string; type: CompetitorType }): Promise<UserAccount> {
    const snapshot = await this.read();
    const normalizedHandle = input.handle.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 32);
    const user: UserAccount = {
      id: newId("usr"),
      handle: normalizedHandle || `player-${snapshot.users.length + 1}`,
      displayName: input.displayName?.trim() || input.handle.trim() || "Steambench Player",
      type: input.type,
      createdAt: nowIso()
    };
    snapshot.users.unshift(user);
    await this.write();
    return user;
  }

  async createAgentProfile(input: {
    handle: string;
    displayName?: string;
    provider?: AgentProfile["provider"];
    runtimeProvider?: BenchmarkRun["runtimeProvider"];
    command?: string;
    capabilities?: string[];
  }): Promise<AgentProfile> {
    const user = await this.createUser({
      handle: input.handle,
      displayName: input.displayName ?? input.handle,
      type: "agent"
    });
    const snapshot = await this.read();
    const timestamp = nowIso();
    const profile: AgentProfile = {
      id: newId("agent"),
      userId: user.id,
      handle: user.handle,
      displayName: user.displayName,
      provider: input.provider ?? "local",
      runtimeProvider: input.runtimeProvider ?? "local-sim",
      command: input.command?.trim() || "node scripts/runtime-worker.mjs",
      capabilities: input.capabilities?.length
        ? input.capabilities
        : ["keyboard-mouse", "controller", "turn-based-actions", "screen-capture", "stats-screen", "action-log", "seeded-save", "manual-review", "output.mp4"],
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    snapshot.agents.unshift(profile);
    await this.write();
    return profile;
  }

  async listAgentProfiles(): Promise<AgentProfile[]> {
    const snapshot = await this.read();
    return snapshot.agents;
  }

  async findAgentProfile(agentIdOrHandle: string): Promise<AgentProfile | null> {
    const snapshot = await this.read();
    return (
      snapshot.agents.find(
        (entry) =>
          entry.id === agentIdOrHandle ||
          entry.handle === agentIdOrHandle ||
          `agent:${entry.handle}` === agentIdOrHandle ||
          entry.displayName === agentIdOrHandle
      ) ?? null
    );
  }

  async updateAgentProfileStatus(
    agentId: string,
    status: AgentProfile["status"]
  ): Promise<AgentProfile | null> {
    const snapshot = await this.read();
    const profile = snapshot.agents.find((entry) => entry.id === agentId);
    if (!profile) return null;
    profile.status = status;
    profile.updatedAt = nowIso();
    await this.write();
    return profile;
  }

  async linkSteamToUser(userId: string, steamid: string, options: { proofConsent?: boolean } = {}): Promise<UserAccount | null> {
    const snapshot = await this.read();
    const user = snapshot.users.find((entry) => entry.id === userId);
    if (!user) return null;
    user.linkedSteamId = steamid;
    if (options.proofConsent) {
      user.proofConsentAt = nowIso();
      user.proofConsentRevokedAt = undefined;
    }
    await this.write();
    return user;
  }

  async updateSteamProofConsent(userId: string, consented: boolean): Promise<UserAccount | null> {
    const snapshot = await this.read();
    const user = snapshot.users.find((entry) => entry.id === userId);
    if (!user) return null;
    const timestamp = nowIso();
    if (consented) {
      user.proofConsentAt = timestamp;
      user.proofConsentRevokedAt = undefined;
    } else {
      user.proofConsentAt = undefined;
      user.proofConsentRevokedAt = timestamp;
    }
    await this.write();
    return user;
  }

  async markSteamLinked(state: string, steamid: string, claimedId?: string): Promise<SteamLinkIntent | null> {
    const snapshot = await this.read();
    const intent = snapshot.steamLinks.find((entry) => entry.state === state);
    if (!intent) return null;
    intent.status = "linked";
    intent.steamid = steamid;
    intent.claimedId = claimedId;
    intent.verifiedAt = nowIso();
    if (intent.userId) {
      const user = snapshot.users.find((entry) => entry.id === intent.userId);
      if (user) user.linkedSteamId = steamid;
    }
    await this.write();
    return intent;
  }

  async createRun(input: {
    taskId: string;
    competitor: string;
    competitorType: CompetitorType;
    runtimeProvider?: BenchmarkRun["runtimeProvider"];
  }): Promise<BenchmarkRun | null> {
    const task = await this.findTask(input.taskId);
    if (!task) return null;

    const snapshot = await this.read();
    const timestamp = nowIso();
    const run: BenchmarkRun = {
      id: newId("run"),
      taskId: input.taskId,
      competitor: input.competitor,
      competitorType: input.competitorType,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      runtimeProvider: input.runtimeProvider ?? "local-sim",
      artifactName: "output.mp4",
      eventCount: 0
    };
    snapshot.runs.unshift(run);
    await this.write();
    return run;
  }

  async createRuntimeDispatch(input: {
    runId: string;
    agentId?: string;
    provider: RuntimeDispatch["provider"];
    workerId: string;
    command: string;
    manifestUrl: string;
    runtimePackageUrl: string;
    idempotencyKey?: string;
    summary?: string;
  }): Promise<RuntimeDispatch | null> {
    const snapshot = await this.read();
    const run = snapshot.runs.find((entry) => entry.id === input.runId);
    if (!run) return null;
    if (input.idempotencyKey) {
      const existing = snapshot.dispatches.find((entry) => entry.idempotencyKey === input.idempotencyKey);
      if (existing) return existing;
    }

    const timestamp = nowIso();
    const dispatch: RuntimeDispatch = {
      id: newId("dispatch"),
      runId: run.id,
      taskId: run.taskId,
      agentId: input.agentId,
      provider: input.provider,
      status: "planned",
      workerId: input.workerId,
      command: input.command,
      manifestUrl: input.manifestUrl,
      runtimePackageUrl: input.runtimePackageUrl,
      idempotencyKey: input.idempotencyKey,
      createdAt: timestamp,
      updatedAt: timestamp,
      summary: input.summary?.trim() || `${input.provider} dispatch planned for run ${run.id}.`
    };
    snapshot.dispatches.unshift(dispatch);
    await this.write();
    return dispatch;
  }

  async listRuntimeDispatches(): Promise<RuntimeDispatch[]> {
    const snapshot = await this.read();
    return snapshot.dispatches;
  }

  async updateRuntimeDispatchStatus(
    dispatchId: string,
    status: RuntimeDispatch["status"],
    summary?: string
  ): Promise<RuntimeDispatch | null> {
    const snapshot = await this.read();
    const dispatch = snapshot.dispatches.find((entry) => entry.id === dispatchId);
    if (!dispatch) return null;
    dispatch.status = status;
    dispatch.updatedAt = nowIso();
    dispatch.summary = summary?.trim() || dispatch.summary;
    if (status === "launched") dispatch.launchedAt = dispatch.updatedAt;
    if (status === "completed" || status === "failed" || status === "canceled") {
      dispatch.completedAt = dispatch.updatedAt;
    }
    await this.write();
    return dispatch;
  }

  async createRuntimeControlSession(input: {
    runId: string;
    agentId?: string;
    ttlSeconds: number;
    actionSpace: RuntimeActionSpace;
    idempotencyKey?: string;
    summary?: string;
  }): Promise<RuntimeControlSession | null> {
    const snapshot = await this.read();
    const run = snapshot.runs.find((entry) => entry.id === input.runId);
    if (!run) return null;
    if (input.idempotencyKey) {
      const existing = snapshot.controlSessions.find((entry) => entry.runId === run.id && entry.idempotencyKey === input.idempotencyKey);
      if (existing) return existing;
    }
    const timestamp = nowIso();
    const session: RuntimeControlSession = {
      id: newId("control"),
      runId: run.id,
      taskId: run.taskId,
      agentId: input.agentId,
      status: "active",
      actionSpace: input.actionSpace,
      idempotencyKey: input.idempotencyKey,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(Date.now() + Math.max(1, input.ttlSeconds) * 1000).toISOString(),
      summary: input.summary?.trim() || `${input.actionSpace.transport} control session granted for run ${run.id}.`
    };
    snapshot.controlSessions.unshift(session);
    await this.write();
    return session;
  }

  async listRuntimeControlSessions(runId?: string): Promise<RuntimeControlSession[]> {
    const snapshot = await this.read();
    const sessions = runId === undefined ? snapshot.controlSessions : snapshot.controlSessions.filter((entry) => entry.runId === runId);
    const now = Date.now();
    let changed = false;
    for (const session of sessions) {
      if (session.status === "active" && Date.parse(session.expiresAt) <= now) {
        session.status = "expired";
        session.updatedAt = nowIso();
        changed = true;
      }
    }
    if (changed) await this.write();
    return sessions;
  }

  async getRuntimeControlSession(sessionId: string): Promise<RuntimeControlSession | null> {
    const sessions = await this.listRuntimeControlSessions();
    return sessions.find((entry) => entry.id === sessionId) ?? null;
  }

  async heartbeatRuntimeControlSession(sessionId: string): Promise<RuntimeControlSession | null> {
    const snapshot = await this.read();
    const session = snapshot.controlSessions.find((entry) => entry.id === sessionId);
    if (!session) return null;
    if (session.status === "active" && Date.parse(session.expiresAt) <= Date.now()) {
      session.status = "expired";
    }
    if (session.status === "active") {
      session.heartbeatAt = nowIso();
    }
    session.updatedAt = nowIso();
    await this.write();
    return session;
  }

  async revokeRuntimeControlSession(sessionId: string, summary?: string): Promise<RuntimeControlSession | null> {
    const snapshot = await this.read();
    const session = snapshot.controlSessions.find((entry) => entry.id === sessionId);
    if (!session) return null;
    session.status = "revoked";
    session.updatedAt = nowIso();
    session.summary = summary?.trim() || session.summary;
    await this.write();
    return session;
  }

  async createMatch(input: {
    taskId: string;
    humanUserId: string;
    agentId: string;
  }): Promise<BenchmarkMatch | null> {
    const task = await this.findTask(input.taskId);
    const snapshot = await this.read();
    const human = snapshot.users.find((entry) => entry.id === input.humanUserId && entry.type === "human");
    const agent = snapshot.agents.find((entry) => entry.id === input.agentId && entry.status === "active");
    if (!task || !human || !agent || !human.linkedSteamId || !human.proofConsentAt) return null;

    const timestamp = nowIso();
    const match: BenchmarkMatch = {
      id: newId("match"),
      taskId: input.taskId,
      humanUserId: human.id,
      agentId: agent.id,
      status: "scheduled",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    snapshot.matches.unshift(match);
    await this.write();
    return match;
  }

  async createChallenge(input: {
    taskId: string;
    humanUserId: string;
    agentId: string;
    createdBy: BenchmarkChallenge["createdBy"];
    createdById: string;
    summary?: string;
  }): Promise<BenchmarkChallenge | null> {
    const task = await this.findTask(input.taskId);
    const snapshot = await this.read();
    const human = snapshot.users.find((entry) => entry.id === input.humanUserId && entry.type === "human");
    const agent = snapshot.agents.find((entry) => entry.id === input.agentId);
    if (!task || !human || !agent) return null;

    const timestamp = nowIso();
    const challenge: BenchmarkChallenge = {
      id: newId("challenge"),
      taskId: input.taskId,
      humanUserId: human.id,
      agentId: agent.id,
      createdBy: input.createdBy,
      createdById: input.createdById,
      status: "open",
      createdAt: timestamp,
      updatedAt: timestamp,
      summary: input.summary?.trim() || `${human.displayName} challenged ${agent.displayName} on ${task.title}.`
    };
    snapshot.challenges.unshift(challenge);
    await this.write();
    return challenge;
  }

  async listChallenges(): Promise<BenchmarkChallenge[]> {
    const snapshot = await this.read();
    return snapshot.challenges;
  }

  async updateChallengeStatus(
    challengeId: string,
    status: Extract<BenchmarkChallenge["status"], "declined" | "canceled" | "blocked">,
    summary?: string
  ): Promise<BenchmarkChallenge | null> {
    const snapshot = await this.read();
    const challenge = snapshot.challenges.find((entry) => entry.id === challengeId);
    if (!challenge || challenge.status === "scored") return null;
    challenge.status = status;
    challenge.updatedAt = nowIso();
    challenge.resolvedAt = status === "declined" || status === "canceled" || status === "blocked" ? challenge.updatedAt : challenge.resolvedAt;
    challenge.summary = summary?.trim() || challenge.summary;
    await this.write();
    return challenge;
  }

  async acceptChallenge(challengeId: string): Promise<{ challenge: BenchmarkChallenge; match: BenchmarkMatch } | null> {
    const snapshot = await this.read();
    const challenge = snapshot.challenges.find((entry) => entry.id === challengeId);
    if (!challenge || (challenge.status !== "open" && challenge.status !== "accepted")) return null;

    const existingMatch = challenge.matchId ? snapshot.matches.find((entry) => entry.id === challenge.matchId) : undefined;
    const match = existingMatch ?? await this.createMatch({
      taskId: challenge.taskId,
      humanUserId: challenge.humanUserId,
      agentId: challenge.agentId
    });
    if (!match) {
      challenge.status = "blocked";
      challenge.updatedAt = nowIso();
      challenge.resolvedAt = challenge.updatedAt;
      challenge.summary = "Challenge could not create an eligible match contract.";
      await this.write();
      return null;
    }

    challenge.status = match.status === "running" ? "running" : match.status === "scored" ? "scored" : "accepted";
    challenge.matchId = match.id;
    challenge.acceptedAt ??= nowIso();
    challenge.updatedAt = challenge.acceptedAt;
    await this.write();
    return { challenge, match };
  }

  async syncChallengeFromMatch(challengeId: string): Promise<BenchmarkChallenge | null> {
    const snapshot = await this.read();
    const challenge = snapshot.challenges.find((entry) => entry.id === challengeId);
    const match = challenge?.matchId ? snapshot.matches.find((entry) => entry.id === challenge.matchId) : undefined;
    if (!challenge || !match) return challenge ?? null;

    challenge.status =
      match.status === "scheduled"
        ? "accepted"
        : match.status === "running"
          ? "running"
          : match.status === "scored"
            ? "scored"
            : match.status === "canceled"
              ? "canceled"
              : "blocked";
    challenge.updatedAt = match.updatedAt;
    if (match.status === "scored" || match.status === "failed" || match.status === "canceled") {
      challenge.resolvedAt = match.updatedAt;
    }
    challenge.summary = match.summary ?? challenge.summary;
    await this.write();
    return challenge;
  }

  async createSuiteRace(input: {
    suiteId: string;
    eventScope?: SeasonScope;
    appid: number;
    title: string;
    taskIds: string[];
    matchIds: string[];
    humanUserId: string;
    agentId: string;
    summary?: string;
  }): Promise<BenchmarkSuiteRace> {
    const snapshot = await this.read();
    const timestamp = nowIso();
    const race: BenchmarkSuiteRace = {
      id: newId("suite_race"),
      suiteId: input.suiteId,
      eventScope: input.eventScope,
      appid: input.appid,
      title: input.title,
      taskIds: input.taskIds,
      matchIds: input.matchIds,
      humanUserId: input.humanUserId,
      agentId: input.agentId,
      status: "scheduled",
      createdAt: timestamp,
      updatedAt: timestamp,
      summary: input.summary
    };
    snapshot.suiteRaces.unshift(race);
    await this.write();
    return race;
  }

  async listSuiteRaces(): Promise<BenchmarkSuiteRace[]> {
    const snapshot = await this.read();
    return snapshot.suiteRaces;
  }

  async createAgentCampaign(input: {
    agentId: string;
    provider: RuntimeDispatch["provider"];
    requestedTaskCount: number;
    taskIds: string[];
    runIds: string[];
    dispatchIds?: string[];
    reviewApproved?: boolean;
    summary?: string;
  }): Promise<BenchmarkAgentCampaign | null> {
    const snapshot = await this.read();
    const agent = snapshot.agents.find((entry) => entry.id === input.agentId);
    if (!agent) return null;
    const timestamp = nowIso();
    const campaign: BenchmarkAgentCampaign = {
      id: newId("agent_campaign"),
      agentId: agent.id,
      provider: input.provider,
      status: "planned",
      requestedTaskCount: input.requestedTaskCount,
      taskIds: input.taskIds,
      runIds: input.runIds,
      dispatchIds: input.dispatchIds ?? [],
      reviewApproved: Boolean(input.reviewApproved),
      createdAt: timestamp,
      updatedAt: timestamp,
      summary: input.summary?.trim() || `${agent.displayName} benchmark campaign queued ${input.runIds.length} runs.`
    };
    snapshot.agentCampaigns.unshift(campaign);
    await this.write();
    return campaign;
  }

  async listAgentCampaigns(agentId?: string): Promise<BenchmarkAgentCampaign[]> {
    const snapshot = await this.read();
    return agentId ? snapshot.agentCampaigns.filter((entry) => entry.agentId === agentId) : snapshot.agentCampaigns;
  }

  async getAgentCampaign(campaignId: string): Promise<BenchmarkAgentCampaign | null> {
    const snapshot = await this.read();
    return snapshot.agentCampaigns.find((entry) => entry.id === campaignId) ?? null;
  }

  async updateAgentCampaignStatus(
    campaignId: string,
    status: BenchmarkAgentCampaign["status"],
    summary?: string
  ): Promise<BenchmarkAgentCampaign | null> {
    const snapshot = await this.read();
    const campaign = snapshot.agentCampaigns.find((entry) => entry.id === campaignId);
    if (!campaign) return null;
    campaign.status = status;
    campaign.updatedAt = nowIso();
    campaign.summary = summary?.trim() || campaign.summary;
    await this.write();
    return campaign;
  }

  async createGameCoverageRun(input: {
    appid: number;
    gameName: string;
    requestedSide: GameCoverageRunRecord["requestedSide"];
    humanUserId?: string;
    agentId?: string;
    runIds: string[];
    humanRunIds?: string[];
    agentRunIds?: string[];
    scoreboardReady: number;
    remainingHumanGaps: number;
    remainingAgentGaps: number;
    summary?: string;
  }): Promise<GameCoverageRunRecord> {
    const snapshot = await this.read();
    const timestamp = nowIso();
    const status: GameCoverageRunRecord["status"] =
      input.runIds.length === 0
        ? "empty"
        : input.scoreboardReady === input.runIds.length
          ? "scoreboard-ready"
          : "partial";
    const record: GameCoverageRunRecord = {
      id: newId("coverage_run"),
      appid: input.appid,
      gameName: input.gameName,
      requestedSide: input.requestedSide,
      humanUserId: input.humanUserId,
      agentId: input.agentId,
      runIds: input.runIds,
      humanRunIds: input.humanRunIds ?? [],
      agentRunIds: input.agentRunIds ?? [],
      completedRuns: input.runIds.length,
      scoreboardReady: input.scoreboardReady,
      remainingHumanGaps: input.remainingHumanGaps,
      remainingAgentGaps: input.remainingAgentGaps,
      status,
      createdAt: timestamp,
      updatedAt: timestamp,
      summary: input.summary?.trim() || `${input.gameName} coverage local run completed ${input.scoreboardReady}/${input.runIds.length} scoreboard-ready runs.`
    };
    snapshot.gameCoverageRuns.unshift(record);
    await this.write();
    return record;
  }

  async listGameCoverageRuns(appid?: number): Promise<GameCoverageRunRecord[]> {
    const snapshot = await this.read();
    return appid === undefined ? snapshot.gameCoverageRuns : snapshot.gameCoverageRuns.filter((entry) => entry.appid === appid);
  }

  async getGameCoverageRun(recordId: string): Promise<GameCoverageRunRecord | null> {
    const snapshot = await this.read();
    return snapshot.gameCoverageRuns.find((entry) => entry.id === recordId) ?? null;
  }

  async listCompetitionEventRegistrations(): Promise<CompetitionEventRegistration[]> {
    const snapshot = await this.read();
    return snapshot.eventRegistrations;
  }

  async registerCompetitionEvent(input: {
    eventScope: SeasonScope;
    participantType: CompetitionEventRegistration["participantType"];
    participantId: string;
    notes?: string;
  }): Promise<CompetitionEventRegistration> {
    const snapshot = await this.read();
    const timestamp = nowIso();
    const existing = snapshot.eventRegistrations.find(
      (entry) =>
        entry.eventScope === input.eventScope &&
        entry.participantType === input.participantType &&
        entry.participantId === input.participantId
    );
    if (existing) {
      existing.status = "registered";
      existing.updatedAt = timestamp;
      existing.notes = input.notes?.trim() || existing.notes;
      await this.write();
      return existing;
    }

    const registration: CompetitionEventRegistration = {
      id: newId("event_reg"),
      eventScope: input.eventScope,
      participantType: input.participantType,
      participantId: input.participantId,
      status: "registered",
      createdAt: timestamp,
      updatedAt: timestamp,
      notes: input.notes?.trim() || undefined
    };
    snapshot.eventRegistrations.unshift(registration);
    await this.write();
    return registration;
  }

  async withdrawCompetitionEventRegistration(registrationId: string): Promise<CompetitionEventRegistration | null> {
    const snapshot = await this.read();
    const registration = snapshot.eventRegistrations.find((entry) => entry.id === registrationId);
    if (!registration) return null;
    registration.status = "withdrawn";
    registration.updatedAt = nowIso();
    await this.write();
    return registration;
  }

  async evaluateSuiteRace(raceId: string): Promise<{
    race: BenchmarkSuiteRace;
    matches: BenchmarkMatch[];
  } | null> {
    const snapshot = await this.read();
    const race = snapshot.suiteRaces.find((entry) => entry.id === raceId);
    if (!race) return null;
    const matches = race.matchIds
      .map((matchId) => snapshot.matches.find((match) => match.id === matchId))
      .filter((match): match is BenchmarkMatch => Boolean(match));
    if (matches.length !== race.matchIds.length) {
      race.status = "blocked";
      race.summary = "One or more suite race matches are missing.";
      race.updatedAt = nowIso();
      await this.write();
      return { race, matches };
    }

    const unscored = matches.filter((match) => match.status !== "scored");
    if (unscored.length > 0) {
      race.status = matches.some((match) => match.status === "failed" || match.status === "canceled") ? "blocked" : "running";
      race.summary = `${unscored.length} of ${matches.length} suite race matches still need scored results.`;
      race.updatedAt = nowIso();
      await this.write();
      return { race, matches };
    }

    const humanScore = matches.reduce((total, match) => {
      const run = match.humanRunId ? snapshot.runs.find((entry) => entry.id === match.humanRunId) : undefined;
      return total + (run?.score ?? 0);
    }, 0);
    const agentScore = matches.reduce((total, match) => {
      const run = match.agentRunId ? snapshot.runs.find((entry) => entry.id === match.agentRunId) : undefined;
      return total + (run?.score ?? 0);
    }, 0);
    race.humanScore = humanScore;
    race.agentScore = agentScore;
    race.margin = Math.abs(humanScore - agentScore);
    race.winner = humanScore > agentScore ? "human" : agentScore > humanScore ? "agent" : "tie";
    race.status = "scored";
    race.summary =
      race.winner === "tie"
        ? `Suite race tied at ${humanScore}.`
        : `${race.winner === "human" ? "Human" : "Agent"} won ${race.title} by ${race.margin} aggregate points.`;
    race.updatedAt = nowIso();
    await this.write();
    return { race, matches };
  }

  async listMatches(): Promise<BenchmarkMatch[]> {
    const snapshot = await this.read();
    return snapshot.matches;
  }

  async getMatch(matchId: string): Promise<BenchmarkMatch | null> {
    const snapshot = await this.read();
    return snapshot.matches.find((entry) => entry.id === matchId) ?? null;
  }

  async startMatch(matchId: string): Promise<{
    match: BenchmarkMatch;
    humanRun: BenchmarkRun;
    agentRun: BenchmarkRun;
  } | null> {
    const snapshot = await this.read();
    const match = snapshot.matches.find((entry) => entry.id === matchId);
    const human = match ? snapshot.users.find((entry) => entry.id === match.humanUserId) : null;
    const agent = match ? snapshot.agents.find((entry) => entry.id === match.agentId) : null;
    if (!match || !human || !agent) return null;

    const humanRun = match.humanRunId
      ? snapshot.runs.find((entry) => entry.id === match.humanRunId) ?? null
      : await this.createRun({
          taskId: match.taskId,
          competitor: `human:${human.handle}`,
          competitorType: "human",
          runtimeProvider: "manual"
        });
    const agentRun = match.agentRunId
      ? snapshot.runs.find((entry) => entry.id === match.agentRunId) ?? null
      : await this.createRun({
          taskId: match.taskId,
          competitor: `agent:${agent.handle}`,
          competitorType: "agent",
          runtimeProvider: agent.runtimeProvider
        });
    if (!humanRun || !agentRun) return null;

    match.humanRunId = humanRun.id;
    match.agentRunId = agentRun.id;
    match.status = "running";
    match.updatedAt = nowIso();
    await this.write();
    return { match, humanRun, agentRun };
  }

  async evaluateMatch(matchId: string): Promise<{
    match: BenchmarkMatch;
    humanRun: BenchmarkRun;
    agentRun: BenchmarkRun;
  } | null> {
    const snapshot = await this.read();
    const match = snapshot.matches.find((entry) => entry.id === matchId);
    const humanRun = match?.humanRunId ? snapshot.runs.find((entry) => entry.id === match.humanRunId) : null;
    const agentRun = match?.agentRunId ? snapshot.runs.find((entry) => entry.id === match.agentRunId) : null;
    if (!match || !humanRun || !agentRun) return null;

    if (humanRun.status !== "scored" || agentRun.status !== "scored" || humanRun.score === undefined || agentRun.score === undefined) {
      match.status = humanRun.status === "failed" || agentRun.status === "failed" ? "failed" : "running";
      match.summary = "Both runs must be scored before the match can publish a winner.";
      match.updatedAt = nowIso();
      await this.write();
      return { match, humanRun, agentRun };
    }

    const margin = Math.abs(humanRun.score - agentRun.score);
    match.winner = humanRun.score > agentRun.score ? "human" : agentRun.score > humanRun.score ? "agent" : "tie";
    match.margin = margin;
    match.status = "scored";
    match.summary =
      match.winner === "tie"
        ? `Human and agent tied at ${humanRun.score}.`
        : `${match.winner === "human" ? humanRun.competitor : agentRun.competitor} won by ${margin} points.`;
    match.updatedAt = nowIso();
    await this.write();
    return { match, humanRun, agentRun };
  }

  async listTasks(): Promise<BenchmarkTask[]> {
    const snapshot = await this.read();
    const fixtureTasks = buildFixtureTasks();
    const activeImportedTasks = snapshot.taskRegistry.filter((entry) => entry.status === "active");
    const byId = new Map<string, BenchmarkTask>();
    for (const task of fixtureTasks) byId.set(task.id, task);
    for (const task of activeImportedTasks) byId.set(task.id, task);
    return [...byId.values()];
  }

  async listTaskRegistry(status?: TaskRegistryEntry["status"]): Promise<TaskRegistryEntry[]> {
    const snapshot = await this.read();
    return status ? snapshot.taskRegistry.filter((entry) => entry.status === status) : snapshot.taskRegistry;
  }

  async findTask(taskId: string): Promise<BenchmarkTask | null> {
    const tasks = await this.listTasks();
    return tasks.find((entry) => entry.id === taskId) ?? null;
  }

  async upsertTaskCandidates(tasks: BenchmarkTask[], reviewNotes?: string): Promise<TaskRegistryEntry[]> {
    const snapshot = await this.read();
    const timestamp = nowIso();
    const entries: TaskRegistryEntry[] = [];

    for (const task of tasks) {
      const existing = snapshot.taskRegistry.find((entry) => entry.id === task.id);
      if (existing) {
        Object.assign(existing, {
          ...task,
          status: existing.status,
          importedAt: existing.importedAt,
          updatedAt: timestamp,
          reviewNotes: reviewNotes ?? existing.reviewNotes
        });
        entries.push(existing);
      } else {
        const entry: TaskRegistryEntry = {
          ...task,
          status: "candidate",
          importedAt: timestamp,
          updatedAt: timestamp,
          reviewNotes
        };
        snapshot.taskRegistry.push(entry);
        entries.push(entry);
      }
    }

    await this.write();
    return entries;
  }

  async updateTaskRegistryStatus(
    taskId: string,
    status: TaskRegistryEntry["status"],
    reviewNotes?: string
  ): Promise<TaskRegistryEntry | null> {
    const snapshot = await this.read();
    const task = snapshot.taskRegistry.find((entry) => entry.id === taskId);
    if (!task) return null;
    task.status = status;
    task.updatedAt = nowIso();
    task.reviewNotes = reviewNotes ?? task.reviewNotes;
    await this.write();
    return task;
  }

  async upsertSteamAppDiscoveryCandidates(
    candidates: Array<Omit<SteamAppDiscoveryCandidate, "id" | "status" | "discoveredAt" | "updatedAt">>
  ): Promise<SteamAppDiscoveryCandidate[]> {
    const snapshot = await this.read();
    const timestamp = nowIso();
    const entries: SteamAppDiscoveryCandidate[] = [];

    for (const candidate of candidates) {
      const existing = snapshot.steamAppDiscoveries.find((entry) => entry.appid === candidate.appid);
      if (existing) {
        Object.assign(existing, {
          ...candidate,
          status: existing.status === "rejected" ? "candidate" : existing.status,
          discoveredAt: existing.discoveredAt,
          updatedAt: timestamp,
          importedAt: existing.importedAt
        });
        entries.push(existing);
      } else {
        const entry: SteamAppDiscoveryCandidate = {
          ...candidate,
          id: newId("steam_app"),
          status: "candidate",
          discoveredAt: timestamp,
          updatedAt: timestamp
        };
        snapshot.steamAppDiscoveries.unshift(entry);
        entries.push(entry);
      }
    }

    await this.write();
    return entries;
  }

  async listSteamAppDiscoveryCandidates(status?: SteamAppDiscoveryCandidate["status"]): Promise<SteamAppDiscoveryCandidate[]> {
    const snapshot = await this.read();
    return status ? snapshot.steamAppDiscoveries.filter((entry) => entry.status === status) : snapshot.steamAppDiscoveries;
  }

  async updateSteamAppDiscoveryStatus(
    candidateId: string,
    status: SteamAppDiscoveryCandidate["status"],
    reviewNotes?: string
  ): Promise<SteamAppDiscoveryCandidate | null> {
    const snapshot = await this.read();
    const candidate = snapshot.steamAppDiscoveries.find((entry) => entry.id === candidateId || String(entry.appid) === candidateId);
    if (!candidate) return null;
    candidate.status = status;
    candidate.updatedAt = nowIso();
    candidate.reviewNotes = reviewNotes?.trim() || candidate.reviewNotes;
    if (status === "imported") candidate.importedAt = candidate.updatedAt;
    await this.write();
    return candidate;
  }

  async getRun(
    runId: string
  ): Promise<{
    run: BenchmarkRun;
    events: RuntimeRunEvent[];
    artifacts: RunArtifact[];
    streams: LiveStreamSession[];
    proofs: RunProof[];
  } | null> {
    const snapshot = await this.read();
    const run = snapshot.runs.find((entry) => entry.id === runId);
    if (!run) return null;
    return {
      run,
      events: snapshot.events.filter((entry) => entry.runId === runId),
      artifacts: snapshot.artifacts.filter((entry) => entry.runId === runId),
      streams: snapshot.streams.filter((entry) => entry.runId === runId),
      proofs: snapshot.proofs.filter((entry) => entry.runId === runId)
    };
  }

  async appendRunEvent(input: {
    runId: string;
    type: RuntimeEventType;
    message: string;
    idempotencyKey?: string;
    metadata?: RuntimeRunEvent["metadata"];
  }): Promise<RuntimeRunEvent | null> {
    const snapshot = await this.read();
    const run = snapshot.runs.find((entry) => entry.id === input.runId);
    if (!run) return null;
    if (input.idempotencyKey) {
      const existing = snapshot.events.find(
        (entry) => entry.runId === input.runId && entry.idempotencyKey === input.idempotencyKey
      );
      if (existing) return existing;
    }

    const timestamp = nowIso();
    const event: RuntimeRunEvent = {
      id: newId("evt"),
      runId: input.runId,
      type: input.type,
      message: input.message,
      createdAt: timestamp,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata
    };
    snapshot.events.push(event);
    run.eventCount = snapshot.events.filter((entry) => entry.runId === input.runId).length;
    run.status = input.type === "launch" && (run.status === "queued" || run.status === "preparing") ? "running" : run.status;
    if (input.type === "heartbeat") run.heartbeatAt = timestamp;
    run.updatedAt = timestamp;
    await this.write();
    return event;
  }

  async createRunProof(input: {
    runId: string;
    type: RunProof["type"];
    status?: RunProof["status"];
    summary: string;
    metadata?: RunProof["metadata"];
  }): Promise<RunProof | null> {
    const snapshot = await this.read();
    const run = snapshot.runs.find((entry) => entry.id === input.runId);
    if (!run) return null;

    const timestamp = nowIso();
    const proof: RunProof = {
      id: newId("proof"),
      runId: input.runId,
      type: input.type,
      status: input.status ?? "pending",
      createdAt: timestamp,
      verifiedAt: input.status === "verified" ? timestamp : undefined,
      summary: input.summary,
      metadata: input.metadata
    };
    snapshot.proofs.push(proof);
    run.updatedAt = timestamp;
    await this.write();
    return proof;
  }

  async updateRunProofStatus(
    proofId: string,
    status: RunProof["status"],
    input: { summary?: string; reviewer?: string; reviewNotes?: string } = {}
  ): Promise<RunProof | null> {
    const snapshot = await this.read();
    const proof = snapshot.proofs.find((entry) => entry.id === proofId);
    if (!proof) return null;
    const timestamp = nowIso();
    proof.status = status;
    proof.summary = input.summary ?? proof.summary;
    proof.verifiedAt = status === "verified" ? timestamp : proof.verifiedAt;
    proof.reviewedAt = timestamp;
    proof.reviewer = input.reviewer?.trim() || proof.reviewer;
    proof.reviewNotes = input.reviewNotes?.trim() || proof.reviewNotes;
    const run = snapshot.runs.find((entry) => entry.id === proof.runId);
    if (run) run.updatedAt = timestamp;
    await this.write();
    return proof;
  }

  async claimNextRun(input: {
    workerId: string;
    runtimeProvider?: BenchmarkRun["runtimeProvider"];
    leaseMinutes?: number;
  }): Promise<BenchmarkRun | null> {
    const snapshot = await this.read();
    const run = snapshot.runs
      .filter((entry) => entry.status === "queued")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!run) return null;

    return this.claimRun(run.id, input);
  }

  async listWorkerQueue(now = new Date()): Promise<{
    queued: BenchmarkRun[];
    leased: BenchmarkRun[];
    expired: BenchmarkRun[];
  }> {
    const snapshot = await this.read();
    const activeStatuses: BenchmarkRun["status"][] = ["preparing", "running"];
    const queued = snapshot.runs.filter((entry) => entry.status === "queued");
    const leased = snapshot.runs.filter((entry) => activeStatuses.includes(entry.status));
    const nowMs = now.getTime();
    const expired = leased.filter((entry) => {
      if (!entry.leaseExpiresAt) return false;
      const expiryMs = Date.parse(entry.leaseExpiresAt);
      return Number.isFinite(expiryMs) && expiryMs <= nowMs;
    });
    return { queued, leased, expired };
  }

  async requeueExpiredRuns(input: {
    now?: Date;
    reason?: string;
    maxRuns?: number;
  } = {}): Promise<BenchmarkRun[]> {
    const snapshot = await this.read();
    const now = input.now ?? new Date();
    const nowMs = now.getTime();
    const timestamp = now.toISOString();
    const reason = input.reason?.trim() || "Worker lease expired before completion.";
    const maxRuns = input.maxRuns === undefined ? Number.POSITIVE_INFINITY : Math.max(0, input.maxRuns);
    const requeued: BenchmarkRun[] = [];

    for (const run of snapshot.runs) {
      if (requeued.length >= maxRuns) break;
      if (run.status !== "preparing" && run.status !== "running") continue;
      if (!run.leaseExpiresAt) continue;
      const expiryMs = Date.parse(run.leaseExpiresAt);
      if (!Number.isFinite(expiryMs) || expiryMs > nowMs) continue;

      const previousWorkerId = run.workerId;
      const previousStatus = run.status;
      run.status = "queued";
      run.workerId = undefined;
      run.claimedAt = undefined;
      run.heartbeatAt = undefined;
      run.leaseExpiresAt = undefined;
      run.failureCode = undefined;
      run.failureMessage = undefined;
      run.updatedAt = timestamp;
      snapshot.events.push({
        id: newId("evt"),
        runId: run.id,
        type: "error",
        message: reason,
        createdAt: timestamp,
        idempotencyKey: `lease-expired:${run.id}:${timestamp}`,
        metadata: {
          previousWorkerId: previousWorkerId ?? "",
          previousStatus
        }
      });
      run.eventCount = snapshot.events.filter((entry) => entry.runId === run.id).length;
      requeued.push(run);
    }

    if (requeued.length > 0) await this.write();
    return requeued;
  }

  async claimRun(
    runId: string,
    input: {
      workerId: string;
      runtimeProvider?: BenchmarkRun["runtimeProvider"];
      leaseMinutes?: number;
    }
  ): Promise<BenchmarkRun | null> {
    const snapshot = await this.read();
    const run = snapshot.runs.find((entry) => entry.id === runId);
    if (!run || run.status !== "queued") return null;

    const timestamp = nowIso();
    run.status = "preparing";
    run.workerId = input.workerId;
    run.runtimeProvider = input.runtimeProvider ?? "local-sim";
    run.claimedAt = timestamp;
    run.heartbeatAt = timestamp;
    run.leaseExpiresAt = isoInMinutes(input.leaseMinutes ?? 15);
    run.updatedAt = timestamp;
    await this.write();
    return run;
  }

  async heartbeatRun(runId: string, workerId: string, leaseMinutes = 15): Promise<BenchmarkRun | null> {
    const snapshot = await this.read();
    const run = snapshot.runs.find((entry) => entry.id === runId);
    if (!run || run.workerId !== workerId) return null;

    const timestamp = nowIso();
    run.heartbeatAt = timestamp;
    run.leaseExpiresAt = isoInMinutes(leaseMinutes);
    run.updatedAt = timestamp;
    await this.write();
    return run;
  }

  async failRun(runId: string, input: { code: string; message: string; workerId?: string }): Promise<BenchmarkRun | null> {
    const snapshot = await this.read();
    const run = snapshot.runs.find((entry) => entry.id === runId);
    if (!run || (input.workerId && run.workerId && run.workerId !== input.workerId)) return null;

    run.status = "failed";
    run.failureCode = input.code;
    run.failureMessage = input.message;
    run.updatedAt = nowIso();
    await this.write();
    return run;
  }

  async attachArtifact(runId: string, artifactPath: string): Promise<BenchmarkRun | null> {
    const artifact = await this.createArtifact({
      runId,
      kind: "video",
      name: "output.mp4",
      uri: artifactPath,
      canonical: true
    });
    if (!artifact) return null;

    const snapshot = await this.read();
    const run = snapshot.runs.find((entry) => entry.id === runId);
    if (!run) return null;
    run.status = "artifact-submitted";
    run.artifactPath = artifactPath;
    run.eventCount = snapshot.events.filter((entry) => entry.runId === runId).length;
    run.updatedAt = nowIso();
    await this.write();
    await this.createRunProof({
      runId,
      type: "canonical-artifact",
      status: "verified",
      summary: `Canonical artifact ${artifact.name} registered at ${artifact.uri}.`,
      metadata: {
        artifactId: artifact.id,
        artifactName: artifact.name,
        uri: artifact.uri
      }
    });
    return run;
  }

  async createArtifact(input: {
    runId: string;
    kind: RunArtifact["kind"];
    name: string;
    uri: string;
    sizeBytes?: number;
    sha256?: string;
    idempotencyKey?: string;
    canonical?: boolean;
  }): Promise<RunArtifact | null> {
    const snapshot = await this.read();
    const run = snapshot.runs.find((entry) => entry.id === input.runId);
    if (!run) return null;
    if (input.idempotencyKey) {
      const existing = snapshot.artifacts.find(
        (entry) => entry.runId === input.runId && entry.idempotencyKey === input.idempotencyKey
      );
      if (existing) return existing;
    }

    const artifact: RunArtifact = {
      id: newId("art"),
      runId: input.runId,
      kind: input.kind,
      name: input.name,
      uri: input.uri,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      idempotencyKey: input.idempotencyKey,
      createdAt: nowIso(),
      canonical: Boolean(input.canonical)
    };
    snapshot.artifacts.push(artifact);
    if (artifact.canonical) {
      run.artifactName = artifact.name;
      run.artifactPath = artifact.uri;
    }
    run.updatedAt = artifact.createdAt;
    await this.write();
    return artifact;
  }

  async createLiveStream(runId: string, title?: string): Promise<LiveStreamSession | null> {
    const snapshot = await this.read();
    const run = snapshot.runs.find((entry) => entry.id === runId);
    if (!run) return null;

    const stream: LiveStreamSession = {
      id: newId("stream"),
      runId,
      status: "scheduled",
      provider: "hls",
      title: title?.trim() || `${run.competitor} benchmark run`,
      ingestUrl: `rtmp://localhost/steambench/${runId}`,
      playbackUrl: `/streams/${runId}.m3u8`,
      thumbnailUrl: `/streams/${runId}.jpg`,
      viewerCount: 0,
      currentScene: "Waiting for runtime",
      createdAt: nowIso()
    };
    snapshot.streams.unshift(stream);
    await this.write();
    return stream;
  }

  async updateLiveStreamStatus(
    streamId: string,
    status: LiveStreamSession["status"],
    patch: Partial<Pick<LiveStreamSession, "viewerCount" | "currentScene">> = {}
  ): Promise<LiveStreamSession | null> {
    const snapshot = await this.read();
    const stream = snapshot.streams.find((entry) => entry.id === streamId);
    if (!stream) return null;

    stream.status = status;
    stream.viewerCount = patch.viewerCount ?? stream.viewerCount;
    stream.currentScene =
      patch.currentScene ?? (status === "live" ? "Runtime live" : status === "ended" ? "Run complete" : status === "failed" ? "Broadcast failed" : stream.currentScene);
    const timestamp = nowIso();
    if (status === "live") stream.startedAt = timestamp;
    if (status === "ended") stream.endedAt = timestamp;
    await this.write();
    return stream;
  }

  async scoreRun(
    runId: string,
    score?: number,
    scoreMetadata?: RunScoreMetadata,
    evidenceOverride?: string
  ): Promise<{ run: BenchmarkRun; row: ScoreboardRow; task: BenchmarkTask } | null> {
    const snapshot = await this.read();
    const run = snapshot.runs.find((entry) => entry.id === runId);
    const task = run ? await this.findTask(run.taskId) : null;
    if (!run || !task) return null;

    const finalScore = score ?? task.score;
    run.status = "scored";
    run.score = finalScore;
    run.scoreMetadata = scoreMetadata;
    run.updatedAt = nowIso();

    const row: ScoreboardRow = {
      rank: 0,
      runId: run.id,
      taskId: task.id,
      appid: task.appid,
      competitor: run.competitor,
      type: run.competitorType,
      game: task.gameName,
      task: task.title,
      track: task.track,
      level: task.level,
      score: finalScore,
      evidence: evidenceOverride ?? (run.artifactPath ? `Steam proof + ${run.artifactName}` : "Steam proof pending artifact review"),
      completedAt: run.updatedAt.slice(0, 10),
      metricName: scoreMetadata?.metricName,
      metricValue: scoreMetadata?.metricValue,
      scoreMetadata: scoreMetadata as ScoreboardRow["scoreMetadata"]
    };
    const existingIndex = snapshot.scoreboard.findIndex((entry) => entry.runId === run.id);
    if (existingIndex >= 0) {
      snapshot.scoreboard[existingIndex] = {
        ...snapshot.scoreboard[existingIndex],
        ...row
      };
    } else {
      snapshot.scoreboard.push(row);
    }
    snapshot.scoreboard.sort((a, b) => b.score - a.score);
    snapshot.scoreboard = snapshot.scoreboard.map((entry, index) => ({ ...entry, rank: index + 1 }));
    const rankedRow = snapshot.scoreboard.find((entry) => entry.runId === run.id) ?? row;
    await this.write();
    return { run, row: rankedRow, task };
  }

  async evaluateRun(runId: string): Promise<{
    passed: boolean;
    missingProofs: string[];
    run: BenchmarkRun;
    row?: ScoreboardRow;
    task: BenchmarkTask;
  } | null> {
    const snapshot = await this.read();
    const run = snapshot.runs.find((entry) => entry.id === runId);
    const task = run ? await this.findTask(run.taskId) : null;
    if (!run || !task) return null;

    run.status = "evaluating";
    run.updatedAt = nowIso();

    const proofs = snapshot.proofs.filter((entry) => entry.runId === runId && entry.status === "verified");
    const requiredPrimaryProof = task.track === "achievement" ? "steam-achievement" : "manual-review";
    const hasPrimaryProof = proofs.some((entry) => entry.type === requiredPrimaryProof);
    const hasArtifactProof = proofs.some((entry) => entry.type === "canonical-artifact");
    const missingProofs = [
      ...(hasPrimaryProof ? [] : [requiredPrimaryProof]),
      ...(hasArtifactProof ? [] : ["canonical-artifact"])
    ];

    if (missingProofs.length > 0) {
      run.status = "failed";
      run.failureCode = "missing_verified_proof";
      run.failureMessage = `Missing verified proof: ${missingProofs.join(", ")}`;
      run.updatedAt = nowIso();
      await this.write();
      return {
        passed: false,
        missingProofs,
        run,
        task
      };
    }

    const runScore = scoreRunAttempt(task, proofs);
    await this.write();
    const scored = await this.scoreRun(runId, runScore.score, runScore.metadata, runScore.evidence);
    if (!scored) return null;
    return {
      passed: true,
      missingProofs: [],
      run: scored.run,
      row: scored.row,
      task
    };
  }

  private async write(): Promise<void> {
    if (!this.snapshot) return;
    await mkdir(dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, `${JSON.stringify(this.snapshot, null, 2)}\n`, "utf-8");
  }
}
