import type { BenchmarkTask, ScoreboardRow } from "../benchmark/types";
import { buildAgentCampaignLinks, type AgentBenchmarkCampaignLinks } from "./agent-campaign";
import type { AgentProfile, BenchmarkAgentCampaign, BenchmarkRun, RunArtifact, RunProof, RuntimeDispatch, StoreSnapshot } from "./store";

export type AgentBenchmarkCampaignReportItem = {
  task?: BenchmarkTask;
  run?: BenchmarkRun;
  dispatch?: RuntimeDispatch;
  scoreboardRow?: ScoreboardRow;
  links?: AgentBenchmarkCampaignLinks;
  status: "queued" | "active" | "scored" | "failed" | "missing-run";
  proofCounts: {
    verified: number;
    pending: number;
    failed: number;
  };
  canonicalArtifact?: RunArtifact;
};

export type AgentBenchmarkCampaignReport = {
  schemaVersion: "steambench.agent-campaign-report.v1";
  campaign: BenchmarkAgentCampaign;
  agent?: AgentProfile;
  status: BenchmarkAgentCampaign["status"];
  items: AgentBenchmarkCampaignReportItem[];
  totals: {
    tasks: number;
    runs: number;
    queued: number;
    active: number;
    scored: number;
    failed: number;
    dispatches: number;
    launchedDispatches: number;
    verifiedProofs: number;
    canonicalArtifacts: number;
    scoreboardRows: number;
    totalScore: number;
  };
  nextActions: string[];
};

function itemStatus(run?: BenchmarkRun): AgentBenchmarkCampaignReportItem["status"] {
  if (!run) return "missing-run";
  if (run.status === "scored") return "scored";
  if (run.status === "failed" || run.status === "canceled") return "failed";
  if (run.status === "preparing" || run.status === "running" || run.status === "artifact-submitted" || run.status === "evaluating") return "active";
  return "queued";
}

function reportStatus(items: AgentBenchmarkCampaignReportItem[]): BenchmarkAgentCampaign["status"] {
  if (items.length === 0 || items.some((item) => item.status === "missing-run" || item.status === "failed")) return "needs-attention";
  if (items.every((item) => item.status === "scored" && item.scoreboardRow)) return "scoreboard-ready";
  if (items.some((item) => item.status === "active" || item.status === "scored")) return "running";
  return "planned";
}

function nextActionsForReport(input: {
  status: BenchmarkAgentCampaign["status"];
  totals: AgentBenchmarkCampaignReport["totals"];
}): string[] {
  const actions: string[] = [];
  if (input.totals.queued > 0) actions.push("Launch or claim queued campaign runs with the planned dispatch commands.");
  if (input.totals.active > 0) actions.push("Keep workers heartbeating and submit output/output.mp4 with required proof.");
  if (input.totals.scored > input.totals.scoreboardRows) actions.push("Audit scored runs that have not published scoreboard rows.");
  if (input.totals.failed > 0) actions.push("Inspect failed runs and requeue replacement attempts before ranking the campaign.");
  if (input.status === "scoreboard-ready") actions.push("Campaign is scoreboard-ready; compare totalScore against human and agent standings.");
  return actions;
}

export function buildAgentBenchmarkCampaignReport(input: {
  campaign: BenchmarkAgentCampaign;
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
}): AgentBenchmarkCampaignReport {
  const agent = input.snapshot.agents.find((entry) => entry.id === input.campaign.agentId);
  const items = input.campaign.taskIds.map((taskId, index): AgentBenchmarkCampaignReportItem => {
    const runId = input.campaign.runIds[index];
    const run = runId ? input.snapshot.runs.find((entry) => entry.id === runId) : undefined;
    const dispatch =
      input.campaign.dispatchIds[index]
        ? input.snapshot.dispatches.find((entry) => entry.id === input.campaign.dispatchIds[index])
        : run
          ? input.snapshot.dispatches.find((entry) => entry.runId === run.id && entry.agentId === input.campaign.agentId)
          : undefined;
    const proofs = run ? input.snapshot.proofs.filter((proof) => proof.runId === run.id) : [];
    const canonicalArtifact = run ? input.snapshot.artifacts.find((artifact) => artifact.runId === run.id && artifact.canonical && artifact.name === "output.mp4") : undefined;
    return {
      task: input.tasks.find((task) => task.id === taskId),
      run,
      dispatch,
      scoreboardRow: run ? input.snapshot.scoreboard.find((row) => row.runId === run.id) : undefined,
      links: run ? buildAgentCampaignLinks(run.id, input.campaign.agentId) : undefined,
      status: itemStatus(run),
      proofCounts: {
        verified: proofs.filter((proof) => proof.status === "verified").length,
        pending: proofs.filter((proof) => proof.status === "pending").length,
        failed: proofs.filter((proof) => proof.status === "failed").length
      },
      canonicalArtifact
    };
  });
  const totals = {
    tasks: input.campaign.taskIds.length,
    runs: items.filter((item) => item.run).length,
    queued: items.filter((item) => item.status === "queued").length,
    active: items.filter((item) => item.status === "active").length,
    scored: items.filter((item) => item.status === "scored").length,
    failed: items.filter((item) => item.status === "failed" || item.status === "missing-run").length,
    dispatches: items.filter((item) => item.dispatch).length,
    launchedDispatches: items.filter((item) => item.dispatch?.status === "launched" || item.dispatch?.status === "claimed" || item.dispatch?.status === "completed").length,
    verifiedProofs: items.reduce((total, item) => total + item.proofCounts.verified, 0),
    canonicalArtifacts: items.filter((item) => item.canonicalArtifact).length,
    scoreboardRows: items.filter((item) => item.scoreboardRow).length,
    totalScore: items.reduce((total, item) => total + (item.run?.score ?? item.scoreboardRow?.score ?? 0), 0)
  };
  const status = reportStatus(items);
  return {
    schemaVersion: "steambench.agent-campaign-report.v1",
    campaign: input.campaign,
    agent,
    status,
    items,
    totals,
    nextActions: nextActionsForReport({ status, totals })
  };
}
