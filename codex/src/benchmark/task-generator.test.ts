import { describe, expect, it } from "vitest";
import { gameCatalog } from "./catalog";
import { buildAchievementTask, buildFixtureTasks, buildManualBenchmarkTask, buildSeededBenchmarkTask, buildSteamLeaderboardMetricProposals, buildSteamStatMetricProposals, levelFromAchievementPercent, suitabilityForAchievement } from "./task-generator";

describe("achievement task generation", () => {
  it("maps common achievements to lower levels and rare achievements to high levels", () => {
    expect(levelFromAchievementPercent(72)).toBe(3);
    expect(levelFromAchievementPercent(8.1)).toBe(10);
    expect(levelFromAchievementPercent(1.2)).toBe(10);
  });

  it("keeps very rare tasks under review instead of blindly ranking them", () => {
    expect(suitabilityForAchievement(40)).toBe("baseline");
    expect(suitabilityForAchievement(12)).toBe("ranked");
    expect(suitabilityForAchievement(4)).toBe("expert");
    expect(suitabilityForAchievement(1.4)).toBe("needs-review");
  });

  it("builds stable task identifiers and proof requirements", () => {
    const portal = gameCatalog.find((game) => game.appid === 620);
    expect(portal).toBeDefined();

    const task = buildAchievementTask(portal!, {
      apiName: "ACH.PORTAL_CONSERVATION",
      displayName: "Portal Conservation Society",
      percent: 5.1
    });

    expect(task.id).toBe("620:ACH.PORTAL_CONSERVATION");
    expect(task.proof).toContain("Steam achievement state for the linked SteamID");
    expect(task.proof.join(" ")).toContain("Video capture artifact");
    expect(task.suitabilityScore).toBeGreaterThan(0);
    expect(task.fairnessVerdict).toMatch(/good|controlled/);
  });

  it("generates a fixture task catalog for every seeded game", () => {
    const tasks = buildFixtureTasks();
    expect(tasks.length).toBeGreaterThanOrEqual(gameCatalog.length * 3);
    expect(new Set(tasks.map((task) => task.appid)).size).toBe(gameCatalog.length);
    expect(new Set(tasks.map((task) => task.track))).toEqual(new Set(["achievement", "capture", "leaderboard", "stat"]));
  });

  it("builds stat and leaderboard tasks with metric rules and review controls", () => {
    const task = buildSeededBenchmarkTask({
      appid: 1794680,
      key: "LDRB.TEST",
      title: "Leaderboard Test",
      track: "leaderboard",
      level: 6,
      targetValue: "highest score",
      metricName: "score",
      objective: "Maximize a controlled score.",
      proof: ["Score screen", "Canonical output.mp4 artifact"],
      estimatedRuntimeMinutes: 30,
      scoringRule: "Rank by highest score.",
      signalSource: "steam-leaderboard"
    });

    expect(task.id).toBe("1794680:LDRB.TEST");
    expect(task.track).toBe("leaderboard");
    expect(task.signalSource).toBe("steam-leaderboard");
    expect(task.metricName).toBe("score");
    expect(task.targetValue).toBe("highest score");
    expect(task.scoringRule).toContain("highest score");
    expect(task.fairnessVerdict).toBe("controlled");
  });

  it("builds manual non-achievement proposals as reviewable benchmark candidates", () => {
    const portal = gameCatalog.find((game) => game.appid === 620);
    expect(portal).toBeDefined();

    const task = buildManualBenchmarkTask(portal!, {
      title: "Chamber Score Route",
      track: "capture",
      level: 5,
      targetValue: "120 seconds",
      metricName: "completion_time_seconds",
      objective: "Complete a controlled Portal 2 chamber route within 120 seconds.",
      estimatedRuntimeMinutes: 16,
      scoringRule: "Pass at <= 120 seconds; rank lower verified time higher."
    });

    expect(task.id).toBe("620:CAP.CHAMBER_SCORE_ROUTE");
    expect(task.source).toBe("manual");
    expect(task.signalSource).toBe("run-capture");
    expect(task.metricName).toBe("completion_time_seconds");
    expect(task.proof.join(" ")).toContain("output.mp4");
    expect(task.suitabilityScore).toBeGreaterThan(0);
  });

  it("generates stat metric proposals from Steam schema fields", () => {
    const portal = gameCatalog.find((game) => game.appid === 620);
    expect(portal).toBeDefined();

    const proposals = buildSteamStatMetricProposals(portal!, [
      { apiName: "PORTALS_PLACED", displayName: "Portals Placed", defaultValue: 0 },
      { apiName: "TOTAL_STEPS", displayName: "Total Steps", defaultValue: 0 }
    ]);

    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({
      key: "STAT.PORTALS_PLACED",
      track: "stat",
      title: "Portals Placed",
      metricName: "portals_placed",
      signalSource: "steam-stat"
    });
    expect(proposals[0].proof?.join(" ")).toContain("output.mp4");
    expect(proposals[1].riskFlags).toEqual(expect.arrayContaining(["grind", "longHorizon"]));
  });

  it("generates controlled leaderboard proposals from Steam leaderboard metadata", () => {
    const portal = gameCatalog.find((game) => game.appid === 620);
    expect(portal).toBeDefined();

    const proposals = buildSteamLeaderboardMetricProposals(portal!, [
      {
        id: "12345",
        name: "challenge_mode_time",
        displayName: "Challenge Mode Time",
        sortMethod: "Ascending",
        displayType: "TimeMilliSeconds",
        entryCount: 5000
      },
      {
        id: "67890",
        name: "daily_score",
        displayName: "Daily Score",
        sortMethod: "Descending",
        displayType: "Numeric",
        entryCount: 7000
      }
    ]);

    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({
      key: "LDRB.CHALLENGE_MODE_TIME",
      track: "leaderboard",
      title: "Challenge Mode Time",
      metricName: "challenge_mode_time",
      signalSource: "steam-leaderboard",
      riskFlags: expect.arrayContaining(["leaderboardSnapshot"])
    });
    expect(proposals[0].scoringRule).toContain("Rank lower verified challenge_mode_time higher");
    expect(proposals[1].riskFlags).toEqual(expect.arrayContaining(["seasonal"]));
    expect(proposals[1].scoringRule).toContain("Rank higher verified daily_score higher");
  });
});
