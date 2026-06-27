import { describe, expect, it } from "vitest";
import { buildSeasonSnapshot, buildSeasonSnapshots, buildStandings, filterRowsBySeasonScope } from "./standings";
import type { ScoreboardRow } from "./types";

describe("buildStandings", () => {
  it("aggregates human-vs-agent totals, competitors, and task matchups", () => {
    const rows: ScoreboardRow[] = [
      {
        rank: 1,
        competitor: "human:astra",
        type: "human",
        runId: "run_human",
        taskId: "620:ACH.SAVE_CUBE",
        appid: 620,
        game: "Portal 2",
        task: "Preservation of Mass",
        track: "achievement",
        level: 4,
        score: 5000,
        evidence: "Steam proof + output.mp4",
        completedAt: "2026-06-14"
      },
      {
        rank: 2,
        competitor: "Codex Runner",
        type: "agent",
        runId: "run_agent",
        taskId: "620:ACH.SAVE_CUBE",
        appid: 620,
        game: "Portal 2",
        task: "Preservation of Mass",
        track: "achievement",
        level: 4,
        score: 4700,
        evidence: "Steam proof + output.mp4",
        completedAt: "2026-06-14"
      },
      {
        rank: 3,
        competitor: "Codex Runner",
        type: "agent",
        runId: "run_ship",
        taskId: "620:ACH.NO_BOAT",
        appid: 620,
        game: "Portal 2",
        task: "Ship Overboard",
        track: "achievement",
        level: 9,
        score: 8200,
        evidence: "Steam proof + output.mp4",
        completedAt: "2026-06-15"
      }
    ];

    const standings = buildStandings(rows);

    expect(standings.totals).toMatchObject({
      humanRuns: 1,
      agentRuns: 2,
      humanScore: 5000,
      agentScore: 12900,
      humanWins: 1,
      agentWins: 1,
      ties: 0
    });
    expect(standings.competitors[0]).toMatchObject({
      competitor: "Codex Runner",
      runs: 2,
      totalScore: 12900,
      bestScore: 8200,
      averageScore: 6450
    });
    expect(standings.matchups.find((entry) => entry.task === "Preservation of Mass")).toMatchObject({
      winnerType: "human",
      margin: 300
    });
    expect(standings.games[0]).toMatchObject({
      game: "Portal 2",
      leader: expect.objectContaining({
        competitor: "Codex Runner",
        score: 8200
      })
    });
    expect(standings.taskLeaderboards.find((entry) => entry.taskId === "620:ACH.SAVE_CUBE")).toMatchObject({
      game: "Portal 2",
      task: "Preservation of Mass",
      humanLeader: expect.objectContaining({ competitor: "human:astra", taskRank: 1 }),
      agentLeader: expect.objectContaining({ competitor: "Codex Runner", taskRank: 2 })
    });
  });

  it("builds daily and rolling weekly season snapshots from completed dates", () => {
    const rows: ScoreboardRow[] = [
      {
        rank: 1,
        competitor: "human:today",
        type: "human",
        runId: "run_today",
        taskId: "620:ACH.TODAY",
        appid: 620,
        game: "Portal 2",
        task: "Today Task",
        track: "achievement",
        level: 3,
        score: 3000,
        evidence: "Steam proof + output.mp4",
        completedAt: "2026-06-14"
      },
      {
        rank: 2,
        competitor: "agent:week",
        type: "agent",
        runId: "run_week",
        taskId: "620:ACH.WEEK",
        appid: 620,
        game: "Portal 2",
        task: "Week Task",
        track: "achievement",
        level: 4,
        score: 4000,
        evidence: "Steam proof + output.mp4",
        completedAt: "2026-06-09"
      },
      {
        rank: 3,
        competitor: "agent:old",
        type: "agent",
        runId: "run_old",
        taskId: "620:ACH.OLD",
        appid: 620,
        game: "Portal 2",
        task: "Old Task",
        track: "achievement",
        level: 5,
        score: 5000,
        evidence: "Steam proof + output.mp4",
        completedAt: "2026-06-01"
      }
    ];
    const now = new Date("2026-06-14T12:00:00Z");

    expect(filterRowsBySeasonScope(rows, "daily", now).map((row) => row.runId)).toEqual(["run_today"]);
    expect(filterRowsBySeasonScope(rows, "weekly", now).map((row) => row.runId)).toEqual(["run_today", "run_week"]);

    const weekly = buildSeasonSnapshot(rows, "weekly", now);
    expect(weekly.window).toMatchObject({
      scope: "weekly",
      startDate: "2026-06-08",
      endDate: "2026-06-14",
      rowCount: 2
    });
    expect(weekly.standings.totals).toMatchObject({
      humanRuns: 1,
      agentRuns: 1
    });
    expect(weekly.leaderboards).toHaveLength(2);

    const snapshots = buildSeasonSnapshots(rows, now);
    expect(snapshots.map((snapshot) => snapshot.window.scope)).toEqual(["all", "daily", "weekly"]);
    expect(snapshots.find((snapshot) => snapshot.window.scope === "all")?.window.rowCount).toBe(3);
  });
});
