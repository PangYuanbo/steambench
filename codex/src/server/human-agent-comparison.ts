import type { BenchmarkTask, ScoreboardRow } from "../benchmark/types";
import type { AgentBenchmarkCampaignReport } from "./agent-campaign-report";
import type { BenchmarkRun, StoreSnapshot, UserAccount } from "./store";

export type HumanAgentComparisonItem = {
  task: BenchmarkTask;
  humanRun?: BenchmarkRun;
  agentRun?: BenchmarkRun;
  humanRow?: ScoreboardRow;
  agentRow?: ScoreboardRow;
  winner?: "human" | "agent" | "tie";
  margin: number;
  status: "complete" | "human-missing" | "agent-missing" | "both-missing";
};

export type HumanAgentComparison = {
  schemaVersion: "steambench.human-agent-comparison.v1";
  human: UserAccount;
  campaign: AgentBenchmarkCampaignReport["campaign"];
  agent?: AgentBenchmarkCampaignReport["agent"];
  status: "complete" | "human-incomplete" | "agent-incomplete" | "incomplete";
  totals: {
    tasks: number;
    completeTasks: number;
    humanScore: number;
    agentScore: number;
    humanWins: number;
    agentWins: number;
    ties: number;
    humanMissing: number;
    agentMissing: number;
    margin: number;
  };
  winner?: "human" | "agent" | "tie";
  items: HumanAgentComparisonItem[];
  links: {
    campaign: string;
    campaignCertificate: string;
    evidenceBundle: string;
    humanProofPlan: string;
    resultCertificate: string;
  };
};

function runBelongsToHuman(run: BenchmarkRun, user: UserAccount): boolean {
  return run.competitor === `human:${user.handle}` || run.competitor === user.handle || run.competitor === user.displayName;
}

function rowBelongsToHuman(row: ScoreboardRow, user: UserAccount): boolean {
  return row.type === "human" && (row.competitor === `human:${user.handle}` || row.competitor === user.handle || row.competitor === user.displayName);
}

function itemStatus(input: { humanRow?: ScoreboardRow; agentRow?: ScoreboardRow }): HumanAgentComparisonItem["status"] {
  if (input.humanRow && input.agentRow) return "complete";
  if (!input.humanRow && !input.agentRow) return "both-missing";
  if (!input.humanRow) return "human-missing";
  return "agent-missing";
}

function itemWinner(input: { humanRow?: ScoreboardRow; agentRow?: ScoreboardRow }): Pick<HumanAgentComparisonItem, "winner" | "margin"> {
  if (!input.humanRow || !input.agentRow) return { margin: 0 };
  const margin = Math.abs(input.humanRow.score - input.agentRow.score);
  if (input.humanRow.score > input.agentRow.score) return { winner: "human", margin };
  if (input.agentRow.score > input.humanRow.score) return { winner: "agent", margin };
  return { winner: "tie", margin };
}

export function buildHumanAgentComparison(input: {
  human: UserAccount;
  campaignReport: AgentBenchmarkCampaignReport;
  snapshot: StoreSnapshot;
  tasks: BenchmarkTask[];
}): HumanAgentComparison {
  const humanRuns = input.snapshot.runs.filter((run) => runBelongsToHuman(run, input.human));
  const items = input.campaignReport.items.map((agentItem): HumanAgentComparisonItem => {
    const task = (agentItem.task ?? input.tasks.find((entry) => entry.id === agentItem.run?.taskId) ?? input.tasks[0]) as BenchmarkTask;
    const humanRun = humanRuns.find((run) => run.taskId === task.id && run.status === "scored")
      ?? humanRuns.find((run) => run.taskId === task.id);
    const humanRow = input.snapshot.scoreboard.find((row) => row.taskId === task.id && rowBelongsToHuman(row, input.human));
    const agentRow = agentItem.scoreboardRow;
    const winner = itemWinner({ humanRow, agentRow });
    return {
      task,
      humanRun,
      agentRun: agentItem.run,
      humanRow,
      agentRow,
      ...winner,
      status: itemStatus({ humanRow, agentRow })
    };
  });
  const humanScore = items.reduce((total, item) => total + (item.humanRow?.score ?? 0), 0);
  const agentScore = items.reduce((total, item) => total + (item.agentRow?.score ?? 0), 0);
  const humanMissing = items.filter((item) => !item.humanRow).length;
  const agentMissing = items.filter((item) => !item.agentRow).length;
  const status: HumanAgentComparison["status"] =
    humanMissing === 0 && agentMissing === 0
      ? "complete"
      : humanMissing > 0 && agentMissing > 0
        ? "incomplete"
        : humanMissing > 0
          ? "human-incomplete"
          : "agent-incomplete";
  const winner: HumanAgentComparison["winner"] =
    status !== "complete"
      ? undefined
      : humanScore > agentScore
        ? "human"
        : agentScore > humanScore
          ? "agent"
          : "tie";

  return {
    schemaVersion: "steambench.human-agent-comparison.v1",
    human: input.human,
    campaign: input.campaignReport.campaign,
    agent: input.campaignReport.agent,
    status,
    totals: {
      tasks: items.length,
      completeTasks: items.filter((item) => item.status === "complete").length,
      humanScore,
      agentScore,
      humanWins: items.filter((item) => item.winner === "human").length,
      agentWins: items.filter((item) => item.winner === "agent").length,
      ties: items.filter((item) => item.winner === "tie").length,
      humanMissing,
      agentMissing,
      margin: Math.abs(humanScore - agentScore)
    },
    winner,
    items,
    links: {
      campaign: `/api/campaigns/${input.campaignReport.campaign.id}`,
      campaignCertificate: `/api/campaigns/${input.campaignReport.campaign.id}/result-certificate`,
      evidenceBundle: `/api/comparisons/human-agent/evidence-bundle?humanUserId=${encodeURIComponent(input.human.id)}&campaignId=${encodeURIComponent(input.campaignReport.campaign.id)}`,
      humanProofPlan: `/api/users/${input.human.id}/steam-proof-plan`,
      resultCertificate: `/api/comparisons/human-agent/result-certificate?humanUserId=${encodeURIComponent(input.human.id)}&campaignId=${encodeURIComponent(input.campaignReport.campaign.id)}`
    }
  };
}
