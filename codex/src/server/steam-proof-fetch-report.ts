import type { BenchmarkTask } from "../benchmark/types";
import type { SteamCacheEntrySummary, SteamFetchMeta, SteamPlayerAchievement } from "../steam/steam-client";
import type { BenchmarkRun, RunProof, StoreSnapshot, UserAccount } from "./store";

export type SteamProofFetchReportItem = {
  task: BenchmarkTask;
  achievementApiName: string;
  recentRun?: BenchmarkRun;
  latestProof?: RunProof;
  proofStatus: "verified" | "failed" | "pending" | "missing";
  proofSource?: string;
  unlockTime?: number;
  action: {
    verifyEndpoint?: string;
    submissionEndpoint?: string;
  };
};

export type SteamProofFetchReport = {
  schemaVersion: "steambench.steam-proof-fetch-report.v1";
  generatedAt: string;
  user: UserAccount;
  steamid?: string;
  appid?: number;
  status: "ready" | "steam-not-linked" | "consent-required" | "no-achievement-tasks" | "live-fetch-blocked" | "live-fetch-failed";
  liveProofEnabled: boolean;
  fetch?: {
    attempted: boolean;
    source?: SteamFetchMeta["source"];
    endpoint?: string;
    fetchedAt?: string;
    expiresAt?: string;
    achievementCount?: number;
    achievedCount?: number;
    error?: string;
  };
  totals: {
    tasks: number;
    achievementTasks: number;
    verifiedProofs: number;
    failedProofs: number;
    pendingProofs: number;
    missingProofs: number;
    mockProofs: number;
    steamWebApiProofs: number;
    cacheEntries: number;
  };
  cache: SteamCacheEntrySummary[];
  items: SteamProofFetchReportItem[];
};

function runBelongsToUser(run: BenchmarkRun, user: UserAccount): boolean {
  return run.competitor === `human:${user.handle}` || run.competitor === user.handle || run.competitor === user.displayName;
}

function achievementApiName(task: BenchmarkTask): string {
  return task.id.startsWith(`${task.appid}:`) ? task.id.slice(String(task.appid).length + 1) : task.title;
}

function proofSource(proof?: RunProof): string | undefined {
  const source = proof?.metadata?.source;
  return typeof source === "string" ? source : undefined;
}

function unlockTime(proof?: RunProof): number | undefined {
  const value = proof?.metadata?.unlockTime;
  return typeof value === "number" ? value : undefined;
}

function isMockProofSource(source?: string): boolean {
  return source?.toLowerCase().includes("mock") === true;
}

export function buildSteamProofFetchReport(input: {
  user: UserAccount;
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
  appid?: number;
  cache: SteamCacheEntrySummary[];
  liveProofEnabled: boolean;
  fetchedAchievements?: SteamPlayerAchievement[];
  fetchMeta?: SteamFetchMeta;
  fetchError?: string;
  generatedAt?: string;
}): SteamProofFetchReport {
  const achievementTasks = input.tasks
    .filter((task) => task.track === "achievement")
    .filter((task) => input.appid === undefined || task.appid === input.appid);
  const userRuns = input.snapshot.runs.filter((run) => runBelongsToUser(run, input.user));
  const items = achievementTasks.map((task): SteamProofFetchReportItem => {
    const recentRun = userRuns.find((run) => run.taskId === task.id);
    const runProofs = recentRun
      ? input.snapshot.proofs
          .filter((proof) => proof.runId === recentRun.id && proof.type === "steam-achievement")
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      : [];
    const latestProof = runProofs[0];
    return {
      task,
      achievementApiName: achievementApiName(task),
      recentRun,
      latestProof,
      proofStatus: latestProof?.status ?? "missing",
      proofSource: proofSource(latestProof),
      unlockTime: unlockTime(latestProof),
      action: {
        verifyEndpoint: recentRun ? `/api/runs/${recentRun.id}/verify-steam-proof` : undefined,
        submissionEndpoint: recentRun ? `/api/runs/${recentRun.id}/submission` : undefined
      }
    };
  });
  const status: SteamProofFetchReport["status"] =
    !input.user.linkedSteamId
      ? "steam-not-linked"
      : !input.user.proofConsentAt
        ? "consent-required"
        : achievementTasks.length === 0
          ? "no-achievement-tasks"
          : input.fetchError
            ? input.liveProofEnabled ? "live-fetch-failed" : "live-fetch-blocked"
            : "ready";
  const cache = input.appid === undefined
    ? input.cache
    : input.cache.filter((entry) =>
        entry.key === `player-achievements:${input.appid}:${input.user.linkedSteamId}` ||
        entry.key === `global-achievements:${input.appid}`
      );

  return {
    schemaVersion: "steambench.steam-proof-fetch-report.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    user: input.user,
    steamid: input.user.linkedSteamId,
    appid: input.appid,
    status,
    liveProofEnabled: input.liveProofEnabled,
    fetch: {
      attempted: Boolean(input.fetchMeta || input.fetchError),
      source: input.fetchMeta?.source,
      endpoint: input.fetchMeta?.endpoint,
      fetchedAt: input.fetchMeta?.fetchedAt,
      expiresAt: input.fetchMeta?.expiresAt,
      achievementCount: input.fetchedAchievements?.length,
      achievedCount: input.fetchedAchievements?.filter((achievement) => achievement.achieved).length,
      error: input.fetchError
    },
    totals: {
      tasks: input.tasks.length,
      achievementTasks: achievementTasks.length,
      verifiedProofs: items.filter((item) => item.proofStatus === "verified").length,
      failedProofs: items.filter((item) => item.proofStatus === "failed").length,
      pendingProofs: items.filter((item) => item.proofStatus === "pending").length,
      missingProofs: items.filter((item) => item.proofStatus === "missing").length,
      mockProofs: items.filter((item) => isMockProofSource(item.proofSource)).length,
      steamWebApiProofs: items.filter((item) => item.proofSource === "steam-web-api").length,
      cacheEntries: cache.length
    },
    cache,
    items
  };
}
