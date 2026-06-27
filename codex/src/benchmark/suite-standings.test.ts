import { describe, expect, it } from "vitest";
import { buildSuiteRaceStandings, type SuiteRaceStandingInput } from "./suite-standings";

describe("suite race standings", () => {
  it("aggregates scored suite races into per-suite leaderboards", () => {
    const races: SuiteRaceStandingInput[] = [
      {
        id: "race_one",
        suiteId: "620:ranked",
        appid: 620,
        title: "Portal 2 Ranked Ladder",
        taskIds: ["a", "b", "c"],
        matchIds: ["m1", "m2", "m3"],
        humanUserId: "human_one",
        agentId: "agent_one",
        status: "scored",
        winner: "human",
        margin: 300,
        humanScore: 18300,
        agentScore: 18000,
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:10:00.000Z"
      },
      {
        id: "race_two",
        suiteId: "620:ranked",
        appid: 620,
        title: "Portal 2 Ranked Ladder",
        taskIds: ["a", "b", "c"],
        matchIds: ["m4", "m5", "m6"],
        humanUserId: "human_two",
        agentId: "agent_two",
        status: "scored",
        winner: "agent",
        margin: 500,
        humanScore: 17100,
        agentScore: 17600,
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:20:00.000Z"
      },
      {
        id: "race_pending",
        suiteId: "646570:expert",
        appid: 646570,
        title: "Slay the Spire Expert Ladder",
        taskIds: ["x"],
        matchIds: ["m7"],
        humanUserId: "human_three",
        agentId: "agent_three",
        status: "running",
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:30:00.000Z"
      }
    ];

    const standings = buildSuiteRaceStandings(races);

    expect(standings.totals).toMatchObject({
      races: 3,
      scoredRaces: 2,
      humanWins: 1,
      agentWins: 1,
      ties: 0,
      humanScore: 35400,
      agentScore: 35600
    });
    expect(standings.leaderboards).toHaveLength(1);
    expect(standings.leaderboards[0]).toMatchObject({
      suiteId: "620:ranked",
      raceCount: 2,
      humanWins: 1,
      agentWins: 1,
      leader: {
        raceId: "race_one",
        rank: 1,
        humanScore: 18300,
        agentScore: 18000
      }
    });
    expect(standings.leaderboards[0].entries[1]).toMatchObject({
      raceId: "race_two",
      rank: 2
    });
  });
});
