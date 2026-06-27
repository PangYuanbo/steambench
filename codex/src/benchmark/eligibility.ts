import type { RuntimeReadiness } from "../runtime/readiness";
import type { AgentProfile, UserAccount } from "../server/store";
import type { TaskReview } from "./task-review";
import type { BenchmarkTask } from "./types";

export type RaceEligibilityStatus = "ready" | "controlled" | "blocked";

export type RaceEligibility = {
  taskId: string;
  status: RaceEligibilityStatus;
  ready: boolean;
  human: {
    userId?: string;
    handle?: string;
    ready: boolean;
    steamLinked: boolean;
    proofConsent: boolean;
    blockers: string[];
  };
  agent: {
    agentId?: string;
    handle?: string;
    ready: boolean;
    active: boolean;
    missingCapabilities: string[];
    blockers: string[];
  };
  task: {
    reviewDecision: TaskReview["decision"];
    fairnessVerdict: BenchmarkTask["fairnessVerdict"];
    reviewRequired: boolean;
    controls: string[];
    blockers: string[];
  };
  proofRequirements: Array<"steam-achievement" | "manual-review" | "canonical-artifact">;
  blockers: string[];
  controls: string[];
};

function proofRequirementsFor(task: BenchmarkTask): RaceEligibility["proofRequirements"] {
  return [task.track === "achievement" ? "steam-achievement" : "manual-review", "canonical-artifact"];
}

export function buildRaceEligibility(input: {
  task: BenchmarkTask;
  review: TaskReview;
  human?: UserAccount | null;
  agent?: AgentProfile | null;
  agentReadiness?: RuntimeReadiness | null;
}): RaceEligibility {
  const humanBlockers = [];
  if (!input.human) humanBlockers.push("human_missing");
  if (input.human && input.human.type !== "human") humanBlockers.push("user_is_not_human");
  if (input.human && !input.human.linkedSteamId) humanBlockers.push("steam_not_linked");
  if (input.human?.linkedSteamId && !input.human.proofConsentAt) humanBlockers.push("steam_proof_consent_required");

  const missingCapabilities = input.agentReadiness?.missingCapabilities ?? [];
  const agentBlockers = [];
  if (!input.agent) agentBlockers.push("agent_missing");
  if (input.agent && input.agent.status !== "active") agentBlockers.push("agent_not_active");
  if (missingCapabilities.length > 0) agentBlockers.push("agent_missing_capabilities");

  const taskBlockers = [];
  if (input.review.decision === "reject") taskBlockers.push("task_review_rejected");
  if (input.task.fairnessVerdict === "exclude") taskBlockers.push("task_excluded");

  const blockers = [...humanBlockers, ...agentBlockers, ...taskBlockers];
  const controls = input.review.controls;
  const controlled = input.review.decision === "review-required" || input.task.fairnessVerdict === "controlled";
  const status: RaceEligibilityStatus = blockers.length > 0 ? "blocked" : controlled ? "controlled" : "ready";

  return {
    taskId: input.task.id,
    status,
    ready: status === "ready",
    human: {
      userId: input.human?.id,
      handle: input.human?.handle,
      ready: humanBlockers.length === 0,
      steamLinked: Boolean(input.human?.linkedSteamId),
      proofConsent: Boolean(input.human?.proofConsentAt),
      blockers: humanBlockers
    },
    agent: {
      agentId: input.agent?.id,
      handle: input.agent?.handle,
      ready: agentBlockers.length === 0,
      active: input.agent?.status === "active",
      missingCapabilities,
      blockers: agentBlockers
    },
    task: {
      reviewDecision: input.review.decision,
      fairnessVerdict: input.task.fairnessVerdict,
      reviewRequired: input.review.reviewRequired,
      controls,
      blockers: taskBlockers
    },
    proofRequirements: proofRequirementsFor(input.task),
    blockers,
    controls
  };
}
