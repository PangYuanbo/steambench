import type { BenchmarkTask } from "../benchmark/types";
import type { BenchmarkRun, StoreSnapshot, UserAccount } from "./store";

export type HumanSteamProofPlanItem = {
  task: BenchmarkTask;
  status: "ready" | "unsupported" | "steam-not-linked" | "consent-required" | "already-scored";
  proofType: "steam-achievement" | "manual-review";
  recentRun?: BenchmarkRun;
  existingScore?: number;
  entryPacket: HumanBenchmarkEntryPacket;
  action: {
    method: "POST";
    createRunEndpoint: string;
    submissionEndpoint?: string;
    verifySteamProofEndpoint?: string;
  };
  reason: string;
};

export type HumanBenchmarkEntryPacket = {
  schemaVersion: "steambench.human-benchmark-entry-packet.v1";
  userId: string;
  taskId: string;
  appid: number;
  status: HumanSteamProofPlanItem["status"];
  readyForSubmission: boolean;
  proofType: HumanSteamProofPlanItem["proofType"];
  competitor: {
    type: "human";
    handle: string;
    displayName: string;
    steamid?: string;
    proofConsentAt?: string;
  };
  run?: {
    id: string;
    status: BenchmarkRun["status"];
    score?: number;
  };
  evidence: {
    canonicalArtifact: "output/output.mp4";
    acceptedArtifactName: "output.mp4";
    forbiddenArtifactNames: ["output-test.mp4"];
    proofConsentRequired: true;
    steamLinkRequired: true;
  };
  endpoints: {
    proofPlan: string;
    createRun: string;
    submitProof: string;
    linkSteam: string;
    proofConsent: string;
    run?: string;
    artifactPresign?: string;
    submission?: string;
    verifySteamProof?: string;
    evidenceBundle?: string;
    resultCertificate?: string;
  };
  submission: {
    method: "POST";
    endpoint: string;
    body: {
      taskId: string;
      artifactPath: "output/output.mp4";
    };
  };
  blockers: Array<{
    id: "steam-not-linked" | "proof-consent-required" | "already-scored" | "unsupported";
    label: string;
    endpoint?: string;
  }>;
};

export type HumanSteamProofPlan = {
  schemaVersion: "steambench.human-steam-proof-plan.v1";
  user: UserAccount;
  steamid?: string;
  ready: boolean;
  totals: {
    tasks: number;
    ready: number;
    alreadyScored: number;
    achievementTasks: number;
    manualTasks: number;
  };
  items: HumanSteamProofPlanItem[];
};

function runBelongsToUser(run: BenchmarkRun, user: UserAccount): boolean {
  return run.competitor === `human:${user.handle}` || run.competitor === user.handle || run.competitor === user.displayName;
}

function buildHumanBenchmarkEntryPacket(input: {
  user: UserAccount;
  task: BenchmarkTask;
  status: HumanSteamProofPlanItem["status"];
  proofType: HumanSteamProofPlanItem["proofType"];
  recentRun?: BenchmarkRun;
}): HumanBenchmarkEntryPacket {
  const proofPlan = `/api/users/${input.user.id}/steam-proof-plan`;
  const createRun = `/api/users/${input.user.id}/runs`;
  const submitProof = `/api/users/${input.user.id}/steam-proof-submissions`;
  const run = input.recentRun;
  const blockers: HumanBenchmarkEntryPacket["blockers"] = [];
  if (!input.user.linkedSteamId) {
    blockers.push({
      id: "steam-not-linked",
      label: "Link Steam before submitting public benchmark proof.",
      endpoint: `/api/users/${input.user.id}/steam`
    });
  }
  if (!input.user.proofConsentAt) {
    blockers.push({
      id: "proof-consent-required",
      label: "Grant Steam proof consent before public ranking.",
      endpoint: `/api/users/${input.user.id}/steam-proof-consent`
    });
  }
  if (input.status === "already-scored") {
    blockers.push({
      id: "already-scored",
      label: "This user already has a scored run for this task.",
      endpoint: run ? `/api/runs/${run.id}/result-certificate` : undefined
    });
  }
  if (input.status === "unsupported") {
    blockers.push({
      id: "unsupported",
      label: "This task is not currently supported by the human proof flow.",
      endpoint: proofPlan
    });
  }

  return {
    schemaVersion: "steambench.human-benchmark-entry-packet.v1",
    userId: input.user.id,
    taskId: input.task.id,
    appid: input.task.appid,
    status: input.status,
    readyForSubmission: input.status === "ready",
    proofType: input.proofType,
    competitor: {
      type: "human",
      handle: input.user.handle,
      displayName: input.user.displayName,
      steamid: input.user.linkedSteamId,
      proofConsentAt: input.user.proofConsentAt
    },
    run: run
      ? {
          id: run.id,
          status: run.status,
          score: run.score
        }
      : undefined,
    evidence: {
      canonicalArtifact: "output/output.mp4",
      acceptedArtifactName: "output.mp4",
      forbiddenArtifactNames: ["output-test.mp4"],
      proofConsentRequired: true,
      steamLinkRequired: true
    },
    endpoints: {
      proofPlan,
      createRun,
      submitProof,
      linkSteam: `/api/users/${input.user.id}/steam`,
      proofConsent: `/api/users/${input.user.id}/steam-proof-consent`,
      run: run ? `/api/runs/${run.id}` : undefined,
      artifactPresign: run ? `/api/runs/${run.id}/artifacts/presign` : undefined,
      submission: run ? `/api/runs/${run.id}/submission` : undefined,
      verifySteamProof: input.proofType === "steam-achievement" && run ? `/api/runs/${run.id}/verify-steam-proof` : undefined,
      evidenceBundle: run ? `/api/runs/${run.id}/evidence-bundle` : undefined,
      resultCertificate: run ? `/api/runs/${run.id}/result-certificate` : undefined
    },
    submission: {
      method: "POST",
      endpoint: submitProof,
      body: {
        taskId: input.task.id,
        artifactPath: "output/output.mp4"
      }
    },
    blockers
  };
}

function itemStatus(input: {
  user: UserAccount;
  task: BenchmarkTask;
  recentRun?: BenchmarkRun;
}): Pick<HumanSteamProofPlanItem, "status" | "reason"> {
  if (!input.user.linkedSteamId) {
    return {
      status: "steam-not-linked",
      reason: "Link Steam before submitting public benchmark proof."
    };
  }
  if (!input.user.proofConsentAt) {
    return {
      status: "consent-required",
      reason: "Grant Steam proof consent before public ranking."
    };
  }
  if (input.recentRun?.status === "scored") {
    return {
      status: "already-scored",
      reason: "This user already has a scored run for this task."
    };
  }
  return {
    status: "ready",
    reason: input.task.track === "achievement"
      ? "Submit output/output.mp4 and verify the Steam achievement proof."
      : "Submit output/output.mp4 with a manual metric review proof."
  };
}

export function buildHumanSteamProofPlan(input: {
  user: UserAccount;
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
  limit?: number;
}): HumanSteamProofPlan {
  const limit = input.limit ?? 8;
  const userRuns = input.snapshot.runs.filter((run) => runBelongsToUser(run, input.user));
  const items = input.tasks.slice(0, limit).map((task): HumanSteamProofPlanItem => {
    const recentRun = userRuns.find((run) => run.taskId === task.id);
    const proofType = task.track === "achievement" ? "steam-achievement" : "manual-review";
    const status = itemStatus({ user: input.user, task, recentRun });
    return {
      task,
      ...status,
      proofType,
      recentRun,
      existingScore: recentRun?.score,
      entryPacket: buildHumanBenchmarkEntryPacket({
        user: input.user,
        task,
        status: status.status,
        proofType,
        recentRun
      }),
      action: {
        method: "POST",
        createRunEndpoint: `/api/users/${input.user.id}/runs`,
        submissionEndpoint: recentRun ? `/api/runs/${recentRun.id}/submission` : undefined,
        verifySteamProofEndpoint: task.track === "achievement" && recentRun ? `/api/runs/${recentRun.id}/verify-steam-proof` : undefined
      }
    };
  });

  return {
    schemaVersion: "steambench.human-steam-proof-plan.v1",
    user: input.user,
    steamid: input.user.linkedSteamId,
    ready: Boolean(input.user.linkedSteamId && input.user.proofConsentAt),
    totals: {
      tasks: items.length,
      ready: items.filter((item) => item.status === "ready").length,
      alreadyScored: items.filter((item) => item.status === "already-scored").length,
      achievementTasks: items.filter((item) => item.task.track === "achievement").length,
      manualTasks: items.filter((item) => item.task.track !== "achievement").length
    },
    items
  };
}
