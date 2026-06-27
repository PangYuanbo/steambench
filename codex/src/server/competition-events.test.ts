import { describe, expect, it } from "vitest";
import { buildCompetitionEventSummary } from "./competition-events";
import type { AgentProfile, BenchmarkMatch, BenchmarkRun, BenchmarkSuiteRace, UserAccount } from "./store";
import type { ScoreboardRow } from "../benchmark/types";

const users: UserAccount[] = [
  {
    id: "human_ready",
    handle: "ready-human",
    displayName: "Ready Human",
    type: "human",
    createdAt: "2026-06-14T00:00:00.000Z",
    linkedSteamId: "76561198000000000",
    proofConsentAt: "2026-06-14T00:00:00.000Z"
  },
  {
    id: "human_linked",
    handle: "linked-human",
    displayName: "Linked Human",
    type: "human",
    createdAt: "2026-06-14T00:00:00.000Z",
    linkedSteamId: "76561198000000001"
  }
];

const agents: AgentProfile[] = [
  {
    id: "agent_ready",
    userId: "usr_agent",
    handle: "ready-agent",
    displayName: "Ready Agent",
    provider: "local",
    runtimeProvider: "local-sim",
    command: "node scripts/runtime-worker.mjs",
    capabilities: ["keyboard-mouse", "screen-capture", "output.mp4"],
    status: "active",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z"
  }
];

const rows: ScoreboardRow[] = [
  {
    rank: 1,
    competitor: "human:ready-human",
    type: "human",
    game: "Portal 2",
    task: "Save the Cube",
    taskId: "620:ACH.SAVE_CUBE",
    level: 4,
    score: 9000,
    evidence: "Steam proof + output.mp4",
    completedAt: "2026-06-14"
  },
  {
    rank: 2,
    competitor: "agent:ready-agent",
    type: "agent",
    game: "Portal 2",
    task: "Save the Cube",
    taskId: "620:ACH.SAVE_CUBE",
    level: 4,
    score: 8700,
    evidence: "Steam proof + output.mp4",
    completedAt: "2026-06-14"
  }
];

const runs: BenchmarkRun[] = [
  {
    id: "run_human",
    taskId: "620:ACH.SAVE_CUBE",
    competitor: "human:ready-human",
    competitorType: "human",
    status: "scored",
    createdAt: "2026-06-14T01:00:00.000Z",
    updatedAt: "2026-06-14T01:10:00.000Z",
    runtimeProvider: "manual",
    artifactName: "output.mp4",
    eventCount: 1,
    score: 9000
  },
  {
    id: "run_agent",
    taskId: "620:ACH.SAVE_CUBE",
    competitor: "agent:ready-agent",
    competitorType: "agent",
    status: "queued",
    createdAt: "2026-06-14T01:00:00.000Z",
    updatedAt: "2026-06-14T01:10:00.000Z",
    runtimeProvider: "local-sim",
    artifactName: "output.mp4",
    eventCount: 0
  }
];

describe("competition event projection", () => {
  it("summarizes active event entrants, scores, matches, suite races, and operations", () => {
    const match: BenchmarkMatch = {
      id: "match_one",
      taskId: "620:ACH.SAVE_CUBE",
      humanUserId: "human_ready",
      agentId: "agent_ready",
      humanRunId: "run_human",
      agentRunId: "run_agent",
      status: "scored",
      createdAt: "2026-06-14T01:00:00.000Z",
      updatedAt: "2026-06-14T01:30:00.000Z",
      winner: "human",
      margin: 300
    };
    const suiteRace: BenchmarkSuiteRace = {
      id: "suite_one",
      suiteId: "620:ranked",
      eventScope: "daily",
      appid: 620,
      title: "Portal 2 Ranked Ladder",
      taskIds: ["620:ACH.SAVE_CUBE"],
      matchIds: ["match_one"],
      humanUserId: "human_ready",
      agentId: "agent_ready",
      status: "scored",
      createdAt: "2026-06-14T01:00:00.000Z",
      updatedAt: "2026-06-14T01:30:00.000Z",
      winner: "human",
      margin: 300,
      humanScore: 9000,
      agentScore: 8700
    };

    const event = buildCompetitionEventSummary({
      scope: "daily",
      users,
      agents,
      runs,
      matches: [match],
      suiteRaces: [suiteRace],
      scoreboard: rows,
      proofs: [
        {
          id: "proof_pending",
          runId: "run_human",
          type: "steam-achievement",
          status: "pending",
          createdAt: "2026-06-14T01:00:00.000Z",
          summary: "Pending review"
        }
      ],
      streams: [],
      registrations: [
        {
          id: "reg_human",
          eventScope: "daily",
          participantType: "human",
          participantId: "human_ready",
          status: "registered",
          createdAt: "2026-06-14T01:00:00.000Z",
          updatedAt: "2026-06-14T01:00:00.000Z"
        },
        {
          id: "reg_agent",
          eventScope: "daily",
          participantType: "agent",
          participantId: "agent_ready",
          status: "registered",
          createdAt: "2026-06-14T01:00:00.000Z",
          updatedAt: "2026-06-14T01:00:00.000Z"
        },
        {
          id: "reg_withdrawn",
          eventScope: "daily",
          participantType: "human",
          participantId: "human_linked",
          status: "withdrawn",
          createdAt: "2026-06-14T01:00:00.000Z",
          updatedAt: "2026-06-14T01:00:00.000Z"
        }
      ],
      now: new Date("2026-06-14T12:00:00.000Z")
    });

    expect(event).toMatchObject({
      scope: "daily",
      status: "active",
      entrants: {
        consentedHumans: 1,
        steamLinkedHumans: 2,
        activeAgents: 1,
        runnablePairs: 1,
        registeredHumans: 1,
        registeredAgents: 1,
        registeredPairs: 1
      },
      score: {
        humanRuns: 1,
        agentRuns: 1,
        humanWins: 1
      },
      matches: {
        total: 1,
        scored: 1
      },
      suiteRaces: {
        total: 1,
        scored: 1,
        humanWins: 1
      },
      operations: {
        queuedRuns: 1,
        pendingProofs: 1
      }
    });
    expect(event.leaders[0]).toMatchObject({
      taskId: "620:ACH.SAVE_CUBE",
      leader: "human:ready-human"
    });
  });

  it("keeps explicitly scoped suite races out of other event summaries", () => {
    const event = buildCompetitionEventSummary({
      scope: "daily",
      users,
      agents,
      runs: [],
      matches: [],
      suiteRaces: [
        {
          id: "weekly_suite",
          suiteId: "620:ranked",
          eventScope: "weekly",
          appid: 620,
          title: "Portal 2 Ranked Ladder",
          taskIds: ["620:ACH.SAVE_CUBE"],
          matchIds: [],
          humanUserId: "human_ready",
          agentId: "agent_ready",
          status: "scored",
          createdAt: "2026-06-14T01:00:00.000Z",
          updatedAt: "2026-06-14T01:30:00.000Z",
          winner: "human",
          margin: 300,
          humanScore: 9000,
          agentScore: 8700
        }
      ],
      scoreboard: [],
      proofs: [],
      streams: [],
      now: new Date("2026-06-14T12:00:00.000Z")
    });

    expect(event.suiteRaces).toMatchObject({
      total: 0,
      scored: 0
    });
  });
});
